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
  /** Nombre del archivo de audio dentro del zip. Tiene que coincidir con AudioFilename del .osu. Ausente si el audio es virtual. */
  audioNombre?: string;
  audio?: Uint8Array;
  /**
   * T-066 (paso 3): las muestras de un audio virtual, con su nombre dentro del
   * zip (el normalizado que usa la receta). Sin `audio` y con AudioFilename
   * "virtual" en los .osu.
   */
  muestras?: readonly { nombre: string; bytes: Uint8Array }[];
  /** Imagen de fondo (T-049). `nombre` es la ruta dentro del zip y tiene que coincidir con la del .osu. */
  fondo?: { nombre: string; bytes: Uint8Array };
  /** Video de fondo (T-049). Igual que `fondo`: el nombre coincide con el de la linea Video del .osu. */
  video?: { nombre: string; bytes: Uint8Array };
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
  const archivos: Zippable = {};
  const usados = new Set<string>();
  if (entrada.audioNombre !== undefined && entrada.audio !== undefined) {
    // El audio ya viene comprimido (mp3, ogg): se guarda sin recomprimir.
    archivos[entrada.audioNombre] = [entrada.audio, { level: 0 }];
    usados.add(entrada.audioNombre);
  }
  // Las muestras de un audio virtual tambien vienen comprimidas.
  for (const muestra of entrada.muestras ?? []) {
    archivos[muestra.nombre] = [muestra.bytes, { level: 0 }];
    usados.add(muestra.nombre);
  }
  // Imagen y video tambien vienen comprimidos: se guardan sin recomprimir.
  for (const extra of [entrada.fondo, entrada.video]) {
    if (extra === undefined) continue;
    archivos[extra.nombre] = [extra.bytes, { level: 0 }];
    usados.add(extra.nombre);
  }
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
