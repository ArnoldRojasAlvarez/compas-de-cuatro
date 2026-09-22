// Tests de T-005 (parser de mapas .osu de osu!mania 4K).
//
// Nota sobre el hallazgo de T-001/T-002 (ver windows.test.ts): un test que
// compara un valor contra el resultado de la misma formula que esta
// probando da verde siempre y no sirve. Aca los .osu de ejemplo estan
// embebidos como strings (ningun archivo se lee desde core, ver el ticket)
// y los valores esperados (columna, bpm, multiplier, endTime, orden) estan
// tipeados a mano a partir de la especificacion del formato, no derivados
// de parseOsu ni de columnaDesdeX.

import { describe, expect, it } from 'vitest';
import { parseOsu } from './osu.js';

/**
 * Mapa base valido: 4 notas (una por columna, x = 64/192/320/448) mas una
 * hold en la columna 3, un punto de tiempo rojo y uno verde. Sirve como
 * punto de partida para los tests que solo cambian una linea.
 */
const OSU_BASICO = `osu file format v14

[General]
AudioFilename: audio.mp3
AudioLeadIn: 0
PreviewTime: 5000
Countdown: 0
SampleSet: Soft
Mode: 3

[Metadata]
Title:Cancion de prueba
Artist:Artista de prueba
Creator:Arnold
Version:Normal

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:7
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1

[Events]
0,0,"fondo.jpg",0,0

[TimingPoints]
1000,500,4,2,1,50,1,0
5000,-100,4,2,1,50,0,0

[Colours]
Combo1 : 255,128,0

[HitObjects]
64,192,1000,1,0,0:0:0:0:
192,192,1500,1,0,0:0:0:0:
320,192,2000,1,0,0:0:0:0:
448,192,2500,128,0,3000:0:0:0:0:
`;

/**
 * Caso "real recortado" del ticket: 20 notas en 4K, con al menos una LN y
 * un cambio de BPM, escritas en el archivo en orden inverso al tiempo
 * (de la nota 19 a la 0) para probar el invariante de orden sobre un mapa
 * de tamano realista y no solo sobre 4 lineas.
 */
const OSU_REAL_RECORTADO = `osu file format v14

[General]
AudioFilename: cancion.mp3
PreviewTime: 3000
Mode: 3

[Metadata]
Title:Cancion Real
Artist:Artista Real
Creator:Arnold
Version:Insane

[Difficulty]
HPDrainRate:6
CircleSize:4
OverallDifficulty:8

[TimingPoints]
0,300,4,2,1,50,1,0
6000,250,4,2,1,50,1,0

[HitObjects]
448,192,5700,128,0,6300:0:0:0:0:
320,192,5400,1,0,0:0:0:0:
192,192,5100,1,0,0:0:0:0:
64,192,4800,1,0,0:0:0:0:
448,192,4500,1,0,0:0:0:0:
320,192,4200,1,0,0:0:0:0:
192,192,3900,1,0,0:0:0:0:
64,192,3600,1,0,0:0:0:0:
448,192,3300,1,0,0:0:0:0:
320,192,3000,1,0,0:0:0:0:
192,192,2700,1,0,0:0:0:0:
64,192,2400,1,0,0:0:0:0:
448,192,2100,1,0,0:0:0:0:
320,192,1800,1,0,0:0:0:0:
192,192,1500,1,0,0:0:0:0:
64,192,1200,1,0,0:0:0:0:
448,192,900,1,0,0:0:0:0:
320,192,600,1,0,0:0:0:0:
192,192,300,1,0,0:0:0:0:
64,192,0,1,0,0:0:0:0:
`;

