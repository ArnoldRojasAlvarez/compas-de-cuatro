// Tests de la logica del minimapa del mapeador (T-046).

import { describe, expect, it } from 'vitest';
import type { Column, Grilla, Note } from '@tetra/core';
import {
  huecosSinNotas,
  marcasDeCompas,
  resumirParaMinimapa,
  tiempoDeXMinimapa,
  xDeTiempoMinimapa,
} from './mapeador-logica.js';

const tap = (time: number, column: Column = 0): Note => ({ kind: 'tap', time, column });
const larga = (time: number, endTime: number, column: Column = 0): Note => ({
  kind: 'hold',
  time,
  endTime,
  column,
});

/** Ninguna cubeta tiene un valor que no sea un numero finito. */
function sinNaN(cubetas: ReturnType<typeof resumirParaMinimapa>): boolean {
  return cubetas.every(
    (c) => Number.isFinite(c.densidadNotas) && Number.isFinite(c.energia) && c.energia >= 0 && c.energia <= 1,
  );
}

describe('resumirParaMinimapa', () => {
  const picos = new Float32Array(1000).fill(0.5); // 1000 cubetas de 60 ms = 60 s

  it('con 0 notas solo hay energia: densidad 0, sin notas y sin NaN', () => {
    const r = resumirParaMinimapa([], picos, 60, 60_000, 100);
    expect(r).toHaveLength(100);
    expect(r.every((c) => c.densidadNotas === 0 && !c.hayNotas)).toBe(true);
    expect(r.every((c) => c.energia === 1)).toBe(true); // todo parejo: todo es el maximo
    expect(sinNaN(r)).toBe(true);
  });

  it('asigna cada nota a su cubeta por TIEMPO, aunque esten todas agrupadas en un extremo', () => {
    // 10 notas en los primeros 50 ms de 60 s repartidos en 100 cubetas de 600 ms.
    const notas = Array.from({ length: 10 }, (_, i) => tap(i * 5, (i % 4) as Column));
    const r = resumirParaMinimapa(notas, picos, 60, 60_000, 100);
    expect(r[0]!.densidadNotas).toBe(10);
    expect(r[0]!.hayNotas).toBe(true);
    expect(r.slice(1).every((c) => c.densidadNotas === 0 && !c.hayNotas)).toBe(true);
    // Un reparto por indice de nota dejaria notas en el resto de la franja.
  });

  it('notas en el otro extremo caen en la ultima cubeta, incluida una justo en la duracion', () => {
    const r = resumirParaMinimapa([tap(59_990), tap(60_000), tap(70_000)], picos, 60, 60_000, 100);
    expect(r[99]!.densidadNotas).toBe(3);
    expect(r.slice(0, 99).every((c) => c.densidadNotas === 0)).toBe(true);
  });

  it('una larga cuenta en la cubeta donde empieza', () => {
    const r = resumirParaMinimapa([larga(1000, 30_000)], picos, 60, 60_000, 100);
    expect(r.filter((c) => c.hayNotas)).toHaveLength(1);
    expect(r[1]!.densidadNotas).toBe(1);
  });

  it('el total de la densidad es la cantidad de notas', () => {
    const notas = Array.from({ length: 237 }, (_, i) => tap(i * 250, (i % 4) as Column));
    const r = resumirParaMinimapa(notas, picos, 60, 60_000, 77);
    expect(r.reduce((s, c) => s + c.densidadNotas, 0)).toBe(237);
  });

  it('la energia sigue los pasajes fuertes y suaves y se normaliza por el mas fuerte', () => {
    // Mitad de la cancion con picos 1 y mitad con 0.25, repartida en 2 cubetas.
    const p = new Float32Array(100);
    p.fill(1, 0, 50);
    p.fill(0.25, 50);
    const r = resumirParaMinimapa([], p, 10, 1000, 2);
    expect(r[0]!.energia).toBeCloseTo(1, 6);
    expect(r[1]!.energia).toBeCloseTo(0.25, 6);
  });

  it('la energia es el promedio, no el maximo, de los picos de la cubeta', () => {
    // Cubeta 0: un pico de 1 entre ceros (promedio 0.25). Cubeta 1: todo en 0.5.
    const p = new Float32Array([1, 0, 0, 0, 0.5, 0.5, 0.5, 0.5]);
    const r = resumirParaMinimapa([], p, 10, 80, 2);
    expect(r[0]!.energia).toBeCloseTo(0.5, 6);
    expect(r[1]!.energia).toBeCloseTo(1, 6);
  });

  it('con mas ancho que cubetas de audio no hay NaN y cada cubeta toma el pico que le toca', () => {
    const p = new Float32Array([0.2, 1, 0.4, 0.8]);
    const r = resumirParaMinimapa([tap(10)], p, 100, 400, 16);
    expect(r).toHaveLength(16);
    expect(sinNaN(r)).toBe(true);
    // (Float32Array: 0.2 y 0.8 no son exactos, se compara con tolerancia.)
    expect(r.slice(0, 4).every((c) => Math.abs(c.energia - 0.2) < 1e-6)).toBe(true);
    expect(r.slice(4, 8).every((c) => c.energia === 1)).toBe(true);
    expect(r.slice(8, 12).every((c) => Math.abs(c.energia - 0.4) < 1e-6)).toBe(true);
    expect(r.slice(12).every((c) => Math.abs(c.energia - 0.8) < 1e-6)).toBe(true);
  });

  it('si el audio es mas corto que la duracion, lo que falta vale 0', () => {
    const p = new Float32Array([1, 1]);
    const r = resumirParaMinimapa([], p, 100, 1000, 10);
    expect(r.slice(0, 2).every((c) => c.energia === 1)).toBe(true);
    expect(r.slice(2).every((c) => c.energia === 0)).toBe(true);
    expect(sinNaN(r)).toBe(true);
  });

  it('sin picos o con picos en silencio la energia es 0 y no hay NaN', () => {
    expect(sinNaN(resumirParaMinimapa([tap(100)], new Float32Array(0), 5, 1000, 10))).toBe(true);
    const mudo = resumirParaMinimapa([], new Float32Array(200), 5, 1000, 10);
    expect(mudo.every((c) => c.energia === 0)).toBe(true);
    const sinPaso = resumirParaMinimapa([], picos, 0, 1000, 10);
    expect(sinPaso.every((c) => c.energia === 0)).toBe(true);
  });

  it('duracion 0 o negativa: cubetas vacias sin NaN; ancho 0: lista vacia', () => {
    const r = resumirParaMinimapa([tap(0), tap(500)], picos, 60, 0, 8);
    expect(r).toHaveLength(8);
    expect(r.every((c) => c.densidadNotas === 0 && c.energia === 0 && !c.hayNotas)).toBe(true);
    expect(resumirParaMinimapa([tap(0)], picos, 60, -5, 8)).toHaveLength(8);
    expect(resumirParaMinimapa([tap(0)], picos, 60, 1000, 0)).toEqual([]);
  });

  it('ignora notas con tiempo que no es un numero y recorta las anteriores a 0', () => {
    const r = resumirParaMinimapa([tap(Number.NaN), tap(-50)], picos, 60, 1000, 4);
    expect(r.reduce((s, c) => s + c.densidadNotas, 0)).toBe(1);
    expect(r[0]!.densidadNotas).toBe(1);
  });
});

