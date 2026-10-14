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
  type RegistroPartida,
  type Replay,
} from '@tetra/core';
import { ponerDificultad, quitarDificultad } from './dificultades.js';
import { analizarOsz, esVideoReproducible, type Omitidas } from './osz.js';
import { ErrorDeImportacion } from './errores.js';
import {
  coincidenciaEnBiblioteca,
  combinarConExistente,
  planearFusiones,
} from './duplicados.js';
import { construirOsz, type EntradaOsz } from './osz-escritor.js';
import { extraerImagenesDeOsk } from './osk.js';
import {
  aplicarFusionesEnLaBase,
  esCancionVirtual,
  guardarCancion,
  leerMuestrasDeLaBase,
  limpiarMuestrasHuerfanasEnLaBase,
  listarCancionesDeLaBase,
  leerCancionDeLaBase,
  borrarCancionDeLaBase,
  guardarSkin,
  listarSkinsDeLaBase,
  guardarDificultadCacheada,
  leerDificultadCacheada,
  guardarPartidaEnLaBase,
  guardarRegistroEnLaBase,
  listarHistorialDeLaBase,
  leerRecordsDeLaBase,
  leerReplayDeLaBase,
  listarHashesConReplayDeLaBase,
  listarRecientesDeLaBase,
  leerReplayRecienteDeLaBase,
  fijarRecienteEnLaBase,
  purgarRecientesDeLaBase,
} from './db.js';
import type { SongId, CancionGuardada, SkinId, SkinGuardada } from './db.js';
import type { ResumenDeReciente } from './records-validacion.js';

export type {
  SongId,
  CancionGuardada,
  SkinId,
  SkinGuardada,
  DificultadCacheada,
  MuestraGuardada,
} from './db.js';
// T-066 (paso 3): una cancion es virtual si no tiene pista y si las muestras de su receta.
export { esCancionVirtual } from './db.js';
export type {
  ReplayGuardado,
  ReplayRecienteGuardado,
  ResumenDeReciente,
} from './records-validacion.js';
export { idDeReplayReciente } from './records-validacion.js';
// T-065: reglas de la purga de las partidas recientes.
export { DIAS_REPLAYS_RECIENTES, TOPE_REPLAYS_RECIENTES, idsAPurgar } from './db.js';
export type { MapaImportado, CancionImportada, Omitidas, AnalisisOsz } from './osz.js';
export { ErrorDeImportacion } from './errores.js';
export type { CodigoErrorImportacion } from './errores.js';
export type { PlanDeFusion } from './duplicados.js';
export { planearFusiones, combinarConExistente } from './duplicados.js';
export {
  elegirArchivoOsu,
  elegirArchivosOsu,
  mimeDesdeNombre,
  extraerMapaDeOsz,
  extraerCancionDeOsz,
  analizarOsz,
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

export type EstadoImportacion = 'nueva' | 'ya-estaba' | 'actualizada';

export interface CancionImportadaResumen {
  id: SongId;
  titulo: string;
  estado: EstadoImportacion;
  /** Dificultades agregadas a una cancion que ya estaba (0 si es nueva o ya-estaba). */
  dificultadesAgregadas: number;
  /** Dificultades reemplazadas por una version nueva del mismo BeatmapID. */
  dificultadesActualizadas: number;
  /** true si se completo un fondo o un video que la cancion existente no tenia. */
  archivosCompletados: boolean;
}

export interface ResultadoImportacion {
  /** En el orden de los grupos de agruparEnCanciones (un .osz comun da una). Nunca vacio: si no hay nada que importar, se lanza. */
  canciones: CancionImportadaResumen[];
  /** Title del set (el de la primera dificultad valida). */
  titulo: string;
  /** Lo que se dejo afuera sin hacer fallar la importacion. */
  omitidas: Omitidas;
  /** Avisos ya redactados, en el orden en que se generaron. */
  avisos: string[];
}

/** `QuotaExceededError` (el nombre cambia entre navegadores y fake-indexeddb, pero no el mensaje). */
function esErrorDeCuota(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { name?: unknown }).name === 'QuotaExceededError' ||
      (error as { code?: unknown }).code === 22)
  );
}

/** Todo lo que no sea un `ErrorDeImportacion` se envuelve: nunca sale otro tipo de error. */
function aErrorDeImportacion(error: unknown): ErrorDeImportacion {
  if (error instanceof ErrorDeImportacion) return error;
  if (esErrorDeCuota(error)) {
    return new ErrorDeImportacion(
      'sin-espacio',
      'No hay espacio para guardar la canción: el navegador llenó su cuota. Borrá canciones que no uses o exportá un respaldo y liberá espacio.',
      { cause: error },
    );
  }
  const detalle = error instanceof Error ? error.message : String(error);
  return new ErrorDeImportacion('base', `No se pudo guardar en la biblioteca: ${detalle}`, {
    cause: error,
  });
}

