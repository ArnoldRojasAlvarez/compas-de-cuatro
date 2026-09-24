// Tests de T-012 "Parte C" para apps/web/src/graficos.ts.

import { describe, expect, it } from 'vitest';
import { guardarMostrarFps, leerMostrarFps } from './graficos.js';

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

describe('leerMostrarFps', () => {
  it('sin nada guardado, devuelve true (encendido, como antes de T-012)', () => {
    expect(leerMostrarFps(crearStorageFalso())).toBe(true);
  });

  it('lee un valor apagado guardado previamente', () => {
    const storage = crearStorageFalso({ 'tetra:mostrar-fps': 'false' });
    expect(leerMostrarFps(storage)).toBe(false);
  });

  it('lee un valor encendido guardado explicitamente', () => {
    const storage = crearStorageFalso({ 'tetra:mostrar-fps': 'true' });
    expect(leerMostrarFps(storage)).toBe(true);
  });
});

describe('guardarMostrarFps', () => {
  it('guardarMostrarFps(false) seguido de leerMostrarFps devuelve false (round trip)', () => {
    const storage = crearStorageFalso();
    guardarMostrarFps(false, storage);
    expect(leerMostrarFps(storage)).toBe(false);
  });

  it('guardarMostrarFps(true) seguido de leerMostrarFps devuelve true (round trip)', () => {
    const storage = crearStorageFalso();
    guardarMostrarFps(false, storage);
    guardarMostrarFps(true, storage);
    expect(leerMostrarFps(storage)).toBe(true);
  });
});
