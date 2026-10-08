// T-055: la parte de los records que no depende del DOM, para testearla sin
// navegador (mismo criterio que song-select-logica.ts). Armar la partida
// que se guarda, el aviso de "nuevo record" y los textos del song select.

import {
  hashMapa,
  JUDGEMENTS,
  mejorRango,
  rangoDePrecision,
  type Chart,
  type Judgement,
  type PartidaJugada,
  type Rango,
  type RecordDeMapa,
  type ScoreState,
} from '@tetra/core';
import { erroresJuzgados, media, type GolpeRegistrado } from './estadisticas.js';
import { formatearPulsaciones } from './contadores-logica.js';

/** La clave de record de una dificultad: el hash de su contenido, como texto. */
export function claveDeRecord(chart: Chart): string {
  return String(hashMapa(chart));
}

/**
 * La partida que se guarda a partir del estado final del motor de juicio. Los
 * conteos se copian (el motor puede reutilizar su objeto). `fecha` la pone
 * quien guarda: asi esta funcion queda pura.
 */
export function partidaDesdeScore(
  estado: ScoreState,
  fecha: string,
  medido: MedidoEnLaPartida = {},
): PartidaJugada {
  const errores = medido.desviaciones === undefined ? [] : erroresJuzgados(medido.desviaciones);
  return {
    score: estado.score,
    accuracy: estado.accuracy,
    maxCombo: estado.maxCombo,
    counts: { ...estado.counts },
    rango: rangoDePrecision(estado.accuracy, estado.counts),
    // T-056: sin golpes juzgados no hay media que guardar (no un 0 inventado).
    ...(errores.length > 0 && { desviacionMedia: media(errores) }),
    ...(medido.pulsaciones !== undefined &&
      medido.pulsaciones.length === 4 && { pulsaciones: [...medido.pulsaciones] }),
    fecha,
  };
}

/** Lo que T-056 mide en la partida ademas del score: pulsaciones por columna y cada golpe. */
export interface MedidoEnLaPartida {
  pulsaciones?: readonly number[];
  desviaciones?: readonly GolpeRegistrado[];
}

