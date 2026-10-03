// Tests del escritor de .osz. Se verifican contra el importador real
// (extraerCancionDeOsz): lo que el mapeador arma tiene que poder leerse.

import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { escribirOsu, type Chart } from '@tetra/core';
import { construirOsz, nombreDeOsu, nombreSeguro } from './osz-escritor.js';
import { extraerCancionDeOsz } from './osz.js';

function chart(version: string, columna: 0 | 1 | 2 | 3): Chart {
  return {
    metadata: {
      title: 'Compas: de cuatro?',
      artist: 'Arnold Alvarez',
      creator: 'Arnold Alvarez',
      difficultyName: version,
      audioFile: 'audio.mp3',
      previewTime: 0,
    },
    overallDifficulty: 7,
    hpDrain: 5,
    timingPoints: [{ time: 0, bpm: 120, meter: 4 }],
    speedPoints: [],
    notes: [
      { kind: 'tap', time: 500, column: columna },
      { kind: 'hold', time: 1000, endTime: 1500, column: 3 },
    ],
  };
}

const AUDIO = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe('nombreSeguro', () => {
  it('quita caracteres prohibidos y caracteres de control', () => {
    expect(nombreSeguro('a<b>:c"d/e\\f|g?h*i')).toBe('abcdefghi');
    expect(nombreSeguro('uno\u0001  dos')).toBe('uno dos');
  });
  it('nunca devuelve vacio', () => {
    expect(nombreSeguro('???')).toBe('sin nombre');
  });
});

describe('construirOsz', () => {
  it('el importador lee de vuelta cancion, audio y dificultades', async () => {
    const bytes = construirOsz({
      titulo: 'Compas: de cuatro?',
      artista: 'Arnold Alvarez',
      creador: 'Arnold Alvarez',
      audioNombre: 'audio.mp3',
      audio: AUDIO,
      dificultades: [
        { version: 'Facil', texto: escribirOsu(chart('Facil', 0)) },
        { version: 'Dificil', texto: escribirOsu(chart('Dificil', 2)) },
      ],
    });
    const cancion = await extraerCancionDeOsz(new Blob([new Uint8Array(bytes)]));
    expect(cancion.dificultades.map((d) => d.metadata.difficultyName).sort()).toEqual([
      'Dificil',
      'Facil',
    ]);
    expect(new Uint8Array(await cancion.audio.arrayBuffer())).toEqual(AUDIO);
    const dificil = cancion.dificultades.find((d) => d.metadata.difficultyName === 'Dificil')!;
    expect(dificil.notes).toEqual(chart('Dificil', 2).notes);
  });

  it('dos dificultades con el mismo nombre no se pisan', () => {
    const bytes = construirOsz({
      titulo: 'T',
      artista: 'A',
      creador: 'C',
      audioNombre: 'audio.mp3',
      audio: AUDIO,
      dificultades: [
        { version: 'Normal', texto: 'uno' },
        { version: 'Normal', texto: 'dos' },
      ],
    });
    const nombres = Object.keys(unzipSync(bytes)).filter((n) => n.endsWith('.osu'));
    expect(nombres).toHaveLength(2);
    expect(new Set(nombres).size).toBe(2);
  });

  it('sin dificultades falla con un mensaje claro', () => {
    expect(() =>
      construirOsz({
        titulo: 'T',
        artista: 'A',
        creador: 'C',
        audioNombre: 'a.mp3',
        audio: AUDIO,
        dificultades: [],
      }),
    ).toThrow(/al menos una dificultad/);
  });

  it('el nombre del .osu sigue el estilo de osu!', () => {
    expect(nombreDeOsu({ titulo: 'T', artista: 'A', creador: 'C' }, 'Hard')).toBe(
      'A - T (C) [Hard].osu',
    );
  });
});
