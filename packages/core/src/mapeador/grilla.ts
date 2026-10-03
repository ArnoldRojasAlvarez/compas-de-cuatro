// Grilla de pulsos: conversion entre tiempo en ms y "slots" (subdivisiones
// del pulso). La comparten el mapeo automatico y el editor manual, para que
// las notas de los dos caigan en exactamente los mismos instantes.

import type { Ms } from '../types.js';

export interface Grilla {
  bpm: number;
  /** Tiempo del primer pulso (el pulso 0 de la grilla). */
  offsetMs: Ms;
  /** Subdivisiones por pulso: 1 = negras, 2 = corcheas, 4 = semicorcheas, 3 y 6 = tresillos. */
  divisor: number;
}

/** Divisores que ofrece el editor (1/1, 1/2, 1/3, 1/4, 1/6, 1/8, 1/12, 1/16). */
export const DIVISORES: readonly number[] = [1, 2, 3, 4, 6, 8, 12, 16];

/** Duracion de un pulso en ms. */
export function duracionPulso(bpm: number): Ms {
  return 60000 / bpm;
}

/** Duracion de un slot en ms. */
export function duracionSlot(grilla: Grilla): Ms {
  return duracionPulso(grilla.bpm) / grilla.divisor;
}

/** Tiempo exacto del slot `slot` (puede ser negativo: antes del offset). */
export function tiempoDeSlot(grilla: Grilla, slot: number): Ms {
  return grilla.offsetMs + slot * duracionSlot(grilla);
}

/** Slot entero mas cercano a `time`. */
export function slotMasCercano(grilla: Grilla, time: Ms): number {
  return Math.round((time - grilla.offsetMs) / duracionSlot(grilla));
}

/** `time` ajustado al slot mas cercano. */
export function ajustarAGrilla(grilla: Grilla, time: Ms): Ms {
  return tiempoDeSlot(grilla, slotMasCercano(grilla, time));
}

/**
 * Lineas de la grilla visibles entre `desde` y `hasta` (ms). `tipo` es 0 para
 * un slot sin acento, 1 para un pulso y 2 para el primer pulso de un compas.
 */
export function lineasDeGrilla(
  grilla: Grilla,
  desde: Ms,
  hasta: Ms,
  pulsosPorCompas = 4,
): { time: Ms; tipo: 0 | 1 | 2 }[] {
  const paso = duracionSlot(grilla);
  const primero = Math.ceil((desde - grilla.offsetMs) / paso);
  const ultimo = Math.floor((hasta - grilla.offsetMs) / paso);
  const salida: { time: Ms; tipo: 0 | 1 | 2 }[] = [];
  for (let slot = primero; slot <= ultimo; slot++) {
    const pulso = slot / grilla.divisor;
    let tipo: 0 | 1 | 2 = 0;
    if (Number.isInteger(pulso)) {
      tipo = pulso % pulsosPorCompas === 0 ? 2 : 1;
    }
    salida.push({ time: grilla.offsetMs + slot * paso, tipo });
  }
  return salida;
}
