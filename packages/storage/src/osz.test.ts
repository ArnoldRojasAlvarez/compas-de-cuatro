// Tests de T-005 (capa de importacion de .osz).
//
// Mismo criterio que packages/core/src/chart/osu.test.ts: los valores
// esperados estan tipeados a mano, no derivados de las mismas funciones que
// se prueban. El .osu de ejemplo va embebido como string; el zip se arma
// en el momento con fflate.zipSync (la misma libreria que usa osz.ts, pero
// en sentido inverso) para no depender de ningun archivo en disco.

import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { elegirArchivoOsu, extraerMapaDeOsz, mimeDesdeNombre } from './osz.js';

const OSU_DE_PRUEBA = `osu file format v14

[General]
AudioFilename: audio.wav
Mode: 3

[Metadata]
Title:Cancion de prueba
Artist:Artista de prueba
Creator:Arnold
Version:Normal

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:6

[TimingPoints]
0,500,4,2,1,50,1,0

[HitObjects]
64,192,0,1,0,0:0:0:0:
192,192,500,1,0,0:0:0:0:
320,192,1000,128,0,1800:0:0:0:0:
`;

function armarOsz(entradas: Record<string, Uint8Array>): Blob {
  const zip = zipSync(entradas);
  return new Blob([zip], { type: 'application/zip' });
}

describe('elegirArchivoOsu', () => {
  it('devuelve el unico .osu presente', () => {
    expect(elegirArchivoOsu(['mapa.osu', 'audio.mp3', 'fondo.jpg'])).toBe('mapa.osu');
  });

  it('con varios .osu, elige el primero en orden alfabetico', () => {
    expect(elegirArchivoOsu(['Insane.osu', 'Easy.osu', 'Normal.osu'])).toBe('Easy.osu');
  });

  it('no distingue mayusculas de minusculas en la extension', () => {
    expect(elegirArchivoOsu(['MAPA.OSU'])).toBe('MAPA.OSU');
  });

  it('devuelve null si no hay ningun .osu', () => {
    expect(elegirArchivoOsu(['audio.mp3', 'fondo.jpg'])).toBeNull();
  });
});

describe('mimeDesdeNombre', () => {
  it.each([
    ['cancion.mp3', 'audio/mpeg'],
    ['cancion.ogg', 'audio/ogg'],
    ['cancion.wav', 'audio/wav'],
    ['fondo.jpg', 'image/jpeg'],
    ['fondo.jpeg', 'image/jpeg'],
    ['fondo.png', 'image/png'],
    ['algo.raro', 'application/octet-stream'],
    ['sin_extension', 'application/octet-stream'],
  ])('%s -> %s', (nombre, esperado) => {
    expect(mimeDesdeNombre(nombre)).toBe(esperado);
  });
});

describe('extraerMapaDeOsz', () => {
  it('descomprime, parsea el .osu y arma el Blob de audio con el mime correcto', async () => {
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'audio.wav': new Uint8Array([1, 2, 3, 4, 5]),
    });

    const resultado = await extraerMapaDeOsz(osz);

    expect(resultado.chart.metadata.title).toBe('Cancion de prueba');
    expect(resultado.chart.notes).toHaveLength(3);
    expect(resultado.audio.type).toBe('audio/wav');
    expect(resultado.audio.size).toBe(5);
    expect(resultado.background).toBeUndefined();
  });

  it('la hold note del .osu llega con su endTime hasta el Chart final', async () => {
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'audio.wav': new Uint8Array([1, 2, 3]),
    });

    const resultado = await extraerMapaDeOsz(osz);
    const hold = resultado.chart.notes[2]!;
    expect(hold.kind).toBe('hold');
    if (hold.kind === 'hold') {
      expect(hold.time).toBe(1000);
      expect(hold.endTime).toBe(1800);
    }
  });

  it('rechaza un .osz sin ningun archivo .osu', async () => {
    const osz = armarOsz({ 'audio.wav': new Uint8Array([1, 2, 3]) });
    await expect(extraerMapaDeOsz(osz)).rejects.toThrow(/\.osu/);
  });

  it('rechaza un .osz cuyo .osu no parsea (por ejemplo Mode distinto de 3)', async () => {
    const osuInvalido = OSU_DE_PRUEBA.replace('Mode: 3', 'Mode: 0');
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(osuInvalido),
      'audio.wav': new Uint8Array([1, 2, 3]),
    });
    await expect(extraerMapaDeOsz(osz)).rejects.toThrow(/Mode/);
  });

  it('rechaza un .osz al que le falta el archivo de audio declarado en AudioFilename', async () => {
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      // sin 'audio.wav'
    });
    await expect(extraerMapaDeOsz(osz)).rejects.toThrow(/audio\.wav/);
  });
});
