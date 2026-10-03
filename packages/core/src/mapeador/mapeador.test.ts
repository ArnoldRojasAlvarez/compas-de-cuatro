// Tests del mapeador: escritor de .osu, grilla, onsets, tempo y automapa.
// Las pruebas de audio usan una senal sintetica con clicks en instantes
// conocidos, asi la respuesta correcta se sabe de antemano.

import { describe, expect, it } from 'vitest';
import type { Chart, Note } from '../types.js';
import { parseOsu } from '../chart/osu.js';
import { escribirOsu } from '../chart/osu-escritor.js';
import {
  ajustarAGrilla,
  duracionSlot,
  lineasDeGrilla,
  slotMasCercano,
  tiempoDeSlot,
  type Grilla,
} from './grilla.js';
import { analizarOnsets } from './onsets.js';
import { estimarTempo } from './tempo.js';
import { PRESETS_AUTO, crearAleatorio, generarNotas } from './automapa.js';

const SR = 22050;

/** Clicks sinteticos: pulso fuerte en cada negra y uno suave en cada corchea. */
function senalDeClicks(bpm: number, offsetMs: number, segundos: number): Float32Array {
  const muestras = new Float32Array(Math.round(SR * segundos));
  const pulso = 60000 / bpm;
  const azar = crearAleatorio(7);
  for (let k = 0; ; k++) {
    for (const [mitad, amp] of [
      [0, 0.9],
      [0.5, 0.35],
    ] as const) {
      const t = offsetMs + (k + mitad) * pulso;
      const inicio = Math.round((t / 1000) * SR);
      if (inicio >= muestras.length) return muestras;
      const largo = Math.round(SR * 0.03);
      for (let i = 0; i < largo && inicio + i < muestras.length; i++) {
        const envolvente = Math.exp(-i / (SR * 0.006));
        const ruido = azar() * 2 - 1;
        const tono = Math.sin((2 * Math.PI * 1800 * i) / SR);
        muestras[inicio + i] = amp * envolvente * (0.6 * ruido + 0.4 * tono);
      }
    }
  }
}

function chartDePrueba(notes: Note[]): Chart {
  return {
    metadata: {
      title: 'Cancion de prueba',
      artist: 'Artista: con dos puntos',
      creator: 'Arnold Alvarez',
      difficultyName: 'Normal',
      audioFile: 'audio.mp3',
      previewTime: 1500,
    },
    overallDifficulty: 7,
    hpDrain: 5.5,
    timingPoints: [{ time: 250, bpm: 128, meter: 4 }],
    speedPoints: [{ time: 4000, multiplier: 1.5 }],
    notes,
  };
}

describe('escribirOsu', () => {
  it('el parse del resultado devuelve el mismo mapa', () => {
    const notas: Note[] = [
      { kind: 'tap', time: 250, column: 0 },
      { kind: 'tap', time: 719, column: 3 },
      { kind: 'hold', time: 1188, endTime: 1900, column: 1 },
      { kind: 'tap', time: 1188, column: 2 },
    ];
    const resultado = parseOsu(escribirOsu(chartDePrueba(notas)));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const c = resultado.chart;
    expect(c.metadata.title).toBe('Cancion de prueba');
    expect(c.metadata.artist).toBe('Artista: con dos puntos');
    expect(c.metadata.creator).toBe('Arnold Alvarez');
    expect(c.metadata.difficultyName).toBe('Normal');
    expect(c.metadata.audioFile).toBe('audio.mp3');
    expect(c.metadata.previewTime).toBe(1500);
    expect(c.overallDifficulty).toBe(7);
    expect(c.hpDrain).toBe(5.5);
    expect(c.timingPoints).toHaveLength(1);
    expect(c.timingPoints[0]!.bpm).toBeCloseTo(128, 3);
    expect(c.timingPoints[0]!.time).toBe(250);
    expect(c.speedPoints[0]!.multiplier).toBeCloseTo(1.5, 3);
    expect(c.notes).toEqual(notas.slice().sort((a, b) => a.time - b.time));
  });

  it('las columnas sobreviven al viaje de ida y vuelta (las cuatro)', () => {
    const notas: Note[] = [0, 1, 2, 3].map((column, i) => ({
      kind: 'tap',
      time: 1000 + i * 100,
      column: column as 0 | 1 | 2 | 3,
    }));
    const r = parseOsu(escribirOsu(chartDePrueba(notas)));
    expect(r.ok && r.chart.notes.map((n) => n.column)).toEqual([0, 1, 2, 3]);
  });

  it('un titulo con salto de linea no rompe el formato', () => {
    const chart = chartDePrueba([{ kind: 'tap', time: 0, column: 0 }]);
    chart.metadata.title = 'Linea uno\nLinea dos';
    const r = parseOsu(escribirOsu(chart));
    expect(r.ok && r.chart.metadata.title).toBe('Linea uno Linea dos');
  });
});

