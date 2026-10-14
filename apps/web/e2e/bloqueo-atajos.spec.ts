// T-064: bloqueo de los atajos del navegador durante la partida.
//
// Se usan pulsaciones reales de Playwright (llegan al navegador como teclado de
// verdad) y un registro en la fase de burbuja de `window`: corre despues del
// listener de captura del bloqueo, asi que ve `defaultPrevented` ya decidido.
// El Keyboard Lock y la pantalla completa no se pueden ejercitar de verdad en un
// Chromium sin cabeza: se reemplazan `navigator.keyboard` y `document.fullscreenElement`
// por dobles que cuentan las llamadas.

import { expect, test, type Page } from '@playwright/test';

interface Registro {
  tipo: string;
  code: string;
  prevenido: boolean;
}

declare global {
  interface Window {
    __registroTeclas?: Registro[];
    __lock?: { lock: string[][]; unlock: number };
    __tetraDebug?: { clock: { now(): number; isRunning: boolean } };
  }
}

async function irAlClickTrack(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.getByRole('button', { name: 'Jugar click track' }).click();
  await page.waitForFunction(
    () => window.__tetraDebug !== undefined && window.__tetraDebug.clock.isRunning,
    { timeout: 30_000 },
  );
}

/** Empieza a anotar cada keydown y keyup con lo que decidio el bloqueo. */
async function registrarTeclas(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__registroTeclas = [];
    for (const tipo of ['keydown', 'keyup']) {
      window.addEventListener(tipo, (e) => {
        const k = e as KeyboardEvent;
        window.__registroTeclas!.push({ tipo, code: k.code, prevenido: k.defaultPrevented });
      });
    }
  });
}

async function leerRegistro(page: Page): Promise<Registro[]> {
  return page.evaluate(() => window.__registroTeclas ?? []);
}

async function ultimo(page: Page, tipo: string, code: string): Promise<Registro | undefined> {
  const r = await leerRegistro(page);
  return [...r].reverse().find((x) => x.tipo === tipo && x.code === code);
}

/** Instala un `navigator.keyboard` falso y una pantalla completa que se puede prender y apagar. */
async function instalarDobles(page: Page, conTeclado: boolean): Promise<void> {
  await page.addInitScript((hay) => {
    const estado = { lock: [] as string[][], unlock: 0 };
    window.__lock = estado;
    Object.defineProperty(navigator, 'keyboard', {
      configurable: true,
      value: hay
        ? {
            lock: (codigos: string[]) => {
              estado.lock.push(codigos);
              return Promise.resolve();
            },
            unlock: () => {
              estado.unlock++;
            },
          }
        : undefined,
    });
    let completa = false;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => (completa ? document.documentElement : null),
    });
    (window as unknown as { __pantallaCompleta: (v: boolean) => void }).__pantallaCompleta = (v) => {
      completa = v;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  }, conTeclado);
}

async function pantallaCompleta(page: Page, valor: boolean): Promise<void> {
  await page.evaluate((v) => {
    (window as unknown as { __pantallaCompleta: (v: boolean) => void }).__pantallaCompleta(v);
  }, valor);
}

test('en partida se previene Alt+numpad, Alt solo, Ctrl+W y F5; el menú no se toca', async ({ page }) => {
  await page.goto('/');
  await registrarTeclas(page);

  // Menú: nada se previene.
  await page.keyboard.press('Alt+Numpad7');
  await page.keyboard.press('F5').catch(() => undefined);
  expect((await ultimo(page, 'keydown', 'Numpad7'))?.prevenido).toBe(false);
  expect((await ultimo(page, 'keydown', 'F5'))?.prevenido).toBe(false);

  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.getByRole('button', { name: 'Jugar click track' }).click();
  await page.waitForFunction(
    () => window.__tetraDebug !== undefined && window.__tetraDebug.clock.isRunning,
    { timeout: 30_000 },
  );
  await registrarTeclas(page);

  // El caso de Arnold: Alt + 7 del teclado numérico.
  await page.keyboard.press('Alt+Numpad7');
  expect((await ultimo(page, 'keydown', 'Numpad7'))?.prevenido).toBe(true);
  expect((await ultimo(page, 'keyup', 'Numpad7'))?.prevenido).toBe(true);

  // Alt solo: el keyup es el que abre la barra de menú.
  await page.keyboard.down('Alt');
  await page.keyboard.up('Alt');
  expect((await ultimo(page, 'keydown', 'AltLeft'))?.prevenido).toBe(true);
  expect((await ultimo(page, 'keyup', 'AltLeft'))?.prevenido).toBe(true);

  await page.keyboard.press('Control+KeyW');
  expect((await ultimo(page, 'keydown', 'KeyW'))?.prevenido).toBe(true);
  await page.keyboard.press('F1');
  expect((await ultimo(page, 'keydown', 'F1'))?.prevenido).toBe(true);
  await page.keyboard.press('Tab');
  expect((await ultimo(page, 'keydown', 'Tab'))?.prevenido).toBe(true);

  // Lo que el juego usa o deja pasar no lo toca el bloqueo.
  await page.keyboard.press('F11').catch(() => undefined);
  expect((await ultimo(page, 'keydown', 'F11'))?.prevenido ?? false).toBe(false);

  // La entrada sigue recibiendo los carriles: la pulsación llega aunque se prevenga.
  await page.keyboard.press('KeyD');
  expect((await ultimo(page, 'keydown', 'KeyD'))?.prevenido).toBe(true);
});

