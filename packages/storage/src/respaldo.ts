// T-042: copia de seguridad de la biblioteca. Todo lo de Tetra vive en
// IndexedDB y localStorage del navegador; limpiar los datos del sitio o
// cambiar de computadora lo borra. Esto arma un zip con todo y lo vuelve a
// leer.
//
// Formato del zip:
//
//   manifest.json                     metadatos en JSON (ver ManifestRespaldo)
//   canciones/<n>/audio.<ext>         los Blob viajan como archivos, nunca en
//   canciones/<n>/fondo.<ext>         el JSON (JSON.stringify de un Blob da
//   canciones/<n>/video.<ext>         `{}` y se perderia el audio en silencio)
//   skins/<n>/<clave>.<ext>
//
// El manifest dice, por cada Blob, en que archivo del zip esta y que tipo
// MIME tenia. Las rutas del zip se arman con indices, no con los ids ni los
// nombres del usuario, asi que nada de lo que venga en un respaldo puede
// escribir fuera de lugar.
//
// Los archivos binarios van sin comprimir (nivel 0): audio, imagenes y video
// ya vienen comprimidos y deflate no les gana nada mas que tiempo.

import { strToU8, unzipSync, zipSync, type Unzipped, type Zippable } from 'fflate';
import type { Chart, RecordDeMapa } from '@tetra/core';
import {
  listarCancionesDeLaBase,
  listarRecordsDeLaBase,
  listarSkinsDeLaBase,
  restaurarEnLaBase,
} from './db.js';
import type { CancionGuardada, SkinGuardada } from './db.js';
import { CLAVES_IMAGENES_SKIN, type ImagenesDeSkin } from './osk.js';
import { normalizarRecord } from './records-validacion.js';

const FORMATO = 'tetra-respaldo';
const VERSION_ACTUAL = 1;
const PREFIJO_AJUSTES = 'tetra:';
/**
 * Claves de localStorage que no viajan: `tetra:mudo` es un interruptor de la
 * maquina (restaurar el de otra computadora podria dejar sin sonido a quien
 * no lo pidio) y `tetra:presentacion` es el modo del momento, no una preferencia.
 */
const AJUSTES_EXCLUIDOS: ReadonlySet<string> = new Set(['tetra:mudo', 'tetra:presentacion']);

export interface ContenidoRespaldo {
  version: 1;
  /** Canciones con audio y portada como bytes, listas para serializar a zip. */
  canciones: CancionGuardada[];
  skins: SkinGuardada[];
  /** T-055: tienda 'records' de la base version 5. */
  records: RecordDeMapa[];
  /** Claves 'tetra:*' de localStorage. */
  ajustes: Record<string, string>;
}

/** Lo que paso al restaurar. Los `*Existentes` no se tocaron. */
export interface ResumenRestauracion {
  cancionesNuevas: number;
  cancionesExistentes: number;
  skinsNuevas: number;
  skinsExistentes: number;
  recordsNuevos: number;
  /** Records que ya existian y mejoraron con los del respaldo. */
  recordsActualizados: number;
  /** Claves de localStorage escritas (0 si no se pidio sobrescribir). */
  ajustesRestaurados: number;
}

/** Un respaldo que no sirve (no es un zip, no es de Tetra, version futura, incompleto). El mensaje se puede mostrar tal cual. */
export class ErrorDeRespaldo extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDeRespaldo';
  }
}

// ---------------------------------------------------------------------------
// Forma del manifest
// ---------------------------------------------------------------------------

interface ArchivoRef {
  archivo: string;
  tipo: string;
}

interface CancionManifest {
  id: string;
  titulo: string;
  artista: string;
  videoOffset?: number;
  importadaEn?: number;
  dificultades: Chart[];
  audio: ArchivoRef;
  fondo?: ArchivoRef;
  video?: ArchivoRef;
}

interface SkinManifest {
  id: string;
  nombre: string;
  imagenes: Partial<Record<string, ArchivoRef>>;
}

interface ManifestRespaldo {
  formato: typeof FORMATO;
  version: number;
  creadoEn: string;
  canciones: CancionManifest[];
  skins: SkinManifest[];
  records: RecordDeMapa[];
  ajustes: Record<string, string>;
}

