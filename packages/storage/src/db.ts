// T-005: capa fina sobre IndexedDB para guardar y listar mapas importados.
// Vive fuera de core (core no puede tocar el navegador, ver CLAUDE.md,
// "packages/core no toca el navegador"). Sin indices: listarCanciones()
// trae todo con getAll(), que alcanza para la cantidad de canciones que un
// usuario real va a tener en desarrollo (T-011, "Rendimiento": no hace
// falta virtualizar para esa escala).

import {
  TOPE_HISTORIAL,
  combinarRecord,
  hashMapa,
  leerReplay,
  serializarReplay,
} from '@tetra/core';
import type {
  Chart,
  DifficultyResult,
  Ms,
  PartidaJugada,
  RecordDeMapa,
  RegistroPartida,
  Replay,
} from '@tetra/core';
import {
  claveDeRegistroPartida,
  idDeReplayReciente,
  normalizarRecord,
  normalizarRegistroPartida,
  normalizarReplayGuardado,
  normalizarReplayReciente,
} from './records-validacion.js';
import type {
  ReplayGuardado,
  ReplayRecienteGuardado,
  ResumenDeReciente,
} from './records-validacion.js';
import type { ImagenesDeSkin } from './osk.js';
import type { PlanDeFusion } from './duplicados.js';

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
//
// T-044 agrega 'replays' (el replay de la mejor partida de cada mapa, ver
// ReplayGuardado): version 6, mismo guard con `contains`. Quien viene de 1 a 5
// conserva todo y solo gana la tienda nueva. Misma clave que 'records'.
//
// T-045 agrega 'historial' (un registro resumido por partida completada, ver
// RegistroPartida en @tetra/core): version 7, mismo guard con `contains`. Quien
// viene de 1 a 6 conserva todo y solo gana la tienda nueva. A diferencia de
// 'records' y 'replays', NO se indexa por mapa ni se borra con la cancion: el
// historial es del jugador (cuanto toco, como evoluciona su timing), no de la
// cancion, y borrar un mapa de la biblioteca no borra lo que el jugador jugo.
// Claves fuera de linea (`fecha|hash`, ver claveDeRegistroPartida): el orden de
// las claves es el cronologico y reimportar un respaldo no duplica nada.
//
// T-065 agrega 'recientes' (el replay de TODAS las partidas completadas, con su
// resumen y la marca `fijado`): version 8, mismo guard con `contains`. Quien
// viene de 1 a 7 conserva todo y solo gana la tienda nueva (con sus indices
// 'hash' y 'fecha'). 'replays' (el de la mejor partida) no se toca: el replay de
// la mejor sigue siendo permanente, 'recientes' se purga sola al abrir la app.
const VERSION_BASE = 8;
const NOMBRE_TIENDA_MAPAS_LEGADO = 'mapas';
const NOMBRE_TIENDA_SKINS = 'skins';
const NOMBRE_TIENDA_CANCIONES = 'canciones';
const NOMBRE_TIENDA_DIFICULTADES = 'dificultades';
const NOMBRE_TIENDA_RECORDS = 'records';
const NOMBRE_TIENDA_REPLAYS = 'replays';
const NOMBRE_TIENDA_HISTORIAL = 'historial';
const NOMBRE_TIENDA_RECIENTES = 'recientes';

/** T-065: cuantos dias se guarda el replay de una partida reciente (si no esta fijada). */
export const DIAS_REPLAYS_RECIENTES = 7;
/** T-065: cuantas partidas recientes sin fijar se guardan como maximo. */
export const TOPE_REPLAYS_RECIENTES = 200;

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
      if (!db.objectStoreNames.contains(NOMBRE_TIENDA_REPLAYS)) {
        db.createObjectStore(NOMBRE_TIENDA_REPLAYS, { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains(NOMBRE_TIENDA_HISTORIAL)) {
        db.createObjectStore(NOMBRE_TIENDA_HISTORIAL);
      }
      if (!db.objectStoreNames.contains(NOMBRE_TIENDA_RECIENTES)) {
        const recientes = db.createObjectStore(NOMBRE_TIENDA_RECIENTES, { keyPath: 'id' });
        recientes.createIndex('hash', 'hash');
        recientes.createIndex('fecha', 'fecha');
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
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar la canción.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se abortó el guardado de la canción.'));
    });
  } finally {
    db.close();
  }
}

