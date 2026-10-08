// T-060: logica pura del offset en vivo (teclas - y = durante la partida, aviso,
// y el ajuste desde la pausa). Nada de DOM ni de reloj aca: game.ts mide la edad
// del aviso con `clock.now()` y le pasa numeros (CLAUDE.md, "El reloj es el
// audio").
//
// El signo, que es el punto delicado (HANDOFF, lecciones 2 y 4): el reloj da
// `tiempoDeJuego = tiempoReal - offset` y el error de un golpe es
// `tiempoDeJuego - nota.time`. Un jugador que pega tarde (error positivo) se
// corrige SUBIENDO el offset: con un offset mayor el tiempo de juego de la misma
// pulsacion es menor y el error baja hacia 0. De ahi sale todo lo de abajo.

import type { Ms } from '@tetra/core';
import { formatearOffset } from './ajustes-barras-logica.js';
import { calcularOffsetCorregido } from './estadisticas.js';

/** Golpes juzgados que hacen falta para que el boton de la pausa ofrezca ajustar el offset. */
export const GOLPES_MINIMOS_PARA_AJUSTAR = 20;

/**
 * Sentido de una tecla de ajuste de offset: +1 sube el offset (`=`, `+`, el `+`
 * del teclado numerico), -1 lo baja (`-`, `_`, el `-` del numerico), 0 si no es
 * una de ellas. Se mira `code` (la tecla fisica) y, para los teclados donde el
 * `+` esta en otro lugar, `key`. Con Ctrl, Meta o Alt no es un ajuste (son los
 * atajos de zoom del navegador): quien llama lo filtra.
 */
export function sentidoDeTeclaDeOffset(code: string, key: string): -1 | 0 | 1 {
  if (code === 'Equal' || code === 'NumpadAdd') return 1;
  if (code === 'Minus' || code === 'NumpadSubtract') return -1;
  if (key === '+' || key === '=') return 1;
  if (key === '-' || key === '_') return -1;
  return 0;
}

/** `Offset de la canción +12 ms` (o `Offset +12 ms` si lo que se ajusta es el global). */
export function textoDeAvisoDeOffset(offset: Ms, deLaCancion: boolean): string {
  return `${deLaCancion ? 'Offset de la canción' : 'Offset'} ${formatearOffset(offset)}`;
}

/**
 * Lo que se sabe de los golpes juzgados hasta ahora (sin miss), para corregir el
 * offset a mitad de partida. Guarda, de cada golpe, el error y el offset que
 * regia en ese momento: asi el jugador puede cambiar el offset con las teclas y
 * la cuenta sigue siendo la de siempre (`calcularOffsetCorregido`), porque el
 * desfase fisico de cada golpe es `error + offset` y no depende de cual era el
 * offset cuando se midio.
 */
export interface SesgoAcumulado {
  /** Un golpe juzgado: su error (ms, positivo tarde) y el offset en vigor al golpear. */
  agregar(error: Ms, offsetEnVigor: Ms): void;
  /** Cuantos golpes lleva. */
  cantidad(): number;
  /** Media de los errores tal como se midieron (0 sin golpes). */
  mediaDeError(): Ms;
  /** Media del offset que regia en cada golpe (`respaldo` sin golpes). */
  offsetPromedio(respaldo: Ms): Ms;
  /**
   * El offset que deja la media en 0: `calcularOffsetCorregido(offsetPromedio,
   * mediaDeError)`. Sin golpes devuelve `respaldo`.
   */
  offsetCorregido(respaldo: Ms): Ms;
  reiniciar(): void;
}

export function crearSesgoAcumulado(): SesgoAcumulado {
  let golpes = 0;
  let sumaErrores = 0;
  let sumaOffsets = 0;
  return {
    agregar(error: Ms, offsetEnVigor: Ms): void {
      if (!Number.isFinite(error) || !Number.isFinite(offsetEnVigor)) return;
      golpes++;
      sumaErrores += error;
      sumaOffsets += offsetEnVigor;
    },
    cantidad(): number {
      return golpes;
    },
    mediaDeError(): Ms {
      return golpes === 0 ? 0 : sumaErrores / golpes;
    },
    offsetPromedio(respaldo: Ms): Ms {
      return golpes === 0 ? respaldo : sumaOffsets / golpes;
    },
    offsetCorregido(respaldo: Ms): Ms {
      if (golpes === 0) return respaldo;
      return calcularOffsetCorregido(sumaOffsets / golpes, sumaErrores / golpes);
    },
    reiniciar(): void {
      golpes = 0;
      sumaErrores = 0;
      sumaOffsets = 0;
    },
  };
}

/**
 * El boton de la pausa: `Ajustar offset (+61 ms)`. `delta` es cuanto cambia el
 * offset al aplicarlo (el nuevo menos el de ahora). Con delta 0 o menos de
 * `GOLPES_MINIMOS_PARA_AJUSTAR` golpes no hay boton (`null`).
 */
export function etiquetaDeAjusteEnPausa(golpes: number, delta: Ms): string | null {
  if (golpes < GOLPES_MINIMOS_PARA_AJUSTAR) return null;
  if (Math.round(delta) === 0) return null;
  return `Ajustar offset (${formatearOffset(delta)})`;
}
