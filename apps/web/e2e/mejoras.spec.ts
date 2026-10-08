// T-057: e2e de las mejoras chicas. F3/F4 cambian la velocidad en vivo (con su
// aviso y lo guardan), el offset local de una cancion se suma al global solo en
// esa cancion, "Corregir offset" ajusta el local, y el record muestra la
// desviacion media y las pulsaciones. Va por la interfaz como una persona; las
// pulsaciones con precision de tiempo se mandan como eventos de teclado desde la
// pagina con el reloj de audio como referencia (igual que contadores.spec.ts).

import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';

const AUDIO_DE_PRUEBA = '../../fixtures/click-120.wav';

/** Lo que estos tests leen del gancho de depuracion de game.ts. */
interface DepuracionDeMejoras {
  clock: { now(): number; isRunning: boolean; userOffset: number };
}

async function esperarPartida(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __tetraDebug?: DepuracionDeMejoras }).__tetraDebug;
      return d !== undefined && d.clock.isRunning && d.clock.now() > 300;
    },
    { timeout: 30_000 },
  );
}

async function irAlClickTrack(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.getByRole('button', { name: 'Jugar click track' }).click();
  await esperarPartida(page);
}

async function userOffsetDelReloj(page: Page): Promise<number> {
  return page.evaluate(() => {
    const d = (window as unknown as { __tetraDebug?: DepuracionDeMejoras }).__tetraDebug;
    return d === undefined ? Number.NaN : d.clock.userOffset;
  });
}

/** Un .osz de 4 teclas con la primera nota a 12 s y una cada 500 ms (40 notas), sobre el audio del click track. */
function crearOsz(titulo: string): Buffer {
  const notas: string[] = [];
  const x = [64, 192, 320, 448];
  for (let i = 0; i < 40; i++) notas.push(`${x[i % 4]},192,${12000 + i * 500},1,0,0:0:0:0:`);
  const osu = [
    'osu file format v14',
    '',
    '[General]',
    'AudioFilename: audio.wav',
    'AudioLeadIn: 0',
    'PreviewTime: 0',
    'Countdown: 0',
    'SampleSet: Soft',
    'Mode: 3',
    '',
    '[Metadata]',
    `Title:${titulo}`,
    'Artist:Tetra',
    'Creator:Prueba',
    'Version:Mejoras',
    '',
    '[Difficulty]',
    'HPDrainRate:5',
    'CircleSize:4',
    'OverallDifficulty:5',
    'ApproachRate:5',
    'SliderMultiplier:1.4',
    'SliderTickRate:1',
    '',
    '[TimingPoints]',
    '0,500,4,2,1,50,1,0',
    '',
    '[HitObjects]',
    ...notas,
    '',
  ].join('\n');
  const zip = zipSync({
    'mapa.osu': strToU8(osu),
    'audio.wav': new Uint8Array(readFileSync(AUDIO_DE_PRUEBA)),
  });
  return Buffer.from(zip);
}

async function importarCancion(page: Page, titulo: string): Promise<void> {
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.locator('input[type="file"][accept=".osz"]').setInputFiles({
    name: `${titulo}.osz`,
    mimeType: 'application/octet-stream',
    buffer: crearOsz(titulo),
  });
  await page.getByText(titulo).first().click();
}

/** Las claves de offset local que hay en localStorage, con su valor. */
async function offsetsLocales(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const salida: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (clave !== null && clave.startsWith('tetra:offset-local:')) {
        salida[clave] = localStorage.getItem(clave) ?? '';
      }
    }
    return salida;
  });
}

/**
 * Manda un keydown de una nota cuando el reloj de juego esta a `fase` ms pasado
 * el multiplo de 500 (entre `fase` y `fase + 30`). Las notas de crearOsz caen
 * en multiplos de 500, columna k % 4. Igual que en contadores.spec.ts.
 */