/**
 * T-066 (D4): aplica las fusiones de duplicados en UNA transaccion sobre
 * 'canciones': `put` de cada sobreviviente ya fusionada y `delete` de cada
 * absorbida. A proposito NO toca records, replays ni recientes: todas las
 * claves `hashMapa` de las absorbidas estan en la sobreviviente, asi que
 * siguen valiendo (por eso no se usa `borrarCancionDeLaBase`).
 */
export async function aplicarFusionesEnLaBase(planes: readonly PlanDeFusion[]): Promise<void> {
  if (planes.length === 0) return;
  const db = await abrirBaseDeDatos();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_CANCIONES, 'readwrite');
      const canciones = tx.objectStore(NOMBRE_TIENDA_CANCIONES);
      for (const plan of planes) {
        canciones.put(plan.resultado);
        for (const id of plan.absorbidas) canciones.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudieron fusionar las canciones.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se abortó la fusión de las canciones.'));
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
      peticion.onerror = () => reject(peticion.error ?? new Error('No se pudo leer la canción.'));
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
 * Borra una cancion entera y, en la misma transaccion, los records y los
 * replays de sus dificultades, mejores y recientes (T-055, T-044, T-065). Un record solo se conserva si OTRA cancion de la
 * biblioteca tiene una dificultad con el mismo hash (el mismo .osz importado
 * dos veces): ese record sigue valiendo para la que queda. No hace nada si el
 * id no existe.
 */
export async function borrarCancionDeLaBase(id: SongId): Promise<void> {
  const db = await abrirBaseDeDatos();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [
          NOMBRE_TIENDA_CANCIONES,
          NOMBRE_TIENDA_RECORDS,
          NOMBRE_TIENDA_REPLAYS,
          NOMBRE_TIENDA_RECIENTES,
        ],
        'readwrite',
      );
      const canciones = tx.objectStore(NOMBRE_TIENDA_CANCIONES);
      const records = tx.objectStore(NOMBRE_TIENDA_RECORDS);
      const replays = tx.objectStore(NOMBRE_TIENDA_REPLAYS);
      const recientes = tx.objectStore(NOMBRE_TIENDA_RECIENTES);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo borrar la canción.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se abortó el borrado de la canción.'));

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
          for (const clave of aBorrar) {
            records.delete(clave);
            replays.delete(clave);
            // T-065: tambien las partidas recientes de ese mapa, fijadas o no.
            const delMapa = recientes.index('hash').getAllKeys(clave);
            delMapa.onsuccess = () => {
              for (const id of delMapa.result) recientes.delete(id);
            };
          }
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
 *
 * T-044: con `replay`, si la partida es la nueva mejor su replay reemplaza al
 * que habia, en la misma transaccion (record y replay nunca quedan de partidas
 * distintas). Si es la nueva mejor y no trae replay, el viejo se borra: ya no
 * corresponde a la mejor partida. Si no mejoro, el replay guardado no se toca.
 *
 * T-065: con `replay`, la partida se guarda ademas entre las recientes (tienda
 * 'recientes'), mejore o no, en la misma transaccion.
 */
export async function guardarPartidaEnLaBase(
  hash: string,
  partida: PartidaJugada,
  replay?: Replay,
): Promise<{ record: RecordDeMapa; esMejor: boolean; anterior?: PartidaJugada }> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        [NOMBRE_TIENDA_RECORDS, NOMBRE_TIENDA_REPLAYS, NOMBRE_TIENDA_RECIENTES],
        'readwrite',
      );
      const tienda = tx.objectStore(NOMBRE_TIENDA_RECORDS);
      const replays = tx.objectStore(NOMBRE_TIENDA_REPLAYS);
      const recientes = tx.objectStore(NOMBRE_TIENDA_RECIENTES);
      let resultado:
        | { record: RecordDeMapa; esMejor: boolean; anterior?: PartidaJugada }
        | undefined;
      tx.oncomplete = () => {
        if (resultado) resolve(resultado);
        else reject(new Error('No se pudo guardar la partida.'));
      };
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar la partida.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se abortó el guardado de la partida.'));

      // T-065: toda partida completada con replay queda entre las recientes
      // (se purgan solas al abrir la app), mejore o no el record.
      if (replay !== undefined) {
        const reciente: ReplayRecienteGuardado = {
          id: idDeReplayReciente(hash, partida.fecha),
          hash,
          fecha: partida.fecha,
          texto: serializarReplay(replay),
          partida,
          fijado: false,
        };
        recientes.put(reciente);
      }

      const lectura = tienda.get(hash);
      lectura.onsuccess = () => {
        const previo = normalizarRecord(lectura.result);
        const record = combinarRecord(previo, hash, partida);
        tienda.put(record);
        const esMejor = record.mejor === partida;
        if (esMejor) {
          if (replay !== undefined) {
            const fila: ReplayGuardado = { hash, texto: serializarReplay(replay), fecha: partida.fecha };
            replays.put(fila);
          } else {
            replays.delete(hash);
          }
        }
        resultado = {
          record,
          esMejor,
          ...(previo !== undefined && { anterior: previo.mejor }),
        };
      };
    });
  } finally {
    db.close();
  }
}

