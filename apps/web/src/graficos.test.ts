// Tests de T-012 "Parte C" para apps/web/src/graficos.ts.

import { describe, expect, it } from 'vitest';
import {
  guardarBajaLatencia,
  guardarMostrarFps,
  leerBajaLatencia,
  leerMostrarFps,
} from './graficos.js';

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

describe('dibujo de baja latencia (T-059)', () => {
  it('sin nada guardado esta apagado: puede mostrar cortes en la imagen y se prueba antes de dejarlo', () => {
    expect(leerBajaLatencia(crearStorageFalso())).toBe(false);
  });

  it('un valor guardado que no es "true" cuenta como apagado', () => {
    expect(leerBajaLatencia(crearStorageFalso({ 'tetra:dibujo-baja-latencia': 'si' }))).toBe(false);
    expect(leerBajaLatencia(crearStorageFalso({ 'tetra:dibujo-baja-latencia': '' }))).toBe(false);
  });

  it('guardar y leer vuelve igual (round trip) y es independiente del contador de fps', () => {
    const storage = crearStorageFalso();
    guardarBajaLatencia(true, storage);
    expect(leerBajaLatencia(storage)).toBe(true);
    expect(leerMostrarFps(storage)).toBe(true);
    guardarBajaLatencia(false, storage);
    expect(leerBajaLatencia(storage)).toBe(false);
  });
});
