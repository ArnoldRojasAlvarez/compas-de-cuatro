// T-005: capa fina sobre IndexedDB para guardar y listar mapas importados.
// Vive fuera de core (core no puede tocar el navegador, ver CLAUDE.md,
// "packages/core no toca el navegador"). Sin indices: listarCanciones()
// trae todo con getAll(), que alcanza para la cantidad de canciones que un
// usuario real va a tener en desarrollo (T-011, "Rendimiento": no hace
// falta virtualizar para esa escala).

import type { Chart } from '@tetra/core';
import type { ImagenesDeSkin } from './osk.js';

const NOMBRE_BASE = 'tetra-mapas';
// T-011 agrega la tienda 'canciones' (una cancion con N dificultades) a la
// misma base: version 3. onupgradeneeded corre tambien para quien ya tenia
// guardada la version 1 (solo 'mapas', T-005) o la version 2 (+ 'skins',
// T-009), y el guard `if (!contains(...))` deja esas tiendas intactas (con
// los datos que tuvieran) y solo crea la nueva: no hace falta migrar nada
// de lo que ya existia, mismo patron que uso T-009 para agregar 'skins'.
//
// 'mapas' (T-005: una sola dificultad por entrada, ver MapaGuardado que
// esta tienda guardaba) queda sin usar desde este ticket: el song select
// lee de 'canciones', que guarda TODAS las dificultades de un .osz (ver
// CancionGuardada mas abajo). La tienda vieja no se borra ni se le quita
// su creacion de aca a proposito: eso es lo que "migracion no destructiva"
// quiere decir (ver el ticket, "Parte A", y T-009 como precedente). No se
// migran sus filas a 'canciones': son datos de desarrollo (T-005 nunca
// llego a produccion) y no vale la pena escribir un migrador de un modelo
// a otro para eso; si algun dia hiciera falta, la tienda vieja sigue ahi
// intacta para escribirlo.
const VERSION_BASE = 3;
const NOMBRE_TIENDA_MAPAS_LEGADO = 'mapas';
const NOMBRE_TIENDA_SKINS = 'skins';
const NOMBRE_TIENDA_CANCIONES = 'canciones';

export type SongId = string;

/**
 * Una cancion importada, con TODAS sus dificultades (T-011, "Parte A"):
 * antes (T-005) se guardaba una entrada por dificultad, con el audio
 * duplicado en cada una; ahora el audio (y la portada) se guardan una vez
 * por cancion y `dificultades` trae un `Chart` por cada `.osu` del `.osz`
 * que parseo como mania 4K valido (ver osz.ts, `extraerCancionDeOsz`).
 * Nunca vacio: si ningun `.osu` parsea, la importacion entera falla antes
 * de llegar a guardarse (ver index.ts, `importarOsz`).
 */
export interface CancionGuardada {
  id: SongId;
  titulo: string;
  artista: string;
  audio: Blob;
  background?: Blob;
  dificultades: Chart[];
}

export type SkinId = string;

/** Una skin importada, tal cual se guarda y se lee de IndexedDB. */
export interface SkinGuardada {
  id: SkinId;
  /** Nombre de archivo original (con el que se soltó el .osk), para mostrar en el cargador. */
  nombre: string;
  imagenes: ImagenesDeSkin;
}

function abrirBaseDeDatos(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const peticion = indexedDB.open(NOMBRE_BASE, VERSION_BASE);

    peticion.onupgradeneeded = () => {
      const db = peticion.result;
      if (!db.objectStoreNames.contains(NOMBRE_TIENDA_MAPAS_LEGADO)) {
        db.createObjectStore(NOMBRE_TIENDA_MAPAS_LEGADO, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(NOMBRE_TIENDA_SKINS)) {
        db.createObjectStore(NOMBRE_TIENDA_SKINS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(NOMBRE_TIENDA_CANCIONES)) {
        db.createObjectStore(NOMBRE_TIENDA_CANCIONES, { keyPath: 'id' });
      }
    };

    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => {
      reject(peticion.error ?? new Error('No se pudo abrir la base de datos de mapas.'));
    };
  });
}

/** Guarda (o reemplaza si el id ya existia) una cancion completa, con todas sus dificultades. */
export async function guardarCancion(cancion: CancionGuardada): Promise<void> {
  const db = await abrirBaseDeDatos();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_CANCIONES, 'readwrite');
      tx.objectStore(NOMBRE_TIENDA_CANCIONES).put(cancion);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar la cancion.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se aborto el guardado de la cancion.'));
    });
  } finally {
    db.close();
  }
}

/** Devuelve todas las canciones guardadas, sin ningun orden garantizado (el orden es responsabilidad del song select, ver apps/web/src/song-select-logica.ts). */
export async function listarCancionesDeLaBase(): Promise<CancionGuardada[]> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<CancionGuardada[]>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_CANCIONES, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA_CANCIONES).getAll();
      peticion.onsuccess = () => resolve(peticion.result as CancionGuardada[]);
      peticion.onerror = () =>
        reject(peticion.error ?? new Error('No se pudieron listar las canciones.'));
    });
  } finally {
    db.close();
  }
}

/** Guarda (o reemplaza si el id ya existia) una skin completa. */
export async function guardarSkin(skin: SkinGuardada): Promise<void> {
  const db = await abrirBaseDeDatos();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_SKINS, 'readwrite');
      tx.objectStore(NOMBRE_TIENDA_SKINS).put(skin);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar la skin.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se aborto el guardado de la skin.'));
    });
  } finally {
    db.close();
  }
}

/** Devuelve todas las skins guardadas, sin ningun orden garantizado. */
export async function listarSkinsDeLaBase(): Promise<SkinGuardada[]> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<SkinGuardada[]>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_SKINS, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA_SKINS).getAll();
      peticion.onsuccess = () => resolve(peticion.result as SkinGuardada[]);
      peticion.onerror = () => reject(peticion.error ?? new Error('No se pudieron listar las skins.'));
    });
  } finally {
    db.close();
  }
}
