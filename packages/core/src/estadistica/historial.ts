// T-045: agregaciones puras del historial de partidas. Sin navegador ni
// almacenamiento (CLAUDE.md, regla 2): entra una lista de registros, sale un
// resumen o una serie por dia. Guardarlos vive en @tetra/storage.
//
// Regla de oro de este modulo: los promedios se PONDERAN. Una partida de 20
// notas no pesa lo mismo que una de 2000; promediar los promedios de cada
// partida (sin ponderar) deja que una partida corta mande sobre una larga.
//   - precision: ponderada por `notas` (es exactamente la precision global,
//     porque la precision de una partida ya es un promedio por nota);
//   - desviacion media y tipica: ponderadas por los golpes juzgados (las notas
//     menos los miss: un miss no tiene un error que medir).

import type { Column, Ms } from '../types.js';

/** Cuantas partidas guarda el historial como maximo: al llegar la 2001, sale la mas vieja. */
export const TOPE_HISTORIAL = 2000;

const MS_POR_DIA = 86_400_000;

/** Una partida completada, resumida para el historial. */
export interface RegistroPartida {
  /** `hashMapa` del mapa jugado, como texto. */
  hash: string;
  /** Texto ISO del momento en que termino. */
  fecha: string;
  score: number;
  /** 0 a 1. */
  accuracy: number;
  /** Notas de la partida (todos los juicios, con los miss): el peso de la partida en los promedios. */
  notas: number;
  /** ms con signo (negativo = temprano), sobre los golpes que no fueron miss. 0 si no hubo ninguno. */
  desviacionMedia: Ms;
  /** Desviacion estandar de esos mismos golpes, en ms. */
  desviacionTipica: Ms;
  /** Golpes con error negativo y positivo. Un error exacto de 0 no cuenta en ninguno. */
  tempranas: number;
  tardias: number;
  /** Miss por columna (0 a 3). */
  fallosPorColumna: [number, number, number, number];
  /** Tramo jugado: de la primera a la ultima nota del mapa, en ms. */
  duracionJugadaMs: Ms;
}

export interface ResumenHistorial {
  partidas: number;
  tiempoJugadoMs: Ms;
  notas: number;
  /** Precision media ponderada por notas, 0 a 1. `null` sin partidas. */
  accuracyMedia: number | null;
  /** Desviacion media con signo, ponderada por golpes juzgados. `null` si no hubo ninguno. */
  desviacionMedia: Ms | null;
  /** Desviacion tipica de TODOS los golpes juntos (varianza agrupada: dentro de cada partida y entre ellas). `null` si no hubo golpes. */
  desviacionTipica: Ms | null;
  tempranas: number;
  tardias: number;
  /** tempranas / (tempranas + tardias), 0 a 1. `null` si no hubo ni una ni otra. */
  proporcionTemprana: number | null;
  fallosPorColumna: [number, number, number, number];
  /** La columna con mas miss; en empate la primera. `null` si no hubo ningun miss. */
  columnaMasFallada: Column | null;
}

interface Ponderado {
  valor: number;
  peso: number;
}

/** Un conteo valido: finito y no negativo; cualquier otra cosa (NaN, negativo) cuenta como 0. */
function conteo(valor: number): number {
  return Number.isFinite(valor) && valor > 0 ? valor : 0;
}

function fallosTotales(r: RegistroPartida): number {
  let suma = 0;
  for (const f of r.fallosPorColumna) suma += conteo(f);
  return suma;
}

/** Golpes con un error que medir: las notas menos los miss. Es el peso de la desviacion. */
export function golpesJuzgados(r: RegistroPartida): number {
  return Math.max(0, conteo(r.notas) - fallosTotales(r));
}

/** El dia (AAAA-MM-DD) de un instante ISO en UTC, o `''` si la fecha no se puede leer. */
export function diaUtc(fecha: string): string {
  const ms = Date.parse(fecha);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
}

/** Promedio ponderado; `null` si la suma de pesos es 0 (nada con que ponderar). */
function promedioPonderado(partes: readonly Ponderado[]): number | null {
  let suma = 0;
  let pesos = 0;
  for (const { valor, peso } of partes) {
    suma += valor * peso;
    pesos += peso;
  }
  return pesos > 0 ? suma / pesos : null;
}

/** Valor y peso de la precision de una partida, o `undefined` si su precision no es un numero. */
function precisionPonderada(r: RegistroPartida): Ponderado | undefined {
  return Number.isFinite(r.accuracy)
    ? { valor: r.accuracy, peso: conteo(r.notas) }
    : undefined;
}

/** Valor y peso de la desviacion media de una partida, o `undefined` si no es un numero. */
function desviacionPonderada(r: RegistroPartida): Ponderado | undefined {
  return Number.isFinite(r.desviacionMedia)
    ? { valor: r.desviacionMedia, peso: golpesJuzgados(r) }
    : undefined;
}