/**
 * El replay de la mejor partida de un mapa, o `undefined` si no hay o esta
 * corrupto (texto que no se lee, hash que no coincide con la clave). `fecha` es
 * la de la partida. Nunca lanza por el contenido.
 */
export async function leerReplayDeLaBase(
  hash: string,
): Promise<{ replay: Replay; fecha: string } | undefined> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<{ replay: Replay; fecha: string } | undefined>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_REPLAYS, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA_REPLAYS).get(hash);
      peticion.onsuccess = () => {
        const fila = normalizarReplayGuardado(peticion.result);
        const replay = fila === undefined || fila.hash !== hash ? null : leerReplay(fila.texto);
        resolve(fila === undefined || replay === null ? undefined : { replay, fecha: fila.fecha });
      };
      peticion.onerror = () => reject(peticion.error ?? new Error('No se pudo leer el replay.'));
    });
  } finally {
    db.close();
  }
}

/** Los hashes de los mapas que tienen un replay guardado (solo las claves: no lee ningun replay). */
export async function listarHashesConReplayDeLaBase(): Promise<Set<string>> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<Set<string>>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_REPLAYS, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA_REPLAYS).getAllKeys();
      peticion.onsuccess = () =>
        resolve(new Set((peticion.result as IDBValidKey[]).filter((k) => typeof k === 'string')) as Set<string>);
      peticion.onerror = () =>
        reject(peticion.error ?? new Error('No se pudieron listar los replays.'));
    });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// T-065: partidas recientes
// ---------------------------------------------------------------------------

/**
 * Las partidas recientes de un mapa, de la mas nueva a la mas vieja. No lee ni
 * valida el texto de los replays (solo la forma de la fila): la lista es barata;
 * un replay roto se descubre al abrirlo. Las filas mal formadas se ignoran.
 */
export async function listarRecientesDeLaBase(hash: string): Promise<ResumenDeReciente[]> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<ResumenDeReciente[]>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_RECIENTES, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA_RECIENTES).index('hash').getAll(hash);
      peticion.onsuccess = () => {
        const filas: ResumenDeReciente[] = [];
        for (const crudo of peticion.result as unknown[]) {
          const fila = normalizarReplayReciente(crudo, false);
          if (fila === undefined) continue;
          filas.push({
            id: fila.id,
            hash: fila.hash,
            fecha: fila.fecha,
            partida: fila.partida,
            fijado: fila.fijado,
          });
        }
        filas.sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
        resolve(filas);
      };
      peticion.onerror = () =>
        reject(peticion.error ?? new Error('No se pudieron listar las partidas recientes.'));
    });
  } finally {
    db.close();
  }
}

/** El replay de una partida reciente, o `undefined` si no esta o no se puede leer (texto roto, hash que no coincide). Nunca lanza por el contenido. */
export async function leerReplayRecienteDeLaBase(
  id: string,
): Promise<{ replay: Replay; fecha: string } | undefined> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<{ replay: Replay; fecha: string } | undefined>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_RECIENTES, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA_RECIENTES).get(id);
      peticion.onsuccess = () => {
        const fila = normalizarReplayReciente(peticion.result);
        const replay = fila === undefined || fila.id !== id ? null : leerReplay(fila.texto);
        resolve(fila === undefined || replay === null ? undefined : { replay, fecha: fila.fecha });
      };
      peticion.onerror = () => reject(peticion.error ?? new Error('No se pudo leer el replay.'));
    });
  } finally {
    db.close();
  }
}

