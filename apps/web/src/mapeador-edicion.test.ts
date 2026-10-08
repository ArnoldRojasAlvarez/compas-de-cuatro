// Tests de la edicion del mapeador (T-034): seleccion, mover, copiar, pegar,
// cuantizar. Todo es logica pura de mapeador-logica.ts.

import { describe, expect, it } from 'vitest';
import type { Column, Grilla, Note } from '@tetra/core';
import {
  claveNota,
  copiarNotas,
  crearHistorial,
  cuantizadas,
  cuantizarNotas,
  desplazarNotas,
  elegidasVigentes,
  moverNotas,
  notasEnSeleccion,
  pasaDelFinal,
  pegarNotas,
  quitarNotas,
  tiempoDeSlotEntero,
  type Seleccion,
} from './mapeador-logica.js';

const tap = (time: number, column: Column): Note => ({ kind: 'tap', time, column });
const larga = (time: number, endTime: number, column: Column): Note => ({
  kind: 'hold',
  time,
  endTime,
  column,
});

/** Alguna columna tiene dos notas que se tocan (el invariante que el editor nunca debe romper). */
function haySolapes(notas: readonly Note[]): boolean {
  for (let c = 0; c < 4; c++) {
    const col = notas.filter((n) => n.column === c).sort((a, b) => a.time - b.time);
    for (let i = 1; i < col.length; i++) {
      const previa = col[i - 1]!;
      const fin = previa.kind === 'hold' ? previa.endTime : previa.time;
      if (fin >= col[i]!.time) return true;
    }
  }
  return false;
}

const todas: Seleccion['columnas'] = [0, 1, 2, 3];

describe('notasEnSeleccion', () => {
  const notas: Note[] = [tap(100, 0), tap(200, 1), tap(300, 2), tap(400, 3), larga(500, 900, 1)];

  it('una seleccion sin notas o sin columnas da vacio', () => {
    expect(notasEnSeleccion(notas, { desde: 1000, hasta: 2000, columnas: todas })).toEqual([]);
    expect(notasEnSeleccion(notas, { desde: 0, hasta: 5000, columnas: [] })).toEqual([]);
    expect(notasEnSeleccion([], { desde: 0, hasta: 5000, columnas: todas })).toEqual([]);
  });

  it('incluye los dos bordes y filtra por columna', () => {
    const r = notasEnSeleccion(notas, { desde: 200, hasta: 400, columnas: [1, 2, 3] });
    expect(r).toEqual([tap(200, 1), tap(300, 2), tap(400, 3)]);
    expect(notasEnSeleccion(notas, { desde: 0, hasta: 1000, columnas: [2] })).toEqual([tap(300, 2)]);
  });

  it('acepta desde y hasta en cualquier orden', () => {
    expect(notasEnSeleccion(notas, { desde: 300, hasta: 100, columnas: todas })).toHaveLength(3);
  });

  it('una larga que cruza el borde se elige entera', () => {
    expect(notasEnSeleccion(notas, { desde: 800, hasta: 2000, columnas: todas })).toEqual([
      larga(500, 900, 1),
    ]);
    expect(notasEnSeleccion(notas, { desde: 0, hasta: 550, columnas: [1] })).toEqual([
      tap(200, 1),
      larga(500, 900, 1),
    ]);
  });
});

describe('elegidasVigentes y quitarNotas', () => {
  it('comparan por valor, no por identidad', () => {
    const notas = [tap(100, 0), larga(300, 600, 2)];
    const copias = [tap(100, 0), larga(300, 600, 2), tap(999, 1)];
    expect(elegidasVigentes(notas, copias)).toEqual(notas);
    expect(quitarNotas(notas, [tap(100, 0)])).toEqual([larga(300, 600, 2)]);
  });

  it('un tap y una larga en el mismo instante y columna no se confunden', () => {
    expect(claveNota(tap(300, 2))).not.toBe(claveNota(larga(300, 600, 2)));
  });
});

describe('desplazarNotas', () => {
  it('mueve el inicio y el fin de una larga juntos', () => {
    expect(desplazarNotas([larga(100, 400, 1)], 50, 1)).toEqual([larga(150, 450, 2)]);
  });

  it('rechaza (null) salirse de las columnas 0 a 3 o del instante 0', () => {
    expect(desplazarNotas([tap(100, 3)], 0, 1)).toBeNull();
    expect(desplazarNotas([tap(100, 0), tap(100, 2)], 0, -1)).toBeNull();
    expect(desplazarNotas([tap(100, 1)], -101)).toBeNull();
    expect(desplazarNotas([tap(100, 1)], -100)).toEqual([tap(0, 1)]);
  });

  it('redondea el desplazamiento a ms entero', () => {
    expect(desplazarNotas([tap(100, 1)], 10.6)).toEqual([tap(111, 1)]);
  });
});

