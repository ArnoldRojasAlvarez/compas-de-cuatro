// Tests de la logica pura del mapeador. Mismo doble de Storage que el resto
// de los tests de apps/web (vitest corre en entorno node).

import { describe, expect, it } from 'vitest';
import type { Grilla, Note } from '@tetra/core';
import {
  agregarTap,
  alternarTap,
  borrarBorrador,
  calcularPicos,
  colocarLarga,
  columnaDeX,
  construirChart,
  crearHistorial,
  espejar,
  guardarBorrador,
  leerBorrador,
  leerNumero,
  limitarZoom,
  mezclarMono,
  notaEn,
  quitarNota,
  quitarRango,
  resumirNotas,
  slotDeY,
  tiempoDeSlotEntero,
  tiempoDeY,
  yDeTiempo,
  ZOOM_MAX,
  ZOOM_MIN,
  type Borrador,
  type Vista,
} from './mapeador-logica.js';

function crearStorageFalso(): Storage {
  const datos = new Map<string, string>();
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => {
      datos.set(k, v);
    },
    removeItem: (k: string) => {
      datos.delete(k);
    },
    clear: () => datos.clear(),
    key: () => null,
    get length() {
      return datos.size;
    },
  } as Storage;
}

const grilla: Grilla = { bpm: 120, offsetMs: 0, divisor: 4 };

describe('notas', () => {
  it('alternarTap pone una nota y la quita al repetir', () => {
    const una = alternarTap([], 1, 500);
    expect(una).toEqual([{ kind: 'tap', time: 500, column: 1 }]);
    expect(alternarTap(una, 1, 500)).toEqual([]);
  });

  it('no muta el arreglo que recibe', () => {
    const original: Note[] = [{ kind: 'tap', time: 100, column: 0 }];
    alternarTap(original, 2, 200);
    expect(original).toHaveLength(1);
  });

  it('mantiene las notas ordenadas por tiempo y columna', () => {
    let notas: Note[] = [];
    notas = alternarTap(notas, 3, 900);
    notas = alternarTap(notas, 2, 100);
    notas = alternarTap(notas, 0, 100);
    expect(notas.map((n) => [n.time, n.column])).toEqual([
      [100, 0],
      [100, 2],
      [900, 3],
    ]);
  });

  it('redondea a ms entero', () => {
    expect(alternarTap([], 0, 123.6)[0]!.time).toBe(124);
  });

  it('agregarTap nunca quita (grabacion en vivo)', () => {
    const una = agregarTap([], 0, 500);
    expect(agregarTap(una, 0, 500)).toHaveLength(1);
  });

  it('colocarLarga acepta los extremos en cualquier orden', () => {
    const n = colocarLarga([], 2, 1000, 400);
    expect(n).toEqual([{ kind: 'hold', time: 400, endTime: 1000, column: 2 }]);
  });

  it('colocarLarga borra lo que cae adentro en la misma columna y respeta otras columnas', () => {
    const base: Note[] = [
      { kind: 'tap', time: 600, column: 2 },
      { kind: 'tap', time: 600, column: 1 },
      { kind: 'tap', time: 2000, column: 2 },
    ];
    const n = colocarLarga(base, 2, 400, 1000);
    expect(n.filter((x) => x.column === 2).map((x) => x.time)).toEqual([400, 2000]);
    expect(n.some((x) => x.column === 1 && x.time === 600)).toBe(true);
  });

  it('una larga de largo cero se vuelve un tap', () => {
    expect(colocarLarga([], 0, 300, 300)).toEqual([{ kind: 'tap', time: 300, column: 0 }]);
  });

  it('notaEn encuentra un tap exacto y una larga por su interior', () => {
    const notas: Note[] = [
      { kind: 'tap', time: 100, column: 0 },
      { kind: 'hold', time: 500, endTime: 900, column: 1 },
    ];
    expect(notaEn(notas, 0, 100)).toBeDefined();
    expect(notaEn(notas, 0, 110)).toBeUndefined();
    expect(notaEn(notas, 1, 700)).toBeDefined();
    expect(notaEn(notas, 2, 700)).toBeUndefined();
  });

  it('alternar sobre el interior de una larga la quita entera', () => {
    const notas: Note[] = [{ kind: 'hold', time: 500, endTime: 900, column: 1 }];
    expect(alternarTap(notas, 1, 700)).toEqual([]);
  });

  it('quitarNota y quitarRango', () => {
    const notas: Note[] = [
      { kind: 'tap', time: 100, column: 0 },
      { kind: 'tap', time: 200, column: 1 },
      { kind: 'hold', time: 300, endTime: 500, column: 2 },
    ];
    expect(quitarNota(notas, 1, 200)).toHaveLength(2);
    expect(quitarRango(notas, 150, 400)).toEqual([{ kind: 'tap', time: 100, column: 0 }]);
  });

  it('espejar cambia 0<->3 y 1<->2 y es su propia inversa', () => {
    const notas: Note[] = [
      { kind: 'tap', time: 1, column: 0 },
      { kind: 'tap', time: 2, column: 1 },
      { kind: 'hold', time: 3, endTime: 9, column: 3 },
    ];
    expect(espejar(notas).map((n) => n.column)).toEqual([3, 2, 0]);
    expect(espejar(espejar(notas))).toEqual(notas);
  });

  it('resumirNotas cuenta taps, largas y notas por segundo', () => {
    const r = resumirNotas([
      { kind: 'tap', time: 0, column: 0 },
      { kind: 'tap', time: 1000, column: 1 },
      { kind: 'hold', time: 1000, endTime: 2000, column: 2 },
    ]);
    expect(r).toMatchObject({ total: 3, taps: 2, largas: 1, finMs: 2000 });
    expect(r.nps).toBeCloseTo(1.5, 6);
    expect(resumirNotas([]).nps).toBe(0);
  });
});

