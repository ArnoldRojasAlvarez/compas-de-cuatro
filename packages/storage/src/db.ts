// T-005: capa fina sobre IndexedDB para guardar y listar mapas importados.
// Vive fuera de core (core no puede tocar el navegador, ver CLAUDE.md,
// "packages/core no toca el navegador"). Sin indices: listarCanciones()
// trae todo con getAll(), que alcanza para la cantidad de canciones que un
// usuario real va a tener en desarrollo (T-011, "Rendimiento": no hace
// falta virtualizar para esa escala).

import { combinarRecord, hashMapa } from '@tetra/core';
import type { Chart, DifficultyResult, Ms, PartidaJugada, RecordDeMapa } from '@tetra/core';
import { normalizarRecord } from './records-validacion.js';
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
//
// T-014 agrega 'dificultades' (cache de estrellas por mapa, ver
// DificultadCacheada mas abajo): version 4. Mismo patron de guard con
// `contains`, mismo razonamiento: quien ya tenia 1, 2 o 3 llega aca con
// 'mapas'/'skins'/'canciones' intactas y solo se crea la tienda nueva.
//
// T-055 agrega 'records' (mejor partida, ultima e intentos por mapa, ver
// RecordDeMapa en @tetra/core): version 5, mismo guard con `contains`. Quien
// viene de 1 a 4 conserva todo lo que tenia y solo gana la tienda nueva. La
// clave es el hash del mapa como texto (el mismo `hashMapa` de la cache de
// dificultad), asi que una dificultad editada en el mapeador empieza de cero.
const VERSION_BASE = 5;
const NOMBRE_TIENDA_MAPAS_LEGADO = 'mapas';
const NOMBRE_TIENDA_SKINS = 'skins';
const NOMBRE_TIENDA_CANCIONES = 'canciones';
const NOMBRE_TIENDA_DIFICULTADES = 'dificultades';
const NOMBRE_TIENDA_RECORDS = 'records';

export type SongId = string;

/**
 * Una cancion importada, con TODAS sus dificultades (T-011, "Parte A"):
 * antes (T-005) se guardaba una entrada por dificultad, con el audio
 * duplicado en cada una; ahora el audio (y la portada) se guardan una vez
 * por cancion y `dificultades` trae un `Chart` por cada `.osu` del `.osz`
 * que parseo como mania 4K valido (ver osz.ts, `extraerCancionDeOsz`).
 * Nunca vacio: si ningun `.osu` parsea, la importacion entera falla antes
 * de llegar a guardarse (ver index.ts, `importarOsz`).
 *
 * T-049 agrega `video`, `videoOffset` e `importadaEn`, los tres opcionales:
 * van en el mismo object store, asi que la version de la base no cambia y
 * las canciones viejas se siguen leyendo tal cual (sin fondo de video y sin
 * fecha de importacion).
 */
export interface CancionGuardada {
  id: SongId;
  titulo: string;
  artista: string;
  audio: Blob;
  background?: Blob;
  /** Solo si el .osz trae un video que el navegador puede reproducir (mp4, m4v, webm). */
  video?: Blob;
  /** ms; copia de chart.metadata.videoOffset de la dificultad de la que salio el video. */
  videoOffset?: Ms;
  /** Date.now() al importar. Opcional porque las canciones viejas no lo tienen. */
  importadaEn?: number;
  dificultades: Chart[];
}

/**
 * Una entrada de la cache de dificultad (T-014, ver el ticket "Parte B" y
 * apps/web/src/dificultad-logica.ts): `clave` combina el hash del mapa
 * (`hashMapa` de `@tetra/core`) con `VERSION_MODELO_DIFICULTAD`, asi que un
 * cambio de version del modelo cae en una clave distinta y la entrada vieja
 * queda huerfana (no se borra: solo deja de leerse, mismo criterio de
 * migracion no destructiva que el resto de esta tienda).
 */
export interface DificultadCacheada {
  clave: string;
  resultado: DifficultyResult;
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
      if (!db.objectStoreNames.contains(NOMBRE_TIENDA_DIFICULTADES)) {
        db.createObjectStore(NOMBRE_TIENDA_DIFICULTADES, { keyPath: 'clave' });
      }
      if (!db.objectStoreNames.contains(NOMBRE_TIENDA_RECORDS)) {
        db.createObjectStore(NOMBRE_TIENDA_RECORDS, { keyPath: 'hash' });
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

/** Devuelve una cancion por id, o `undefined` si no existe. */
export async function leerCancionDeLaBase(id: SongId): Promise<CancionGuardada | undefined> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<CancionGuardada | undefined>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_CANCIONES, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA_CANCIONES).get(id);
      peticion.onsuccess = () => resolve(peticion.result as CancionGuardada | undefined);
      peticion.onerror = () => reject(peticion.error ?? new Error('No se pudo leer la cancion.'));
    });
  } finally {
    db.close();
  }
}

/** hashMapa como texto (la clave de 'records'), o `undefined` si el chart esta tan roto que no se puede hashear. */
function claveDeRecord(chart: Chart): string | undefined {
  try {
    return String(hashMapa(chart));
  } catch {
    return undefined;
  }
}

/** Las claves de record de todas las dificultades de una cancion (las que se puedan calcular). */
function clavesDeRecordsDe(cancion: CancionGuardada | undefined): Set<string> {
  const claves = new Set<string>();
  const dificultades: unknown = cancion?.dificultades;
  if (!Array.isArray(dificultades)) return claves;
  for (const chart of dificultades as Chart[]) {
    const clave = claveDeRecord(chart);
    if (clave !== undefined) claves.add(clave);
  }
  return claves;
}

