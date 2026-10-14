// Tests de T-066: leerCabeceraOsu clasifica un .osu sin parsearlo entero y
// nunca lanza.

import { describe, expect, it } from 'vitest';
import { leerCabeceraOsu } from './cabecera.js';

function osu(general: string[], metadata: string[], dificultad: string[]): string {
  return [
    'osu file format v14',
    '',
    '[General]',
    ...general,
    '',
    '[Metadata]',
    ...metadata,
    '',
    '[Difficulty]',
    ...dificultad,
    '',
    '[HitObjects]',
    '64,192,0,1,0,0:0:0:0:',
  ].join('\n');
}

describe('leerCabeceraOsu', () => {
  it('lee modo, teclas, audio, titulo, artista y version', () => {
    const c = leerCabeceraOsu(
      osu(
        ['AudioFilename: cancion.mp3', 'Mode: 3'],
        ['Title:Canon', 'Artist:Collection', 'Version:Canon - 4K EX'],
        ['CircleSize:4'],
      ),
    );
    expect(c).toEqual({
      modo: 3,
      teclas: 4,
      audio: 'cancion.mp3',
      audioVirtual: false,
      titulo: 'Canon',
      artista: 'Collection',
      version: 'Canon - 4K EX',
    });
  });

  it('detecta audio virtual sin distinguir mayusculas', () => {
    for (const nombre of ['virtual', 'Virtual', 'VIRTUAL']) {
      const c = leerCabeceraOsu(osu([`AudioFilename: ${nombre}`, 'Mode: 3'], [], ['CircleSize:4']));
      expect(c.audioVirtual).toBe(true);
      expect(c.audio).toBe(nombre);
    }
    expect(leerCabeceraOsu(osu(['AudioFilename: virtual.mp3'], [], [])).audioVirtual).toBe(false);
  });

  it('lee las teclas de otros modos y los modos que no son mania', () => {
    expect(leerCabeceraOsu(osu(['Mode: 3'], [], ['CircleSize:7'])).teclas).toBe(7);
    expect(leerCabeceraOsu(osu(['Mode: 0'], [], ['CircleSize:4'])).modo).toBe(0);
  });

  it('ignora BeatmapID y BeatmapSetID de 0 o -1 (mapas no publicados)', () => {
    const sin = leerCabeceraOsu(osu([], ['BeatmapID:0', 'BeatmapSetID:-1'], []));
    expect(sin.beatmapId).toBeUndefined();
    expect(sin.beatmapSetId).toBeUndefined();
    const con = leerCabeceraOsu(osu([], ['BeatmapID:123', 'BeatmapSetID:332673'], []));
    expect(con.beatmapId).toBe(123);
    expect(con.beatmapSetId).toBe(332673);
  });

  it('un Mode o un CircleSize que no son numeros quedan sin definir', () => {
    const c = leerCabeceraOsu(osu(['Mode: tres'], [], ['CircleSize:x']));
    expect(c.modo).toBeUndefined();
    expect(c.teclas).toBeUndefined();
  });

  it('un archivo sin secciones, vacio o basura nunca lanza', () => {
    expect(leerCabeceraOsu('')).toEqual({ audioVirtual: false });
    expect(leerCabeceraOsu('esto no es un osu\n\u0000\u0001')).toEqual({ audioVirtual: false });
    expect(leerCabeceraOsu('Mode: 3\nCircleSize:4')).toEqual({ audioVirtual: false });
  });
});