describe('historial', () => {
  it('deshace y rehace en orden', () => {
    const h = crearHistorial<number[]>([]);
    h.registrar([1]);
    h.registrar([1, 2]);
    expect(h.deshacer()).toEqual([1]);
    expect(h.deshacer()).toEqual([]);
    expect(h.puedeDeshacer).toBe(false);
    expect(h.rehacer()).toEqual([1]);
    expect(h.rehacer()).toEqual([1, 2]);
    expect(h.puedeRehacer).toBe(false);
  });

  it('un cambio nuevo despues de deshacer descarta el futuro', () => {
    const h = crearHistorial<number[]>([]);
    h.registrar([1]);
    h.deshacer();
    h.registrar([9]);
    expect(h.puedeRehacer).toBe(false);
    expect(h.actual).toEqual([9]);
  });

  it('registrar el mismo estado no ensucia el historial', () => {
    const estado: number[] = [];
    const h = crearHistorial(estado);
    h.registrar(estado);
    expect(h.puedeDeshacer).toBe(false);
  });

  it('respeta el limite de profundidad', () => {
    const h = crearHistorial<number>(0, 3);
    for (let i = 1; i <= 10; i++) h.registrar(i);
    let pasos = 0;
    while (h.puedeDeshacer) {
      h.deshacer();
      pasos++;
    }
    expect(pasos).toBe(3);
  });
});

describe('vista', () => {
  const vista: Vista = { tiempo: 1000, pxPorMs: 0.5, yCabezal: 400 };

  it('el cabezal esta en y = yCabezal y el futuro queda arriba', () => {
    expect(yDeTiempo(vista, 1000)).toBe(400);
    expect(yDeTiempo(vista, 1200)).toBe(300);
    expect(yDeTiempo(vista, 800)).toBe(500);
  });

  it('tiempoDeY es la inversa de yDeTiempo', () => {
    for (const t of [0, 450, 1000, 5555]) {
      expect(tiempoDeY(vista, yDeTiempo(vista, t))).toBeCloseTo(t, 9);
    }
  });

  it('slotDeY ajusta a la grilla', () => {
    // 120 BPM, divisor 4: un slot dura 125 ms. y=300 es t=1200: slot 10 (1250) esta a 50, el 9 (1125) a 75.
    expect(slotDeY(vista, grilla, 300)).toBe(10);
  });

  it('columnaDeX devuelve null fuera de las pistas', () => {
    expect(columnaDeX(105, 100, 50)).toBe(0);
    expect(columnaDeX(299, 100, 50)).toBe(3);
    expect(columnaDeX(300, 100, 50)).toBeNull();
    expect(columnaDeX(99, 100, 50)).toBeNull();
  });

  it('limitarZoom acota', () => {
    expect(limitarZoom(0)).toBe(ZOOM_MIN);
    expect(limitarZoom(99)).toBe(ZOOM_MAX);
    expect(limitarZoom(0.3)).toBe(0.3);
  });

  it('tiempoDeSlotEntero devuelve ms entero', () => {
    const g: Grilla = { bpm: 128, offsetMs: 250, divisor: 4 };
    expect(Number.isInteger(tiempoDeSlotEntero(g, 7))).toBe(true);
  });
});

