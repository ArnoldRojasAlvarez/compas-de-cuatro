// Tests de T-012 "Parte B" para apps/web/src/keymap.ts.
//
// Vitest corre en entorno node (ver vitest.config.ts): no existe
// `localStorage` real. Se inyecta un doble minimo de Storage, mismo patron
// que offset.test.ts y velocidad.test.ts.

import { describe, expect, it } from 'vitest';
import {
  guardarKeyMap,
  intentarAsignarCodigo,
  keyMapEsValido,
  leerKeyMap,
  type KeyMap,
} from './keymap.js';

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

const MAPA_POR_DEFECTO: KeyMap = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];

// ---------------------------------------------------------------------------
// keyMapEsValido: funcion pura
// ---------------------------------------------------------------------------

describe('keyMapEsValido', () => {
  it('un mapa de cuatro codigos distintos, sin Escape, es valido', () => {
    expect(keyMapEsValido(['KeyD', 'KeyF', 'KeyJ', 'KeyK'])).toBe(true);
  });

  it('rechaza un codigo repetido entre columnas', () => {
    expect(keyMapEsValido(['KeyD', 'KeyD', 'KeyJ', 'KeyK'])).toBe(false);
  });

  it('rechaza Escape en cualquier columna', () => {
    expect(keyMapEsValido(['Escape', 'KeyF', 'KeyJ', 'KeyK'])).toBe(false);
    expect(keyMapEsValido(['KeyD', 'KeyF', 'KeyJ', 'Escape'])).toBe(false);
  });

  it('rechaza un arreglo que no tenga exactamente cuatro elementos', () => {
    expect(keyMapEsValido(['KeyD', 'KeyF', 'KeyJ'])).toBe(false);
    expect(keyMapEsValido(['KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'])).toBe(false);
  });

  it('rechaza un arreglo con un elemento vacio o no string', () => {
    expect(keyMapEsValido(['KeyD', '', 'KeyJ', 'KeyK'])).toBe(false);
    expect(keyMapEsValido(['KeyD', 3 as unknown as string, 'KeyJ', 'KeyK'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// intentarAsignarCodigo: funcion pura
// ---------------------------------------------------------------------------

describe('intentarAsignarCodigo', () => {
  it('asigna un codigo nuevo a una columna libre', () => {
    const resultado = intentarAsignarCodigo(MAPA_POR_DEFECTO, 0, 'KeyQ');
    expect(resultado).toEqual({ permitido: true, mapaNuevo: ['KeyQ', 'KeyF', 'KeyJ', 'KeyK'] });
  });

  it('rechaza Escape, sin importar la columna', () => {
    const resultado = intentarAsignarCodigo(MAPA_POR_DEFECTO, 2, 'Escape');
    expect(resultado).toEqual({ permitido: false, motivo: 'escape-prohibido' });
  });

  it('rechaza un codigo ya asignado a OTRA columna (no intercambia, ver el comentario del archivo)', () => {
    const resultado = intentarAsignarCodigo(MAPA_POR_DEFECTO, 0, 'KeyF'); // KeyF ya es la columna 1
    expect(resultado).toEqual({ permitido: false, motivo: 'codigo-duplicado' });
    // El mapa no cambio: no hubo intercambio.
  });

  it('permite reasignar a una columna el mismo codigo que ya tenia (no cuenta como duplicado)', () => {
    const resultado = intentarAsignarCodigo(MAPA_POR_DEFECTO, 1, 'KeyF');
    expect(resultado).toEqual({ permitido: true, mapaNuevo: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'] });
  });

  it('no muta el mapa que recibe', () => {
    const original: KeyMap = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
    intentarAsignarCodigo(original, 0, 'KeyQ');
    expect(original).toEqual(['KeyD', 'KeyF', 'KeyJ', 'KeyK']);
  });
});

// ---------------------------------------------------------------------------
// leerKeyMap / guardarKeyMap: persistencia
// ---------------------------------------------------------------------------

describe('leerKeyMap', () => {
  it('sin nada guardado, devuelve el mapa por defecto (KeyD, KeyF, KeyJ, KeyK)', () => {
    expect(leerKeyMap(crearStorageFalso())).toEqual(MAPA_POR_DEFECTO);
  });

  it('lee un mapa guardado previamente', () => {
    const storage = crearStorageFalso({
      'tetra:keymap-usuario': JSON.stringify(['KeyQ', 'KeyW', 'KeyE', 'KeyR']),
    });
    expect(leerKeyMap(storage)).toEqual(['KeyQ', 'KeyW', 'KeyE', 'KeyR']);
  });

  it('JSON invalido cae al mapa por defecto', () => {
    const storage = crearStorageFalso({ 'tetra:keymap-usuario': 'no-es-json{' });
    expect(leerKeyMap(storage)).toEqual(MAPA_POR_DEFECTO);
  });

  it('un mapa guardado con un duplicado (editado a mano) cae al mapa por defecto', () => {
    const storage = crearStorageFalso({
      'tetra:keymap-usuario': JSON.stringify(['KeyD', 'KeyD', 'KeyJ', 'KeyK']),
    });
    expect(leerKeyMap(storage)).toEqual(MAPA_POR_DEFECTO);
  });

  it('un mapa guardado con Escape (editado a mano) cae al mapa por defecto', () => {
    const storage = crearStorageFalso({
      'tetra:keymap-usuario': JSON.stringify(['Escape', 'KeyF', 'KeyJ', 'KeyK']),
    });
    expect(leerKeyMap(storage)).toEqual(MAPA_POR_DEFECTO);
  });
});

describe('guardarKeyMap', () => {
  it('guardarKeyMap seguido de leerKeyMap devuelve el mismo mapa (round trip)', () => {
    const storage = crearStorageFalso();
    guardarKeyMap(['KeyQ', 'KeyW', 'KeyE', 'KeyR'], storage);
    expect(leerKeyMap(storage)).toEqual(['KeyQ', 'KeyW', 'KeyE', 'KeyR']);
  });
});
