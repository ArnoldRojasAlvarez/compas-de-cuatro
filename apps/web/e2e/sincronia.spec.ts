// T-004: e2e de deriva. Cobra la deuda que dejo T-001 (ver
// docs/tickets/T-004-pista-y-entrada.md, seccion "Tests" y
// docs/tickets/T-001-reloj-audio.md, seccion "Prueba de deriva"): la prueba
// de vitest de packages/audio/src/clock.test.ts demuestra con un doble de
// prueba por que clock.now() no se desincroniza, pero eso no prueba nada
// contra audio real, con hardware real, en un navegador real. Esta es esa
// prueba.
//
// Metodo: clock.now() y ctx.currentTime viven en bases de tiempo distintas
// (una en ms desde 0 con leadIn y offset aplicados, la otra en segundos
// desde que arranco el AudioContext), asi que no se comparan directo.
// Se toma una muestra base apenas arranca la reproduccion, que fija la
// diferencia constante entre las dos (offsetBase = clock.now() -
// ctx.currentTime*1000, ver el comentario dentro del test). Si esa
// diferencia se mantiene constante durante los 60 segundos, los dos
// relojes estan avanzando al mismo ritmo: eso es "no hay deriva". Si un
// reloj se desincroniza del otro, esa diferencia crece con el tiempo, y ahi
// si esta comparando de verdad, no una identidad algebraica (el error que
// T-001-F1 encontro en la primera version de la prueba de deriva de T-001).

import { expect, test } from '@playwright/test';

// Esta carpeta no entra en el proyecto de tsconfig de apps/web (que solo
// incluye src, ver apps/web/tsconfig.json): Playwright transpila esto con
// su propio esbuild y no pasa por `tsc --build`. Se declara aca el mismo
// gancho que expone apps/web/src/game.ts (window.__tetraDebug) en vez de
// depender de que ese `declare global` se filtre desde otro proyecto de
// TypeScript, que no es como funcionan las project references.
declare global {
  interface Window {
    __tetraDebug?: {
      clock: { now(): number; isRunning: boolean };
      ctx: { currentTime: number };
    };
  }
}

interface Muestra {
  clockNow: number;
  ctxTime: number;
  /** Media de `clock.now() - ctx.currentTime * 1000` durante ~100 ms de audio. */
  diferenciaMedia: number;
}

async function tomarMuestra(page: import('@playwright/test').Page): Promise<Muestra> {
  return page.evaluate(() => {
    const gancho = window.__tetraDebug;
    if (!gancho) {
      throw new Error('window.__tetraDebug no esta disponible: el juego ya termino o no arranco.');
    }
    // T-063: clock.now() interpola dentro del bloque de audio, y ctx.currentTime
    // avanza a saltos de ~10 ms. Una sola resta entre los dos trae hasta un
    // bloque de ruido (la fase en que se cayo), que no es deriva. Se promedia
    // la diferencia durante ~50 ms de audio (unos 5 bloques, medidos con el
    // propio currentTime, no con un temporizador): lo que queda es la deriva.
    const inicio = gancho.ctx.currentTime;
    let suma = 0;
    let n = 0;
    while (gancho.ctx.currentTime - inicio < 0.05) {
      suma += gancho.clock.now() - gancho.ctx.currentTime * 1000;
      n++;
    }
    return {
      clockNow: gancho.clock.now(),
      ctxTime: gancho.ctx.currentTime,
      diferenciaMedia: suma / n,
    };
  });
}

test('el reloj de juego no se desincroniza del audio en 60s de reproduccion real', async ({
  page,
}) => {
  await page.goto('/');

  // T-011: la pagina arranca en el menu. Para llegar al click track hay que
  // navegar como una persona: Menu -> Jugar (song select) -> Jugar click track.
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.getByRole('button', { name: 'Jugar click track' }).click();

  // Espera a que el bucle de juego haya arrancado el reloj de audio.
  await page.waitForFunction(
    () => window.__tetraDebug !== undefined && window.__tetraDebug.clock.isRunning,
    { timeout: 30_000 },
  );

  const muestraBase = await tomarMuestra(page);
  const offsetBase = muestraBase.diferenciaMedia;

  const derivasPorSegundo: number[] = [];

  // Se muestrea 50 segundos, no 60, a proposito. El click track dura 60s pero
  // la partida termina antes: la ultima nota (t=59500ms) sale de su ventana de
  // miss (OD 7.3 -> 166ms) a los ~59.67s, y ahi finalizar() borra
  // window.__tetraDebug. Muestrear hasta 60 era una carrera contra ese cierre y
  // volvia el test intermitente. 50s dejan margen de sobra y prueban la
  // ausencia de deriva igual de bien: la deriva es acumulativa, asi que
  // cualquier reloj mal hecho (rAF, performance.now) se despegaria de los 5ms
  // mucho antes de los 50s.
  // T-063: 45 y no 50, porque cada muestra ahora gira ~50 ms promediando (ver
  // tomarMuestra) y con la maquina cargada el bucle se pasaba del cierre.
  for (let segundo = 1; segundo <= 45; segundo++) {
    await page.waitForTimeout(1000);
    const muestra = await tomarMuestra(page);
    const derivaActual = muestra.diferenciaMedia - offsetBase;
    derivasPorSegundo.push(derivaActual);
  }

  // Guarda contra un falso positivo: si el AudioContext nunca arranco de
  // verdad (por ejemplo, por politica de autoplay del navegador), las dos
  // muestras se quedan practicamente en 0 y la "deriva" da 0 sin haber
  // medido nada real. El contexto tiene que haber avanzado cerca de los 50
  // segundos reales que se dejaron correr.
  const muestraFinal = await tomarMuestra(page);
  expect(muestraFinal.ctxTime - muestraBase.ctxTime).toBeGreaterThan(40);

  const derivaMaxima = Math.max(...derivasPorSegundo.map((d) => Math.abs(d)));
  expect(derivaMaxima).toBeLessThan(5);
});
