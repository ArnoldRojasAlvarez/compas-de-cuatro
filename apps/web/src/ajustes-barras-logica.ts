// T-058: logica pura de las barras de velocidad y offset de ajustes. Todo lo que
// se puede decidir sin DOM vive aca (formatos de los valores, recorte del
// offset a la barra, paso de los botones); ajustes.ts solo cablea los
// controles.

import type { Ms } from '@tetra/core';
import { clampVelocidad, velocidadAScrollDuration } from './velocidad.js';

/** Extremos de la barra de offset, en ms. El offset guardado puede salirse (calibracion). */
export const OFFSET_BARRA_MIN: Ms = -150;
export const OFFSET_BARRA_MAX: Ms = 150;

/** Paso de los botones `-` y `+` del offset, en ms. */
export const PASO_OFFSET_MS: Ms = 1;

/** Paso con Shift (botones y flechas del teclado), en ms. */
export const PASO_OFFSET_FUERTE_MS: Ms = 5;

/** Valor de la velocidad junto a su barra: `7 · 514 ms` (nivel y lo que tarda una nota en cruzar). */
export function formatearVelocidad(velocidad: number): string {
  return `${clampVelocidad(velocidad)} · ${velocidadAScrollDuration(velocidad)} ms`;
}

/** Valor del offset junto a su barra, con signo: `+12 ms`, `0 ms`, `-8 ms`. Muestra el valor real, aunque la barra no llegue. */
export function formatearOffset(offset: Ms): string {
  const entero = Math.round(offset);
  // `Math.round(-0.4)` da -0: sin esto saldria "-0 ms".
  if (entero === 0) return '0 ms';
  return `${entero > 0 ? '+' : '-'}${Math.abs(entero)} ms`;
}

/** Posicion de la barra para un offset: entero recortado a los extremos. El valor real no se toca. */
export function offsetABarra(offset: Ms): Ms {
  const recortado = Math.min(
    OFFSET_BARRA_MAX,
    Math.max(OFFSET_BARRA_MIN, Math.round(offset)),
  );
  // Sumar 0 convierte un -0 en 0.
  return recortado + 0;
}

/**
 * Offset que resulta de apretar un boton (`delta` de signo +/-). Parte del valor
 * real, no del de la barra. Dentro de la barra se recorta a sus extremos; un
 * valor que ya esta fuera (el de calibracion admite mas) puede acercarse a la
 * barra pero no alejarse mas con los botones.
 */
export function pasoDeOffset(actual: Ms, delta: Ms): Ms {
  const base = Math.round(actual);
  if (delta > 0) return Math.min(base + delta, Math.max(base, OFFSET_BARRA_MAX));
  return Math.max(base + delta, Math.min(base, OFFSET_BARRA_MIN));
}

/** Delta de un clic o una flecha: 5 ms con Shift, 1 sin. `sentido` es -1 (menos) o +1 (mas). */
export function deltaDeOffset(sentido: -1 | 1, conShift: boolean): Ms {
  return sentido * (conShift ? PASO_OFFSET_FUERTE_MS : PASO_OFFSET_MS);
}
