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
import { parseOsu } from '@tetra/core';

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
    throw new Error('El .osz no contiene ningun archivo .osu.');
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
  audio: Blob;
  background?: Blob;
  /** Solo si el .osz trae un video reproducible (mp4, m4v, webm) que alguna dificultad declara. */
  video?: Blob;
  /** ms; `videoOffset` de la dificultad que declaro el video (0 si no lo traia). */
  videoOffset?: Ms;
  /** Una entrada por cada .osu que parseo como mania 4K valido. Nunca vacio: ver el @throws de abajo. */
  dificultades: Chart[];
}

/**
 * Descomprime un .osz y parsea TODAS las dificultades de mania 4K validas
 * que contenga (T-011, "Parte A": antes, `extraerMapaDeOsz` arriba solo
 * importaba la primera). Un `.osu` que no parsea (por ejemplo porque es de
 * otro modo de juego, `Mode` distinto de 3: un `.osz` real puede traer
 * dificultades de standard ademas de mania) se saltea en silencio en vez de
 * hacer fallar la cancion entera; si NINGUNA dificultad parsea, se lanza
 * (mismo criterio que `extraerMapaDeOsz`: un .osz sin ninguna dificultad
 * jugable no es un .osz valido para este juego).
 *
 * El audio se resuelve una sola vez por cancion (en un set real las
 * dificultades comparten el mismo `AudioFilename`): se prueba el de cada
 * dificultad en orden y se queda el primero que exista en el zip (T-054). Lo mismo para el titulo y el artista, que se muestran a
 * nivel cancion en el song select (cada dificultad conserva igual su propio
 * `chart.metadata`, incluido su `difficultyName`).
 *
 * T-049: el fondo y el video salen de la primera dificultad (en ese mismo
 * orden) que declare uno que exista en el zip. Un video con extension que el
 * navegador no reproduce (avi, flv, mpg, wmv) se ignora en silencio: la
 * cancion se importa igual, sin video. Todas las busquedas en el zip son
 * tolerantes a mayusculas, `\` y `./` (ver `buscarEnZip`).
 *
 * @throws {Error} si el zip no trae ningun .osu, si ninguno de los que trae
 * parsea como mania 4K, o si NINGUNA dificultad tiene su archivo de audio en
 * el zip (el mensaje nombra el de la primera).
 */
export async function extraerCancionDeOsz(archivo: Blob): Promise<CancionImportada> {
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const zip = unzipSync(bytes);
  const nombres = Object.keys(zip);

  const nombresOsu = elegirArchivosOsu(nombres);
  if (nombresOsu.length === 0) {
    throw new Error('El .osz no contiene ningun archivo .osu.');
  }

  const dificultades: Chart[] = [];
  for (const nombreOsu of nombresOsu) {
    const bytesOsu = zip[nombreOsu];
    if (bytesOsu === undefined) continue; // no deberia pasar (nombreOsu sale de Object.keys(zip)), guard por las dudas
    const resultado = parseOsu(decodificadorUtf8.decode(bytesOsu));
    if (resultado.ok) {
      dificultades.push(resultado.chart);
    }
    // Un .osu que no parsea (por ejemplo una dificultad de otro modo de
    // juego) se saltea: no hace falta que TODAS las dificultades del .osz
    // sean mania 4K validas, alcanza con que alguna lo sea (se valida mas
    // abajo).
  }

  if (dificultades.length === 0) {
    throw new Error('El .osz no contiene ninguna dificultad de mania 4K valida.');
  }

  // T-054: el audio es el de la primera dificultad (en orden) cuyo
  // `AudioFilename` exista en el zip. Hay sets reales donde la primera declara
  // un archivo que no vino y las demas si lo traen: no tiene que fallar por eso.
  const primera = dificultades[0]!;
  let audio: Blob | undefined;
  for (const chart of dificultades) {
    const bytesAudio = buscarEnZip(zip, chart.metadata.audioFile);
    if (bytesAudio === undefined) continue;
    audio = new Blob([bytesAudio], { type: mimeDesdeNombre(chart.metadata.audioFile) });
    break;
  }
  if (audio === undefined) {
    throw new Error(
      `El .osz no trae el archivo de audio declarado en el .osu ` +
        `(AudioFilename:${primera.metadata.audioFile}).`,
    );
  }

  const resultado: CancionImportada = {
    titulo: primera.metadata.title,
    artista: primera.metadata.artist,
    audio,
    dificultades,
  };

  for (const chart of dificultades) {
    const nombreFondo = chart.metadata.backgroundFile;
    if (nombreFondo === undefined) continue;
    const bytesFondo = buscarEnZip(zip, nombreFondo);
    if (bytesFondo === undefined) continue;
    resultado.background = new Blob([bytesFondo], { type: mimeDesdeNombre(nombreFondo) });
    break;
  }

  for (const chart of dificultades) {
    const nombreVideo = chart.metadata.videoFile;
    if (nombreVideo === undefined || !esVideoReproducible(nombreVideo)) continue;
    const bytesVideo = buscarEnZip(zip, nombreVideo);
    if (bytesVideo === undefined) continue;
    resultado.video = new Blob([bytesVideo], { type: mimeDesdeNombre(nombreVideo) });
    resultado.videoOffset = chart.metadata.videoOffset ?? 0;
    break;
  }

  return resultado;
}
