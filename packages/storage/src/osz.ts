// T-005: descomprime un .osz, parsea el .osu que trae adentro con
// parseOsu (core, funcion pura) y arma los Blob de audio y portada listos
// para guardar. Vive fuera de core (ver CLAUDE.md, "core no toca el
// navegador", y docs/tickets/T-005-importador-osu.md, "La capa de
// navegador va aparte"): esta funcion sí lee bytes de un archivo real y
// construye Blob, dos cosas que packages/core tiene prohibidas.
//
// Decision de la libreria de descompresion: fflate en vez de
// DecompressionStream nativo del navegador. DecompressionStream solo sabe
// descomprimir un stream de bytes deflate/gzip suelto: no entiende el
// contenedor zip (directorio central, headers locales por entrada, un
// metodo de compresion propio por archivo que en un .osz puede venir
// mezclado STORE/DEFLATE). Para usarlo de todos modos habria que escribir a
// mano el parser del formato zip encima, que es justo lo que ya resuelve
// fflate (unzipSync) en una libreria chica (~8kB), pura, bien probada y sin
// dependencias propias. Ver tambien el ticket, seccion "La capa de
// navegador va aparte".

import { unzipSync, type Unzipped } from 'fflate';
import type { Chart, Ms } from '@tetra/core';
import type { GrupoDeCancion } from '@tetra/core';
import {
  agruparEnCanciones,
  leerCabeceraOsu,
  normalizarNombreDeMuestra,
  parseOsu,
} from '@tetra/core';
import { ErrorDeImportacion } from './errores.js';

const decodificadorUtf8 = new TextDecoder('utf-8');

/** Extensiones de video que el navegador reproduce en un <video>. Las demas (avi, flv, mpg, wmv) se ignoran. */
const EXTENSIONES_DE_VIDEO_REPRODUCIBLES: ReadonlySet<string> = new Set(['mp4', 'm4v', 'webm']);

function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf('.');
  return punto === -1 ? '' : nombre.slice(punto + 1).toLowerCase();
}

/** `true` si el navegador puede reproducir un video con ese nombre (por la extension). */
export function esVideoReproducible(nombre: string): boolean {
  return EXTENSIONES_DE_VIDEO_REPRODUCIBLES.has(extensionDe(nombre));
}

/**
 * Normaliza un nombre de archivo para compararlo: `\` pasa a `/`, se quita
 * el `./` inicial (las veces que haga falta) y se pasa a minusculas.
 */
function normalizarNombreDeZip(nombre: string): string {
  return nombre.replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();
}

/**
 * Busca un archivo en el zip por el nombre que declara el .osu. Primero
 * exacto; si no esta, compara normalizando (ver `normalizarNombreDeZip`),
 * porque un .osz real muchas veces trae `BG.JPG` y el .osu declara `bg.jpg`,
 * o declara la ruta con `\`. Devuelve `undefined` si no hay coincidencia.
 */
export function buscarEnZip(
  zip: Unzipped,
  nombre: string,
): Uint8Array<ArrayBuffer> | undefined {
  const exacto = zip[nombre];
  if (exacto !== undefined) return exacto;
  const buscado = normalizarNombreDeZip(nombre);
  for (const [clave, bytes] of Object.entries(zip)) {
    if (normalizarNombreDeZip(clave) === buscado) return bytes;
  }
  return undefined;
}

/**
 * Todos los nombres de archivo `.osu` de un `.osz`, en orden alfabetico
 * determinista (T-011, "Parte A": el song select necesita las N
 * dificultades de una cancion, no solo la primera). Insensible a
 * mayusculas/minusculas en la extension, igual que en osk.ts.
 */
export function elegirArchivosOsu(nombres: readonly string[]): string[] {
  return nombres.filter((nombre) => nombre.toLowerCase().endsWith('.osu')).sort();
}

/**
 * Elige, entre los nombres de archivo de un .osz, cual .osu importar.
 *
 * T-005 importaba una sola dificultad por llamada: se elegia la primera en
 * orden alfabetico para que el resultado fuera determinista (ver
 * `elegirArchivosOsu` arriba, de la que esta funcion es apenas el primer
 * elemento). T-011 agrega `extraerCancionDeOsz`, que si importa todas las
 * dificultades; esta funcion (y `extraerMapaDeOsz`, mas abajo) quedan tal
 * cual para no romper lo que ya las usaba. Devuelve `null` si no hay ningun
 * .osu en el zip.
 */