const EXTENSION_POR_TIPO: Readonly<Record<string, string>> = {
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

function extensionDeTipo(tipo: string): string {
  return EXTENSION_POR_TIPO[tipo] ?? 'bin';
}

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------

/** Arma un zip: manifest.json con los metadatos y los blobs como archivos. */
export async function exportarRespaldo(c: ContenidoRespaldo): Promise<Blob> {
  const archivos: Zippable = {};

  /** Mete el Blob en el zip bajo `ruta` (mas la extension por su tipo) y devuelve la referencia para el manifest. */
  async function agregar(rutaSinExtension: string, blob: Blob): Promise<ArchivoRef> {
    const archivo = `${rutaSinExtension}.${extensionDeTipo(blob.type)}`;
    archivos[archivo] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    return { archivo, tipo: blob.type };
  }

  const canciones: CancionManifest[] = [];
  for (const [i, cancion] of c.canciones.entries()) {
    const base = `canciones/${i}`;
    canciones.push({
      id: cancion.id,
      titulo: cancion.titulo,
      artista: cancion.artista,
      ...(cancion.videoOffset !== undefined && { videoOffset: cancion.videoOffset }),
      ...(cancion.importadaEn !== undefined && { importadaEn: cancion.importadaEn }),
      dificultades: cancion.dificultades,
      audio: await agregar(`${base}/audio`, cancion.audio),
      ...(cancion.background !== undefined && {
        fondo: await agregar(`${base}/fondo`, cancion.background),
      }),
      ...(cancion.video !== undefined && { video: await agregar(`${base}/video`, cancion.video) }),
    });
  }

  const skins: SkinManifest[] = [];
  for (const [i, skin] of c.skins.entries()) {
    const imagenes: Partial<Record<string, ArchivoRef>> = {};
    for (const clave of CLAVES_IMAGENES_SKIN) {
      const blob = skin.imagenes[clave];
      if (blob !== undefined) imagenes[clave] = await agregar(`skins/${i}/${clave}`, blob);
    }
    skins.push({ id: skin.id, nombre: skin.nombre, imagenes });
  }

  const manifest: ManifestRespaldo = {
    formato: FORMATO,
    version: c.version,
    creadoEn: new Date().toISOString(),
    canciones,
    skins,
    records: c.records,
    ajustes: c.ajustes,
  };
  archivos['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  return new Blob([new Uint8Array(zipSync(archivos))], { type: 'application/zip' });
}

// ---------------------------------------------------------------------------
// Leer
// ---------------------------------------------------------------------------

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esNumeroFinito(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function esTexto(valor: unknown): valor is string {
  return typeof valor === 'string';
}

/** Forma minima de una dificultad: lo que el juego da por hecho al leerla. Lo de adentro (orden de notas, etc.) lo garantizo el parser al guardarla. */
function esChartValido(valor: unknown): valor is Chart {
  if (!esObjeto(valor)) return false;
  const { metadata, overallDifficulty, hpDrain, timingPoints, speedPoints, notes } = valor;
  if (!esObjeto(metadata)) return false;
  for (const campo of ['title', 'artist', 'creator', 'difficultyName', 'audioFile'] as const) {
    if (!esTexto(metadata[campo])) return false;
  }
  if (!esNumeroFinito(metadata['previewTime'])) return false;
  if (!esNumeroFinito(overallDifficulty) || !esNumeroFinito(hpDrain)) return false;
  if (!Array.isArray(timingPoints) || !Array.isArray(speedPoints) || !Array.isArray(notes)) {
    return false;
  }
  for (const punto of timingPoints as unknown[]) {
    if (!esObjeto(punto)) return false;
    if (!esNumeroFinito(punto['time']) || !esNumeroFinito(punto['bpm'])) return false;
    if (!esNumeroFinito(punto['meter'])) return false;
  }
  for (const punto of speedPoints as unknown[]) {
    if (!esObjeto(punto)) return false;
    if (!esNumeroFinito(punto['time']) || !esNumeroFinito(punto['multiplier'])) return false;
  }
  for (const nota of notes as unknown[]) {
    if (!esObjeto(nota)) return false;
    if (nota['kind'] !== 'tap' && nota['kind'] !== 'hold') return false;
    if (!esNumeroFinito(nota['time'])) return false;
    const columna = nota['column'];
    if (!Number.isInteger(columna) || (columna as number) < 0 || (columna as number) > 3) {
      return false;
    }
    if (nota['kind'] === 'hold' && !esNumeroFinito(nota['endTime'])) return false;
  }
  return true;
}

/** Los bytes de un archivo del zip como Blob, o un ErrorDeRespaldo si el manifest apunta a algo que no esta. */
function blobDeReferencia(archivos: Unzipped, ref: unknown, quien: string): Blob {
  if (!esObjeto(ref) || !esTexto(ref['archivo']) || !esTexto(ref['tipo'])) {
    throw new ErrorDeRespaldo(`El respaldo esta danado: ${quien} no indica su archivo.`);
  }
  const bytes = Object.hasOwn(archivos, ref['archivo']) ? archivos[ref['archivo']] : undefined;
  if (bytes === undefined) {
    throw new ErrorDeRespaldo(`El respaldo esta incompleto: falta ${ref['archivo']} (${quien}).`);
  }
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ref['tipo'] });
}

function leerCancion(archivos: Unzipped, crudo: unknown, indice: number): CancionGuardada {
  const dado = `la cancion ${indice + 1}`;
  if (!esObjeto(crudo)) throw new ErrorDeRespaldo(`El respaldo esta danado: ${dado} no es valida.`);
  const { id, titulo, artista, dificultades } = crudo;
  if (!esTexto(id) || id === '' || !esTexto(titulo) || !esTexto(artista)) {
    throw new ErrorDeRespaldo(`El respaldo esta danado: ${dado} no tiene id, titulo o artista.`);
  }
  const nombre = `"${titulo}"`;
  if (!Array.isArray(dificultades) || dificultades.length === 0) {
    throw new ErrorDeRespaldo(`El respaldo esta danado: ${nombre} no tiene dificultades.`);
  }
  if (!(dificultades as unknown[]).every(esChartValido)) {
    throw new ErrorDeRespaldo(`El respaldo esta danado: ${nombre} tiene una dificultad invalida.`);
  }
  const videoOffset = crudo['videoOffset'];
  const importadaEn = crudo['importadaEn'];
  return {
    id,
    titulo,
    artista,
    audio: blobDeReferencia(archivos, crudo['audio'], `audio de ${nombre}`),
    ...(crudo['fondo'] !== undefined && {
      background: blobDeReferencia(archivos, crudo['fondo'], `fondo de ${nombre}`),
    }),
    ...(crudo['video'] !== undefined && {
      video: blobDeReferencia(archivos, crudo['video'], `video de ${nombre}`),
    }),
    ...(esNumeroFinito(videoOffset) && { videoOffset }),
    ...(esNumeroFinito(importadaEn) && { importadaEn }),
    dificultades: dificultades as Chart[],
  };
}

function leerSkin(archivos: Unzipped, crudo: unknown, indice: number): SkinGuardada {
  if (!esObjeto(crudo)) {
    throw new ErrorDeRespaldo(`El respaldo esta danado: la skin ${indice + 1} no es valida.`);
  }
  const { id, nombre, imagenes } = crudo;
  if (!esTexto(id) || id === '' || !esTexto(nombre) || !esObjeto(imagenes)) {
    throw new ErrorDeRespaldo(`El respaldo esta danado: la skin ${indice + 1} esta incompleta.`);
  }
  const resultado: ImagenesDeSkin = {};
  for (const clave of CLAVES_IMAGENES_SKIN) {
    if (imagenes[clave] === undefined) continue;
    resultado[clave] = blobDeReferencia(archivos, imagenes[clave], `${clave} de la skin "${nombre}"`);
  }
  return { id, nombre, imagenes: resultado };
}

/** Solo viajan claves 'tetra:*' con valor de texto y que no esten excluidas: nada ajeno entra a localStorage. */
function esAjusteRestaurable(clave: string, valor: unknown): valor is string {
  return clave.startsWith(PREFIJO_AJUSTES) && !AJUSTES_EXCLUIDOS.has(clave) && esTexto(valor);
}

/**
 * Lee un zip de respaldo y valida version y forma. Rechaza con un
 * `ErrorDeRespaldo` (mensaje claro) si no sirve; no toca nada de lo existente.
 */
export async function leerRespaldo(zip: Blob): Promise<ContenidoRespaldo> {
  let archivos: Unzipped;
  try {
    archivos = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  } catch {
    throw new ErrorDeRespaldo('El archivo no es un zip valido: no es un respaldo de Tetra.');
  }
  const bytesManifest = Object.hasOwn(archivos, 'manifest.json') ? archivos['manifest.json'] : undefined;
  if (bytesManifest === undefined) {
    throw new ErrorDeRespaldo('El zip no trae manifest.json: no es un respaldo de Tetra.');
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytesManifest));
  } catch {
    throw new ErrorDeRespaldo('El manifest.json del respaldo esta danado.');
  }
  if (!esObjeto(manifest) || manifest['formato'] !== FORMATO) {
    throw new ErrorDeRespaldo('El zip no es un respaldo de Tetra.');
  }
  const version = manifest['version'];
  if (typeof version === 'number' && Number.isInteger(version) && version > VERSION_ACTUAL) {
    throw new ErrorDeRespaldo(
      `El respaldo es de una version mas nueva de Tetra (formato ${version}); esta version lee hasta el formato ${VERSION_ACTUAL}. Actualiza Tetra para restaurarlo.`,
    );
  }
  if (version !== VERSION_ACTUAL) {
    throw new ErrorDeRespaldo('La version del respaldo no se reconoce.');
  }

  const { canciones, skins, records, ajustes } = manifest;
  if (!Array.isArray(canciones) || !Array.isArray(skins) || !Array.isArray(records)) {
    throw new ErrorDeRespaldo('El respaldo esta danado: faltan canciones, skins o records.');
  }
  if (!esObjeto(ajustes)) {
    throw new ErrorDeRespaldo('El respaldo esta danado: faltan los ajustes.');
  }

  // Un record que no se puede rescatar se descarta (igual que al leerlo de la
  // base): es un dato accesorio y no vale rechazar toda la biblioteca por el.
  const recordsValidos: RecordDeMapa[] = [];
  for (const crudo of records as unknown[]) {
    const record = normalizarRecord(crudo);
    if (record !== undefined) recordsValidos.push(record);
  }
  const ajustesValidos: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(ajustes)) {
    if (esAjusteRestaurable(clave, valor)) ajustesValidos[clave] = valor;
  }

  return {
    version: VERSION_ACTUAL,
    canciones: (canciones as unknown[]).map((c, i) => leerCancion(archivos, c, i)),
    skins: (skins as unknown[]).map((s, i) => leerSkin(archivos, s, i)),
    records: recordsValidos,
    ajustes: ajustesValidos,
  };
}

