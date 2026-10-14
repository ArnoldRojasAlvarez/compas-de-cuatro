// Tests de T-066 (paso 3, D8): la suma pura del audio virtual. Valores
// tipeados a mano, con un sampleRate de 1000 para que 1 ms sea 1 muestra.

import { describe, expect, it } from 'vitest';
import type { Chart } from '../types.js';
import {
  duracionDeAudioVirtual,
  indiceDeMuestra,
  mezclarMuestra,
  normalizarNombreDeMuestra,
  normalizarPico,
} from './mezcla.js';

function salida(largo: number, canales = 2): Float32Array[] {
  return Array.from({ length: canales }, () => new Float32Array(largo));
}

describe('indiceDeMuestra', () => {
  it('un evento en 5 ms a 1000 Hz cae en el indice 5', () => {
    expect(indiceDeMuestra(5, 1000)).toBe(5);
  });

  it('redondea, no trunca: 2,6 ms cae en el indice 3 (floor daria 2)', () => {
    expect(indiceDeMuestra(2.6, 1000)).toBe(3);
  });

  it('a 44100 Hz, 1000 ms son 44100 muestras', () => {
    expect(indiceDeMuestra(1000, 44100)).toBe(44100);
  });
});

describe('mezclarMuestra', () => {
  it('un impulso mono en el indice 5 cae en el 5 de los dos canales', () => {
    const out = salida(10);
    mezclarMuestra(out, [Float32Array.of(1)], [5], [1]);
    expect(Array.from(out[0]!)).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(Array.from(out[1]!)).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
  });

  it('estereo: L va a L y R va a R', () => {
    const out = salida(4);
    mezclarMuestra(out, [Float32Array.of(0.5, 0.25), Float32Array.of(-0.5, -0.25)], [1], [1]);
    expect(Array.from(out[0]!)).toEqual([0, 0.5, 0.25, 0]);
    expect(Array.from(out[1]!)).toEqual([0, -0.5, -0.25, 0]);
  });

  it('aplica la ganancia lineal de cada inicio', () => {
    const out = salida(6);
    mezclarMuestra(out, [Float32Array.of(1)], [1, 4], [0.5, 0.25]);
    expect(Array.from(out[0]!)).toEqual([0, 0.5, 0, 0, 0.25, 0]);
  });

  it('dos eventos que se superponen se suman', () => {
    const out = salida(5);
    mezclarMuestra(out, [Float32Array.of(0.5, 0.5, 0.5)], [0, 2], [1, 1]);
    expect(Array.from(out[0]!)).toEqual([0.5, 0.5, 1, 0.5, 0.5]);
  });

  it('la cola que pasa del final se corta', () => {
    const out = salida(3);
    mezclarMuestra(out, [Float32Array.of(1, 2, 3, 4)], [2], [1]);
    expect(Array.from(out[0]!)).toEqual([0, 0, 1]);
  });

  it('un inicio negativo, no finito o pasado del final se ignora', () => {
    const out = salida(3);
    mezclarMuestra(out, [Float32Array.of(1)], [-1, Number.NaN, 3, 10], [1, 1, 1, 1]);
    expect(Array.from(out[0]!)).toEqual([0, 0, 0]);
  });

  it('con mas de dos canales en la muestra se usan los dos primeros', () => {
    const out = salida(2);
    mezclarMuestra(out, [Float32Array.of(1), Float32Array.of(2), Float32Array.of(3)], [0], [1]);
    expect(out[0]![0]).toBe(1);
    expect(out[1]![0]).toBe(2);
  });
});

describe('normalizarPico', () => {
  it('no toca un pico de 0,9', () => {
    const out = [Float32Array.of(0.9, -0.5)];
    expect(normalizarPico(out)).toBe(1);
    expect(Array.from(out[0]!)).toEqual([Math.fround(0.9), -0.5]);
  });

  it('no toca un pico de exactamente 1', () => {
    const out = [Float32Array.of(1, -1)];
    expect(normalizarPico(out)).toBe(1);
    expect(out[0]![0]).toBe(1);
  });

  it('lleva un pico de 2 a 0,98 en todos los canales', () => {
    const out = [Float32Array.of(2, 1), Float32Array.of(-1, 0.5)];
    const factor = normalizarPico(out);
    expect(factor).toBeCloseTo(0.49, 6);
    expect(out[0]![0]).toBeCloseTo(0.98, 6);
    expect(out[0]![1]).toBeCloseTo(0.49, 6);
    expect(out[1]![0]).toBeCloseTo(-0.49, 6);
  });

  it('acepta otro techo', () => {
    const out = [Float32Array.of(4)];
    normalizarPico(out, 0.5);
    expect(out[0]![0]).toBeCloseTo(0.5, 6);
  });
});

describe('normalizarNombreDeMuestra', () => {
  it('quita comillas y ./, pasa \\ a / y minusculas', () => {
    expect(normalizarNombreDeMuestra('".\\Sub\\KICK.ogg"')).toBe('sub/kick.ogg');
    expect(normalizarNombreDeMuestra('  ./snare.WAV ')).toBe('snare.wav');
  });
});

describe('duracionDeAudioVirtual', () => {
  function chartConEventos(tiempos: number[], notas: Chart['notes']): Chart {
    return {
      metadata: {
        title: 't',
        artist: 'a',
        creator: 'c',
        difficultyName: 'd',
        audioFile: 'virtual',
        previewTime: 0,
      },
      overallDifficulty: 7,
      hpDrain: 5,
      timingPoints: [{ time: 0, bpm: 120, meter: 4 }],
      speedPoints: [],
      notes: notas,
      audioVirtual: { eventos: tiempos.map((tiempo) => ({ tiempo, archivo: 'a.ogg', volumen: 100 })) },
    };
  }

  it('es el ultimo evento mas 8 s si eso pasa del fin de las notas mas 2 s', () => {
    const chart = chartConEventos([1000, 20000], [{ kind: 'tap', time: 5000, column: 0 }]);
    expect(duracionDeAudioVirtual(chart)).toBe(28000);
  });

  it('es el fin de la ultima nota (hold incluido) mas 2 s si eso es mayor', () => {
    const chart = chartConEventos([100], [{ kind: 'hold', time: 10000, endTime: 30000, column: 1 }]);
    expect(duracionDeAudioVirtual(chart)).toBe(32000);
  });

  it('0 si el chart no tiene receta', () => {
    const chart = chartConEventos([], []);
    delete chart.audioVirtual;
    expect(duracionDeAudioVirtual(chart)).toBe(0);
  });
});
