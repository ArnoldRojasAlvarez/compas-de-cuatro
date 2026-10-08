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

import {
  escribirOsu,
  type Chart,
  type DifficultyResult,
  type PartidaJugada,
  type RecordDeMapa,
  type Replay,
} from '@tetra/core';
import { ponerDificultad, quitarDificultad } from './dificultades.js';
import { esVideoReproducible, extraerCancionDeOsz } from './osz.js';
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
  guardarPartidaEnLaBase,
  leerRecordsDeLaBase,
  leerReplayDeLaBase,
  listarHashesConReplayDeLaBase,
} from './db.js';
import type { SongId, CancionGuardada, SkinId, SkinGuardada } from './db.js';

export type { SongId, CancionGuardada, SkinId, SkinGuardada, DificultadCacheada } from './db.js';
export type { ReplayGuardado } from './records-validacion.js';
export type { MapaImportado, CancionImportada } from './osz.js';
export {
  elegirArchivoOsu,
  elegirArchivosOsu,
  mimeDesdeNombre,
  extraerMapaDeOsz,
  extraerCancionDeOsz,
} from './osz.js';
export type { DificultadParaOsz, EntradaOsz } from './osz-escritor.js';
export { construirOsz, nombreDeOsu, nombreSeguro } from './osz-escritor.js';
export type { ClaveImagenSkin, ImagenesDeSkin } from './osk.js';
export { ubicarImagenesDeSkin, extraerImagenesDeOsk } from './osk.js';
// T-042: copia de seguridad (zip con manifest.json y los Blob como archivos).
export type { ContenidoRespaldo, ResumenRestauracion } from './respaldo.js';
export {
  ErrorDeRespaldo,
  crearRespaldo,
  exportarRespaldo,
  leerAjustesLocales,
  leerRespaldo,
  mezclarRecords,
  reunirContenidoActual,
  restaurarRespaldo,
} from './respaldo.js';

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
  const cancion: CancionGuardada = {
    id,
    titulo: extraido.titulo,
    artista: extraido.artista,
    audio: extraido.audio,
    // Los opcionales solo se agregan si existen: nada de claves en undefined.
    ...(extraido.background !== undefined && { background: extraido.background }),
    ...(extraido.video !== undefined && {
      video: extraido.video,
      videoOffset: extraido.videoOffset ?? 0,
    }),
    importadaEn: Date.now(),
    dificultades: extraido.dificultades,
  };
  await guardarCancion(cancion);
  // Pedir que el navegador no desaloje la biblioteca: no se espera ni se usa
  // el resultado (pedirAlmacenamientoPersistente nunca lanza).
  void pedirAlmacenamientoPersistente();
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

/** Borra una cancion de la biblioteca (con todas sus dificultades, audio, fondo, video y los records de sus dificultades). No hace nada si el id no existe. */
export function borrarCancion(id: SongId): Promise<void> {
  return borrarCancionDeLaBase(id);
}

/**
 * Guarda una partida terminada (T-055): conserva la mejor, guarda la ultima y
 * cuenta un intento mas. `hash` es `String(hashMapa(chart))`. `esMejor` dice si
 * esta partida paso a ser el record; `anterior` es el mejor que habia (ausente
 * en la primera partida del mapa).
 *
 * T-044: con `replay`, el replay de la partida pasa a ser el de la mejor solo si
 * la partida es la nueva mejor (misma transaccion); si no, el guardado se queda.
 */
export function guardarPartida(
  hash: string,
  partida: PartidaJugada,
  replay?: Replay,
): Promise<{ record: RecordDeMapa; esMejor: boolean; anterior?: PartidaJugada }> {
  return guardarPartidaEnLaBase(hash, partida, replay);
}

/** T-044: el replay de la mejor partida de un mapa y la fecha de esa partida. `undefined` si no hay o esta corrupto. */
export function leerReplayGuardado(
  hash: string,
): Promise<{ replay: Replay; fecha: string } | undefined> {
  return leerReplayDeLaBase(hash);
}

/** T-044: los hashes de los mapas con replay guardado (solo claves, no lee los replays). */
export function hashesConReplay(): Promise<Set<string>> {
  return listarHashesConReplayDeLaBase();
}

/** Records de varios mapas de una vez, por hash. Un registro corrupto no aparece; nunca lanza por su contenido. */
export function leerRecords(hashes: readonly string[]): Promise<Map<string, RecordDeMapa>> {
  return leerRecordsDeLaBase(hashes);
}

