// Tests de T-005 (capa de importacion de .osz).
//
// Mismo criterio que packages/core/src/chart/osu.test.ts: los valores
// esperados estan tipeados a mano, no derivados de las mismas funciones que
// se prueban. El .osu de ejemplo va embebido como string; el zip se arma
// en el momento con fflate.zipSync (la misma libreria que usa osz.ts, pero
// en sentido inverso) para no depender de ningun archivo en disco.

import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import {
  buscarEnZip,
  elegirArchivoOsu,
  elegirArchivosOsu,
  extraerCancionDeOsz,
  extraerMapaDeOsz,
  mimeDesdeNombre,
} from './osz.js';

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

describe('elegirArchivosOsu', () => {
  it('devuelve todos los .osu, ordenados alfabeticamente (T-011)', () => {
    expect(elegirArchivosOsu(['Insane.osu', 'Easy.osu', 'Normal.osu', 'audio.mp3'])).toEqual([
      'Easy.osu',
      'Insane.osu',
      'Normal.osu',
    ]);
  });

  it('con un solo .osu devuelve un array de un elemento', () => {
    expect(elegirArchivosOsu(['mapa.osu', 'audio.mp3'])).toEqual(['mapa.osu']);
  });

  it('sin ningun .osu devuelve un array vacio, no null', () => {
    expect(elegirArchivosOsu(['audio.mp3', 'fondo.jpg'])).toEqual([]);
  });

  it('elegirArchivoOsu (singular) sigue siendo el primer elemento de elegirArchivosOsu', () => {
    const nombres = ['Insane.osu', 'Easy.osu', 'audio.mp3'];
    expect(elegirArchivoOsu(nombres)).toBe(elegirArchivosOsu(nombres)[0]);
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

// T-011, "Parte A": extraerCancionDeOsz reemplaza a extraerMapaDeOsz para
// el song select (guarda TODAS las dificultades, no solo la primera).
describe('extraerCancionDeOsz', () => {
  const OSU_SEGUNDA_DIFICULTAD = OSU_DE_PRUEBA.replace('Version:Normal', 'Version:Insane');

  it('con un solo .osu, se comporta como extraerMapaDeOsz pero con dificultades: [chart]', async () => {
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'audio.wav': new Uint8Array([1, 2, 3, 4, 5]),
    });

    const resultado = await extraerCancionDeOsz(osz);
    expect(resultado.titulo).toBe('Cancion de prueba');
    expect(resultado.artista).toBe('Artista de prueba');
    expect(resultado.audio.type).toBe('audio/wav');
    expect(resultado.audio.size).toBe(5);
    expect(resultado.dificultades).toHaveLength(1);
    expect(resultado.dificultades[0]!.notes).toHaveLength(3);
  });

  it('con varias dificultades, las junta todas bajo una cancion con un solo audio', async () => {
    const osz = armarOsz({
      'Normal.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'Insane.osu': new TextEncoder().encode(OSU_SEGUNDA_DIFICULTAD),
      'audio.wav': new Uint8Array([1, 2, 3]),
    });

    const resultado = await extraerCancionDeOsz(osz);
    expect(resultado.dificultades).toHaveLength(2);
    // Orden alfabetico de archivo (Insane.osu antes que Normal.osu), no el
    // orden de dificultad: mismo criterio determinista que elegirArchivosOsu.
    expect(resultado.dificultades.map((d) => d.metadata.difficultyName)).toEqual([
      'Insane',
      'Normal',
    ]);
    // Un solo Blob de audio para las dos, no uno por dificultad.
    expect(resultado.audio.size).toBe(3);
  });

  it('una dificultad invalida (Mode distinto de 3) se saltea sin romper las demas', async () => {
    const osuStd = OSU_DE_PRUEBA.replace('Mode: 3', 'Mode: 0').replace(
      'Version:Normal',
      'Version:Standard',
    );
    const osz = armarOsz({
      'Normal.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'Standard.osu': new TextEncoder().encode(osuStd),
      'audio.wav': new Uint8Array([1]),
    });

    const resultado = await extraerCancionDeOsz(osz);
    expect(resultado.dificultades).toHaveLength(1);
    expect(resultado.dificultades[0]!.metadata.difficultyName).toBe('Normal');
  });

  it('rechaza un .osz sin ningun archivo .osu', async () => {
    const osz = armarOsz({ 'audio.wav': new Uint8Array([1, 2, 3]) });
    await expect(extraerCancionDeOsz(osz)).rejects.toThrow(/\.osu/);
  });

  it('rechaza un .osz donde NINGUNA dificultad parsea', async () => {
    const osuInvalido = OSU_DE_PRUEBA.replace('Mode: 3', 'Mode: 0');
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(osuInvalido),
      'audio.wav': new Uint8Array([1, 2, 3]),
    });
    await expect(extraerCancionDeOsz(osz)).rejects.toThrow();
  });

  it('rechaza si falta el audio del .osu elegido para el audio de la cancion', async () => {
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      // sin 'audio.wav'
    });
    await expect(extraerCancionDeOsz(osz)).rejects.toThrow(/audio\.wav/);
  });
});

