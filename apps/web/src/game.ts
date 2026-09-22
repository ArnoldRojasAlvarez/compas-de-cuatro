// T-004: bucle de juego. Ensambla el reloj (packages/audio), el motor de
// juicio (packages/core) y el render + entrada (packages/engine). Es la
// unica pieza de todo el repo que puede tocar el navegador sin
// restricciones (ver CLAUDE.md, reglas 2 y 3): packages/core no puede
// importar nada de esto, y packages/audio y packages/engine no conocen la
// existencia del DOM salvo lo que reciben inyectado.

import { Application } from 'pixi.js';
import type { Chart, HitResult, Ms, ScoreState } from '@tetra/core';
import { createJudgeEngine } from '@tetra/core';
import { createAudioClock } from '@tetra/audio';
import { createKeyboardInput, createPlayfield, type PlayfieldOptions } from '@tetra/engine';
import { mostrarResultados, type Desviacion } from './results.js';
import { leerOffset } from './offset.js';

const OPCIONES_PISTA: PlayfieldOptions = {
  scrollDuration: 1200,
  height: 600,
  columnWidth: 110,
  receptorOffset: 120,
};

const LEAD_IN_MS: Ms = 1500;

/**
 * Gancho de depuracion para el e2e de Playwright (ver
 * apps/web/e2e/sincronia.spec.ts): expone el reloj de juego y el
 * AudioContext de reproduccion para poder comparar `clock.now()` contra
 * `audioContext.currentTime` desde afuera de la pagina, que es la prueba de
 * deriva que T-004 le debe a T-001 (ver docs/tickets/T-004-pista-y-entrada.md,
 * seccion "Tests"). No participa del gameplay: nadie adentro del juego lee
 * de aca, solo el test lo consulta desde `page.evaluate`.
 */
interface GanchoDeDepuracion {
  clock: import('@tetra/audio').AudioClock;
  ctx: AudioContext;
}

declare global {
  interface Window {
    __tetraDebug?: GanchoDeDepuracion;
  }
}

/**
 * Ensambla el HUD (score, combo, precision, fps/ms) como DOM plano. Nada de
 * React aca (ver CLAUDE.md, regla 4): un re-render de React a mitad de un
 * stream es un frame perdido, y este HUD se actualiza una vez por frame.
 */
function crearHud(contenedor: HTMLElement): {
  score: HTMLElement;
  combo: HTMLElement;
  precision: HTMLElement;
  fpsMs: HTMLElement;
} {
  const hud = document.createElement('div');
  hud.className = 'tetra-hud';

  const score = document.createElement('div');
  const combo = document.createElement('div');
  const precision = document.createElement('div');
  const fpsMs = document.createElement('div');

  hud.append(score, combo, precision, fpsMs);
  contenedor.appendChild(hud);

  return { score, combo, precision, fpsMs };
}

function actualizarHud(
  hud: ReturnType<typeof crearHud>,
  estado: ScoreState,
  msPorFrame: number,
): void {
  hud.score.textContent = `Score: ${estado.score}`;
  hud.combo.textContent = `Combo: ${estado.combo} (max ${estado.maxCombo})`;
  hud.precision.textContent = `Precision: ${(estado.accuracy * 100).toFixed(2)}%`;
  // fps y ms salen de la diferencia entre el t de este frame y el anterior,
  // los dos leidos de clock.now(): ni performance.now() ni el delta de rAF
  // entran en este calculo (ver CLAUDE.md, "El reloj es el audio"). Es una
  // consecuencia practica de la misma regla: como el juego ya lee el reloj
  // de audio cada frame para todo lo demas, ese mismo valor sirve tambien
  // para el contador de fps, sin necesidad de otra fuente de tiempo.
  const fps = msPorFrame > 0 ? 1000 / msPorFrame : 0;
  hud.fpsMs.textContent = `${fps.toFixed(0)} fps / ${msPorFrame.toFixed(1)} ms`;
}

