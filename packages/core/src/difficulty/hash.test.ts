// Tests de T-014 para hashMapa (ver hash.ts). Leccion del proyecto (ver
// docs/HANDOFF.md, "Lecciones"): antes de cada aserche, que implementacion
// incorrecta la haria fallar.

import { describe, expect, it } from 'vitest';
import type { Chart, Column, Note } from '../types.js';
import { hashMapa } from './hash.js';

function nota(column: Column, time: number): Note {
  return { kind: 'tap', time, column };
}

function crearMapa(notes: Note[], overallDifficulty = 7): Chart {
  return {
    metadata: {
      title: 'Mapa de prueba',
      artist: 'Prueba',
      creator: 'Arnold Alvarez',
      difficultyName: 'Test',
      audioFile: 'test.mp3',
      previewTime: 0,
    },
    overallDifficulty,
    hpDrain: 5,
    timingPoints: [],
    speedPoints: [],
    notes,
  };
}

describe('hashMapa', () => {
  it('dos mapas con las mismas notas y el mismo OD dan el mismo hash', () => {
    const notas = [nota(0, 0), nota(1, 100), nota(2, 200), nota(3, 300)];
    const a = crearMapa([...notas]);
    // Un arreglo de notas distinto (misma info, otro objeto) para que la
    // prueba no pase solo por comparar el mismo arreglo por referencia.
    const b = crearMapa(notas.map((n) => ({ ...n })));
    // Una implementacion que hasheara la referencia del arreglo (o algo no
    // determinista, como Math.random en el hash) fallaria esto.
    expect(hashMapa(a)).toBe(hashMapa(b));
  });

  it('el hash es determinista: se puede recalcular dos veces sobre el mismo mapa', () => {
    const mapa = crearMapa([nota(0, 0), nota(1, 83.33), nota(2, 166.67)]);
    expect(hashMapa(mapa)).toBe(hashMapa(mapa));
  });

  it('cambiar el tiempo de una sola nota cambia el hash', () => {
    const base = crearMapa([nota(0, 0), nota(1, 100), nota(2, 200)]);
    const modificado = crearMapa([nota(0, 0), nota(1, 101), nota(2, 200)]);
    // Una implementacion que solo mirara la cantidad de notas (o solo la
    // primera/ultima) no detectaria este cambio en el medio.
    expect(hashMapa(base)).not.toBe(hashMapa(modificado));
  });

  it('cambiar la columna de una sola nota cambia el hash', () => {
    const base = crearMapa([nota(0, 0), nota(1, 100)]);
    const modificado = crearMapa([nota(0, 0), nota(2, 100)]);
    expect(hashMapa(base)).not.toBe(hashMapa(modificado));
  });

  it('cambiar el Overall Difficulty cambia el hash aunque las notas sean iguales', () => {
    const notas = [nota(0, 0), nota(1, 100)];
    const od6 = crearMapa(notas, 6);
    const od7 = crearMapa(notas, 7);
    expect(hashMapa(od6)).not.toBe(hashMapa(od7));
  });

  it('agregar o quitar una nota cambia el hash', () => {
    const corto = crearMapa([nota(0, 0), nota(1, 100)]);
    const largo = crearMapa([nota(0, 0), nota(1, 100), nota(2, 200)]);
    // Sin un separador entre campos, concatenar tiempos/columnas por texto
    // podria coincidir por accidente entre mapas de distinto largo; esto lo
    // descarta de forma directa.
    expect(hashMapa(corto)).not.toBe(hashMapa(largo));
  });

  it('sin separador entre campos, tiempo=1/columna=23 y tiempo=12/columna=3 colisionarian: esto verifica que no pasa', () => {
    // No son columnas validas del tipo Column (0-3), pero el hash no valida
    // eso (es una funcion de datos, no de dominio): sirve igual para probar
    // que el separador evita la ambiguedad de concatenar sin separar.
    const a = crearMapa([{ kind: 'tap', time: 1, column: 23 as Column }]);
    const b = crearMapa([{ kind: 'tap', time: 12, column: 3 as Column }]);
    expect(hashMapa(a)).not.toBe(hashMapa(b));
  });

  it('el orden de las notas importa (el motor de dificultad tambien procesa en orden)', () => {
    const a = crearMapa([nota(0, 0), nota(1, 100)]);
    const b = crearMapa([nota(1, 100), nota(0, 0)]);
    expect(hashMapa(a)).not.toBe(hashMapa(b));
  });

  it('un mapa sin notas da un hash finito y valido (no NaN, no negativo)', () => {
    const hash = hashMapa(crearMapa([]));
    expect(Number.isFinite(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
  });
});
