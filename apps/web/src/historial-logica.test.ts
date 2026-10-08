// Tests de T-045 para historial-logica.ts: el registro que se guarda al
// terminar una partida.

import { describe, expect, it } from 'vitest';
import { golpesJuzgados } from '@tetra/core';
import type { Chart, Column, Judgement, Note, ScoreState } from '@tetra/core';
import { claveDeRecord } from './records-logica.js';
import { duracionJugada, registroDePartida, type GolpeConColumna } from './historial-logica.js';

function conteos(valores: Partial<Record<Judgement, number>> = {}): Record<Judgement, number> {
  return { max: 0, perfect: 0, great: 0, good: 0, bad: 0, miss: 0, ...valores };
}

function estado(
  counts: Record<Judgement, number>,
  parcial: Partial<ScoreState> = {},
): ScoreState {
  return { score: 700_000, combo: 0, maxCombo: 30, accuracy: 0.9, hp: 1, counts, ...parcial };
}

function chart(notes: Note[]): Chart {
  return {
    metadata: {
      title: 'T',
      artist: 'A',
      creator: 'C',
      difficultyName: 'N',
      audioFile: 'a.mp3',
      previewTime: 0,
    },
    overallDifficulty: 6,
    hpDrain: 5,
    timingPoints: [{ time: 0, bpm: 120, meter: 4 }],
    speedPoints: [],
    notes,
  };
}

function tap(time: number, column: Column = 0): Note {
  return { kind: 'tap', time, column };
}

function golpe(judgement: Judgement, error: number, column: Column): GolpeConColumna {
  return { judgement, error, column };
}

describe('duracionJugada', () => {
  it('va de la primera a la ultima nota, sin la intro ni el final de la cancion', () => {
    expect(duracionJugada(chart([tap(2000), tap(5000, 2), tap(12_500, 3)]))).toBe(10_500);
  });

  it('una nota larga cuenta hasta donde termina, aunque no sea la ultima en empezar', () => {
    const largas: Note[] = [
      tap(1000),
      { kind: 'hold', time: 2000, endTime: 9000, column: 1 },
      tap(5000, 2),
    ];
    expect(duracionJugada(chart(largas))).toBe(8000);
  });

  it('sin notas o con una sola nota es 0, no negativa ni NaN', () => {
    expect(duracionJugada(chart([]))).toBe(0);
    expect(duracionJugada(chart([tap(4000)]))).toBe(0);
  });

  it('no depende del orden en que vengan las notas', () => {
    expect(duracionJugada(chart([tap(9000), tap(1000), tap(5000)]))).toBe(8000);
  });
});

describe('registroDePartida', () => {
  const FECHA = '2026-10-07T20:15:00.000Z';

  it('arma el registro desde el resultado: score, precision, fecha y el hash del mapa', () => {
    const mapa = chart([tap(1000), tap(4000)]);
    const r = registroDePartida(
      mapa,
      estado(conteos({ max: 2 }), { score: 912_345, accuracy: 0.987 }),
      [golpe('max', 0, 0), golpe('max', 0, 0)],
      FECHA,
    );
    expect(r.hash).toBe(claveDeRecord(mapa));
    expect(r.fecha).toBe(FECHA);
    expect(r.score).toBe(912_345);
    expect(r.accuracy).toBe(0.987);
    expect(r.duracionJugadaMs).toBe(3000);
  });

  it('las notas son todos los juicios, con los miss', () => {
    const r = registroDePartida(
      chart([tap(0)]),
      estado(conteos({ max: 10, perfect: 5, great: 3, good: 2, bad: 1, miss: 4 })),
      [],
      FECHA,
    );
    expect(r.notas).toBe(25);
  });

  it('la desviacion media y tipica salen de los golpes que no son miss', () => {
    const golpes = [
      golpe('max', -10, 0),
      golpe('perfect', 20, 1),
      golpe('great', 30, 2),
      // Un miss lleva el tiempo que tardo en darse por perdida: no es un error de pulsacion.
      golpe('miss', 150, 3),
    ];
    const r = registroDePartida(
      chart([tap(0)]),
      estado(conteos({ max: 1, perfect: 1, great: 1, miss: 1 })),
      golpes,
      FECHA,
    );
    // Sin el miss: media (-10 + 20 + 30) / 3.
    const media = 40 / 3;
    expect(r.desviacionMedia).toBeCloseTo(media, 12);
    const varianza = ((-10 - media) ** 2 + (20 - media) ** 2 + (30 - media) ** 2) / 3;
    expect(r.desviacionTipica).toBeCloseTo(Math.sqrt(varianza), 12);
  });

  it('cuenta tempranas y tardias; un error exacto de 0 no es ninguna de las dos', () => {
    const golpes = [
      golpe('max', -4, 0),
      golpe('max', -1, 0),
      golpe('max', 0, 1),
      golpe('perfect', 12, 2),
      golpe('miss', -500, 3),
    ];
    const r = registroDePartida(
      chart([tap(0)]),
      estado(conteos({ max: 3, perfect: 1, miss: 1 })),
      golpes,
      FECHA,
    );
    expect(r.tempranas).toBe(2);
    expect(r.tardias).toBe(1);
  });

  it('los fallos por columna son los miss de cada columna', () => {
    const golpes = [
      golpe('miss', 100, 1),
      golpe('max', 0, 1),
      golpe('miss', 100, 1),
      golpe('miss', 100, 3),
      golpe('bad', 80, 0),
    ];
    const r = registroDePartida(
      chart([tap(0)]),
      estado(conteos({ max: 1, bad: 1, miss: 3 })),
      golpes,
      FECHA,
    );
    expect(r.fallosPorColumna).toEqual([0, 2, 0, 1]);
  });

  it('notas menos fallos son los golpes con error que medir (el peso que usa core)', () => {
    const golpes = [
      golpe('max', 3, 0),
      golpe('miss', 100, 2),
      golpe('miss', 100, 2),
      golpe('good', -30, 1),
    ];
    const r = registroDePartida(
      chart([tap(0)]),
      estado(conteos({ max: 1, good: 1, miss: 2 })),
      golpes,
      FECHA,
    );
    expect(golpesJuzgados(r)).toBe(2);
  });

  it('una partida sin ningun golpe juzgado (todo miss) no inventa desviacion ni NaN', () => {
    const r = registroDePartida(
      chart([tap(0), tap(500)]),
      estado(conteos({ miss: 2 }), { accuracy: 0 }),
      [golpe('miss', 120, 0), golpe('miss', 125, 1)],
      FECHA,
    );
    expect(r.desviacionMedia).toBe(0);
    expect(r.desviacionTipica).toBe(0);
    expect(r.tempranas).toBe(0);
    expect(r.tardias).toBe(0);
    expect(r.fallosPorColumna).toEqual([1, 1, 0, 0]);
    expect(golpesJuzgados(r)).toBe(0);
  });
});
