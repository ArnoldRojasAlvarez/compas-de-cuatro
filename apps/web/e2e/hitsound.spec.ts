// T-027: e2e de los hitsounds y el volumen de efectos. Nada se escucha: se
// espian las llamadas a AudioBufferSourceNode.start (Playwright ya corre con
// --mute-audio) y se mira que se programen en el instante del golpe, en tiempo
// del AudioContext de la partida.

import { expect, test, type Page } from '@playwright/test';

interface LlamadaAStart {
  /** Argumento `when` de start(): tiempo de contexto en segundos. */
  when: number;
  /** ctx.currentTime en el momento de la llamada. */
  ahora: number;
  /** Duracion del buffer (los hitsounds duran menos de 0,2 s; la cancion, mucho mas). */
  duracion: number;
}

declare global {
  interface Window {
    __tetraDebug?: {
      clock: { now(): number; isRunning: boolean };
      ctx: { currentTime: number };
      volumen: { gain: { value: number } };
      efectos: { gain: { value: number } };
    };
    __golpes?: LlamadaAStart[];
  }
}

/** Registra cada start() de un buffer corto (un hitsound), antes de que cargue la app. */
async function espiarHitsounds(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__golpes = [];
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, when?: number, ...resto: number[]) {
      if (this.buffer !== null && this.buffer.duration < 0.2) {
        window.__golpes!.push({
          when: when ?? 0,
          ahora: this.context.currentTime,
          duracion: this.buffer.duration,
        });
      }
      return original.call(this, when, ...resto);
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
      window.__tetraDebug.clock.now() > 600,
    { timeout: 30_000 },
  );
}

/**
 * Manda un keydown cuando el reloj de juego pasa `fase` ms de un multiplo de
 * 500 (el click track tiene una nota cada 500 ms, en la columna k % 4), a la
 * columna `columnaDesplazada` posiciones despues de la de esa nota. Despues
 * del dispatch bloquea la pagina `bloqueoMs` ms: asi el frame que procesa la
 * entrada corre bastante despues del evento, que es lo que prueba que el
 * hitsound se agenda en el instante del golpe y no al correr el frame.
 * Devuelve ctx.currentTime justo antes del dispatch.
 */
async function pulsar(
  page: Page,
  opciones: { fase: number; columnaDesplazada: number; bloqueoMs: number },
): Promise<number> {
  return page.evaluate(
    ({ fase: faseDeseada, columnaDesplazada, bloqueoMs }) =>
      new Promise<number>((resolver) => {
        const codigos = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
        const paso = (): void => {
          const t = window.__tetraDebug!.clock.now();
          const k = Math.floor(t / 500);
          if (t > 700 && t - k * 500 >= faseDeseada && t - k * 500 < faseDeseada + 25) {
            const ctxAntes = window.__tetraDebug!.ctx.currentTime;
            const codigo = codigos[(k + columnaDesplazada) % 4]!;
            window.dispatchEvent(new KeyboardEvent('keydown', { code: codigo }));
            // Se suelta enseguida: sin keyup la tecla queda apretada y, si la
            // pulsacion siguiente cae en la misma columna (pasa bajo carga, cuando
            // se corre dos tiempos), el input la ignora con razon y el test falla.
            window.dispatchEvent(new KeyboardEvent('keyup', { code: codigo }));
            // Bloqueo sincronico: en el test, no en el juego, medir con performance.now es lo que se busca.
            const hasta = performance.now() + bloqueoMs;
            while (performance.now() < hasta) {
              // espera activa
            }
            resolver(ctxAntes);
            return;
          }
          requestAnimationFrame(paso);
        };
        paso();
      }),
    opciones,
  );
}

/** Deja correr unos frames para que el bucle de juego procese la entrada pendiente. */
async function esperarFrames(page: Page, cantidad = 4): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolver) => {
        let quedan = n;
        const paso = (): void => {
          quedan -= 1;
          if (quedan <= 0) resolver();
          else requestAnimationFrame(paso);
        };
        requestAnimationFrame(paso);
      }),
    cantidad,
  );
}