/** "Conservar": fija (o suelta) una partida reciente. `false` si la fila ya no existe (por ejemplo la purgo otra pestana). */
export async function fijarRecienteEnLaBase(id: string, fijado: boolean): Promise<boolean> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_RECIENTES, 'readwrite');
      const tienda = tx.objectStore(NOMBRE_TIENDA_RECIENTES);
      let encontrada = false;
      tx.oncomplete = () => resolve(encontrada);
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo conservar la partida.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se abortó el guardado de la partida.'));
      const lectura = tienda.get(id);
      lectura.onsuccess = () => {
        const fila = normalizarReplayReciente(lectura.result, false);
        if (fila === undefined) return;
        encontrada = true;
        tienda.put({ ...fila, fijado });
      };
    });
  } finally {
    db.close();
  }
}

/** Las partidas recientes fijadas, completas (para el respaldo). Las filas corruptas se ignoran. */
export async function listarRecientesFijadosDeLaBase(): Promise<ReplayRecienteGuardado[]> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<ReplayRecienteGuardado[]>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_RECIENTES, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA_RECIENTES).getAll();
      peticion.onsuccess = () => {
        const filas: ReplayRecienteGuardado[] = [];
        for (const crudo of peticion.result as unknown[]) {
          const fila = normalizarReplayReciente(crudo);
          if (fila !== undefined && fila.fijado) filas.push(fila);
        }
        resolve(filas);
      };
      peticion.onerror = () =>
        reject(peticion.error ?? new Error('No se pudieron listar las partidas recientes.'));
    });
  } finally {
    db.close();
  }
}

/**
 * Cuales de las filas (id, fecha, fijado) hay que borrar para dejar las
 * recientes como mandan las reglas de T-065. Pura, para testearla sin base: las
 * fijadas no se tocan; de las demas se van las de mas de `dias` dias (o con
 * fecha ilegible) y, de las que quedan, todas menos las `tope` mas nuevas.
 */
export function idsAPurgar(
  filas: readonly { id: string; fecha: string; fijado: boolean }[],
  ahoraMs: number,
  dias: number = DIAS_REPLAYS_RECIENTES,
  tope: number = TOPE_REPLAYS_RECIENTES,
): string[] {
  const limite = ahoraMs - dias * 24 * 60 * 60 * 1000;
  const aBorrar: string[] = [];
  const vigentes: { id: string; ms: number }[] = [];
  for (const fila of filas) {
    if (fila.fijado) continue;
    const ms = Date.parse(fila.fecha);
    if (!Number.isFinite(ms) || ms < limite) aBorrar.push(fila.id);
    else vigentes.push({ id: fila.id, ms });
  }
  vigentes.sort((a, b) => b.ms - a.ms);
  for (const sobrante of vigentes.slice(Math.max(0, tope))) aBorrar.push(sobrante.id);
  return aBorrar;
}

/**
 * Purga las partidas recientes (se llama al abrir la app): fuera las de mas de
 * `dias` dias y las que pasen del tope de `tope` mas nuevas; las fijadas se
 * conservan siempre y no cuentan para el tope. Una fila corrupta tambien se
 * borra (no sirve para nada). No toca 'replays': el de la mejor partida es
 * permanente. Devuelve cuantas borro.
 */
