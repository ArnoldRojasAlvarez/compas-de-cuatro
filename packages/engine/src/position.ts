// T-004: aritmetica pura de la pista.
//
// Todo lo que este archivo exporta es funcion pura sobre numeros y arrays:
// nada de Pixi, nada de DOM. Es a proposito (ver docs/tickets/T-004, seccion
// "Tests"): asi se puede probar el calculo de posicion y el avance de la
// ventana visible sin levantar un renderer.

import type { Ms, Note } from '@tetra/core';
import { isHold } from '@tetra/core';

/** Progreso fuera de este rango no se dibuja (ver T-004, "Posicion de las notas"). */
export const PROGRESO_MIN_VISIBLE = -0.1;
export const PROGRESO_MAX_VISIBLE = 1.1;

/**
 * Progreso de una nota en la pista: 0 esta sobre el receptor, 1 esta
 * entrando por el borde de arriba.
 */
export function calcularProgreso(noteTime: Ms, tiempoActual: Ms, scrollDuration: Ms): number {
  return (noteTime - tiempoActual) / scrollDuration;
}

/** true si el progreso cae dentro del rango que se dibuja. */
export function progresoEsVisible(progreso: number): boolean {
  return progreso >= PROGRESO_MIN_VISIBLE && progreso <= PROGRESO_MAX_VISIBLE;
}

/**
 * T-060: true si el tramo `[progresoInicio, progresoFin]` toca el rango que se
 * dibuja. Sirve para el cuerpo de una LN: pregunta por el intervalo entero y no
 * por sus extremos, porque una LN mas larga que la pista con la cabeza ya
 * debajo del receptor y la cola todavia arriba de la pantalla tiene los dos
 * extremos afuera y aun asi su cuerpo cruza toda la pista. Acepta los extremos
 * en cualquier orden.
 */
export function tramoVisible(progresoInicio: number, progresoFin: number): boolean {
  const menor = Math.min(progresoInicio, progresoFin);
  const mayor = Math.max(progresoInicio, progresoFin);
  return menor <= PROGRESO_MAX_VISIBLE && mayor >= PROGRESO_MIN_VISIBLE;
}

export interface GeometriaPista {
  /** Alto del area de juego en pixeles. */
  height: number;
  /** Distancia del receptor al borde inferior, en pixeles. */
  receptorOffset: number;
}

/** Posicion Y del receptor: el punto donde progreso vale 0. */
export function receptorY(geometria: GeometriaPista): number {
  return geometria.height - geometria.receptorOffset;
}

/**
 * Convierte progreso a coordenada Y de pantalla.
 *
 * `y = receptorY - progreso * (alto util)`, con "alto util" igual a
 * `receptorY`: es la distancia entre el borde de arriba (donde progreso vale
 * 1) y el receptor (donde progreso vale 0). Con progreso 0 la nota queda
 * centrada en el receptor; con progreso 1 esta en y = 0, entrando por arriba.
 */
export function progresoAY(progreso: number, geometria: GeometriaPista): number {
  const yReceptor = receptorY(geometria);
  return yReceptor - progreso * yReceptor;
}

export interface PosicionNota {
  progreso: number;
  y: number;
  visible: boolean;
}

/** Combina progreso + posicion Y + visibilidad en un solo calculo. */
export function calcularPosicionNota(
  noteTime: Ms,
  tiempoActual: Ms,
  scrollDuration: Ms,
  geometria: GeometriaPista,
): PosicionNota {
  const progreso = calcularProgreso(noteTime, tiempoActual, scrollDuration);
  return {
    progreso,
    y: progresoAY(progreso, geometria),
    visible: progresoEsVisible(progreso),
  };
}

// ---------------------------------------------------------------------------
// Ventana visible (culling)
// ---------------------------------------------------------------------------

/**
 * Ventana de indices `[inicio, fin)` dentro de un array de notas ordenado
 * por tiempo ascendente. Solo las notas en ese rango se recorren para
 * dibujar: nada de filtrar el array completo cada frame (ver T-004,
 * "Rendimiento").
 */
export interface VentanaNotas {
  inicio: number;
  fin: number;
}

export function ventanaVacia(): VentanaNotas {
  return { inicio: 0, fin: 0 };
}

/**
 * Recalcula la ventana visible, en sitio (escribe `ventana.inicio` y
 * `ventana.fin`, no devuelve nada), avanzando los
 * punteros de forma monotonica: nunca retroceden. Asume reproduccion hacia
 * adelante (tiempoActual no decrece entre llamadas), que es el caso del
 * bucle de juego normal.
 *
 * `inicio` avanza mientras la nota en ese indice ya termino de estar
 * visible (para una LN, cuando `endTime` quedo atras del limite inferior de
 * la ventana; para una nota simple, cuando `time` lo hizo).
 *
 * `fin` avanza mientras la siguiente nota todavia entra en la ventana
 * (su `time` no supera el limite superior).
 */
export function avanzarVentanaEnSitio(
  notas: readonly Note[],
  ventana: VentanaNotas,
  tiempoActual: Ms,
  scrollDuration: Ms,
): void {
  const limiteInferior = tiempoActual + PROGRESO_MIN_VISIBLE * scrollDuration;
  const limiteSuperior = tiempoActual + PROGRESO_MAX_VISIBLE * scrollDuration;

  let inicio = ventana.inicio;
  while (inicio < notas.length) {
    const nota = notas[inicio]!;
    const finVisibilidad = isHold(nota) ? nota.endTime : nota.time;
    if (finVisibilidad >= limiteInferior) {
      break;
    }
    inicio++;
  }

  let fin = Math.max(ventana.fin, inicio);
  while (fin < notas.length && notas[fin]!.time <= limiteSuperior) {
    fin++;
  }

  // T-039: se escribe en el objeto que llega (uno por columna, creado una vez al
  // armar la pista): ni este ni render() crean objetos por frame.
  ventana.inicio = inicio;
  ventana.fin = fin;
}

/**
 * T-039: la mayor cantidad de notas de una columna que pueden estar visibles a
 * la vez con ese `scrollDuration` (las que caen dentro de
 * [-0.1, 1.1] * scrollDuration de un mismo instante). Sirve para dimensionar
 * el pool de sprites al armar la pista, segun la densidad real del mapa, para
 * que render() nunca tenga que crear uno.
 *
 * `notas` son las de una sola columna, por tiempo ascendente y sin que dos
 * se pisen (una nota larga termina antes de que empiece la siguiente de su
 * columna): por eso los finales tambien van en orden y alcanza con dos
 * punteros, igual que en `avanzarVentanaEnSitio`.
 */
export function maximoVisibleEnColumna(notas: readonly Note[], scrollDuration: Ms): number {
  const ancho = (PROGRESO_MAX_VISIBLE - PROGRESO_MIN_VISIBLE) * scrollDuration;
  let maximo = 0;
  let inicio = 0;
  for (let i = 0; i < notas.length; i++) {
    // Ventana que termina justo en la nota `i` (la mas tardia que contiene): [time_i - ancho, time_i].
    const limiteInferior = notas[i]!.time - ancho;
    while (inicio < i) {
      const nota = notas[inicio]!;
      const finVisibilidad = isHold(nota) ? nota.endTime : nota.time;
      if (finVisibilidad >= limiteInferior) break;
      inicio++;
    }
    const cantidad = i - inicio + 1;
    if (cantidad > maximo) maximo = cantidad;
  }
  return maximo;
}
