// T-005: punto de entrada de @tetra/storage. API publica chica, tal cual la
// pide el ticket (ver docs/tickets/T-005-importador-osu.md, "La capa de
// navegador va aparte").
//
// T-011 cambia la forma que devuelve importarOsz (ver "Parte A" del
// ticket): antes una sola dificultad (ChartId/MapaGuardado, ver db.ts para
// por que esa tienda sigue ahi sin usarse), ahora una cancion completa con
// todas sus dificultades:
//
//   importarOsz(file): Promise<SongId>
//   listarCanciones(): Promise<CancionGuardada[]>
//
// Todo lo demas (unzip, parseo, IndexedDB) es detalle interno repartido
// entre osz.ts y db.ts.

import type { Chart, DifficultyResult } from '@tetra/core';
import { ponerDificultad, quitarDificultad } from './dificultades.js';
import { extraerCancionDeOsz } from './osz.js';
import { construirOsz, type EntradaOsz } from './osz-escritor.js';
import { extraerImagenesDeOsk } from './osk.js';
import {
  guardarCancion,
  listarCancionesDeLaBase,
  leerCancionDeLaBase,
  borrarCancionDeLaBase,
  guardarSkin,
  listarSkinsDeLaBase,
  guardarDificultadCacheada,
  leerDificultadCacheada,
} from './db.js';
import type { SongId, CancionGuardada, SkinId, SkinGuardada } from './db.js';

export type { SongId, CancionGuardada, SkinId, SkinGuardada, DificultadCacheada } from './db.js';
export type { MapaImportado, CancionImportada } from './osz.js';
export { elegirArchivoOsu, elegirArchivosOsu, mimeDesdeNombre, extraerMapaDeOsz, extraerCancionDeOsz } from './osz.js';
export type { DificultadParaOsz, EntradaOsz } from './osz-escritor.js';
export { construirOsz, nombreDeOsu, nombreSeguro } from './osz-escritor.js';
export type { ClaveImagenSkin, ImagenesDeSkin } from './osk.js';
export { ubicarImagenesDeSkin, extraerImagenesDeOsk } from './osk.js';

function crearId(): SongId {
  return crypto.randomUUID();
}

function crearIdSkin(): SkinId {
  return crypto.randomUUID();
}

/**
 * Importa un archivo .osz: lo descomprime, parsea todos los .osu que trae
 * adentro (una dificultad por cada uno que sea mania 4K valido) y guarda la
 * cancion resultante, con su audio (y portada, si hay) compartidos entre
 * todas sus dificultades, en IndexedDB. Devuelve el id con el que quedo
 * guardada.
 */
export async function importarOsz(archivo: Blob): Promise<SongId> {
  const extraido = await extraerCancionDeOsz(archivo);
  const id = crearId();
  const cancion: CancionGuardada =
    extraido.background === undefined
      ? {
          id,
          titulo: extraido.titulo,
          artista: extraido.artista,
          audio: extraido.audio,
          dificultades: extraido.dificultades,
        }
      : {
          id,
          titulo: extraido.titulo,
          artista: extraido.artista,
          audio: extraido.audio,
          background: extraido.background,
          dificultades: extraido.dificultades,
        };
  await guardarCancion(cancion);
  return id;
}

/** Devuelve todas las canciones guardadas hasta ahora, cada una con todas sus dificultades. */
export function listarCanciones(): Promise<CancionGuardada[]> {
  return listarCancionesDeLaBase();
}

/**
 * Importa un archivo .osk: lo descomprime, extrae las imagenes de skin que
 * esta version usa (ver osk.ts) y las guarda en IndexedDB. Devuelve el id
 * con el que quedo guardada. El nombre para mostrar en el cargador sale de
 * `File.name` cuando el archivo es un `File` de verdad (arrastrado o
 * elegido por el usuario); si no (por ejemplo un Blob armado a mano en un
 * test), queda "skin sin nombre".
 */
export async function importarOsk(archivo: Blob): Promise<SkinId> {
  const imagenes = await extraerImagenesDeOsk(archivo);
  const id = crearIdSkin();
  const nombre = archivo instanceof File ? archivo.name : 'skin sin nombre';
  const skin: SkinGuardada = { id, nombre, imagenes };
  await guardarSkin(skin);
  return id;
}

/** Devuelve todas las skins guardadas hasta ahora. */
export function listarSkins(): Promise<SkinGuardada[]> {
  return listarSkinsDeLaBase();
}

/**
 * Guarda un resultado de dificultad en la cache de IndexedDB, bajo `clave`
 * (ver `DificultadCacheada` en db.ts para que compone esa clave). Pasa tal
 * cual a `guardarDificultadCacheada` de db.ts; existe como reexport directo
 * para que apps/web solo importe de `@tetra/storage`, nunca de db.ts (T-014).
 */
export function cachearDificultad(clave: string, resultado: DifficultyResult): Promise<void> {
  return guardarDificultadCacheada(clave, resultado);
}

/** Lee un resultado de dificultad de la cache. `undefined` si no hay entrada para esa clave. */
export function leerDificultadDeCache(clave: string): Promise<DifficultyResult | undefined> {
  return leerDificultadCacheada(clave);
}

/**
 * Guarda en la biblioteca una cancion creada en el mapeador. Pasa por un .osz
 * (el mismo camino que cualquier importacion) para que lo guardado sea
 * exactamente lo que se exportaria. Devuelve el id de la cancion.
 */
export async function guardarCancionCreada(entrada: EntradaOsz): Promise<SongId> {
  const osz = construirOsz(entrada);
  return importarOsz(new Blob([new Uint8Array(osz)], { type: 'application/zip' }));
}

/** Devuelve una cancion por id, con todas sus dificultades. `undefined` si no existe. */
export function leerCancion(id: SongId): Promise<CancionGuardada | undefined> {
  return leerCancionDeLaBase(id);
}

/**
 * Pone una dificultad en una cancion que ya existe: reemplaza la que tenga el
 * mismo `difficultyName` o agrega una nueva. No cambia el id ni toca otras
 * canciones. Falla con un mensaje claro si la cancion no existe.
 */
export async function guardarDificultad(id: SongId, chart: Chart): Promise<void> {
  const cancion = await leerCancionDeLaBase(id);
  if (!cancion) {
    throw new Error('La cancion ya no esta en la biblioteca: no se puede guardar la dificultad.');
  }
  await guardarCancion({ ...cancion, dificultades: ponerDificultad(cancion.dificultades, chart) });
}

/**
 * Quita una dificultad de una cancion. Una cancion nunca queda sin
 * dificultades: si era la ultima, se borra la cancion entera (decision de
 * T-032, ver el ticket). Devuelve `true` si la cancion se borro.
 */
export async function borrarDificultad(id: SongId, difficultyName: string): Promise<boolean> {
  const cancion = await leerCancionDeLaBase(id);
  if (!cancion) return false;
  const restantes = quitarDificultad(cancion.dificultades, difficultyName);
  if (restantes.length === cancion.dificultades.length) return false;
  if (restantes.length === 0) {
    await borrarCancionDeLaBase(id);
    return true;
  }
  await guardarCancion({ ...cancion, dificultades: restantes });
  return false;
}
