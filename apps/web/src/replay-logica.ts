// T-044: lo puro del replay y el modo auto en la app (sin DOM): la etiqueta que
// se muestra, la fecha corta y los mensajes cuando un replay no sirve. Separado
// de game.ts y song-select.ts para testearlo sin navegador.

import { replayEsDeEsteMapa, type Chart, type Replay } from '@tetra/core';

/** Como se reproduce una partida: el bot perfecto o un replay grabado. */
export type ModoReproduccion = 'auto' | 'replay';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * "7 oct" a partir de una fecha ISO ("2026-10-07T12:00:00.000Z"). Se lee el dia
 * del propio texto (como el detalle del record): no depende de la zona horaria
 * de quien mira. Una fecha que no se entiende da "".
 */
export function fechaCorta(iso: string): string {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (coincidencia === null) return '';
  const mes = Number(coincidencia[2]);
  const dia = Number(coincidencia[3]);
  if (!(mes >= 1 && mes <= 12) || !(dia >= 1 && dia <= 31)) return '';
  return `${dia} ${MESES[mes - 1]!}`;
}

/** La etiqueta de la partida: `AUTO`, o `REPLAY · 7 oct` (solo `REPLAY` si no se sabe la fecha). */
export function etiquetaDeReproduccion(modo: ModoReproduccion, fecha?: string): string {
  if (modo === 'auto') return 'AUTO';
  const corta = fecha === undefined ? '' : fechaCorta(fecha);
  return corta === '' ? 'REPLAY' : `REPLAY · ${corta}`;
}

export const MENSAJE_REPLAY_DE_OTRO_MAPA =
  'Este replay es de otro mapa: la dificultad cambio desde que se grabo.';
export const MENSAJE_SIN_REPLAY = 'No hay un replay guardado para esta dificultad.';
export const MENSAJE_REPLAY_ILEGIBLE = 'El replay guardado no se puede leer.';
export const MENSAJE_MAPA_SIN_NOTAS = 'El mapa no tiene notas que reproducir.';

/**
 * Por que un replay no se puede reproducir sobre `chart`, o `null` si se puede.
 * `chartJugado` es el mapa recortado cuando la partida empieza a mitad (T-035):
 * un replay hecho sobre el recortado tambien vale.
 */
export function motivoDeRechazoDelReplay(
  replay: Replay | null | undefined,
  chart: Chart,
  chartJugado: Chart = chart,
): string | null {
  if (replay === undefined) return MENSAJE_SIN_REPLAY;
  if (replay === null) return MENSAJE_REPLAY_ILEGIBLE;
  if (!replayEsDeEsteMapa(replay, chart) && !replayEsDeEsteMapa(replay, chartJugado)) {
    return MENSAJE_REPLAY_DE_OTRO_MAPA;
  }
  return null;
}
