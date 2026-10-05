// T-053: logica pura de la escena de la partida (pista a pantalla completa,
// video de fondo e intro de la cancion). Nada de DOM ni de reloj aca: todo
// recibe numeros. Quien la usa (game.ts, escena.ts) es quien lee
// `clock.now()` y toca el DOM.

import type { Ms } from '@tetra/core';

/**
 * Lo que sabe la partida de la cancion que se esta jugando, para pintar el
 * fondo, el video y la intro (y despues los resultados). Todo opcional: una
 * partida sin escena (el mapeador, el click track) se ve como siempre.
 */
export interface EscenaPartida {
  fondo?: Blob;
  video?: Blob;
  /** ms, de CancionGuardada.videoOffset. Positivo: el video arranca despues que la cancion. */
  videoOffset?: Ms;
  titulo?: string;
  artista?: string;
  dificultad?: string;
}

// ---------------------------------------------------------------------------
// Pista a pantalla completa en alto
// ---------------------------------------------------------------------------

/** Ancho de un carril como fraccion del alto de la ventana. */
export const FACTOR_ANCHO_CARRIL = 0.11;
export const ANCHO_CARRIL_MIN = 72;
export const ANCHO_CARRIL_MAX = 130;

/** Distancia del receptor al borde inferior, como fraccion del alto de la pista. */
export const FACTOR_RECEPTOR = 0.15;
export const RECEPTOR_OFFSET_MIN = 90;

/**
 * Ancho de carril (px enteros) para una pista del alto de la ventana: escala
 * con el alto (alto x 0.11) entre 72 y 130 px. Un alto no valido da el minimo.
 */
export function anchoDeCarril(altoVentana: number): number {
  if (!Number.isFinite(altoVentana)) return ANCHO_CARRIL_MIN;
  const crudo = altoVentana * FACTOR_ANCHO_CARRIL;
  return Math.round(Math.min(ANCHO_CARRIL_MAX, Math.max(ANCHO_CARRIL_MIN, crudo)));
}

/** Medidas de la pista para una ventana de ese alto: el alto de la pista ES el de la ventana. */
export interface MedidasDePista {
  alto: number;
  anchoCarril: number;
  receptorOffset: number;
}

export function medidasDePista(altoVentana: number): MedidasDePista {
  const alto = Number.isFinite(altoVentana) ? Math.max(1, Math.round(altoVentana)) : 1;
  return {
    alto,
    anchoCarril: anchoDeCarril(alto),
    receptorOffset: Math.max(RECEPTOR_OFFSET_MIN, Math.round(alto * FACTOR_RECEPTOR)),
  };
}

// ---------------------------------------------------------------------------
// Video de fondo sincronizado contra el reloj de audio
// ---------------------------------------------------------------------------

/** Diferencia (s) entre el video y el reloj a partir de la cual se lo vuelve a poner en hora. */
export const UMBRAL_RESINCRONIZACION_S = 0.15;

/**
 * Segundo del video que corresponde al instante `t` del reloj de juego:
 * `(t - videoOffset) / 1000`. Negativo mientras el video todavia no empieza.
 */
export function objetivoDeVideo(tMs: Ms, videoOffsetMs: Ms = 0): number {
  return (tMs - videoOffsetMs) / 1000;
}

/**
 * Si hay que saltar el video al objetivo: cuando la diferencia SUPERA el
 * umbral (exactamente en el umbral todavia no). Saltar en cada frame
 * entrecortaria el video; el umbral deja que corra solo mientras va en hora.
 * Un tiempo de video no valido siempre se corrige; un objetivo no valido, nunca.
 */
export function debeResincronizar(
  tiempoVideo: number,
  objetivo: number,
  umbral: number = UMBRAL_RESINCRONIZACION_S,
): boolean {
  if (!Number.isFinite(objetivo)) return false;
  if (!Number.isFinite(tiempoVideo)) return true;
  return Math.abs(tiempoVideo - objetivo) > umbral;
}

/** Que hacer con el video en este frame. */
export type PlanDeVideo =
  /** Todavia no le toca: quieto en el primer cuadro. */
  | { readonly modo: 'esperar' }
  /** Ya termino (el reloj paso del final del video): quieto. */
  | { readonly modo: 'terminado' }
  /** Corre; `saltarA` (s) si se desvio mas del umbral, `null` si va en hora. */
  | { readonly modo: 'reproducir'; readonly saltarA: number | null };

/**
 * Decision pura de la sincronia, a partir del reloj de audio. `objetivo` sale
 * de `objetivoDeVideo`, `tiempoVideo` es el `currentTime` actual del video (solo
 * para decidir si hay que corregirlo: nunca se usa para nada del juego) y
 * `duracion` el largo del video si ya se conoce.
 */
export function planDeVideo(
  objetivo: number,
  tiempoVideo: number,
  duracion: number = Number.POSITIVE_INFINITY,
): PlanDeVideo {
  if (!Number.isFinite(objetivo) || objetivo < 0) return { modo: 'esperar' };
  if (Number.isFinite(duracion) && duracion > 0 && objetivo >= duracion) {
    return { modo: 'terminado' };
  }
  return { modo: 'reproducir', saltarA: debeResincronizar(tiempoVideo, objetivo) ? objetivo : null };
}

// ---------------------------------------------------------------------------
// Intro de la cancion
// ---------------------------------------------------------------------------

/** Hasta que t de juego (ms) la intro se ve entera. */
export const INTRO_VISIBLE_HASTA_MS: Ms = 2400;
/** Cuanto tarda en desvanecerse despues (ms): desaparece del todo a los ~3 s. */
export const INTRO_DESVANECE_MS: Ms = 600;

/**
 * Opacidad (0 a 1) del titulo de la intro en el instante `tMs` del reloj de
 * juego. Entera hasta `INTRO_VISIBLE_HASTA_MS`, despues baja linealmente a 0.
 * El lead-in (t negativo) la deja entera. Se mide con el reloj, no con timers:
 * si el juego se pausa, la intro se queda donde estaba.
 */
export function opacidadIntro(tMs: Ms): number {
  if (!Number.isFinite(tMs)) return 1;
  const pasado = tMs - INTRO_VISIBLE_HASTA_MS;
  if (pasado <= 0) return 1;
  if (pasado >= INTRO_DESVANECE_MS) return 0;
  return 1 - pasado / INTRO_DESVANECE_MS;
}

/** Texto de la segunda linea de la intro: "Artista · Dificultad" con lo que haya. */
export function lineaDeAutoria(escena: EscenaPartida): string {
  const partes = [escena.artista, escena.dificultad]
    .map((parte) => parte?.trim() ?? '')
    .filter((parte) => parte !== '');
  return partes.join(' · ');
}