describe('grilla', () => {
  const g: Grilla = { bpm: 120, offsetMs: 100, divisor: 4 };

  it('un slot dura un pulso dividido por el divisor', () => {
    expect(duracionSlot(g)).toBeCloseTo(125, 6);
  });

  it('tiempoDeSlot y slotMasCercano son inversas', () => {
    for (const slot of [-3, 0, 1, 17, 400]) {
      expect(slotMasCercano(g, tiempoDeSlot(g, slot))).toBe(slot);
    }
  });

  it('ajusta al slot mas cercano, redondeando a la mitad hacia arriba', () => {
    expect(ajustarAGrilla(g, 100 + 60)).toBeCloseTo(100 + 125 * 0, 6) /* 60 < 62.5 */;
    expect(ajustarAGrilla(g, 100 + 63)).toBeCloseTo(225, 6);
  });

  it('marca el primer pulso de cada compas con tipo 2', () => {
    const lineas = lineasDeGrilla(g, 100, 100 + 2000, 4);
    const compas = lineas.filter((l) => l.tipo === 2).map((l) => l.time);
    expect(compas).toEqual([100, 2100]);
    expect(lineas.filter((l) => l.tipo === 1)).toHaveLength(3);
    expect(lineas.filter((l) => l.tipo === 0)).toHaveLength(12);
  });
});

describe('onsets y tempo sobre clicks sinteticos', () => {
  const BPM = 128;
  const OFFSET = 250;
  const analisis = analizarOnsets(senalDeClicks(BPM, OFFSET, 30), SR);

  it('detecta los golpes fuertes cerca de su instante real', () => {
    // Hay clicks en cada corchea (los de contratiempo, mas suaves): todo
    // onset tiene que caer cerca de una corchea, y los fuertes cerca de una negra.
    const corchea = 60000 / BPM / 2;
    const pulso = corchea * 2;
    expect(analisis.onsets.length).toBeGreaterThan(80);
    for (const o of analisis.onsets) {
      const n = Math.round((o.time - OFFSET) / corchea);
      expect(Math.abs(o.time - (OFFSET + n * corchea))).toBeLessThan(25);
    }
    const fuertes = analisis.onsets.filter((o) => o.fuerza > 0.8);
    expect(fuertes.length).toBeGreaterThan(30);
    for (const o of fuertes) {
      const n = Math.round((o.time - OFFSET) / pulso);
      expect(Math.abs(o.time - (OFFSET + n * pulso))).toBeLessThan(25);
    }
  });

  it('estima BPM y offset', () => {
    const t = estimarTempo(analisis);
    expect(t).not.toBeNull();
    if (!t) return;
    expect(Math.abs(t.bpm - BPM)).toBeLessThan(0.5);
    expect(t.bpmSugerido).toBe(128);
    const pulso = 60000 / BPM;
    const desfase = Math.abs(((t.offsetMs - OFFSET + pulso * 1.5) % pulso) - pulso / 2);
    expect(desfase).toBeLessThan(25);
    expect(t.confianza).toBeGreaterThan(0.7);
  });

  it('en silencio no inventa nada', () => {
    const vacio = analizarOnsets(new Float32Array(SR * 10), SR);
    expect(vacio.onsets).toHaveLength(0);
    expect(estimarTempo(vacio)).toBeNull();
  });
});

