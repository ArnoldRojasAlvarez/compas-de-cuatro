// T-039: la ventana visible se reescribe en sitio y los pools de sprites se
// dimensionan por la densidad real del mapa. Aritmetica pura (como
// position.test.ts): corre en node sin renderer.

import { describe, expect, it } from 'vitest';
import type { HoldNote, Note, TapNote } from '@tetra/core';
import {
  PROGRESO_MAX_VISIBLE,
  PROGRESO_MIN_VISIBLE,
  avanzarVentanaEnSitio,
  maximoVisibleEnColumna,
  ventanaVacia,
  type VentanaNotas,
} from './position.js';

function nota(time: number): TapNote {
  return { kind: 'tap', time, column: 0 };
}

function notaLarga(time: number, endTime: number): HoldNote {
  return { kind: 'hold', time, endTime, column: 0 };
}

/** Referencia deliberadamente ineficiente: recorre toda la columna en cada ventana. */
function indicesVisiblesPorFiltroCompleto(
  notas: readonly Note[],
  tiempoActual: number,
  scrollDuration: number,
): Set<number> {
  const limiteInferior = tiempoActual + PROGRESO_MIN_VISIBLE * scrollDuration;
  const limiteSuperior = tiempoActual + PROGRESO_MAX_VISIBLE * scrollDuration;
  const indices = new Set<number>();
  notas.forEach((n, indice) => {
    const finVisibilidad = 'endTime' in n ? n.endTime : n.time;
    if (finVisibilidad >= limiteInferior && n.time <= limiteSuperior) indices.add(indice);
  });
  return indices;
}

function indicesVisiblesDeVentana(ventana: VentanaNotas): Set<number> {
  const indices = new Set<number>();
  for (let i = ventana.inicio; i < ventana.fin; i++) indices.add(i);
  return indices;
}

/** Generador con semilla (mulberry32): los casos aleatorios son siempre los mismos. */
function aleatorioConSemilla(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Una columna al azar: notas por tiempo ascendente, algunas largas, ninguna pisando a la siguiente. */
function columnaAleatoria(azar: () => number, cantidad: number): Note[] {
  const notas: Note[] = [];
  let t = Math.floor(azar() * 500);
  for (let i = 0; i < cantidad; i++) {
    if (azar() < 0.25) {
      const fin = t + 100 + Math.floor(azar() * 1500);
      notas.push(notaLarga(t, fin));
      t = fin + 20 + Math.floor(azar() * 400);
    } else {
      notas.push(nota(t));
      t += 20 + Math.floor(azar() * 400);
    }
  }
  return notas;
}

describe('avanzarVentanaEnSitio: sin objetos nuevos', () => {
  it('reescribe el mismo objeto y no devuelve nada', () => {
    const notas: Note[] = Array.from({ length: 10 }, (_, i) => nota(i * 1000));
    const ventana = ventanaVacia();
    const resultado: unknown = avanzarVentanaEnSitio(notas, ventana, 3000, 2000);
    expect(resultado).toBeUndefined();
    expect(ventana).toEqual({ inicio: 3, fin: 6 });
    // El mismo objeto sigue siendo el de la columna en el frame siguiente.
    const mismo = ventana;
    avanzarVentanaEnSitio(notas, ventana, 5000, 2000);
    expect(ventana).toBe(mismo);
    expect(ventana).toEqual({ inicio: 5, fin: 8 });
  });

  it('cuatro columnas con su propio objeto: cada una da lo mismo que el filtro completo (semilla fija, 1600 ventanas)', () => {
    const azar = aleatorioConSemilla(39);
    const columnas = [0, 1, 2, 3].map(() => columnaAleatoria(azar, 60));
    // Un objeto por columna, como los crea la pista una sola vez.
    const ventanas: VentanaNotas[] = [ventanaVacia(), ventanaVacia(), ventanaVacia(), ventanaVacia()];
    const identidades = [...ventanas];
    const scrollDuration = 1200;
    let comparaciones = 0;
    for (let t = -500; t < 14_000; t += 35) {
      for (let c = 0; c < 4; c++) {
        avanzarVentanaEnSitio(columnas[c]!, ventanas[c]!, t, scrollDuration);
        expect(indicesVisiblesDeVentana(ventanas[c]!)).toEqual(
          indicesVisiblesPorFiltroCompleto(columnas[c]!, t, scrollDuration),
        );
        comparaciones++;
      }
    }
    expect(comparaciones).toBeGreaterThanOrEqual(1600);
    // Una implementacion que compartiera un objeto entre columnas dejaria las ventanas mezcladas
    // (el filtro completo de arriba fallaria) o con la misma identidad: cada columna conserva el suyo.
    ventanas.forEach((ventana, c) => expect(ventana).toBe(identidades[c]));
    expect(new Set(ventanas).size).toBe(4);
  });
});

describe('maximoVisibleEnColumna (dimensiona el pool de sprites)', () => {
  it('una columna vacia no necesita nada', () => {
    expect(maximoVisibleEnColumna([], 1200)).toBe(0);
  });

  it('cuenta las notas que caben en [-0.1, 1.1] * scrollDuration (1,2 * 1200 = 1440 ms)', () => {
    // Una cada 300 ms: caben 5 (de 0 a 1200 ms); la sexta (1500) ya queda fuera de 1440.
    const notas: Note[] = Array.from({ length: 30 }, (_, i) => nota(i * 300));
    expect(maximoVisibleEnColumna(notas, 1200)).toBe(5);
    // El doble de lento (mas notas a la vez): 2880 ms de ventana, 10 notas.
    expect(maximoVisibleEnColumna(notas, 2400)).toBe(10);
  });

  it('una nota larga cuenta mientras dura, aunque su cabeza ya haya pasado', () => {
    // La LN 0..2000 sigue visible cuando llegan las notas de 2300 y 2600 (2000 >= 2600 - 1440).
    const conLn: Note[] = [notaLarga(0, 2000), nota(2300), nota(2600)];
    expect(maximoVisibleEnColumna(conLn, 1200)).toBe(3);
    // Con una nota simple en 0 ya no esta cuando llegan las otras.
    const sinLn: Note[] = [nota(0), nota(2300), nota(2600)];
    expect(maximoVisibleEnColumna(sinLn, 1200)).toBe(2);
  });

  it('coincide con el maximo que el filtro completo ve ventana por ventana (semilla fija, 25 columnas)', () => {
    const azar = aleatorioConSemilla(1039);
    for (let caso = 0; caso < 25; caso++) {
      const columna = columnaAleatoria(azar, 80);
      const scrollDuration = 400 + Math.floor(azar() * 2600);
      const cota = maximoVisibleEnColumna(columna, scrollDuration);
      let observado = 0;
      for (let t = -500; t < 40_000; t += 11) {
        observado = Math.max(
          observado,
          indicesVisiblesPorFiltroCompleto(columna, t, scrollDuration).size,
        );
      }
      // Nunca se ve mas de lo que dice la cota, y la cota no sobra (casi se alcanza: el paso es de 11 ms).
      expect(observado).toBeLessThanOrEqual(cota);
      expect(observado).toBeGreaterThanOrEqual(cota - 1);
    }
  });

  it('40 notas visibles en una columna: el pool se dimensiona para las 40', () => {
    // 40 notas separadas 30 ms: todas caben en una ventana de 1440 ms.
    const densa: Note[] = Array.from({ length: 40 }, (_, i) => nota(1000 + i * 30));
    expect(maximoVisibleEnColumna(densa, 1200)).toBe(40);
  });
});
