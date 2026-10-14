// T-060: e2e de "Calibrar offset" (Ajustes, boton "Calibrar"). Un "jugador"
// con un desfase fisico constante pulsa al compas del metronomo; la pantalla
// tiene que medir ese desfase, mostrar la media con su signo y guardar el offset
// global con "Usar". Las pulsaciones son eventos de teclado mandados con el reloj
// de audio de la propia pantalla como referencia (su gancho de depuracion).
// Corre con `--mute-audio` (ver playwright.config.ts): no suena nada.

import { expect, test, type Page } from '@playwright/test';

interface GanchoCalibracion {
  ctx: { currentTime: number };
  t0: number;
  latenciaMs: number;
}

const PULSOS = 32;
const INTERVALO_MS = 500;

async function irACalibrar(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible();
  await page.locator('.tetra-ajustes-fila .tetra-ajustes-calibrar').click();
  await expect(page.getByRole('heading', { name: 'Calibrar offset' })).toBeVisible();
}

/**
 * Pulsa una tecla de columna en cada pulso, `desfase` ms despues (negativo, antes)
 * medido en el reloj de audio de la pantalla. Devuelve la latencia de salida que la
 * pantalla descuenta, para saber que media esperar.
 */
async function pulsarAlCompas(page: Page, desfase: number): Promise<number> {
  await page.getByRole('button', { name: 'Empezar', exact: true }).click();
  // Al arrancar, el navegador congela el hilo principal un par de segundos para abrir
  // la salida de audio (en una persona de verdad las pulsaciones de esos segundos
  // quedan en cola con su `timeStamp` y se fechan bien; las del test son sinteticas y
  // se fecharian tarde). Se espera a que pase, hasta el pulso 6, y se pulsa desde ahi.
  await page.waitForFunction(() => {
    const g = (window as unknown as { __tetraCalibrarOffset?: GanchoCalibracion })
      .__tetraCalibrarOffset;
    return g !== undefined && (g.ctx.currentTime - g.t0) * 1000 > 3000;
  });
  return page.evaluate(
    ({ desfase: d, pulsos, intervalo }) =>
      new Promise<number>((resolver) => {
        const gancho = (window as unknown as { __tetraCalibrarOffset: GanchoCalibracion })
          .__tetraCalibrarOffset;
        const codigos = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
        // Se pulsa desde el primer pulso que todavia no paso.
        const inicial = (gancho.ctx.currentTime - gancho.t0) * 1000;
        let k = Math.max(0, Math.ceil((inicial - d) / intervalo));
        const frame = (): void => {
          const ahoraMs = (gancho.ctx.currentTime - gancho.t0) * 1000;
          while (k < pulsos && ahoraMs >= k * intervalo + d) {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: codigos[k % 4]! }));
            window.dispatchEvent(new KeyboardEvent('keyup', { code: codigos[k % 4]! }));
            k++;
          }
          if (k >= pulsos) {
            resolver(gancho.latenciaMs);
            return;
          }
          requestAnimationFrame(frame);
        };
        frame();
      }),
    { desfase, pulsos: PULSOS, intervalo: INTERVALO_MS },
  );
}

async function numeroDeLaMedia(page: Page): Promise<number> {
  const texto = (await page.locator('.tetra-calibrar-offset-media').textContent()) ?? '';
  const m = /^([+-]?\d+) ms$/.exec(texto);
  expect(m, `media: ${texto}`).not.toBeNull();
  return Number(m![1]);
}

