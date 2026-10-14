// Tests de T-005 (capa de importacion de .osz).
//
// Mismo criterio que packages/core/src/chart/osu.test.ts: los valores
// esperados estan tipeados a mano, no derivados de las mismas funciones que
// se prueban. El .osu de ejemplo va embebido como string; el zip se arma
// en el momento con fflate.zipSync (la misma libreria que usa osz.ts, pero
// en sentido inverso) para no depender de ningun archivo en disco.

import { describe, expect, it } from 'vitest';
import { ErrorDeImportacion } from './errores.js';
import { zipSync } from 'fflate';
import {
  buscarEnZip,
  elegirArchivoOsu,
  elegirArchivosOsu,
  analizarOsz,
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
    expect(resultado.audio!.type).toBe('audio/wav');
    expect(resultado.audio!.size).toBe(5);
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
    expect(resultado.audio!.size).toBe(3);
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

  it('si la primera declara un audio que no esta, ese grupo se omite con aviso y entra el de la siguiente (T-066 paso 2)', async () => {
    // Antes (T-054) las dos dificultades compartian la pista de la segunda; con
    // la agrupacion por audio de T-066 son dos canciones distintas.
    const osz = armarOsz({
      'A.osu': osuConAudio('A', 'falta.mp3'),
      'B.osu': osuConAudio('B', 'real.ogg'),
      'real.ogg': new Uint8Array([9, 9, 9]),
    });
    const analisis = await analizarOsz(osz);
    expect(analisis.canciones).toHaveLength(1);
    const r = analisis.canciones[0]!;
    expect(r.audio!.size).toBe(3);
    expect(r.audio!.type).toBe('audio/ogg');
    expect(r.dificultades.map((d) => d.metadata.difficultyName)).toEqual(['B']);
    expect(analisis.avisos).toEqual([
      expect.stringContaining('falta el audio "falta.mp3"'),
    ]);
  });

  it('dos dificultades que declaran la misma pista (escrita distinto) son una sola cancion', async () => {
    const osz = armarOsz({
      'A.osu': osuConAudio('A', 'Real.OGG'),
      'B.osu': osuConAudio('B', './real.ogg'),
      'real.ogg': new Uint8Array([9, 9, 9]),
    });
    const r = await extraerCancionDeOsz(osz);
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
    expect(r.audio!.size).toBe(1);
    expect(r.audio!.type).toBe('audio/mpeg');
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
    expect(r.audio!.size).toBe(2);
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

// ---------------------------------------------------------------------------
// T-066: errores con causa (tabla "Errores" del ticket) y avisos de lo omitido
// ---------------------------------------------------------------------------

/** Un .osu con `Mode`, teclas, audio y version a gusto; el resto igual al de prueba. */
function osuCon(opciones: {
  modo?: number;
  teclas?: number;
  audio?: string;
  version?: string;
  notas?: string[];
  sinHp?: boolean;
}): string {
  const { modo = 3, teclas = 4, audio = 'audio.wav', version = 'Normal' } = opciones;
  const notas = opciones.notas ?? ['64,192,0,1,0,0:0:0:0:', '192,192,500,1,0,0:0:0:0:'];
  let texto = OSU_DE_PRUEBA.replace('AudioFilename: audio.wav', `AudioFilename: ${audio}`)
    .replace('Mode: 3', `Mode: ${modo}`)
    .replace('Version:Normal', `Version:${version}`)
    .replace('CircleSize:4', `CircleSize:${teclas}`)
    .replace(/\[HitObjects\][\s\S]*$/, `[HitObjects]\n${notas.join('\n')}\n`);
  if (opciones.sinHp === true) texto = texto.replace('HPDrainRate:5\n', '');
  return texto;
}

function oszCon(osus: Record<string, string>, extra: Record<string, Uint8Array> = {}): Blob {
  const entradas: Record<string, Uint8Array> = { ...extra };
  for (const [nombre, texto] of Object.entries(osus)) {
    entradas[nombre] = new TextEncoder().encode(texto);
  }
  return armarOsz(entradas);
}

const AUDIO = { 'audio.wav': new Uint8Array([1, 2, 3]) };

/** Dos notas con keysound (T-066, paso 3): sus muestras son a.ogg y b.ogg. */
const NOTAS_VIRTUALES = ['64,192,0,1,0,0:0:0:50:a.ogg', '192,192,500,1,0,0:0:0:50:b.ogg'];

async function errorDe(archivo: Blob): Promise<ErrorDeImportacion> {
  try {
    await analizarOsz(archivo);
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorDeImportacion);
    return error as ErrorDeImportacion;
  }
  throw new Error('Se esperaba que analizarOsz lanzara.');
}

describe('analizarOsz: errores con causa (T-066)', () => {
  it('es-skin: un .osk por nombre', async () => {
    const e = await errorDe(new File([new Uint8Array([1])], 'skin.osk'));
    expect(e.codigo).toBe('es-skin');
    expect(e.message).toBe('Es una skin (.osk): se carga desde Ajustes, en Skin.');
  });

  it('no-es-osz: otra extension (un .osz o un .zip pasan)', async () => {
    const e = await errorDe(new File([new Uint8Array([1])], 'foto.png'));
    expect(e.codigo).toBe('no-es-osz');
    expect(e.message).toBe('No es un mapa de osu!: Tetra importa archivos .osz.');
    const zip = oszCon({ 'a.osu': osuCon({}) }, AUDIO);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    for (const nombre of ['a.osz', 'A.ZIP']) {
      await expect(analizarOsz(new File([bytes], nombre))).resolves.toBeDefined();
    }
  });

  it('muy-grande: mas de 300 MB, redondeado hacia arriba, sin leer el archivo', async () => {
    const falso = {
      size: 301 * 1024 * 1024 + 1,
      arrayBuffer: () => Promise.reject(new Error('no')),
    };
    const e = await errorDe(falso as unknown as Blob);
    expect(e.codigo).toBe('muy-grande');
    expect(e.message).toBe('El archivo pesa 302 MB y el máximo es 300 MB.');
  });

  it('lectura: el archivo no se puede leer', async () => {
    const falso = { size: 10, arrayBuffer: () => Promise.reject(new Error('NotReadableError')) };
    const e = await errorDe(falso as unknown as Blob);
    expect(e.codigo).toBe('lectura');
    expect(e.message).toBe(
      'No se pudo leer el archivo. Puede que se haya movido o borrado mientras se importaba.',
    );
  });

  it('zip-danado: bytes basura', async () => {
    const e = await errorDe(new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]));
    expect(e.codigo).toBe('zip-danado');
    expect(e.message).toBe('El archivo está dañado o no es un .osz: no se pudo abrir como zip.');
    expect(e.cause).toBeDefined();
  });

  it('sin-osu: un zip sin ningun .osu', async () => {
    const e = await errorDe(armarOsz({ 'audio.wav': new Uint8Array([1]) }));
    expect(e.codigo).toBe('sin-osu');
    expect(e.message).toBe('El .osz no trae ningún mapa (.osu).');
  });

  it('sin-mania: solo Mode 0', async () => {
    const e = await errorDe(oszCon({ 'a.osu': osuCon({ modo: 0 }) }, AUDIO));
    expect(e.codigo).toBe('sin-mania');
    expect(e.message).toBe(
      'Ninguna dificultad es de osu!mania: el .osz es de otro modo de juego (osu!, taiko o catch).',
    );
  });

  it('sin-4k: solo 7K, con la cantidad siempre', async () => {
    const e = await errorDe(oszCon({ 'a.osu': osuCon({ teclas: 7 }) }, AUDIO));
    expect(e.codigo).toBe('sin-4k');
    expect(e.message).toBe('Ninguna dificultad es de 4 teclas: el .osz trae solo mapas de 7K (1).');
  });

  it('sin-4k: 5K, 7K y 10K en orden ascendente y con " y " al final', async () => {
    const osus: Record<string, string> = {};
    for (let i = 0; i < 15; i++) osus[`5k${i}.osu`] = osuCon({ teclas: 5, version: `v${i}` });
    for (let i = 0; i < 15; i++) osus[`7k${i}.osu`] = osuCon({ teclas: 7, version: `w${i}` });
    for (let i = 0; i < 69; i++) osus[`10k${i}.osu`] = osuCon({ teclas: 10, version: `x${i}` });
    const e = await errorDe(oszCon(osus, AUDIO));
    expect(e.codigo).toBe('sin-4k');
    expect(e.message).toBe(
      'Ninguna dificultad es de 4 teclas: el .osz trae solo mapas de 5K (15), 7K (15) y 10K (69).',
    );
  });

  it('osu-invalido: 4K que no parsea, con el error del parser de la primera', async () => {
    const e = await errorDe(oszCon({ 'a.osu': osuCon({ sinHp: true }) }, AUDIO));
    expect(e.codigo).toBe('osu-invalido');
    expect(e.message).toBe(
      'Ninguna dificultad de 4 teclas se pudo leer. Falta el campo HPDrainRate en [Difficulty].',
    );
  });

  it('audio-faltante: 4K sin el audio que pide', async () => {
    const e = await errorDe(oszCon({ 'a.osu': osuCon({ audio: 'musica.mp3' }) }));
    expect(e.codigo).toBe('audio-faltante');
    expect(e.message).toBe('Falta el audio: el mapa pide "musica.mp3" y el .osz no lo trae.');
  });

  it('audio-faltante gana sobre sin-4k cuando hay 7K y 4K sin audio', async () => {
    const e = await errorDe(
      oszCon({
        'a.osu': osuCon({ teclas: 7, version: 'siete' }),
        'b.osu': osuCon({ audio: 'x.mp3' }),
      }),
    );
    expect(e.codigo).toBe('audio-faltante');
  });

  it('muestras-faltantes: AudioFilename virtual sin ninguna de sus muestras (el set de piano roto)', async () => {
    const e = await errorDe(
      oszCon({
        'a.osu': osuCon({ audio: 'virtual', notas: NOTAS_VIRTUALES }),
        'b.osu': osuCon({ audio: 'Virtual', version: 'B', notas: NOTAS_VIRTUALES }),
      }),
    );
    expect(e.codigo).toBe('muestras-faltantes');
    expect(e.message).toBe(
      'Falta el audio virtual: ninguna de las 2 muestras de sonido que pide el mapa viene en el .osz.',
    );
  });
});