export function elegirArchivoOsu(nombres: readonly string[]): string | null {
  return elegirArchivosOsu(nombres)[0] ?? null;
}

/** Adivina el tipo MIME de un archivo a partir de su extension. */
export function mimeDesdeNombre(nombre: string): string {
  const punto = nombre.lastIndexOf('.');
  const ext = punto === -1 ? '' : nombre.slice(punto + 1).toLowerCase();
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
      return 'audio/ogg';
    case 'wav':
      return 'audio/wav';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    default:
      return 'application/octet-stream';
  }
}

/** Resultado de descomprimir y parsear un .osz, listo para guardar. */
export interface MapaImportado {
  chart: Chart;
  audio: Blob;
  background?: Blob;
}

/**
 * Descomprime un .osz, parsea el .osu elegido y arma el Blob de audio (y de
 * portada, si el parser llega a traer `backgroundFile`). No toca
 * IndexedDB: eso es responsabilidad de quien llama (ver index.ts), para
 * poder testear esta funcion sin depender de una base de datos.
 *
 * @throws {Error} si el zip no trae ningun .osu, si el .osu no parsea, o si
 * falta el archivo de audio que el .osu declara en AudioFilename.
 */
export async function extraerMapaDeOsz(archivo: Blob): Promise<MapaImportado> {
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const zip = unzipSync(bytes);
  const nombres = Object.keys(zip);

  const nombreOsu = elegirArchivoOsu(nombres);
  if (nombreOsu === null) {
    throw new Error('El .osz no contiene ningún archivo .osu.');
  }

  const textoOsu = decodificadorUtf8.decode(zip[nombreOsu]);
  const resultado = parseOsu(textoOsu);
  if (!resultado.ok) {
    throw new Error(`No se pudo parsear ${nombreOsu}: ${resultado.error}`);
  }
  const chart = resultado.chart;

  const bytesAudio = buscarEnZip(zip, chart.metadata.audioFile);
  if (bytesAudio === undefined) {
    throw new Error(
      `El .osz no trae el archivo de audio declarado en el .osu ` +
        `(AudioFilename:${chart.metadata.audioFile}).`,
    );
  }
  const audio = new Blob([bytesAudio], { type: mimeDesdeNombre(chart.metadata.audioFile) });

  // Desde T-049 parseOsu lee [Events], asi que backgroundFile viene seteado
  // cuando el .osu declara fondo. El video no se maneja aca: esta funcion
  // quedo para una sola dificultad y su firma no cambia (ver
  // extraerCancionDeOsz, que si lo extrae).
  const nombreFondo = chart.metadata.backgroundFile;
  const bytesFondo = nombreFondo === undefined ? undefined : buscarEnZip(zip, nombreFondo);
  if (bytesFondo === undefined) {
    return { chart, audio };
  }
  const background = new Blob([bytesFondo], { type: mimeDesdeNombre(nombreFondo!) });
  return { chart, audio, background };
}

/** Resultado de descomprimir y parsear un .osz completo (todas sus dificultades), listo para guardar como una cancion (T-011). */
export interface CancionImportada {
  titulo: string;
  artista: string;
  /** Title del set, solo si `titulo` es una pieza del set (T-066, D5). */
  conjunto?: string;
  /** Pista de musica. Ausente solo si la cancion es de audio virtual (T-066, paso 3). */
  audio?: Blob;
  /** Audio virtual: nombre normalizado de la muestra -> hash SHA-256 (hexadecimal) en `muestras`. */
  keysounds?: Record<string, string>;
  /** Audio virtual: los archivos de sonido de la cancion, por hash (cada uno una sola vez). */
  muestras?: Map<string, Blob>;
  background?: Blob;
  /** Solo si el .osz trae un video reproducible (mp4, m4v, webm) que alguna dificultad declara. */
  video?: Blob;
  /** ms; `videoOffset` de la dificultad que declaro el video (0 si no lo traia). */
  videoOffset?: Ms;
  /** Una entrada por cada .osu que parseo como mania 4K valido. Nunca vacio: ver el @throws de abajo. */
  dificultades: Chart[];
}