/** Miles separados por un espacio sin salto: "812 340". Redondea y no muestra decimales. */
export function formatearMiles(valor: number): string {
  const entero = Math.round(valor);
  const signo = entero < 0 ? '-' : '';
  return signo + String(Math.abs(entero)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** "98.43%" (dos decimales, como la pantalla de resultados). */
export function formatearPrecision(accuracy: number): string {
  return `${(accuracy * 100).toFixed(2)}%`;
}

/** "1 intento" / "12 intentos". */
export function textoDeIntentos(intentos: number): string {
  return intentos === 1 ? '1 intento' : `${intentos} intentos`;
}

/** Etiqueta corta de cada juicio en la linea de conteos (la equivalencia de osu!mania). */
export const ETIQUETA_DE_JUICIO: Record<Judgement, string> = {
  max: 'MAX',
  perfect: '300',
  great: '200',
  good: '100',
  bad: '50',
  miss: 'MISS',
};

/** La linea de conteos como pares etiqueta/cantidad, en el orden MAX, 300, 200, 100, 50, MISS. */
export function parejasDeConteos(
  counts: Record<Judgement, number>,
): { juicio: Judgement; etiqueta: string; cantidad: number }[] {
  return JUDGEMENTS.map((juicio) => ({
    juicio,
    etiqueta: ETIQUETA_DE_JUICIO[juicio],
    cantidad: counts[juicio],
  }));
}

/** La linea de conteos como texto plano: "MAX 812 · 300 140 · 200 12 · 100 3 · 50 0 · MISS 2". */
export function textoDeConteos(counts: Record<Judgement, number>): string {
  return parejasDeConteos(counts)
    .map((p) => `${p.etiqueta} ${p.cantidad}`)
    .join(' · ');
}

/**
 * El detalle de la ultima partida para el `title` del record. T-057: si la
 * partida guardo sus pulsaciones, se agregan por tecla ("D 412 · F 398 ·
 * J 401 · K 405") con `etiquetasDeTeclas` (una por columna; sin ellas, 1 a 4).
 */
export function detalleDeUltima(
  record: RecordDeMapa,
  etiquetasDeTeclas: readonly string[] = [],
): string {
  const u = record.ultima;
  const dia = u.fecha.slice(0, 10);
  const partes = [
    'Última partida',
    `${formatearMiles(u.score)} puntos`,
    formatearPrecision(u.accuracy),
    `combo ${u.maxCombo}`,
    textoDeConteos(u.counts),
  ];
  if (u.pulsaciones !== undefined && u.pulsaciones.length === 4) {
    partes.push(formatearPulsaciones(etiquetasDeTeclas, u.pulsaciones));
  }
  if (dia !== '') partes.push(dia);
  return partes.join(' · ');
}

/** Desde cuantos ms de desviacion media (en valor absoluto, ya redondeada) se sugiere ajustar el offset. */
export const DESVIACION_ALTA_MS = 8;

/** La desviacion media redondeada a ms enteros, sin -0. */
function enteroDeDesviacion(ms: number): number {
  const entero = Math.round(ms);
  return entero === 0 ? 0 : entero;
}

/** "+4 ms" (tarde), "-3 ms" (temprano) o "0 ms". Sin valor valido, "0 ms". */
export function formatearDesviacion(ms: number): string {
  const entero = Number.isFinite(ms) ? enteroDeDesviacion(ms) : 0;
  return `${entero > 0 ? '+' : ''}${entero} ms`;
}

/**
 * true si la desviacion media (la que se ve, redondeada) supera +-`DESVIACION_ALTA_MS`:
 * mas que ruido, un sesgo que el offset de la cancion podria corregir. Justo en
 * 8 no cuenta.
 */
export function desviacionEsAlta(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(enteroDeDesviacion(ms)) > DESVIACION_ALTA_MS;
}

/**
 * `title` de la desviacion media: "En promedio pegas tarde por 4 ms". Si es
 * alta, agrega la sugerencia de ajustar el offset de la cancion.
 */
export function tituloDeDesviacion(ms: number): string {
  const entero = Number.isFinite(ms) ? enteroDeDesviacion(ms) : 0;
  const base =
    entero === 0
      ? 'En promedio pegas justo a tiempo'
      : `En promedio pegas ${entero > 0 ? 'tarde' : 'temprano'} por ${Math.abs(entero)} ms`;
  return desviacionEsAlta(ms) ? `${base}. Prueba ajustar el offset de esta canción.` : base;
}

/** Clase CSS del rango (el color lo pone song-select.css). */
export function claseDeRango(rango: Rango): string {
  return `tetra-rango-${rango}`;
}

/**
 * El aviso de la pantalla de resultados tras guardar una partida, o
 * `undefined` si no hay nada que avisar. Sin `anterior` es el primer registro
 * del mapa. Con `anterior` solo avisa si la partida mejoro de verdad: mas
 * score (con la diferencia) o, a igual score, mas precision (sin diferencia
 * de score que mostrar). Un empate exacto no es un record nuevo.
 */
export function avisoDeRecord(
  esMejor: boolean,
  anterior: PartidaJugada | undefined,
  nueva: PartidaJugada,
): { texto: string; diferencia?: string } | undefined {
  if (!esMejor) return undefined;
  if (anterior === undefined) return { texto: 'Primer registro' };
  const diferencia = nueva.score - anterior.score;
  if (diferencia > 0) return { texto: 'Nuevo récord', diferencia: `+${formatearMiles(diferencia)}` };
  if (nueva.accuracy > anterior.accuracy) return { texto: 'Nuevo récord' };
  return undefined;
}

/**
 * El mejor rango entre las dificultades de una cancion que tienen record, o
 * `undefined` si ninguna lo tiene. `recordsPorClave` es el mapa que devuelve
 * `leerRecords`; `clavesDeSusDificultades` las claves de la cancion.
 */
export function mejorRangoDeCancion(
  clavesDeSusDificultades: readonly string[],
  recordsPorClave: ReadonlyMap<string, RecordDeMapa>,
): Rango | undefined {
  const rangos: Rango[] = [];
  for (const clave of clavesDeSusDificultades) {
    const record = recordsPorClave.get(clave);
    if (record !== undefined) rangos.push(record.mejor.rango);
  }
  return mejorRango(rangos);
}
