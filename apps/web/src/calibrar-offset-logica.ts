// T-060: logica pura de "Calibrar offset" (la pantalla de ajustes que mide el
// offset global sin necesitar una cancion). Suena un metronomo a 120 BPM, la
// persona pulsa una tecla de columna al compas, y se compara cada pulsacion con
// el pulso mas cercano. Nada de DOM ni de reloj aca: calibrar-offset.ts le pasa
// tiempos ya medidos con el reloj de audio de su pantalla (CLAUDE.md, "El reloj
// es el audio").
//
// El error se define EXACTAMENTE como en la partida (HANDOFF, lecciones 2 y 4):
// en el juego `error = tiempoReal - nota - offset`, con `offset = userOffset +
// outputLatency` y positivo = tarde. Asi la media que se ve aca es la que se
// veria jugando con el offset actual, y el offset que deja esa media en 0 sale
// de `calcularOffsetCorregido`, la misma cuenta que "Corregir offset".

import type { Ms } from '@tetra/core';
import { formatearOffset } from './ajustes-barras-logica.js';
import { calcularOffsetCorregido } from './estadisticas.js';

/** Un pulso cada 500 ms: 120 BPM. */
export const INTERVALO_DE_PULSO_MS: Ms = 500;

/** Pulsos que suenan en total. */
export const PULSOS_TOTALES = 32;

/** Los primeros pulsos no cuentan: son para entrar en tiempo. */
export const PULSOS_DE_ENTRADA = 4;

/** Golpes que cuentan hacen falta para ofrecer el resultado. */
export const GOLPES_MINIMOS_PARA_USAR = 16;

/** Silencio antes del primer pulso, en ms (el tiempo de ponerse a la escucha). */
export const AIRE_ANTES_DEL_PRIMER_PULSO_MS: Ms = 1500;

/** Mitad del ancho de la barra de golpes, en ms. */
export const ESCALA_DE_BARRA_MS: Ms = 150;

/** Instante (ms desde el pulso 0) en que suena el pulso `indice`. */
export function instanteDelPulso(indice: number): Ms {
  return indice * INTERVALO_DE_PULSO_MS;
}

/**
 * Instante (ms desde el pulso 0) a partir del cual la calibracion ya no espera mas
 * golpes: el ultimo pulso mas medio intervalo (a esa altura una pulsacion tardia
 * ya cae mas cerca del pulso que no existe).
 */
export function instanteDeCierre(): Ms {
  return instanteDelPulso(PULSOS_TOTALES - 1) + INTERVALO_DE_PULSO_MS / 2;
}

/** Pulso mas cercano a un instante (ms desde el pulso 0). Puede salirse de [0, PULSOS_TOTALES). */
export function pulsoMasCercano(instante: Ms): number {
  return Math.round(instante / INTERVALO_DE_PULSO_MS);
}

/** Si el pulso suena para contar (no es de los de entrada) y existe. */
export function pulsoCuenta(indice: number): boolean {
  return indice >= PULSOS_DE_ENTRADA && indice < PULSOS_TOTALES;
}

/**
 * El error de una pulsacion como lo daria la partida: `instante` (ms desde el
 * pulso 0, de reloj de audio) menos el pulso, menos el offset que rige
 * (`offsetActual` del usuario mas la latencia de salida). Positivo es tarde.
 */
export function errorDeGolpe(
  instante: Ms,
  indiceDePulso: number,
  offsetActual: Ms,
  latenciaDeSalida: Ms,
): Ms {
  return instante - instanteDelPulso(indiceDePulso) - offsetActual - latenciaDeSalida;
}

/** Un golpe ya asignado a su pulso. */
export interface GolpeCalibrado {
  pulso: number;
  /** Error como en la partida (positivo tarde). */
  error: Ms;
  /** false en los pulsos de entrada: se dibuja pero no entra en la media. */
  cuenta: boolean;
}

/** La calibracion en curso: asigna cada pulsacion a un pulso y lleva la media de las que cuentan. */
export interface Calibracion {
  /**
   * Una pulsacion en `instante` (ms desde el pulso 0, de reloj de audio). Devuelve el
   * golpe, o `null` si no cae en un pulso (antes de empezar o despues del final) o si
   * ese pulso ya tenia su golpe (cada pulso admite uno: el primero).
   */
  agregar(instante: Ms): GolpeCalibrado | null;
  /** Golpes que cuentan hasta ahora. */
  cantidad(): number;
  /** Media de los errores que cuentan (0 sin golpes). Positivo: tarde. */
  media(): Ms;
}

export function crearCalibracion(offsetActual: Ms, latenciaDeSalida: Ms): Calibracion {
  const usados = new Set<number>();
  let suma = 0;
  let cuentan = 0;
  return {
    agregar(instante: Ms): GolpeCalibrado | null {
      if (!Number.isFinite(instante)) return null;
      const pulso = pulsoMasCercano(instante);
      if (pulso < 0 || pulso >= PULSOS_TOTALES || usados.has(pulso)) return null;
      usados.add(pulso);
      const error = errorDeGolpe(instante, pulso, offsetActual, latenciaDeSalida);
      const cuenta = pulsoCuenta(pulso);
      if (cuenta) {
        suma += error;
        cuentan++;
      }
      return { pulso, error, cuenta };
    },
    cantidad(): number {
      return cuentan;
    },
    media(): Ms {
      return cuentan === 0 ? 0 : suma / cuentan;
    },
  };
}

/** El offset global que deja la media en 0: `calcularOffsetCorregido`, redondeado a ms. */
export function offsetCalibrado(offsetActual: Ms, media: Ms): Ms {
  const nuevo = Math.round(calcularOffsetCorregido(offsetActual, media));
  // Sumar 0 convierte un -0 en 0.
  return nuevo + 0;
}

/** Posicion en la barra, de 0 (borde izquierdo, temprano) a 100 (borde derecho, tarde). */
export function posicionEnBarraDeCalibracion(error: Ms): number {
  if (!Number.isFinite(error)) return 50;
  const limitado = Math.min(ESCALA_DE_BARRA_MS, Math.max(-ESCALA_DE_BARRA_MS, error));
  return 50 + (50 * limitado) / ESCALA_DE_BARRA_MS;
}

/** Texto del boton de aplicar: `Usar +40 ms`. */
export function textoDeUsar(nuevoOffset: Ms): string {
  return `Usar ${formatearOffset(nuevoOffset)}`;
}

/**
 * La linea de estado mientras suena, segun el instante (ms desde el pulso 0):
 * antes del primero, durante la entrada y contando. Despues del cierre, null.
 */
export function textoDeProgreso(instante: Ms): string | null {
  if (instante >= instanteDeCierre()) return null;
  if (instante < -INTERVALO_DE_PULSO_MS / 2) return 'Escucha el click';
  const pulso = Math.min(PULSOS_TOTALES - 1, Math.max(0, pulsoMasCercano(instante)));
  const numero = pulso + 1;
  return pulso < PULSOS_DE_ENTRADA
    ? `Entrando en tiempo ${numero}/${PULSOS_TOTALES}`
    : `Pulso ${numero}/${PULSOS_TOTALES}`;
}
