import { describe, expect, it } from 'vitest';
import type { DifficultyResult, SkillVector } from '@tetra/core';
import {
  CLAVE_ALMACEN_CALIBRACION,
  cargarAnotaciones,
  construirExportacion,
  guardarAnotaciones,
  parsearSr,
  resumirCalibracion,
  type AlmacenTexto,
  type FilaCalibracion,
} from './calibracion-logica.js';

function almacenEnMemoria(): AlmacenTexto & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => void datos.set(k, v),
  };
}

const VECTOR: SkillVector = {
  stream: 1,
  jumpstream: 2,
  handstream: 0,
  stamina: 0,
  jackspeed: 0,
  chordjack: 0,
  technical: 0,
};

function fila(
  clave: string,
  overall: number | undefined,
  sr: number | null,
  cancionId = 'c1',
): FilaCalibracion {
  const resultado: DifficultyResult | undefined =
    overall === undefined ? undefined : { vector: VECTOR, overall };
  return {
    clave,
    cancionId,
    titulo: 'T',
    artista: 'A',
    dificultad: clave,
    resultado,
    sr,
    notas: '',
  };
}

describe('parsearSr', () => {
  it('acepta coma decimal y rechaza vacio, basura y no positivos', () => {
    expect(parsearSr('5,32')).toBeCloseTo(5.32);
    expect(parsearSr(' 4.5 ')).toBeCloseTo(4.5);
    expect(parsearSr('')).toBeNull();
    expect(parsearSr('abc')).toBeNull();
    expect(parsearSr('0')).toBeNull();
    expect(parsearSr('-2')).toBeNull();
  });
});

describe('persistencia de anotaciones', () => {
  it('lo guardado se recupera igual (persiste al recargar)', () => {
    const almacen = almacenEnMemoria();
    guardarAnotaciones(almacen, {
      h1: { sr: 5.2, notas: 'jacks puro' },
      h2: { sr: null, notas: '' },
    });
    // Un almacen nuevo sobre los mismos datos simula recargar la pagina.
    expect(cargarAnotaciones(almacen)).toEqual({
      h1: { sr: 5.2, notas: 'jacks puro' },
      h2: { sr: null, notas: '' },
    });
  });

  it('tolera JSON roto, entradas malformadas y SR invalidos', () => {
    const almacen = almacenEnMemoria();
    almacen.setItem(CLAVE_ALMACEN_CALIBRACION, '{no es json');
    expect(cargarAnotaciones(almacen)).toEqual({});
    almacen.setItem(
      CLAVE_ALMACEN_CALIBRACION,
      JSON.stringify({ a: 5, b: { sr: -1, notas: 3 } }),
    );
    expect(cargarAnotaciones(almacen)).toEqual({ b: { sr: null, notas: '' } });
  });

  it('si el almacenamiento falla, guardar devuelve false en vez de lanzar', () => {
    const roto: AlmacenTexto = {
      getItem: () => null,
      setItem: () => {
        throw new Error('cuota');
      },
    };
    expect(guardarAnotaciones(roto, {})).toBe(false);
  });
});

describe('resumirCalibracion', () => {
  it('solo cuentan las filas con resultado y SR; ordena las peores por diferencia de rango', () => {
    const filas = [
      fila('a', 1, 1),
      fila('b', 2, 2),
      fila('c', 3, 6), // Tetra la ve 3ra, osu! la ve 4ta
      fila('d', 4, 3), // Tetra 4ta, osu! 3ra
      fila('sin-sr', 5, null),
      fila('sin-calcular', undefined, 7),
    ];
    const r = resumirCalibracion(filas);
    expect(r.pares).toBe(4);
    // Rangos Tetra 1 2 3 4; osu 1 2 4 3. d^2 suma 2: rho = 1 - 6*2/60 = 0.8.
    expect(r.spearman).toBeCloseTo(0.8, 12);
    expect(
      r.peores
        .map((d) => d.fila.clave)
        .slice(0, 2)
        .sort(),
    ).toEqual(['c', 'd']);
    expect(r.peores.map((d) => Math.abs(d.diferenciaDeRango))).toEqual([1, 1, 0, 0]);
    expect(r.ajuste).not.toBeNull();
  });

  it('limita a diez y calcula el Spearman por set con al menos 3 pares', () => {
    const filas: FilaCalibracion[] = [];
    for (let i = 1; i <= 12; i += 1) filas.push(fila(`m${i}`, i, i, 'setA'));
    filas.push(fila('x', 1, 2, 'setB'), fila('y', 2, 3, 'setB'));
    const r = resumirCalibracion(filas);
    expect(r.peores).toHaveLength(10);
    expect(r.porSet).toHaveLength(1);
    expect(r.porSet[0]).toMatchObject({ cancionId: 'setA', n: 12 });
    expect(r.porSet[0]!.rho).toBeCloseTo(1, 12);
  });

  it('sin datos no inventa nada', () => {
    const r = resumirCalibracion([fila('a', 1, null)]);
    expect(r).toMatchObject({
      pares: 0,
      spearman: null,
      ajuste: null,
      peores: [],
      porSet: [],
    });
  });
});

describe('construirExportacion', () => {
  it('incluye el vector completo en las peores y todas las filas', () => {
    const filas = [fila('a', 1, 1), fila('b', 2, 5), fila('c', 3, 2)];
    const json = JSON.parse(
      JSON.stringify(
        construirExportacion(filas, {
          versionModelo: 1,
          modeloCalibrado: false,
          parametros: { x: 1 },
          generado: '2026-01-01T00:00:00.000Z',
        }),
      ),
    );
    expect(json.formato).toBe('tetra-calibracion-v1');
    expect(json.filas).toHaveLength(3);
    expect(json.peoresDiscrepancias[0].vector).toEqual(VECTOR);
    expect(json.resumen.spearman).toBeCloseTo(0.5, 12);
  });
});