export async function purgarRecientesDeLaBase(
  ahoraMs: number = Date.now(),
  dias: number = DIAS_REPLAYS_RECIENTES,
  tope: number = TOPE_REPLAYS_RECIENTES,
): Promise<number> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_RECIENTES, 'readwrite');
      const tienda = tx.objectStore(NOMBRE_TIENDA_RECIENTES);
      let borradas = 0;
      tx.oncomplete = () => resolve(borradas);
      tx.onerror = () => reject(tx.error ?? new Error('No se pudieron purgar las partidas.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se abortó la purga de las partidas.'));

      const filas: { id: string; fecha: string; fijado: boolean }[] = [];
      const corruptas: IDBValidKey[] = [];
      const recorrido = tienda.openCursor();
      recorrido.onsuccess = () => {
        const cursor = recorrido.result;
        if (cursor !== null) {
          const fila = normalizarReplayReciente(cursor.value, false);
          if (fila === undefined) corruptas.push(cursor.primaryKey);
          else filas.push({ id: fila.id, fecha: fila.fecha, fijado: fila.fijado });
          cursor.continue();
          return;
        }
        for (const clave of corruptas) {
          tienda.delete(clave);
          borradas += 1;
        }
        for (const id of idsAPurgar(filas, ahoraMs, dias, tope)) {
          tienda.delete(id);
          borradas += 1;
        }
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
      tx.onerror = () => reject(tx.error ?? new Error('No se pudieron leer los récords.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se abortó la lectura de los récords.'));
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
      tx.onabort = () => reject(tx.error ?? new Error('Se abortó el guardado de la skin.'));
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
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar la dificultad en caché.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se abortó el guardado de la dificultad en caché.'));
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

/** Todos los records bien formados de la base (T-042, para el respaldo). Los registros corruptos se ignoran. */
export async function listarRecordsDeLaBase(): Promise<RecordDeMapa[]> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<RecordDeMapa[]>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_RECORDS, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA_RECORDS).getAll();
      peticion.onsuccess = () => {
        const records: RecordDeMapa[] = [];
        for (const crudo of peticion.result as unknown[]) {
          const record = normalizarRecord(crudo);
          if (record !== undefined) records.push(record);
        }
        resolve(records);
      };
      peticion.onerror = () =>
        reject(peticion.error ?? new Error('No se pudieron listar los récords.'));
    });
  } finally {
    db.close();
  }
}

/** Todos los replays bien formados de la base (T-044, para el respaldo). Los registros corruptos se ignoran. */
export async function listarReplaysDeLaBase(): Promise<ReplayGuardado[]> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<ReplayGuardado[]>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_REPLAYS, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA_REPLAYS).getAll();
      peticion.onsuccess = () => {
        const replays: ReplayGuardado[] = [];
        for (const crudo of peticion.result as unknown[]) {
          const fila = normalizarReplayGuardado(crudo);
          if (fila !== undefined) replays.push(fila);
        }
        resolve(replays);
      };
      peticion.onerror = () =>
        reject(peticion.error ?? new Error('No se pudieron listar los replays.'));
    });
  } finally {
    db.close();
  }
}

/**
 * Deja el historial en `tope` registros como maximo borrando los mas viejos
 * (las claves empiezan por la fecha, asi que las primeras son las mas
 * antiguas). Se pide dentro de la transaccion que acaba de escribir, despues
 * de sus escrituras: IndexedDB las ejecuta en orden, asi que el conteo ya las
 * incluye.
 */
function recortarHistorial(tienda: IDBObjectStore, tope: number): void {
  const conteo = tienda.count();
  conteo.onsuccess = () => {
    let exceso = conteo.result - tope;
    if (exceso <= 0) return;
    const recorrido = tienda.openCursor();
    recorrido.onsuccess = () => {
      const cursor = recorrido.result;
      if (cursor === null || exceso <= 0) return;
      cursor.delete();
      exceso -= 1;
      cursor.continue();
    };
  };
}

/**
 * Guarda el resumen de una partida completada (T-045). Si el historial pasa de
 * `tope` (por defecto `TOPE_HISTORIAL`, 2000), sale el mas viejo, en la misma
 * transaccion: nunca crece sin tope. Un registro con la misma fecha y mapa se
 * reemplaza (no se duplica).
 */
export async function guardarRegistroEnLaBase(
  registro: RegistroPartida,
  tope: number = TOPE_HISTORIAL,
): Promise<void> {
  const db = await abrirBaseDeDatos();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_HISTORIAL, 'readwrite');
      const tienda = tx.objectStore(NOMBRE_TIENDA_HISTORIAL);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar el historial.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se abortó el guardado del historial.'));
      tienda.put(registro, claveDeRegistroPartida(registro));
      recortarHistorial(tienda, tope);
    });
  } finally {
    db.close();
  }
}

/** Todo el historial bien formado, del mas viejo al mas nuevo. Los registros corruptos se ignoran; nunca lanza por el contenido. */
export async function listarHistorialDeLaBase(): Promise<RegistroPartida[]> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<RegistroPartida[]>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA_HISTORIAL, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA_HISTORIAL).getAll();
      peticion.onsuccess = () => {
        const registros: RegistroPartida[] = [];
        for (const crudo of peticion.result as unknown[]) {
          const registro = normalizarRegistroPartida(crudo);
          if (registro !== undefined) registros.push(registro);
        }
        resolve(registros);
      };
      peticion.onerror = () =>
        reject(peticion.error ?? new Error('No se pudo leer el historial.'));
    });
  } finally {
    db.close();
  }
}

