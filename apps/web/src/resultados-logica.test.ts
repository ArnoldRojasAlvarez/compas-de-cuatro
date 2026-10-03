// Tests de T-021 para apps/web/src/resultados-logica.ts.

import { describe, expect, it } from 'vitest';
import type { Judgement } from '@tetra/core';
import { JUDGEMENTS } from '@tetra/core';
import { colorConAlpha, fraccionesDeJuicio, rangoDePrecision } from './resultados-logica.js';

function conteos(valores: Partial<Record<Judgement, number>>): Record<Judgement, number> {
  return { max: 0, perfect: 0, great: 0, good: 0, bad: 0, miss: 0, ...valores };
}

describe('rangoDePrecision', () => {
  it('el borde de cada rango es inclusivo hacia arriba', () => {
    expect(rangoDePrecision(0.95)).toBe('S');
    expect(rangoDePrecision(0.9)).toBe('A');
    expect(rangoDePrecision(0.8)).toBe('B');
    expect(rangoDePrecision(0.7)).toBe('C');
  });

  it('justo debajo de cada borde cae al rango de abajo', () => {
    expect(rangoDePrecision(0.9499)).toBe('A');
    expect(rangoDePrecision(0.8999)).toBe('B');
    expect(rangoDePrecision(0.7999)).toBe('C');
    expect(rangoDePrecision(0.6999)).toBe('D');
  });

  it('los extremos: 1 es S y 0 es D', () => {
    expect(rangoDePrecision(1)).toBe('S');
    expect(rangoDePrecision(0)).toBe('D');
  });
});

describe('fraccionesDeJuicio', () => {
  it('las fracciones suman 1 y cada una es su cantidad sobre el total', () => {
    const f = fraccionesDeJuicio(conteos({ max: 50, perfect: 25, great: 15, good: 5, bad: 3, miss: 2 }));
    const suma = JUDGEMENTS.reduce((acumulado, j) => acumulado + f[j], 0);
    expect(suma).toBeCloseTo(1, 10);
    expect(f.max).toBeCloseTo(0.5, 10);
    expect(f.perfect).toBeCloseTo(0.25, 10);
    expect(f.great).toBeCloseTo(0.15, 10);
    expect(f.miss).toBeCloseTo(0.02, 10);
  });

  it('con total 0 todo da 0 (no NaN)', () => {
    const f = fraccionesDeJuicio(conteos({}));
    for (const juicio of JUDGEMENTS) {
      expect(f[juicio]).toBe(0);
    }
  });

  it('un solo juicio ocupa toda la barra', () => {
    const f = fraccionesDeJuicio(conteos({ perfect: 7 }));
    expect(f.perfect).toBe(1);
    expect(f.max).toBe(0);
  });
});

describe('colorConAlpha', () => {
  it('convierte hex de 6 y de 3 digitos', () => {
    expect(colorConAlpha('#3fd8c2', 0.5)).toBe('rgba(63, 216, 194, 0.5)');
    expect(colorConAlpha('#fff', 0.2)).toBe('rgba(255, 255, 255, 0.2)');
  });

  it('un valor que no es hex se devuelve tal cual', () => {
    expect(colorConAlpha('rgb(1, 2, 3)', 0.5)).toBe('rgb(1, 2, 3)');
  });
});
