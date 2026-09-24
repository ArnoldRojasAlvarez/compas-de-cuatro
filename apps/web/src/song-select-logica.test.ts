// Tests de T-011 para la logica pura del song select (ver
// song-select-logica.ts). Convencion del proyecto: antes de cada aserche
// pensar que implementacion incorrecta la haria fallar (ver CLAUDE.md /
// docs/tickets/T-011-navegacion-y-song-select.md, "Leccion de tests").

import { describe, expect, it } from 'vitest';
import type { Chart } from '@tetra/core';
import type { CancionGuardada } from '@tetra/storage';
import {
  bpmPrincipal,
  calcularInfoDeDificultad,
  contarNotasLargas,
  densidadNotasPorSegundo,
  duracionMs,
  elegirIndiceAleatorio,
  filtrarCanciones,
  formatearDuracion,
  ordenarCanciones,
} from './song-select-logica.js';

function chart(parcial: Partial<Chart> = {}): Chart {
  return {
    metadata: {
      title: 'Titulo',
      artist: 'Artista',
      creator: 'Creador',
      difficultyName: 'Normal',
      audioFile: 'audio.mp3',
      previewTime: 0,
    },
    overallDifficulty: 6,
    hpDrain: 5,
    timingPoints: [{ time: 0, bpm: 120, meter: 4 }],
    speedPoints: [],
    notes: [],
    ...parcial,
  };
}

describe('duracionMs', () => {
  it('con notas simples, es el time de la ultima nota', () => {
    const c = chart({
      notes: [
        { kind: 'tap', time: 0, column: 0 },
        { kind: 'tap', time: 1000, column: 1 },
      ],
    });
    // Una implementacion que mirara solo notes[0] (asumiendo orden
    // descendente) daria 0 en vez de 1000.
    expect(duracionMs(c)).toBe(1000);
  });

  it('una hold note cuenta hasta su endTime, no su time de inicio', () => {
    const c = chart({
      notes: [{ kind: 'hold', time: 500, endTime: 3000, column: 0 }],
    });
    // Una implementacion que usara nota.time para todas las notas (sin
    // distinguir hold) daria 500.
    expect(duracionMs(c)).toBe(3000);
  });

  it('sin notas, cae al ultimo timing point', () => {
    const c = chart({
      notes: [],
      timingPoints: [
        { time: 0, bpm: 120, meter: 4 },
        { time: 5000, bpm: 140, meter: 4 },
      ],
    });
    expect(duracionMs(c)).toBe(5000);
  });

  it('sin notas ni timing points mas alla de 0, da 0', () => {
    expect(duracionMs(chart({ notes: [], timingPoints: [{ time: 0, bpm: 120, meter: 4 }] }))).toBe(
      0,
    );
  });
});

describe('bpmPrincipal', () => {
  it('con un solo timing point, devuelve ese BPM sin ambiguedad', () => {
    expect(bpmPrincipal(chart({ timingPoints: [{ time: 0, bpm: 174, meter: 4 }] }))).toBe(174);
  });

  it('con varios tramos, elige el BPM que estuvo vigente mas tiempo, no el primero', () => {
    const c = chart({
      timingPoints: [
        { time: 0, bpm: 300, meter: 4 }, // tramo corto: 0 a 1000ms
        { time: 1000, bpm: 120, meter: 4 }, // tramo largo: 1000 a 10000ms
      ],
      notes: [{ kind: 'tap', time: 10000, column: 0 }],
    });
    // Una implementacion que devolviera puntos[0].bpm (el primero) daria
    // 300; una que promediara sin ponderar por duracion daria 210.
    expect(bpmPrincipal(c)).toBe(120);
  });

  it('no asume que los timing points ya vengan ordenados por time', () => {
    const c = chart({
      timingPoints: [
        { time: 1000, bpm: 120, meter: 4 },
        { time: 0, bpm: 300, meter: 4 },
      ],
      notes: [{ kind: 'tap', time: 10000, column: 0 }],
    });
    // Si no se ordenara antes de medir tramos, el tramo "0 a 1000" (donde
    // en realidad manda el bpm 300) se calcularia mal.
    expect(bpmPrincipal(c)).toBe(120);
  });

  it('sin timing points, no revienta: devuelve 0', () => {
    expect(bpmPrincipal(chart({ timingPoints: [] }))).toBe(0);
  });
});

