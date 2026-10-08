import { describe, expect, it } from 'vitest';
import {
  VOLUMEN_DEFAULT,
  VOLUMEN_EFECTOS_DEFAULT,
  clampVolumen,
  clampVolumenEfectos,
  gananciaDeVolumen,
  guardarVolumen,
  guardarVolumenEfectos,
  leerVolumen,
  leerVolumenEfectos,
} from './volumen.js';

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

describe('volumen de efectos', () => {
  it('sin nada guardado devuelve 0,6, distinto del de la musica', () => {
    expect(VOLUMEN_EFECTOS_DEFAULT).toBe(0.6);
    expect(leerVolumenEfectos(crearStorageFalso())).toBe(0.6);
    expect(leerVolumenEfectos(crearStorageFalso())).not.toBe(leerVolumen(crearStorageFalso()));
  });

  it('guarda y lee el mismo valor, incluido el silencio', () => {
    const storage = crearStorageFalso();
    guardarVolumenEfectos(0.35, storage);
    expect(leerVolumenEfectos(storage)).toBe(0.35);
    guardarVolumenEfectos(0, storage);
    expect(leerVolumenEfectos(storage)).toBe(0);
  });

  it('recorta fuera de rango, al guardar y al leer', () => {
    expect(clampVolumenEfectos(1.5)).toBe(1);
    expect(clampVolumenEfectos(-0.3)).toBe(0);
    const storage = crearStorageFalso();
    guardarVolumenEfectos(1.5, storage);
    expect(storage.getItem('tetra:volumen-efectos')).toBe('1');
    expect(leerVolumenEfectos(crearStorageFalso({ 'tetra:volumen-efectos': '7' }))).toBe(1);
    expect(leerVolumenEfectos(crearStorageFalso({ 'tetra:volumen-efectos': '-2' }))).toBe(0);
  });

  it('un valor corrupto vuelve al default de efectos, no al de la musica', () => {
    for (const basura of ['hola', 'NaN', 'Infinity', '', '   ']) {
      expect(leerVolumenEfectos(crearStorageFalso({ 'tetra:volumen-efectos': basura }))).toBe(0.6);
    }
  });

  it('usa su clave y no pisa el volumen de la musica', () => {
    const storage = crearStorageFalso();
    guardarVolumen(0.2, storage);
    guardarVolumenEfectos(0.9, storage);
    expect(leerVolumen(storage)).toBe(0.2);
    expect(leerVolumenEfectos(storage)).toBe(0.9);
  });
});
