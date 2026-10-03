// Tests de T-019 para apps/web/src/hud-logica.ts.

import { describe, expect, it } from 'vitest';
import {
  AMPLITUD_PULSO,
  DURACION_PULSO_MS,
  SEPARADOR_MILES,
  escalaPulsoCombo,
  formatearPrecision,
  formatearScore,
  fraccionProgreso,
  nivelDeVida,
} from './hud-logica.js';

describe('escalaPulsoCombo', () => {
  it('en 0 ms vale 1 + AMPLITUD_PULSO', () => {
    expect(escalaPulsoCombo(0)).toBeCloseTo(1 + AMPLITUD_PULSO, 10);
  });

  it('a mitad de la duracion vale la mitad del camino', () => {
    expect(escalaPulsoCombo(DURACION_PULSO_MS / 2)).toBeCloseTo(
      1 + AMPLITUD_PULSO / 2,
      10,
    );
  });

  it('baja de forma lineal y monotona', () => {
    const a = escalaPulsoCombo(DURACION_PULSO_MS * 0.25);
    const b = escalaPulsoCombo(DURACION_PULSO_MS * 0.5);
    const c = escalaPulsoCombo(DURACION_PULSO_MS * 0.75);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(a - b).toBeCloseTo(b - c, 10);
  });

  it('en DURACION_PULSO_MS o mas vale exactamente 1', () => {
    expect(escalaPulsoCombo(DURACION_PULSO_MS)).toBe(1);
    expect(escalaPulsoCombo(DURACION_PULSO_MS + 1)).toBe(1);
    expect(escalaPulsoCombo(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('con ms negativos vale 1 (no hay pulso)', () => {
    expect(escalaPulsoCombo(-1)).toBe(1);
    expect(escalaPulsoCombo(-1000)).toBe(1);
  });

  it('justo antes del final todavia es apenas mayor que 1', () => {
    const v = escalaPulsoCombo(DURACION_PULSO_MS - 1);
    expect(v).toBeGreaterThan(1);
    expect(v).toBeLessThan(1 + AMPLITUD_PULSO / 50);
  });
});

describe('fraccionProgreso', () => {
  it('con t negativo (lead-in) da 0', () => {
    expect(fraccionProgreso(-1500, 180000)).toBe(0);
    expect(fraccionProgreso(-0.001, 180000)).toBe(0);
  });

  it('con t en 0 da 0', () => {
    expect(fraccionProgreso(0, 180000)).toBe(0);
  });

  it('a mitad de la cancion da 0.5', () => {
    expect(fraccionProgreso(90000, 180000)).toBe(0.5);
  });

  it('proporcional en un punto cualquiera', () => {
    expect(fraccionProgreso(45000, 180000)).toBeCloseTo(0.25, 10);
  });

  it('con t igual a la duracion da 1', () => {
    expect(fraccionProgreso(180000, 180000)).toBe(1);
  });

  it('con t pasado de la duracion da 1', () => {
    expect(fraccionProgreso(200000, 180000)).toBe(1);
  });

  it('con duracion 0 o negativa da 0 (sin dividir por cero)', () => {
    expect(fraccionProgreso(100, 0)).toBe(0);
    expect(fraccionProgreso(100, -5)).toBe(0);
    expect(fraccionProgreso(100, Number.NaN)).toBe(0);
  });
});

describe('formatearPrecision', () => {
  it('muestra dos decimales y el signo de porcentaje', () => {
    expect(formatearPrecision(0.9853)).toBe('98.53%');
    expect(formatearPrecision(0.5)).toBe('50.00%');
  });

  it('0 y 1 en los extremos', () => {
    expect(formatearPrecision(0)).toBe('0.00%');
    expect(formatearPrecision(1)).toBe('100.00%');
  });

  it('redondea la mitad hacia arriba: 0.98535 da 98.54% (toFixed daria 98.53%)', () => {
    expect(formatearPrecision(0.98535)).toBe('98.54%');
  });

  it('redondea hacia abajo por debajo de la mitad', () => {
    expect(formatearPrecision(0.985349)).toBe('98.53%');
  });

  it('completa con cero el decimal chico', () => {
    expect(formatearPrecision(0.9905)).toBe('99.05%');
    expect(formatearPrecision(0.99)).toBe('99.00%');
  });

  it('un valor que casi llega a 100 redondea a 100.00%', () => {
    expect(formatearPrecision(0.99999)).toBe('100.00%');
  });

  it('recorta valores fuera de rango o no numericos', () => {
    expect(formatearPrecision(-0.2)).toBe('0.00%');
    expect(formatearPrecision(1.5)).toBe('100.00%');
    expect(formatearPrecision(Number.NaN)).toBe('0.00%');
  });
});

describe('formatearScore', () => {
  it('agrupa de a tres con el separador fijo', () => {
    expect(formatearScore(1234567)).toBe(`1${SEPARADOR_MILES}234${SEPARADOR_MILES}567`);
  });

  it('sin separador por debajo de mil', () => {
    expect(formatearScore(0)).toBe('0');
    expect(formatearScore(7)).toBe('7');
    expect(formatearScore(999)).toBe('999');
  });

  it('exactamente mil, y multiplos de tres digitos sin separador inicial', () => {
    expect(formatearScore(1000)).toBe(`1${SEPARADOR_MILES}000`);
    expect(formatearScore(100000)).toBe(`100${SEPARADOR_MILES}000`);
    expect(formatearScore(1000000)).toBe(`1${SEPARADOR_MILES}000${SEPARADOR_MILES}000`);
  });

  it('el separador es U+202F y no depende del locale', () => {
    expect(SEPARADOR_MILES).toBe(' ');
    expect(formatearScore(12345)).not.toContain(',');
    expect(formatearScore(12345)).not.toContain('.');
  });

  it('redondea decimales y protege de valores raros', () => {
    expect(formatearScore(1234.6)).toBe(`1${SEPARADOR_MILES}235`);
    expect(formatearScore(-50)).toBe('0');
    expect(formatearScore(Number.NaN)).toBe('0');
  });
});

describe('nivelDeVida', () => {
  it('ok desde 0.5 inclusive', () => {
    expect(nivelDeVida(1)).toBe('ok');
    expect(nivelDeVida(0.5)).toBe('ok');
  });

  it('baja justo por debajo de 0.5 y hasta 0.2 inclusive', () => {
    expect(nivelDeVida(0.4999)).toBe('baja');
    expect(nivelDeVida(0.3)).toBe('baja');
    expect(nivelDeVida(0.2)).toBe('baja');
  });

  it('critica por debajo de 0.2', () => {
    expect(nivelDeVida(0.1999)).toBe('critica');
    expect(nivelDeVida(0)).toBe('critica');
  });

  it('valores no numericos son criticos', () => {
    expect(nivelDeVida(Number.NaN)).toBe('critica');
  });
});
