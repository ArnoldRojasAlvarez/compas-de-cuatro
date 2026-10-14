// Tests de T-057 para apps/web/src/offset-local.ts. Mismo doble de Storage que
// offset.test.ts: vitest corre en entorno node, sin `localStorage` real.

import { describe, expect, it } from 'vitest';
import {
  OFFSET_LOCAL_MAX,
  clampOffsetLocal,
  formatearOffsetLocal,
  guardarOffsetLocal,
  leerOffsetLocal,
  migrarOffsetsLocales,
} from './offset-local.js';

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

describe('clampOffsetLocal', () => {
  it('deja pasar un entero dentro de rango', () => {
    expect(clampOffsetLocal(20)).toBe(20);
    expect(clampOffsetLocal(-20)).toBe(-20);
  });

  it('recorta a mas y menos 300', () => {
    expect(OFFSET_LOCAL_MAX).toBe(300);
    expect(clampOffsetLocal(301)).toBe(300);
    expect(clampOffsetLocal(9999)).toBe(300);
    expect(clampOffsetLocal(-301)).toBe(-300);
    expect(clampOffsetLocal(-9999)).toBe(-300);
    expect(clampOffsetLocal(300)).toBe(300);
    expect(clampOffsetLocal(-300)).toBe(-300);
  });

  it('redondea a entero', () => {
    expect(clampOffsetLocal(4.4)).toBe(4);
    expect(clampOffsetLocal(4.6)).toBe(5);
    expect(clampOffsetLocal(-4.6)).toBe(-5);
  });

  it('un valor no valido da 0, y nunca -0', () => {
    expect(clampOffsetLocal(Number.NaN)).toBe(0);
    expect(clampOffsetLocal(Number.POSITIVE_INFINITY)).toBe(0);
    expect(Object.is(clampOffsetLocal(-0.4), 0)).toBe(true);
  });
});

describe('leerOffsetLocal', () => {
  it('sin nada guardado devuelve 0', () => {
    expect(leerOffsetLocal('cancion-a', crearStorageFalso())).toBe(0);
  });

  it('lee de la clave tetra:offset-local:<songId>', () => {
    const storage = crearStorageFalso({ 'tetra:offset-local:cancion-a': '12' });
    expect(leerOffsetLocal('cancion-a', storage)).toBe(12);
  });

  it('un valor corrupto da 0', () => {
    const storage = crearStorageFalso({ 'tetra:offset-local:cancion-a': 'abc' });
    expect(leerOffsetLocal('cancion-a', storage)).toBe(0);
  });

  it('un valor guardado fuera de rango o con decimales se normaliza al leerlo', () => {
    const storage = crearStorageFalso({
      'tetra:offset-local:grande': '5000',
      'tetra:offset-local:decimal': '7.6',
    });
    expect(leerOffsetLocal('grande', storage)).toBe(300);
    expect(leerOffsetLocal('decimal', storage)).toBe(8);
  });
});

describe('guardarOffsetLocal', () => {
  it('ida y vuelta', () => {
    const storage = crearStorageFalso();
    guardarOffsetLocal('cancion-a', 20, storage);
    expect(leerOffsetLocal('cancion-a', storage)).toBe(20);
    guardarOffsetLocal('cancion-a', -7, storage);
    expect(leerOffsetLocal('cancion-a', storage)).toBe(-7);
  });

  it('cada cancion lleva el suyo: guardar uno no toca el de otra', () => {
    const storage = crearStorageFalso();
    guardarOffsetLocal('cancion-a', 20, storage);
    expect(leerOffsetLocal('cancion-b', storage)).toBe(0);
    guardarOffsetLocal('cancion-b', -5, storage);
    expect(leerOffsetLocal('cancion-a', storage)).toBe(20);
    expect(leerOffsetLocal('cancion-b', storage)).toBe(-5);
  });

  it('recorta y redondea al guardar, y devuelve lo que quedo guardado', () => {
    const storage = crearStorageFalso();
    expect(guardarOffsetLocal('a', 1000, storage)).toBe(300);
    expect(leerOffsetLocal('a', storage)).toBe(300);
    expect(guardarOffsetLocal('a', 3.7, storage)).toBe(4);
    expect(storage.getItem('tetra:offset-local:a')).toBe('4');
  });

  it('guardar 0 borra la clave', () => {
    const storage = crearStorageFalso();
    guardarOffsetLocal('a', 9, storage);
    guardarOffsetLocal('a', 0, storage);
    expect(storage.getItem('tetra:offset-local:a')).toBeNull();
    expect(leerOffsetLocal('a', storage)).toBe(0);
  });

  it('no toca el offset global', () => {
    const storage = crearStorageFalso({ 'tetra:offset-usuario': '15' });
    guardarOffsetLocal('a', 9, storage);
    expect(storage.getItem('tetra:offset-usuario')).toBe('15');
  });
});

describe('formatearOffsetLocal', () => {
  it('lleva el signo explicito en los positivos', () => {
    expect(formatearOffsetLocal(3)).toBe('+3 ms');
    expect(formatearOffsetLocal(-12)).toBe('-12 ms');
    expect(formatearOffsetLocal(0)).toBe('0 ms');
  });
});

describe('migrarOffsetsLocales (T-066)', () => {
  const k = (id: string): string => `tetra:offset-local:${id}`;

  it('respeta el offset de la sobreviviente y borra las claves de las absorbidas', () => {
    const storage = crearStorageFalso({ [k('s')]: '12', [k('a')]: '-30', [k('b')]: '5' });
    migrarOffsetsLocales([{ sobreviviente: 's', absorbidas: ['a', 'b'] }], storage);
    expect(leerOffsetLocal('s', storage)).toBe(12);
    expect(storage.getItem(k('a'))).toBeNull();
    expect(storage.getItem(k('b'))).toBeNull();
  });

  it('si la sobreviviente tiene 0, toma el primero distinto de 0 de la absorbida mas nueva', () => {
    // Las absorbidas vienen de la importacion mas nueva a la mas vieja.
    const storage = crearStorageFalso({
      [k('masNueva')]: '0',
      [k('media')]: '-7',
      [k('vieja')]: '9',
    });
    migrarOffsetsLocales(
      [{ sobreviviente: 's', absorbidas: ['masNueva', 'media', 'vieja'] }],
      storage,
    );
    expect(leerOffsetLocal('s', storage)).toBe(-7);
    expect(storage.getItem(k('media'))).toBeNull();
    expect(storage.getItem(k('vieja'))).toBeNull();
  });

  it('sin offsets en ningun lado no crea claves', () => {
    const storage = crearStorageFalso();
    migrarOffsetsLocales([{ sobreviviente: 's', absorbidas: ['a'] }], storage);
    expect(storage.getItem(k('s'))).toBeNull();
  });

  it('sin fusiones no toca nada', () => {
    const storage = crearStorageFalso({ [k('a')]: '4' });
    migrarOffsetsLocales([], storage);
    expect(leerOffsetLocal('a', storage)).toBe(4);
  });
});
