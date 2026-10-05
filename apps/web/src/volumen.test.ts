import { describe, expect, it } from 'vitest';
import { VOLUMEN_DEFAULT, clampVolumen, gananciaDeVolumen, guardarVolumen, leerVolumen } from './volumen.js';

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

describe('volumen', () => {
  it('sin nada guardado devuelve el default', () => {
    expect(leerVolumen(crearStorageFalso())).toBe(VOLUMEN_DEFAULT);
  });

  it('guarda y lee el mismo valor', () => {
    const storage = crearStorageFalso();
    guardarVolumen(0.35, storage);
    expect(leerVolumen(storage)).toBe(0.35);
  });

  it('recorta fuera de rango y descarta basura', () => {
    expect(clampVolumen(1.7)).toBe(1);
    expect(clampVolumen(-2)).toBe(0);
    expect(leerVolumen(crearStorageFalso({ 'tetra:volumen-musica': 'hola' }))).toBe(VOLUMEN_DEFAULT);
  });

  it('la ganancia es cuadratica: la mitad del control es un cuarto de ganancia', () => {
    expect(gananciaDeVolumen(0)).toBe(0);
    expect(gananciaDeVolumen(1)).toBe(1);
    expect(gananciaDeVolumen(0.5)).toBeCloseTo(0.25);
  });
});
