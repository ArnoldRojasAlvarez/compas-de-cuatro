// T-056: e2e de los contadores de la partida (cajitas de teclas, juicios, barra
// de error), el reintento mantenido y el salto de intro. Va por la interfaz
// como una persona (menu, song select, click track); las pulsaciones con
// precision de tiempo se mandan como eventos de teclado desde la pagina, con
// el reloj de audio como referencia, para que el test no dependa de la
// latencia de Playwright.

import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __tetraDebug?: {
      clock: { now(): number; isRunning: boolean };
      ctx: { currentTime: number };
    };
  }
}

const AUDIO_DE_PRUEBA = '../../fixtures/click-120.wav';

async function esperarPartida(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      window.__tetraDebug !== undefined &&
      window.__tetraDebug.clock.isRunning &&
      window.__tetraDebug.clock.now() > 300,
    { timeout: 30_000 },
  );
}

async function irAlClickTrack(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.getByRole('button', { name: 'Jugar click track' }).click();
  await esperarPartida(page);
}

async function reloj(page: Page): Promise<number> {
  return page.evaluate(() => window.__tetraDebug!.clock.now());
}

/**
 * Manda un keydown desde la pagina cuando el reloj de juego esta a `fase` ms
 * (entre `fase` y `fase + 30`) pasado el multiplo de 500 mas cercano hacia
 * atras. El click track tiene una nota cada 500 ms en la columna k % 4 (k = t / 500).
 * Con `fase` de 80 es un golpe tarde (~+80 ms) a la nota k; con 420 es un golpe
 * temprano (~-80 ms) a la nota k + 1.
 */