// T-054: el audio es el de la primera dificultad cuyo archivo exista.
describe('extraerCancionDeOsz: audio ausente en la primera dificultad (T-054)', () => {
  function osuConAudio(version: string, audio: string): Uint8Array {
    const texto = OSU_DE_PRUEBA.replace('Version:Normal', `Version:${version}`).replace(
      'AudioFilename: audio.wav',
      `AudioFilename: ${audio}`,
    );
    return new TextEncoder().encode(texto);
  }

  it('si la primera declara un audio que no esta, usa el de la siguiente que si lo tiene', async () => {
    const osz = armarOsz({
      'A.osu': osuConAudio('A', 'falta.mp3'),
      'B.osu': osuConAudio('B', 'real.ogg'),
      'real.ogg': new Uint8Array([9, 9, 9]),
    });
    const r = await extraerCancionDeOsz(osz);
    expect(r.audio.size).toBe(3);
    expect(r.audio.type).toBe('audio/ogg');
    // Las dos dificultades se importan igual.
    expect(r.dificultades.map((d) => d.metadata.difficultyName)).toEqual(['A', 'B']);
  });

  it('si la primera si tiene su audio, se queda con ese aunque otra declare otro', async () => {
    const osz = armarOsz({
      'A.osu': osuConAudio('A', 'uno.mp3'),
      'B.osu': osuConAudio('B', 'dos.ogg'),
      'uno.mp3': new Uint8Array([1]),
      'dos.ogg': new Uint8Array([2, 2]),
    });
    const r = await extraerCancionDeOsz(osz);
    expect(r.audio.size).toBe(1);
    expect(r.audio.type).toBe('audio/mpeg');
  });

  it('si ninguna dificultad tiene su audio, falla nombrando el de la primera', async () => {
    const osz = armarOsz({
      'A.osu': osuConAudio('A', 'falta1.mp3'),
      'B.osu': osuConAudio('B', 'falta2.mp3'),
    });
    await expect(extraerCancionDeOsz(osz)).rejects.toThrow(/falta1\.mp3/);
  });
});

// T-049: fondo, video y busqueda tolerante en el zip.
describe('mimeDesdeNombre (T-049)', () => {
  it.each([
    ['clip.mp4', 'video/mp4'],
    ['clip.m4v', 'video/mp4'],
    ['clip.webm', 'video/webm'],
    ['fondo.webp', 'image/webp'],
    ['anim.gif', 'image/gif'],
    ['FONDO.JPEG', 'image/jpeg'],
    ['clip.avi', 'application/octet-stream'],
  ])('%s -> %s', (nombre, esperado) => {
    expect(mimeDesdeNombre(nombre)).toBe(esperado);
  });
});

describe('buscarEnZip', () => {
  const a = new Uint8Array([1]);
  const b = new Uint8Array([2]);

  it('prefiere la coincidencia exacta', () => {
    expect(buscarEnZip({ 'bg.jpg': a, 'BG.JPG': b }, 'BG.JPG')).toBe(b);
  });

  it('encuentra BG.JPG cuando se pide bg.jpg', () => {
    expect(buscarEnZip({ 'BG.JPG': a }, 'bg.jpg')).toBe(a);
  });

  it('trata \\ como / y ignora el ./ inicial', () => {
    expect(buscarEnZip({ 'img/fondo.png': a }, 'img\\fondo.png')).toBe(a);
    expect(buscarEnZip({ './img/fondo.png': a }, 'img/fondo.png')).toBe(a);
    expect(buscarEnZip({ 'img/fondo.png': a }, './img/Fondo.PNG')).toBe(a);
  });

  it('devuelve undefined si no hay nada parecido', () => {
    expect(buscarEnZip({ 'otro.jpg': a }, 'bg.jpg')).toBeUndefined();
  });

  it('no confunde dos rutas distintas que solo comparten el nombre final', () => {
    expect(buscarEnZip({ 'a/bg.jpg': a }, 'b/bg.jpg')).toBeUndefined();
  });
});

