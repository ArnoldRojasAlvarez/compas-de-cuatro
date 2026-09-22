// Tests de T-009 para apps/web/src/skin.ts. Mismo doble de Storage que
// offset.test.ts (ver ese archivo): vitest corre en entorno node, sin
// `localStorage` real.

import { describe, expect, it } from 'vitest';
import { guardarSkinActiva, leerSkinActiva } from './skin.js';

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

describe('leerSkinActiva', () => {
  it('sin nada guardado, devuelve null (sin skin, rectangulos)', () => {
    expect(leerSkinActiva(crearStorageFalso())).toBeNull();
  });

  it('lee un id guardado previamente', () => {
    const storage = crearStorageFalso({ 'tetra:skin-activa': 'skin-123' });
    expect(leerSkinActiva(storage)).toBe('skin-123');
  });
});

describe('guardarSkinActiva', () => {
  it('guardarSkinActiva seguido de leerSkinActiva devuelve el mismo id (round trip, "se recuerda al recargar")', () => {
    const storage = crearStorageFalso();

    guardarSkinActiva('skin-abc', storage);
    expect(leerSkinActiva(storage)).toBe('skin-abc');

    guardarSkinActiva('skin-xyz', storage);
    expect(leerSkinActiva(storage)).toBe('skin-xyz');
  });

  it('guardar null vuelve a "sin skin" (borra lo guardado, no lo confunde con un id)', () => {
    const storage = crearStorageFalso({ 'tetra:skin-activa': 'skin-123' });
    guardarSkinActiva(null, storage);
    expect(leerSkinActiva(storage)).toBeNull();
  });
});
