// Tests de apps/web/src/tiempo-jugado.ts. Mismo doble de Storage que
// velocidad.test.ts: vitest corre en entorno node, sin `localStorage` real.

import { describe, expect, it } from 'vitest';
import {
  formatearHora,
  formatearTiempoJugado,
  leerTiempoJugado,
  sumarTiempoJugado,
} from './tiempo-jugado.js';

function crearStorageFalso(inicial: Record<string, string> = {}): Storage {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (clave: string) => datos.get(clave) ?? null,
    setItem: (clave: string, valor: string) => {
      datos.set(clave, valor);
    },
    removeItem: (clave: string) => {
      datos.delete(clave);
    },
    clear: () => {
      datos.clear();
    },
    key: () => null,
    get length() {
      return datos.size;
    },
  } as Storage;
}

const CLAVE = 'tetra:tiempo-jugado-ms';

describe('leerTiempoJugado', () => {
  it('devuelve 0 si no hay nada guardado', () => {
    expect(leerTiempoJugado(crearStorageFalso())).toBe(0);
  });

  it('lee el total guardado', () => {
    expect(leerTiempoJugado(crearStorageFalso({ [CLAVE]: '90000' }))).toBe(90000);
  });

  it.each(['abc', '-5', 'NaN', 'Infinity', ''])('un valor corrupto (%j) vuelve a 0', (crudo) => {
    expect(leerTiempoJugado(crearStorageFalso({ [CLAVE]: crudo }))).toBe(0);
  });
});

describe('sumarTiempoJugado', () => {
  it('acumula entre llamadas y persiste', () => {
    const s = crearStorageFalso();
    expect(sumarTiempoJugado(60_000, s)).toBe(60_000);
    expect(sumarTiempoJugado(30_500, s)).toBe(90_500);
    expect(leerTiempoJugado(s)).toBe(90_500);
  });

  it.each([-1500, 0, NaN, Infinity])('ignora %s (lead-in o valor invalido)', (ms) => {
    const s = crearStorageFalso({ [CLAVE]: '1000' });
    expect(sumarTiempoJugado(ms, s)).toBe(1000);
    expect(leerTiempoJugado(s)).toBe(1000);
  });
});

describe('formatearTiempoJugado', () => {
  it.each([
    [0, '0 min'],
    [59_999, '0 min'],
    [60_000, '1 min'],
    [42 * 60_000, '42 min'],
    [65 * 60_000, '1 h 05 min'],
    [750 * 60_000, '12 h 30 min'],
    [-5000, '0 min'],
  ])('%d ms -> %s', (ms, esperado) => {
    expect(formatearTiempoJugado(ms)).toBe(esperado);
  });
});

describe('formatearHora', () => {
  it('rellena con ceros a dos digitos', () => {
    expect(formatearHora(new Date(2026, 9, 3, 7, 5))).toBe('07:05');
    expect(formatearHora(new Date(2026, 9, 3, 23, 59))).toBe('23:59');
  });
});