describe('huecosSinNotas', () => {
  const ocho = 16_000; // 8 compases a 120 BPM

  it('sin notas no marca nada (todo esta por mapear, no hay huecos)', () => {
    expect(huecosSinNotas([], 120_000, ocho)).toEqual([]);
  });

  it('marca los tramos de mas de 8 compases: al principio, en el medio y al final', () => {
    const notas = [tap(20_000), tap(21_000), tap(60_000), tap(61_000)];
    expect(huecosSinNotas(notas, 100_000, ocho)).toEqual([
      { desde: 0, hasta: 20_000 },
      { desde: 21_000, hasta: 60_000 },
      { desde: 61_000, hasta: 100_000 },
    ]);
  });

  it('exactamente 8 compases no es un hueco: tiene que ser mas', () => {
    expect(huecosSinNotas([tap(ocho), tap(ocho * 2)], ocho * 2, ocho)).toEqual([]);
    expect(huecosSinNotas([tap(ocho + 1), tap(ocho * 2)], ocho * 2, ocho)).toEqual([
      { desde: 0, hasta: ocho + 1 },
    ]);
  });

  it('una larga sostenida cuenta como ocupado hasta su fin', () => {
    const notas = [tap(1000), larga(2000, 40_000, 1), tap(50_000, 2)];
    // Entre 2000 y 50000 solo hay 10 s libres (de 40000 a 50000): no llega a 8 compases.
    expect(huecosSinNotas(notas, 52_000, ocho)).toEqual([]);
    expect(huecosSinNotas([larga(1000, 40_000), tap(60_000)], 60_000, ocho)).toEqual([
      { desde: 40_000, hasta: 60_000 },
    ]);
  });

  it('no depende del orden de las notas ni las muta', () => {
    const notas = [tap(60_000), tap(1000)];
    expect(huecosSinNotas(notas, 61_000, ocho)).toEqual([{ desde: 1000, hasta: 60_000 }]);
    expect(notas[0]!.time).toBe(60_000);
  });

  it('duracion 0 no marca nada', () => {
    expect(huecosSinNotas([tap(1000)], 0, ocho)).toEqual([]);
  });
});

