// Tests de T-049: parseOsu lee [Events] (fondo y video) y Source/Tags.
// Los valores esperados estan tipeados a mano, no derivados del parser.

import { describe, expect, it } from 'vitest';
import { parseOsu } from './osu.js';

/** Mapa minimo valido. `{EVENTOS}` y `{EXTRA_METADATA}` se reemplazan en cada test. */
const PLANTILLA = `osu file format v14

[General]
AudioFilename: audio.mp3
Mode: 3

[Metadata]
Title:Cancion
Artist:Artista
Creator:Arnold
Version:Normal
{EXTRA_METADATA}

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:7

[Events]
{EVENTOS}

[TimingPoints]
0,500,4,2,1,50,1,0

[HitObjects]
64,192,1000,1,0,0:0:0:0:
`;

function mapa(eventos: string[], extraMetadata: string[] = []): string {
  return PLANTILLA.replace('{EVENTOS}', eventos.join('\n')).replace(
    '{EXTRA_METADATA}',
    extraMetadata.join('\n'),
  );
}

function metadataDe(texto: string) {
  const r = parseOsu(texto);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('el mapa no parseo');
  return r.chart.metadata;
}

describe('parseOsu: [Events]', () => {
  it('fondo con comillas y coordenadas, y video con offset negativo', () => {
    const m = metadataDe(mapa(['0,0,"BG.jpg",0,0', 'Video,-120,"vid.mp4"']));
    expect(m.backgroundFile).toBe('BG.jpg');
    expect(m.videoFile).toBe('vid.mp4');
    expect(m.videoOffset).toBe(-120);
  });

  it('fondo sin comillas y sin x,y', () => {
    expect(metadataDe(mapa(['0,0,fondo.png'])).backgroundFile).toBe('fondo.png');
  });

  it('acepta el alias Background', () => {
    expect(metadataDe(mapa(['Background,0,"alias.jpg",0,0'])).backgroundFile).toBe(
      'alias.jpg',
    );
  });

  it('el video tambien se declara con el tipo 1', () => {
    const m = metadataDe(mapa(['1,350,"clip.webm",0,0']));
    expect(m.videoFile).toBe('clip.webm');
    expect(m.videoOffset).toBe(350);
  });

  it('las rutas con barra invertida quedan con / y se recortan los espacios', () => {
    const m = metadataDe(
      mapa(['0,0," sub\\carpeta\\bg.jpg ",0,0', 'Video,0,"v\\clip.mp4"']),
    );
    expect(m.backgroundFile).toBe('sub/carpeta/bg.jpg');
    expect(m.videoFile).toBe('v/clip.mp4');
  });

  it('un nombre de archivo con comas entre comillas no se parte', () => {
    expect(metadataDe(mapa(['0,0,"Artista, Titulo.jpg",0,0'])).backgroundFile).toBe(
      'Artista, Titulo.jpg',
    );
  });

  it('toma solo la primera linea de fondo y la primera de video', () => {
    const m = metadataDe(
      mapa([
        '0,0,"primero.jpg",0,0',
        '0,0,"segundo.jpg",0,0',
        'Video,10,"uno.mp4"',
        'Video,99,"dos.mp4"',
      ]),
    );
    expect(m.backgroundFile).toBe('primero.jpg');
    expect(m.videoFile).toBe('uno.mp4');
    expect(m.videoOffset).toBe(10);
  });

  it('sprites, breaks, samples y storyboard no afectan', () => {
    const m = metadataDe(
      mapa([
        '//Break Periods',
        '2,10000,20000',
        '//Storyboard Layer 0 (Background)',
        'Sprite,Background,Centre,"sb/sprite.png",320,240',
        ' F,0,0,1000,0,1',
        'Sample,1000,0,"sonido.wav",100',
        '0,0,"real.jpg",0,0',
      ]),
    );
    expect(m.backgroundFile).toBe('real.jpg');
    expect(m.videoFile).toBeUndefined();
  });

  it('un [Events] con basura no hace fallar el mapa ni inventa campos', () => {
    const m = metadataDe(
      mapa(['0', ',,,', '0,0,""', 'Video,abc', '0,0,"   "', 'basura sin comas', '"']),
    );
    expect('backgroundFile' in m).toBe(false);
    expect('videoFile' in m).toBe(false);
    expect('videoOffset' in m).toBe(false);
  });

  it('un offset de video que no es numero cae a 0', () => {
    const m = metadataDe(mapa(['Video,xx,"v.mp4"']));
    expect(m.videoFile).toBe('v.mp4');
    expect(m.videoOffset).toBe(0);
  });

  it('sin seccion [Events] el mapa parsea igual y no trae fondo ni video', () => {
    const sinSeccion = mapa([]).replace('[Events]\n\n\n', '');
    expect(sinSeccion).not.toContain('[Events]');
    const m = metadataDe(sinSeccion);
    expect(m.backgroundFile).toBeUndefined();
    expect(m.videoFile).toBeUndefined();
  });
});

describe('parseOsu: Source y Tags', () => {
  it('se leen recortados', () => {
    const m = metadataDe(mapa([], ['Source: Mi Juego ', 'Tags:  rock  chill ']));
    expect(m.source).toBe('Mi Juego');
    expect(m.tags).toBe('rock  chill');
  });

  it('vacios quedan ausentes (sin la clave)', () => {
    const m = metadataDe(mapa([], ['Source:', 'Tags:   ']));
    expect('source' in m).toBe(false);
    expect('tags' in m).toBe(false);
  });
});
