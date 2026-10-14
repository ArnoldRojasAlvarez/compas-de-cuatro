// T-066 (D7 y D8): la parte pura del audio virtual. Sin Blob, sin
// AudioContext, sin crypto: trabaja sobre Float32Array, asi se prueba en
// Vitest sin navegador y se puede portar tal cual.
//
// - `normalizarNombreDeMuestra`: el nombre con el que se busca una muestra.
// - `mezclarMuestra`: suma una muestra ya decodificada en la salida, una vez
//   por cada inicio, con su ganancia lineal.
// - `normalizarPico`: si la mezcla satura, la baja entera (nunca la sube).
// - `duracionDeAudioVirtual`: el largo en ms de la pista virtual de un chart.

import type { Chart, Ms } from '../types.js';

/**
 * Normaliza un nombre de archivo de muestra: sin comillas, `\` a `/`, sin
 * `./` inicial, recortado y en minusculas. Es el mismo criterio con el que
 * `buscarEnZip` (storage) compara nombres.
 */
export function normalizarNombreDeMuestra(nombre: string): string {
  return nombre
    .replace(/"/g, '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^(\.\/)+/, '')
    .toLowerCase();
}

/**
 * Indice de audio donde empieza un evento de `tiempo` ms: `round`, no `floor`
 * (un evento en 2,6 ms a 1000 Hz cae en el indice 3). Sin desfase propio.
 */
export function indiceDeMuestra(tiempo: Ms, sampleRate: number): number {
  return Math.round((tiempo * sampleRate) / 1000);
}

/**
 * Suma `muestra` en `salida` (muta `salida`), una vez por cada elemento de
 * `inicios` (en muestras de audio, indice de la salida donde cae la primera
 * muestra de `muestra`) multiplicada por la ganancia lineal de ese inicio.
 *
 * - Mono (un canal) va a todos los canales de la salida; con mas canales que
 *   la salida se usan los primeros; si la muestra tiene menos canales que la
 *   salida (pero mas de uno), los canales de sobra repiten el ultimo.
 * - Lo que pasa del final de la salida se corta.
 * - Un inicio negativo, no finito o sin ganancia correspondiente se ignora.
 *
 * `inicios` y `ganancias` van en paralelo (mismo largo).
 */
export function mezclarMuestra(
  salida: readonly Float32Array[],
  muestra: readonly Float32Array[],
  inicios: readonly number[],
  ganancias: readonly number[],
): void {
  if (salida.length === 0 || muestra.length === 0) return;
  const total = Math.min(inicios.length, ganancias.length);
  for (let canal = 0; canal < salida.length; canal++) {
    const destino = salida[canal]!;
    const origen = muestra[Math.min(canal, muestra.length - 1)]!;
    const largoDestino = destino.length;
    const largoOrigen = origen.length;
    for (let e = 0; e < total; e++) {
      const inicio = inicios[e]!;
      const ganancia = ganancias[e]!;
      if (!Number.isFinite(inicio) || inicio < 0 || !Number.isFinite(ganancia)) continue;
      if (ganancia === 0) continue;
      const base = Math.floor(inicio);
      if (base >= largoDestino) continue;
      const cuantas = Math.min(largoOrigen, largoDestino - base);
      for (let i = 0; i < cuantas; i++) {
        destino[base + i]! += origen[i]! * ganancia;
      }
    }
  }
}

/**
 * Si el pico absoluto de la mezcla pasa de 1, escala todo por `techo / pico`
 * (por defecto 0,98). Nunca amplifica. Devuelve el factor aplicado (1 si no
 * toco nada).
 */
export function normalizarPico(salida: readonly Float32Array[], techo = 0.98): number {
  let pico = 0;
  for (const canal of salida) {
    for (let i = 0; i < canal.length; i++) {
      const v = Math.abs(canal[i]!);
      if (v > pico) pico = v;
    }
  }
  if (!(pico > 1)) return 1;
  const factor = techo / pico;
  for (const canal of salida) {
    for (let i = 0; i < canal.length; i++) canal[i]! *= factor;
  }
  return factor;
}

/** Cola de silencio despues del ultimo evento (D8): cubre muestras largas. */
export const COLA_DE_EVENTOS_MS = 8000;
/** Margen despues de la ultima nota (D8). */
export const COLA_DE_NOTAS_MS = 2000;

/**
 * Largo en ms de la pista virtual (D8): el mayor entre el ultimo evento mas
 * 8 s y el final de la ultima nota mas 2 s. 0 si el chart no tiene receta.
 */
export function duracionDeAudioVirtual(chart: Chart): Ms {
  const eventos = chart.audioVirtual?.eventos;
  if (eventos === undefined) return 0;
  let ultimoEvento = -Infinity;
  for (const e of eventos) if (e.tiempo > ultimoEvento) ultimoEvento = e.tiempo;
  let finDeNotas = -Infinity;
  for (const n of chart.notes) {
    const fin = n.kind === 'hold' ? n.endTime : n.time;
    if (fin > finDeNotas) finDeNotas = fin;
  }
  const porEventos = ultimoEvento === -Infinity ? 0 : ultimoEvento + COLA_DE_EVENTOS_MS;
  const porNotas = finDeNotas === -Infinity ? 0 : finDeNotas + COLA_DE_NOTAS_MS;
  return Math.max(porEventos, porNotas);
}
