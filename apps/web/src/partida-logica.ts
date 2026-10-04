// T-035: logica pura para arrancar una partida a mitad de un mapa y para
// compensar la latencia al grabar en vivo. Sin DOM ni audio.

import type { Chart, Ms } from '@tetra/core';

/**
 * El mapa solo con las notas que quedan a partir de `inicioMs`. Las notas
 * anteriores no cuentan como miss ni se dibujan. Una nota larga que EMPIEZA
 * antes del inicio se descarta entera (no se puede mantener una nota cuyo
 * comienzo no se jugo); una que empieza en `inicioMs` o despues se conserva.
 * Si `inicioMs` es 0 o menos, devuelve el mismo chart sin copiarlo.
 */
export function filtrarNotasDesde(chart: Chart, inicioMs: Ms): Chart {
  if (!(inicioMs > 0)) return chart;
  return { ...chart, notes: chart.notes.filter((n) => n.time >= inicioMs) };
}

/**
 * Posicion (ms) a la que se pone la cancion al arrancar desde `inicioMs`: la
 * partida empieza `leadInMs` antes de la primera nota que se juega, para que
 * haya el mismo aire de siempre. Nunca baja de 0.
 */
export function inicioDeLaCancion(inicioMs: Ms, leadInMs: Ms): Ms {
  return Math.max(0, inicioMs - leadInMs);
}

/** Cota de la latencia de salida que se acepta, en ms (un valor absurdo del navegador no debe correr las notas). */
export const LATENCIA_MAXIMA_MS = 500;

/**
 * Tiempo con el que se graba una nota pulsada en vivo. Es el mismo ajuste que
 * hace el juego en `clock.now()`: lo que el jugador oye va atrasado respecto
 * de lo que el contexto renderiza (por el `offset` de calibracion del usuario
 * y la latencia de salida), asi que la nota se graba en el instante que OYO,
 * no en el que se renderizaba.
 *
 *   grabado = renderizado - offsetUsuario - latenciaSalida
 */
export function compensarLatencia(
  renderizadoMs: Ms,
  offsetUsuarioMs: Ms,
  latenciaSalidaMs: Ms,
): Ms {
  const latencia = Number.isFinite(latenciaSalidaMs)
    ? Math.min(LATENCIA_MAXIMA_MS, Math.max(0, latenciaSalidaMs))
    : 0;
  const offset = Number.isFinite(offsetUsuarioMs) ? offsetUsuarioMs : 0;
  return renderizadoMs - offset - latencia;
}
