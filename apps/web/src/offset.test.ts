// Tests de T-007 para apps/web/src/offset.ts.
//
// Vitest corre en entorno node (ver vitest.config.ts): no existe
// `localStorage` real. Se inyecta un doble minimo de Storage, igual que
// cargador-logica.test.ts hace con AudioContext.

import { describe, expect, it } from 'vitest';
import { guardarOffset, leerOffset } from './offset.js';

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

describe('leerOffset', () => {
  it('sin nada guardado, devuelve 0', () => {
    expect(leerOffset(crearStorageFalso())).toBe(0);
  });

  it('lee un valor guardado previamente', () => {
    const storage = crearStorageFalso({ 'tetra:offset-usuario': '-24' });
    expect(leerOffset(storage)).toBe(-24);
  });

  it('un valor corrupto (no numerico) se ignora y devuelve 0', () => {
    const storage = crearStorageFalso({ 'tetra:offset-usuario': 'no-es-un-numero' });
    expect(leerOffset(storage)).toBe(0);
  });
});

describe('guardarOffset', () => {
  it('guardarOffset seguido de leerOffset devuelve el mismo valor (round trip)', () => {
    const storage = crearStorageFalso();

    guardarOffset(18, storage);
    expect(leerOffset(storage)).toBe(18);

    guardarOffset(-7, storage);
    expect(leerOffset(storage)).toBe(-7);
  });

  it('guardar 0 explicitamente se puede volver a leer (no se confunde con "nada guardado")', () => {
    const storage = crearStorageFalso();
    guardarOffset(0, storage);
    expect(leerOffset(storage)).toBe(0);
  });
});
