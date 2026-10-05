// Tests de T-049: [Events], Source y Tags en el escritor de .osu.

import { describe, expect, it } from 'vitest';
import type { Chart } from '../types.js';
import { parseOsu } from './osu.js';
import { escribirOsu } from './osu-escritor.js';

function chartBase(): Chart {
  return {
    metadata: {
      title: 'Cancion',
      artist: 'Artista',
      creator: 'Arnold Alvarez',
      difficultyName: 'Normal',
      audioFile: 'audio.mp3',
      previewTime: 0,
    },
    overallDifficulty: 7,
    hpDrain: 5,
    timingPoints: [{ time: 0, bpm: 120, meter: 4 }],
    speedPoints: [],
    notes: [{ kind: 'tap', time: 500, column: 1 }],
  };
}

/** Texto de la seccion [Events] (hasta el siguiente encabezado). */
function seccionEventos(texto: string): string {
  const desde = texto.indexOf('[Events]');
  const hasta = texto.indexOf('[TimingPoints]');
  return texto.slice(desde, hasta);
}

describe('escribirOsu: [Events]', () => {
  it('con fondo y video escribe las dos lineas con el formato de osu!', () => {
    const chart = chartBase();
    chart.metadata.backgroundFile = 'bg.jpg';
    chart.metadata.videoFile = 'vid.mp4';
    chart.metadata.videoOffset = -120;
    const eventos = seccionEventos(escribirOsu(chart));
    expect(eventos).toContain('0,0,"bg.jpg",0,0');
    expect(eventos).toContain('Video,-120,"vid.mp4"');
  });

  it('sin fondo ni video deja [Events] sin lineas de recurso', () => {
    const eventos = seccionEventos(escribirOsu(chartBase()));
    expect(eventos).not.toContain('0,0,"');
    expect(eventos).not.toContain('Video,');
  });

  it('solo fondo: no escribe linea de video', () => {
    const chart = chartBase();
    chart.metadata.backgroundFile = 'bg.png';
    const eventos = seccionEventos(escribirOsu(chart));
    expect(eventos).toContain('0,0,"bg.png",0,0');
    expect(eventos).not.toContain('Video,');
  });

  it('un video sin videoOffset se escribe con offset 0', () => {
    const chart = chartBase();
    chart.metadata.videoFile = 'v.mp4';
    expect(seccionEventos(escribirOsu(chart))).toContain('Video,0,"v.mp4"');
  });

  it('el viaje de ida y vuelta conserva fondo, video, offset, Source y Tags', () => {
    const chart = chartBase();
    chart.metadata.backgroundFile = 'img/BG.JPG';
    chart.metadata.videoFile = 'vid/clip.webm';
    chart.metadata.videoOffset = 250;
    chart.metadata.source = 'Mi Juego';
    chart.metadata.tags = 'rock chill';
    const r = parseOsu(escribirOsu(chart));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chart.metadata).toEqual(chart.metadata);
  });

  it('un nombre con comillas o saltos de linea no rompe el formato', () => {
    const chart = chartBase();
    chart.metadata.backgroundFile = 'a"b\nc.jpg';
    const r = parseOsu(escribirOsu(chart));
    expect(r.ok && r.chart.metadata.backgroundFile).toBe('ab c.jpg');
  });
});

describe('escribirOsu: Source y Tags', () => {
  it('sin tags escribe tetra; sin source no aparece al parsear', () => {
    const texto = escribirOsu(chartBase());
    expect(texto).toContain('Tags:tetra');
    const r = parseOsu(texto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chart.metadata.tags).toBe('tetra');
    expect(r.chart.metadata.source).toBeUndefined();
  });

  it('con tags propios escribe esos y no agrega tetra', () => {
    const chart = chartBase();
    chart.metadata.tags = 'a b';
    const texto = escribirOsu(chart);
    expect(texto).toContain('Tags:a b');
    expect(texto).not.toContain('Tags:tetra');
  });
});
