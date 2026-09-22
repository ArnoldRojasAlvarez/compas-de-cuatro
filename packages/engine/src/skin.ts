// T-009: skins de osu!mania. Dos cosas separadas en este archivo:
//
// 1. `imagenDeSkin`: el mapeo puro de columna (0 a 3) a que imagen de skin
//    le toca, con la convencion 4K estandar de osu!mania (ver
//    docs/tickets/T-009-skins-osk.md, "Cuidado con la convencion de
//    columnas"): columnas exteriores (0 y 3) usan el grupo note1/key1,
//    interiores (1 y 2) usan note2/key2. Esta es la UNICA funcion que
//    decide esa correspondencia; playfield.ts solo la llama, nunca vuelve
//    a escribir "columna 0 o 3" por su cuenta. Es pura (nada de Pixi) para
//    poder testearla sin renderer.
//
// 2. `cargarTexturasDeSkin`: la resolucion de Blob (lo que guarda
//    @tetra/storage) a Texture de Pixi. Vive en engine y no en storage
//    porque storage no conoce Pixi (ver CLAUDE.md, "Direccion de las
//    dependencias", y el ticket, "Donde va cada parte"); y no en core
//    porque core no toca Pixi tampoco. No tiene test de vitest por la
//    misma razon que playfield.ts no lo tiene (ver ese archivo): toca
//    Pixi y `createImageBitmap`, que no existen en el entorno node de
//    vitest.

import { Texture } from 'pixi.js';
import type { Column } from '@tetra/core';

/**
 * Las 10 imagenes de skin que esta primera version usa. Mismo conjunto de
 * claves que `ClaveImagenSkin` en packages/storage/src/osk.ts: NO se
 * importa ese tipo desde aca a proposito (engine no depende de storage,
 * ver CLAUDE.md: el diagrama de dependencias no tiene una flecha entre
 * los dos). Las dos declaraciones son estructuralmente el mismo tipo (la
 * misma union de 10 strings), asi que un `ImagenesDeSkin` de storage se le
 * puede pasar directo a `cargarTexturasDeSkin` sin conversion; si algun
 * dia se agrega o saca una clave hay que tocar los dos archivos.
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

/** Que parte de la pista se esta por dibujar, para pedirle su imagen al skin. */
export type ParteDeSkin = 'nota' | 'cuerpoLn' | 'colaLn' | 'receptor' | 'receptorPulsado';

/**
 * Dada una columna (0 a 3) y que parte de la pista se va a dibujar,
 * devuelve cual imagen de skin le toca. Ver el comentario de arriba del
 * archivo: esta es la unica funcion que decide exterior/interior.
 */
export function imagenDeSkin(columna: Column, parte: ParteDeSkin): ClaveImagenSkin {
  const exterior = columna === 0 || columna === 3;
  switch (parte) {
    case 'nota':
      return exterior ? 'note1' : 'note2';
    case 'cuerpoLn':
      return exterior ? 'note1H' : 'note2H';
    case 'colaLn':
      return exterior ? 'note1L' : 'note2L';
    case 'receptor':
      return exterior ? 'key1' : 'key2';
    case 'receptorPulsado':
      return exterior ? 'key1D' : 'key2D';
  }
}

/** Texturas de skin ya resueltas, listas para que Playfield las use. Ausente la clave si el skin no la trae. */
export type TexturasDeSkin = Partial<Record<ClaveImagenSkin, Texture>>;

/**
 * Convierte los Blob de imagen (lo que guarda @tetra/storage) en Texture
 * de Pixi, todas de una vez. Se llama una sola vez al iniciar la partida,
 * no por nota (ver el ticket, "Rendimiento"): quien arma el Playfield
 * (apps/web/src/game.ts) le pasa el resultado ya resuelto, y de ahi en mas
 * el pooling de T-004 solo cambia la textura de sprites que ya existen
 * (ver playfield.ts).
 *
 * Las claves ausentes en `imagenes` (skin incompleta, ver el ticket,
 * "Fallback") quedan ausentes en el resultado: esta funcion no rellena
 * nada, Playfield es quien decide ahi el fallback a rectangulo.
 */
export async function cargarTexturasDeSkin(
  imagenes: Partial<Record<ClaveImagenSkin, Blob>>,
): Promise<TexturasDeSkin> {
  const resultado: TexturasDeSkin = {};
  const claves = Object.keys(imagenes) as ClaveImagenSkin[];
  await Promise.all(
    claves.map(async (clave) => {
      const blob = imagenes[clave];
      if (blob === undefined) return;
      const bitmap = await createImageBitmap(blob);
      resultado[clave] = Texture.from(bitmap);
    }),
  );
  return resultado;
}
