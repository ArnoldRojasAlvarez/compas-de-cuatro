// T-056: logica pura de los contadores de la partida (barra de error de
// timing, reintento mantenido, salto de intro, UR y pulsaciones por tecla).
// Nada de DOM ni de reloj aca: todo recibe numeros. Quien la usa (game.ts,
// contadores.ts, atajos.ts, results.ts) es quien lee `clock.now()` y toca el
// DOM; los tiempos que entran son siempre de reloj de juego, nunca de
// performance.now() ni de timers (CLAUDE.md, "El reloj es el audio").

import type { HitWindows, Ms } from '@tetra/core';
import { desviacionEstandar } from './estadisticas.js';

// ---------------------------------------------------------------------------
// Barra de error de timing
// ---------------------------------------------------------------------------

/** Cuanto vive una marca de la barra de error, en ms de reloj de juego. */
export const DURACION_MARCA_MS = 2000;

/** Marcas que existen a la vez (pool fijo): 20 golpes por segundo durante 2 s. */
export const MARCAS_EN_BARRA = 40;

/** Pasos de la opacidad de una marca: no se reescribe el estilo si no cambia el paso. */
export const PASOS_DE_ALPHA = 16;

/** Cuantos golpes entran en la media movil (la flechita de la barra). */
export const GOLPES_EN_MEDIA_MOVIL = 20;

/**
 * Posicion de una marca en la barra, de -1 (borde izquierdo, temprano) a 1
 * (borde derecho, tarde); 0 es el centro. `ventanaMax` es el semiancho de la
 * barra en ms (la ventana mas ancha que aun da un golpe). Un error mas
 * grande que la ventana se recorta al borde; una ventana no valida da 0.
 */
export function posicionEnBarra(error: Ms, ventanaMax: Ms): number {
  if (!(ventanaMax > 0) || !Number.isFinite(error)) return 0;
  return Math.min(1, Math.max(-1, error / ventanaMax));
}

/**
 * Opacidad de una marca segun su edad (ms de reloj de juego desde el golpe):
 * 1 al nacer, baja linealmente a 0 en `DURACION_MARCA_MS`. Una edad negativa
 * (el golpe "en el futuro", por un offset que mueve el reloj hacia atras)
 * cuenta como recien nacida; una edad no valida, como ya apagada.
 */
export function alphaDeMarca(edadMs: Ms): number {
  if (Number.isNaN(edadMs)) return 0;
  if (edadMs <= 0) return 1;
  if (edadMs >= DURACION_MARCA_MS) return 0;
  return 1 - edadMs / DURACION_MARCA_MS;
}

/** Opacidad cuantizada a `PASOS_DE_ALPHA` (entero 0 a `PASOS_DE_ALPHA`). */
export function pasoDeAlphaDeMarca(edadMs: Ms): number {
  return Math.round(alphaDeMarca(edadMs) * PASOS_DE_ALPHA);
}

/**
 * Los limites de las franjas de la barra, como fraccion del semiancho (la
 * ventana `bad` es el borde): `[max, perfect, great, good, bad]` divididos por
 * `bad`, de adentro hacia afuera. Con una ventana `bad` no valida no hay franjas.
 */
export function fraccionesDeVentanas(ventanas: HitWindows): readonly number[] {
  const borde = ventanas.bad;
  if (!(borde > 0)) return [0, 0, 0, 0, 1];
  return [
    ventanas.max / borde,
    ventanas.perfect / borde,
    ventanas.great / borde,
    ventanas.good / borde,
    1,
  ];
}

/** Un tramo de la barra: de `desde` a `hasta` (porcentaje del ancho, 0 a 100) con la franja `nivel`. */
export interface TramoDeBarra {
  readonly nivel: number;
  readonly desde: number;
  readonly hasta: number;
}

/**
 * Los nueve tramos de la barra, de izquierda a derecha y simetricos: bad, good,
 * great, perfect, max (el del centro), perfect, great, good, bad. `nivel` es el
 * indice de `fraccionesDeVentanas` (0 max, 1 perfect, 2 great, 3 good, 4 bad).
 * Cada ventana ocupa su fraccion del semiancho, medida desde el centro (50 %).
 */
export function tramosDeBarra(ventanas: HitWindows): readonly TramoDeBarra[] {
  const fracciones = fraccionesDeVentanas(ventanas);
  const tramos: TramoDeBarra[] = [];
  // De afuera hacia el centro por la izquierda; el max ocupa el centro entero.
  for (let nivel = fracciones.length - 1; nivel >= 1; nivel--) {
    tramos.push({
      nivel,
      desde: 50 * (1 - fracciones[nivel]!),
      hasta: 50 * (1 - fracciones[nivel - 1]!),
    });
  }
  tramos.push({
    nivel: 0,
    desde: 50 * (1 - fracciones[0]!),
    hasta: 50 * (1 + fracciones[0]!),
  });
  // Y el espejo por la derecha, del centro hacia afuera.
  for (let nivel = 1; nivel < fracciones.length; nivel++) {
    tramos.push({
      nivel,
      desde: 50 * (1 + fracciones[nivel - 1]!),
      hasta: 50 * (1 + fracciones[nivel]!),
    });
  }
  return tramos;
}

