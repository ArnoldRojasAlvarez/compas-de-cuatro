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

import { extraerCancionDeOsz } from './osz.js';
import { extraerImagenesDeOsk } from './osk.js';
import { guardarCancion, listarCancionesDeLaBase, guardarSkin, listarSkinsDeLaBase } from './db.js';
import type { SongId, CancionGuardada, SkinId, SkinGuardada } from './db.js';

export type { SongId, CancionGuardada, SkinId, SkinGuardada } from './db.js';
export type { MapaImportado, CancionImportada } from './osz.js';
export { elegirArchivoOsu, elegirArchivosOsu, mimeDesdeNombre, extraerMapaDeOsz, extraerCancionDeOsz } from './osz.js';
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
