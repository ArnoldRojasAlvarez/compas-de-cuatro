// T-066 (D2): identidad de una dificultad, para deduplicar canciones al
// reimportar y al fusionar las que ya estan duplicadas en la biblioteca.

import type { Chart } from '../types.js';
import { hashMapa } from '../difficulty/hash.js';

function normalizar(texto: string): string {
  return texto.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Claves de identidad de una dificultad (ver T-066, D2): `id:<beatmapId>` si
 * existe y `contenido:<hashMapa>|<titulo>|<artista>` siempre, con titulo y
 * artista normalizados (recorte, minusculas, espacios colapsados). El
 * `difficultyName` no entra: un renombre no rompe la identidad.
 */
export function clavesDeIdentidad(chart: Chart): string[] {
  const claves: string[] = [];
  if (chart.metadata.beatmapId !== undefined && chart.metadata.beatmapId > 0) {
    claves.push(`id:${chart.metadata.beatmapId}`);
  }
  claves.push(
    `contenido:${hashMapa(chart)}|${normalizar(chart.metadata.title)}|${normalizar(chart.metadata.artist)}`,
  );
  return claves;
}
