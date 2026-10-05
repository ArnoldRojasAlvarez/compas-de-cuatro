// T-051: los mapas de la demo, derivados de la partitura. Funcion pura.

import { describe, expect, it } from 'vitest';
import { calcularDificultad, escribirOsu, parseOsu, type Chart, type Note } from '@tetra/core';
import { componerDemo, COMPAS_MS } from './composicion.js';
import { columnaDeAltura, mapearDemo, NIVELES_DEMO, type NivelDemo } from './mapas.js';

const composicion = componerDemo();
const mapas = Object.fromEntries(NIVELES_DEMO.map((n) => [n, mapearDemo(composicion, n)])) as Record<
  NivelDemo,
  Chart
>;

const tiemposDeEventos = new Set(composicion.eventos.map((e) => Math.round(e.tiempo)));

/** Agrupa las notas por instante: cada grupo es una fila. */
function filasDe(notas: readonly Note[]): { time: number; columnas: number[] }[] {
  const filas = new Map<number, number[]>();
  for (const n of notas) filas.set(n.time, [...(filas.get(n.time) ?? []), n.column]);
  return [...filas.entries()].sort((a, b) => a[0] - b[0]).map(([time, columnas]) => ({ time, columnas }));
}

describe.each(NIVELES_DEMO)('mapearDemo: %s', (nivel) => {
  const chart = mapas[nivel];

  it('es determinista', () => {
    expect(mapearDemo(composicion, nivel)).toEqual(chart);
  });

  it('las notas estan ordenadas por tiempo', () => {
    for (let i = 1; i < chart.notes.length; i++) {
      expect(chart.notes[i]!.time).toBeGreaterThanOrEqual(chart.notes[i - 1]!.time);
    }
  });

  it('cada nota cae exactamente en el tiempo de un evento de la composicion', () => {
    expect(chart.notes.length).toBeGreaterThan(50);
    for (const n of chart.notes) {
      expect(Number.isInteger(n.time)).toBe(true);
      expect(tiemposDeEventos.has(n.time), `nota en ${n.time} sin evento`).toBe(true);
    }
  });

  it('las notas largas terminan despues de empezar y dentro de la pieza', () => {
    for (const n of chart.notes) {
      expect(n.time).toBeGreaterThanOrEqual(0);
      if (n.kind === 'hold') {
        expect(n.endTime).toBeGreaterThan(n.time);
        expect(n.endTime).toBeLessThanOrEqual(composicion.duracion);
      }
    }
  });

  it('no hay notas superpuestas en una columna (una LN la ocupa hasta endTime + 60 ms)', () => {
    for (let c = 0; c < 4; c++) {
      const enColumna = chart.notes.filter((n) => n.column === c);
      for (let i = 1; i < enColumna.length; i++) {
        const previa = enColumna[i - 1]!;
        const margen = previa.kind === 'hold' ? previa.endTime + 60 : previa.time + 1;
        expect(enColumna[i]!.time, `columna ${c} en ${enColumna[i]!.time}`).toBeGreaterThanOrEqual(margen);
      }
    }
  });

  it('no repite columna entre filas seguidas separadas menos de 300 ms (nada de jacks)', () => {
    const filas = filasDe(chart.notes);
    for (let i = 1; i < filas.length; i++) {
      const previa = filas[i - 1]!;
      const actual = filas[i]!;
      if (actual.time - previa.time > 300) continue;
      for (const c of actual.columnas) {
        expect(previa.columnas.includes(c), `jack en ${actual.time}`).toBe(false);
      }
    }
  });

  it('usa las cuatro columnas', () => {
    expect(new Set(chart.notes.map((n) => n.column)).size).toBe(4);
  });

  it('lleva la metadata pedida', () => {
    expect(chart.metadata).toMatchObject({
      title: 'Primer Compas',
      artist: 'Tetra',
      creator: 'Tetra',
      difficultyName: nivel,
      audioFile: 'audio.wav',
      previewTime: composicion.preview,
      backgroundFile: 'fondo.jpg',
    });
    expect(chart.overallDifficulty).toBe(7);
    expect(chart.hpDrain).toBe(7);
    expect(chart.timingPoints).toEqual([{ time: 0, bpm: 128, meter: 4 }]);
  });

  it('parseOsu(escribirOsu(chart)) da las mismas notas', () => {
    const r = parseOsu(escribirOsu(chart));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chart.notes).toEqual(chart.notes);
    expect(r.chart.metadata.difficultyName).toBe(nivel);
    expect(r.chart.metadata.backgroundFile).toBe('fondo.jpg');
  });
});