/** Media movil de los ultimos N valores sobre un anillo fijo (sin allocar por golpe). */
export interface MediaMovil {
  agregar(valor: number): void;
  /** Media de los valores que hay (0 sin valores). */
  valor(): number;
  /** Cuantos valores hay (hasta el tamano del anillo). */
  cantidad(): number;
  reiniciar(): void;
}

export function crearMediaMovil(tamano: number = GOLPES_EN_MEDIA_MOVIL): MediaMovil {
  const anillo = new Float64Array(Math.max(1, Math.floor(tamano)));
  let siguiente = 0;
  let cantidad = 0;
  let media = 0;
  return {
    agregar(valor: number): void {
      if (!Number.isFinite(valor)) return;
      anillo[siguiente] = valor;
      siguiente = (siguiente + 1) % anillo.length;
      if (cantidad < anillo.length) cantidad++;
      // Se suma de nuevo en vez de mantener un acumulado: sin deriva de coma flotante.
      let suma = 0;
      for (let i = 0; i < cantidad; i++) suma += anillo[i]!;
      media = suma / cantidad;
    },
    valor(): number {
      return media;
    },
    cantidad(): number {
      return cantidad;
    },
    reiniciar(): void {
      siguiente = 0;
      cantidad = 0;
      media = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// UR y pulsaciones por tecla
// ---------------------------------------------------------------------------

/**
 * Unstable rate: 10 x la desviacion estandar de los errores, en ms. Los
 * errores que entran son los de los golpes juzgados (sin miss: ver
 * `erroresJuzgados`). Con menos de dos golpes no hay dispersion: 0.
 */
export function unstableRate(errores: readonly Ms[]): number {
  return 10 * desviacionEstandar(errores);
}

/** UR como entero para mostrar ("124"). */
export function formatearUR(ur: number): string {
  return String(Number.isFinite(ur) ? Math.round(ur) : 0);
}

/**
 * Pulsaciones por tecla en una linea: "D 412 · F 398 · J 401 · K 405".
 * Una columna sin etiqueta se muestra por su numero (1 a 4).
 */
export function formatearPulsaciones(
  etiquetas: readonly string[],
  pulsaciones: readonly number[],
): string {
  return pulsaciones
    .map((cuenta, i) => `${etiquetas[i] ?? String(i + 1)} ${cuenta}`)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Reintento mantenido
// ---------------------------------------------------------------------------

/** Cuanto hay que mantener la tecla de reintento, en ms. */
export const REINTENTO_MS = 500;

/**
 * Cuanto del aro se llena (0 a 1) segun cuanto se lleva mantenida la tecla
 * (ms de reloj de juego desde el keydown). Un valor no valido o negativo da 0.
 */
export function progresoDeReintento(msMantenidos: Ms): number {
  if (!(msMantenidos > 0)) return 0;
  return Math.min(1, msMantenidos / REINTENTO_MS);
}

/** true cuando la tecla se mantuvo lo suficiente para reintentar (exactamente `REINTENTO_MS` ya cuenta). */
export function reintentoCompleto(msMantenidos: Ms): boolean {
  return msMantenidos >= REINTENTO_MS;
}

// ---------------------------------------------------------------------------
// Saltar intro
// ---------------------------------------------------------------------------

/** La intro se puede saltar si la primera nota esta a mas de esto, en ms. */
export const INTRO_SALTABLE_MS = 5000;

/** Cuanto antes de la primera nota cae el salto, en ms. */
export const ANTICIPACION_DEL_SALTO_MS = 2000;

/** Posicion (ms de la cancion) a la que salta Espacio: 2 s antes de la primera nota. */
export function destinoDelSalto(primeraNotaMs: Ms): Ms {
  return Math.max(0, primeraNotaMs - ANTICIPACION_DEL_SALTO_MS);
}

/**
 * Si el salto esta disponible en el instante `t` del reloj de juego: la
 * primera nota esta a mas de `INTRO_SALTABLE_MS` (exactamente 5 s no cuenta) y
 * el reloj todavia no llego al destino. Sin notas (`undefined`) no hay salto.
 */
export function saltoDisponible(t: Ms, primeraNotaMs: Ms | undefined): boolean {
  if (primeraNotaMs === undefined || !(primeraNotaMs > INTRO_SALTABLE_MS)) return false;
  return t < destinoDelSalto(primeraNotaMs);
}
