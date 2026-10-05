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

/** La clave de record de una dificultad: el hash de su contenido, como texto. */
export function claveDeRecord(chart: Chart): string {
  return String(hashMapa(chart));
}

/**
 * La partida que se guarda a partir del estado final del motor de juicio. Los
 * conteos se copian (el motor puede reutilizar su objeto). `fecha` la pone
 * quien guarda: asi esta funcion queda pura.
 */
export function partidaDesdeScore(estado: ScoreState, fecha: string): PartidaJugada {
  return {
    score: estado.score,
    accuracy: estado.accuracy,
    maxCombo: estado.maxCombo,
    counts: { ...estado.counts },
    rango: rangoDePrecision(estado.accuracy, estado.counts),
    fecha,
  };
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

/** El detalle de la ultima partida para el `title` del record. */
export function detalleDeUltima(record: RecordDeMapa): string {
  const u = record.ultima;
  const dia = u.fecha.slice(0, 10);
  const partes = [
    'Ultima partida',
    `${formatearMiles(u.score)} puntos`,
    formatearPrecision(u.accuracy),
    `combo ${u.maxCombo}`,
    textoDeConteos(u.counts),
  ];
  if (dia !== '') partes.push(dia);
  return partes.join(' · ');
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
  if (diferencia > 0) return { texto: 'Nuevo record', diferencia: `+${formatearMiles(diferencia)}` };
  if (nueva.accuracy > anterior.accuracy) return { texto: 'Nuevo record' };
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
