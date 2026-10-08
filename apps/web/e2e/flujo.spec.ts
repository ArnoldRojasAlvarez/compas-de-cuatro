// T-040: e2e de los recorridos que una persona hace de verdad. Complementa a
// sincronia.spec.ts (que prueba el reloj): aca se prueba que la pausa congela
// el reloj de audio y que el mapeador funciona de punta a punta contra
// IndexedDB y un audio real.
//
// Cada test arranca con un contexto de navegador limpio (sin biblioteca ni
// ajustes), asi que no dependen del orden ni de lo que haya en el perfil de
// quien los corre.

import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __tetraDebug?: {
      clock: { now(): number; isRunning: boolean };
      ctx: { currentTime: number; state: string };
    };
  }
}

const AUDIO_DE_PRUEBA = '../../fixtures/click-120.wav';

async function irAlClickTrack(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.getByRole('button', { name: 'Jugar click track' }).click();
  await page.waitForFunction(
    () =>
      window.__tetraDebug !== undefined &&
      window.__tetraDebug.clock.isRunning &&
      window.__tetraDebug.clock.now() > 300,
    { timeout: 30_000 },
  );
}

async function leerReloj(page: Page): Promise<{ ms: number; estado: string }> {
  return page.evaluate(() => {
    const gancho = window.__tetraDebug;
    if (!gancho) throw new Error('No hay partida en curso (window.__tetraDebug no existe).');
    return { ms: gancho.clock.now(), estado: gancho.ctx.state };
  });
}

test('pausa: congela el reloj de audio y Continuar reanuda despues de la cuenta regresiva', async ({
  page,
}) => {
  await irAlClickTrack(page);

  await page.keyboard.press('Escape');
  await expect(page.locator('.tetra-pausa-panel')).toBeVisible();

  const alPausar = await leerReloj(page);
  await page.waitForTimeout(1200);
  const pausado = await leerReloj(page);
  // Una pausa que solo ocultara la pista y dejara correr el audio haria fallar esto.
  expect(pausado.estado).toBe('suspended');
  expect(pausado.ms).toBe(alPausar.ms);

  // Escape continua: empieza la cuenta regresiva y el reloj SIGUE congelado.
  await page.keyboard.press('Escape');
  await expect(page.locator('.tetra-pausa-cuenta')).toBeVisible();
  const enLaCuenta = await leerReloj(page);
  expect(enLaCuenta.ms).toBe(alPausar.ms);

  // Termina la cuenta (3 s) y el juego sigue desde donde estaba, sin saltar el tiempo de la pausa.
  await expect(page.locator('.tetra-pausa')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(500);
  const reanudado = await leerReloj(page);
  expect(reanudado.estado).toBe('running');
  expect(reanudado.ms).toBeGreaterThan(alPausar.ms + 300);
  expect(reanudado.ms).toBeLessThan(alPausar.ms + 2500);

  // Salir vuelve al song select.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Salir al song select' }).click();
  await expect(page.getByRole('heading', { name: 'Elegir canción' })).toBeVisible();
});

test('pausa: Reintentar reinicia la partida sin pasar por el song select', async ({ page }) => {
  await irAlClickTrack(page);
  // Deja avanzar la partida para poder comprobar despues que volvio a empezar.
  await page.waitForFunction(() => (window.__tetraDebug?.clock.now() ?? 0) > 2500, { timeout: 15_000 });

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reintentar' }).click();

  await page.waitForFunction(
    () => window.__tetraDebug !== undefined && window.__tetraDebug.clock.isRunning,
    { timeout: 15_000 },
  );
  const tras = await leerReloj(page);
  expect(tras.ms).toBeLessThan(2500);
  await expect(page.locator('.tetra-pausa')).toHaveCount(0);
});

function numeroDeNotas(texto: string | null): number {
  const m = /^(\d+) notas/.exec(texto ?? '');
  return m ? Number(m[1]) : -1;
}

test('mapeador: cargar audio, generar, editar, guardar y reabrir desde la biblioteca', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mapeador', exact: true }).click();

  // Cargar el audio de prueba: se decodifica y se analiza en el worker.
  await page.setInputFiles('.tetra-mp-archivo', AUDIO_DE_PRUEBA);
  const estado = page.locator('.tetra-mp-estado');
  await expect(estado).toContainText('golpes detectados', { timeout: 60_000 });

  // El click track es de 120 BPM con un click cada 500 ms: ~120 golpes en 60 s.
  const bpm = page.locator('.tetra-mp-campo input[type=number]').first();
  expect(Number(await bpm.inputValue())).toBeCloseTo(120, 0);
  const golpes = Number(/(\d+) golpes/.exec((await estado.textContent()) ?? '')?.[1]);
  expect(golpes).toBeGreaterThan(100);
  expect(golpes).toBeLessThan(140);

  // Generar el mapa automatico.
  await page.getByRole('button', { name: 'Generar mapa automático' }).click();
  const notas = page.locator('.tetra-mp-notas');
  await expect(notas).toContainText('notas');
  const generadas = numeroDeNotas(await notas.textContent());
  expect(generadas).toBeGreaterThan(100);

  // Editar a mano: un clic sobre una pista alterna una nota (pone o quita, +-1).
  const lienzo = page.locator('.tetra-mp-canvas');
  const caja = (await lienzo.boundingBox())!;
  const anchoColumna = Math.min(96, Math.floor(caja.width / 6));
  const izquierda = Math.floor((caja.width - anchoColumna * 4) / 2);
  await page.mouse.click(
    caja.x + izquierda + anchoColumna * 3.5,
    caja.y + Math.round(caja.height * 0.8) - 83,
  );
  const tras = numeroDeNotas(await notas.textContent());
  expect(Math.abs(tras - generadas)).toBe(1);

  // Deshacer vuelve al estado anterior.
  await page.keyboard.press('Control+z');
  expect(numeroDeNotas(await notas.textContent())).toBe(generadas);

  // Guardar en la biblioteca y encontrarlo en el song select.
  await page.getByRole('button', { name: 'Guardar en la biblioteca' }).click();
  await expect(estado).toContainText('Guardado en la biblioteca');
  await page.getByRole('button', { name: 'Ir al song select' }).click();
  await expect(page.getByRole('heading', { name: 'Elegir canción' })).toBeVisible();
  await expect(page.getByText('click-120').first()).toBeVisible();

  // Reabrir en el editor: vuelven las mismas notas.
  await page.getByRole('button', { name: 'Editar en el mapeador' }).click();
  await expect(estado).toContainText('Audio listo', { timeout: 60_000 });
  expect(numeroDeNotas(await notas.textContent())).toBe(generadas);
});
