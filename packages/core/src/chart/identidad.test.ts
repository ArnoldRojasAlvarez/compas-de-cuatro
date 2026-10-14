// Tests de T-066 (D2): claves de identidad de una dificultad.

import { describe, expect, it } from 'vitest';
import type { Chart } from '../types.js';
import { hashMapa } from '../difficulty/hash.js';
import { clavesDeIdentidad } from './identidad.js';

function chart(parcial: Partial<Chart['metadata']> = {}, tiempo = 500): Chart {
  return {
    metadata: {
      title: 'Canon',
      artist: 'Collection',
      creator: 'Alguien',
      difficultyName: 'Normal',
      audioFile: 'audio.mp3',
      previewTime: 0,
      ...parcial,
    },
    overallDifficulty: 7,
    hpDrain: 5,
    timingPoints: [{ time: 0, bpm: 120, meter: 4 }],
    speedPoints: [],
    notes: [{ kind: 'tap', time: tiempo, column: 1 }],
  };
}

describe('clavesDeIdentidad', () => {
  it('sin BeatmapID da solo la clave de contenido', () => {
    const c = chart();
    expect(clavesDeIdentidad(c)).toEqual([`contenido:${hashMapa(c)}|canon|collection`]);
  });

  it('con BeatmapID suma id:<n> antes de la de contenido', () => {
    const c = chart({ beatmapId: 4242 });
    expect(clavesDeIdentidad(c)).toEqual([
      'id:4242',
      `contenido:${hashMapa(c)}|canon|collection`,
    ]);
  });

  it('el difficultyName no entra: un renombre da la misma clave de contenido', () => {
    expect(clavesDeIdentidad(chart({ difficultyName: 'Hard' }))).toEqual(
      clavesDeIdentidad(chart({ difficultyName: 'Normal' })),
    );
  });

  it('titulo y artista se normalizan (recorte, minusculas, espacios colapsados)', () => {
    expect(
      clavesDeIdentidad(chart({ title: '  CANON   in  D ', artist: ' collection ' })),
    ).toEqual(clavesDeIdentidad(chart({ title: 'canon in d', artist: 'Collection' })));
  });

  it('notas distintas dan otra clave de contenido', () => {
    expect(clavesDeIdentidad(chart({}, 500))).not.toEqual(clavesDeIdentidad(chart({}, 600)));
  });

  it('otro titulo da otra clave de contenido', () => {
    expect(clavesDeIdentidad(chart({ title: 'Otra' }))).not.toEqual(clavesDeIdentidad(chart()));
  });
});
