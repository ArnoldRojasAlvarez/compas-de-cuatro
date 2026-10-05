// Tests de T-053 para apariencia.ts. Mismo doble de Storage que skin.test.ts:
// vitest corre en node, sin `localStorage` real.

import { describe, expect, it } from 'vitest';
import {
  ATENUACION_DEFAULT,
  clampAtenuacion,
  formatearPorcentaje,
  guardarAtenuacion,
  guardarVideoDeFondo,
  leerAtenuacion,
  leerVideoDeFondo,
  opacidadDePistaSegunAtenuacion,
} from './apariencia.js';

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
    clear: () => datos.clear(),
    key: () => null,
    get length() {
      return datos.size;
    },
  } as Storage;
}

describe('atenuacion del fondo', () => {
  it('sin nada guardado vale 0.8 (80 %)', () => {
    expect(leerAtenuacion(crearStorageFalso())).toBe(0.8);
    expect(ATENUACION_DEFAULT).toBe(0.8);
  });

  it('guardar y leer devuelve el mismo valor', () => {
    const storage = crearStorageFalso();
    guardarAtenuacion(0.35, storage);
    expect(leerAtenuacion(storage)).toBe(0.35);
  });

  it('el 0 se guarda y se lee como 0, no como "sin valor" (un || en vez de ?? lo rompia)', () => {
    const storage = crearStorageFalso();
    guardarAtenuacion(0, storage);
    expect(leerAtenuacion(storage)).toBe(0);
  });

  it('recorta a 0..1 al guardar y al leer', () => {
    const storage = crearStorageFalso();
    guardarAtenuacion(7, storage);
    expect(leerAtenuacion(storage)).toBe(1);
    expect(leerAtenuacion(crearStorageFalso({ 'tetra:atenuacion-fondo': '-3' }))).toBe(0);
  });

  it('un valor corrupto vuelve al default', () => {
    expect(leerAtenuacion(crearStorageFalso({ 'tetra:atenuacion-fondo': 'mucho' }))).toBe(0.8);
    expect(clampAtenuacion(Number.NaN)).toBe(0.8);
  });
});

describe('video de fondo', () => {
  it('encendido por defecto', () => {
    expect(leerVideoDeFondo(crearStorageFalso())).toBe(true);
  });

  it('apagarlo se recuerda (y volver a encenderlo tambien)', () => {
    const storage = crearStorageFalso();
    guardarVideoDeFondo(false, storage);
    expect(leerVideoDeFondo(storage)).toBe(false);
    guardarVideoDeFondo(true, storage);
    expect(leerVideoDeFondo(storage)).toBe(true);
  });
});

describe('opacidadDePistaSegunAtenuacion', () => {
  it('es decreciente: mas atenuacion, pista mas transparente', () => {
    expect(opacidadDePistaSegunAtenuacion(0)).toBeCloseTo(0.9, 10);
    expect(opacidadDePistaSegunAtenuacion(1)).toBeCloseTo(0.5, 10);
    expect(opacidadDePistaSegunAtenuacion(0.8)).toBeLessThan(opacidadDePistaSegunAtenuacion(0.2));
  });

  it('con el default queda entre la mitad y lo opaco', () => {
    const o = opacidadDePistaSegunAtenuacion(ATENUACION_DEFAULT);
    expect(o).toBeGreaterThan(0.5);
    expect(o).toBeLessThan(0.9);
  });
});

describe('formatearPorcentaje', () => {
  it('redondea a entero con el signo', () => {
    expect(formatearPorcentaje(0.8)).toBe('80%');
    expect(formatearPorcentaje(0.126)).toBe('13%');
    expect(formatearPorcentaje(0)).toBe('0%');
    expect(formatearPorcentaje(1)).toBe('100%');
  });
});