describe('marcasDeCompas', () => {
  const g: Grilla = { bpm: 120, offsetMs: 0, divisor: 4 };

  it('una marca cada 8 compases (16 s a 120 BPM) numerada desde el compas 1', () => {
    expect(marcasDeCompas(g, 50_000)).toEqual([
      { time: 0, compas: 1 },
      { time: 16_000, compas: 9 },
      { time: 32_000, compas: 17 },
      { time: 48_000, compas: 25 },
    ]);
  });

  it('parte del offset de la grilla y no marca antes de 0', () => {
    expect(marcasDeCompas({ ...g, offsetMs: 3000 }, 40_000).map((m) => m.time)).toEqual([3000, 19_000, 35_000]);
    // Con un offset negativo el primer compas 1 cae antes de la cancion: la primera marca es el compas 9.
    expect(marcasDeCompas({ ...g, offsetMs: -100 }, 20_000)).toEqual([{ time: 15_900, compas: 9 }]);
  });

  it('un BPM o duracion que no sirven dan una lista vacia', () => {
    expect(marcasDeCompas({ ...g, bpm: 0 }, 50_000)).toEqual([]);
    expect(marcasDeCompas({ ...g, offsetMs: Number.NaN }, 50_000)).toEqual([]);
    expect(marcasDeCompas(g, 0)).toEqual([]);
  });
});

describe('tiempo <-> x en el minimapa', () => {
  it('ida y vuelta, con el error de una cubeta como maximo', () => {
    const ancho = 640;
    const duracion = 187_321;
    for (const x of [0, 1, 100, 319.5, 639, 640]) {
      const t = tiempoDeXMinimapa(x, ancho, duracion);
      expect(Math.abs(xDeTiempoMinimapa(t, ancho, duracion) - x)).toBeLessThan(1e-9);
    }
    const cubeta = duracion / ancho;
    expect(Math.abs(tiempoDeXMinimapa(320, ancho, duracion) - duracion / 2)).toBeLessThan(cubeta);
  });

  it('recorta fuera de la franja y no revienta sin ancho ni duracion', () => {
    expect(tiempoDeXMinimapa(-30, 640, 1000)).toBe(0);
    expect(tiempoDeXMinimapa(900, 640, 1000)).toBe(1000);
    expect(xDeTiempoMinimapa(-5, 640, 1000)).toBe(0);
    expect(xDeTiempoMinimapa(5000, 640, 1000)).toBe(640);
    expect(tiempoDeXMinimapa(10, 0, 1000)).toBe(0);
    expect(xDeTiempoMinimapa(10, 640, 0)).toBe(0);
  });
});