describe('mapearDemo: forma de cada nivel', () => {
  it('Facil: una sola nota a la vez, sin notas largas, y solo a partir de que entra el bombo', () => {
    const { notes } = mapas.Facil;
    expect(notes.every((n) => n.kind === 'tap')).toBe(true);
    for (const f of filasDe(notes)) expect(f.columnas).toHaveLength(1);
    expect(notes[0]!.time).toBeGreaterThanOrEqual(4 * COMPAS_MS - 1);
  });

  it('Facil: la mayoria de las notas caen en negras', () => {
    const negras = mapas.Facil.notes.filter((n) => {
      const pulso = n.time / (COMPAS_MS / 4);
      return Math.abs(pulso - Math.round(pulso)) < 0.01;
    });
    // Las demas son los bombos sincopados y el redoble de caja de los fills.
    expect(negras.length / mapas.Facil.notes.length).toBeGreaterThan(0.65);
  });

  it('Facil: bombo y caja se reparten entre las manos (bombo a la izquierda, caja a la derecha)', () => {
    const bombos = new Set(composicion.eventos.filter((e) => e.voz === 'bombo').map((e) => Math.round(e.tiempo)));
    const cajas = new Set(composicion.eventos.filter((e) => e.voz === 'caja').map((e) => Math.round(e.tiempo)));
    const deBombo = mapas.Facil.notes.filter((n) => bombos.has(n.time) && !cajas.has(n.time));
    const deCaja = mapas.Facil.notes.filter((n) => cajas.has(n.time));
    expect(deBombo.length).toBeGreaterThan(20);
    expect(deCaja.length).toBeGreaterThan(20);
    expect(deBombo.filter((n) => n.column < 2).length / deBombo.length).toBeGreaterThan(0.9);
    expect(deCaja.filter((n) => n.column >= 2).length / deCaja.length).toBeGreaterThan(0.9);
  });

  it('Normal: dobles solo en los acentos (nunca mas de dos notas) y sin notas largas', () => {
    const filas = filasDe(mapas.Normal.notes);
    expect(mapas.Normal.notes.every((n) => n.kind === 'tap')).toBe(true);
    expect(Math.max(...filas.map((f) => f.columnas.length))).toBe(2);
    const dobles = filas.filter((f) => f.columnas.length === 2).length;
    expect(dobles).toBeGreaterThan(10);
    expect(dobles / filas.length).toBeLessThan(0.5);
  });

  it('Normal: todo cae en corcheas', () => {
    for (const n of mapas.Normal.notes) {
      const slot = n.time / (COMPAS_MS / 16);
      // Las corcheas son los slots pares; el redondeo a ms deja hasta 1 ms de margen.
      const cerca = Math.round(slot / 2) * 2;
      expect(Math.abs(slot - cerca) * (COMPAS_MS / 16)).toBeLessThan(1.01);
    }
  });

  it('Normal: la melodia de B esta en el mapa', () => {
    const melodias = composicion.eventos
      .filter((e) => e.voz === 'melodia' && e.tiempo >= 12 * COMPAS_MS && e.tiempo < 20 * COMPAS_MS)
      .map((e) => Math.round(e.tiempo));
    const tiempos = new Set(mapas.Normal.notes.map((n) => n.time));
    const enMapa = melodias.filter((t) => tiempos.has(t));
    // Las notas de melodia fuera de la rejilla de corcheas no se juegan en Normal.
    const enCorcheas = melodias.filter((t) => {
      const slot = t / (COMPAS_MS / 16);
      return Math.abs(slot - Math.round(slot / 2) * 2) * (COMPAS_MS / 16) < 1.01;
    });
    expect(enMapa.length).toBe(enCorcheas.length);
    expect(enMapa.length).toBeGreaterThan(15);
  });

  it('Dificil: tiene notas largas, jumps y hands (hasta tres notas por fila)', () => {
    const { notes } = mapas.Dificil;
    expect(notes.filter((n) => n.kind === 'hold').length).toBeGreaterThan(10);
    const tamanos = filasDe(notes).map((f) => f.columnas.length);
    expect(Math.max(...tamanos)).toBe(3);
    expect(tamanos.filter((t) => t === 2).length).toBeGreaterThan(20);
    expect(tamanos.filter((t) => t === 3).length).toBeGreaterThan(10);
  });

  it('Dificil: las LN salen de notas largas de la melodia o del pad', () => {
    const largos = new Set(
      composicion.eventos
        .filter((e) => (e.voz === 'melodia' || e.voz === 'acorde') && e.duracion >= 400)
        .map((e) => Math.round(e.tiempo)),
    );
    for (const n of mapas.Dificil.notes) {
      if (n.kind === 'hold') expect(largos.has(n.time), `LN en ${n.time}`).toBe(true);
    }
  });

  it('Dificil: hay semicorchas de hats en las partes llenas', () => {
    const hats = new Set(composicion.eventos.filter((e) => e.voz === 'hat').map((e) => Math.round(e.tiempo)));
    const slotMs = COMPAS_MS / 16;
    // Un compas de B (compas 13): hats en cada semicorchea del compas.
    const compas = 13;
    const enMapa = mapas.Dificil.notes.filter(
      (n) => n.time >= compas * COMPAS_MS && n.time < (compas + 1) * COMPAS_MS && hats.has(n.time),
    );
    const slots = new Set(enMapa.map((n) => Math.round((n.time - compas * COMPAS_MS) / slotMs)));
    expect(slots.size).toBeGreaterThanOrEqual(12);
  });
});

