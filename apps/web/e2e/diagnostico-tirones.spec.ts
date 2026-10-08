// T-061: diagnostico de tirones. Con "Mostrar FPS" encendido, un bloqueo
// artificial de 120 ms inyectado en la pagina durante la partida aparece en
// los resultados (con el instante correcto) y el JSON copiado trae la
// atribucion de script; con "Mostrar FPS" apagado no se crea ningun observer ni
// se muestra nada. Va por la interfaz como una persona (menu, click track) y
// corre con `--mute-audio` (ver playwright.config.ts): no suena nada.
//
// La partida se acorta saltando el reloj de juego cerca del final despues del
// bloqueo; el bloqueo mismo es un bucle de espera en un script con nombre
// (`bloqueo-artificial.js`) para poder reconocerlo en la atribucion.

import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __tetraDebug?: {
      clock: { now(): number; isRunning: boolean; duration: number; seek(t: number): void };
    };
    __observersCreados?: string[];
    programarBloqueo?: (ms: number) => void;
  }
}

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** Cuenta los PerformanceObserver de los tipos del diagnostico que crea la app. */
async function espiarObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__observersCreados = [];
    const Original = window.PerformanceObserver;
    const observarOriginal = Original.prototype.observe;
    Original.prototype.observe = function (
      this: PerformanceObserver,
      opciones?: PerformanceObserverInit,
    ) {
      if (opciones?.type) window.__observersCreados!.push(opciones.type);
      return observarOriginal.call(this, opciones);
    };
  });
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

/** Bloquea el hilo 120 ms cuando el reloj de juego pasa de 4 s, y salta la partida cerca del final. */
async function bloquearYTerminar(page: Page): Promise<void> {
  // Un archivo de verdad (servido por la ruta de abajo): el long-animation-frame solo atribuye
  // la URL y el nombre de la funcion de scripts externos, no de los inline.
  await page.route('**/bloqueo-artificial.js', (ruta) =>
    ruta.fulfill({
      contentType: 'application/javascript',
      body: `window.programarBloqueo = function programarBloqueo(ms) {
        setTimeout(function bloqueoArtificial() {
          const fin = performance.now() + ms;
          while (performance.now() < fin) { /* ocupado a proposito */ }
        }, 0);
      };`,
    }),
  );
  await page.addScriptTag({ url: '/bloqueo-artificial.js' });
  await page.waitForFunction(() => window.__tetraDebug!.clock.now() >= 4000, undefined, {
    timeout: 20_000,
  });
  await page.evaluate(() => {
    window.programarBloqueo!(120);
  });
  // Unos frames sanos para que el diagnostico cierre el tiron y el observer entregue el loaf.
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const clock = window.__tetraDebug!.clock;
    clock.seek(clock.duration - 1500);
  });
}

test('un bloqueo de 120 ms durante la partida sale en resultados, en su momento, y el JSON copiado lo atribuye al script', async ({
  page,
}) => {
  await espiarObservers(page);
  await irAlClickTrack(page);
  await bloquearYTerminar(page);

  const linea = page.locator('.tetra-resultados-tirones-texto');
  await expect(linea).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Copiar diagnóstico' }).click();
  await expect(page.getByRole('button', { name: 'Diagnóstico copiado' })).toBeVisible();
  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  await test.info().attach('diagnostico.json', { body: copiado, contentType: 'application/json' });
  const texto = (await linea.textContent()) ?? '';
  // La linea: conteo de > 30 ms, de > 50 ms y el peor (con arranques en frio de por medio, el peor
  // puede ser otro que el bloqueo; el bloqueo se busca abajo en el JSON).
  expect(texto).toMatch(/^\d+ frames? > 30 ms · \d+ > 50 ms · peor \d+ ms a -?\d+,\d s$/);
  await expect(linea).toHaveAttribute('title', /\d+,\d s · \d+ ms/);

  const resumen = JSON.parse(copiado) as {
    version: number;
    contexto: {
      userAgent: string;
      mapa: { notas: number };
      observadores: { longAnimationFrame: boolean };
      perdioElFoco: boolean;
      pestanaOculta: boolean;
    };
    tironesTotal: number;
    conteos: { mayor50: number };
    histograma: Record<string, number>;
    atribucion: { conScript: number; mayor50: number };
    tirones: {
      tJuego: number;
      duracionMs: number;
      notasVisibles?: number;
      golpesRecientes?: number;
      loaf?: { scriptMs: number; fuentes: { url: string; funcion: string; ms: number }[] };
    }[];
  };
  expect(resumen.version).toBe(1);
  expect(resumen.contexto.userAgent).toContain('Chrome');
  expect(resumen.contexto.mapa.notas).toBeGreaterThan(0);
  expect(Object.keys(resumen.histograma)).toEqual([
    '0-17',
    '17-20',
    '20-25',
    '25-33',
    '33-50',
    '50-100',
    '>100',
  ]);

  // El bloqueo empezo pasados 4 s de juego; el frame que lo cierra cae justo despues.
  const tiron = resumen.tirones.find((t) => t.tJuego >= 4000 && t.tJuego < 6000 && t.duracionMs >= 110);
  expect(tiron, 'tiron de ~120 ms entre los 4 y los 6 s').toBeDefined();
  expect(tiron!.duracionMs).toBeLessThan(400);
  expect(typeof tiron!.notasVisibles).toBe('number');
  expect(typeof tiron!.golpesRecientes).toBe('number');

  // Chromium da long-animation-frame: el script del bloqueo sale con su nombre.
  if (resumen.contexto.observadores.longAnimationFrame) {
    expect(tiron!.loaf, 'el tiron trae atribucion de long-animation-frame').toBeDefined();
    expect(tiron!.loaf!.scriptMs).toBeGreaterThan(50);
    const fuentes = tiron!.loaf!.fuentes.map((f) => `${f.url} ${f.funcion}`).join('\n');
    expect(fuentes).toMatch(/bloqueo/);
    expect(resumen.atribucion.conScript).toBeGreaterThanOrEqual(1);
  }

  // Con "Mostrar FPS" encendido (el valor por defecto) se engancharon los observers.
  const observers = await page.evaluate(() => window.__observersCreados!);
  if (resumen.contexto.observadores.longAnimationFrame) {
    expect(observers).toContain('long-animation-frame');
  }
});

test('con "Mostrar FPS" apagado no se crea ningun observer ni aparece el diagnostico', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('tetra:mostrar-fps', 'false'));
  await espiarObservers(page);
  await irAlClickTrack(page);
  await bloquearYTerminar(page);

  await expect(page.locator('.tetra-resultados')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.tetra-resultados-tirones')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copiar diagnóstico' })).toHaveCount(0);
  const observers = await page.evaluate(() => window.__observersCreados!);
  expect(observers.filter((t) => t === 'long-animation-frame' || t === 'longtask')).toEqual([]);
});
