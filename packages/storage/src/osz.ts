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
 * Elige, entre los nombres de archivo de un .osz, cual .osu importar.
 *
 * Un .osz puede traer varias dificultades (varios .osu). T-005 importa una
 * sola por llamada (ver la firma de `importarOsz` en el ticket, que
 * devuelve un unico ChartId): se elige la primera en orden alfabetico para
 * que el resultado sea determinista. Elegir entre todas las dificultades es
 * trabajo del song select, que es fase 3 (fuera de alcance de este
 * ticket). Devuelve `null` si no hay ningun .osu en el zip.
 */
export function elegirArchivoOsu(nombres: readonly string[]): string | null {
  const candidatos = nombres.filter((nombre) => nombre.toLowerCase().endsWith('.osu'));
  if (candidatos.length === 0) return null;
  return [...candidatos].sort()[0]!;
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