async function pulsarEnFase(page: Page, fase: number): Promise<void> {
  await page.evaluate(
    (faseDeseada) =>
      new Promise<void>((resolver) => {
        const codigos = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
        const paso = (): void => {
          const t = window.__tetraDebug!.clock.now();
          const k = Math.floor(t / 500);
          const fase = t - k * 500;
          if (t > 600 && fase >= faseDeseada && fase < faseDeseada + 30) {
            // Con fase 420 la nota que se esta por jugar es la siguiente.
            const objetivo = faseDeseada > 250 ? k + 1 : k;
            window.dispatchEvent(
              new KeyboardEvent('keydown', { code: codigos[objetivo % 4]! }),
            );
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

async function leerNumeros(page: Page, selector: string): Promise<number[]> {
  return page
    .locator(selector)
    .evaluateAll((els) => els.map((el) => Number(el.textContent)));
}

test('las cajitas de teclas cuentan un keydown por pulsacion y se iluminan mientras se aprieta', async ({
  page,
}) => {
  await irAlClickTrack(page);

  const cajas = page.locator('.tetra-tecla');
  await expect(cajas).toHaveCount(4);
  await expect(page.locator('.tetra-tecla-nombre')).toHaveText(['D', 'F', 'J', 'K']);
  await expect(page.locator('.tetra-tecla-cuenta')).toHaveText(['0', '0', '0', '0']);

  await page.keyboard.down('KeyD');
  await expect(cajas.nth(0)).toHaveClass(/tetra-tecla--abajo/);
  await expect(cajas.nth(1)).not.toHaveClass(/tetra-tecla--abajo/);
  // Mantenerla apretada repite el keydown (repeat = true): no cuenta como otra pulsacion.
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(150);
  await page.keyboard.up('KeyD');
  await expect(cajas.nth(0)).not.toHaveClass(/tetra-tecla--abajo/);
  await expect(page.locator('.tetra-tecla-cuenta').nth(0)).toHaveText('1');

  // Pulsaciones sueltas: cada una suma una, en su columna.
  await page.keyboard.press('KeyD');
  await page.keyboard.press('KeyD');
  await page.keyboard.press('KeyJ');
  await expect(page.locator('.tetra-tecla-cuenta')).toHaveText(['3', '0', '1', '0']);
});

test('la barra de error pone cada golpe en su desviacion: tarde a la derecha, temprano a la izquierda', async ({
  page,
}) => {
  await irAlClickTrack(page);

  // Antes de golpear la barra esta (con sus franjas) pero ninguna marca se uso todavia.
  await expect(page.locator('.tetra-error-franjas')).toHaveCount(1);
  await expect(page.locator('.tetra-error-marca[data-juicio]')).toHaveCount(0);

  await pulsarEnFase(page, 80);
  const tarde = page.locator('.tetra-error-marca[data-juicio]').first();
  await expect(tarde).toBeAttached();
  const izquierdaTarde = await tarde.evaluate((el) =>
    parseFloat((el as HTMLElement).style.left),
  );
  // +80 ms sobre la ventana de 50 (~129 ms) cae bien a la derecha del 50 %.
  expect(izquierdaTarde).toBeGreaterThan(60);
  expect(izquierdaTarde).toBeLessThan(100);
  await expect(tarde).not.toHaveCSS('opacity', '0');

  await pulsarEnFase(page, 420);
  const marcas = page.locator('.tetra-error-marca[data-juicio]');
  await expect(marcas).toHaveCount(2);
  const izquierdaTemprano = await marcas
    .nth(1)
    .evaluate((el) => parseFloat((el as HTMLElement).style.left));
  expect(izquierdaTemprano).toBeLessThan(40);
  expect(izquierdaTemprano).toBeGreaterThan(0);

  // La marca se desvanece sola (~2 s de reloj de juego).
  await expect(tarde).toHaveCSS('opacity', '0', { timeout: 6000 });

  // Los dos golpes se contaron en el contador de juicios (el resto de notas, miss).
  const juicios = await leerNumeros(page, '.tetra-juicio');
  expect(juicios).toHaveLength(6);
  const acertados = juicios.slice(0, 5).reduce((a, b) => a + b, 0);
  expect(acertados).toBeGreaterThanOrEqual(2);
});

test('mantener ` medio segundo reintenta; soltar antes no', async ({ page }) => {
  await irAlClickTrack(page);
  await page.waitForFunction(() => (window.__tetraDebug?.clock.now() ?? 0) > 2500, {
    timeout: 15_000,
  });

  // Soltar a mitad: el aro se llena un poco, desaparece y la partida sigue.
  await page.keyboard.down('Backquote');
  await expect(page.locator('.tetra-reintento')).toBeVisible();
  await page.waitForTimeout(200);
  await page.keyboard.up('Backquote');
  await expect(page.locator('.tetra-reintento')).toBeHidden();
  const alSoltar = await reloj(page);
  await page.waitForTimeout(700);
  // Una partida reiniciada tendria el reloj cerca de 0, no mas adelante que antes.
  expect(await reloj(page)).toBeGreaterThan(alSoltar);

  // Mantenida 0,7 s: reintenta (el reloj vuelve a empezar).
  const antes = await reloj(page);
  expect(antes).toBeGreaterThan(2500);
  await page.keyboard.down('Backquote');
  await page.waitForFunction(
    () => window.__tetraDebug !== undefined && window.__tetraDebug.clock.now() < 2000,
    { timeout: 20_000 },
  );
  await page.keyboard.up('Backquote');
  await expect(page.locator('.tetra-pausa')).toHaveCount(0);
});

/** Un .osz de 4 teclas con la primera nota a 12 s, sobre el audio del click track (60 s). */
function crearOszConIntroLarga(): Buffer {
  const notas: string[] = [];
  const x = [64, 192, 320, 448];
  for (let i = 0; i < 40; i++)
    notas.push(`${x[i % 4]},192,${12000 + i * 500},1,0,0:0:0:0:`);
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
    'Title:Intro larga',
    'Artist:Tetra',
    'Creator:Prueba',
    'Version:Salto',
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

test('saltar intro: Espacio lleva el reloj 2 s antes de la primera nota y el audio sigue sincronizado', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.locator('input[type="file"][accept=".osz"]').setInputFiles({
    name: 'intro-larga.osz',
    mimeType: 'application/octet-stream',
    buffer: crearOszConIntroLarga(),
  });
  await page.getByText('Intro larga').first().click();
  await page.locator('.tetra-song-select-jugar').click();
  await esperarPartida(page);

  const aviso = page.locator('.tetra-saltar');
  await expect(aviso).toBeVisible();
  await expect(aviso).toHaveText('Espacio para saltar');
  expect(await reloj(page)).toBeLessThan(5000);

  await page.keyboard.press('Space');
  // 12 000 - 2000 = 10 000 (menos el offset de salida, que en este navegador es ~0).
  await page.waitForFunction(() => window.__tetraDebug!.clock.now() > 9000, {
    timeout: 5000,
  });
  await expect(aviso).toBeHidden();
  const tras = await reloj(page);
  expect(tras).toBeLessThan(10_800);

  // Sin desfase: el reloj de juego sigue avanzando al mismo ritmo que el contexto de audio.
  const diferencia = (): Promise<number> =>
    page.evaluate(() => {
      const g = window.__tetraDebug!;
      return g.clock.now() - g.ctx.currentTime * 1000;
    });
  const d0 = await diferencia();
  await page.waitForTimeout(1500);
  const d1 = await diferencia();
  expect(Math.abs(d1 - d0)).toBeLessThan(5);

  // No hubo misses por el salto: la primera nota todavia no llego.
  expect(await leerNumeros(page, '.tetra-juicio--miss')).toEqual([0]);
});

test('con los tres interruptores apagados el HUD queda sin contadores', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('tetra:mostrar-teclas', 'false');
    localStorage.setItem('tetra:mostrar-juicios', 'false');
    localStorage.setItem('tetra:mostrar-barra-error', 'false');
  });
  await irAlClickTrack(page);
  await expect(page.locator('.tetra-dato--precision')).toBeVisible();
  await expect(page.locator('.tetra-teclas')).toHaveCount(0);
  await expect(page.locator('.tetra-juicios')).toHaveCount(0);
  await expect(page.locator('.tetra-error')).toHaveCount(0);
});

test('ajustes: los interruptores Teclas, Juicios y Barra de error vienen encendidos y se guardan', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();

  for (const id of [
    'tetra-teclas-casilla',
    'tetra-juicios-casilla',
    'tetra-barra-error-casilla',
  ]) {
    await expect(page.locator(`#${id}`)).toBeChecked();
  }
  await page.locator('#tetra-juicios-casilla').uncheck();
  expect(
    await page.evaluate(() => ({
      teclas: localStorage.getItem('tetra:mostrar-teclas'),
      juicios: localStorage.getItem('tetra:mostrar-juicios'),
    })),
  ).toEqual({ teclas: null, juicios: 'false' });
});

test('resultados: pulsaciones por tecla y UR tras jugar el click track hasta el final', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await irAlClickTrack(page);
  await page.keyboard.press('KeyD');
  await page.keyboard.press('KeyD');
  await page.keyboard.press('KeyK');
  await expect(page.locator('.tetra-resultados-teclas')).toHaveText(
    'D 2 · F 0 · J 0 · K 1',
    {
      timeout: 90_000,
    },
  );
  await expect(page.locator('.tetra-resultados-ur')).toHaveText(/^UR \d+$/);
});
