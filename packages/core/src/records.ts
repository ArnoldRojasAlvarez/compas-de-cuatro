// T-055: records por mapa. Logica pura (sin navegador): el rango de una
// partida y como se combina una partida nueva con el record que ya habia.
// La persistencia vive en @tetra/storage; esto solo decide.

import type { Judgement } from './types.js';

export type Rango = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D';

/** Una partida terminada, tal cual se guarda. */
export interface PartidaJugada {
  score: number;
  /** 0 a 1. */
  accuracy: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  rango: Rango;
  /** ms con signo (negativo = temprano), sin los miss. Ausente si no se midio. */
  desviacionMedia?: number;
  /** Pulsaciones por columna (4 numeros). Ausente si no se midio. */
  pulsaciones?: readonly number[];
  /** Texto ISO. Lo pone quien guarda. */
  fecha: string;
}

export interface RecordDeMapa {
  /** `hashMapa(chart)` como texto: identifica la dificultad por su contenido. */
  hash: string;
  mejor: PartidaJugada;
  ultima: PartidaJugada;
  intentos: number;
}

/** Margen para no perder el SS por ruido de coma flotante en la division de la precision. */
const EPSILON_PRECISION = 1e-9;

/**
 * Rango de una partida. SS: precision 100 %, o (si se pasan los conteos)
 * todo MAX/300 sin ningun otro juicio. Despues, por precision: S >= 0.95,
 * A >= 0.90, B >= 0.80, C >= 0.70, D el resto. Los bordes son inclusivos.
 *
 * `counts` es opcional para quien solo tiene la precision a mano (la pantalla
 * de resultados): sin conteos el SS depende solo de la precision.
 */
export function rangoDePrecision(accuracy: number, counts?: Record<Judgement, number>): Rango {
  if (accuracy >= 1 - EPSILON_PRECISION) return 'SS';
  if (counts !== undefined) {
    const buenos = counts.max + counts.perfect;
    const otros = counts.great + counts.good + counts.bad + counts.miss;
    if (buenos > 0 && otros === 0) return 'SS';
  }
  if (accuracy >= 0.95) return 'S';
  if (accuracy >= 0.9) return 'A';
  if (accuracy >= 0.8) return 'B';
  if (accuracy >= 0.7) return 'C';
  return 'D';
}

/** Orden de los rangos de peor a mejor (para elegir el mejor entre varios). */
const ORDEN_DE_RANGOS: readonly Rango[] = ['D', 'C', 'B', 'A', 'S', 'SS'];

/** El mejor de una lista de rangos, o `undefined` si la lista esta vacia. */
export function mejorRango(rangos: readonly Rango[]): Rango | undefined {
  let mejor: Rango | undefined;
  let mejorPeso = -1;
  for (const rango of rangos) {
    const peso = ORDEN_DE_RANGOS.indexOf(rango);
    if (peso > mejorPeso) {
      mejorPeso = peso;
      mejor = rango;
    }
  }
  return mejor;
}

/** true si `nueva` supera o iguala a `actual`: mayor score; en empate, mayor precision; en empate total, la nueva. */
function superaOIguala(nueva: PartidaJugada, actual: PartidaJugada): boolean {
  if (nueva.score !== actual.score) return nueva.score > actual.score;
  return nueva.accuracy >= actual.accuracy;
}

/**
 * Combina una partida nueva con el record previo de ese mapa. Mayor score
 * gana; empate, mayor precision; empate total, la nueva. `ultima` es siempre
 * la nueva y `intentos` suma uno (1 si no habia record).
 */
export function combinarRecord(
  previo: RecordDeMapa | undefined,
  hash: string,
  nueva: PartidaJugada,
): RecordDeMapa {
  if (previo === undefined) return { hash, mejor: nueva, ultima: nueva, intentos: 1 };
  return {
    hash,
    mejor: superaOIguala(nueva, previo.mejor) ? nueva : previo.mejor,
    ultima: nueva,
    intentos: previo.intentos + 1,
  };
}