describe('automapa', () => {
  const grilla: Grilla = { bpm: 128, offsetMs: 250, divisor: 4 };
  const analisis = analizarOnsets(senalDeClicks(128, 250, 40), SR);

  it('es determinista con la misma semilla y cambia con otra', () => {
    const a = generarNotas(analisis.onsets, grilla, { nivel: 'dificil', semilla: 5 });
    const b = generarNotas(analisis.onsets, grilla, { nivel: 'dificil', semilla: 5 });
    const c = generarNotas(analisis.onsets, grilla, { nivel: 'dificil', semilla: 6 });
    expect(a).toEqual(b);
    expect(a.map((n) => n.column)).not.toEqual(c.map((n) => n.column));
  });

  it('todas las notas caen sobre la grilla y estan ordenadas', () => {
    const notas = generarNotas(analisis.onsets, grilla, { nivel: 'normal', notasLargas: true });
    expect(notas.length).toBeGreaterThan(10);
    for (let i = 0; i < notas.length; i++) {
      const n = notas[i]!;
      expect(Math.abs(ajustarAGrilla(grilla, n.time) - n.time)).toBeLessThan(1e-6);
      if (n.kind === 'hold') expect(n.endTime).toBeGreaterThan(n.time);
      if (i > 0) expect(n.time).toBeGreaterThanOrEqual(notas[i - 1]!.time);
    }
  });

  it('ninguna nota cae dentro de una nota larga de su misma columna', () => {
    const notas = generarNotas(analisis.onsets, grilla, {
      nivel: 'experto',
      notasLargas: true,
      semilla: 3,
    });
    for (const larga of notas.filter((n) => n.kind === 'hold')) {
      if (larga.kind !== 'hold') continue;
      const dentro = notas.filter(
        (n) =>
          n !== larga && n.column === larga.column && n.time >= larga.time && n.time <= larga.endTime,
      );
      expect(dentro).toEqual([]);
    }
  });

  it('sin notas largas activadas no genera ninguna', () => {
    const notas = generarNotas(analisis.onsets, grilla, { nivel: 'normal' });
    expect(notas.every((n) => n.kind === 'tap')).toBe(true);
  });

  it('un nivel mas alto genera mas notas', () => {
    const cuenta = (nivel: 'facil' | 'normal' | 'dificil' | 'experto'): number =>
      generarNotas(analisis.onsets, grilla, { nivel }).length;
    expect(cuenta('facil')).toBeLessThan(cuenta('dificil'));
    expect(cuenta('dificil')).toBeLessThanOrEqual(cuenta('experto'));
  });

  it('respeta el techo de notas por segundo del nivel', () => {
    const notas = generarNotas(analisis.onsets, grilla, { nivel: 'facil' });
    const filas = new Set(notas.map((n) => n.time)).size;
    const segundos = 40;
    expect(filas / segundos).toBeLessThanOrEqual(PRESETS_AUTO.facil.nps + 0.5);
  });

  it('el nivel facil no pone acordes ni jacks', () => {
    const notas = generarNotas(analisis.onsets, grilla, { nivel: 'facil' });
    const porTiempo = new Map<number, number>();
    for (const n of notas) porTiempo.set(n.time, (porTiempo.get(n.time) ?? 0) + 1);
    expect(Math.max(...porTiempo.values())).toBe(1);
    for (let i = 1; i < notas.length; i++) {
      expect(notas[i]!.column).not.toBe(notas[i - 1]!.column);
    }
  });

  it('sin onsets no genera notas', () => {
    expect(generarNotas([], grilla, { nivel: 'normal' })).toEqual([]);
  });
});