test('Escape sigue pausando, en la pausa Tab y Enter se manejan y al salir se libera todo', async ({
  page,
}) => {
  await irAlClickTrack(page);
  await registrarTeclas(page);

  await page.keyboard.press('Escape');
  await expect(page.locator('.tetra-pausa-panel')).toBeVisible();
  expect((await ultimo(page, 'keydown', 'Escape'))?.prevenido).toBe(false);

  // En la pausa los botones se manejan con el teclado.
  await page.keyboard.press('Tab');
  expect((await ultimo(page, 'keydown', 'Tab'))?.prevenido).toBe(false);
  // Pero los atajos del navegador siguen bloqueados.
  await page.keyboard.press('Control+KeyP');
  expect((await ultimo(page, 'keydown', 'KeyP'))?.prevenido).toBe(true);

  await page.getByRole('button', { name: 'Salir al song select' }).click();
  await expect(page.getByRole('heading', { name: 'Elegir canción' })).toBeVisible();

  // Ya en el menú no se previene nada.
  await page.keyboard.press('Alt+Numpad7');
  expect((await ultimo(page, 'keydown', 'Numpad7'))?.prevenido).toBe(false);
});

test('beforeunload pide confirmación solo con la partida en curso', async ({ page }) => {
  const intentarCerrar = (): Promise<boolean> =>
    page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });

  await page.goto('/');
  expect(await intentarCerrar()).toBe(false);

  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.getByRole('button', { name: 'Jugar click track' }).click();
  await page.waitForFunction(
    () => window.__tetraDebug !== undefined && window.__tetraDebug.clock.isRunning,
    { timeout: 30_000 },
  );
  expect(await intentarCerrar()).toBe(true);

  // En la pausa la partida sigue en curso.
  await page.keyboard.press('Escape');
  await expect(page.locator('.tetra-pausa-panel')).toBeVisible();
  expect(await intentarCerrar()).toBe(true);

  await page.getByRole('button', { name: 'Salir al song select' }).click();
  await expect(page.getByRole('heading', { name: 'Elegir canción' })).toBeVisible();
  expect(await intentarCerrar()).toBe(false);
});

test('Keyboard Lock: se pide en pantalla completa con partida y se suelta al salir de una o de la otra', async ({
  page,
}) => {
  await instalarDobles(page, true);
  await irAlClickTrack(page);
  const lecturas = (): Promise<{ lock: string[][]; unlock: number }> =>
    page.evaluate(() => ({ lock: window.__lock!.lock, unlock: window.__lock!.unlock }));

  // Sin pantalla completa no se captura.
  expect((await lecturas()).lock).toHaveLength(0);

  await pantallaCompleta(page, true);
  const tras = await lecturas();
  expect(tras.lock).toHaveLength(1);
  expect(tras.lock[0]).toContain('KeyW');
  expect(tras.lock[0]).toContain('Escape');
  expect(tras.lock[0]).not.toContain('F11');

  // Con el teclado capturado, Escape sigue pausando.
  await page.keyboard.press('Escape');
  await expect(page.locator('.tetra-pausa-panel')).toBeVisible();

  // Salir de pantalla completa lo suelta; volver a entrar lo vuelve a pedir.
  await pantallaCompleta(page, false);
  expect((await lecturas()).unlock).toBe(1);
  await pantallaCompleta(page, true);
  expect((await lecturas()).lock).toHaveLength(2);

  // Salir de la partida lo suelta.
  await page.getByRole('button', { name: 'Salir al song select' }).click();
  await expect(page.getByRole('heading', { name: 'Elegir canción' })).toBeVisible();
  expect((await lecturas()).unlock).toBe(2);

  // Fuera de la partida, la pantalla completa no lo vuelve a pedir.
  await pantallaCompleta(page, false);
  await pantallaCompleta(page, true);
  expect((await lecturas()).lock).toHaveLength(2);
});

test('sin Keyboard Lock (Firefox, Safari) la partida anda sin errores', async ({ page }) => {
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await instalarDobles(page, false);
  await irAlClickTrack(page);
  await pantallaCompleta(page, true);
  await pantallaCompleta(page, false);
  await registrarTeclas(page);
  await page.keyboard.press('Alt+Numpad7');
  expect((await ultimo(page, 'keydown', 'Numpad7'))?.prevenido).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.tetra-pausa-panel')).toBeVisible();
  expect(errores).toEqual([]);
});
