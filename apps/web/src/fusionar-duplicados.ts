// T-066 (D4): fusiona las canciones duplicadas de la biblioteca, migra el
// offset por cancion (vive en localStorage, que storage no toca) y avisa al
// resto de la app. Corre al abrir la app (main.ts) y despues de restaurar un
// respaldo (ajustes.ts), porque un respaldo de otra computadora puede traer
// la misma cancion con otro id. Nunca lanza: un fallo se registra con
// console.warn y no bloquea nada.

import { fusionarDuplicados } from '@tetra/storage';
import { EVENTO_BIBLIOTECA_CAMBIO } from './musica-menu-logica.js';
import { migrarOffsetsLocales } from './offset-local.js';

/** Devuelve cuantas fusiones se hicieron (0 si no habia duplicados o si fallo). */
export async function fusionarDuplicadosYMigrar(): Promise<number> {
  try {
    const fusiones = await fusionarDuplicados();
    if (fusiones.length === 0) return 0;
    migrarOffsetsLocales(fusiones);
    window.dispatchEvent(new CustomEvent(EVENTO_BIBLIOTECA_CAMBIO));
    return fusiones.length;
  } catch (error) {
    console.warn('No se pudieron fusionar las canciones duplicadas.', error);
    return 0;
  }
}
