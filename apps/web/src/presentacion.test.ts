// Tests de T-037: estado persistido del modo presentacion y lista "Antes de
// presentar". Solo la parte sin DOM (vitest corre en entorno node).

import { describe, expect, it } from 'vitest';
import {
  PASOS_PREVIOS,
  guardarChecklist,
  guardarPresentacion,
  leerChecklist,
  leerPresentacion,
} from './presentacion.js';

function crearStorageFalso(inicial: Record<string, string> = {}): Storage {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => {
      datos.set(k, v);
    },
    removeItem: (k: string) => {
      datos.delete(k);
    },
    clear: () => datos.clear(),
    key: () => null,
    get length() {
      return datos.size;
    },
  } as Storage;
}

describe('estado de la presentacion', () => {
  it('por defecto esta apagado', () => {
    expect(leerPresentacion(crearStorageFalso())).toEqual({ activo: false });
  });

  it('guarda y lee el estado, en las dos direcciones', () => {
    const s = crearStorageFalso();
    guardarPresentacion({ activo: true }, s);
    expect(leerPresentacion(s)).toEqual({ activo: true });
    guardarPresentacion({ activo: false }, s);
    expect(leerPresentacion(s)).toEqual({ activo: false });
  });

  it.each(['', 'true', 'si', '2', 'null'])('un valor guardado raro (%j) cuenta como apagado', (crudo) => {
    expect(leerPresentacion(crearStorageFalso({ 'tetra:presentacion': crudo }))).toEqual({
      activo: false,
    });
  });

  it('un almacenamiento que falla no rompe la lectura ni el guardado', () => {
    const roto = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    } as unknown as Storage;
    expect(leerPresentacion(roto)).toEqual({ activo: false });
    expect(() => guardarPresentacion({ activo: true }, roto)).not.toThrow();
  });
});

describe('lista "Antes de presentar"', () => {
  it('trae los tres pasos y empieza sin marcar', () => {
    expect(PASOS_PREVIOS.map((p) => p.id)).toEqual(['offset', 'cancion', 'volumen']);
    expect(leerChecklist(crearStorageFalso())).toEqual({
      offset: false,
      cancion: false,
      volumen: false,
    });
  });

  it('guarda y lee lo marcado', () => {
    const s = crearStorageFalso();
    guardarChecklist({ offset: true, cancion: false, volumen: true }, s);
    expect(leerChecklist(s)).toEqual({ offset: true, cancion: false, volumen: true });
  });

  it('un valor corrupto o un paso que falta no invalida los demas', () => {
    expect(leerChecklist(crearStorageFalso({ 'tetra:checklist-presentacion': '{no es json' }))).toEqual({
      offset: false,
      cancion: false,
      volumen: false,
    });
    const parcial = crearStorageFalso({ 'tetra:checklist-presentacion': '{"offset":true}' });
    expect(leerChecklist(parcial)).toEqual({ offset: true, cancion: false, volumen: false });
    const raro = crearStorageFalso({ 'tetra:checklist-presentacion': '{"offset":"si","volumen":true}' });
    // "si" no es true: solo el booleano verdadero marca el paso.
    expect(leerChecklist(raro)).toEqual({ offset: false, cancion: false, volumen: true });
  });
});
