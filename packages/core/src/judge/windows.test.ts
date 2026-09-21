// Tests de T-002 (ventanas de juicio por OD).
//
// Nota sobre el hallazgo de T-001 (H1 en clock.test.ts): un test que compara
// una expresion contra si misma, o contra el resultado de la misma formula
// que esta probando, da verde siempre y no sirve. Aca los valores exactos de
// la tabla estan escritos a mano (copiados de la tabla del ticket), no
// derivados llamando de nuevo a `64 - 3 * od` dentro del test.

import { describe, expect, it } from 'vitest';
import type { Judgement } from '../types.js';
import { judge, windowsForOD } from './windows.js';

describe('windowsForOD', () => {
  describe('tabla de valores exactos', () => {
    it('OD 0', () => {
      expect(windowsForOD(0)).toEqual({
        max: 16.5,
        perfect: 64,
        great: 97,
        good: 127,
        bad: 151,
        miss: 188,
      });
    });

    it('OD 5', () => {
      const w = windowsForOD(5);
      expect(w.max).toBeCloseTo(16.5, 2);
      expect(w.perfect).toBeCloseTo(49, 2);
      expect(w.great).toBeCloseTo(82, 2);
      expect(w.good).toBeCloseTo(112, 2);
      expect(w.bad).toBeCloseTo(136, 2);
      expect(w.miss).toBeCloseTo(173, 2);
    });

    it('OD 7.3 (mapa de referencia, Gumbarizo!)', () => {
      const w = windowsForOD(7.3);
      expect(w.max).toBeCloseTo(16.5, 2);
      expect(w.perfect).toBeCloseTo(42.1, 2);
      expect(w.great).toBeCloseTo(75.1, 2);
      expect(w.good).toBeCloseTo(105.1, 2);
      expect(w.bad).toBeCloseTo(129.1, 2);
      expect(w.miss).toBeCloseTo(166.1, 2);
    });

    it('OD 10', () => {
      expect(windowsForOD(10)).toEqual({
        max: 16.5,
        perfect: 34,
        great: 67,
        good: 97,
        bad: 121,
        miss: 158,
      });
    });
  });

  it('max vale 16.5 para cualquier OD valido', () => {
    for (let i = 0; i <= 100; i++) {
      expect(windowsForOD(i / 10).max).toBe(16.5);
    }
  });

  it('las ventanas son monotonas para todo OD de 0 a 10 en pasos de 0.1', () => {
    for (let i = 0; i <= 100; i++) {
      const od = i / 10;
      const w = windowsForOD(od);
      expect(w.max).toBeLessThan(w.perfect);
      expect(w.perfect).toBeLessThan(w.great);
      expect(w.great).toBeLessThan(w.good);
      expect(w.good).toBeLessThan(w.bad);
      expect(w.bad).toBeLessThan(w.miss);
    }
  });

  it('acepta OD 0 y OD 10 (bordes del rango valido)', () => {
    expect(() => windowsForOD(0)).not.toThrow();
    expect(() => windowsForOD(10)).not.toThrow();
  });

  it('lanza RangeError para OD -1', () => {
    expect(() => windowsForOD(-1)).toThrow(RangeError);
  });

  it('lanza RangeError para OD 11', () => {
    expect(() => windowsForOD(11)).toThrow(RangeError);
  });
});

describe('judge', () => {
  it("judge(0, w) devuelve 'max'", () => {
    const w = windowsForOD(7.3);
    expect(judge(0, w)).toBe('max');
  });

  it("el signo no cambia el juicio: judge(-42, w) con OD 7.3 devuelve 'perfect'", () => {
    const w = windowsForOD(7.3);
    // perfect(7.3) = 42.1, great(7.3) = 75.1: 42 cae dentro de perfect.
    expect(judge(-42, w)).toBe('perfect');
    expect(judge(42, w)).toBe('perfect');
  });

  it("judge(200, w) devuelve null, no 'miss': la nota todavia no le toca ser juzgada", () => {
    const w = windowsForOD(7.3);
    // miss(7.3) = 166.1: 200 esta afuera hasta de la ventana de miss.
    expect(judge(200, w)).toBeNull();
  });

  describe('bordes exactos de cada ventana, en positivo y en negativo', () => {
    const w = windowsForOD(7.3);

    // El borde exacto pertenece siempre a la ventana mas estricta (la de
    // adentro): en `x <= limite` el propio `limite` cae del lado de `<=`.
    const casos: Array<[string, number, Judgement | null]> = [
      ['0', 0, 'max'],
      ['max (borde)', w.max, 'max'],
      ['max + 0.1 (recien pasa a perfect)', w.max + 0.1, 'perfect'],
      ['perfect (borde)', w.perfect, 'perfect'],
      ['perfect + 0.1 (recien pasa a great)', w.perfect + 0.1, 'great'],
      ['great (borde)', w.great, 'great'],
      ['great + 0.1 (recien pasa a good)', w.great + 0.1, 'good'],
      ['good (borde)', w.good, 'good'],
      ['good + 0.1 (recien pasa a bad)', w.good + 0.1, 'bad'],
      ['bad (borde)', w.bad, 'bad'],
      ['bad + 0.1 (recien pasa a miss)', w.bad + 0.1, 'miss'],
      ['miss (borde)', w.miss, 'miss'],
      ['miss + 0.1 (ya no le toca ser juzgada)', w.miss + 0.1, null],
    ];

    it.each(casos)('en positivo, %s -> %s', (_nombre, error, esperado) => {
      expect(judge(error, w)).toBe(esperado);
    });

    it.each(casos)('en negativo, %s -> %s', (_nombre, error, esperado) => {
      expect(judge(-error, w)).toBe(esperado);
    });
  });
});
