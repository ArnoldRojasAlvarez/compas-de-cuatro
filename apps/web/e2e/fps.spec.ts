// T-059: el contador de fps del HUD se puede leer. Muestra el promedio de ~500 ms
// de tiempo de juego y el peor frame de esa ventana ("60 fps · 17 ms max"), y su
// texto cambia unas dos veces por segundo, no una por frame. Va por la interfaz
// como una persona (menu, click track). Corre con `--mute-audio` (ver
// playwright.config.ts): no suena nada.

import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __tetraDebug?: { clock: { now(): number; isRunning: boolean } };
    __cambiosDeFps?: string[];
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

test('el contador de fps dice "N fps · M ms max" y cambia unas 2 veces por segundo, no en cada frame', async ({
  page,
}) => {
  await irAlClickTrack(page);
  const contador = page.locator('.tetra-fps');
  await expect(contador).toBeVisible();

  // Se anotan los cambios de texto durante 4 s de tiempo de juego (con un observador, no mirando cada tanto).
  await page.evaluate(() => {
    window.__cambiosDeFps = [];
    const el = document.querySelector('.tetra-fps')!;
    new MutationObserver(() => window.__cambiosDeFps!.push(el.textContent ?? '')).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  const desde = await page.evaluate(() => window.__tetraDebug!.clock.now());
  await page.waitForFunction((t0) => window.__tetraDebug!.clock.now() >= t0 + 4000, desde, {
    timeout: 20_000,
  });
  const cambios = await page.evaluate(() => window.__cambiosDeFps!);

  // Una ventana por 500 ms: 8 como mucho en 4 s (el texto igual al anterior ni se reescribe), con margen.
  // El contador de antes se reescribia en cada frame: cientos.
  expect(cambios.length).toBeLessThanOrEqual(10);
  expect(cambios.length).toBeGreaterThanOrEqual(1);
  for (const texto of cambios) expect(texto).toMatch(/^\d{1,3} fps · \d{1,4} ms max$/);

  // El peor frame de una ventana sana no baja de lo que dura un frame de un monitor de hasta 360 Hz.
  const ultimo = cambios[cambios.length - 1]!;
  const [, fps, peor] = /^(\d+) fps · (\d+) ms max$/.exec(ultimo)!;
  expect(Number(fps)).toBeGreaterThan(5);
  expect(Number(peor)).toBeGreaterThanOrEqual(2);
});

test('con el interruptor de FPS apagado no hay contador', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tetra:mostrar-fps', 'false'));
  await irAlClickTrack(page);
  await expect(page.locator('.tetra-fps')).toHaveCount(0);
});
