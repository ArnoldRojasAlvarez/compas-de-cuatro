// T-008: persistencia de la velocidad de caida del jugador. Mismo patron que
// el offset de T-007 (ver apps/web/src/offset.ts): localStorage inyectable
// con default a `localStorage`, para poder testear sin navegador real (ver
// vitest.config.ts, entorno node).
//
// El concepto natural del jugador es "que tan rapido bajan las notas", donde
// mas numero es mas rapido (igual que la "velocidad de scroll" de
// osu!mania). Por dentro, lo que consume `PlayfieldOptions.scrollDuration`
// (packages/engine/src/playfield.ts) es justo al reves: son los ms que tarda
// una nota en cruzar la pista, entonces MENOS ms es MAS rapido. Esta es la
// unica pieza del codigo que convierte entre las dos escalas: todo lo demas
// (el control del cargador, game.ts) usa la velocidad del jugador para leer
// y guardar, y solo llama a `velocidadAScrollDuration` para alimentar la
// pista.
//
// Mapeo elegido: scrollDuration(v) = BASE_SCROLL_MS / v, redondeado.
// Con BASE_SCROLL_MS = 3600 y velocidad entera de 1 a 12:
//
//   velocidad |  1  |  2  |  3  |  4  |  5  |  6  |  7  |  8  |  9  | 10  | 11  | 12
//   ms        | 3600| 1800| 1200| 900 | 720 | 600 | 514 | 450 | 400 | 360 | 327 | 300
//
// La velocidad por defecto (3) da 1200ms, el mismo scrollDuration fijo que
// tenia el juego antes de este ticket: para quien no toca el control nada
// cambia. Subir la velocidad reduce los ms (menos notas en pantalla a la
// vez, exactamente el pedido de Arnold); el minimo (1) queda bastante lento
// para quien recien empieza, el maximo (12) da 300ms, harto rapido para un
// jugador top.

import type { Ms } from '@tetra/core';

const CLAVE_VELOCIDAD = 'tetra:velocidad-usuario';

/** Ms que tarda una nota en cruzar la pista a velocidad 1 (ver mapeo arriba). */
const BASE_SCROLL_MS: Ms = 3600;

/** Velocidad minima: bastante lenta, para quien recien empieza. */
export const VELOCIDAD_MIN = 1;

/** Velocidad maxima: bastante rapida, pensada para un jugador top. */
export const VELOCIDAD_MAX = 12;

/** Velocidad de arranque: da el mismo scrollDuration (1200ms) que tenia el juego antes de T-008. */
export const VELOCIDAD_DEFAULT = 3;

/** Recorta y redondea a un entero dentro de [VELOCIDAD_MIN, VELOCIDAD_MAX]. */
export function clampVelocidad(valor: number): number {
  const redondeado = Math.round(valor);
  return Math.min(VELOCIDAD_MAX, Math.max(VELOCIDAD_MIN, redondeado));
}

/**
 * Convierte la velocidad que ve el jugador (mas = mas rapido) al
 * `scrollDuration` en ms que consume la pista (menos = mas rapido). Ver el
 * mapeo documentado arriba.
 */
export function velocidadAScrollDuration(velocidad: number): Ms {
  return Math.round(BASE_SCROLL_MS / clampVelocidad(velocidad));
}

/**
 * Lee la velocidad guardada por el usuario. `VELOCIDAD_DEFAULT` si no hay
 * nada guardado o si el valor guardado no es un numero valido (localStorage
 * editado a mano, o de una version incompatible): igual que `leerOffset` en
 * offset.ts, un valor corrupto no rompe la partida, solo vuelve al valor de
 * arranque. El resultado siempre queda dentro de [VELOCIDAD_MIN, VELOCIDAD_MAX],
 * aunque lo guardado en localStorage estuviera fuera de rango (por ejemplo,
 * si un VELOCIDAD_MAX de una version futura bajara).
 */
export function leerVelocidad(storage: Storage = localStorage): number {
  const crudo = storage.getItem(CLAVE_VELOCIDAD);
  if (crudo === null) return VELOCIDAD_DEFAULT;
  const valor = Number(crudo);
  return Number.isFinite(valor) ? clampVelocidad(valor) : VELOCIDAD_DEFAULT;
}

/** Guarda la velocidad del usuario, recortada a [VELOCIDAD_MIN, VELOCIDAD_MAX], para que sobreviva recargar. */
export function guardarVelocidad(valor: number, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_VELOCIDAD, String(clampVelocidad(valor)));
}
