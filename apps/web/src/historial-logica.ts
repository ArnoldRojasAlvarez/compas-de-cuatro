// T-045: armar el registro del historial desde el resultado de una partida.
// Logica pura (sin DOM ni base de datos), para testearla sin navegador, igual
// que records-logica.ts. Guardarlo lo hace song-select.ts, justo despues de
// registrar la partida (T-055), con la misma regla: solo partidas completadas
// de la biblioteca, nunca el auto ni un replay (T-044).

import { JUDGEMENTS } from '@tetra/core';
import type { Chart, Column, Ms, RegistroPartida, ScoreState } from '@tetra/core';
import {
  contarTempranoTarde,
  desviacionEstandar,
  erroresJuzgados,
  media,
  type GolpeRegistrado,
} from './estadisticas.js';
import { claveDeRecord } from './records-logica.js';

/** Un golpe de la partida con la columna de su nota (lo que `Desviacion` de results.ts trae desde T-045). */
export interface GolpeConColumna extends GolpeRegistrado {
  readonly column: Column;
}

/**
 * Tramo jugado de un mapa: de la primera nota a la ultima (una larga cuenta
 * hasta donde termina), en ms. Es el tiempo en que el jugador estuvo tocando,
 * sin la intro ni el final de la cancion. 0 sin notas.
 */
export function duracionJugada(chart: Chart): Ms {
  if (chart.notes.length === 0) return 0;
  let primera = Infinity;
  let ultima = -Infinity;
  for (const nota of chart.notes) {
    primera = Math.min(primera, nota.time);
    ultima = Math.max(ultima, nota.kind === 'hold' ? nota.endTime : nota.time);
  }
  return Math.max(0, ultima - primera);
}

/**
 * El registro de una partida completada. Las notas son todos los juicios del
 * motor (con los miss); la desviacion media y tipica salen de los golpes que no
 * fueron miss, igual que la pantalla de resultados; los fallos por columna son
 * los miss de cada columna. `fecha` la pone quien guarda, para que esto siga
 * siendo puro.
 */
export function registroDePartida(
  chart: Chart,
  estado: ScoreState,
  golpes: readonly GolpeConColumna[],
  fecha: string,
): RegistroPartida {
  const errores = erroresJuzgados(golpes);
  const { temprano, tarde } = contarTempranoTarde(errores);
  const fallos: [number, number, number, number] = [0, 0, 0, 0];
  for (const golpe of golpes) {
    if (golpe.judgement === 'miss') fallos[golpe.column] += 1;
  }
  let notas = 0;
  for (const juicio of JUDGEMENTS) notas += estado.counts[juicio];
  return {
    hash: claveDeRecord(chart),
    fecha,
    score: estado.score,
    accuracy: estado.accuracy,
    notas,
    desviacionMedia: media(errores),
    desviacionTipica: desviacionEstandar(errores),
    tempranas: temprano,
    tardias: tarde,
    fallosPorColumna: fallos,
    duracionJugadaMs: duracionJugada(chart),
  };
}
