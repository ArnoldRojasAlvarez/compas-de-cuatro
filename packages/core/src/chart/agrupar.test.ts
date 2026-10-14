// Tests de T-066 (D5, paso 2): agrupar las dificultades de un .osz en canciones.

import { describe, expect, it } from 'vitest';
import type { Chart } from '../types.js';
import { agruparEnCanciones, piezaDeVersion } from './agrupar.js';

function chart(
  version: string,
  audio: string,
  extra: { title?: string; artist?: string } = {},
): Chart {
  return {
    metadata: {
      title: extra.title ?? 'Piano Beatmap Set',
      artist: extra.artist ?? 'Collection',
      creator: 'Alguien',
      difficultyName: version,
      audioFile: audio,
      previewTime: 0,
    },
    overallDifficulty: 7,
    hpDrain: 5,
    timingPoints: [],
    speedPoints: [],
    notes: [],
  };
}

describe('piezaDeVersion', () => {
  it.each([
    ['Canon - 4K EX', 'Canon'],
    ['La Campanella - 4K Full', 'La Campanella'],
    ['Pathetique (Medley ver.) - 4K EX', 'Pathetique (Medley ver.)'],
    ['A - B - 4K EX', 'A - B'],
    ['  Canon   - 4K', 'Canon'],
    ['4K HELL CIRCUS', ''],
    ['7K Normal', ''],
    ['Easy-4K', ''],
  ])('%s -> "%s"', (version, esperado) => {
    expect(piezaDeVersion(version)).toBe(esperado);
  });
});

describe('agruparEnCanciones: audio virtual', () => {
  it('agrupa por pieza, con el Title del set como conjunto, y deja la version sin " - " en el grupo del set', () => {
    const charts = [
      chart('4K HELL CIRCUS', 'virtual'),
      chart('Canon - 4K EX', 'virtual'),
      chart('Canon - 4K Normal', 'Virtual'),
      chart('La Campanella - 4K Full', 'virtual'),
      chart('Pathetique (Medley ver.) - 4K EX', 'virtual'),
    ];
    const grupos = agruparEnCanciones(charts);
    expect(grupos.map((g) => g.titulo)).toEqual([
      'Piano Beatmap Set',
      'Canon',
      'La Campanella',
      'Pathetique (Medley ver.)',
    ]);
    expect(grupos.map((g) => g.indices)).toEqual([[0], [1, 2], [3], [4]]);
    expect(grupos.map((g) => g.conjunto)).toEqual([
      undefined,
      'Piano Beatmap Set',
      'Piano Beatmap Set',
      'Piano Beatmap Set',
    ]);
    expect(grupos.every((g) => g.artista === 'Collection')).toBe(true);
    expect(grupos.map((g) => g.clave)).toEqual([
      'v|',
      'v|canon',
      'v|la campanella',
      'v|pathetique (medley ver.)',
    ]);
  });

  it('"Canon - 4K EX" y "La Campanella - 4K Full" dan dos canciones', () => {
    const grupos = agruparEnCanciones([
      chart('Canon - 4K EX', 'virtual'),
      chart('La Campanella - 4K Full', 'virtual'),
    ]);
    expect(grupos.map((g) => g.titulo)).toEqual(['Canon', 'La Campanella']);
  });

  it('la pieza se compara sin distinguir mayusculas ni espacios de mas', () => {
    const grupos = agruparEnCanciones([
      chart('Canon - 4K EX', 'virtual'),
      chart('canon  - 4K NM', 'virtual'),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.titulo).toBe('Canon');
  });

  it('un set de una sola obra con versiones 7K Normal y 7K Hyper queda en un unico grupo', () => {
    const grupos = agruparEnCanciones([
      chart('7K Hyper', 'virtual', { title: 'Obra' }),
      chart('7K Normal', 'virtual', { title: 'Obra' }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]).toMatchObject({ titulo: 'Obra', indices: [0, 1] });
    expect(grupos[0]!.conjunto).toBeUndefined();
  });

  it('si la pieza es igual al Title del set no hay conjunto', () => {
    const grupos = agruparEnCanciones([chart('Obra - 4K', 'virtual', { title: 'Obra' })]);
    expect(grupos[0]).toMatchObject({ titulo: 'Obra' });
    expect(grupos[0]!.conjunto).toBeUndefined();
  });
});

describe('agruparEnCanciones: audio real', () => {
  it('dos pistas distintas dan dos canciones; el Title distinto no cambia el titulo', () => {
    const grupos = agruparEnCanciones([
      chart('Normal', 'uno.mp3', { title: 'Uno' }),
      chart('Normal', 'dos.mp3', { title: 'Dos' }),
    ]);
    expect(grupos.map((g) => g.titulo)).toEqual(['Uno', 'Dos']);
    expect(grupos.map((g) => g.clave)).toEqual(['a|uno.mp3', 'a|dos.mp3']);
    expect(grupos.every((g) => g.conjunto === undefined)).toBe(true);
  });

  it('dos pistas que comparten Title llevan el nombre del audio sin extension', () => {
    const grupos = agruparEnCanciones([
      chart('Normal', 'musica/Pista A.mp3'),
      chart('Normal', 'pista-b.ogg'),
      chart('Hard', 'musica\\Pista A.mp3'),
    ]);
    expect(grupos.map((g) => g.titulo)).toEqual([
      'Piano Beatmap Set (Pista A)',
      'Piano Beatmap Set (pista-b)',
    ]);
    expect(grupos[0]!.indices).toEqual([0, 2]);
  });

  it('con Version "Easy - 4K" y "Hard - 4K" y una sola pista da UN grupo (la pieza solo cuenta en virtual)', () => {
    const grupos = agruparEnCanciones([
      chart('Easy - 4K', 'audio.mp3', { title: 'Cancion' }),
      chart('Hard - 4K', 'audio.mp3', { title: 'Cancion' }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]).toMatchObject({ titulo: 'Cancion', indices: [0, 1] });
    expect(grupos[0]!.conjunto).toBeUndefined();
  });

  it('el AudioFilename se compara normalizado (mayusculas, ./ y barras)', () => {
    const grupos = agruparEnCanciones([
      chart('A', './Audio.MP3'),
      chart('B', 'audio.mp3'),
      chart('C', ' audio.mp3 '),
    ]);
    expect(grupos).toHaveLength(1);
  });

  it('real y virtual nunca se mezclan en un grupo', () => {
    const grupos = agruparEnCanciones([
      chart('Normal', 'audio.mp3'),
      chart('Canon - 4K', 'virtual'),
      chart('Hard', 'audio.mp3'),
      chart('4K sola', 'virtual'),
    ]);
    expect(grupos.map((g) => g.indices)).toEqual([[0, 2], [1], [3]]);
    expect(grupos.map((g) => g.clave.charAt(0))).toEqual(['a', 'v', 'v']);
  });

  it('un .osz comun (una pista) da un solo grupo con el Title y artista de siempre', () => {
    const grupos = agruparEnCanciones([chart('Normal', 'a.mp3', { title: 'T', artist: 'A' })]);
    expect(grupos).toEqual([{ clave: 'a|a.mp3', titulo: 'T', artista: 'A', indices: [0] }]);
  });

  it('sin dificultades no hay grupos', () => {
    expect(agruparEnCanciones([])).toEqual([]);
  });
});
