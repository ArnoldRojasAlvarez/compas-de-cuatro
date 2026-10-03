// Tiempo jugado acumulado, para el header persistente (ver header.ts).
// Mismo patron que offset.ts y velocidad.ts: localStorage inyectable con
// default a `localStorage`, para poder testear sin navegador real.
//
// Lo que se suma es el tiempo de CANCION que corrio de verdad (leido de
// `clock.now()` al cerrar la partida, ver game.ts), no tiempo de pared: no
// cuenta el lead-in, ni el song select, ni el menu. Una partida abortada
// con Escape suma lo que alcanzo a jugar.

import type { Ms } from '@tetra/core';

const CLAVE_TIEMPO_JUGADO = 'tetra:tiempo-jugado-ms';

/** Lee el total acumulado en ms. 0 si no hay nada o el valor guardado no sirve. */
export function leerTiempoJugado(storage: Storage = localStorage): Ms {
  const crudo = storage.getItem(CLAVE_TIEMPO_JUGADO);
  if (crudo === null) return 0;
  const valor = Number(crudo);
  return Number.isFinite(valor) && valor > 0 ? valor : 0;
}

/**
 * Suma `ms` al total guardado y devuelve el total nuevo. Un `ms` negativo, NaN
 * o infinito se ignora (el lead-in da tiempos negativos de reloj: quien llama
 * no tiene que acordarse de recortar).
 */
export function sumarTiempoJugado(ms: Ms, storage: Storage = localStorage): Ms {
  const actual = leerTiempoJugado(storage);
  if (!Number.isFinite(ms) || ms <= 0) return actual;
  const nuevo = actual + ms;
  storage.setItem(CLAVE_TIEMPO_JUGADO, String(Math.round(nuevo)));
  return Math.round(nuevo);
}

/**
 * Formato corto para el header: "0 min", "42 min", "1 h 05 min", "12 h 30 min".
 * Se redondea hacia abajo al minuto: mostrar "1 min" tras 5 segundos de juego
 * seria mentira.
 */
export function formatearTiempoJugado(ms: Ms): string {
  const minutosTotales = Math.floor(Math.max(0, ms) / 60_000);
  const horas = Math.floor(minutosTotales / 60);
  const minutos = minutosTotales % 60;
  if (horas === 0) return `${minutos} min`;
  return `${horas} h ${String(minutos).padStart(2, '0')} min`;
}

/** Hora local en 24 h, "HH:MM". Recibe la fecha para poder testearse. */
export function formatearHora(fecha: Date): string {
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mm = String(fecha.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
