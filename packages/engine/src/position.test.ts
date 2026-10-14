// Tests de T-004 (aritmetica pura de la pista).
//
// Cada asercion de aca abajo esta pensada contra una implementacion
// incorrecta concreta, no contra la formula copiada del ticket:
//
// - `progresoAY` se prueba en un punto intermedio (progreso 0.5), no solo en
//   los extremos 0 y 1: una implementacion que usara `height` en vez de
//   `receptorY` como "alto util" da el mismo resultado que la correcta en
//   los dos extremos (0 y 0 respectivamente), pero difiere en el medio. Sin
//   ese punto intermedio el test no distingue las dos implementaciones.
// - Los limites de `progresoEsVisible` se prueban con valores justo adentro
//   y justo afuera de [-0.1, 1.1], no solo con valores comodos como 0 o 2.
// - `avanzarVentanaEnSitio` se compara contra una implementacion de referencia que
//   si filtra el array completo cada vez (la que el ticket prohibe por
//   rendimiento, pero que es trivialmente correcta): si los punteros
//   monotonicos calculan mal el limite, el resultado diverge del filtro
//   completo.

import { describe, expect, it } from 'vitest';
import type { HoldNote, Note, TapNote } from '@tetra/core';
import {
  PROGRESO_MAX_VISIBLE,
  PROGRESO_MIN_VISIBLE,
  avanzarVentanaEnSitio,
  calcularPosicionNota,
  calcularProgreso,
  progresoAY,
  progresoEsVisible,
  receptorY,
  tramoVisible,
  ventanaVacia,
  type VentanaNotas,
} from './position.js';

// ---------------------------------------------------------------------------
// calcularProgreso
// ---------------------------------------------------------------------------

describe('calcularProgreso', () => {
  it('vale 0 cuando la nota cae justo en el tiempo actual', () => {
    expect(calcularProgreso(5000, 5000, 2000)).toBe(0);
  });

  it('vale 1 cuando falta exactamente un scrollDuration', () => {
    expect(calcularProgreso(7000, 5000, 2000)).toBe(1);
  });

  it('vale negativo para una nota que ya paso (con el signo correcto, no el valor absoluto)', () => {
    // Si la implementacion usara Math.abs() por error, esto daria 0.5 en
    // vez de -0.5.
    expect(calcularProgreso(4000, 5000, 2000)).toBe(-0.5);
  });
});

// ---------------------------------------------------------------------------
// progresoAY
// ---------------------------------------------------------------------------

describe('progresoAY', () => {
  const geometria = { height: 1000, receptorOffset: 100 };

  it('progreso 0 queda centrado en el receptor', () => {
    expect(progresoAY(0, geometria)).toBe(receptorY(geometria));
    expect(progresoAY(0, geometria)).toBe(900);
  });

  it('progreso 1 queda en el borde de arriba (y = 0)', () => {
    expect(progresoAY(1, geometria)).toBe(0);
  });

  it('progreso 0.5 esta a mitad de camino entre el receptor y el borde de arriba', () => {
    // Este es el punto que distingue "alto util = receptorY" (correcto, da
    // 450) de "alto util = height" (da 400): los dos coinciden en 0 y 1.
    expect(progresoAY(0.5, geometria)).toBe(450);
  });
});

// ---------------------------------------------------------------------------
// progresoEsVisible
// ---------------------------------------------------------------------------

