// Tests de T-055 para records-logica.ts: la partida que se guarda, el aviso
// de nuevo record y los textos del song select.

import { describe, expect, it } from 'vitest';
import type { Chart, Judgement, PartidaJugada, RecordDeMapa, ScoreState } from '@tetra/core';
import {
  avisoDeRecord,
  claveDeRecord,
  detalleDeUltima,
  formatearMiles,
  formatearPrecision,
  mejorRangoDeCancion,
  parejasDeConteos,
  partidaDesdeScore,
  textoDeConteos,
  textoDeIntentos,
} from './records-logica.js';

const NBSP = ' ';

function conteos(valores: Partial<Record<Judgement, number>> = {}): Record<Judgement, number> {
  return { max: 0, perfect: 0, great: 0, good: 0, bad: 0, miss: 0, ...valores };
}

function estado(parcial: Partial<ScoreState> = {}): ScoreState {
  return {
    score: 850_000,
    combo: 0,
    maxCombo: 120,
    accuracy: 0.9,
    hp: 1,
    counts: conteos({ max: 812, perfect: 140, great: 12, good: 3, miss: 2 }),
    ...parcial,
  };
}

function partida(score: number, accuracy = 0.9): PartidaJugada {
  return {
    score,
    accuracy,
    maxCombo: 10,
    counts: conteos({ max: 5 }),
    rango: 'A',
    fecha: '2026-10-05T12:00:00.000Z',
  };
}

function chart(notas: [number, 0 | 1 | 2 | 3][], od = 6): Chart {
  return {
    metadata: {
      title: 'T',
      artist: 'A',
      creator: 'C',
      difficultyName: 'N',
      audioFile: 'a.mp3',
      previewTime: 0,
    },
    overallDifficulty: od,
    hpDrain: 5,
    timingPoints: [{ time: 0, bpm: 120, meter: 4 }],
    speedPoints: [],
    notes: notas.map(([time, column]) => ({ kind: 'tap' as const, time, column })),
  };
}

describe('partidaDesdeScore', () => {
  it('copia los conteos tal cual y calcula el rango con ellos', () => {
    const s = estado();
    const p = partidaDesdeScore(s, '2026-10-05T00:00:00.000Z');
    // Los conteos guardados son exactamente los de la pantalla de resultados.
    expect(p.counts).toEqual(s.counts);
    expect(p.score).toBe(850_000);
    expect(p.maxCombo).toBe(120);
    expect(p.accuracy).toBe(0.9);
    expect(p.rango).toBe('A');
    expect(p.fecha).toBe('2026-10-05T00:00:00.000Z');
  });

  it('los conteos son una copia: mutar el estado despues no cambia la partida', () => {
    const s = estado();
    const p = partidaDesdeScore(s, 'f');
    s.counts.miss = 999;
    expect(p.counts.miss).toBe(2);
  });

  it('todo MAX y 300 es SS aunque la precision no llegue a 1', () => {
    const p = partidaDesdeScore(
      estado({ accuracy: 0.97, counts: conteos({ max: 10, perfect: 5 }) }),
      'f',
    );
    expect(p.rango).toBe('SS');
  });

  it('no incluye desviacionMedia ni pulsaciones (aun no estan en el resultado)', () => {
    const p = partidaDesdeScore(estado(), 'f');
    expect('desviacionMedia' in p).toBe(false);
    expect('pulsaciones' in p).toBe(false);
  });
});

describe('claveDeRecord', () => {
  it('es el hash del contenido: mismas notas igual, otras notas distinta', () => {
    const a = chart([
      [0, 0],
      [500, 1],
    ]);
    const igual = chart([
      [0, 0],
      [500, 1],
    ]);
    const otra = chart([
      [0, 0],
      [500, 2],
    ]);
    expect(claveDeRecord(a)).toBe(claveDeRecord(igual));
    expect(claveDeRecord(a)).not.toBe(claveDeRecord(otra));
    expect(typeof claveDeRecord(a)).toBe('string');
  });
});