async function pulsarEnFase(page: Page, fase: number): Promise<void> {
  await page.evaluate(
    (faseDeseada) =>
      new Promise<void>((resolver) => {
        const d = (window as unknown as { __tetraDebug?: DepuracionDeMejoras }).__tetraDebug!;
        const codigos = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
        const paso = (): void => {
          const t = d.clock.now();
          const k = Math.floor(t / 500);
          const faseActual = t - k * 500;
          if (t > 600 && faseActual >= faseDeseada && faseActual < faseDeseada + 30) {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: codigos[k % 4]! }));
            resolver();
            return;
          }
          requestAnimationFrame(paso);
        };
        paso();
      }),
    fase,
  );
}

test('F3 baja y F4 sube la velocidad en vivo: aviso, se guarda, se apaga solo y el navegador no ve las teclas', async ({
  page,
}) => {
  await irAlClickTrack(page);
  const aviso = page.locator('.tetra-velocidad-aviso');
  await expect(aviso).toBeHidden();

  // Velocidad por defecto 3 (1200 ms): F4 sube a 4 (900 ms).
  await page.keyboard.press('F4');
  await expect(aviso).toBeVisible();
  await expect(aviso).toHaveText('Velocidad 4 · 900 ms');
  expect(await page.evaluate(() => localStorage.getItem('tetra:velocidad-usuario'))).toBe('4');

  // F3 dos veces: 3 y luego 2 (1800 ms).
  await page.keyboard.press('F3');
  await page.keyboard.press('F3');
  await expect(aviso).toHaveText('Velocidad 2 · 1800 ms');
  expect(await page.evaluate(() => localStorage.getItem('tetra:velocidad-usuario'))).toBe('2');

  // El aviso se va solo (~1 s de reloj de juego).
  await expect(aviso).toBeHidden({ timeout: 5000 });

  // F3 y F4 no llegan al navegador (buscar, etc.): el handler les hace preventDefault.
  const prevenidos = await page.evaluate(() =>
    ['F3', 'F4'].map((code) => {
      const evento = new KeyboardEvent('keydown', { code, cancelable: true });
      window.dispatchEvent(evento);
      return evento.defaultPrevented;
    }),
  );
  expect(prevenidos).toEqual([true, true]);

  // La partida no se interrumpio.
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __tetraDebug?: DepuracionDeMejoras }).__tetraDebug?.clock
          .isRunning ?? false,
    ),
  ).toBe(true);
});

test('la velocidad guardada tambien se respeta en el tope: F4 en 12 no pasa de 12', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('tetra:velocidad-usuario', '12');
  });
  await irAlClickTrack(page);
  await page.keyboard.press('F4');
  await expect(page.locator('.tetra-velocidad-aviso')).toHaveText('Velocidad 12 · 300 ms');
  expect(await page.evaluate(() => localStorage.getItem('tetra:velocidad-usuario'))).toBe('12');
});

