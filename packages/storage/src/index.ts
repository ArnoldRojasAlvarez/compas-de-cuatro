// T-005: punto de entrada de @tetra/storage. API publica chica, tal cual la
// pide el ticket (ver docs/tickets/T-005-importador-osu.md, "La capa de
// navegador va aparte"):
//
//   importarOsz(file): Promise<ChartId>
//   listarMapas(): Promise<MapaGuardado[]>
//
// Todo lo demas (unzip, parseo, IndexedDB) es detalle interno repartido
// entre osz.ts y db.ts.

import { extraerMapaDeOsz } from './osz.js';
import { extraerImagenesDeOsk } from './osk.js';
import { guardarMapa, listarMapasDeLaBase, guardarSkin, listarSkinsDeLaBase } from './db.js';
import type { ChartId, MapaGuardado, SkinId, SkinGuardada } from './db.js';

export type { ChartId, MapaGuardado, SkinId, SkinGuardada } from './db.js';
export type { MapaImportado } from './osz.js';
export { elegirArchivoOsu, mimeDesdeNombre, extraerMapaDeOsz } from './osz.js';
export type { ClaveImagenSkin, ImagenesDeSkin } from './osk.js';
export { ubicarImagenesDeSkin, extraerImagenesDeOsk } from './osk.js';

function crearId(): ChartId {
  return crypto.randomUUID();
}

function crearIdSkin(): SkinId {
  return crypto.randomUUID();
}

/**
 * Importa un archivo .osz: lo descomprime, parsea el .osu que trae adentro
 * y guarda el Chart resultante junto con su audio (y portada, si hay) en
 * IndexedDB. Devuelve el id con el que quedo guardado.
 */
export async function importarOsz(archivo: Blob): Promise<ChartId> {
  const extraido = await extraerMapaDeOsz(archivo);
  const id = crearId();
  const mapa: MapaGuardado =
    extraido.background === undefined
      ? { id, chart: extraido.chart, audio: extraido.audio }
      : { id, chart: extraido.chart, audio: extraido.audio, background: extraido.background };
  await guardarMapa(mapa);
  return id;
}

/** Devuelve todos los mapas guardados hasta ahora. */
export function listarMapas(): Promise<MapaGuardado[]> {
  return listarMapasDeLaBase();
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
