// Tests de T-044 para apps/web/src/replay-logica.ts.

import { describe, expect, it } from 'vitest';
import { replayPerfecto, type Chart, type Replay } from '@tetra/core';
import {
  MENSAJE_REPLAY_DE_OTRO_MAPA,
  MENSAJE_REPLAY_ILEGIBLE,
  MENSAJE_SIN_REPLAY,
  etiquetaDeReproduccion,
  fechaCorta,
  fechaYHoraCorta,
  motivoDeRechazoDelReplay,
} from './replay-logica.js';

function mapa(tiempos: number[], od = 7): Chart {
  return {
    metadata: {
      title: 'T',
      artist: 'A',
      creator: 'C',
      difficultyName: 'D',
      audioFile: 'a.mp3',
      previewTime: 0,
    },
    overallDifficulty: od,
    hpDrain: 5,
    timingPoints: [],
    speedPoints: [],
    notes: tiempos.map((time, i) => ({ kind: 'tap', time, column: (i % 4) as 0 | 1 | 2 | 3 })),
  };
}

describe('fechaCorta', () => {
  it('dia sin cero a la izquierda y mes abreviado', () => {
    expect(fechaCorta('2026-10-07T12:00:00.000Z')).toBe('7 oct');
    expect(fechaCorta('2026-01-31T23:59:59.000Z')).toBe('31 ene');
    expect(fechaCorta('2026-12-01')).toBe('1 dic');
  });

  it('no depende de la zona horaria: lee el dia del propio texto', () => {
    expect(fechaCorta('2026-10-07T23:59:59.999Z')).toBe('7 oct');
    expect(fechaCorta('2026-10-07T00:00:00.000Z')).toBe('7 oct');
  });

  it('una fecha que no se entiende da vacio', () => {
    expect(fechaCorta('')).toBe('');
    expect(fechaCorta('ayer')).toBe('');
    expect(fechaCorta('2026-13-01')).toBe('');
    expect(fechaCorta('2026-00-10')).toBe('');
    expect(fechaCorta('2026-10-00')).toBe('');
  });
});

describe('etiquetaDeReproduccion', () => {
  it('auto es AUTO, sin fecha', () => {
    expect(etiquetaDeReproduccion('auto')).toBe('AUTO');
    expect(etiquetaDeReproduccion('auto', '2026-10-07T12:00:00.000Z')).toBe('AUTO');
  });

  it('replay lleva la fecha corta, separada con un punto medio (nada de rayas)', () => {
    const etiqueta = etiquetaDeReproduccion('replay', '2026-10-07T12:00:00.000Z');
    expect(etiqueta).toBe('REPLAY · 7 oct');
    expect(etiqueta).not.toContain('—');
  });

  it('replay sin fecha, o con una fecha rota, es solo REPLAY', () => {
    expect(etiquetaDeReproduccion('replay')).toBe('REPLAY');
    expect(etiquetaDeReproduccion('replay', 'rota')).toBe('REPLAY');
  });
});

describe('motivoDeRechazoDelReplay', () => {
  const chart = mapa([1000, 1500, 2000]);

  it('un replay del mismo mapa sirve', () => {
    expect(motivoDeRechazoDelReplay(replayPerfecto(chart), chart)).toBeNull();
  });

  // Una implementacion que no compare el hash aceptaria cualquier replay.
  it('un replay de otro mapa (hash distinto) se rechaza con un mensaje claro', () => {
    const otro = mapa([1000, 1500, 2100]);
    const mensaje = motivoDeRechazoDelReplay(replayPerfecto(otro), chart);
    expect(mensaje).toBe(MENSAJE_REPLAY_DE_OTRO_MAPA);
    expect(mensaje).toContain('otro mapa');
  });

  it('el mismo mapa con otro OD es otro mapa (el hash incluye el OD)', () => {
    expect(motivoDeRechazoDelReplay(replayPerfecto(mapa([1000], 5)), mapa([1000], 8))).toBe(
      MENSAJE_REPLAY_DE_OTRO_MAPA,
    );
  });

  it('sin replay o con uno ilegible, el motivo lo dice', () => {
    expect(motivoDeRechazoDelReplay(undefined, chart)).toBe(MENSAJE_SIN_REPLAY);
    expect(motivoDeRechazoDelReplay(null, chart)).toBe(MENSAJE_REPLAY_ILEGIBLE);
  });

  it('un replay hecho sobre el mapa recortado (desde el cabezal) sirve para esa partida', () => {
    const recortado = mapa([2000]);
    const replay: Replay = replayPerfecto(recortado);
    expect(motivoDeRechazoDelReplay(replay, chart)).toBe(MENSAJE_REPLAY_DE_OTRO_MAPA);
    expect(motivoDeRechazoDelReplay(replay, chart, recortado)).toBeNull();
  });
});

describe('fechaYHoraCorta (T-065)', () => {
  // Se arman con la hora local para que el test no dependa de la zona horaria de quien lo corre.
  it('da dia, mes y hora local con dos digitos', () => {
    expect(fechaYHoraCorta(new Date(2026, 9, 13, 21, 5).toISOString())).toBe('13 oct 21:05');
    expect(fechaYHoraCorta(new Date(2026, 0, 2, 0, 7).toISOString())).toBe('2 ene 00:07');
    expect(fechaYHoraCorta(new Date(2026, 11, 31, 23, 59).toISOString())).toBe('31 dic 23:59');
  });

  it('una fecha que no se entiende da vacio', () => {
    expect(fechaYHoraCorta('ayer')).toBe('');
    expect(fechaYHoraCorta('')).toBe('');
  });
});