describe('formateo', () => {
  it('formatearMiles separa de a tres con espacio sin salto', () => {
    expect(formatearMiles(0)).toBe('0');
    expect(formatearMiles(999)).toBe('999');
    expect(formatearMiles(1000)).toBe(`1${NBSP}000`);
    expect(formatearMiles(12340)).toBe(`12${NBSP}340`);
    expect(formatearMiles(1_000_000)).toBe(`1${NBSP}000${NBSP}000`);
  });

  it('formatearPrecision usa dos decimales', () => {
    expect(formatearPrecision(0.98432)).toBe('98.43%');
    expect(formatearPrecision(1)).toBe('100.00%');
  });

  it('textoDeIntentos distingue singular y plural', () => {
    expect(textoDeIntentos(1)).toBe('1 intento');
    expect(textoDeIntentos(12)).toBe('12 intentos');
  });
});

describe('conteos', () => {
  it('van en el orden MAX, 300, 200, 100, 50, MISS', () => {
    const texto = textoDeConteos(
      conteos({ max: 812, perfect: 140, great: 12, good: 3, bad: 0, miss: 2 }),
    );
    expect(texto).toBe('MAX 812 · 300 140 · 200 12 · 100 3 · 50 0 · MISS 2');
  });

  it('parejasDeConteos trae el juicio de cada cantidad (para colorear)', () => {
    const parejas = parejasDeConteos(conteos({ perfect: 7, miss: 1 }));
    expect(parejas.map((p) => p.juicio)).toEqual(['max', 'perfect', 'great', 'good', 'bad', 'miss']);
    expect(parejas.find((p) => p.juicio === 'perfect')).toEqual({
      juicio: 'perfect',
      etiqueta: '300',
      cantidad: 7,
    });
  });

  it('el detalle de la ultima menciona score, precision, combo, conteos y dia', () => {
    const record: RecordDeMapa = {
      hash: 'h',
      mejor: partida(900_000),
      ultima: { ...partida(12_340, 0.5), maxCombo: 33, counts: conteos({ max: 1, miss: 4 }) },
      intentos: 2,
    };
    const d = detalleDeUltima(record);
    expect(d).toContain(`12${NBSP}340 puntos`);
    expect(d).toContain('50.00%');
    expect(d).toContain('combo 33');
    expect(d).toContain('MISS 4');
    expect(d).toContain('2026-10-05');
    // No es el detalle del mejor.
    expect(d).not.toContain('900');
  });
});

describe('avisoDeRecord', () => {
  it('sin anterior es el primer registro, sin diferencia', () => {
    expect(avisoDeRecord(true, undefined, partida(500_000))).toEqual({ texto: 'Primer registro' });
  });

  it('con anterior y mas score, es nuevo record con la diferencia', () => {
    const aviso = avisoDeRecord(true, partida(500_000), partida(512_340));
    expect(aviso).toEqual({ texto: 'Nuevo record', diferencia: `+12${NBSP}340` });
  });

  it('si no mejoro no hay aviso (aunque haya anterior)', () => {
    // Una implementacion que avisara siempre que haya partida fallaria aca.
    expect(avisoDeRecord(false, partida(900_000), partida(100_000))).toBeUndefined();
  });

  it('mismo score con mas precision es nuevo record sin diferencia', () => {
    expect(avisoDeRecord(true, partida(500_000, 0.8), partida(500_000, 0.85))).toEqual({
      texto: 'Nuevo record',
    });
  });

  it('un empate exacto (score y precision) no es un record nuevo', () => {
    expect(avisoDeRecord(true, partida(500_000, 0.8), partida(500_000, 0.8))).toBeUndefined();
  });
});

describe('mejorRangoDeCancion', () => {
  function registro(hash: string, rango: PartidaJugada['rango']): [string, RecordDeMapa] {
    const p = { ...partida(1), rango };
    return [hash, { hash, mejor: p, ultima: p, intentos: 1 }];
  }

  it('devuelve el mejor rango entre las dificultades con record', () => {
    const mapa = new Map([registro('a', 'C'), registro('b', 'S'), registro('c', 'D')]);
    expect(mejorRangoDeCancion(['a', 'b', 'c'], mapa)).toBe('S');
  });

  it('ignora las dificultades sin record y las de otras canciones', () => {
    const mapa = new Map([registro('a', 'D'), registro('otra', 'SS')]);
    expect(mejorRangoDeCancion(['a', 'sin-record'], mapa)).toBe('D');
  });

  it('sin ningun record da undefined', () => {
    expect(mejorRangoDeCancion(['a', 'b'], new Map())).toBeUndefined();
    expect(mejorRangoDeCancion([], new Map())).toBeUndefined();
  });
});
