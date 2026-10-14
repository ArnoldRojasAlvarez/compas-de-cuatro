// Tests de T-066 (paso 3, D7): la receta del audio virtual que arma parseOsu a
// partir de los keysounds de las notas y las lineas Sample de [Events], y su
// escritura de vuelta en escribirOsu.

import { describe, expect, it } from 'vitest';
import { hashMapa } from '../difficulty/hash.js';
import type { Chart } from '../types.js';
import { parseOsu } from './osu.js';
import { escribirOsu } from './osu-escritor.js';

/** Arma un .osu virtual con las lineas de [Events], [TimingPoints] y [HitObjects] dadas. */
function osuVirtual(opciones: {
  audio?: string;
  eventos?: string[];
  timing?: string[];
  notas?: string[];
}): string {
  const {
    audio = 'virtual',
    eventos = [],
    timing = ['0,500,4,1,0,70,1,0'],
    notas = ['64,192,1000,1,0,0:0:0:0:'],
  } = opciones;
  return [
    'osu file format v14',
    '',
    '[General]',
    `AudioFilename: ${audio}`,
    'Mode: 3',
    '',
    '[Metadata]',
    'Title:Set',
    'Artist:Autor',
    'Creator:Alguien',
    'Version:Canon - 4K EX',
    '',
    '[Difficulty]',
    'HPDrainRate:5',
    'CircleSize:4',
    'OverallDifficulty:7',
    '',
    '[Events]',
    ...eventos,
    '',
    '[TimingPoints]',
    ...timing,
    '',
    '[HitObjects]',
    ...notas,
    '',
  ].join('\n');
}

function leer(texto: string): Chart {
  const r = parseOsu(texto);
  if (!r.ok) throw new Error(r.error);
  return r.chart;
}

describe('parseOsu: receta del audio virtual', () => {
  it('un tap con archivo aporta un evento en el tiempo de la cabeza', () => {
    const chart = leer(osuVirtual({ notas: ['64,192,4800,5,0,0:0:0:80:l_045.ogg'] }));
    expect(chart.audioVirtual?.eventos).toEqual([{ tiempo: 4800, archivo: 'l_045.ogg', volumen: 80 }]);
  });

  it('un LN con archivo lee el nombre despues del endTime y va en el tiempo de la cabeza', () => {
    const chart = leer(osuVirtual({ notas: ['192,192,100850,128,0,105600:0:0:0:60:l_033.ogg'] }));
    expect(chart.audioVirtual?.eventos).toEqual([
      { tiempo: 100850, archivo: 'l_033.ogg', volumen: 60 },
    ]);
  });

  it('un hitSample sin archivo (corto o con nombre vacio) no aporta evento', () => {
    const chart = leer(
      osuVirtual({
        notas: [
          '64,192,1000,1,0,0:0:0:0:',
          '64,192,1100,1,0',
          '192,192,1200,128,0,1500:0:0:0:0:',
          '192,192,1300,1,0,0:0:0:50:real.ogg',
        ],
      }),
    );
    expect(chart.audioVirtual?.eventos).toEqual([{ tiempo: 1300, archivo: 'real.ogg', volumen: 50 }]);
    expect(chart.notes).toHaveLength(4);
  });

  it('con volumen 0 en el hitSample toma el del punto de tiempo, y un punto verde lo cambia a mitad', () => {
    const chart = leer(
      osuVirtual({
        timing: ['0,500,4,1,0,70,1,0', '2000,-100,4,1,0,40,0,0'],
        notas: [
          '64,192,1000,1,0,0:0:0:0:a.ogg',
          '64,192,2000,1,0,0:0:0:0:b.ogg',
          '64,192,3000,1,0,0:0:0:0:c.ogg',
        ],
      }),
    );
    expect(chart.audioVirtual?.eventos.map((e) => [e.archivo, e.volumen])).toEqual([
      ['a.ogg', 70],
      ['b.ogg', 40], // a igual tiempo gana el punto de tiempo vigente en ese instante
      ['c.ogg', 40],
    ]);
  });

  it('el volumen explicito del hitSample gana sobre el del punto de tiempo', () => {
    const chart = leer(osuVirtual({ notas: ['64,192,1000,1,0,0:0:0:25:a.ogg'] }));
    expect(chart.audioVirtual?.eventos[0]?.volumen).toBe(25);
  });

  it('una nota antes del primer punto usa el volumen del primero', () => {
    const chart = leer(
      osuVirtual({
        timing: ['5000,500,4,1,0,33,1,0'],
        notas: ['64,192,1000,1,0,0:0:0:0:a.ogg'],
      }),
    );
    expect(chart.audioVirtual?.eventos[0]?.volumen).toBe(33);
  });

  it('a igual tiempo de dos puntos gana el que aparece despues en el archivo', () => {
    const chart = leer(
      osuVirtual({
        timing: ['0,500,4,1,0,70,1,0', '1000,500,4,1,0,10,1,0', '1000,-100,4,1,0,90,0,0'],
        notas: ['64,192,1000,1,0,0:0:0:0:a.ogg'],
      }),
    );
    expect(chart.audioVirtual?.eventos[0]?.volumen).toBe(90);
  });

  it('si ningun punto trae volumen, vale 100', () => {
    const chart = leer(
      osuVirtual({ timing: ['0,500,4'], notas: ['64,192,1000,1,0,0:0:0:0:a.ogg'] }),
    );
    expect(chart.audioVirtual?.eventos[0]?.volumen).toBe(100);
  });

  it('las lineas Sample de las capas 0, 2 y 3 entran y la 1 (Fail) no', () => {
    const chart = leer(
      osuVirtual({
        notas: [],
        eventos: [
          'Sample,100,0,"capa0.ogg",100',
          'Sample,200,1,"fail.ogg",100',
          'Sample,300,2,"capa2.ogg",100',
          'Sample,400,3,"capa3.ogg",100',
        ],
      }),
    );
    expect(chart.audioVirtual?.eventos.map((e) => e.archivo)).toEqual([
      'capa0.ogg',
      'capa2.ogg',
      'capa3.ogg',
    ]);
  });

  it('un Sample sin volumen vale 100, y el alias numerico 5 tambien se lee', () => {
    const chart = leer(
      osuVirtual({ notas: [], eventos: ['Sample,100,0,"a.ogg"', '5,200,0,"b.ogg",40'] }),
    );
    expect(chart.audioVirtual?.eventos).toEqual([
      { tiempo: 100, archivo: 'a.ogg', volumen: 100 },
      { tiempo: 200, archivo: 'b.ogg', volumen: 40 },
    ]);
  });

  it('normaliza el nombre: comillas, barras invertidas, ./ inicial y mayusculas', () => {
    const chart = leer(
      osuVirtual({
        notas: ['64,192,1000,1,0,0:0:0:50:Sub\\Dir\\KICK.OGG'],
        eventos: ['Sample,100,0,".\\Snare.ogg",100'],
      }),
    );
    expect(chart.audioVirtual?.eventos.map((e) => e.archivo)).toEqual([
      'snare.ogg',
      'sub/dir/kick.ogg',
    ]);
  });

  it('descarta eventos con volumen 0 o tiempo negativo', () => {
    const chart = leer(
      osuVirtual({
        timing: ['0,500,4,1,0,0,1,0'],
        notas: ['64,192,1000,1,0,0:0:0:0:muda.ogg'], // 0 en el hitSample y 0 en el punto
        eventos: ['Sample,-50,0,"antes.ogg",100', 'Sample,50,0,"cero.ogg",0', 'Sample,60,0,"ok.ogg",10'],
      }),
    );
    expect(chart.audioVirtual?.eventos).toEqual([{ tiempo: 60, archivo: 'ok.ogg', volumen: 10 }]);
  });

  it('ordena por tiempo y despues por archivo, mezclando notas y Sample', () => {
    const chart = leer(
      osuVirtual({
        notas: ['64,192,500,1,0,0:0:0:100:z.ogg', '64,192,300,1,0,0:0:0:100:y.ogg'],
        eventos: ['Sample,500,0,"a.ogg",100', 'Sample,300,0,"x.ogg",100'],
      }),
    );
    expect(chart.audioVirtual?.eventos.map((e) => `${e.tiempo}:${e.archivo}`)).toEqual([
      '300:x.ogg',
      '300:y.ogg',
      '500:a.ogg',
      '500:z.ogg',
    ]);
  });

  it('un mapa con audio real no tiene audioVirtual aunque traiga Sample', () => {
    const chart = leer(osuVirtual({ audio: 'cancion.mp3', eventos: ['Sample,100,0,"a.ogg",100'] }));
    expect(chart.audioVirtual).toBeUndefined();
  });

  it('"Virtual" en mayusculas y con espacios tambien cuenta', () => {
    const chart = leer(osuVirtual({ audio: '  Virtual ' }));
    expect(chart.audioVirtual).toBeDefined();
  });

  it('hashMapa es igual con y sin receta', () => {
    const conReceta = leer(osuVirtual({ notas: ['64,192,1000,1,0,0:0:0:50:a.ogg'] }));
    const sinReceta = leer(osuVirtual({ notas: ['64,192,1000,1,0,0:0:0:0:'] }));
    expect(hashMapa(conReceta)).toBe(hashMapa(sinReceta));
  });
});