export function runGame(chart: Chart, audio: AudioBuffer): Promise<ScoreState> {
  return new Promise((resolve, reject) => {
    const elementoApp = document.getElementById('app');
    if (!elementoApp) {
      reject(new Error('No se encontro el elemento #app en el documento.'));
      return;
    }
    // Se recorta a una constante nueva, tipada sin null: el guard de arriba
    // ya lo garantiza, pero TypeScript no propaga ese angostamiento dentro
    // de las funciones anidadas declaradas mas abajo (finalizar(), el
    // callback de app.init()), asi que se fija el tipo una sola vez aca.
    const contenedor: HTMLElement = elementoApp;
    contenedor.innerHTML = '';

    const lienzo = document.createElement('div');
    lienzo.className = 'tetra-lienzo';
    contenedor.appendChild(lienzo);
    const hud = crearHud(contenedor);

    // Contexto de audio dedicado a la reproduccion y al reloj de juego. El
    // contexto usado para decodificar el archivo (en main.ts) es otro: son
    // dos AudioContext separados, uno de decodificacion y uno de
    // reproduccion (ver el reporte de T-004, "Decisiones no cubiertas por
    // el ticket").
    const ctx = new AudioContext();
    // T-007: el offset se calibra en el cargador (ver cargador.ts) y se
    // guarda con apps/web/src/offset.ts; al arrancar una partida se lee y
    // se pasa como userOffset, para que el reloj arranque ya corregido en
    // vez de con el offset en 0 de siempre.
    const clock = createAudioClock(ctx, audio, { userOffset: leerOffset() });
    const engine = createJudgeEngine(chart);
    window.__tetraDebug = { clock, ctx };

    const desviaciones: Desviacion[] = [];
    function registrar(resultado: HitResult | null): void {
      if (resultado === null) return;
      desviaciones.push({
        time: resultado.note.time,
        error: resultado.error,
        judgement: resultado.judgement,
      });
    }

    // T-004, "El punto critico: el tiempo de la pulsacion":
    // toGameTime(ts) = clock.now() - (performance.now() - ts)
    // Es la unica lectura de performance.now() permitida en el proyecto:
    // mide cuanto hace que ocurrio el evento de teclado, no el paso del
    // tiempo de juego (eso sigue siendo responsabilidad exclusiva del
    // reloj de audio).
    const toGameTime = (eventTimeStamp: number): Ms => {
      // eslint-disable-next-line no-restricted-properties -- unica lectura permitida de performance.now() en todo el proyecto: T-004, "El punto critico: el tiempo de la pulsacion". Mide la antiguedad del evento de teclado (event.timeStamp), no el paso del tiempo de juego.
      const ahora = performance.now();
      return clock.now() - (ahora - eventTimeStamp);
    };

    const app = new Application();
    let detenido = false;
    let rafId = 0;

    let input: ReturnType<typeof createKeyboardInput> | null = null;
    let ultimoT = -LEAD_IN_MS;

    function limpiar(): void {
      detenido = true;
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      clock.stop();
      input?.destroy();
      delete window.__tetraDebug;
      void ctx.close().catch(() => {
        // cerrar el contexto es best-effort: si el navegador ya lo cerro
        // (por ejemplo al navegar fuera de la pagina) no hay nada que hacer.
      });
    }

    function finalizar(): void {
      if (detenido) return;
      const estadoFinal = { ...engine.state, counts: { ...engine.state.counts } };
      // Se lee clock.userOffset antes de limpiar(): es el offset con el que
      // se jugo esta partida, lo que necesita el boton de "corregir offset"
      // de la pantalla de resultados (T-007) para calcular el offset nuevo.
      const offsetDeEstaPartida = clock.userOffset;
      limpiar();
      app.destroy(true, { children: true });
      contenedor.innerHTML = '';
      mostrarResultados(contenedor, estadoFinal, desviaciones, offsetDeEstaPartida);
      resolve(estadoFinal);
    }

    app
      .init({
        width: OPCIONES_PISTA.columnWidth * 4,
        height: OPCIONES_PISTA.height,
        backgroundAlpha: 0,
        antialias: true,
      })
      .then(() => {
        if (detenido) return; // se pidio limpiar mientras se inicializaba

        lienzo.appendChild(app.canvas);
        const playfield = createPlayfield(app, chart, OPCIONES_PISTA);
        input = createKeyboardInput(window, toGameTime);

        clock.start(LEAD_IN_MS);

        function frame(): void {
          if (detenido) return;

          // 1. El reloj.
          const t = clock.now();

          // 2. La entrada, despachada con el tiempo de cada evento (no con t).
          for (const evento of input!.drain()) {
            if (evento.type === 'down') {
              playfield.setPressed(evento.column, true);
              const resultado = engine.press(evento.time, evento.column);
              if (resultado) playfield.showJudgement(evento.column, resultado.judgement);
              registrar(resultado);
            } else {
              playfield.setPressed(evento.column, false);
              const resultado = engine.release(evento.time, evento.column);
              if (resultado) playfield.showJudgement(evento.column, resultado.judgement);
              registrar(resultado);
            }
          }

          // 3. El juicio: misses por tiempo, una vez por frame.
          for (const resultado of engine.update(t)) {
            playfield.showJudgement(resultado.note.column, resultado.judgement);
            registrar(resultado);
          }

          // 4. El dibujo.
          playfield.render(t);

          // 5. El HUD.
          actualizarHud(hud, engine.state, t - ultimoT);
          ultimoT = t;

          if (engine.finished || t >= clock.duration) {
            finalizar();
            return;
          }

          // rAF programa el PROXIMO frame de dibujo; no se lee su
          // timestamp ni se acumula su delta para nada de timing (eso
          // sigue siendo clock.now() en el paso 1). Ver CLAUDE.md, "rAF
          // sirve para dibujar, nunca para medir tiempo de juego".
          // eslint-disable-next-line no-restricted-globals -- se usa solo para programar el siguiente frame de dibujo, nunca para medir tiempo (ver CLAUDE.md, "El reloj es el audio").
          rafId = requestAnimationFrame(frame);
        }

        // eslint-disable-next-line no-restricted-globals -- ver comentario dentro de frame().
        rafId = requestAnimationFrame(frame);
      })
      .catch((error: unknown) => {
        limpiar();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}