describe('contarNotasLargas', () => {
  it('cuenta solo las hold, no las tap', () => {
    const c = chart({
      notes: [
        { kind: 'tap', time: 0, column: 0 },
        { kind: 'hold', time: 100, endTime: 500, column: 1 },
        { kind: 'tap', time: 600, column: 2 },
        { kind: 'hold', time: 700, endTime: 900, column: 3 },
      ],
    });
    expect(contarNotasLargas(c)).toBe(2);
  });

  it('sin holds, da 0', () => {
    expect(contarNotasLargas(chart({ notes: [{ kind: 'tap', time: 0, column: 0 }] }))).toBe(0);
  });
});

describe('densidadNotasPorSegundo', () => {
  it('10 notas en 5 segundos son 2 notas por segundo', () => {
    const notas = Array.from({ length: 10 }, (_, i) => ({
      kind: 'tap' as const,
      time: i * 500,
      column: (i % 4) as 0 | 1 | 2 | 3,
    }));
    const c = chart({ notes: [...notas, { kind: 'tap', time: 5000, column: 0 }] });
    // 11 notas, la ultima en 5000ms = 5s de duracion.
    expect(densidadNotasPorSegundo(c)).toBeCloseTo(11 / 5, 5);
  });

  it('duracion cero (sin notas ni timing mas alla de 0) no divide por cero: da 0', () => {
    expect(densidadNotasPorSegundo(chart({ notes: [] }))).toBe(0);
  });
});

describe('formatearDuracion', () => {
  it.each([
    [0, '0:00'],
    [1000, '0:01'],
    [59000, '0:59'],
    [60000, '1:00'],
    [221000, '3:41'],
  ])('%i ms -> %s', (ms, esperado) => {
    expect(formatearDuracion(ms)).toBe(esperado);
  });

  it('redondea al segundo mas cercano, no trunca', () => {
    // 3:40.9 tiene que verse como 3:41, no 3:40: una implementacion que
    // hiciera Math.floor en vez de Math.round fallaria esto.
    expect(formatearDuracion(220900)).toBe('3:41');
  });
});

describe('calcularInfoDeDificultad', () => {
  it('junta todos los datos que pide el ticket (BPM, duracion, notas, LN, OD, HP, densidad)', () => {
    const c = chart({
      metadata: {
        title: 'T',
        artist: 'A',
        creator: 'Creador X',
        difficultyName: 'Insane',
        audioFile: 'a.mp3',
        previewTime: 0,
      },
      overallDifficulty: 8,
      hpDrain: 6,
      timingPoints: [{ time: 0, bpm: 200, meter: 4 }],
      notes: [
        { kind: 'tap', time: 0, column: 0 },
        { kind: 'hold', time: 500, endTime: 1500, column: 1 },
      ],
    });
    const info = calcularInfoDeDificultad(c);
    expect(info.nombre).toBe('Insane');
    expect(info.creador).toBe('Creador X');
    expect(info.bpm).toBe(200);
    expect(info.duracionMs).toBe(1500);
    expect(info.notas).toBe(2);
    expect(info.notasLargas).toBe(1);
    expect(info.overallDifficulty).toBe(8);
    expect(info.hpDrain).toBe(6);
    expect(info.densidadNotasPorSegundo).toBeCloseTo(2 / 1.5, 5);
  });
});

// -----------------------------------------------------------------------
// Lista de canciones
// -----------------------------------------------------------------------

function cancion(parcial: Partial<CancionGuardada> & { id: string }): CancionGuardada {
  return {
    titulo: 'Sin titulo',
    artista: 'Sin artista',
    audio: new Blob(),
    dificultades: [chart()],
    ...parcial,
  };
}

describe('filtrarCanciones', () => {
  const lista = [
    cancion({ id: '1', titulo: 'Freedom Dive', artista: 'xi' }),
    cancion({ id: '2', titulo: 'Sidetracked Day', artista: 'Yuyoyuppe' }),
    cancion({ id: '3', titulo: 'Blue Zenith', artista: 'xi' }),
  ];

  it('consulta vacia devuelve todas, sin filtrar', () => {
    expect(filtrarCanciones(lista, '')).toHaveLength(3);
  });

  it('consulta de solo espacios se trata como vacia', () => {
    expect(filtrarCanciones(lista, '   ')).toHaveLength(3);
  });

  it('filtra por titulo, sin distinguir mayusculas/minusculas', () => {
    const resultado = filtrarCanciones(lista, 'FREEDOM');
    expect(resultado.map((c) => c.id)).toEqual(['1']);
  });

  it('filtra por artista tambien, no solo por titulo', () => {
    // Si la implementacion solo mirara el titulo, esto daria 0 resultados.
    const resultado = filtrarCanciones(lista, 'yuyoyuppe');
    expect(resultado.map((c) => c.id)).toEqual(['2']);
  });

  it('una consulta que matchea varias devuelve todas esas, no solo la primera', () => {
    const resultado = filtrarCanciones(lista, 'xi');
    expect(resultado.map((c) => c.id).sort()).toEqual(['1', '3']);
  });

  it('sin coincidencias, devuelve vacio', () => {
    expect(filtrarCanciones(lista, 'nada que ver')).toEqual([]);
  });

  it('no muta el arreglo de entrada', () => {
    const original = [...lista];
    filtrarCanciones(lista, 'xi');
    expect(lista).toEqual(original);
  });
});