/**
 * Importa un archivo .osz con deduplicacion (T-066, D3): lo descomprime,
 * parsea todas las dificultades de mania 4K, las agrupa en canciones (un .osz
 * puede dar varias, T-066 D5) y, por cada una, si ya esta en la biblioteca
 * (comparte alguna clave de identidad con una existente) la combina con esa
 * en vez de duplicarla: conserva el id, agrega o actualiza dificultades y
 * completa fondo o video. Si no, crea una cancion nueva.
 *
 * Lanza `ErrorDeImportacion` si no queda ninguna cancion para importar;
 * nunca lanza otro tipo de error (cualquier otro se envuelve como `base`, o
 * `sin-espacio` si es `QuotaExceededError`). Un `Blob` suelto no se chequea
 * por extension; un `File` si.
 */
export async function importarArchivoOsz(archivo: Blob): Promise<ResultadoImportacion> {
  try {
    const { canciones: extraidas, titulo, omitidas, avisos } = await analizarOsz(archivo);
    // Se actualiza a medida que se guarda: dos grupos del mismo .osz no se
    // duplican entre si aunque compartan alguna dificultad.
    const biblioteca = await listarCancionesDeLaBase();
    const resumenes: CancionImportadaResumen[] = [];

    for (const extraido of extraidas) {
      const coincide = coincidenciaEnBiblioteca(extraido.dificultades, biblioteca);
      if (coincide === undefined) {
        const id = crearId();
        const nueva: CancionGuardada = {
          id,
          titulo: extraido.titulo,
          artista: extraido.artista,
          ...(extraido.conjunto !== undefined && { conjunto: extraido.conjunto }),
          ...(extraido.audio !== undefined && { audio: extraido.audio }),
          ...(extraido.keysounds !== undefined && { keysounds: extraido.keysounds }),
          // Los opcionales solo se agregan si existen: nada de claves en undefined.
          ...(extraido.background !== undefined && { background: extraido.background }),
          ...(extraido.video !== undefined && {
            video: extraido.video,
            videoOffset: extraido.videoOffset ?? 0,
          }),
          importadaEn: Date.now(),
          dificultades: extraido.dificultades,
        };
        // Cancion y muestras nuevas en UNA transaccion (las que ya estaban no se reescriben).
        await guardarCancion(nueva, extraido.muestras);
        biblioteca.push(nueva);
        resumenes.push({
          id,
          titulo: extraido.titulo,
          estado: 'nueva',
          dificultadesAgregadas: 0,
          dificultadesActualizadas: 0,
          archivosCompletados: false,
        });
      } else {
        const { cancion, resumen: cambios } = combinarConExistente(coincide, extraido);
        if (cambios.estado === 'actualizada') {
          await guardarCancion(cancion, extraido.muestras);
          biblioteca[biblioteca.indexOf(coincide)] = cancion;
        }
        resumenes.push({ id: coincide.id, titulo: coincide.titulo, ...cambios });
      }
    }

    // Pedir que el navegador no desaloje la biblioteca: no se espera ni se usa
    // el resultado (pedirAlmacenamientoPersistente nunca lanza).
    void pedirAlmacenamientoPersistente();
    return { canciones: resumenes, titulo, omitidas, avisos };
  } catch (error) {
    throw aErrorDeImportacion(error);
  }
}

/**
 * Compatibilidad (mapeador, tests): el id de la primera cancion de
 * `importarArchivoOsz`. Si el contenido ya estaba en la biblioteca, devuelve
 * el id de esa en vez de crear una copia.
 */
export async function importarOsz(archivo: Blob): Promise<SongId> {
  return (await importarArchivoOsz(archivo)).canciones[0]!.id;
}

export interface FusionDeDuplicados {
  sobreviviente: SongId;
  /** De la importacion mas nueva a la mas vieja (ver D4, offset por cancion). */
  absorbidas: SongId[];
}

/**
 * T-066 (D4): fusiona las canciones que ya estan duplicadas en la biblioteca
 * (las que comparten alguna clave de identidad). La sobreviviente conserva su
 * id y recibe las dificultades, el fondo y el video que le falten; las
 * absorbidas se borran sin tocar records, replays ni recientes. Idempotente:
 * devuelve las fusiones hechas (vacio si no habia duplicados). El offset por
 * cancion vive en localStorage (apps/web): quien llama lo migra con lo que
 * devuelve esto.
 */