describe('analizarOsz: avisos de lo omitido (T-066)', () => {
  it('cuenta y redacta lo que se deja afuera', async () => {
    const r = await analizarOsz(
      oszCon(
        {
          '1.osu': osuCon({}),
          '2.osu': osuCon({ teclas: 7, version: 'a' }),
          '3.osu': osuCon({ teclas: 7, version: 'b' }),
          '4.osu': osuCon({ teclas: 5, version: 'c' }),
          '5.osu': osuCon({ modo: 0, version: 'd' }),
          '6.osu': osuCon({ version: 'e', sinHp: true }),
        },
        AUDIO,
      ),
    );
    expect(r.canciones[0]!.dificultades).toHaveLength(1);
    expect(r.omitidas).toEqual({ otroModo: 1, otrasTeclas: { 5: 1, 7: 2 }, invalidas: 1 });
    expect(r.avisos).toEqual([
      'Se omitieron 3 dificultades de otras teclas: 5K (1) y 7K (2).',
      'Se omitió 1 dificultad que no es de osu!mania.',
      'Se omitió 1 dificultad que no se pudo leer.',
    ]);
  });

  it('singular y plural de cada aviso', async () => {
    const r = await analizarOsz(
      oszCon(
        {
          '1.osu': osuCon({}),
          '2.osu': osuCon({ teclas: 7, version: 'a' }),
          '3.osu': osuCon({ modo: 1, version: 'b' }),
          '4.osu': osuCon({ modo: 2, version: 'c' }),
          '5.osu': osuCon({ version: 'd', sinHp: true }),
          '6.osu': osuCon({ version: 'e', sinHp: true }),
        },
        AUDIO,
      ),
    );
    expect(r.avisos).toEqual([
      'Se omitió 1 dificultad de otras teclas: 7K (1).',
      'Se omitieron 2 dificultades que no son de osu!mania.',
      'Se omitieron 2 dificultades que no se pudieron leer.',
    ]);
  });

  it('sin nada omitido no hay avisos', async () => {
    const r = await analizarOsz(oszCon({ '1.osu': osuCon({}) }, AUDIO));
    expect(r.avisos).toEqual([]);
    expect(r.omitidas).toEqual({ otroModo: 0, otrasTeclas: {}, invalidas: 0 });
  });

  it('un grupo virtual sin sus muestras se omite con aviso si hay otro con audio real', async () => {
    const r = await analizarOsz(
      oszCon(
        {
          '1.osu': osuCon({}),
          '2.osu': osuCon({ audio: 'virtual', version: 'V', notas: NOTAS_VIRTUALES }),
        },
        AUDIO,
      ),
    );
    expect(r.canciones).toHaveLength(1);
    expect(r.canciones[0]!.dificultades.map((d) => d.metadata.difficultyName)).toEqual(['Normal']);
    expect(r.avisos).toEqual([
      'Se omitió "Cancion de prueba": ninguna de sus 2 muestras de sonido viene en el .osz.',
    ]);
  });
});

