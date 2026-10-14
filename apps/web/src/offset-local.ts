// T-057: offset por cancion. Algunos .osz vienen corridos unos ms; el offset
// global (offset.ts) no puede corregirlos sin descuadrar las demas canciones.
// Este se suma al global al armar el reloj de la partida (ver game.ts).
//
// Mismo patron que offset.ts y velocidad.ts: `storage` inyectable con default
// a `localStorage`, para testear sin navegador (vitest corre en entorno node).
//
// Clave `tetra:offset-local:<songId>`. Ojo: `borrarCancion` (@tetra/storage)
// vive en IndexedDB y no sabe de localStorage, asi que no limpia esta clave.
// No hace falta: es un entero chico. Desde T-066 reimportar el mismo .osz
// no crea otra cancion: devuelve el id de la que ya estaba, asi que el
// ajuste sigue en su lugar. Si borraste la cancion y la reimportas, tiene un
// id nuevo y el ajuste hay que volver a ponerlo.

import type { Ms } from '@tetra/core';
import type { FusionDeDuplicados } from '@tetra/storage';

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

/**
 * T-066 (D4): tras fusionar canciones duplicadas, el offset de las absorbidas
 * pasa a la sobreviviente si esta no tiene (0): toma el primero distinto de 0
 * de las absorbidas, de la importacion mas nueva a la mas vieja (la que
 * probablemente se estaba jugando). Despues borra las claves de las
 * absorbidas. Las fusiones ya traen las absorbidas en ese orden.
 */
export function migrarOffsetsLocales(
  fusiones: readonly FusionDeDuplicados[],
  storage: Storage = localStorage,
): void {
  for (const { sobreviviente, absorbidas } of fusiones) {
    if (leerOffsetLocal(sobreviviente, storage) === 0) {
      for (const id of absorbidas) {
        const valor = leerOffsetLocal(id, storage);
        if (valor !== 0) {
          guardarOffsetLocal(sobreviviente, valor, storage);
          break;
        }
      }
    }
    for (const id of absorbidas) storage.removeItem(claveDe(id));
  }
}

/** Texto del offset con signo para mostrar: "+3 ms", "-12 ms", "0 ms". */
export function formatearOffsetLocal(ms: Ms): string {
  const entero = clampOffsetLocal(ms);
  return `${entero > 0 ? '+' : ''}${entero} ms`;
}