describe('moverNotas', () => {
  const base: Note[] = [tap(0, 0), tap(250, 1), tap(500, 2), larga(750, 1250, 3), tap(2000, 0)];
  const frase = base.slice(0, 4);

  it('mueve solo las elegidas, en el tiempo y en columnas', () => {
    const r = moverNotas(base, frase.slice(0, 2), 125, 1);
    expect(r).toEqual([tap(125, 1), tap(375, 2), tap(500, 2), larga(750, 1250, 3), tap(2000, 0)]);
  });

  it('mover una larga mueve su inicio y su fin', () => {
    const r = moverNotas(base, [larga(750, 1250, 3)], 250);
    expect(r).toContainEqual(larga(1000, 1500, 3));
    expect(r).not.toContainEqual(larga(750, 1250, 3));
  });

  it('no muta lo que recibe', () => {
    const copia = JSON.stringify(base);
    moverNotas(base, frase, 100, 0);
    expect(JSON.stringify(base)).toBe(copia);
  });

  it('una columna fuera de 0 a 3 rechaza todo el movimiento y deja el mapa igual', () => {
    const r = moverNotas(base, frase, 0, -1);
    expect(r).toEqual(base);
    expect(r).not.toBe(base);
    expect(moverNotas(base, frase, 0, 1)).toEqual(base); // la larga esta en la columna 3
  });

  it('un tiempo negativo rechaza el movimiento', () => {
    expect(moverNotas(base, frase, -1)).toEqual(base);
  });

  it('una seleccion vacia o que ya no existe no cambia nada', () => {
    expect(moverNotas(base, [], 500)).toEqual(base);
    expect(moverNotas(base, [tap(7, 0)], 500)).toEqual(base);
  });

  it('mover una frase sobre otras notas no deja solapes', () => {
    const mapa: Note[] = [tap(0, 1), tap(100, 1), tap(200, 1), tap(300, 1), larga(150, 450, 2), tap(520, 2)];
    const elegidas = mapa.slice(0, 4);
    for (const dt of [0, 50, 120, 149, 150, 321, 1000]) {
      for (const dc of [0, 1]) {
        expect(haySolapes(moverNotas(mapa, elegidas, dt, dc))).toBe(false);
      }
    }
  });

  it('lo que cae encima se reemplaza solo en el intervalo ocupado', () => {
    const mapa: Note[] = [tap(500, 1), larga(0, 1000, 2), tap(0, 0)];
    // El tap de la columna 0 pasa a la columna 2 en el instante 500: parte la larga en dos.
    expect(moverNotas(mapa, [tap(0, 0)], 500, 2)).toEqual([
      larga(0, 499, 2),
      tap(500, 1),
      tap(500, 2),
      larga(501, 1000, 2),
    ]);
    // Un tap fijo exactamente en el mismo lugar desaparece.
    expect(moverNotas([tap(0, 1), tap(500, 1)], [tap(0, 1)], 500)).toEqual([tap(500, 1)]);
  });

  it('un solo paso de historial: un deshacer vuelve al mapa de antes', () => {
    const h = crearHistorial<Note[]>(base);
    h.registrar(moverNotas(base, frase, 500, 0));
    expect(h.actual).not.toBe(base);
    expect(h.deshacer()).toBe(base);
    expect(h.puedeDeshacer).toBe(false);
  });
});

describe('copiarNotas', () => {
  it('guarda los tiempos relativos al origen', () => {
    const c = copiarNotas([tap(1000, 2), larga(1250, 1750, 0)]);
    expect(c.notas).toEqual([tap(0, 2), larga(250, 750, 0)]);
    expect(c.duracion).toBe(750);
  });

  it('con origen y duracion explicitos alinea al borde de la seleccion', () => {
    const c = copiarNotas([tap(1250, 2)], { origen: 1000, duracion: 2000 });
    expect(c.notas).toEqual([tap(250, 2)]);
    expect(c.duracion).toBe(2000);
  });

  it('copiar nada da un portapapeles vacio', () => {
    expect(copiarNotas([])).toEqual({ notas: [], duracion: 0 });
  });

  it('no muta las notas copiadas', () => {
    const originales = [tap(1000, 2)];
    copiarNotas(originales);
    expect(originales).toEqual([tap(1000, 2)]);
  });
});

