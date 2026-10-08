// Tests de T-055 para records-logica.ts: la partida que se guarda, el aviso
// de nuevo record y los textos del song select.

import { describe, expect, it } from 'vitest';
import type { Chart, Judgement, PartidaJugada, RecordDeMapa, ScoreState } from '@tetra/core';
import {
  avisoDeRecord,
  claveDeRecord,
  DESVIACION_ALTA_MS,
  desviacionEsAlta,
  detalleDeUltima,
  formatearDesviacion,
  formatearMiles,
  formatearPrecision,
  mejorRangoDeCancion,
  parejasDeConteos,
  partidaDesdeScore,
  textoDeConteos,
  textoDeIntentos,
  tituloDeDesviacion,
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

  it('sin lo medido no inventa desviacionMedia ni pulsaciones', () => {
    const p = partidaDesdeScore(estado(), 'f');
    expect('desviacionMedia' in p).toBe(false);
    expect('pulsaciones' in p).toBe(false);
  });

  it('la desviacion media sale de los golpes juzgados, sin los miss', () => {
    const p = partidaDesdeScore(estado(), 'f', {
      desviaciones: [
        { error: -10, judgement: 'max' },
        { error: 20, judgement: 'great' },
        { error: 150, judgement: 'miss' },
      ],
    });
    // Con el miss adentro daria 53.3: tiene que quedar en 5.
    expect(p.desviacionMedia).toBe(5);
  });

  it('solo miss: no hay media que guardar', () => {
    const p = partidaDesdeScore(estado(), 'f', {
      desviaciones: [{ error: 150, judgement: 'miss' }],
    });
    expect('desviacionMedia' in p).toBe(false);
  });

  it('copia las cuatro pulsaciones y descarta un arreglo que no tenga cuatro', () => {
    const fuente = [412, 398, 401, 405];
    const p = partidaDesdeScore(estado(), 'f', { pulsaciones: fuente });
    expect(p.pulsaciones).toEqual([412, 398, 401, 405]);
    expect(p.pulsaciones).not.toBe(fuente);
    expect('pulsaciones' in partidaDesdeScore(estado(), 'f', { pulsaciones: [1, 2] })).toBe(false);
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

describe('detalle de la ultima con pulsaciones (T-057)', () => {
  function recordConUltima(ultima: PartidaJugada): RecordDeMapa {
    return { hash: 'h', mejor: partida(900_000), ultima, intentos: 2 };
  }

  it('agrega las pulsaciones por tecla con las etiquetas dadas', () => {
    const d = detalleDeUltima(
      recordConUltima({ ...partida(1000), pulsaciones: [412, 398, 401, 405] }),
      ['D', 'F', 'J', 'K'],
    );
    expect(d).toContain('D 412 · F 398 · J 401 · K 405');
    // La fecha sigue al final.
    expect(d.endsWith('2026-10-05')).toBe(true);
  });

  it('sin etiquetas usa el numero de columna', () => {
    const d = detalleDeUltima(recordConUltima({ ...partida(1000), pulsaciones: [1, 2, 3, 4] }));
    expect(d).toContain('1 1 · 2 2 · 3 3 · 4 4');
  });

  it('una partida sin pulsaciones no agrega nada (un record viejo de T-055)', () => {
    const d = detalleDeUltima(recordConUltima(partida(1000)), ['D', 'F', 'J', 'K']);
    expect(d).not.toContain('D ');
    expect(d).not.toContain('NaN');
    expect(d).not.toContain('undefined');
  });
});

describe('desviacion media del record (T-057)', () => {
  it('formatea con signo explicito: tarde +, temprano -', () => {
    expect(formatearDesviacion(4)).toBe('+4 ms');
    expect(formatearDesviacion(-3)).toBe('-3 ms');
    expect(formatearDesviacion(4.6)).toBe('+5 ms');
    expect(formatearDesviacion(-3.4)).toBe('-3 ms');
  });

  it('cero y casi cero no llevan signo ni -0', () => {
    expect(formatearDesviacion(0)).toBe('0 ms');
    expect(formatearDesviacion(-0.3)).toBe('0 ms');
    expect(formatearDesviacion(0.3)).toBe('0 ms');
  });

  it('un valor no valido da 0 ms', () => {
    expect(formatearDesviacion(Number.NaN)).toBe('0 ms');
  });

  it('el title dice tarde o temprano y por cuantos ms', () => {
    expect(tituloDeDesviacion(4)).toBe('En promedio pegas tarde por 4 ms');
    expect(tituloDeDesviacion(-3)).toBe('En promedio pegas temprano por 3 ms');
    expect(tituloDeDesviacion(0)).toBe('En promedio pegas justo a tiempo');
  });

  it('pasado +-8 ms es alta, hasta 8 inclusive no', () => {
    expect(DESVIACION_ALTA_MS).toBe(8);
    expect(desviacionEsAlta(8)).toBe(false);
    expect(desviacionEsAlta(-8)).toBe(false);
    expect(desviacionEsAlta(9)).toBe(true);
    expect(desviacionEsAlta(-9)).toBe(true);
    expect(desviacionEsAlta(0)).toBe(false);
    // Redondeada: 8.4 se ve como "+8 ms", no se marca; 8.6 se ve "+9 ms", si.
    expect(desviacionEsAlta(8.4)).toBe(false);
    expect(desviacionEsAlta(8.6)).toBe(true);
    expect(desviacionEsAlta(Number.NaN)).toBe(false);
  });

  it('solo si es alta el title sugiere ajustar el offset de la cancion', () => {
    expect(tituloDeDesviacion(5)).not.toContain('offset');
    expect(tituloDeDesviacion(-8)).not.toContain('offset');
    expect(tituloDeDesviacion(12)).toContain('offset de esta cancion');
    expect(tituloDeDesviacion(-12)).toContain('temprano por 12 ms');
    expect(tituloDeDesviacion(-12)).toContain('offset de esta cancion');
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
