// Tests de T-053 para skin-activa-logica.ts.

import { describe, expect, it } from 'vitest';
import {
  guardarSeleccion,
  leerSeleccion,
  parsearSeleccion,
  serializarSeleccion,
  seleccionesIguales,
  type CatalogoDePropias,
} from './skin-activa-logica.js';

const CATALOGO: CatalogoDePropias = {
  ids: ['tetra', 'barras', 'circulos', 'diamantes'],
  porDefecto: 'tetra',
};

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

describe('parsearSeleccion', () => {
  it('sin nada guardado es la propia por defecto (tetra)', () => {
    expect(parsearSeleccion(null, CATALOGO)).toEqual({ tipo: 'propia', id: 'tetra' });
    expect(parsearSeleccion('', CATALOGO)).toEqual({ tipo: 'propia', id: 'tetra' });
  });

  it('"propia:<id>" es una skin propia', () => {
    expect(parsearSeleccion('propia:barras', CATALOGO)).toEqual({ tipo: 'propia', id: 'barras' });
    expect(parsearSeleccion('propia:diamantes', CATALOGO)).toEqual({
      tipo: 'propia',
      id: 'diamantes',
    });
  });

  it('una propia que no existe cae a la por defecto, no a una .osk con ese nombre', () => {
    expect(parsearSeleccion('propia:fantasma', CATALOGO)).toEqual({ tipo: 'propia', id: 'tetra' });
    expect(parsearSeleccion('propia:', CATALOGO)).toEqual({ tipo: 'propia', id: 'tetra' });
  });

  it('cualquier otro valor es el id de una .osk importada (formato de T-009)', () => {
    const uuid = '3f2b8c1e-5d4a-4a7b-9c1d-2e6f7a8b9c0d';
    expect(parsearSeleccion(uuid, CATALOGO)).toEqual({ tipo: 'osk', id: uuid });
  });

  it('respeta el default del catalogo (no esta cableado a "tetra")', () => {
    const otro: CatalogoDePropias = { ids: ['barras', 'tetra'], porDefecto: 'barras' };
    expect(parsearSeleccion(null, otro)).toEqual({ tipo: 'propia', id: 'barras' });
  });
});

describe('serializarSeleccion', () => {
  it('una propia lleva el prefijo y una .osk va tal cual', () => {
    expect(serializarSeleccion({ tipo: 'propia', id: 'circulos' })).toBe('propia:circulos');
    expect(serializarSeleccion({ tipo: 'osk', id: 'abc-123' })).toBe('abc-123');
  });

  it('serializar y parsear es una ida y vuelta, para cada tipo', () => {
    const casos = [
      { tipo: 'propia', id: 'tetra' },
      { tipo: 'propia', id: 'diamantes' },
      { tipo: 'osk', id: '3f2b8c1e-5d4a-4a7b-9c1d-2e6f7a8b9c0d' },
    ] as const;
    for (const caso of casos) {
      expect(parsearSeleccion(serializarSeleccion(caso), CATALOGO)).toEqual(caso);
    }
  });
});

describe('leerSeleccion y guardarSeleccion', () => {
  it('sin nada guardado lee la propia por defecto', () => {
    expect(leerSeleccion(CATALOGO, crearStorageFalso())).toEqual({ tipo: 'propia', id: 'tetra' });
  });

  it('lo guardado se recuerda (se guarda en la misma clave que usa el song select)', () => {
    const storage = crearStorageFalso();
    guardarSeleccion({ tipo: 'propia', id: 'barras' }, storage);
    expect(storage.getItem('tetra:skin-activa')).toBe('propia:barras');
    expect(leerSeleccion(CATALOGO, storage)).toEqual({ tipo: 'propia', id: 'barras' });

    guardarSeleccion({ tipo: 'osk', id: 'mi-osk' }, storage);
    expect(leerSeleccion(CATALOGO, storage)).toEqual({ tipo: 'osk', id: 'mi-osk' });
  });

  it('un guardado de antes de T-053 (un id de .osk suelto) se sigue leyendo como esa .osk', () => {
    const storage = crearStorageFalso({ 'tetra:skin-activa': 'skin-123' });
    expect(leerSeleccion(CATALOGO, storage)).toEqual({ tipo: 'osk', id: 'skin-123' });
  });
});

describe('seleccionesIguales', () => {
  it('compara tipo e id (una propia y una .osk con el mismo texto no son la misma)', () => {
    expect(
      seleccionesIguales({ tipo: 'propia', id: 'tetra' }, { tipo: 'propia', id: 'tetra' }),
    ).toBe(true);
    expect(
      seleccionesIguales({ tipo: 'propia', id: 'tetra' }, { tipo: 'propia', id: 'barras' }),
    ).toBe(false);
    expect(seleccionesIguales({ tipo: 'propia', id: 'tetra' }, { tipo: 'osk', id: 'tetra' })).toBe(
      false,
    );
  });
});
