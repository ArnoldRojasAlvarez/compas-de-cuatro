// Arma un .osz (zip con el audio y uno o mas .osu) a partir de lo que crea el
// mapeador. Es la operacion inversa de extraerCancionDeOsz (osz.ts): el
// resultado se puede abrir en osu! y tambien importar de vuelta con
// importarOsz, que es justo como el mapeador guarda en la biblioteca.

import { strToU8, zipSync, type Zippable } from 'fflate';

export interface DificultadParaOsz {
  /** Nombre de la dificultad, va en el nombre del archivo ("Normal", "Insane"). */
  version: string;
  /** Texto completo del .osu (ver escribirOsu en @tetra/core). */
  texto: string;
}

export interface EntradaOsz {
  titulo: string;
  artista: string;
  creador: string;
  /** Nombre del archivo de audio dentro del zip. Tiene que coincidir con AudioFilename del .osu. */
  audioNombre: string;
  audio: Uint8Array;
  dificultades: readonly DificultadParaOsz[];
}

/** Quita lo que no se puede usar en un nombre de archivo de Windows. */
export function nombreSeguro(texto: string): string {
  // Los caracteres de control se filtran por codigo (una clase de regex con
  // \x00 dispara no-control-regex).
  const sinControl = Array.from(texto)
    .filter((c) => c.charCodeAt(0) >= 32)
    .join('');
  const limpio = sinControl
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio === '' ? 'sin nombre' : limpio;
}

/** Nombre del .osu de una dificultad, al estilo de osu!: "Artista - Titulo (Creador) [Version].osu". */
export function nombreDeOsu(entrada: Pick<EntradaOsz, 'titulo' | 'artista' | 'creador'>, version: string): string {
  const base = `${nombreSeguro(entrada.artista)} - ${nombreSeguro(entrada.titulo)} (${nombreSeguro(entrada.creador)})`;
  return `${base} [${nombreSeguro(version)}].osu`;
}

/** Devuelve los bytes del .osz. */
export function construirOsz(entrada: EntradaOsz): Uint8Array {
  if (entrada.dificultades.length === 0) {
    throw new Error('Hace falta al menos una dificultad para armar el .osz.');
  }
  const archivos: Zippable = {
    // El audio ya viene comprimido (mp3, ogg): se guarda sin recomprimir.
    [entrada.audioNombre]: [entrada.audio, { level: 0 }],
  };
  const usados = new Set<string>([entrada.audioNombre]);
  for (const dificultad of entrada.dificultades) {
    let nombre = nombreDeOsu(entrada, dificultad.version);
    // Dos dificultades con el mismo nombre se pisarian dentro del zip.
    for (let n = 2; usados.has(nombre); n++) {
      nombre = nombreDeOsu(entrada, `${dificultad.version} ${n}`);
    }
    usados.add(nombre);
    archivos[nombre] = strToU8(dificultad.texto);
  }
  return zipSync(archivos);
}
