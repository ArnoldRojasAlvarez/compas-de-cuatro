// T-002: ventanas de juicio por Overall Difficulty (OD).
//
// Los semianchos se copian de osu!mania porque son los que la mano de
// Arnold ya tiene aprendidos (ver docs/tickets/T-002-ventanas-juicio.md,
// seccion "Contexto"): cambiarlos haria que el juego se sintiera mal aunque
// el codigo fuera correcto.

import type { HitWindows, Judgement, Ms } from '../types.js';

/** Semiancho de la ventana `max`, fijo para cualquier OD. */
const VENTANA_MAX: Ms = 16.5;

/**
 * Calcula los semianchos de las ventanas de juicio para un OD dado.
 *
 * `max` es fijo en 16.5 ms. El resto sigue `base - 3 * od`, con `base` igual
 * a 64 (perfect), 97 (great), 127 (good), 151 (bad) y 188 (miss).
 *
 * @throws {RangeError} si `od` esta fuera del rango util, de 0 a 10.
 */
export function windowsForOD(od: number): HitWindows {
  if (od < 0 || od > 10) {
    throw new RangeError(`OD fuera de rango: ${od}. Tiene que estar entre 0 y 10.`);
  }

  return {
    max: VENTANA_MAX,
    perfect: 64 - 3 * od,
    great: 97 - 3 * od,
    good: 127 - 3 * od,
    bad: 151 - 3 * od,
    miss: 188 - 3 * od,
  };
}

/**
 * Clasifica una desviacion de tiempo contra un juego de ventanas.
 *
 * `error` positivo es tarde, negativo es temprano: el signo no cambia el
 * juicio, solo importa la magnitud. Devuelve `null` si la desviacion es
 * mayor que la ventana de `miss`, es decir si la nota todavia no le toca
 * ser juzgada (ni siquiera como fallo).
 *
 * Se llama hasta veinte veces por segundo en un mapa denso (una vez por
 * tecla pulsada): es una cadena de comparaciones sobre `Math.abs(error)`,
 * sin `Object.entries`, sin `find`, sin `sort` y sin reservar memoria.
 */
export function judge(error: Ms, windows: HitWindows): Judgement | null {
  const desviacion = Math.abs(error);

  if (desviacion <= windows.max) return 'max';
  if (desviacion <= windows.perfect) return 'perfect';
  if (desviacion <= windows.great) return 'great';
  if (desviacion <= windows.good) return 'good';
  if (desviacion <= windows.bad) return 'bad';
  if (desviacion <= windows.miss) return 'miss';
  return null;
}
