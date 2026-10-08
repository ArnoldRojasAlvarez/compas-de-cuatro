// Tests de T-045 para estadisticas-globales-logica.ts: periodos, textos de los
// numeros grandes y geometria de los graficos.

import { describe, expect, it } from 'vitest';
import {
  PERIODOS,
  alturasDeBarras,
  diaLocal,
  escalaDeValores,
  etiquetaDeDia,
  formatearDuracion,
  fraccionesEnX,
  numeroDeDia,
  partesTempranoTarde,
  textoDeDesviacionMedia,
  textoDePrecisionMedia,
} from './estadisticas-globales-logica.js';

describe('PERIODOS', () => {
  it('son 7 dias, 30 dias y todo, en ese orden', () => {
    expect(PERIODOS.map((p) => [p.etiqueta, p.dias])).toEqual([
      ['7 dias', 7],
      ['30 dias', 30],
      ['Todo', null],
    ]);
  });
});

describe('diaLocal', () => {
  it('es el dia de la hora local, no el de UTC', () => {
    // Construida en hora local: a las 23:30 o a las 00:30 el dia es ese en cualquier zona.
    expect(diaLocal(new Date(2026, 9, 5, 23, 30).toISOString())).toBe('2026-10-05');
    expect(diaLocal(new Date(2026, 9, 6, 0, 30).toISOString())).toBe('2026-10-06');
    expect(diaLocal(new Date(2027, 0, 1, 12, 0).toISOString())).toBe('2027-01-01');
  });

  it('una fecha ilegible no es ningun dia', () => {
    expect(diaLocal('ayer')).toBe('');
  });
});

describe('numeroDeDia y etiquetaDeDia', () => {
  it('dos dias seguidos difieren en 1, tambien al cruzar fin de mes y de anio', () => {
    expect(numeroDeDia('2026-10-06') - numeroDeDia('2026-10-05')).toBe(1);
    expect(numeroDeDia('2026-11-01') - numeroDeDia('2026-10-31')).toBe(1);
    expect(numeroDeDia('2027-01-01') - numeroDeDia('2026-12-31')).toBe(1);
  });

  it('la etiqueta es dia y mes corto', () => {
    expect(etiquetaDeDia('2026-10-07')).toBe('7 oct');
    expect(etiquetaDeDia('2027-01-15')).toBe('15 ene');
    expect(etiquetaDeDia('basura')).toBe('basura');
  });
});

describe('fraccionesEnX', () => {
  it('sin dias no hay posiciones; con un solo dia queda al centro', () => {
    expect(fraccionesEnX([])).toEqual([]);
    expect(fraccionesEnX(['2026-10-05'])).toEqual([0.5]);
  });

  it('es proporcional a los dias que pasaron: un hueco se ve como hueco', () => {
    expect(fraccionesEnX(['2026-10-01', '2026-10-02', '2026-10-11'])).toEqual([
      0, 0.1, 1,
    ]);
  });

  it('nunca da NaN, ni con fechas raras', () => {
    for (const f of fraccionesEnX(['x', 'y', 'z'])) expect(Number.isFinite(f)).toBe(true);
    expect(fraccionesEnX(['2026-10-05', '2026-10-05'])).toEqual([0, 1]);
  });
});

