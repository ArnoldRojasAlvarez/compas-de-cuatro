// T-053: que skin esta activa. Logica pura (sin Pixi ni IndexedDB) sobre la
// clave de localStorage que ya escribe skin.ts.
//
// La skin activa es una de las propias de Tetra (T-050) o una `.osk`
// importada. Se guarda en un solo string:
//
//   "propia:barras"   -> skin propia con ese id
//   "<uuid>"          -> `.osk` importada con ese SkinId (formato de T-009)
//   (nada)            -> la propia por defecto
//
// Un guardado de una version anterior ("sin skin", es decir sin clave) y uno
// con una propia que ya no existe caen los dos a la propia por defecto.

import type { IdSkinPropia } from '@tetra/engine';
import type { SkinId } from '@tetra/storage';
import { guardarSkinActiva, leerSkinActiva } from './skin.js';

/** Prefijo de una skin propia en el valor guardado. Un SkinId de `.osk` es un uuid: nunca empieza asi. */
export const PREFIJO_PROPIA = 'propia:';

export type SeleccionDeSkin =
  | { readonly tipo: 'propia'; readonly id: IdSkinPropia }
  | { readonly tipo: 'osk'; readonly id: SkinId };

/** Que skins propias existen y cual es la de arranque (sale de @tetra/engine, ver skin-activa.ts). */
export interface CatalogoDePropias {
  readonly ids: readonly IdSkinPropia[];
  readonly porDefecto: IdSkinPropia;
}

/** Valor a guardar para una seleccion. */
export function serializarSeleccion(seleccion: SeleccionDeSkin): string {
  return seleccion.tipo === 'propia' ? `${PREFIJO_PROPIA}${seleccion.id}` : seleccion.id;
}

/** Lo contrario de `serializarSeleccion`. Nunca lanza: lo que no se entiende da la propia por defecto. */
export function parsearSeleccion(
  crudo: string | null,
  catalogo: CatalogoDePropias,
): SeleccionDeSkin {
  const porDefecto: SeleccionDeSkin = { tipo: 'propia', id: catalogo.porDefecto };
  if (crudo === null || crudo === '') return porDefecto;
  if (crudo.startsWith(PREFIJO_PROPIA)) {
    const id = crudo.slice(PREFIJO_PROPIA.length);
    const conocida = catalogo.ids.find((candidata) => candidata === id);
    return conocida === undefined ? porDefecto : { tipo: 'propia', id: conocida };
  }
  return { tipo: 'osk', id: crudo };
}

/** Skin activa guardada. Sin nada guardado: la propia por defecto. */
export function leerSeleccion(
  catalogo: CatalogoDePropias,
  storage: Storage = localStorage,
): SeleccionDeSkin {
  return parsearSeleccion(leerSkinActiva(storage), catalogo);
}

export function guardarSeleccion(
  seleccion: SeleccionDeSkin,
  storage: Storage = localStorage,
): void {
  guardarSkinActiva(serializarSeleccion(seleccion), storage);
}

export function seleccionesIguales(a: SeleccionDeSkin, b: SeleccionDeSkin): boolean {
  return a.tipo === b.tipo && a.id === b.id;
}
