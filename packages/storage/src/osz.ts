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

import { unzipSync } from 'fflate';
import type { Chart } from '@tetra/core';
import { parseOsu } from '@tetra/core';

const decodificadorUtf8 = new TextDecoder('utf-8');

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

  const bytesAudio = zip[chart.metadata.audioFile];
  if (bytesAudio === undefined) {
    throw new Error(
      `El .osz no trae el archivo de audio declarado en el .osu ` +
        `(AudioFilename:${chart.metadata.audioFile}).`,
    );
  }
  const audio = new Blob([bytesAudio], { type: mimeDesdeNombre(chart.metadata.audioFile) });

  // El parser de T-005 no lee [Events] (fuera de alcance del ticket: ver
  // "Fuera de alcance"), asi que chart.metadata.backgroundFile nunca viene
  // seteado hoy. Se deja preparado para cuando un ticket futuro agregue esa
  // lectura: en ese momento esta funcion ya sabe buscar la portada en el
  // zip sin cambios en su firma.
  const nombreFondo = chart.metadata.backgroundFile;
  const bytesFondo = nombreFondo === undefined ? undefined : zip[nombreFondo];
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
 * El audio y la portada se toman del `.osu` que ordena primero en
 * `elegirArchivosOsu`: en un set real las distintas dificultades de una
 * misma cancion comparten el mismo `AudioFilename` (y la misma portada), asi
 * que alcanza con resolverlo una vez en vez de por dificultad. Lo mismo para
 * el titulo y el artista, que se muestran a nivel cancion en el song select
 * (cada dificultad conserva igual su propio `chart.metadata`, incluido su
 * `difficultyName`).
 *
 * @throws {Error} si el zip no trae ningun .osu, si ninguno de los que trae
 * parsea como mania 4K, o si falta el archivo de audio que declara el .osu
 * elegido para el audio de la cancion.
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

  const primera = dificultades[0]!;
  const bytesAudio = zip[primera.metadata.audioFile];
  if (bytesAudio === undefined) {
    throw new Error(
      `El .osz no trae el archivo de audio declarado en el .osu ` +
        `(AudioFilename:${primera.metadata.audioFile}).`,
    );
  }
  const audio = new Blob([bytesAudio], { type: mimeDesdeNombre(primera.metadata.audioFile) });

  const nombreFondo = primera.metadata.backgroundFile;
  const bytesFondo = nombreFondo === undefined ? undefined : zip[nombreFondo];
  const base: CancionImportada = {
    titulo: primera.metadata.title,
    artista: primera.metadata.artist,
    audio,
    dificultades,
  };
  if (bytesFondo === undefined) {
    return base;
  }
  const background = new Blob([bytesFondo], { type: mimeDesdeNombre(nombreFondo!) });
  return { ...base, background };
}