describe('progresoEsVisible', () => {
  it('los limites -0.1 y 1.1 son visibles (rango cerrado)', () => {
    expect(progresoEsVisible(PROGRESO_MIN_VISIBLE)).toBe(true);
    expect(progresoEsVisible(PROGRESO_MAX_VISIBLE)).toBe(true);
  });

  it('justo por fuera de los limites no es visible', () => {
    expect(progresoEsVisible(-0.100001)).toBe(false);
    expect(progresoEsVisible(1.100001)).toBe(false);
  });

  it('0 y 1 (los casos centrales) son visibles', () => {
    expect(progresoEsVisible(0)).toBe(true);
    expect(progresoEsVisible(1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tramoVisible (T-060)
// ---------------------------------------------------------------------------

describe('tramoVisible', () => {
  it('una LN que cruza toda la pista con los dos extremos afuera es visible (el bug)', () => {
    // Cabeza ya debajo del receptor (-0.5) y cola todavia arriba de la pantalla
    // (3). Con la condicion vieja (cabeza o cola dentro del rango) daba false y
    // el cuerpo desaparecia mientras se mantenia.
    expect(progresoEsVisible(-0.5) || progresoEsVisible(3)).toBe(false);
    expect(tramoVisible(-0.5, 3)).toBe(true);
  });

  it('un tramo entero arriba del rango no es visible', () => {
    expect(tramoVisible(1.2, 2)).toBe(false);
  });

  it('un tramo entero debajo del rango no es visible', () => {
    expect(tramoVisible(-2, -0.2)).toBe(false);
  });

  it('un tramo con un extremo adentro es visible', () => {
    expect(tramoVisible(0.5, 5)).toBe(true);
    expect(tramoVisible(-5, 0.5)).toBe(true);
    expect(tramoVisible(0.2, 0.4)).toBe(true);
  });

  it('los bordes exactos cuentan como visibles y un pelo mas afuera no', () => {
    expect(tramoVisible(PROGRESO_MAX_VISIBLE, 5)).toBe(true);
    expect(tramoVisible(1.100001, 5)).toBe(false);
    expect(tramoVisible(-5, PROGRESO_MIN_VISIBLE)).toBe(true);
    expect(tramoVisible(-5, -0.100001)).toBe(false);
  });

  it('acepta los extremos en cualquier orden', () => {
    expect(tramoVisible(3, -0.5)).toBe(true);
    expect(tramoVisible(2, 1.2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calcularPosicionNota
// ---------------------------------------------------------------------------

describe('calcularPosicionNota', () => {
  it('combina progreso, y y visibilidad de forma consistente', () => {
    const geometria = { height: 800, receptorOffset: 80 };
    const posicion = calcularPosicionNota(3000, 3000, 1500, geometria);

    expect(posicion.progreso).toBe(0);
    expect(posicion.y).toBe(receptorY(geometria));
    expect(posicion.visible).toBe(true);
  });

  it('una nota muy lejos en el futuro no es visible', () => {
    const geometria = { height: 800, receptorOffset: 80 };
    const posicion = calcularPosicionNota(10_000, 0, 1000, geometria);

    expect(posicion.progreso).toBe(10);
    expect(posicion.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// avanzarVentanaEnSitio
// ---------------------------------------------------------------------------

function nota(time: number): TapNote {
  return { kind: 'tap', time, column: 0 };
}

function notaLarga(time: number, endTime: number): HoldNote {
  return { kind: 'hold', time, endTime, column: 0 };
}

/**
 * Referencia deliberadamente ineficiente: recorre el array completo cada
 * vez y devuelve el conjunto de indices que deberian ser visibles. Es la
 * implementacion que T-004 prohibe usar en produccion, pero sirve de
 * oraculo para verificar que los punteros monotonicos de `avanzarVentanaEnSitio`
 * visitan exactamente las mismas notas.
 *
 * Devuelve un conjunto de indices en vez de un `{ inicio, fin }` porque,
 * con la ventana vacia, mas de una representacion de "no hay nada" es
 * valida (por ejemplo `{0,0}` o `{10,10}` sobre un array de 10 elementos):
 * lo que importa para quien consume `avanzarVentanaEnSitio` es el rango de indices
 * que se recorre, no los numeros exactos cuando ese rango esta vacio.
 */
function indicesVisiblesPorFiltroCompleto(
  notas: readonly Note[],
  tiempoActual: number,
  scrollDuration: number,
): Set<number> {
  const limiteInferior = tiempoActual + PROGRESO_MIN_VISIBLE * scrollDuration;
  const limiteSuperior = tiempoActual + PROGRESO_MAX_VISIBLE * scrollDuration;

  const indices = new Set<number>();
  notas.forEach((n, indice) => {
    const finVisibilidad = 'endTime' in n ? n.endTime : n.time;
    const entra = finVisibilidad >= limiteInferior && n.time <= limiteSuperior;
    if (entra) {
      indices.add(indice);
    }
  });
  return indices;
}

function indicesVisiblesDeVentana(ventana: VentanaNotas): Set<number> {
  const indices = new Set<number>();
  for (let i = ventana.inicio; i < ventana.fin; i++) {
    indices.add(i);
  }
  return indices;
}

/** Los casos de abajo miran el resultado como valor: se avanza una copia en sitio y se la devuelve. */
function avanzar(
  notas: readonly Note[],
  anterior: VentanaNotas,
  tiempoActual: number,
  scrollDuration: number,
): VentanaNotas {
  const ventana = { inicio: anterior.inicio, fin: anterior.fin };
  avanzarVentanaEnSitio(notas, ventana, tiempoActual, scrollDuration);
  return ventana;
}

describe('avanzarVentanaEnSitio', () => {
  const notas: Note[] = Array.from({ length: 10 }, (_, i) => nota(i * 1000));
  const scrollDuration = 2000;

  it('en t = 0 incluye las notas dentro de [-0.1, 1.1] * scrollDuration', () => {
    const ventana = avanzar(notas, ventanaVacia(), 0, scrollDuration);
    // limiteSuperior = 0 + 1.1*2000 = 2200: entran 0, 1000, 2000. No 3000.
    expect(ventana).toEqual({ inicio: 0, fin: 3 });
  });

  it('visita exactamente las mismas notas que el filtro completo en una serie de pasos hacia adelante', () => {
    let ventana = ventanaVacia();
    for (const t of [0, 1500, 3200, 5000, 7400, 9500]) {
      ventana = avanzar(notas, ventana, t, scrollDuration);
      const esperado = indicesVisiblesPorFiltroCompleto(notas, t, scrollDuration);
      expect(indicesVisiblesDeVentana(ventana)).toEqual(esperado);
    }
  });

  it('los punteros nunca retroceden a medida que el tiempo avanza', () => {
    let ventana = ventanaVacia();
    let anterior = { inicio: 0, fin: 0 };
    for (const t of [0, 800, 1600, 2400, 4000, 6000, 8000, 10_000]) {
      ventana = avanzar(notas, ventana, t, scrollDuration);
      expect(ventana.inicio).toBeGreaterThanOrEqual(anterior.inicio);
      expect(ventana.fin).toBeGreaterThanOrEqual(anterior.fin);
      anterior = ventana;
    }
  });

  it('una nota larga sigue en la ventana mientras dura, aunque su cabeza ya haya pasado', () => {
    const notasConLn: Note[] = [notaLarga(0, 5000)];
    // t = 4000: la cabeza (time=0) quedo muy atras, pero endTime=5000
    // todavia esta dentro del limite inferior visible (4000 - 200 = 3800).
    const ventana = avanzar(notasConLn, ventanaVacia(), 4000, scrollDuration);
    expect(ventana).toEqual({ inicio: 0, fin: 1 });
  });

  it('una nota larga sale de la ventana recien cuando su cola tambien quedo atras', () => {
    const notasConLn: Note[] = [notaLarga(0, 5000)];
    // t = 6000: limite inferior = 6000 - 200 = 5800 > endTime (5000).
    const ventana = avanzar(notasConLn, { inicio: 0, fin: 1 }, 6000, scrollDuration);
    expect(ventana.inicio).toBe(1);
  });
});