test('un golpe valido programa el hitsound en el instante de la pulsacion, no cuando corre el frame', async ({
  page,
}) => {
  await espiarHitsounds(page);
  await irAlClickTrack(page);
  await page.evaluate(() => {
    window.__golpes!.length = 0;
  });

  // Golpe casi perfecto a la nota k, y 60 ms de pagina bloqueada antes del frame.
  const ctxAlPulsar = await pulsar(page, { fase: 8, columnaDesplazada: 0, bloqueoMs: 60 });
  await esperarFrames(page);

  const golpes = await page.evaluate(() => window.__golpes!);
  expect(golpes).toHaveLength(1);
  const golpe = golpes[0]!;
  // Se agendo en el instante de la pulsacion (segundos del contexto), no en el del frame...
  expect(Math.abs(golpe.when - ctxAlPulsar)).toBeLessThan(0.02);
  // ...que corrio al menos ~60 ms despues: el tiempo ya habia pasado y suena en el acto.
  expect(golpe.ahora - golpe.when).toBeGreaterThan(0.05);
  expect(golpe.ahora - golpe.when).toBeLessThan(0.4);
});

test('solo suenan los golpes validos: una pulsacion sin nota a tiro no suena', async ({ page }) => {
  await espiarHitsounds(page);
  await irAlClickTrack(page);
  await page.evaluate(() => {
    window.__golpes!.length = 0;
  });

  // Columna dos posiciones despues: su nota mas cercana esta a 1000 ms.
  await pulsar(page, { fase: 8, columnaDesplazada: 2, bloqueoMs: 0 });
  await esperarFrames(page);
  expect(await page.evaluate(() => window.__golpes!.length)).toBe(0);

  // Control positivo: la columna de la nota si suena, con una sola llamada.
  await pulsar(page, { fase: 8, columnaDesplazada: 0, bloqueoMs: 0 });
  await esperarFrames(page);
  expect(await page.evaluate(() => window.__golpes!.length)).toBe(1);
});

test('los efectos tienen su propia ganancia, independiente de la musica', async ({ page }) => {
  // Posicion 0,5 de efectos es ganancia 0,25 (curva cuadratica); la musica queda en su default (0,8 ^ 2).
  await page.addInitScript(() => localStorage.setItem('tetra:volumen-efectos', '0.5'));
  await irAlClickTrack(page);
  const ganancias = await page.evaluate(() => ({
    efectos: window.__tetraDebug!.efectos.gain.value,
    musica: window.__tetraDebug!.volumen.gain.value,
  }));
  expect(ganancias.efectos).toBeCloseTo(0.25, 5);
  expect(ganancias.musica).toBeCloseTo(0.64, 5);
});

test('efectos en 0 silencian los golpes y el reloj sigue corriendo', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tetra:volumen-efectos', '0'));
  await irAlClickTrack(page);
  expect(await page.evaluate(() => window.__tetraDebug!.efectos.gain.value)).toBe(0);
  const antes = await page.evaluate(() => window.__tetraDebug!.clock.now());
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__tetraDebug!.clock.now())).toBeGreaterThan(antes);
});

test('ajustes: el volumen de efectos y el tipo de golpe se guardan, y el tipo suena una vez al cambiarlo', async ({
  page,
}) => {
  await espiarHitsounds(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();

  // Valor inicial: el default de efectos (60 %) y el tipo normal.
  await expect(page.locator('#tetra-efectos-valor')).toHaveValue('60');
  await expect(page.locator('#tetra-hitsound-tipo')).toHaveValue('normal');

  await page.locator('#tetra-efectos-valor').fill('35');
  expect(await page.evaluate(() => localStorage.getItem('tetra:volumen-efectos'))).toBe('0.35');
  // El volumen de la musica no se movio.
  expect(await page.evaluate(() => localStorage.getItem('tetra:volumen-musica'))).toBeNull();

  await page.evaluate(() => {
    window.__golpes!.length = 0;
  });
  await page.locator('#tetra-hitsound-tipo').selectOption('seco');
  expect(await page.evaluate(() => localStorage.getItem('tetra:hitsound'))).toBe('seco');
  await expect.poll(() => page.evaluate(() => window.__golpes!.length)).toBe(1);
  // Es el buffer del tipo seco: el mas corto (35 ms).
  const seco = (await page.evaluate(() => window.__golpes!))[0]!;
  expect(seco.duracion).toBeCloseTo(0.035, 2);

  await page.locator('#tetra-hitsound-tipo').selectOption('suave');
  await expect.poll(() => page.evaluate(() => window.__golpes!.length)).toBe(2);
  const suave = (await page.evaluate(() => window.__golpes!))[1]!;
  expect(suave.duracion).toBeCloseTo(0.1, 2);

  // Sigue entrando en la pantalla sin scroll de pagina.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
    .toBeLessThanOrEqual(800);

  // Sobrevive a recargar.
  await page.reload();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.locator('#tetra-efectos-valor')).toHaveValue('35');
  await expect(page.locator('#tetra-hitsound-tipo')).toHaveValue('suave');
});