/**
 * Resumen de un conjunto de partidas (en cualquier orden). Sin partidas, o sin
 * pesos con los que ponderar, los promedios son `null`: nunca NaN.
 */
export function resumirHistorial(r: readonly RegistroPartida[]): ResumenHistorial {
  const fallos: [number, number, number, number] = [0, 0, 0, 0];
  let tiempo = 0;
  let notas = 0;
  let tempranas = 0;
  let tardias = 0;
  const precisiones: Ponderado[] = [];
  const desviaciones: Ponderado[] = [];
  for (const x of r) {
    tiempo += conteo(x.duracionJugadaMs);
    notas += conteo(x.notas);
    tempranas += conteo(x.tempranas);
    tardias += conteo(x.tardias);
    for (let c = 0; c < 4; c++)
      fallos[c] = fallos[c]! + conteo(x.fallosPorColumna[c] ?? 0);
    const precision = precisionPonderada(x);
    if (precision !== undefined) precisiones.push(precision);
    const desviacion = desviacionPonderada(x);
    if (desviacion !== undefined) desviaciones.push(desviacion);
  }

  const desviacionMedia = promedioPonderado(desviaciones);

  // Varianza agrupada: lo que se dispersa dentro de cada partida mas lo que se
  // aleja su media de la media global. Con una sola partida da su desviacion tipica.
  let desviacionTipica: number | null = null;
  if (desviacionMedia !== null) {
    const varianzas: Ponderado[] = [];
    for (const x of r) {
      const d = desviacionPonderada(x);
      if (d === undefined) continue;
      const tipica = Number.isFinite(x.desviacionTipica)
        ? Math.max(0, x.desviacionTipica)
        : 0;
      varianzas.push({
        valor: tipica * tipica + (d.valor - desviacionMedia) ** 2,
        peso: d.peso,
      });
    }
    const varianza = promedioPonderado(varianzas);
    desviacionTipica = varianza === null ? null : Math.sqrt(varianza);
  }

  let columnaMasFallada: Column | null = null;
  let masFallos = 0;
  for (let c = 0; c < 4; c++) {
    if (fallos[c]! > masFallos) {
      masFallos = fallos[c]!;
      columnaMasFallada = c as Column;
    }
  }

  return {
    partidas: r.length,
    tiempoJugadoMs: tiempo,
    notas,
    accuracyMedia: promedioPonderado(precisiones),
    desviacionMedia,
    desviacionTipica,
    tempranas,
    tardias,
    proporcionTemprana:
      tempranas + tardias > 0 ? tempranas / (tempranas + tardias) : null,
    fallosPorColumna: fallos,
    columnaMasFallada,
  };
}

/**
 * Un valor por dia: el campo agrupado por dia con la misma ponderacion que
 * `resumirHistorial` (un dia con una partida de 20 notas y otra de 2000 se
 * parece a la larga). Orden ascendente por dia, sin importar el de la entrada.
 * Un dia sin nada que promediar (todo miss en 'desviacionMedia', una fecha que
 * no se lee) no aparece.
 *
 * `diaDe` dice a que dia cae una fecha; por defecto el dia UTC. Quien conoce la
 * zona horaria del jugador pasa su propio dia local (core no mira el reloj).
 */
export function serieDiaria(
  r: readonly RegistroPartida[],
  campo: 'accuracy' | 'desviacionMedia',
  diaDe: (fecha: string) => string = diaUtc,
): { dia: string; valor: number }[] {
  const porDia = new Map<string, Ponderado[]>();
  for (const registro of r) {
    const dia = diaDe(registro.fecha);
    if (dia === '') continue;
    const par =
      campo === 'accuracy' ? precisionPonderada(registro) : desviacionPonderada(registro);
    if (par === undefined) continue;
    const lista = porDia.get(dia);
    if (lista === undefined) porDia.set(dia, [par]);
    else lista.push(par);
  }
  const serie: { dia: string; valor: number }[] = [];
  for (const [dia, lista] of porDia) {
    const valor = promedioPonderado(lista);
    if (valor !== null) serie.push({ dia, valor });
  }
  return serie.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
}

/**
 * Las partidas de los ultimos `dias` dias contados hacia atras desde `ahora`
 * (ms de epoca; quien llama pone el reloj, core no lo lee). Con `dias` en
 * `null` devuelve todas. Una fecha ilegible o futura queda fuera de la ventana.
 */
export function filtrarPorVentana(
  r: readonly RegistroPartida[],
  dias: number | null,
  ahora: number,
): RegistroPartida[] {
  if (dias === null) return [...r];
  const desde = ahora - dias * MS_POR_DIA;
  return r.filter((x) => {
    const ms = Date.parse(x.fecha);
    return Number.isFinite(ms) && ms >= desde && ms <= ahora;
  });
}