describe('extraerCancionDeOsz: fondo y video (T-049)', () => {
  function osu(version: string, eventos: string[]): Uint8Array {
    const texto = OSU_DE_PRUEBA.replace('Version:Normal', `Version:${version}`).replace(
      '[TimingPoints]',
      `[Events]\n${eventos.join('\n')}\n\n[TimingPoints]`,
    );
    return new TextEncoder().encode(texto);
  }

  it('un bg.JPG en el zip y "bg.jpg" en el .osu importa con fondo', async () => {
    const osz = armarOsz({
      'mapa.osu': osu('Normal', ['0,0,"bg.jpg",0,0']),
      'audio.wav': new Uint8Array([1]),
      'bg.JPG': new Uint8Array([7, 7, 7, 7]),
    });
    const r = await extraerCancionDeOsz(osz);
    expect(r.background).toBeDefined();
    expect(r.background!.size).toBe(4);
    expect(r.background!.type).toBe('image/jpeg');
  });

  it('el audio tambien se encuentra con otra capitalizacion', async () => {
    const osz = armarOsz({
      'mapa.osu': osu('Normal', []),
      'AUDIO.WAV': new Uint8Array([1, 2]),
    });
    const r = await extraerCancionDeOsz(osz);
    expect(r.audio.size).toBe(2);
  });

  it('el fondo se toma de la segunda dificultad si la primera no declara uno', async () => {
    // Orden alfabetico: A.osu (sin fondo) antes que B.osu (con fondo).
    const osz = armarOsz({
      'A.osu': osu('A', []),
      'B.osu': osu('B', ['0,0,"b.png",0,0']),
      'audio.wav': new Uint8Array([1]),
      'b.png': new Uint8Array([5, 5, 5]),
    });
    const r = await extraerCancionDeOsz(osz);
    expect(r.background!.size).toBe(3);
    expect(r.background!.type).toBe('image/png');
  });

  it('si la primera declara un fondo que no esta en el zip, usa el de la siguiente', async () => {
    const osz = armarOsz({
      'A.osu': osu('A', ['0,0,"falta.jpg",0,0']),
      'B.osu': osu('B', ['0,0,"b.png",0,0']),
      'audio.wav': new Uint8Array([1]),
      'b.png': new Uint8Array([5, 5, 5]),
    });
    const r = await extraerCancionDeOsz(osz);
    expect(r.background!.size).toBe(3);
  });

  it('sin fondo declarado no hay background ni video', async () => {
    const osz = armarOsz({ 'mapa.osu': osu('Normal', []), 'audio.wav': new Uint8Array([1]) });
    const r = await extraerCancionDeOsz(osz);
    expect(r.background).toBeUndefined();
    expect(r.video).toBeUndefined();
    expect(r.videoOffset).toBeUndefined();
  });

  it('importa un video mp4 con su offset', async () => {
    const osz = armarOsz({
      'mapa.osu': osu('Normal', ['Video,-120,"vid.mp4"']),
      'audio.wav': new Uint8Array([1]),
      'vid.mp4': new Uint8Array([4, 4, 4, 4, 4]),
    });
    const r = await extraerCancionDeOsz(osz);
    expect(r.video!.size).toBe(5);
    expect(r.video!.type).toBe('video/mp4');
    expect(r.videoOffset).toBe(-120);
  });

  it('un video .avi se ignora en silencio: la cancion importa sin video', async () => {
    const osz = armarOsz({
      'mapa.osu': osu('Normal', ['Video,0,"vid.avi"', '0,0,"bg.jpg",0,0']),
      'audio.wav': new Uint8Array([1]),
      'vid.avi': new Uint8Array([4, 4]),
      'bg.jpg': new Uint8Array([9]),
    });
    const r = await extraerCancionDeOsz(osz);
    expect(r.video).toBeUndefined();
    expect(r.videoOffset).toBeUndefined();
    expect(r.background).toBeDefined();
    expect(r.dificultades).toHaveLength(1);
  });

  it.each(['avi', 'flv', 'mpg', 'wmv'])(
    'la extension .%s no se considera reproducible',
    async (ext) => {
      const osz = armarOsz({
        'mapa.osu': osu('Normal', [`Video,0,"vid.${ext}"`]),
        'audio.wav': new Uint8Array([1]),
        [`vid.${ext}`]: new Uint8Array([4]),
      });
      expect((await extraerCancionDeOsz(osz)).video).toBeUndefined();
    },
  );

  it('si la primera dificultad declara un .avi y la segunda un .webm, usa el .webm con su offset', async () => {
    const osz = armarOsz({
      'A.osu': osu('A', ['Video,10,"vid.avi"']),
      'B.osu': osu('B', ['Video,300,"vid.webm"']),
      'audio.wav': new Uint8Array([1]),
      'vid.avi': new Uint8Array([1]),
      'vid.webm': new Uint8Array([2, 2]),
    });
    const r = await extraerCancionDeOsz(osz);
    expect(r.video!.type).toBe('video/webm');
    expect(r.videoOffset).toBe(300);
  });

  it('un video declarado que no esta en el zip no hace fallar la importacion', async () => {
    const osz = armarOsz({
      'mapa.osu': osu('Normal', ['Video,0,"falta.mp4"']),
      'audio.wav': new Uint8Array([1]),
    });
    expect((await extraerCancionDeOsz(osz)).video).toBeUndefined();
  });
});