export async function fusionarDuplicados(): Promise<FusionDeDuplicados[]> {
  const planes = planearFusiones(await listarCancionesDeLaBase());
  if (planes.length === 0) return [];
  await aplicarFusionesEnLaBase(planes);
  return planes.map((plan) => ({
    sobreviviente: plan.resultado.id,
    absorbidas: plan.absorbidas,
  }));
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

/**
 * T-066 (paso 3): los blobs de las muestras pedidas, por hash (el de
 * `CancionGuardada.keysounds`). Las que no estan no aparecen en el mapa.
 */
export function leerMuestras(hashes: readonly string[]): Promise<Map<string, Blob>> {
  return leerMuestrasDeLaBase(hashes);
}

/**
 * T-066 (paso 3): borra las muestras que ninguna cancion referencia (red de
 * seguridad de `borrarCancion`, que ya borra las propias). Devuelve cuantas borro.
 */
export function limpiarMuestrasHuerfanas(): Promise<number> {
  return limpiarMuestrasHuerfanasEnLaBase();
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
    throw new Error('La canción ya no está en la biblioteca: no se puede guardar la dificultad.');
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

/**
 * T-065: las partidas recientes de un mapa (todas las completadas en los ultimos
 * 7 dias, mas las fijadas), de la mas nueva a la mas vieja. Es barata: no lee los
 * replays. `hash` es `String(hashMapa(chart))`.
 */
export function listarPartidasRecientes(hash: string): Promise<ResumenDeReciente[]> {
  return listarRecientesDeLaBase(hash);
}

/** T-065: el replay de una partida reciente (por su `id`) y su fecha. `undefined` si ya no esta o esta corrupto. */
export function leerReplayReciente(
  id: string,
): Promise<{ replay: Replay; fecha: string } | undefined> {
  return leerReplayRecienteDeLaBase(id);
}

/** T-065: "Conservar". Fija una partida reciente para que la purga no la borre (o la suelta con `false`). `false` si ya no existe. */
export function conservarPartidaReciente(id: string, fijado = true): Promise<boolean> {
  return fijarRecienteEnLaBase(id, fijado);
}

/**
 * T-065: purga las partidas recientes al abrir la app: fuera las de mas de 7
 * dias y las que pasen de las 200 mas nuevas; las fijadas no se tocan y el replay
 * de la mejor partida (tienda aparte) tampoco. Devuelve cuantas borro.
 */
export function purgarReplaysRecientes(ahoraMs?: number): Promise<number> {
  return purgarRecientesDeLaBase(ahoraMs);
}

/**
 * T-045: guarda el resumen de una partida completada en el historial. Con mas
 * de 2000 sale la mas vieja (el historial no crece sin tope). No depende de la
 * cancion: borrarla de la biblioteca no toca el historial.
 */
export function guardarEnHistorial(registro: RegistroPartida): Promise<void> {
  return guardarRegistroEnLaBase(registro);
}

/** T-045: todo el historial, de la partida mas vieja a la mas nueva. Un registro corrupto se ignora; nunca lanza por el contenido. */
export function leerHistorial(): Promise<RegistroPartida[]> {
  return listarHistorialDeLaBase();
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
    throw new Error('La canción ya no está en la biblioteca: no se puede exportar.');
  }
  const primera = cancion.dificultades[0];
  if (primera === undefined) {
    throw new Error('La canción no tiene dificultades: no se puede exportar.');
  }

  // T-066 (paso 3, D11): una cancion virtual exporta sus muestras con su nombre
  // normalizado y cada .osu con `AudioFilename: virtual` (escribirOsu escribe la
  // receta como lineas Sample y las notas sin keysound).
  const virtual = esCancionVirtual(cancion);
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
    const metadata = { ...chart.metadata, audioFile: virtual ? 'virtual' : audioNombre };
    if (nombreFondo !== undefined) metadata.backgroundFile = nombreFondo;
    if (nombreVideo !== undefined) metadata.videoFile = nombreVideo;
    return { version: chart.metadata.difficultyName, texto: escribirOsu({ ...chart, metadata }) };
  });

  let pista: { audioNombre: string; audio: Uint8Array } | { muestras: { nombre: string; bytes: Uint8Array }[] };
  if (virtual) {
    const keysounds = cancion.keysounds ?? {};
    const blobs = await leerMuestrasDeLaBase(Object.values(keysounds));
    const muestras: { nombre: string; bytes: Uint8Array }[] = [];
    for (const [nombre, hash] of Object.entries(keysounds)) {
      const blob = blobs.get(hash);
      if (blob !== undefined) muestras.push({ nombre, bytes: await bytesDe(blob) });
    }
    pista = { muestras };
  } else if (cancion.audio !== undefined) {
    pista = { audioNombre, audio: await bytesDe(cancion.audio) };
  } else {
    throw new Error('La canción no tiene audio: no se puede exportar.');
  }

  const osz = construirOsz({
    titulo: cancion.titulo,
    artista: cancion.artista,
    creador: primera.metadata.creator,
    ...pista,
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
