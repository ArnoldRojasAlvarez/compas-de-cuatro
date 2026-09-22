// Tests de T-008 para apps/web/src/velocidad.ts. Mismo doble de Storage que
// offset.test.ts (ver ese archivo): vitest corre en entorno node, sin
// `localStorage` real.

import { describe, expect, it } from 'vitest';
import {
  VELOCIDAD_DEFAULT,
  VELOCIDAD_MAX,
  VELOCIDAD_MIN,
  clampVelocidad,
  guardarVelocidad,
  leerVelocidad,
  velocidadAScrollDuration,
} from './velocidad.js';

function crearStorageFalso(inicial: Record<string, string> = {}): Storage {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (clave: string) => (datos.has(clave) ? (datos.get(clave) ?? null) : null),
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

describe('clampVelocidad', () => {
  it('deja pasar un entero ya dentro de rango', () => {
    expect(clampVelocidad(5)).toBe(5);
  });

  it('recorta por debajo de VELOCIDAD_MIN', () => {
    expect(clampVelocidad(0)).toBe(VELOCIDAD_MIN);
    expect(clampVelocidad(-100)).toBe(VELOCIDAD_MIN);
  });

  it('recorta por encima de VELOCIDAD_MAX', () => {
    expect(clampVelocidad(999)).toBe(VELOCIDAD_MAX);
  });

  it('redondea valores no enteros', () => {
    expect(clampVelocidad(4.4)).toBe(4);
    expect(clampVelocidad(4.6)).toBe(5);
  });
});

describe('velocidadAScrollDuration', () => {
  it('la velocidad por defecto da el scrollDuration que tenia el juego antes de T-008 (1200ms)', () => {
    expect(velocidadAScrollDuration(VELOCIDAD_DEFAULT)).toBe(1200);
  });

  it('mas velocidad da MENOS ms (cae mas rapido)', () => {
    const msLento = velocidadAScrollDuration(2);
    const msRapido = velocidadAScrollDuration(8);
    expect(msRapido).toBeLessThan(msLento);
  });

  it('la velocidad minima da el scrollDuration mas alto (el mas lento)', () => {
    const msEnMinimo = velocidadAScrollDuration(VELOCIDAD_MIN);
    for (let v = VELOCIDAD_MIN + 1; v <= VELOCIDAD_MAX; v++) {
      expect(velocidadAScrollDuration(v)).toBeLessThan(msEnMinimo);
    }
  });

  it('la velocidad maxima da el scrollDuration mas bajo (el mas rapido)', () => {
    const msEnMaximo = velocidadAScrollDuration(VELOCIDAD_MAX);
    for (let v = VELOCIDAD_MIN; v < VELOCIDAD_MAX; v++) {
      expect(velocidadAScrollDuration(v)).toBeGreaterThan(msEnMaximo);
    }
  });

  it('valores fuera de rango se recortan antes de convertir', () => {
    expect(velocidadAScrollDuration(999)).toBe(velocidadAScrollDuration(VELOCIDAD_MAX));
    expect(velocidadAScrollDuration(-5)).toBe(velocidadAScrollDuration(VELOCIDAD_MIN));
  });
});

describe('leerVelocidad', () => {
  it('sin nada guardado, devuelve VELOCIDAD_DEFAULT', () => {
    expect(leerVelocidad(crearStorageFalso())).toBe(VELOCIDAD_DEFAULT);
  });

  it('lee un valor guardado previamente', () => {
    const storage = crearStorageFalso({ 'tetra:velocidad-usuario': '7' });
    expect(leerVelocidad(storage)).toBe(7);
  });

  it('un valor corrupto (no numerico) se ignora y devuelve VELOCIDAD_DEFAULT', () => {
    const storage = crearStorageFalso({ 'tetra:velocidad-usuario': 'no-es-un-numero' });
    expect(leerVelocidad(storage)).toBe(VELOCIDAD_DEFAULT);
  });

  it('un valor guardado fuera de rango se recorta al leerlo', () => {
    const storage = crearStorageFalso({ 'tetra:velocidad-usuario': '999' });
    expect(leerVelocidad(storage)).toBe(VELOCIDAD_MAX);
  });
});

describe('guardarVelocidad', () => {
  it('guardarVelocidad seguido de leerVelocidad devuelve el mismo valor (round trip)', () => {
    const storage = crearStorageFalso();

    guardarVelocidad(9, storage);
    expect(leerVelocidad(storage)).toBe(9);

    guardarVelocidad(2, storage);
    expect(leerVelocidad(storage)).toBe(2);
  });

  it('guardar un valor fuera de rango lo recorta antes de guardarlo', () => {
    const storage = crearStorageFalso();
    guardarVelocidad(500, storage);
    expect(leerVelocidad(storage)).toBe(VELOCIDAD_MAX);
  });
});
