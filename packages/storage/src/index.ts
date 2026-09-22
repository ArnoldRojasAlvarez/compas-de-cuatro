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
import { guardarMapa, listarMapasDeLaBase } from './db.js';
import type { ChartId, MapaGuardado } from './db.js';

export type { ChartId, MapaGuardado } from './db.js';
export type { MapaImportado } from './osz.js';
export { elegirArchivoOsu, mimeDesdeNombre, extraerMapaDeOsz } from './osz.js';

function crearId(): ChartId {
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