/** Lo que se dejo afuera de un .osz sin hacerlo fallar (T-066). */
export interface Omitidas {
  /** Dificultades con Mode distinto de 3. */
  otroModo: number;
  /** Dificultades de mania con otra cantidad de teclas, por teclas: { 7: 15, 10: 69 }. */
  otrasTeclas: Record<number, number>;
  /** Dificultades de mania 4K que no parsearon. */
  invalidas: number;
}

/**
 * Resultado de analizar un .osz: las canciones listas para guardar (una por
 * grupo, en el orden de `agruparEnCanciones`), el Title del set, lo omitido y
 * los avisos ya redactados.
 */
export interface AnalisisOsz {
  /** Nunca vacio: si no queda ninguna cancion, `analizarOsz` lanza. */
  canciones: CancionImportada[];
  /** Title del set (el de la primera dificultad valida). */
  titulo: string;
  omitidas: Omitidas;
  avisos: string[];
}

/** Tamano maximo de un .osz (T-066, tabla de errores). */
export const MAX_BYTES_OSZ = 300 * 1024 * 1024;
/** Limite del audio virtual (T-066, D9): ultimo evento de una dificultad. */
export const MAX_MS_AUDIO_VIRTUAL = 10 * 60 * 1000;
/** Limite del audio virtual (T-066, D9): eventos por dificultad. */
export const MAX_EVENTOS_AUDIO_VIRTUAL = 60_000;

const TEXTO_LIMITE_VIRTUAL = '10 minutos y 60 000 sonidos';

/** SHA-256 en hexadecimal (minusculas) de unos bytes. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const resumen = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(resumen, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** true si la dificultad virtual pasa del limite de eventos o de duracion (D9). */
function pasaElLimiteVirtual(chart: Chart): boolean {
  const eventos = chart.audioVirtual?.eventos ?? [];
  if (eventos.length > MAX_EVENTOS_AUDIO_VIRTUAL) return true;
  const ultimo = eventos[eventos.length - 1]; // ordenados por tiempo
  return ultimo !== undefined && ultimo.tiempo > MAX_MS_AUDIO_VIRTUAL;
}