describe('ordenarCanciones', () => {
  const lista = [
    cancion({
      id: 'b',
      titulo: 'Blue Zenith',
      dificultades: [chart({ timingPoints: [{ time: 0, bpm: 200, meter: 4 }] })],
    }),
    cancion({
      id: 'a',
      titulo: 'Aleph-0',
      dificultades: [chart({ timingPoints: [{ time: 0, bpm: 175, meter: 4 }] })],
    }),
    cancion({
      id: 'c',
      titulo: 'Crossing Delta',
      dificultades: [chart({ timingPoints: [{ time: 0, bpm: 150, meter: 4 }] })],
    }),
  ];

  it('por titulo, orden alfabetico ascendente', () => {
    const resultado = ordenarCanciones(lista, 'titulo');
    expect(resultado.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('por bpm, orden ascendente segun la primera dificultad', () => {
    // Si se ordenara por titulo por error, el resultado seria ['a','b','c']
    // en vez de ['c','a','b'] (150 < 175 < 200).
    const resultado = ordenarCanciones(lista, 'bpm');
    expect(resultado.map((c) => c.id)).toEqual(['c', 'a', 'b']);
  });

  it('no muta el arreglo de entrada (devuelve una copia)', () => {
    const original = [...lista];
    ordenarCanciones(lista, 'titulo');
    expect(lista).toEqual(original);
  });

  it('una cancion sin dificultades no revienta el orden por bpm (cuenta como bpm 0)', () => {
    const sinDificultades = cancion({ id: 'z', titulo: 'Z', dificultades: [] });
    const resultado = ordenarCanciones([...lista, sinDificultades], 'bpm');
    expect(resultado[0]!.id).toBe('z');
  });
});

describe('elegirIndiceAleatorio', () => {
  it('con total 0, no hay nada que elegir: devuelve null', () => {
    expect(elegirIndiceAleatorio(0, null, () => 0.5)).toBeNull();
  });

  it('con total 1, siempre devuelve 0 (unica opcion), incluso si coincide con excluir', () => {
    expect(elegirIndiceAleatorio(1, 0, () => 0.999)).toBe(0);
  });

  it('sin excluir, mapea aleatorio() en [0,1) al rango completo', () => {
    // aleatorio()=0 -> primer indice; aleatorio() cerca de 1 -> ultimo indice.
    expect(elegirIndiceAleatorio(5, null, () => 0)).toBe(0);
    expect(elegirIndiceAleatorio(5, null, () => 0.999)).toBe(4);
  });

  it('con excluir, nunca devuelve el indice excluido', () => {
    // Recorre todo el rango de aleatorio() y verifica que el resultado
    // jamas sea el indice excluido: una implementacion que "saltara" mal
    // el hueco (por ejemplo con <= en vez de >=) fallaria en el borde.
    for (let i = 0; i < 20; i++) {
      const r = i / 20;
      expect(elegirIndiceAleatorio(5, 2, () => r)).not.toBe(2);
    }
  });

  it('con excluir, sigue cubriendo todos los demas indices posibles', () => {
    const vistos = new Set<number>();
    for (let i = 0; i < 8; i++) {
      vistos.add(elegirIndiceAleatorio(8, 3, () => i / 8)!);
    }
    // Los 7 indices restantes (todos menos el 3) tienen que aparecer.
    expect([...vistos].sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 5, 6, 7]);
  });

  it('aleatorio() = 1 exacto (limite superior) no se va de rango', () => {
    expect(elegirIndiceAleatorio(5, null, () => 1)).toBe(4);
    expect(elegirIndiceAleatorio(5, 2, () => 1)).toBe(4);
  });
});
