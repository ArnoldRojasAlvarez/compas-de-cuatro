// T-066 (D5, paso 2): un .osz puede traer varias canciones. Agrupa las
// dificultades de un .osz en canciones: por archivo de audio cuando hay pista
// real, y por la "pieza" que anuncia el Version cuando el audio es virtual
// (sets tipo BMS, donde cada dificultad es una obra distinta).
//
// Puro: no lee archivos ni toca el navegador. Nunca pierde dificultades: todo
// indice de entrada cae en exactamente un grupo.

import type { Chart } from '../types.js';

export interface GrupoDeCancion {
  /** Clave del grupo (D5): 'a|<audio normalizado>' o 'v|<pieza normalizada>'. */
  clave: string;
  /** Titulo para la cancion (D5). */
  titulo: string;
  artista: string;
  /** Title del set, solo si el titulo es una pieza (distinto del Title). */
  conjunto?: string;
  /** Indices en el arreglo de entrada, en su orden. Nunca vacio. */
  indices: number[];
}

const SEPARADOR_DE_PIEZA = ' - ';

/**
 * D5: la pieza de un `Version`: lo que esta antes del ULTIMO " - ", recortado
 * (`Pathetique (Medley ver.) - 4K EX` da `Pathetique (Medley ver.)`). Vacia si
 * el `Version` no tiene " - " (`4K HELL CIRCUS`).
 */
export function piezaDeVersion(version: string): string {
  const indice = version.lastIndexOf(SEPARADOR_DE_PIEZA);
  if (indice === -1) return '';
  return version.slice(0, indice).trim();
}

/** `AudioFilename` normalizado: recortado, `\` a `/`, sin `./` inicial, minusculas. */
function audioNormalizado(audio: string): string {
  return audio.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();
}

function textoNormalizado(texto: string): string {
  return texto.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Nombre del archivo de audio sin carpeta ni extension: `musica/Pista 1.mp3` da `Pista 1`. */
function nombreDeAudioSinExtension(audio: string): string {
  const sinCarpeta = audio.trim().replace(/\\/g, '/').split('/').pop() ?? '';
  const punto = sinCarpeta.lastIndexOf('.');
  return punto > 0 ? sinCarpeta.slice(0, punto) : sinCarpeta;
}

function esVirtual(chart: Chart): boolean {
  return chart.metadata.audioFile.trim().toLowerCase() === 'virtual';
}

/**
 * D5: agrupa las dificultades en canciones. `charts` va en el orden de
 * `elegirArchivosOsu` (alfabetico por nombre de archivo); los grupos salen en
 * el orden de su primera dificultad.
 *
 * - Audio real: la clave es el `AudioFilename` normalizado. Las que comparten
 *   pista son la misma cancion (el .osz comun da un solo grupo).
 * - Audio virtual: la clave es la pieza del `Version` (`piezaDeVersion`); sin
 *   pieza, la dificultad va al grupo del set.
 * - Nunca se mezclan en un grupo dificultades de audio real con virtuales.
 *
 * Titulo y artista: un grupo con pieza se titula como la pieza y guarda el
 * `Title` del set en `conjunto`; los demas llevan el `Title` (como siempre).
 * Si varios grupos de audio real comparten `Title`, a cada uno se le agrega
 * ` (<audio sin extension>)` para distinguirlos.
 */
export function agruparEnCanciones(charts: readonly Chart[]): GrupoDeCancion[] {
  const porClave = new Map<string, GrupoDeCancion>();
  const esDeAudioReal = new Map<string, boolean>();

  charts.forEach((chart, indice) => {
    const virtual = esVirtual(chart);
    const pieza = virtual ? piezaDeVersion(chart.metadata.difficultyName) : '';
    const clave = virtual
      ? `v|${textoNormalizado(pieza)}`
      : `a|${audioNormalizado(chart.metadata.audioFile)}`;

    const existente = porClave.get(clave);
    if (existente !== undefined) {
      existente.indices.push(indice);
      return;
    }

    const title = chart.metadata.title;
    const grupo: GrupoDeCancion = {
      clave,
      titulo: pieza !== '' ? pieza : title,
      artista: chart.metadata.artist,
      indices: [indice],
    };
    if (pieza !== '' && textoNormalizado(pieza) !== textoNormalizado(title)) {
      grupo.conjunto = title;
    }
    porClave.set(clave, grupo);
    esDeAudioReal.set(clave, !virtual);
  });

  const grupos = [...porClave.values()];

  // Audio real con varios grupos que comparten Title: el sufijo los distingue.
  const reales = grupos.filter((g) => esDeAudioReal.get(g.clave) === true);
  const porTitulo = new Map<string, GrupoDeCancion[]>();
  for (const grupo of reales) {
    const clave = textoNormalizado(grupo.titulo);
    const lista = porTitulo.get(clave);
    if (lista === undefined) porTitulo.set(clave, [grupo]);
    else lista.push(grupo);
  }
  for (const lista of porTitulo.values()) {
    if (lista.length < 2) continue;
    for (const grupo of lista) {
      const audio = charts[grupo.indices[0]!]!.metadata.audioFile;
      grupo.titulo = `${grupo.titulo} (${nombreDeAudioSinExtension(audio)})`;
    }
  }

  return grupos;
}
