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

// T-049: fondo y video dentro del .osz.
describe('construirOsz: fondo y video (T-049)', () => {
  const base = {
    titulo: 'T',
    artista: 'A',
    creador: 'C',
    audioNombre: 'audio.mp3',
    audio: AUDIO,
    dificultades: [{ version: 'Normal', texto: 'x' }],
  };

  it('mete fondo y video al zip con sus nombres y bytes', () => {
    const zip = unzipSync(
      construirOsz({
        ...base,
        fondo: { nombre: 'img/bg.jpg', bytes: new Uint8Array([1, 2, 3]) },
        video: { nombre: 'vid.mp4', bytes: new Uint8Array([4, 5]) },
      }),
    );
    expect(Array.from(zip['img/bg.jpg']!)).toEqual([1, 2, 3]);
    expect(Array.from(zip['vid.mp4']!)).toEqual([4, 5]);
    expect(Array.from(zip['audio.mp3']!)).toEqual(Array.from(AUDIO));
  });

  it('sin fondo ni video el zip no trae nada de mas', () => {
    const nombres = Object.keys(unzipSync(construirOsz(base)));
    expect(nombres.sort()).toEqual(['A - T (C) [Normal].osu', 'audio.mp3']);
  });

  it('no recomprime el fondo ni el video (level 0)', () => {
    // 20000 ceros comprimirian a unos pocos bytes con deflate: si el zip
    // pesa mas que los datos, se guardaron tal cual.
    const grande = new Uint8Array(20000);
    const bytes = construirOsz({
      ...base,
      fondo: { nombre: 'bg.png', bytes: grande },
      video: { nombre: 'v.webm', bytes: grande },
    });
    expect(bytes.length).toBeGreaterThan(40000);
  });

  it('un .osu cuyo nombre choca con el del fondo no lo pisa', () => {
    const bytes = construirOsz({
      ...base,
      fondo: { nombre: 'A - T (C) [Normal].osu', bytes: new Uint8Array([1]) },
    });
    const nombres = Object.keys(unzipSync(bytes));
    expect(nombres).toHaveLength(3);
  });
});
