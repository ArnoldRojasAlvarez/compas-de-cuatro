// T-009: persistencia de que skin esta activa (o ninguna: rectangulos, el
// default). Mismo patron que el offset (T-007, ver offset.ts) y la
// velocidad (T-008, ver velocidad.ts): localStorage inyectable, default a
// `localStorage`, para poder testear sin navegador real (ver
// vitest.config.ts, entorno node).
//
// Solo se guarda el SkinId (o nada, si esta "sin skin"): las imagenes en
// si siguen en IndexedDB via @tetra/storage (ver
// packages/storage/src/db.ts), localStorage guarda apenas la referencia.
// Que esa referencia todavia exista en la base al recargar (por ejemplo,
// si el usuario borro la base a mano) es responsabilidad de quien la lee
// (ver song-select.ts, `resolverTexturasDeSkinActiva`): esta funcion no
// valida nada, solo lee y escribe el id.

import type { SkinId } from '@tetra/storage';

const CLAVE_SKIN_ACTIVA = 'tetra:skin-activa';

/** Id de la skin activa, o `null` si esta en "sin skin" (rectangulos). */
export function leerSkinActiva(storage: Storage = localStorage): SkinId | null {
  return storage.getItem(CLAVE_SKIN_ACTIVA);
}

/** Guarda cual skin queda activa, para que sobreviva recargar la pagina. `null` vuelve a "sin skin". */
export function guardarSkinActiva(id: SkinId | null, storage: Storage = localStorage): void {
  if (id === null) {
    storage.removeItem(CLAVE_SKIN_ACTIVA);
  } else {
    storage.setItem(CLAVE_SKIN_ACTIVA, id);
  }
}