describe('parseOsu', () => {
  describe('mapa basico valido', () => {
    it('produce ok:true con los metadatos del [General]/[Metadata] correctos', () => {
      const resultado = parseOsu(OSU_BASICO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      expect(resultado.chart.metadata).toEqual({
        title: 'Cancion de prueba',
        artist: 'Artista de prueba',
        creator: 'Arnold',
        difficultyName: 'Normal',
        audioFile: 'audio.mp3',
        previewTime: 5000,
      });
    });

    it('lee OverallDifficulty y HPDrainRate de [Difficulty]', () => {
      const resultado = parseOsu(OSU_BASICO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      expect(resultado.chart.overallDifficulty).toBe(7);
      expect(resultado.chart.hpDrain).toBe(5);
    });

    it('trae las 4 notas del archivo', () => {
      const resultado = parseOsu(OSU_BASICO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      expect(resultado.chart.notes).toHaveLength(4);
    });

    it('ignora secciones no usadas ([Events], [Colours]) sin fallar', () => {
      // OSU_BASICO ya trae [Events] y [Colours] embebidos con contenido
      // (una linea de fondo y un color de combo): si el parser tropezara
      // con ellas el resultado directamente no seria ok:true.
      const resultado = parseOsu(OSU_BASICO);
      expect(resultado.ok).toBe(true);
    });
  });

  describe('columna desde x (floor(x * 4 / 512))', () => {
    it('x = 64, 192, 320, 448 dan las columnas 0, 1, 2, 3, en ese orden', () => {
      const resultado = parseOsu(OSU_BASICO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      // Las 4 notas de OSU_BASICO ya vienen en orden de tiempo creciente
      // (1000, 1500, 2000, 2500) y cada una tiene una x distinta: el orden
      // de columnas en el array de salida tiene que ser 0,1,2,3.
      const columnas = resultado.chart.notes.map((n) => n.column);
      expect(columnas).toEqual([0, 1, 2, 3]);
    });

    it('acota una x en el borde (512, fuera del rango teorico 0-511) a la ultima columna', () => {
      const osu = OSU_BASICO.replace(
        '448,192,2500,128,0,3000:0:0:0:0:',
        '512,192,2500,1,0,0:0:0:0:',
      );
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      const ultima = resultado.chart.notes[resultado.chart.notes.length - 1]!;
      // floor(512 * 4 / 512) = 4, fuera de [0,3]: tiene que acotar a 3.
      expect(ultima.column).toBe(3);
    });

    it('acota una x negativa a la primera columna', () => {
      const osu = OSU_BASICO.replace('64,192,1000,1,0,0:0:0:0:', '-10,192,1000,1,0,0:0:0:0:');
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      expect(resultado.chart.notes[0]!.column).toBe(0);
    });
  });

  describe('notas largas (holds)', () => {
    it('el bit 128 de type produce una HoldNote con el endTime sacado de extras', () => {
      const resultado = parseOsu(OSU_BASICO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      const hold = resultado.chart.notes[3]!;
      expect(hold.kind).toBe('hold');
      if (hold.kind !== 'hold') return;
      expect(hold.time).toBe(2500);
      expect(hold.endTime).toBe(3000);
      expect(hold.column).toBe(3);
    });

    it('una LN con endTime <= time se descarta, y el resto del mapa se sigue parseando', () => {
      // 4000 <= 5000: cola antes (o igual) que la cabeza, invalida.
      const osu = OSU_BASICO.replace(
        '448,192,2500,128,0,3000:0:0:0:0:',
        '448,192,5000,128,0,4000:0:0:0:0:',
      );
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      // Las otras 3 notas (tap) siguen presentes, la LN invalida no.
      expect(resultado.chart.notes).toHaveLength(3);
      expect(resultado.chart.notes.some((n) => n.time === 5000)).toBe(false);
    });

    it('una LN con endTime igual a time tambien se descarta (el invariante pide endTime > time)', () => {
      const osu = OSU_BASICO.replace(
        '448,192,2500,128,0,3000:0:0:0:0:',
        '448,192,2500,128,0,2500:0:0:0:0:',
      );
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      expect(resultado.chart.notes).toHaveLength(3);
    });

    it('una nota normal (bit 0, sin bit 128) produce una TapNote', () => {
      const resultado = parseOsu(OSU_BASICO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      expect(resultado.chart.notes[0]!.kind).toBe('tap');
    });
  });

  describe('orden de las notas', () => {
    it('quedan ordenadas por time ascendente aunque el archivo las traiga al reves', () => {
      const osu = `osu file format v14

[General]
AudioFilename: audio.mp3
Mode: 3

[Metadata]
Title:T
Artist:A
Creator:C
Version:V

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:5

[TimingPoints]
0,500,4,2,1,50,1,0

[HitObjects]
448,192,3000,1,0,0:0:0:0:
320,192,2000,1,0,0:0:0:0:
192,192,1000,1,0,0:0:0:0:
64,192,0,1,0,0:0:0:0:
`;
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      expect(resultado.chart.notes.map((n) => n.time)).toEqual([0, 1000, 2000, 3000]);
      // El orden de columnas tiene que haber rotado junto con el de time:
      // la nota de time 0 es la que tenia x=64 (col 0) en el archivo, no la
      // primera linea del archivo (que era x=448, col 3).
      expect(resultado.chart.notes.map((n) => n.column)).toEqual([0, 1, 2, 3]);
    });
  });

  describe('[TimingPoints]', () => {
    it('un punto rojo (beatLength > 0) da bpm = 60000 / beatLength', () => {
      const resultado = parseOsu(OSU_BASICO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      // beatLength 500 -> 60000 / 500 = 120.
      expect(resultado.chart.timingPoints).toEqual([{ time: 1000, bpm: 120, meter: 4 }]);
    });

    it('un punto verde (beatLength < 0) da multiplier = 100 / -beatLength', () => {
      const resultado = parseOsu(OSU_BASICO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      // beatLength -100 -> 100 / 100 = 1.
      expect(resultado.chart.speedPoints).toEqual([{ time: 5000, multiplier: 1 }]);
    });

    it('otro par rojo/verde con numeros distintos da los valores correctos', () => {
      const osu = OSU_BASICO.replace(
        '1000,500,4,2,1,50,1,0\n5000,-100,4,2,1,50,0,0',
        '1000,400,4,2,1,50,1,0\n5000,-250,4,2,1,50,0,0',
      );
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      // beatLength 400 -> 60000/400 = 150. beatLength -250 -> 100/250 = 0.4.
      expect(resultado.chart.timingPoints[0]!.bpm).toBe(150);
      expect(resultado.chart.speedPoints[0]!.multiplier).toBe(0.4);
    });
  });

  describe('errores', () => {
    it("Mode distinto de 3 da ok:false con un mensaje que menciona 'Mode'", () => {
      const osu = OSU_BASICO.replace('Mode: 3', 'Mode: 0');
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(resultado.error).toMatch(/Mode/);
    });

    it("CircleSize distinto de 4 da ok:false con un mensaje que menciona 'CircleSize'", () => {
      const osu = OSU_BASICO.replace('CircleSize:4', 'CircleSize:5');
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(resultado.error).toMatch(/CircleSize/);
    });

    it('falta la seccion [Difficulty] entera: da ok:false, no una excepcion', () => {
      const sinDifficulty = OSU_BASICO.replace(
        `[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:7
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1

`,
        '',
      );
      expect(() => parseOsu(sinDifficulty)).not.toThrow();
      const resultado = parseOsu(sinDifficulty);
      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(resultado.error).toMatch(/Difficulty/);
    });

    it('falta la seccion [General] entera: da ok:false, no una excepcion', () => {
      const texto = `[Metadata]
Title:T
Artist:A
Creator:C
Version:V

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:5

[TimingPoints]
0,500,4,2,1,50,1,0

[HitObjects]
64,192,0,1,0,0:0:0:0:
`;
      expect(() => parseOsu(texto)).not.toThrow();
      const resultado = parseOsu(texto);
      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(resultado.error).toMatch(/General/);
    });

    it('falta el campo Title en [Metadata]: da ok:false con mensaje claro', () => {
      const osu = OSU_BASICO.replace('Title:Cancion de prueba\n', '');
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(resultado.error).toMatch(/Title/);
    });

    it('un archivo vacio da ok:false sin lanzar excepcion', () => {
      expect(() => parseOsu('')).not.toThrow();
      expect(parseOsu('').ok).toBe(false);
    });

    it('PreviewTime no numerico da ok:false con mensaje claro', () => {
      const osu = OSU_BASICO.replace('PreviewTime: 5000', 'PreviewTime: nunca');
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(resultado.error).toMatch(/PreviewTime/);
    });

    it('OverallDifficulty no numerico da ok:false con mensaje claro', () => {
      const osu = OSU_BASICO.replace('OverallDifficulty:7', 'OverallDifficulty:dificil');
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(resultado.error).toMatch(/OverallDifficulty/);
    });

    it('HPDrainRate no numerico da ok:false con mensaje claro', () => {
      const osu = OSU_BASICO.replace('HPDrainRate:5', 'HPDrainRate:rapido');
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(resultado.error).toMatch(/HPDrainRate/);
    });

    it('CircleSize no numerico da ok:false con mensaje claro (distinto del caso CircleSize != 4)', () => {
      const osu = OSU_BASICO.replace('CircleSize:4', 'CircleSize:cuatro');
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(resultado.error).toMatch(/CircleSize/);
    });

    it('falta la seccion [TimingPoints] entera (no solo que venga vacia): da ok:false', () => {
      const sinTimingPoints = OSU_BASICO.replace(
        `[TimingPoints]
1000,500,4,2,1,50,1,0
5000,-100,4,2,1,50,0,0

`,
        '',
      );
      const resultado = parseOsu(sinTimingPoints);
      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(resultado.error).toMatch(/TimingPoints/);
    });

    it('sin ningun punto de tiempo rojo (solo un verde) da ok:false', () => {
      const osu = OSU_BASICO.replace('1000,500,4,2,1,50,1,0\n', '');
      const resultado = parseOsu(osu);
      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(resultado.error).toMatch(/TimingPoints|tiempo/);
    });
  });

  describe('caso real recortado: 20 notas, una LN, un cambio de BPM', () => {
    it('produce ok:true con las 20 notas', () => {
      const resultado = parseOsu(OSU_REAL_RECORTADO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;
      expect(resultado.chart.notes).toHaveLength(20);
    });

    it('las notas quedan ordenadas por time pese a que el archivo las trae al reves', () => {
      const resultado = parseOsu(OSU_REAL_RECORTADO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      const tiempos = resultado.chart.notes.map((n) => n.time);
      const esperados = Array.from({ length: 20 }, (_, i) => i * 300);
      expect(tiempos).toEqual(esperados);
    });

    it('la primera y la ultima nota tienen la columna correcta segun su x', () => {
      const resultado = parseOsu(OSU_REAL_RECORTADO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      // time 0 vino de la linea "64,192,0,...": x=64 -> columna 0.
      expect(resultado.chart.notes[0]!.time).toBe(0);
      expect(resultado.chart.notes[0]!.column).toBe(0);

      // time 5700 vino de la linea "448,192,5700,128,...": x=448 -> columna 3, es la LN.
      const ultima = resultado.chart.notes[19]!;
      expect(ultima.time).toBe(5700);
      expect(ultima.column).toBe(3);
      expect(ultima.kind).toBe('hold');
      if (ultima.kind === 'hold') {
        expect(ultima.endTime).toBe(6300);
      }
    });

    it('trae los dos puntos de tiempo del cambio de BPM con el bpm correcto', () => {
      const resultado = parseOsu(OSU_REAL_RECORTADO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      // beatLength 300 -> 60000/300 = 200. beatLength 250 -> 60000/250 = 240.
      expect(resultado.chart.timingPoints).toEqual([
        { time: 0, bpm: 200, meter: 4 },
        { time: 6000, bpm: 240, meter: 4 },
      ]);
    });

    it('lee bien los metadatos del caso real', () => {
      const resultado = parseOsu(OSU_REAL_RECORTADO);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;

      expect(resultado.chart.metadata.title).toBe('Cancion Real');
      expect(resultado.chart.metadata.difficultyName).toBe('Insane');
      expect(resultado.chart.overallDifficulty).toBe(8);
    });
  });
});
