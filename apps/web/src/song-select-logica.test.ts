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
  conDificultadesOrdenadas,
  contarNotasLargas,
  densidadNotasPorSegundo,
  duracionMs,
  elegirIndiceAleatorio,
  estrellasDeCancion,
  filtrarCanciones,
  filtrarPorRangoDeEstrellas,
  formatearDuracion,
  nivelDeEstrellas,
  nombreVisibleDeDificultad,
  ordenarCanciones,
  ordenarDificultades,
  textoDeImportacionFallida,
  type NivelEstrellas,
  type ObtenerEstrellas,
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

  it('por estrellas, orden ascendente segun el maximo ya calculado de cada cancion', () => {
    const chartA = lista[1]!.dificultades[0]!; // 'a', bpm 175
    const chartB = lista[0]!.dificultades[0]!; // 'b', bpm 200
    const chartC = lista[2]!.dificultades[0]!; // 'c', bpm 150
    const estrellas: ObtenerEstrellas = (chart) => {
      if (chart === chartA) return 5;
      if (chart === chartB) return 1;
      if (chart === chartC) return 3;
      return undefined;
    };
    // Si se ignorara `obtenerEstrellas` (por ejemplo, cayera al orden de
    // bpm), esto daria ['c','a','b'] en vez de ['b','c','a'] (1 < 3 < 5).
    const resultado = ordenarCanciones(lista, 'estrellas', estrellas);
    expect(resultado.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('estrellasDeCancion', () => {
  it('con una sola dificultad calculada, devuelve su valor', () => {
    const c = cancion({ id: 'x', dificultades: [chart()] });
    const chartX = c.dificultades[0]!;
    const obtener: ObtenerEstrellas = (ch) => (ch === chartX ? 4.2 : undefined);
    expect(estrellasDeCancion(c, obtener)).toBe(4.2);
  });

  it('con varias dificultades, devuelve el maximo, no el primero ni el promedio', () => {
    const facil = chart({ metadata: { ...chart().metadata, difficultyName: 'Facil' } });
    const dificil = chart({ metadata: { ...chart().metadata, difficultyName: 'Dificil' } });
    const c = cancion({ id: 'x', dificultades: [facil, dificil] });
    const obtener: ObtenerEstrellas = (ch) => (ch === facil ? 2 : ch === dificil ? 7 : undefined);
    // Una implementacion que tomara la primera dificultad daria 2, o el
    // promedio daria 4.5: ninguna de las dos es lo que pide el ticket (el
    // "maximo" para ordenar/filtrar).
    expect(estrellasDeCancion(c, obtener)).toBe(7);
  });

  it('dificultades sin calcular todavia (undefined) no cuentan como 0 real: se ignoran del maximo', () => {
    const sinCalcular = chart({ metadata: { ...chart().metadata, difficultyName: 'Sin calcular' } });
    const calculada = chart({ metadata: { ...chart().metadata, difficultyName: 'Calculada' } });
    const c = cancion({ id: 'x', dificultades: [sinCalcular, calculada] });
    const obtener: ObtenerEstrellas = (ch) => (ch === calculada ? 3 : undefined);
    expect(estrellasDeCancion(c, obtener)).toBe(3);
  });

  it('sin ninguna dificultad calculada todavia, da 0', () => {
    const c = cancion({ id: 'x', dificultades: [chart()] });
    expect(estrellasDeCancion(c, () => undefined)).toBe(0);
  });
});

describe('filtrarPorRangoDeEstrellas', () => {
  const chart2 = chart({ metadata: { ...chart().metadata, difficultyName: '2' } });
  const chart5 = chart({ metadata: { ...chart().metadata, difficultyName: '5' } });
  const chart8 = chart({ metadata: { ...chart().metadata, difficultyName: '8' } });
  const lista = [
    cancion({ id: 'baja', dificultades: [chart2] }),
    cancion({ id: 'media', dificultades: [chart5] }),
    cancion({ id: 'alta', dificultades: [chart8] }),
  ];
  const obtener: ObtenerEstrellas = (ch) => {
    if (ch === chart2) return 2;
    if (ch === chart5) return 5;
    if (ch === chart8) return 8;
    return undefined;
  };

  it('sin minimo ni maximo (null, null), devuelve todo sin filtrar', () => {
    expect(filtrarPorRangoDeEstrellas(lista, null, null, obtener)).toHaveLength(3);
  });

  it('con minimo, excluye lo que queda por debajo', () => {
    const resultado = filtrarPorRangoDeEstrellas(lista, 4, null, obtener);
    expect(resultado.map((c) => c.id)).toEqual(['media', 'alta']);
  });

  it('con maximo, excluye lo que queda por encima', () => {
    const resultado = filtrarPorRangoDeEstrellas(lista, null, 6, obtener);
    expect(resultado.map((c) => c.id)).toEqual(['baja', 'media']);
  });

  it('el rango es inclusivo en los dos extremos', () => {
    // Si fuera exclusivo, 'baja' (2) y 'alta' (8) quedarian afuera de [2, 8].
    const resultado = filtrarPorRangoDeEstrellas(lista, 2, 8, obtener);
    expect(resultado.map((c) => c.id).sort()).toEqual(['alta', 'baja', 'media']);
  });

  it('un rango que no matchea nada devuelve vacio', () => {
    expect(filtrarPorRangoDeEstrellas(lista, 9, 10, obtener)).toEqual([]);
  });

  it('no muta el arreglo de entrada', () => {
    const original = [...lista];
    filtrarPorRangoDeEstrellas(lista, 4, null, obtener);
    expect(lista).toEqual(original);
  });
});

describe('nivelDeEstrellas', () => {
  it.each<[number, NivelEstrellas]>([
    [0, 'facil'],
    [1.99, 'facil'],
    [2, 'normal'],
    [2.99, 'normal'],
    [3, 'dificil'],
    [3.99, 'dificil'],
    [4, 'insano'],
    [4.99, 'insano'],
    [5, 'experto'],
    [6.49, 'experto'],
    [6.5, 'extremo'],
    [12, 'extremo'],
  ])('%f estrellas -> %s (los bordes exactos pertenecen al nivel de arriba)', (estrellas, esperado) => {
    // Una implementacion con <= en vez de < en los cortes pondria el borde
    // exacto (2, 3, 4, 5, 6.5) en el nivel de abajo.
    expect(nivelDeEstrellas(estrellas)).toBe(esperado);
  });

  it('NaN cae en facil (todas las comparaciones con NaN dan false)', () => {
    // Una cadena de `if (x < corte)` sin mirar NaN lo mandaria a 'extremo'.
    expect(nivelDeEstrellas(Number.NaN)).toBe('facil');
  });

  it('un valor negativo cae en facil', () => {
    expect(nivelDeEstrellas(-3)).toBe('facil');
  });

  it('infinito positivo es extremo', () => {
    expect(nivelDeEstrellas(Number.POSITIVE_INFINITY)).toBe('extremo');
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

// T-054: orden de las dificultades de mas facil a mas dificil.
describe('ordenarDificultades', () => {
  type Columna = 0 | 1 | 2 | 3;

  /** `cantidad` taps repartidos entre `desdeMs` y `hastaMs`, de la dificultad `nombre`. */
  function dificultad(nombre: string, cantidad: number, desdeMs: number, hastaMs: number): Chart {
    const notes: Chart['notes'] = [];
    for (let i = 0; i < cantidad; i++) {
      const tiempo = cantidad === 1 ? desdeMs : desdeMs + ((hastaMs - desdeMs) * i) / (cantidad - 1);
      notes.push({ kind: 'tap', time: tiempo, column: (i % 4) as Columna });
    }
    return chart({ metadata: { ...chart().metadata, difficultyName: nombre }, notes });
  }

  const nombres = (charts: readonly Chart[]): string[] => charts.map((c) => c.metadata.difficultyName);

  it('ordena de menor a mayor densidad, no por nombre ni por el orden del zip', () => {
    // Orden alfabetico del zip: another, drago's insane, hard, intermediate, sky blue.
    const zip = [
      dificultad('another', 400, 0, 100_000), // 4/s
      dificultad("drago's insane", 800, 0, 100_000), // 8/s
      dificultad('hard', 300, 0, 100_000), // 3/s
      dificultad('intermediate', 200, 0, 100_000), // 2/s
      dificultad('sky blue', 100, 0, 100_000), // 1/s
    ];
    // Dejar el orden de entrada (o un sort por nombre) daria another primero.
    expect(nombres(ordenarDificultades(zip))).toEqual([
      'sky blue',
      'intermediate',
      'hard',
      'another',
      "drago's insane",
    ]);
  });

  it('la densidad se mide entre la primera y la ultima nota, no desde el tiempo 0', () => {
    // A: 100 notas en 10 s (10/s) tras 50 s de intro. B: 200 notas en 40 s (5/s) desde 0.
    // Medida desde 0, A daria 100/60 (1.7/s) y quedaria antes que B.
    const a = dificultad('A', 100, 50_000, 60_000);
    const b = dificultad('B', 200, 0, 40_000);
    expect(nombres(ordenarDificultades([a, b]))).toEqual(['B', 'A']);
  });

  it('una hold cuenta hasta su endTime al medir el tramo', () => {
    // Dos notas cada una; la que termina en un hold largo tiene el tramo mas largo, luego menos densidad.
    const corta = chart({
      metadata: { ...chart().metadata, difficultyName: 'aCorta' },
      notes: [
        { kind: 'tap', time: 0, column: 0 },
        { kind: 'tap', time: 10_000, column: 1 },
      ],
    });
    const conHold = chart({
      metadata: { ...chart().metadata, difficultyName: 'zHold' },
      notes: [
        { kind: 'tap', time: 0, column: 0 },
        { kind: 'hold', time: 10_000, endTime: 20_000, column: 1 },
      ],
    });
    // Midiendo solo el time de la ultima nota quedarian empatadas y 'zHold' saldria despues de 'aCorta' por nombre.
    expect(nombres(ordenarDificultades([corta, conHold]))).toEqual(['zHold', 'aCorta']);
  });

  it('con la misma densidad desempata por cantidad de notas', () => {
    const chica = dificultad('zeta', 50, 0, 10_000); // 5/s
    const grande = dificultad('alfa', 100, 0, 20_000); // 5/s
    // Por nombre saldria alfa primero; por cantidad de notas, zeta.
    expect(nombres(ordenarDificultades([grande, chica]))).toEqual(['zeta', 'alfa']);
  });

  it('con densidad y cantidad iguales desempata por nombre', () => {
    const b = dificultad('B', 10, 0, 5_000);
    const a = dificultad('a', 10, 0, 5_000);
    const c = dificultad('C', 10, 0, 5_000);
    expect(nombres(ordenarDificultades([c, b, a]))).toEqual(['a', 'B', 'C']);
  });

  it('es estable: dos dificultades identicas conservan su orden de entrada', () => {
    const uno = dificultad('Igual', 10, 0, 5_000);
    const dos = dificultad('Igual', 10, 0, 5_000);
    const resultado = ordenarDificultades([uno, dos]);
    expect(resultado[0]).toBe(uno);
    expect(resultado[1]).toBe(dos);
  });

  it('un mapa sin notas o con una sola nota (densidad 0) va primero y no rompe', () => {
    const vacia = chart({ metadata: { ...chart().metadata, difficultyName: 'vacia' }, notes: [] });
    const una = dificultad('una', 1, 1000, 1000);
    const normal = dificultad('normal', 20, 0, 10_000);
    expect(nombres(ordenarDificultades([normal, una, vacia]))).toEqual(['vacia', 'una', 'normal']);
  });

  it('no muta la lista de entrada y devuelve los mismos objetos Chart', () => {
    const dificil = dificultad('dificil', 100, 0, 10_000);
    const facil = dificultad('facil', 10, 0, 10_000);
    const entrada = [dificil, facil];
    const salida = ordenarDificultades(entrada);
    expect(entrada[0]).toBe(dificil);
    expect(salida).not.toBe(entrada);
    expect(salida[0]).toBe(facil);
  });

  it('lista vacia da lista vacia', () => {
    expect(ordenarDificultades([])).toEqual([]);
  });
});

describe('conDificultadesOrdenadas', () => {
  it('ordena las dificultades de la cancion y conserva el resto de sus campos', () => {
    const facil = chart({
      metadata: { ...chart().metadata, difficultyName: 'facil' },
      notes: [
        { kind: 'tap', time: 0, column: 0 },
        { kind: 'tap', time: 10_000, column: 1 },
      ],
    });
    const dificil = chart({
      metadata: { ...chart().metadata, difficultyName: 'dificil' },
      notes: Array.from({ length: 50 }, (_, i) => ({
        kind: 'tap' as const,
        time: i * 200,
        column: (i % 4) as 0 | 1 | 2 | 3,
      })),
    });
    const cancion = { id: 'x', titulo: 'T', dificultades: [dificil, facil] };
    const ordenada = conDificultadesOrdenadas(cancion);
    expect(ordenada.id).toBe('x');
    expect(ordenada.titulo).toBe('T');
    expect(ordenada.dificultades[0]).toBe(facil);
    // La original no se toca.
    expect(cancion.dificultades[0]).toBe(dificil);
  });
});

describe('textoDeImportacionFallida', () => {
  it('nombra el archivo que no se pudo importar', () => {
    expect(textoDeImportacionFallida('mapa.osz')).toBe('No se pudo importar mapa.osz');
  });

  it('sin nombre de archivo no deja un espacio colgando', () => {
    expect(textoDeImportacionFallida('  ')).toBe('No se pudo importar');
  });
});

describe('nombreVisibleDeDificultad (T-048)', () => {
  it('pone la tilde a los nombres sin tilde que ya viven guardados', () => {
    expect(nombreVisibleDeDificultad('Facil')).toBe('Fácil');
    expect(nombreVisibleDeDificultad('Dificil')).toBe('Difícil');
  });

  it('cualquier otro nombre pasa tal cual', () => {
    expect(nombreVisibleDeDificultad('Normal')).toBe('Normal');
    expect(nombreVisibleDeDificultad('Fácil')).toBe('Fácil');
    expect(nombreVisibleDeDificultad('Insane [4K]')).toBe('Insane [4K]');
  });
});