// ---------------------------------------------------------------------------
// Restaurar
// ---------------------------------------------------------------------------

/**
 * Mezcla un record del respaldo con el que ya hay para ese mapa. Mejor: gana
 * el de mayor score (empate, mayor precision; empate total, el que ya estaba).
 * Ultima: la de fecha mas reciente. Intentos: el mayor de los dos (sumar haria
 * crecer el numero al importar dos veces el mismo respaldo). Devuelve
 * `undefined` si el que estaba ya lo cubre todo (nada que escribir).
 */
export function mezclarRecords(
  previo: RecordDeMapa | undefined,
  entrante: RecordDeMapa,
): RecordDeMapa | undefined {
  if (previo === undefined) return entrante;
  const mejorEntrante =
    entrante.mejor.score !== previo.mejor.score
      ? entrante.mejor.score > previo.mejor.score
      : entrante.mejor.accuracy > previo.mejor.accuracy;
  const mejor = mejorEntrante ? entrante.mejor : previo.mejor;
  const ultima =
    Date.parse(entrante.ultima.fecha) > Date.parse(previo.ultima.fecha)
      ? entrante.ultima
      : previo.ultima;
  const intentos = Math.max(previo.intentos, entrante.intentos);
  if (mejor === previo.mejor && ultima === previo.ultima && intentos === previo.intentos) {
    return undefined;
  }
  return { hash: previo.hash, mejor, ultima, intentos };
}

