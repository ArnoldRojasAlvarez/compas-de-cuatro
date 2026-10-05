// T-021: logica pura de la pantalla de resultados (sin DOM, sin canvas):
// rango por precision, fracciones por juicio y color con alpha. Se saca de
// results.ts para poder testearla sin navegador, igual que estadisticas.ts.

import type { Judgement } from '@tetra/core';
import { JUDGEMENTS } from '@tetra/core';

// El rango vive en core desde T-055 (records.ts, con SS); se reexporta para no romper a quien lo importaba de aca.
export type { Rango } from '@tetra/core';
export { rangoDePrecision } from '@tetra/core';

/**
 * Fraccion 0..1 de cada juicio sobre el total de juicios. Con total 0 (no
 * hubo ningun juicio) todas las fracciones son 0, no NaN.
 */
export function fraccionesDeJuicio(counts: Record<Judgement, number>): Record<Judgement, number> {
  let total = 0;
  for (const juicio of JUDGEMENTS) total += counts[juicio];

  const fracciones = {} as Record<Judgement, number>;
  for (const juicio of JUDGEMENTS) {
    fracciones[juicio] = total === 0 ? 0 : counts[juicio] / total;
  }
  return fracciones;
}

/**
 * Convierte un color hex (#rgb o #rrggbb) a `rgba(...)` con el alpha dado.
 * Si el valor no es un hex valido (por ejemplo ya es `rgb(...)`), se devuelve
 * tal cual: el canvas lo acepta igual, solo se pierde el alpha.
 */
export function colorConAlpha(color: string, alpha: number): string {
  const limpio = color.trim();
  const coincide = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(limpio);
  if (!coincide) return limpio;

  let hex = coincide[1] ?? '';
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