/** Lo que se escribio (y lo que ya estaba) al restaurar un respaldo en la base. */
export interface ResultadoEscrituraRespaldo {
  cancionesNuevas: number;
  cancionesExistentes: number;
  skinsNuevas: number;
  skinsExistentes: number;
  recordsNuevos: number;
  recordsActualizados: number;
  /** T-044: replays que se escribieron (nuevos o en lugar de uno que ya no era de la mejor partida). */
  replaysNuevos: number;
  /** T-045: partidas del historial que no estaban (las que ya estaban, por fecha y mapa, no se tocan). */
  historialNuevo: number;
  /** T-065: partidas recientes fijadas que no estaban. */
  recientesNuevos: number;
}

/**
 * Escribe un respaldo en la base (T-042), todo en UNA transaccion sobre las
 * seis tiendas (canciones, skins, records, replays, historial y recientes): si algo falla a medias (cuota llena, por ejemplo) se aborta y
 * no queda nada escrito. Nunca pisa: una cancion o skin cuyo id ya existe se
 * deja como esta y se cuenta como existente. Los records se mezclan con
 * `mezclar(previo, entrante)`; si devuelve `undefined` no hay nada que
 * escribir (el que estaba ya era igual o mejor). Un record previo corrupto
 * cuenta como ausente (de todos modos no se podia leer).
 */
