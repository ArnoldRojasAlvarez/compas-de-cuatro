// Tests de T-055 para records.ts: rango de una partida y combinacion de records.

import { describe, expect, it } from 'vitest';
import type { Judgement } from './types.js';
import { combinarRecord, mejorRango, rangoDePrecision } from './records.js';
import type { PartidaJugada } from './records.js';

function conteos(valores: Partial<Record<Judgement, number>>): Record<Judgement, number> {
  return { max: 0, perfect: 0, great: 0, good: 0, bad: 0, miss: 0, ...valores };
}

function partida(score: number, accuracy: number, extra: Partial<PartidaJugada> = {}): PartidaJugada {
  return {
    score,
    accuracy,
    maxCombo: 10,
    counts: conteos({ max: 10 }),
    rango: 'A',
    fecha: '2026-10-05T12:00:00.000Z',
    ...extra,
  };
}

describe('rangoDePrecision', () => {
  it('el borde de cada rango es inclusivo hacia arriba', () => {
    expect(rangoDePrecision(0.95)).toBe('S');
    expect(rangoDePrecision(0.9)).toBe('A');
    expect(rangoDePrecision(0.8)).toBe('B');
    expect(rangoDePrecision(0.7)).toBe('C');
  });

  it('justo debajo de cada borde cae al rango de abajo', () => {
    expect(rangoDePrecision(0.9999)).toBe('S');
    expect(rangoDePrecision(0.9499)).toBe('A');
    expect(rangoDePrecision(0.8999)).toBe('B');
    expect(rangoDePrecision(0.7999)).toBe('C');
    expect(rangoDePrecision(0.6999)).toBe('D');
  });

  it('precision 100 % es SS y 0 es D', () => {
    expect(rangoDePrecision(1)).toBe('SS');
    expect(rangoDePrecision(0)).toBe('D');
  });

  it('el SS no se pierde por ruido de coma flotante en la division', () => {
    expect(rangoDePrecision(0.9999999999)).toBe('SS');
  });

  it('con conteos, todo MAX y 300 sin ningun otro juicio es SS aunque la precision no sea 1', () => {
    expect(rangoDePrecision(0.9375, conteos({ perfect: 40 }))).toBe('SS');
    expect(rangoDePrecision(0.97, conteos({ max: 20, perfect: 20 }))).toBe('SS');
  });

  it('un solo juicio que no sea MAX/300 (o un miss) impide el SS por conteos', () => {
    expect(rangoDePrecision(0.97, conteos({ max: 39, great: 1 }))).toBe('S');
    expect(rangoDePrecision(0.97, conteos({ max: 39, miss: 1 }))).toBe('S');
  });

  it('con conteos vacios (sin ningun juicio) no es SS por el atajo de conteos', () => {
    expect(rangoDePrecision(0.5, conteos({}))).toBe('D');
  });
});

describe('mejorRango', () => {
  it('elige el de mayor orden y no el de mayor letra', () => {
    expect(mejorRango(['C', 'A', 'D'])).toBe('A');
    expect(mejorRango(['S', 'SS', 'A'])).toBe('SS');
    expect(mejorRango(['D'])).toBe('D');
  });

  it('una lista vacia da undefined', () => {
    expect(mejorRango([])).toBeUndefined();
  });
});

describe('combinarRecord', () => {
  it('el primer record: mejor y ultima son la partida, un intento', () => {
    const nueva = partida(500_000, 0.8);
    const registro = combinarRecord(undefined, '123', nueva);
    expect(registro.hash).toBe('123');
    expect(registro.mejor).toBe(nueva);
    expect(registro.ultima).toBe(nueva);
    expect(registro.intentos).toBe(1);
  });

  it('un score mayor se vuelve el mejor', () => {
    const vieja = partida(500_000, 0.8);
    const nueva = partida(600_000, 0.7);
    const registro = combinarRecord(combinarRecord(undefined, '1', vieja), '1', nueva);
    expect(registro.mejor).toBe(nueva);
  });

  it('un score menor conserva el mejor anterior, pero la ultima es la nueva', () => {
    // Una implementacion que reemplace siempre por la ultima falla aca.
    const buena = partida(900_000, 0.95);
    const mala = partida(100_000, 0.5);
    const registro = combinarRecord(combinarRecord(undefined, '1', buena), '1', mala);
    expect(registro.mejor).toBe(buena);
    expect(registro.ultima).toBe(mala);
  });

  it('con el mismo score gana la mayor precision', () => {
    const base = partida(700_000, 0.85);
    const masPreciso = partida(700_000, 0.9);
    const menosPreciso = partida(700_000, 0.8);
    const previo = combinarRecord(undefined, '1', base);
    expect(combinarRecord(previo, '1', masPreciso).mejor).toBe(masPreciso);
    expect(combinarRecord(previo, '1', menosPreciso).mejor).toBe(base);
  });

  it('con score y precision iguales gana la nueva', () => {
    const vieja = partida(700_000, 0.85, { fecha: '2026-01-01T00:00:00.000Z' });
    const nueva = partida(700_000, 0.85, { fecha: '2026-02-01T00:00:00.000Z' });
    const registro = combinarRecord(combinarRecord(undefined, '1', vieja), '1', nueva);
    expect(registro.mejor).toBe(nueva);
  });

  it('los intentos suman uno por partida', () => {
    let registro = combinarRecord(undefined, '1', partida(1, 0.1));
    registro = combinarRecord(registro, '1', partida(2, 0.2));
    registro = combinarRecord(registro, '1', partida(3, 0.3));
    expect(registro.intentos).toBe(3);
  });

  it('no muta el record previo', () => {
    const previo = combinarRecord(undefined, '1', partida(500_000, 0.8));
    const copia = structuredClone(previo);
    combinarRecord(previo, '1', partida(900_000, 0.9));
    expect(previo).toEqual(copia);
  });
});