/**
 * Borra una cancion entera y, en la misma transaccion, los records de sus
 * dificultades (T-055). Un record solo se conserva si OTRA cancion de la
 * biblioteca tiene una dificultad con el mismo hash (el mismo .osz importado
 * dos veces): ese record sigue valiendo para la que queda. No hace nada si el
 * id no existe.
 */
export async function borrarCancionDeLaBase(id: SongId): Promise<void> {
  const db = await abrirBaseDeDatos();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([NOMBRE_TIENDA_CANCIONES, NOMBRE_TIENDA_RECORDS], 'readwrite');
      const canciones = tx.objectStore(NOMBRE_TIENDA_CANCIONES);
      const records = tx.objectStore(NOMBRE_TIENDA_RECORDS);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo borrar la cancion.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se aborto el borrado de la cancion.'));

      const lectura = canciones.get(id);
      lectura.onsuccess = () => {
        const aBorrar = clavesDeRecordsDe(lectura.result as CancionGuardada | undefined);
        canciones.delete(id);
        if (aBorrar.size === 0) return;
        // Las que otra cancion todavia usa se salvan del borrado.
        const recorrido = canciones.openCursor();
        recorrido.onsuccess = () => {
          const cursor = recorrido.result;
          if (cursor !== null) {
            if (cursor.key !== id) {
              for (const clave of clavesDeRecordsDe(cursor.value as CancionGuardada)) {
                aBorrar.delete(clave);
              }
            }
            cursor.continue();
            return;
          }
          for (const clave of aBorrar) records.delete(clave);
        };
      };
    });
  } finally {
    db.close();
  }
}

/**
 * Guarda una partida terminada de un mapa (T-055): lee el record previo (si
 * esta corrupto se trata como inexistente), lo combina con `combinarRecord`
 * y lo escribe, todo en una transaccion. `esMejor` es true si la partida
 * nueva quedo como `mejor`; `anterior` es el mejor que habia (ausente si era
 * la primera partida del mapa).
 */
export async function guardarPartidaEnLaBase(
  hash: string,
  partida: PartidaJugada,
): Promise<{ record: RecordDeMapa; esMejor: boolean; anterior?: PartidaJugada }> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_RECORDS, 'readwrite');
      const tienda = tx.objectStore(NOMBRE_TIENDA_RECORDS);
      let resultado:
        | { record: RecordDeMapa; esMejor: boolean; anterior?: PartidaJugada }
        | undefined;
      tx.oncomplete = () => {
        if (resultado) resolve(resultado);
        else reject(new Error('No se pudo guardar la partida.'));
      };
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar la partida.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se aborto el guardado de la partida.'));

      const lectura = tienda.get(hash);
      lectura.onsuccess = () => {
        const previo = normalizarRecord(lectura.result);
        const record = combinarRecord(previo, hash, partida);
        tienda.put(record);
        resultado = {
          record,
          esMejor: record.mejor === partida,
          ...(previo !== undefined && { anterior: previo.mejor }),
        };
      };
    });
  } finally {
    db.close();
  }
}

/** Lee los records de varios mapas de una vez. Los registros corruptos se ignoran; nunca lanza por el contenido. */
export async function leerRecordsDeLaBase(
  hashes: readonly string[],
): Promise<Map<string, RecordDeMapa>> {
  const encontrados = new Map<string, RecordDeMapa>();
  if (hashes.length === 0) return encontrados;
  const db = await abrirBaseDeDatos();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_RECORDS, 'readonly');
      const tienda = tx.objectStore(NOMBRE_TIENDA_RECORDS);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudieron leer los records.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se aborto la lectura de los records.'));
      for (const hash of new Set(hashes)) {
        const peticion = tienda.get(hash);
        peticion.onsuccess = () => {
          const record = normalizarRecord(peticion.result);
          // La clave manda: un registro cuyo `hash` no coincide con su clave es raro y se ignora.
          if (record !== undefined && record.hash === hash) encontrados.set(hash, record);
        };
      }
    });
  } finally {
    db.close();
  }
  return encontrados;
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

/** Guarda (o reemplaza si la clave ya existia) un resultado de dificultad en la cache. */
export async function guardarDificultadCacheada(clave: string, resultado: DifficultyResult): Promise<void> {
  const db = await abrirBaseDeDatos();
  try {
    const entrada: DificultadCacheada = { clave, resultado };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_DIFICULTADES, 'readwrite');
      tx.objectStore(NOMBRE_TIENDA_DIFICULTADES).put(entrada);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar la dificultad en cache.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se aborto el guardado de la dificultad en cache.'));
    });
  } finally {
    db.close();
  }
}

/**
 * Devuelve el resultado cacheado para `clave`, o `undefined` si no hay
 * entrada (mapa nunca calculado con esta version del modelo, o cambio de
 * version: ver `VERSION_MODELO_DIFICULTAD` en `@tetra/core` y como
 * `dificultad-logica.ts` arma `clave`).
 */
export async function leerDificultadCacheada(clave: string): Promise<DifficultyResult | undefined> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<DifficultyResult | undefined>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_DIFICULTADES, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA_DIFICULTADES).get(clave);
      peticion.onsuccess = () => {
        const entrada = peticion.result as DificultadCacheada | undefined;
        resolve(entrada?.resultado);
      };
      peticion.onerror = () =>
        reject(peticion.error ?? new Error('No se pudo leer la dificultad cacheada.'));
    });
  } finally {
    db.close();
  }
}