describe('pegarNotas', () => {
  const pulso = 500; // 120 BPM

  // Un compas (4 pulsos = 2000 ms) que empieza en 4000 ms y tiene silencio al inicio.
  const compas: Note[] = [tap(4250, 1), tap(4500, 2), tap(5000, 0), larga(5500, 5750, 3), tap(5875, 1)];

  it('copiar un compas y pegarlo cuatro pulsos despues desplaza todo exactamente cuatro pulsos', () => {
    const copiado = copiarNotas(compas, { origen: 4000, duracion: 4 * pulso });
    const r = pegarNotas(compas, copiado, 4000 + 4 * pulso);
    const pegadas = r.filter((n) => n.time >= 6000);
    expect(pegadas.map((n) => [n.column, n.time])).toEqual(
      compas.map((n) => [n.column, n.time + 4 * pulso]),
    );
    expect(pegadas.find((n) => n.kind === 'hold')).toEqual(larga(7500, 7750, 3));
    // Lo de antes queda donde estaba.
    expect(r.filter((n) => n.time < 6000)).toEqual(compas);
    expect(haySolapes(r)).toBe(false);
  });

  it('pega ocho veces seguidas sin perder ni mover las anteriores', () => {
    let mapa = compas;
    const copiado = copiarNotas(compas, { origen: 4000, duracion: 2000 });
    for (let k = 1; k <= 8; k++) mapa = pegarNotas(mapa, copiado, 4000 + k * 2000);
    expect(mapa).toHaveLength(compas.length * 9);
    expect(mapa.filter((n) => n.kind === 'hold').map((n) => n.time)).toEqual(
      Array.from({ length: 9 }, (_, k) => 5500 + k * 2000),
    );
  });

  it('pegar encima reemplaza solo el intervalo ocupado de la misma columna', () => {
    const mapa: Note[] = [tap(1000, 1), larga(800, 1400, 2), tap(2000, 0), tap(1000, 3)];
    const r = pegarNotas(mapa, { notas: [tap(0, 1), tap(0, 2)] }, 1000);
    expect(r).toEqual([
      larga(800, 999, 2),
      tap(1000, 1),
      tap(1000, 2),
      tap(1000, 3),
      larga(1001, 1400, 2),
      tap(2000, 0),
    ]);
  });

  it('pegar antes del instante 0 no pega nada', () => {
    const mapa = [tap(100, 0)];
    const r = pegarNotas(mapa, { notas: [tap(-300, 1)] }, 100);
    expect(r).toEqual(mapa);
    expect(r).not.toBe(mapa);
  });

  it('un portapapeles vacio no cambia el mapa y el original no se muta', () => {
    const mapa = [tap(100, 0)];
    expect(pegarNotas(mapa, { notas: [] }, 500)).toEqual(mapa);
    pegarNotas(mapa, { notas: [tap(0, 1)] }, 500);
    expect(mapa).toEqual([tap(100, 0)]);
  });

  it('un solo paso de historial: un deshacer quita el pegado entero', () => {
    const h = crearHistorial<Note[]>(compas);
    h.registrar(pegarNotas(compas, copiarNotas(compas, { origen: 4000 }), 6000));
    expect(h.actual).toHaveLength(compas.length * 2);
    expect(h.deshacer()).toBe(compas);
  });

  it('pegar donde cae el cabezal ajustado a un slot de una grilla con decimales', () => {
    // 128 BPM, 1/4: el slot dura 117.1875 ms; el slot 9 cae en 1054.6875 -> 1055.
    const g: Grilla = { bpm: 128, offsetMs: 0, divisor: 4 };
    const enMs = tiempoDeSlotEntero(g, 9);
    expect(pegarNotas([], { notas: [tap(0, 0)] }, enMs)).toEqual([tap(1055, 0)]);
  });
});

describe('pasaDelFinal', () => {
  it('detecta una nota o el fin de una larga mas alla de la cancion', () => {
    expect(pasaDelFinal([tap(900, 0)], 1000)).toBe(false);
    expect(pasaDelFinal([tap(1000, 0)], 1000)).toBe(false);
    expect(pasaDelFinal([tap(900, 0), larga(900, 1001, 1)], 1000)).toBe(true);
    expect(pasaDelFinal([], 1000)).toBe(false);
  });
});

describe('cuantizarNotas', () => {
  const g: Grilla = { bpm: 120, offsetMs: 0, divisor: 2 }; // un slot cada 250 ms

  it('ajusta cada nota elegida al slot mas cercano y deja las demas', () => {
    const mapa: Note[] = [tap(130, 0), tap(380, 1), tap(990, 2), tap(130, 3)];
    const r = cuantizarNotas(mapa, [tap(130, 0), tap(380, 1), tap(990, 2)], g);
    expect(r).toEqual([tap(130, 3), tap(250, 0), tap(500, 1), tap(1000, 2)]);
  });

  it('ajusta el inicio y el fin de una larga por separado', () => {
    expect(cuantizadas([larga(240, 760, 1)], g)).toEqual([larga(250, 750, 1)]);
  });

  it('una larga que se queda sin largo pasa a ser un tap', () => {
    expect(cuantizadas([larga(240, 260, 1)], g)).toEqual([tap(250, 1)]);
  });

  it('dos notas que caen en el mismo slot y columna dejan una (la primera)', () => {
    const mapa: Note[] = [tap(240, 0), tap(260, 0)];
    expect(cuantizarNotas(mapa, mapa, g)).toEqual([tap(250, 0)]);
  });

  it('cuantizar sobre una nota fija la reemplaza sin duplicar ni dejar solapes', () => {
    const r = cuantizarNotas([tap(240, 0), tap(250, 0)], [tap(240, 0)], g);
    expect(r).toEqual([tap(250, 0)]);
    expect(haySolapes(r)).toBe(false);
  });

  it('es idempotente y no hace nada con una seleccion vacia', () => {
    const mapa: Note[] = [tap(130, 0), larga(240, 760, 1)];
    const una = cuantizarNotas(mapa, mapa, g);
    expect(cuantizarNotas(una, una, g)).toEqual(una);
    expect(cuantizarNotas(mapa, [], g)).toEqual(mapa);
  });
});