describe('escribirOsu: audio virtual', () => {
  it('escribe las notas sin keysound y todos los eventos como lineas Sample con el volumen resuelto', () => {
    const chart = leer(
      osuVirtual({
        timing: ['0,500,4,1,0,70,1,0'],
        notas: ['64,192,1000,1,0,0:0:0:0:a.ogg', '192,192,2000,128,0,2500:0:0:0:0:b.ogg'],
        eventos: ['Sample,100,0,"c.ogg",55'],
      }),
    );
    const texto = escribirOsu(chart);
    expect(texto).toContain('AudioFilename: virtual');
    expect(texto).toContain('Sample,100,0,"c.ogg",55');
    expect(texto).toContain('Sample,1000,0,"a.ogg",70');
    expect(texto).toContain('Sample,2000,0,"b.ogg",70');
    expect(texto).toContain('64,192,1000,1,0,0:0:0:0:');
    expect(texto).not.toContain(':a.ogg');
    expect(texto).not.toContain(':b.ogg');
  });

  it('el roundtrip conserva la receta y el hashMapa', () => {
    const chart = leer(
      osuVirtual({
        notas: ['64,192,1000,1,0,0:0:0:0:a.ogg', '320,192,1500,1,0,0:0:0:30:b.ogg'],
        eventos: ['Sample,100,0,"c.ogg",55', 'Sample,100,2,"c.ogg",20'],
      }),
    );
    const otra = leer(escribirOsu(chart));
    expect(otra.audioVirtual).toEqual(chart.audioVirtual);
    expect(hashMapa(otra)).toBe(hashMapa(chart));
    expect(otra.metadata.audioFile).toBe('virtual');
  });

  it('un chart sin audioVirtual no escribe lineas Sample', () => {
    const chart = leer(osuVirtual({ audio: 'x.mp3' }));
    expect(escribirOsu(chart)).not.toContain('Sample,');
  });
});