describe('mapearDemo: dificultad', () => {
  it('la densidad crece: Facil < Normal < Dificil', () => {
    const n = NIVELES_DEMO.map((nivel) => mapas[nivel].notes.length);
    expect(n[0]!).toBeLessThan(n[1]!);
    expect(n[1]!).toBeLessThan(n[2]!);
    // Y por una buena diferencia, no por una nota.
    expect(n[1]!).toBeGreaterThan(1.5 * n[0]!);
    expect(n[2]!).toBeGreaterThan(1.5 * n[1]!);
  });

  it('las estrellas de core quedan ordenadas Facil < Normal < Dificil, bien separadas', () => {
    const e = NIVELES_DEMO.map((nivel) => calcularDificultad(mapas[nivel]).overall);
    expect(e[0]!).toBeGreaterThan(0.5);
    expect(e[1]! - e[0]!).toBeGreaterThan(0.8);
    expect(e[2]! - e[1]!).toBeGreaterThan(0.8);
  });

  it('las estrellas caen en las bandas de cada nivel (modelo de T-018)', () => {
    const [facil, normal, dificil] = NIVELES_DEMO.map((nivel) => calcularDificultad(mapas[nivel]).overall) as [
      number,
      number,
      number,
    ];
    expect(facil).toBeLessThan(1.8);
    expect(normal).toBeGreaterThan(2.0);
    expect(normal).toBeLessThan(3.0);
    expect(dificil).toBeGreaterThan(3.3);
    expect(dificil).toBeLessThan(4.3);
  });
});

describe('columnaDeAltura', () => {
  it('reparte por altura: la nota mas grave a la izquierda y la mas aguda a la derecha', () => {
    const umbrales = [72, 76, 80];
    expect(columnaDeAltura(60, umbrales)).toBe(0);
    expect(columnaDeAltura(72, umbrales)).toBe(1);
    expect(columnaDeAltura(77, umbrales)).toBe(2);
    expect(columnaDeAltura(90, umbrales)).toBe(3);
  });

  it('con umbrales repetidos no se pasa de la columna 3', () => {
    expect(columnaDeAltura(100, [70, 70, 70, 70])).toBe(3);
  });

  it('en los mapas, las notas de melodia mas agudas caen en columnas mas a la derecha', () => {
    const melodias = composicion.eventos.filter((e) => e.voz === 'melodia');
    const tiemposSolo = new Set(
      composicion.eventos.filter((e) => e.voz !== 'melodia').map((e) => Math.round(e.tiempo)),
    );
    // Notas de Dificil que son solo melodia (sin otra voz en el mismo instante).
    const notaDeTiempo = new Map(melodias.map((e) => [Math.round(e.tiempo), e.nota]));
    const puntos = mapas.Dificil.notes
      .filter((n) => notaDeTiempo.has(n.time) && !tiemposSolo.has(n.time))
      .map((n) => ({ nota: notaDeTiempo.get(n.time)!, columna: n.column }));
    expect(puntos.length).toBeGreaterThan(5);
    const media = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const graves = puntos.filter((p) => p.nota <= 76).map((p) => p.columna);
    const agudos = puntos.filter((p) => p.nota >= 81).map((p) => p.columna);
    expect(graves.length).toBeGreaterThan(0);
    expect(agudos.length).toBeGreaterThan(0);
    expect(media(agudos)).toBeGreaterThan(media(graves));
  });
});
