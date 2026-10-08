// T-009: descomprime un .osk (skin de osu!, un zip con imagenes y un
// skin.ini) y extrae los Blob de las imagenes que esta primera version del
// juego usa (ver docs/tickets/T-009-skins-osk.md, "Alcance de esta primera
// version"). Mismo patron que osz.ts: unzip con fflate, sin tocar
// IndexedDB aca (eso es db.ts, ver guardarSkin/listarSkinsDeLaBase).
//
// Esta funcion NO lee skin.ini ni sabe nada de columnas: el layout desde
// skin.ini queda fuera de esta version (ver el ticket, "Fuera de esta
// version"), y el mapeo de que columna usa que imagen es responsabilidad
// de packages/engine/src/skin.ts (ver ese archivo, "no se importa aca a
// proposito": storage no conoce Pixi ni el motor de render, ver CLAUDE.md,
// "Direccion de las dependencias"). Aca solo se buscan, por nombre fijo,
// las 10 imagenes que ese mapeo despues va a repartir por columna.
//
// Los nombres de archivo dentro de un .osk real vienen con mayusculas
// mezcladas (por ejemplo la skin de Arnold trae "mania-key1.PNG" y
// "mania-note2l.png" con L minuscula): la busqueda es insensible a
// mayusculas/minusculas, igual que elegirArchivoOsu en osz.ts.

import { unzipSync } from 'fflate';

/**
 * Las 10 imagenes de skin que esta primera version usa: notas y receptores
 * por grupo de columna (exterior/interior, ver el ticket, "Cuidado con la
 * convencion de columnas"), mas cuerpo y cola de LN, mas receptor pulsado.
 * Todo lo demas de un .osk real (juicios, escenario, combo, cursor) se
 * ignora (ver el ticket, "Fuera de esta version").
 */
export type ClaveImagenSkin =
  | 'note1'
  | 'note2'
  | 'note1H'
  | 'note2H'
  | 'note1L'
  | 'note2L'
  | 'key1'
  | 'key2'
  | 'key1D'
  | 'key2D';

export const CLAVES_IMAGENES_SKIN: readonly ClaveImagenSkin[] = [
  'note1',
  'note2',
  'note1H',
  'note2H',
  'note1L',
  'note2L',
  'key1',
  'key2',
  'key1D',
  'key2D',
];

/** Imagenes de skin ya extraidas como Blob. Ausente la clave si el .osk no la trae. */
export type ImagenesDeSkin = Partial<Record<ClaveImagenSkin, Blob>>;

const EXTENSIONES_IMAGEN_SOPORTADAS = ['png', 'jpg', 'jpeg'];

function extension(nombre: string): string {
  const punto = nombre.lastIndexOf('.');
  return punto === -1 ? '' : nombre.slice(punto + 1).toLowerCase();
}

function sinExtension(nombre: string): string {
  const punto = nombre.lastIndexOf('.');
  return punto === -1 ? nombre : nombre.slice(0, punto);
}

function mimeDeImagen(nombre: string): string {
  return extension(nombre) === 'png' ? 'image/png' : 'image/jpeg';
}

/**
 * Busca, entre los nombres de archivo de un .osk, cual corresponde a cada
 * una de las 10 imagenes que este juego usa (prefijo `mania-`, ver la
 * convencion de osu!mania). Devuelve el nombre de archivo tal cual esta en
 * el zip (para poder leer sus bytes despues), no lo normaliza.
 *
 * Exportada aparte de `extraerImagenesDeOsk` para poder testear la
 * busqueda de nombres sin tener que armar un zip de verdad en cada test.
 */
export function ubicarImagenesDeSkin(
  nombres: readonly string[],
): Partial<Record<ClaveImagenSkin, string>> {
  const resultado: Partial<Record<ClaveImagenSkin, string>> = {};
  for (const clave of CLAVES_IMAGENES_SKIN) {
    const buscado = `mania-${clave}`.toLowerCase();
    // Coincidencia exacta (sin extension, en minusculas): no alcanza con
    // un `includes`, porque "mania-note1" es substring de
    // "mania-note1H" y del revés no puede pasar (buscar primero "note1H"
    // no ayuda si la comparacion es por substring). La igualdad exacta
    // evita que "note1" agarre por error el archivo de "note1H".
    const encontrado = nombres.find((nombre) => {
      if (!EXTENSIONES_IMAGEN_SOPORTADAS.includes(extension(nombre))) return false;
      return sinExtension(nombre).toLowerCase() === buscado;
    });
    if (encontrado !== undefined) {
      resultado[clave] = encontrado;
    }
  }
  return resultado;
}

/**
 * Descomprime un .osk y arma el Blob de las imagenes que se hayan
 * encontrado. A diferencia de `extraerMapaDeOsz` con el audio, nunca lanza
 * por imagenes faltantes: una skin incompleta es valida, solo queda
 * incompleta (ver el ticket, "Fallback": la skin es aditiva, nunca un
 * requisito). Si lanza es porque el archivo no es un zip valido, o porque
 * no se encontro NINGUNA de las 10 imagenes (para no importar en
 * silencio un .osk que en realidad no es de mania, o cualquier zip suelto
 * que el usuario haya soltado por error).
 */
export async function extraerImagenesDeOsk(archivo: Blob): Promise<ImagenesDeSkin> {
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const zip = unzipSync(bytes);
  const nombres = Object.keys(zip);
  const ubicaciones = ubicarImagenesDeSkin(nombres);

  if (Object.keys(ubicaciones).length === 0) {
    throw new Error(
      'El archivo no parece ser una skin de osu!mania: no se encontró ninguna imagen ' +
        'mania-note1/note2/key1/key2 (con sus variantes H, L y D) adentro del .osk.',
    );
  }

  const resultado: ImagenesDeSkin = {};
  for (const clave of CLAVES_IMAGENES_SKIN) {
    const nombreArchivo = ubicaciones[clave];
    if (nombreArchivo === undefined) continue;
    const bytesImagen = zip[nombreArchivo];
    if (bytesImagen === undefined) continue;
    resultado[clave] = new Blob([bytesImagen], { type: mimeDeImagen(nombreArchivo) });
  }
  return resultado;
}
