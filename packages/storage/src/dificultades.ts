// Operaciones puras sobre la lista de dificultades de una cancion (T-032).
// Sin IndexedDB: asi se prueban sin fake-indexeddb ni transacciones.

import type { Chart } from '@tetra/core';

/**
 * Devuelve la lista con `chart` puesto: reemplaza la dificultad que tenga el
 * mismo `difficultyName` (en su misma posicion) o la agrega al final. No
 * toca la lista original.
 */
export function ponerDificultad(dificultades: readonly Chart[], chart: Chart): Chart[] {
  const nombre = chart.metadata.difficultyName;
  const indice = dificultades.findIndex((d) => d.metadata.difficultyName === nombre);
  if (indice === -1) return [...dificultades, chart];
  return dificultades.map((d, i) => (i === indice ? chart : d));
}

/** Devuelve la lista sin la dificultad llamada `nombre`. Si no existe, la misma lista copiada. */
export function quitarDificultad(dificultades: readonly Chart[], nombre: string): Chart[] {
  return dificultades.filter((d) => d.metadata.difficultyName !== nombre);
}