test('offset local: se ajusta en el song select y solo cambia el reloj de esa cancion', async ({
  page,
}) => {
  // Un offset global de 10: el reloj de la cancion con local +16 queda en 26, el click track en 10.
  await page.addInitScript(() => {
    localStorage.setItem('tetra:offset-usuario', '10');
  });
  await page.goto('/');
  await importarCancion(page, 'Offset local');

  const control = page.locator('.tetra-ss-offset');
  const valor = page.locator('.tetra-ss-offset-valor');
  // Sin offset: solo el reloj; el ajuste no se ve hasta pasar el mouse o enfocar.
  await expect(page.locator('.tetra-ss-offset-reloj')).toBeVisible();
  await expect(page.locator('.tetra-ss-offset-ajuste')).toBeHidden();

  await control.hover();
  await expect(valor).toHaveText('0 ms');
  // + de a 1 ms; Shift + clic de a 5 ms.
  await page.getByRole('button', { name: 'Offset de esta cancion, 1 ms despues' }).click();
  await expect(valor).toHaveText('+1 ms');
  await page
    .getByRole('button', { name: 'Offset de esta cancion, 1 ms despues' })
    .click({ modifiers: ['Shift'] });
  await expect(valor).toHaveText('+6 ms');
  await page
    .getByRole('button', { name: 'Offset de esta cancion, 1 ms antes' })
    .click({ modifiers: ['Shift'] });
  await expect(valor).toHaveText('+1 ms');

  // Teclas = y - de a 1 ms, sin tocar nada con el mouse.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  for (let i = 0; i < 15; i++) await page.keyboard.press('=');
  await expect(valor).toHaveText('+16 ms');
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await expect(valor).toHaveText('+14 ms');
  await page.keyboard.press('=');
  await page.keyboard.press('=');
  await expect(valor).toHaveText('+16 ms');

  // Con offset distinto de 0 el ajuste queda a la vista sin el mouse encima.
  await page.mouse.move(0, 0);
  await expect(page.locator('.tetra-ss-offset-ajuste')).toBeVisible();

  const guardados = await offsetsLocales(page);
  expect(Object.values(guardados)).toEqual(['16']);
  // El offset global no se toco.
  expect(await page.evaluate(() => localStorage.getItem('tetra:offset-usuario'))).toBe('10');

  // Escribir en el buscador no ajusta el offset.
  const buscador = page.locator('input[type="search"]').first();
  await buscador.click();
  await page.keyboard.type('Off-=-=');
  expect(Object.values(await offsetsLocales(page))).toEqual(['16']);
  await buscador.fill('');

  // La partida de esa cancion suma local + global.
  await page.locator('.tetra-song-select-jugar').click();
  await esperarPartida(page);
  expect(await userOffsetDelReloj(page)).toBe(26);

  // Otra partida, del click track: solo el global.
  await page.goto('/');
  await irAlClickTrack(page);
  expect(await userOffsetDelReloj(page)).toBe(10);
});

test('resultados: Corregir offset ajusta el local de la cancion y el record muestra la desviacion y las pulsaciones', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    localStorage.setItem('tetra:offset-usuario', '10');
  });
  await page.goto('/');
  await importarCancion(page, 'Corregir local');
  await page.locator('.tetra-song-select-jugar').click();
  await esperarPartida(page);

  // Salta la intro y golpea una nota unos 60 ms tarde: la media de la partida es ~+60.
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __tetraDebug?: DepuracionDeMejoras }).__tetraDebug;
      return d !== undefined && d.clock.now() > 12_100;
    },
    { timeout: 15_000 },
  );
  await pulsarEnFase(page, 60);

  // Hasta el final de la partida (la ultima nota cae a los 31,5 s).
  const corregir = page.locator('.tetra-resultados-corregir');
  await expect(corregir).toBeVisible({ timeout: 90_000 });
  await expect(corregir).toHaveAttribute('title', /de esta cancion/);
  await corregir.click();
  await expect(corregir).toBeDisabled();

  // Se corrigio el local de la cancion; el global sigue en 10.
  const guardados = Object.values(await offsetsLocales(page));
  expect(guardados).toHaveLength(1);
  const local = Number(guardados[0]);
  expect(local).toBeGreaterThan(30);
  expect(local).toBeLessThan(120);
  await expect(corregir).toHaveText(`Offset: ${local} ms`);
  expect(await page.evaluate(() => localStorage.getItem('tetra:offset-usuario'))).toBe('10');

  // Volver al song select: el record trae la desviacion media (tarde, alta) y las pulsaciones.
  await page.getByRole('button', { name: 'Volver al song select' }).click();
  const desviacion = page.locator('.tetra-ss-record-desviacion');
  await expect(desviacion).toHaveText(/^\+\d+ ms$/);
  await expect(desviacion).toHaveClass(/tetra-ss-record-desviacion-alta/);
  await expect(desviacion).toHaveAttribute('title', /pegas tarde por \d+ ms.*offset de esta cancion/);
  // Pasados +-8 ms el control de offset queda a la vista, con el local ya corregido.
  await page.mouse.move(0, 0);
  await expect(page.locator('.tetra-ss-offset-ajuste')).toBeVisible();
  await expect(page.locator('.tetra-ss-offset-valor')).toHaveText(`+${local} ms`);
  await expect(page.locator('.tetra-ss-record-intentos')).toHaveAttribute(
    'title',
    /D \d+ · F \d+ · J \d+ · K \d+/,
  );
});
