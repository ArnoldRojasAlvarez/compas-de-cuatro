// Tests de T-035: arrancar una partida desde un punto y compensar la latencia
// de grabacion. Funciones puras.

import { describe, expect, it } from 'vitest';
import type { Chart, Note } from '@tetra/core';
import {
  LATENCIA_MAXIMA_MS,
  compensarLatencia,
  filtrarNotasDesde,
  inicioDeLaCancion,
} from './partida-logica.js';

function chart(notes: Note[]): Chart {
  return {
    metadata: {
      title: 'T',
      artist: 'A',
      creator: 'C',
      difficultyName: 'D',
      audioFile: 'a.mp3',
      previewTime: 0,
    },
    overallDifficulty: 7,
    hpDrain: 5,
    timingPoints: [{ time: 0, bpm: 120, meter: 4 }],
    speedPoints: [],
    notes,
  };
}

const notas: Note[] = [
  { kind: 'tap', time: 1000, column: 0 },
  { kind: 'tap', time: 2000, column: 1 },
  { kind: 'hold', time: 2500, endTime: 3500, column: 2 },
  { kind: 'tap', time: 4000, column: 3 },
];

describe('filtrarNotasDesde', () => {
  it('con inicio 0 o negativo devuelve el mismo chart', () => {
    const c = chart(notas);
    expect(filtrarNotasDesde(c, 0)).toBe(c);
    expect(filtrarNotasDesde(c, -50)).toBe(c);
  });

  it('descarta las notas anteriores al inicio', () => {
    const r = filtrarNotasDesde(chart(notas), 2000);
    expect(r.notes.map((n) => n.time)).toEqual([2000, 2500, 4000]);
  });

  it('una nota que cae justo en el inicio se conserva', () => {
    expect(filtrarNotasDesde(chart(notas), 1000).notes).toHaveLength(4);
    expect(filtrarNotasDesde(chart(notas), 1001).notes).toHaveLength(3);
  });

  it('una larga que empieza antes del inicio se descarta aunque termine despues', () => {
    const r = filtrarNotasDesde(chart(notas), 3000);
    expect(r.notes).toEqual([{ kind: 'tap', time: 4000, column: 3 }]);
  });

  it('despues de la ultima nota no queda ninguna', () => {
    expect(filtrarNotasDesde(chart(notas), 9999).notes).toEqual([]);
  });

  it('no muta el chart original y conserva el resto de sus campos', () => {
    const c = chart(notas);
    const r = filtrarNotasDesde(c, 2000);
    expect(c.notes).toHaveLength(4);
    expect(r.metadata).toBe(c.metadata);
    expect(r.timingPoints).toBe(c.timingPoints);
    expect(r.overallDifficulty).toBe(7);
  });
});

describe('inicioDeLaCancion', () => {
  it('arranca el lead-in antes de la primera nota que se juega', () => {
    expect(inicioDeLaCancion(30000, 1500)).toBe(28500);
  });

  it('nunca baja de 0', () => {
    expect(inicioDeLaCancion(800, 1500)).toBe(0);
    expect(inicioDeLaCancion(0, 1500)).toBe(0);
  });
});

describe('compensarLatencia', () => {
  it('resta el offset del usuario y la latencia de salida', () => {
    // Se renderizaba 1000 ms, el jugador oia con 30 ms de atraso: lo grabado es 970.
    expect(compensarLatencia(1000, 0, 30)).toBe(970);
    expect(compensarLatencia(1000, 10, 30)).toBe(960);
  });

  it('un offset de usuario negativo adelanta la nota (misma convencion que clock.now)', () => {
    expect(compensarLatencia(1000, -20, 30)).toBe(990);
  });

  it('el signo importa: con latencia positiva la nota grabada es MAS TEMPRANA que la renderizada', () => {
    // Una compensacion con el signo invertido daria 1030 y fallaria aca.
    expect(compensarLatencia(1000, 0, 30)).toBeLessThan(1000);
  });

  it('una latencia absurda se acota', () => {
    expect(compensarLatencia(5000, 0, 99999)).toBe(5000 - LATENCIA_MAXIMA_MS);
    expect(compensarLatencia(5000, 0, -40)).toBe(5000);
  });

  it('NaN e Infinity no contaminan el resultado', () => {
    expect(compensarLatencia(1000, Number.NaN, Number.NaN)).toBe(1000);
    expect(compensarLatencia(1000, Number.POSITIVE_INFINITY, 0)).toBe(1000);
    expect(compensarLatencia(1000, 0, Number.POSITIVE_INFINITY)).toBe(1000);
  });
});