test('pulsando 40 ms tarde la media da ~+40, "Usar" guarda el offset global y Ajustes lo muestra', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await irACalibrar(page);
  // Antes de empezar no hay numero ni resultado.
  await expect(page.locator('.tetra-calibrar-offset-media')).toBeHidden();
  await expect(page.locator('.tetra-calibrar-offset-usar')).toBeHidden();

  const latencia = await pulsarAlCompas(page, 40);

  const usar = page.locator('.tetra-calibrar-offset-usar');
  await expect(usar).toBeVisible({ timeout: 30_000 });
  // Los golpes estan en la barra (el test no pulsa los primeros pulsos si el navegador
  // tardo en arrancar el audio); los de entrada, si hubo, tenues y fuera de la media.
  const marcas = await page.locator('.tetra-calibrar-offset-marca').count();
  expect(marcas).toBeGreaterThanOrEqual(20);
  expect(marcas).toBeLessThanOrEqual(PULSOS);
  expect(await page.locator('.tetra-calibrar-offset-marca--entrada').count()).toBeLessThanOrEqual(4);

  // 40 ms de desfase mas lo que tarda el cuadro de animacion (hasta ~17 ms), menos
  // la latencia de salida que la partida tambien descuenta. T-063: la pantalla
  // fecha el golpe con lo que se OIA (getOutputTimestamp), que va de 4 a 14 ms
  // detras de `currentTime - outputLatency` (con el que pulsa este test).
  const media = await numeroDeLaMedia(page);
  expect(media).toBeGreaterThanOrEqual(Math.floor(40 - latencia) - 18);
  expect(media).toBeLessThanOrEqual(Math.ceil(40 - latencia) + 20);
  // Pulso a pulso a la derecha del centro (tarde): la ultima marca esta pasada la mitad.
  const izquierda = await page
    .locator('.tetra-calibrar-offset-marca')
    .last()
    .evaluate((el) => parseFloat((el as HTMLElement).style.left));
  expect(izquierda).toBeGreaterThan(50);

  // Con el offset en 0, "Usar" ofrece exactamente la media (subir el offset, no bajarlo).
  await expect(usar).toHaveText(`Usar ${media > 0 ? '+' : ''}${media} ms`);
  expect(await page.evaluate(() => localStorage.getItem('tetra:offset-usuario'))).toBeNull();
  await usar.click();
  expect(await page.evaluate(() => localStorage.getItem('tetra:offset-usuario'))).toBe(
    String(media),
  );
  await expect(usar).toBeDisabled();

  // Volver a Ajustes: la barra de offset ya trae el valor guardado.
  await page.getByRole('button', { name: '← Ajustes' }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible();
  await expect(page.locator('.tetra-ajustes-barra:has(#tetra-offset-valor) .tetra-ajustes-dato')).toHaveText(
    `${media > 0 ? '+' : ''}${media} ms`,
  );
});

test('pulsando temprano con un offset ya puesto, el resultado es el desfase fisico y baja el offset', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Offset de +20 ya guardado: la media se mide CON el, pero "Usar" ofrece el desfase fisico.
  await page.addInitScript(() => {
    if (localStorage.getItem('tetra:offset-usuario') === null) {
      localStorage.setItem('tetra:offset-usuario', '20');
    }
  });
  await irACalibrar(page);

  const latencia = await pulsarAlCompas(page, -30);

  const usar = page.locator('.tetra-calibrar-offset-usar');
  await expect(usar).toBeVisible({ timeout: 30_000 });
  const media = await numeroDeLaMedia(page);
  // Pulso 30 ms antes (hasta 17 ms mas tarde por el cuadro), con el offset +20 y la latencia descontados.
  expect(media).toBeLessThan(0);
  // T-063: ver arriba, el fechado por lo que se oye corre la media hasta ~14 ms hacia temprano.
  expect(media).toBeGreaterThanOrEqual(Math.floor(-30 - 20 - latencia) - 18);
  expect(media).toBeLessThanOrEqual(Math.ceil(-13 - 20 - latencia) + 3);
  await expect(page.locator('.tetra-calibrar-offset-detalle')).toHaveText('Offset actual +20 ms');

  // El offset nuevo es 20 + media (se SUMA la media): ~ -30 - latencia, y la barra bajo de +20 a negativo.
  const esperado = 20 + media;
  await usar.click();
  expect(await page.evaluate(() => localStorage.getItem('tetra:offset-usuario'))).toBe(
    String(esperado),
  );
  expect(esperado).toBeLessThan(0);
  await expect(page.locator('.tetra-calibrar-offset-detalle')).toHaveText(
    `Offset guardado ${esperado} ms`,
  );
});