/**
 * Combina con lo existente: canciones y skins por id (si el id ya esta, no se
 * toca ni se duplica), records mezclados (ver `mezclarRecords`) y ajustes solo
 * si el usuario lo pide. Lo de la base se escribe en una sola transaccion: o
 * entra todo o no entra nada. Los ajustes se escriben despues, asi que si la
 * base falla no se tocan.
 */
export async function restaurarRespaldo(
  c: ContenidoRespaldo,
  opciones: { sobrescribirAjustes: boolean },
): Promise<ResumenRestauracion> {
  const escrito = await restaurarEnLaBase(c, mezclarRecords);
  let ajustesRestaurados = 0;
  if (opciones.sobrescribirAjustes) {
    for (const [clave, valor] of Object.entries(c.ajustes)) {
      if (!esAjusteRestaurable(clave, valor)) continue;
      try {
        localStorage.setItem(clave, valor);
        ajustesRestaurados += 1;
      } catch {
        // sin localStorage o sin cuota: esa clave no se restaura.
      }
    }
  }
  return { ...escrito, ajustesRestaurados };
}

// ---------------------------------------------------------------------------
// Reunir lo que hay ahora
// ---------------------------------------------------------------------------

/** Las claves 'tetra:*' de localStorage de ahora (vacio si localStorage no esta disponible). */
export function leerAjustesLocales(): Record<string, string> {
  const ajustes: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (clave === null) continue;
      const valor = localStorage.getItem(clave);
      if (esAjusteRestaurable(clave, valor)) ajustes[clave] = valor;
    }
  } catch {
    // sin localStorage: el respaldo va sin ajustes.
  }
  return ajustes;
}

/** Todo lo que hay ahora en la base y en localStorage, listo para `exportarRespaldo`. */
export async function reunirContenidoActual(): Promise<ContenidoRespaldo> {
  return {
    version: VERSION_ACTUAL,
    canciones: await listarCancionesDeLaBase(),
    skins: await listarSkinsDeLaBase(),
    records: await listarRecordsDeLaBase(),
    ajustes: leerAjustesLocales(),
  };
}

/** El zip de respaldo de todo lo que hay ahora. */
export async function crearRespaldo(): Promise<Blob> {
  return exportarRespaldo(await reunirContenidoActual());
}