describe('escalaDeValores', () => {
  function valida(e: { min: number; max: number; marcas: number[] }): void {
    expect(Number.isFinite(e.min)).toBe(true);
    expect(Number.isFinite(e.max)).toBe(true);
    expect(e.max).toBeGreaterThan(e.min);
    for (const m of e.marcas) {
      expect(m).toBeGreaterThanOrEqual(e.min - 1e-9);
      expect(m).toBeLessThanOrEqual(e.max + 1e-9);
    }
  }

  it('sin valores da una escala valida', () => {
    valida(escalaDeValores([]));
    valida(escalaDeValores([], { conCero: true }));
  });

  it('un solo valor no da una escala de ancho 0', () => {
    const e = escalaDeValores([5]);
    valida(e);
    expect(e.min).toBeLessThan(5);
    expect(e.max).toBeGreaterThan(5);
    valida(escalaDeValores([0]));
  });

  it('con cero, el cero queda dentro y entre las marcas', () => {
    const e = escalaDeValores([8, 12, 20], { conCero: true });
    valida(e);
    expect(e.min).toBeLessThanOrEqual(0);
    expect(e.marcas).toContain(0);
  });

  it('la desviacion con signo abarca los dos lados', () => {
    const e = escalaDeValores([-14, -3, 6], { conCero: true });
    valida(e);
    expect(e.min).toBeLessThanOrEqual(-14);
    expect(e.max).toBeGreaterThanOrEqual(6);
    expect(e.marcas).toContain(0);
  });

  it('las marcas son numeros redondos y pocas', () => {
    const e = escalaDeValores([3, 47], { conCero: true });
    expect(e.marcas.length).toBeLessThanOrEqual(6);
    for (const m of e.marcas)
      expect(m % 10 === 0 || m % 5 === 0 || m % 20 === 0).toBe(true);
  });

  it('el maximo recorta por arriba: la precision no pasa de 100', () => {
    const e = escalaDeValores([96.4, 98.1, 99.7, 100], { maximo: 100 });
    valida(e);
    expect(e.max).toBe(100);
    expect(Math.max(...e.marcas)).toBeLessThanOrEqual(100);
  });

  it('el maximo con todos los valores en 100 sigue dando una escala valida', () => {
    valida(escalaDeValores([100, 100], { maximo: 100 }));
  });

  it('ignora NaN e infinitos', () => {
    valida(escalaDeValores([Number.NaN, Number.POSITIVE_INFINITY, 4, 9]));
  });

  it('valores muy chicos y muy grandes mantienen marcas redondas sin ruido de coma flotante', () => {
    const chica = escalaDeValores([99.5, 99.9]);
    valida(chica);
    for (const m of chica.marcas) expect(String(m).length).toBeLessThan(8);
    valida(escalaDeValores([0, 100_000]));
  });
});

describe('alturasDeBarras', () => {
  it('la mayor vale 1 y las demas son proporcionales', () => {
    expect(alturasDeBarras([2, 8, 4, 0])).toEqual([0.25, 1, 0.5, 0]);
  });

  it('todo en cero no divide por cero', () => {
    expect(alturasDeBarras([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
  });

  it('ignora lo que no es un conteo valido', () => {
    expect(alturasDeBarras([Number.NaN, -3, 5, 5])).toEqual([0, 0, 1, 1]);
  });
});

describe('partesTempranoTarde', () => {
  it('son porcentajes enteros que suman 100', () => {
    expect(partesTempranoTarde(0.5)).toEqual({ temprano: 50, tarde: 50 });
    expect(partesTempranoTarde(1 / 3)).toEqual({ temprano: 33, tarde: 67 });
    expect(partesTempranoTarde(1)).toEqual({ temprano: 100, tarde: 0 });
    expect(partesTempranoTarde(0)).toEqual({ temprano: 0, tarde: 100 });
  });

  it('sin golpes fuera de cero no hay barra', () => {
    expect(partesTempranoTarde(null)).toBeNull();
    expect(partesTempranoTarde(Number.NaN)).toBeNull();
  });
});

describe('textos de los numeros grandes', () => {
  it('la duracion cuenta los segundos de una partida corta y despues pasa a minutos y horas', () => {
    expect(formatearDuracion(0)).toBe('0 s');
    expect(formatearDuracion(45_900)).toBe('45 s');
    expect(formatearDuracion(60_000)).toBe('1 min');
    expect(formatearDuracion(3_900_000)).toBe('1 h 05 min');
    expect(formatearDuracion(-5)).toBe('0 s');
  });

  it('la precision media y la desviacion media usan "-" cuando no hay dato', () => {
    expect(textoDePrecisionMedia(null)).toBe('-');
    expect(textoDePrecisionMedia(0.98432)).toBe('98.43%');
    expect(textoDeDesviacionMedia(null)).toBe('-');
    expect(textoDeDesviacionMedia(4.2)).toBe('+4 ms');
    expect(textoDeDesviacionMedia(-3.6)).toBe('-4 ms');
    expect(textoDeDesviacionMedia(0)).toBe('0 ms');
  });
});
