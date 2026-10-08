// T-057: logica pura del cambio de velocidad en vivo (F3 baja, F4 sube) y de
// su aviso "Velocidad 7 · 514 ms". Nada de DOM ni de reloj aca: game.ts mide la
// edad del aviso con `clock.now()` y le pasa numeros (CLAUDE.md, "El reloj es
// el audio").

import type { Ms } from '@tetra/core';
import { clampVelocidad, velocidadAScrollDuration } from './velocidad.js';

/** Cuanto vive el aviso desde el cambio, en ms de reloj de juego. */
export const DURACION_AVISO_VELOCIDAD_MS = 1000;

/** Hasta que edad el aviso se ve entero; despues se desvanece hasta `DURACION_AVISO_VELOCIDAD_MS`. */
export const MS_AVISO_VELOCIDAD_ENTERO = 600;

/** Pasos de la opacidad del aviso: no se reescribe el estilo si no cambia el paso. */
export const PASOS_DE_ALPHA_AVISO = 10;

/** La velocidad tras mover `pasos` (negativo baja), siempre entera y dentro de rango. */
export function moverVelocidad(actual: number, pasos: number): number {
  return clampVelocidad(clampVelocidad(actual) + pasos);
}

/** "Velocidad 7 · 514 ms": la velocidad del jugador y los ms que tarda una nota en cruzar la pista. */
export function textoDeAvisoDeVelocidad(velocidad: number): string {
  return `Velocidad ${clampVelocidad(velocidad)} · ${velocidadAScrollDuration(velocidad)} ms`;
}

/**
 * Opacidad del aviso segun su edad (ms de reloj de juego desde el cambio): 1
 * hasta `MS_AVISO_VELOCIDAD_ENTERO`, baja linealmente a 0 en
 * `DURACION_AVISO_VELOCIDAD_MS` y queda en 0. Una edad negativa cuenta como
 * recien nacida; una no valida, como ya apagada.
 */
export function alphaDeAvisoDeVelocidad(edadMs: Ms): number {
  if (Number.isNaN(edadMs)) return 0;
  if (edadMs <= MS_AVISO_VELOCIDAD_ENTERO) return 1;
  if (edadMs >= DURACION_AVISO_VELOCIDAD_MS) return 0;
  return (
    1 -
    (edadMs - MS_AVISO_VELOCIDAD_ENTERO) /
      (DURACION_AVISO_VELOCIDAD_MS - MS_AVISO_VELOCIDAD_ENTERO)
  );
}

/** Opacidad cuantizada a `PASOS_DE_ALPHA_AVISO` (entero de 0 a `PASOS_DE_ALPHA_AVISO`). */
export function pasoDeAlphaDeAvisoDeVelocidad(edadMs: Ms): number {
  return Math.round(alphaDeAvisoDeVelocidad(edadMs) * PASOS_DE_ALPHA_AVISO);
}