// ---------------------------------------------------------------------------
// T-066 paso 2: un .osz puede dar varias canciones
// ---------------------------------------------------------------------------

describe('analizarOsz: agrupacion en canciones (T-066 paso 2)', () => {
  const NOTAS_OTRAS = ['448,192,0,1,0,0:0:0:0:', '320,192,300,1,0,0:0:0:0:'];

  it('dos pistas distintas dan dos canciones, cada una con su audio y sus dificultades', async () => {
    const r = await analizarOsz(
      oszCon(
        {
          'a.osu': osuCon({ audio: 'uno.mp3', version: 'Easy' }),
          'b.osu': osuCon({ audio: 'dos.ogg', version: 'Normal', notas: NOTAS_OTRAS }),
          'c.osu': osuCon({ audio: 'uno.mp3', version: 'Hard', notas: NOTAS_OTRAS }),
        },
        { 'uno.mp3': new Uint8Array([1]), 'dos.ogg': new Uint8Array([2, 2]) },
      ),
    );
    expect(r.canciones).toHaveLength(2);
    expect(r.canciones.map((c) => c.audio!.size)).toEqual([1, 2]);
    expect(r.canciones.map((c) => c.dificultades.map((d) => d.metadata.difficultyName))).toEqual([
      ['Easy', 'Hard'],
      ['Normal'],
    ]);
    // Comparten Title: el sufijo con el audio las distingue.
    expect(r.canciones.map((c) => c.titulo)).toEqual([
      'Cancion de prueba (uno)',
      'Cancion de prueba (dos)',
    ]);
    expect(r.titulo).toBe('Cancion de prueba');
    expect(r.avisos).toEqual([]);
  });

  it('un grupo sin audio se omite con aviso si otro entra', async () => {
    const r = await analizarOsz(
      oszCon(
        {
          'a.osu': osuCon({ audio: 'falta.mp3', version: 'A' }),
          'b.osu': osuCon({ audio: 'dos.ogg', version: 'B', notas: NOTAS_OTRAS }),
        },
        { 'dos.ogg': new Uint8Array([2, 2]) },
      ),
    );
    expect(r.canciones).toHaveLength(1);
    expect(r.canciones[0]!.dificultades.map((d) => d.metadata.difficultyName)).toEqual(['B']);
    expect(r.avisos).toEqual(['Se omitió "Cancion de prueba (falta)": falta el audio "falta.mp3".']);
  });

  it('si ningun grupo tiene su audio, falla con audio-faltante', async () => {
    const e = await errorDe(
      oszCon({
        'a.osu': osuCon({ audio: 'falta1.mp3', version: 'A' }),
        'b.osu': osuCon({ audio: 'falta2.mp3', version: 'B', notas: NOTAS_OTRAS }),
      }),
    );
    expect(e.codigo).toBe('audio-faltante');
    expect(e.message).toBe('Falta el audio: el mapa pide "falta1.mp3" y el .osz no lo trae.');
  });

  it('los grupos virtuales sin muestras se omiten con aviso por pieza y el audio real entra', async () => {
    const r = await analizarOsz(
      oszCon(
        {
          'a.osu': osuCon({ audio: 'virtual', version: 'Canon - 4K EX', notas: NOTAS_VIRTUALES }),
          'b.osu': osuCon({
            audio: 'virtual',
            version: 'La Campanella - 4K Full',
            notas: NOTAS_VIRTUALES,
          }),
          'c.osu': osuCon({ version: 'Real' }),
        },
        AUDIO,
      ),
    );
    expect(r.canciones).toHaveLength(1);
    expect(r.canciones[0]!.titulo).toBe('Cancion de prueba');
    expect(r.avisos).toEqual([
      'Se omitió "Canon": ninguna de sus 2 muestras de sonido viene en el .osz.',
      'Se omitió "La Campanella": ninguna de sus 2 muestras de sonido viene en el .osz.',
    ]);
  });

  it('un set virtual de varias piezas sin muestras falla con muestras-faltantes', async () => {
    const e = await errorDe(
      oszCon({
        'a.osu': osuCon({ audio: 'virtual', version: 'Canon - 4K EX', notas: NOTAS_VIRTUALES }),
        'b.osu': osuCon({
          audio: 'virtual',
          version: 'La Campanella - 4K Full',
          notas: NOTAS_VIRTUALES,
        }),
      }),
    );
    expect(e.codigo).toBe('muestras-faltantes');
  });
});