describe('onda', () => {
  it('calcularPicos guarda el maximo absoluto de cada cubeta', () => {
    const muestras = new Float32Array([0.1, -0.5, 0.2, 0.9, -0.3, 0.05]);
    // 1000 Hz y 3 ms por cubeta: 3 muestras por cubeta.
    const picos = calcularPicos(muestras, 1000, 3);
    expect(Array.from(picos)).toEqual([0.5, 0.8999999761581421]);
  });

  it('mezclarMono promedia los canales', () => {
    const mono = mezclarMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(Array.from(mono)).toEqual([0.5, 0.5]);
    expect(mezclarMono([]).length).toBe(0);
  });
});

describe('construirChart', () => {
  const meta = {
    titulo: ' Mi cancion ',
    artista: '',
    creador: 'Arnold Alvarez',
    dificultad: 'Hard',
    audioArchivo: 'audio.mp3',
  };

  it('arma metadata, timing y notas ordenadas con ms enteros', () => {
    const chart = construirChart(
      meta,
      { bpm: 128, offsetMs: 250.4, divisor: 4 },
      { overallDifficulty: 8, hpDrain: 6 },
      [
        { kind: 'tap', time: 900.6, column: 1 },
        { kind: 'hold', time: 100.2, endTime: 500.5, column: 0 },
      ],
    );
    expect(chart.metadata.title).toBe('Mi cancion');
    expect(chart.metadata.artist).toBe('Desconocido');
    expect(chart.timingPoints).toEqual([{ time: 250, bpm: 128, meter: 4 }]);
    expect(chart.notes).toEqual([
      { kind: 'hold', time: 100, endTime: 501, column: 0 },
      { kind: 'tap', time: 901, column: 1 },
    ]);
    expect(chart.overallDifficulty).toBe(8);
  });
});

describe('borrador', () => {
  const borrador: Borrador = {
    version: 1,
    meta: { titulo: 'T', artista: 'A', creador: 'C', dificultad: 'D', audioArchivo: 'a.mp3' },
    grilla: { bpm: 140, offsetMs: 120, divisor: 4 },
    ajustes: { overallDifficulty: 7, hpDrain: 5 },
    notas: [
      { kind: 'tap', time: 120, column: 0 },
      { kind: 'hold', time: 500, endTime: 900, column: 3 },
    ],
  };

  it('guarda y lee el mismo borrador', () => {
    const s = crearStorageFalso();
    expect(guardarBorrador(borrador, s)).toBe(true);
    expect(leerBorrador(s)).toEqual(borrador);
  });

  it('devuelve null si no hay nada, si no es JSON o si la forma no sirve', () => {
    const s = crearStorageFalso();
    expect(leerBorrador(s)).toBeNull();
    s.setItem('tetra:mapeador-borrador', '{no es json');
    expect(leerBorrador(s)).toBeNull();
    s.setItem('tetra:mapeador-borrador', JSON.stringify({ ...borrador, version: 2 }));
    expect(leerBorrador(s)).toBeNull();
    s.setItem(
      'tetra:mapeador-borrador',
      JSON.stringify({ ...borrador, notas: [{ kind: 'tap', time: 1, column: 7 }] }),
    );
    expect(leerBorrador(s)).toBeNull();
    s.setItem(
      'tetra:mapeador-borrador',
      JSON.stringify({ ...borrador, grilla: { bpm: 0, offsetMs: 0, divisor: 4 } }),
    );
    expect(leerBorrador(s)).toBeNull();
  });

  it('una larga con fin menor que el inicio invalida el borrador', () => {
    const s = crearStorageFalso();
    s.setItem(
      'tetra:mapeador-borrador',
      JSON.stringify({ ...borrador, notas: [{ kind: 'hold', time: 900, endTime: 500, column: 1 }] }),
    );
    expect(leerBorrador(s)).toBeNull();
  });

  it('borrarBorrador lo quita', () => {
    const s = crearStorageFalso();
    guardarBorrador(borrador, s);
    borrarBorrador(s);
    expect(leerBorrador(s)).toBeNull();
  });
});

describe('leerNumero', () => {
  it.each([
    ['128', 128],
    [' 127,5 ', 127.5],
    ['-3', -3],
  ])('%j -> %d', (texto, esperado) => {
    expect(leerNumero(texto)).toBe(esperado);
  });
  it.each(['', '  ', 'abc', 'Infinity'])('%j -> null', (texto) => {
    expect(leerNumero(texto)).toBeNull();
  });
});