async function bytesDe(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Arma de nuevo un .osz con todo lo guardado: el audio, el fondo y el video
 * (si existen) y un .osu por dificultad. Reimportar el resultado da la misma
 * cancion (mismo titulo, mismas dificultades, mismas notas).
 *
 * El audio va con el nombre de `dificultades[0].metadata.audioFile`; el fondo
 * y el video, con el nombre que declara la primera dificultad que los
 * declare (el video, la primera con extension reproducible, el mismo
 * criterio que al importar). Para que el .osz quede coherente en osu!, a
 * todas las dificultades se les unifica la referencia al archivo que
 * efectivamente viaja en el zip (audio, y fondo/video si hay Blob). Si no
 * hay Blob de fondo o de video, los nombres declarados no se tocan.
 *
 * @throws {Error} si la cancion no existe.
 */
export async function exportarCancion(id: SongId): Promise<Blob> {
  const cancion = await leerCancionDeLaBase(id);
  if (!cancion) {
    throw new Error('La cancion ya no esta en la biblioteca: no se puede exportar.');
  }
  const primera = cancion.dificultades[0];
  if (primera === undefined) {
    throw new Error('La cancion no tiene dificultades: no se puede exportar.');
  }

  const audioNombre = primera.metadata.audioFile;
  const nombreFondo =
    cancion.background === undefined
      ? undefined
      : cancion.dificultades.find((d) => d.metadata.backgroundFile !== undefined)?.metadata
          .backgroundFile;
  const nombreVideo =
    cancion.video === undefined
      ? undefined
      : cancion.dificultades.find(
          (d) => d.metadata.videoFile !== undefined && esVideoReproducible(d.metadata.videoFile),
        )?.metadata.videoFile;

  const dificultades = cancion.dificultades.map((chart) => {
    const metadata = { ...chart.metadata, audioFile: audioNombre };
    if (nombreFondo !== undefined) metadata.backgroundFile = nombreFondo;
    if (nombreVideo !== undefined) metadata.videoFile = nombreVideo;
    return { version: chart.metadata.difficultyName, texto: escribirOsu({ ...chart, metadata }) };
  });

  const osz = construirOsz({
    titulo: cancion.titulo,
    artista: cancion.artista,
    creador: primera.metadata.creator,
    audioNombre,
    audio: await bytesDe(cancion.audio),
    ...(cancion.background !== undefined &&
      nombreFondo !== undefined && {
        fondo: { nombre: nombreFondo, bytes: await bytesDe(cancion.background) },
      }),
    ...(cancion.video !== undefined &&
      nombreVideo !== undefined && {
        video: { nombre: nombreVideo, bytes: await bytesDe(cancion.video) },
      }),
    dificultades,
  });
  return new Blob([new Uint8Array(osz)], { type: 'application/zip' });
}

/** Lo que hace falta de `navigator.storage`: lo demas del StorageManager no se usa. */
type AlmacenamientoDelNavegador = Partial<Pick<StorageManager, 'persist' | 'estimate'>>;

function almacenamientoDelNavegador(): AlmacenamientoDelNavegador | undefined {
  // `navigator` no existe en node (tests) ni `navigator.storage` en contextos
  // no seguros: por eso se lee como opcional aunque el tipo DOM no lo sea.
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as { storage?: AlmacenamientoDelNavegador }).storage;
}

/**
 * Pide al navegador que no desaloje el almacenamiento de la biblioteca
 * (`navigator.storage.persist()`). `false` si la API no existe, si el
 * navegador lo niega o si falla. Nunca lanza.
 */
export async function pedirAlmacenamientoPersistente(): Promise<boolean> {
  try {
    const almacenamiento = almacenamientoDelNavegador();
    if (almacenamiento?.persist === undefined) return false;
    return (await almacenamiento.persist()) === true;
  } catch {
    return false;
  }
}

/** Bytes usados y cuota (`navigator.storage.estimate`). `undefined` si no esta disponible o falla. */
export async function estimarAlmacenamiento(): Promise<{ usado: number; cuota: number } | undefined> {
  try {
    const almacenamiento = almacenamientoDelNavegador();
    if (almacenamiento?.estimate === undefined) return undefined;
    const { usage, quota } = await almacenamiento.estimate();
    if (usage === undefined || quota === undefined) return undefined;
    return { usado: usage, cuota: quota };
  } catch {
    return undefined;
  }
}