/** `A`, `A y B`, `A, B y C`. */
function unirConY(partes: readonly string[]): string {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]!}`;
}

/** `5K (15), 7K (15) y 10K (69)`: por teclas ascendente, con la cantidad siempre. */
function listaDeTeclas(otrasTeclas: Record<number, number>): string {
  return unirConY(
    Object.entries(otrasTeclas)
      .map(([teclas, cantidad]) => ({ teclas: Number(teclas), cantidad }))
      .sort((a, b) => a.teclas - b.teclas)
      .map(({ teclas, cantidad }) => `${teclas}K (${cantidad})`),
  );
}

function avisosDeOmitidas(omitidas: Omitidas): string[] {
  const avisos: string[] = [];
  const otras = Object.values(omitidas.otrasTeclas).reduce((a, b) => a + b, 0);
  if (otras > 0) {
    const lista = listaDeTeclas(omitidas.otrasTeclas);
    avisos.push(
      otras === 1
        ? `Se omitió 1 dificultad de otras teclas: ${lista}.`
        : `Se omitieron ${otras} dificultades de otras teclas: ${lista}.`,
    );
  }
  if (omitidas.otroModo > 0) {
    avisos.push(
      omitidas.otroModo === 1
        ? 'Se omitió 1 dificultad que no es de osu!mania.'
        : `Se omitieron ${omitidas.otroModo} dificultades que no son de osu!mania.`,
    );
  }
  if (omitidas.invalidas > 0) {
    avisos.push(
      omitidas.invalidas === 1
        ? 'Se omitió 1 dificultad que no se pudo leer.'
        : `Se omitieron ${omitidas.invalidas} dificultades que no se pudieron leer.`,
    );
  }
  return avisos;
}

function esAudioVirtual(nombre: string): boolean {
  return nombre.trim().toLowerCase() === 'virtual';
}

/** `File.name` si `archivo` es un `File` (o algo con nombre); `undefined` si es un `Blob` suelto. */
function nombreDeArchivo(archivo: Blob): string | undefined {
  const nombre = (archivo as { name?: unknown }).name;
  return typeof nombre === 'string' ? nombre : undefined;
}

/**
 * Descomprime un .osz y lo clasifica (T-066): cada dificultad es de mania 4K
 * valida, de otro modo, de otras teclas o ilegible, y de eso salen los
 * errores con causa y los avisos de lo omitido. Orden de los errores (el
 * primero que aplica): `.osk`, extension que no es `.osz`/`.zip` (solo si
 * `archivo` es un `File` con nombre), tamano, lectura, zip, sin `.osu`, sin
 * mania, sin 4K, ninguna legible, audio. Asi el mensaje siempre describe lo
 * mas cercano a jugable.
 *
 * Importa TODAS las dificultades de mania 4K validas (T-011) y las agrupa en
 * canciones (T-066, D5: `agruparEnCanciones`; un .osz comun da una sola). El
 * audio se resuelve una vez por cancion: se prueba el de cada dificultad del
 * grupo en orden y se queda el primero que exista en el zip (T-054). Un grupo
 * cuyo audio falta se omite con aviso si otro grupo entra; si no entra
 * ninguno, falla con `audio-faltante`. Un grupo de audio virtual
 * (`AudioFilename:virtual`, T-066 paso 3) no tiene pista: arma su sonido con
 * las muestras que pide su receta (`armarCancionVirtual`), que se guardan
 * deduplicadas por SHA-256; respeta los limites de D9 y, si no entra ningun
 * grupo, falla con el error del primero (`muestras-faltantes`,
 * `virtual-fuera-de-limite` o `audio-faltante`). El fondo y el video de cada cancion salen de la primera
 * dificultad de su grupo que declare uno que exista en el zip (T-049); un
 * video que el navegador no reproduce se ignora en silencio.
 *
 * @throws {ErrorDeImportacion} siempre que no se puede importar.
 */
export async function analizarOsz(archivo: Blob): Promise<AnalisisOsz> {
  const nombreArchivo = nombreDeArchivo(archivo);
  if (nombreArchivo !== undefined) {
    const ext = extensionDe(nombreArchivo);
    if (ext === 'osk') {
      throw new ErrorDeImportacion(
        'es-skin',
        'Es una skin (.osk): se carga desde Ajustes, en Skin.',
      );
    }
    if (ext !== 'osz' && ext !== 'zip') {
      throw new ErrorDeImportacion(
        'no-es-osz',
        'No es un mapa de osu!: Tetra importa archivos .osz.',
      );
    }
  }
  if (archivo.size > MAX_BYTES_OSZ) {
    const mb = Math.ceil(archivo.size / (1024 * 1024));
    throw new ErrorDeImportacion('muy-grande', `El archivo pesa ${mb} MB y el máximo es 300 MB.`);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await archivo.arrayBuffer());
  } catch (cause) {
    throw new ErrorDeImportacion(
      'lectura',
      'No se pudo leer el archivo. Puede que se haya movido o borrado mientras se importaba.',
      { cause },
    );
  }

  let zip: Unzipped;
  try {
    zip = unzipSync(bytes);
  } catch (cause) {
    throw new ErrorDeImportacion(
      'zip-danado',
      'El archivo está dañado o no es un .osz: no se pudo abrir como zip.',
      { cause },
    );
  }

  const nombresOsu = elegirArchivosOsu(Object.keys(zip));
  if (nombresOsu.length === 0) {
    throw new ErrorDeImportacion('sin-osu', 'El .osz no trae ningún mapa (.osu).');
  }

  const omitidas: Omitidas = { otroModo: 0, otrasTeclas: {}, invalidas: 0 };
  let hayMania = false;
  let primerErrorDeParseo: string | undefined;
  const dificultades: Chart[] = [];
  for (const nombreOsu of nombresOsu) {
    const bytesOsu = zip[nombreOsu];
    if (bytesOsu === undefined) continue; // no deberia pasar (sale de Object.keys(zip))
    const texto = decodificadorUtf8.decode(bytesOsu);
    const cabecera = leerCabeceraOsu(texto);
    if (cabecera.modo !== 3) {
      omitidas.otroModo += 1;
      continue;
    }
    hayMania = true;
    if (cabecera.teclas !== undefined && cabecera.teclas !== 4) {
      omitidas.otrasTeclas[cabecera.teclas] = (omitidas.otrasTeclas[cabecera.teclas] ?? 0) + 1;
      continue;
    }
    const resultado = parseOsu(texto);
    if (resultado.ok) {
      dificultades.push(resultado.chart);
    } else {
      omitidas.invalidas += 1;
      primerErrorDeParseo ??= resultado.error;
    }
  }

  if (!hayMania) {
    throw new ErrorDeImportacion(
      'sin-mania',
      'Ninguna dificultad es de osu!mania: el .osz es de otro modo de juego (osu!, taiko o catch).',
    );
  }
  if (dificultades.length === 0) {
    if (omitidas.invalidas === 0) {
      throw new ErrorDeImportacion(
        'sin-4k',
        `Ninguna dificultad es de 4 teclas: el .osz trae solo mapas de ${listaDeTeclas(omitidas.otrasTeclas)}.`,
      );
    }
    throw new ErrorDeImportacion(
      'osu-invalido',
      `Ninguna dificultad de 4 teclas se pudo leer. ${primerErrorDeParseo ?? ''}`.trimEnd(),
    );
  }

  const avisos = avisosDeOmitidas(omitidas);

  // T-066 (D5): un .osz puede dar varias canciones. Cada grupo se resuelve por
  // separado: su audio, su fondo y su video salen de sus propias dificultades.
  const grupos = agruparEnCanciones(dificultades);
  const canciones: CancionImportada[] = [];
  // El error del primer grupo que no entro: es el que se lanza si no entra ninguno.
  let primerFallo: ErrorDeImportacion | undefined;
  for (const grupo of grupos) {
    const charts = grupo.indices.map((i) => dificultades[i]!);
    const resultado = esAudioVirtual(charts[0]!.metadata.audioFile)
      ? await armarCancionVirtual(grupo, charts, zip, avisos)
      : armarCancionReal(grupo, charts, zip, avisos);
    if (resultado.cancion === undefined) {
      primerFallo ??= resultado.fallo;
      continue;
    }
    const cancion = resultado.cancion;

    for (const chart of cancion.dificultades) {
      const nombreFondo = chart.metadata.backgroundFile;
      if (nombreFondo === undefined) continue;
      const bytesFondo = buscarEnZip(zip, nombreFondo);
      if (bytesFondo === undefined) continue;
      cancion.background = new Blob([bytesFondo], { type: mimeDesdeNombre(nombreFondo) });
      break;
    }

    for (const chart of cancion.dificultades) {
      const nombreVideo = chart.metadata.videoFile;
      if (nombreVideo === undefined || !esVideoReproducible(nombreVideo)) continue;
      const bytesVideo = buscarEnZip(zip, nombreVideo);
      if (bytesVideo === undefined) continue;
      cancion.video = new Blob([bytesVideo], { type: mimeDesdeNombre(nombreVideo) });
      cancion.videoOffset = chart.metadata.videoOffset ?? 0;
      break;
    }

    canciones.push(cancion);
  }

  if (canciones.length === 0) {
    // No deberia pasar sin `primerFallo` (cada grupo que no entra lo deja), pero
    // si pasara, el mensaje mas cercano es que no hay mapas utilizables.
    throw (
      primerFallo ??
      new ErrorDeImportacion('sin-osu', 'El .osz no trae ningún mapa (.osu) que se pueda importar.')
    );
  }

  return { canciones, titulo: dificultades[0]!.metadata.title, omitidas, avisos };
}

/** Un grupo armado, o el error que se lanzara si no entra ningun grupo. */
type ResultadoDeGrupo =
  | { cancion: CancionImportada; fallo?: undefined }
  | { cancion?: undefined; fallo: ErrorDeImportacion };

/**
 * Un grupo de audio real. T-054: el audio es el de la primera dificultad (en
 * orden) del grupo cuyo `AudioFilename` exista en el zip (dentro de un grupo
 * declaran la misma pista, pero puede venir escrita distinto). Sin audio, el
 * grupo se omite con aviso.
 */
function armarCancionReal(
  grupo: GrupoDeCancion,
  charts: Chart[],
  zip: Unzipped,
  avisos: string[],
): ResultadoDeGrupo {
  for (const chart of charts) {
    const bytesAudio = buscarEnZip(zip, chart.metadata.audioFile);
    if (bytesAudio === undefined) continue;
    const audio = new Blob([bytesAudio], { type: mimeDesdeNombre(chart.metadata.audioFile) });
    return {
      cancion: {
        titulo: grupo.titulo,
        artista: grupo.artista,
        ...(grupo.conjunto !== undefined && { conjunto: grupo.conjunto }),
        audio,
        dificultades: charts,
      },
    };
  }
  const pedido = charts[0]!.metadata.audioFile;
  avisos.push(`Se omitió "${grupo.titulo}": falta el audio "${pedido}".`);
  return {
    fallo: new ErrorDeImportacion(
      'audio-faltante',
      `Falta el audio: el mapa pide "${pedido}" y el .osz no lo trae.`,
    ),
  };
}

/**
 * T-066 (paso 3): un grupo de audio virtual. Se descartan (con aviso) las
 * dificultades que pasan del limite (D9). De las que quedan se reunen los
 * nombres de todas las recetas, se buscan en el zip y se les calcula el
 * SHA-256: la cancion guarda `nombre -> hash` y las muestras por hash (cada
 * archivo una sola vez, aunque dos nombres traigan los mismos bytes). Las que
 * faltan solo se avisan: esas notas no suenan. Si faltan todas, el grupo se
 * omite.
 */
async function armarCancionVirtual(
  grupo: GrupoDeCancion,
  charts: Chart[],
  zip: Unzipped,
  avisos: string[],
): Promise<ResultadoDeGrupo> {
  const dentroDelLimite: Chart[] = [];
  for (const chart of charts) {
    if (pasaElLimiteVirtual(chart)) {
      avisos.push(
        `Se omitió "${chart.metadata.difficultyName}": pasa el límite del audio virtual (${TEXTO_LIMITE_VIRTUAL}).`,
      );
    } else {
      dentroDelLimite.push(chart);
    }
  }
  if (dentroDelLimite.length === 0) {
    return {
      fallo: new ErrorDeImportacion(
        'virtual-fuera-de-limite',
        `Ninguna dificultad entra en el límite del audio virtual (${TEXTO_LIMITE_VIRTUAL}).`,
      ),
    };
  }

  const nombres = new Set<string>();
  for (const chart of dentroDelLimite) {
    for (const evento of chart.audioVirtual?.eventos ?? []) {
      nombres.add(normalizarNombreDeMuestra(evento.archivo));
    }
  }

  const keysounds: Record<string, string> = {};
  const muestras = new Map<string, Blob>();
  let faltan = 0;
  for (const nombre of nombres) {
    const bytes = buscarEnZip(zip, nombre);
    if (bytes === undefined) {
      faltan += 1;
      continue;
    }
    const hash = await sha256Hex(bytes);
    keysounds[nombre] = hash;
    if (!muestras.has(hash)) muestras.set(hash, new Blob([bytes], { type: mimeDesdeNombre(nombre) }));
  }

  if (nombres.size === 0) {
    // Una receta vacia: ni un keysound ni una linea Sample. No hay nada que reproducir.
    avisos.push(`Se omitió "${grupo.titulo}": usa audio virtual pero no pide ningún sonido.`);
    return {
      fallo: new ErrorDeImportacion(
        'muestras-faltantes',
        'Este .osz usa audio virtual pero no pide ningún sonido: no hay nada que reproducir.',
      ),
    };
  }
  if (muestras.size === 0) {
    avisos.push(
      `Se omitió "${grupo.titulo}": ninguna de sus ${nombres.size} muestras de sonido viene en el .osz.`,
    );
    return {
      fallo: new ErrorDeImportacion(
        'muestras-faltantes',
        `Falta el audio virtual: ninguna de las ${nombres.size} muestras de sonido que pide el mapa viene en el .osz.`,
      ),
    };
  }
  if (faltan > 0) {
    avisos.push(
      faltan === 1
        ? `Falta 1 muestra de sonido en "${grupo.titulo}": esa nota no va a sonar.`
        : `Faltan ${faltan} muestras de sonido en "${grupo.titulo}": esas notas no van a sonar.`,
    );
  }

  return {
    cancion: {
      titulo: grupo.titulo,
      artista: grupo.artista,
      ...(grupo.conjunto !== undefined && { conjunto: grupo.conjunto }),
      keysounds,
      muestras,
      dificultades: dentroDelLimite,
    },
  };
}

/**
 * Como `analizarOsz` pero devolviendo solo la primera cancion (T-011). Lanza
 * `ErrorDeImportacion` si el .osz no se puede importar.
 */
export async function extraerCancionDeOsz(archivo: Blob): Promise<CancionImportada> {
  return (await analizarOsz(archivo)).canciones[0]!;
}
