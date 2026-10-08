// T-053: e2e de la partida a pantalla completa, el volumen y los ajustes
// minimalistas. Va por la interfaz como una persona (menu, song select, click
// track); el fondo y el video de una cancion se prueban con logica pura (la
// sincronia contra el reloj) porque el song select todavia no pasa la escena.

import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __tetraDebug?: {
      clock: { now(): number; isRunning: boolean };
      volumen: { gain: { value: number } };
    };
  }
}

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

async function cajaDeLaPista(page: Page): Promise<{ ancho: number; alto: number }> {
  return page.evaluate(() => {
    const caja = document.querySelector('.tetra-lienzo canvas')!.getBoundingClientRect();
    return { ancho: caja.width, alto: caja.height };
  });
}

test('la pista ocupa el alto de la ventana a 1280x800 y a 1920x1080, y sigue al redimensionar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await irAlClickTrack(page);

  const chica = await cajaDeLaPista(page);
  // Una pista de alto fijo (el 600 de antes) haria fallar esto.
  expect(chica.alto).toBe(800);
  // Carril = alto x 0.11 (88 px), cuatro carriles.
  expect(chica.ancho).toBe(88 * 4);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(async () => (await cajaDeLaPista(page)).alto).toBe(1080);
  expect((await cajaDeLaPista(page)).ancho).toBe(119 * 4);
});

test('el HUD queda limpio: precision y score, sin combo maximo ni etiquetas', async ({ page }) => {
  await irAlClickTrack(page);
  await expect(page.locator('.tetra-dato--precision')).toBeVisible();
  await expect(page.locator('.tetra-dato--score')).toBeVisible();
  await expect(page.locator('.tetra-dato--combo-max')).toHaveCount(0);
  await expect(page.locator('.tetra-dato-etiqueta')).toHaveCount(0);
});

test('el volumen de ajustes afecta la partida', async ({ page }) => {
  // La posicion 0.5 del control es ganancia 0.25 (curva cuadratica de volumen.ts).
  await page.addInitScript(() => localStorage.setItem('tetra:volumen-musica', '0.5'));
  await irAlClickTrack(page);
  const ganancia = await page.evaluate(() => window.__tetraDebug!.volumen.gain.value);
  expect(ganancia).toBeCloseTo(0.25, 5);
});

test('ajustes entra en 1280x800 sin parrafos, y la skin elegida se recuerda', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible();

  // Sin parrafos visibles (el de error solo aparece cuando hay un error).
  await expect(page.locator('.tetra-ajustes p:visible')).toHaveCount(0);
  // Cinco tarjetas (la quinta es Biblioteca, T-042), y todo entra sin bajar.
  await expect(page.locator('.tetra-ajustes-seccion')).toHaveCount(5);
  const alto = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(alto).toBeLessThanOrEqual(800);

  // Las cuatro skins propias mas la tarjeta "+"; la de Tetra viene activa.
  await expect(page.locator('.tetra-skin:not(.tetra-skin-importar)')).toHaveCount(4);
  await expect(page.locator('.tetra-skin-activa .tetra-skin-nombre')).toHaveText('Tetra');

  await page.locator('.tetra-skin', { hasText: 'Barras' }).click();
  await expect(page.locator('.tetra-skin-activa .tetra-skin-nombre')).toHaveText('Barras');
  expect(await page.evaluate(() => localStorage.getItem('tetra:skin-activa'))).toBe('propia:barras');

  // Sobrevive a recargar.
  await page.reload();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.locator('.tetra-skin-activa .tetra-skin-nombre')).toHaveText('Barras');
});

test('ajustes: volumen, atenuacion y video de fondo se guardan', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();

  await page.locator('#tetra-volumen-valor').fill('30');
  await page.locator('#tetra-atenuacion-valor').fill('55');
  await page.locator('#tetra-video-casilla').uncheck();

  const guardado = await page.evaluate(() => ({
    volumen: localStorage.getItem('tetra:volumen-musica'),
    atenuacion: localStorage.getItem('tetra:atenuacion-fondo'),
    video: localStorage.getItem('tetra:video-de-fondo'),
  }));
  expect(guardado).toEqual({ volumen: '0.3', atenuacion: '0.55', video: 'false' });
});
