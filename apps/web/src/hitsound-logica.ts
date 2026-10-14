// T-027: lo que decide la partida sobre los hitsounds, sin tocar el navegador
// (se testea en node): el tipo elegido, y cuando suena un golpe.
//
// Mismo patron que velocidad.ts: localStorage inyectable.

import type { Chart, Judgement, Ms } from '@tetra/core';
import type { TipoHitsound } from '@tetra/audio';

const CLAVE_HITSOUND = 'tetra:hitsound';

export const HITSOUND_DEFAULT: TipoHitsound = 'normal';

/** Nombre visible de cada tipo, en el orden del selector de ajustes. */
export const NOMBRES_DE_HITSOUND: Readonly<Record<TipoHitsound, string>> = {
  normal: 'Normal',
  suave: 'Suave',
  seco: 'Seco',
};

export function esTipoHitsound(valor: unknown): valor is TipoHitsound {
  return typeof valor === 'string' && Object.hasOwn(NOMBRES_DE_HITSOUND, valor);
}

/** Tipo guardado; algo que no sea uno de los tres vuelve al default. */
export function leerTipoHitsound(storage: Storage = localStorage): TipoHitsound {
  const crudo = storage.getItem(CLAVE_HITSOUND);
  return esTipoHitsound(crudo) ? crudo : HITSOUND_DEFAULT;
}

export function guardarTipoHitsound(tipo: TipoHitsound, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_HITSOUND, tipo);
}

/**
 * Convierte el tiempo de juego de un golpe (el `time` del evento de entrada,
 * ya pasado por `toGameTime`) a tiempo del AudioContext, para programar el
 * hitsound en el instante en que se pulso la tecla y no cuando corre el frame.
 *
 * `ctxAhora` (`ctx.currentTime`, segundos) y `relojAhora` (`clock.now()`, ms)
 * se leen juntos en el mismo momento. El offset del reloj aparece en ambos
 * `Ms` de juego y se cancela en la resta: solo queda cuanto hace que ocurrio
 * el golpe. Si el golpe ya paso, el resultado queda por detras de `ctxAhora`
 * y `start` lo hace sonar en el acto.
 */
export function instanteDeContextoDelGolpe(
  ctxAhora: number,
  relojAhora: Ms,
  tiempoDelGolpe: Ms,
): number {
  return ctxAhora - (relojAhora - tiempoDelGolpe) / 1000;
}

/** Cada golpe valido suena; el miss y la pulsacion sin nota a tiro (null) no. */
export function suenaElGolpe(juicio: Judgement | undefined): boolean {
  return juicio !== undefined && juicio !== 'miss';
}

/**
 * T-066 (D11): el hitsound sintetizado suena en un golpe valido, salvo en una
 * dificultad con `audioVirtual`: ahi la nota ya suena en la mezcla
 * pre-renderizada (como en osu!, un mapa con keysounds no suma el hitsound por
 * defecto).
 */
export function suenaElHitsound(chart: Pick<Chart, 'audioVirtual'>, juicio: Judgement | undefined): boolean {
  return chart.audioVirtual === undefined && suenaElGolpe(juicio);
}
