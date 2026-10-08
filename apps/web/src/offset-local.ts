// T-057: offset por cancion. Algunos .osz vienen corridos unos ms; el offset
// global (offset.ts) no puede corregirlos sin descuadrar las demas canciones.
// Este se suma al global al armar el reloj de la partida (ver game.ts).
//
// Mismo patron que offset.ts y velocidad.ts: `storage` inyectable con default
// a `localStorage`, para testear sin navegador (vitest corre en entorno node).
//
// Clave `tetra:offset-local:<songId>`. Ojo: `borrarCancion` (@tetra/storage)
// vive en IndexedDB y no sabe de localStorage, asi que no limpia esta clave.
// No hace falta: es un entero chico, y si el id vuelve a existir (reimportar
// el mismo .osz da el mismo id) el ajuste de esa cancion vuelve con el.

import type { Ms } from '@tetra/core';

const PREFIJO_CLAVE = 'tetra:offset-local:';

/** Tope del offset de una cancion, en ms hacia cada lado. Mas que eso no es un .osz corrido, es otra cosa. */
export const OFFSET_LOCAL_MAX: Ms = 300;

function claveDe(songId: string): string {
  return PREFIJO_CLAVE + songId;
}

/** Redondea a un entero de ms y recorta a [-OFFSET_LOCAL_MAX, OFFSET_LOCAL_MAX]. No valido da 0 (nunca -0). */
export function clampOffsetLocal(valor: number): Ms {
  if (!Number.isFinite(valor)) return 0;
  const recortado = Math.min(OFFSET_LOCAL_MAX, Math.max(-OFFSET_LOCAL_MAX, Math.round(valor)));
  return recortado === 0 ? 0 : recortado;
}

/**
 * Offset local de la cancion, en ms. 0 si no hay nada guardado o si lo
 * guardado no es un numero (localStorage editado a mano). Lo guardado fuera
 * de rango o no entero se normaliza al leerlo.
 */
export function leerOffsetLocal(songId: string, storage: Storage = localStorage): Ms {
  const crudo = storage.getItem(claveDe(songId));
  if (crudo === null) return 0;
  return clampOffsetLocal(Number(crudo));
}

/**
 * Guarda el offset local de la cancion, recortado y entero, y devuelve el
 * valor que quedo guardado (el que el llamador debe mostrar). 0 borra la
 * clave: no se acumulan claves de canciones sin ajuste.
 */
export function guardarOffsetLocal(
  songId: string,
  ms: number,
  storage: Storage = localStorage,
): Ms {
  const valor = clampOffsetLocal(ms);
  if (valor === 0) storage.removeItem(claveDe(songId));
  else storage.setItem(claveDe(songId), String(valor));
  return valor;
}

/** Texto del offset con signo para mostrar: "+3 ms", "-12 ms", "0 ms". */
export function formatearOffsetLocal(ms: Ms): string {
  const entero = clampOffsetLocal(ms);
  return `${entero > 0 ? '+' : ''}${entero} ms`;
}