export async function restaurarEnLaBase(
  contenido: {
    canciones: CancionGuardada[];
    skins: SkinGuardada[];
    records: RecordDeMapa[];
    replays?: ReplayGuardado[];
    historial?: RegistroPartida[];
    recientes?: ReplayRecienteGuardado[];
  },
  mezclar: (previo: RecordDeMapa | undefined, entrante: RecordDeMapa) => RecordDeMapa | undefined,
): Promise<ResultadoEscrituraRespaldo> {
  const resultado: ResultadoEscrituraRespaldo = {
    cancionesNuevas: 0,
    cancionesExistentes: 0,
    skinsNuevas: 0,
    skinsExistentes: 0,
    recordsNuevos: 0,
    recordsActualizados: 0,
    replaysNuevos: 0,
    historialNuevo: 0,
    recientesNuevos: 0,
  };
  const db = await abrirBaseDeDatos();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [
          NOMBRE_TIENDA_CANCIONES,
          NOMBRE_TIENDA_SKINS,
          NOMBRE_TIENDA_RECORDS,
          NOMBRE_TIENDA_REPLAYS,
          NOMBRE_TIENDA_HISTORIAL,
          NOMBRE_TIENDA_RECIENTES,
        ],
        'readwrite',
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo restaurar el respaldo.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se abortó la restauración del respaldo.'));

      // Todas las lecturas se piden antes de que corra ninguna escritura, asi
      // que un id repetido dentro del mismo respaldo se resuelve de antemano:
      // el primero manda y los demas cuentan como existentes.
      const canciones = tx.objectStore(NOMBRE_TIENDA_CANCIONES);
      const idsCanciones = new Set<string>();
      for (const cancion of contenido.canciones) {
        if (idsCanciones.has(cancion.id)) {
          resultado.cancionesExistentes += 1;
          continue;
        }
        idsCanciones.add(cancion.id);
        const lectura = canciones.get(cancion.id);
        lectura.onsuccess = () => {
          if (lectura.result === undefined) {
            canciones.put(cancion);
            resultado.cancionesNuevas += 1;
          } else {
            resultado.cancionesExistentes += 1;
          }
        };
      }

      const skins = tx.objectStore(NOMBRE_TIENDA_SKINS);
      const idsSkins = new Set<string>();
      for (const skin of contenido.skins) {
        if (idsSkins.has(skin.id)) {
          resultado.skinsExistentes += 1;
          continue;
        }
        idsSkins.add(skin.id);
        const lectura = skins.get(skin.id);
        lectura.onsuccess = () => {
          if (lectura.result === undefined) {
            skins.put(skin);
            resultado.skinsNuevas += 1;
          } else {
            resultado.skinsExistentes += 1;
          }
        };
      }

      // Un hash repetido en el respaldo se mezcla de antemano en un solo record.
      const entrantes = new Map<string, RecordDeMapa>();
      for (const record of contenido.records) {
        const ya = entrantes.get(record.hash);
        entrantes.set(record.hash, ya === undefined ? record : (mezclar(ya, record) ?? ya));
      }
      const records = tx.objectStore(NOMBRE_TIENDA_RECORDS);
      const replays = tx.objectStore(NOMBRE_TIENDA_REPLAYS);
      // T-044: un replay solo vale si es el de la mejor partida del record
      // que queda (misma fecha). El primero de cada hash manda.
      const replaysEntrantes = new Map<string, ReplayGuardado>();
      for (const fila of contenido.replays ?? []) {
        if (!replaysEntrantes.has(fila.hash)) replaysEntrantes.set(fila.hash, fila);
      }
      for (const entrante of entrantes.values()) {
        const lectura = records.get(entrante.hash);
        lectura.onsuccess = () => {
          const previo = normalizarRecord(lectura.result);
          const nuevo = mezclar(previo, entrante);
          if (nuevo !== undefined) {
            records.put(nuevo);
            if (previo === undefined) resultado.recordsNuevos += 1;
            else resultado.recordsActualizados += 1;
          }
          const mejorFinal = (nuevo ?? previo)?.mejor;
          if (mejorFinal === undefined) return;
          const delRespaldo = replaysEntrantes.get(entrante.hash);
          const lecturaReplay = replays.get(entrante.hash);
          lecturaReplay.onsuccess = () => {
            const actual = normalizarReplayGuardado(lecturaReplay.result);
            if (actual !== undefined && actual.fecha === mejorFinal.fecha) return; // ya es el de la mejor
            if (delRespaldo !== undefined && delRespaldo.fecha === mejorFinal.fecha) {
              replays.put(delRespaldo);
              resultado.replaysNuevos += 1;
            } else if (lecturaReplay.result !== undefined) {
              // El que habia es de otra partida (o esta roto): ya no corresponde.
              replays.delete(entrante.hash);
            }
          };
        };
      }

      // T-065: las partidas recientes del respaldo (solo viajan las fijadas) se
      // agregan si no estaban. Si ya estaba pero sin fijar, queda fijada: quien
      // la fijo en el respaldo la queria conservar. Nada mas se pisa.
      const recientes = tx.objectStore(NOMBRE_TIENDA_RECIENTES);
      const recientesEntrantes = new Map<string, ReplayRecienteGuardado>();
      for (const fila of contenido.recientes ?? []) {
        if (!recientesEntrantes.has(fila.id)) recientesEntrantes.set(fila.id, fila);
      }
      for (const entrante of recientesEntrantes.values()) {
        const lectura = recientes.get(entrante.id);
        lectura.onsuccess = () => {
          const actual = normalizarReplayReciente(lectura.result);
          if (actual === undefined) {
            recientes.put(entrante);
            resultado.recientesNuevos += 1;
          } else if (entrante.fijado && !actual.fijado) {
            recientes.put({ ...actual, fijado: true });
          }
        };
      }

      // T-045: el historial se une por clave (fecha y mapa): una partida que ya
      // estaba no se duplica ni se cuenta, asi importar dos veces el mismo
      // respaldo no cambia nada. Si la union pasa del tope, se queda con las
      // mas nuevas (las claves ordenan por fecha): las que sobran no entran.
      const historial = tx.objectStore(NOMBRE_TIENDA_HISTORIAL);
      const historialEntrante = new Map<string, RegistroPartida>();
      for (const registro of contenido.historial ?? []) {
        const clave = claveDeRegistroPartida(registro);
        if (!historialEntrante.has(clave)) historialEntrante.set(clave, registro);
      }
      if (historialEntrante.size > 0) {
        const lecturaClaves = historial.getAllKeys();
        lecturaClaves.onsuccess = () => {
          const existentes = new Set(lecturaClaves.result.map(String));
          const todas = [...new Set([...existentes, ...historialEntrante.keys()])].sort();
          const sobrantes = new Set(todas.slice(0, Math.max(0, todas.length - TOPE_HISTORIAL)));
          for (const clave of sobrantes) {
            if (existentes.has(clave)) historial.delete(clave);
          }
          for (const [clave, registro] of historialEntrante) {
            if (existentes.has(clave) || sobrantes.has(clave)) continue;
            historial.put(registro, clave);
            resultado.historialNuevo += 1;
          }
        };
      }
    });
  } finally {
    db.close();
  }
  return resultado;
}
