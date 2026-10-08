// T-059: logica pura del contador de fps del HUD. Nada de DOM ni de reloj aca:
// recibe numeros y devuelve numeros o strings, asi se prueba sin navegador
// (ver fps-logica.test.ts). game.ts la alimenta una vez por frame.
//
// Por que no es `1000 / dt` en cada frame: el reloj de juego sale de
// `audioContext.currentTime`, que avanza de a un bloque de render del audio
// (128 muestras, 2,67 ms a 48 kHz). Un frame de 16,7 ms se mide como 13,3,
// 16, 18,7 o 21,3 ms segun donde caiga, y el contador de antes mostraba entre 47
// y 125 fps con el monitor cayendo cada 16,7 ms exactos (T-059, docs/rendimiento).
// Contar los frames de una ventana de ~500 ms y dividir por el tiempo que
// abarca da el mismo promedio con un error de un bloque en 500 ms (0,5 %).
//
// El peor frame de la ventana es la unica lectura que tiene que ver con la
// cadencia real de dibujo, y esa la da el `timestamp` que recibe el callback de
// requestAnimationFrame: el reloj de audio, cuantizado, la inflaria a 21 ms con
// todos los frames sanos. Es solo diagnostico del HUD: el juicio, las notas y
// todo el gameplay siguen leyendo `clock.now()` (CLAUDE.md, "El reloj es el audio").

import type { Ms } from '@tetra/core';

/** Ancho de la ventana del promedio, en ms de tiempo de juego. */
export const VENTANA_FPS_MS: Ms = 500;

/** Un frame mas largo que esto no es un frame, es una pausa o un salto del reloj: se descarta. */
const FRAME_MAXIMO_VALIDO_MS = 2000;

export interface LecturaFps {
  /** Frames por segundo promedio de la ventana (frames / tiempo de juego que abarca). */
  fps: number;
  /** El frame mas largo de la ventana, en ms. */
  peorMs: number;
}

export interface MedidorDeFps {
  /**
   * Un frame ya dibujado. `t` es el instante de juego (`clock.now()`) y
   * `duracionFrameMs` lo que duro el frame segun el callback de rAF (0 si no se
   * conoce, por ejemplo el primer frame). Devuelve una lectura cada vez que se
   * cierra una ventana de `VENTANA_FPS_MS` y `null` el resto de los frames.
   */
  registrar(t: Ms, duracionFrameMs: number): LecturaFps | null;
  /** Descarta la ventana en curso (la partida se pauso o el reloj salto). */
  reiniciar(): void;
}

export function crearMedidorDeFps(ventanaMs: Ms = VENTANA_FPS_MS): MedidorDeFps {
  // `t` del primer frame de la ventana: referencia de tiempo, no cuenta como frame.
  let inicio = Number.NaN;
  let frames = 0;
  let peor = 0;

  function abrirVentana(t: Ms): void {
    inicio = t;
    frames = 0;
    peor = 0;
  }

  return {
    registrar(t, duracionFrameMs) {
      if (!Number.isFinite(t)) return null;
      // Sin ventana abierta, o el reloj fue hacia atras (seek, offset): este frame es la referencia.
      if (Number.isNaN(inicio) || t < inicio) {
        abrirVentana(t);
        return null;
      }
      frames++;
      if (duracionFrameMs > 0 && duracionFrameMs < FRAME_MAXIMO_VALIDO_MS && duracionFrameMs > peor) {
        peor = duracionFrameMs;
      }
      const abarca = t - inicio;
      if (abarca < ventanaMs) return null;
      const lectura: LecturaFps = { fps: (frames * 1000) / abarca, peorMs: peor };
      // El frame que cierra la ventana es la referencia de la siguiente: no se pierde ningun intervalo.
      abrirVentana(t);
      return lectura;
    },
    reiniciar() {
      inicio = Number.NaN;
      frames = 0;
      peor = 0;
    },
  };
}

/** "60 fps · 22 ms max": enteros, sin decimales que bailen en pantalla. */
export function formatearLecturaFps(lectura: LecturaFps): string {
  return `${Math.round(lectura.fps)} fps · ${Math.round(lectura.peorMs)} ms max`;
}
