// T-061: logica pura del diagnostico de tirones de la partida. Nada de DOM ni
// de reloj aca: recibe numeros (el instante de juego y el timestamp de rAF) y
// devuelve numeros o strings, asi se prueba sin navegador (ver
// diagnostico-tirones-logica.test.ts). diagnostico-tirones.ts la alimenta una
// vez por frame y le acerca las entradas del PerformanceObserver.
//
// Es solo diagnostico, igual que el medidor de fps de T-059 (fps-logica.ts): el
// `timestamp` de rAF y las entradas de PerformanceObserver dicen cuanto duro un
// frame y quien lo bloqueo, pero no entran al juicio, a las notas ni a nada del
// gameplay, que siguen leyendo `clock.now()` (CLAUDE.md, "El reloj es el audio").
// El unico tiempo de juego que se guarda aca es una etiqueta para decir "a los
// 38,0 s", no una fuente de tiempo.
//
// Sin allocaciones por frame en el camino sin tiron: el estado vive en un
// Float64Array y el histograma en un Uint32Array, ambos creados una sola vez.
// Solo cuando un frame supera el umbral se crea un objeto (el `Tiron`).
//
// Umbral: desde que Arnold midio en su Chrome (el "ms max" casi nunca baja de
// 33 ms) todo frame de mas de 30 ms es un tiron, no solo los de mas de 50. Ojo:
// el long-animation-frame del navegador solo existe para frames de mas de 50 ms,
// asi que los tirones de 30 a 50 ms nunca traen atribucion de script.

import type { Ms } from '@tetra/core';

/** Un frame mas largo que esto es un tiron (el segundo frame perdido a 60 Hz). */
export const UMBRAL_TIRON_MS = 30;
/** Desde esta duracion el navegador entrega long-animation-frame (con script atribuido). */
export const UMBRAL_LOAF_MS = 50;
/** Cuantos tirones se guardan con detalle; los demas solo se cuentan. */
export const TOPE_TIRONES = 300;
/** Ventana de "golpes recientes" de cada tiron, en ms de reloj de juego. */
export const VENTANA_GOLPES_MS = 500;
/** Fuentes de script que se guardan por tiron. */
export const MAX_FUENTES = 5;
/** Largo maximo de una URL de script guardada (las de bundles son largas). */
const MAX_URL = 120;
/** Cuanto se ensancha la ventana de un tiron al buscar el long-animation-frame que lo causo (2 frames). El rAF que cierra el tiron cae un vsync despues del loaf. */
const MARGEN_ATRIBUCION_MS = 34;

/** Histograma de duraciones de frame: bins de 0,25 ms hasta 500 ms, mas un bin de desborde. */
const ANCHO_BIN_MS = 0.25;
const BINS = 2000;

/** Limites superiores (inclusivos) de las cubetas del histograma chico; la ultima es "mas de 100". */
const LIMITES_CUBETAS_MS = [17, 20, 25, 33, 50, 100] as const;
const NOMBRES_CUBETAS = ['0-17', '17-20', '20-25', '25-33', '33-50', '50-100', '>100'] as const;

/** Muestras (instante de juego, golpes juzgados) por frame para contar los golpes de los ultimos 500 ms. */
const MUESTRAS = 512;

export interface FuenteDeScript {
  url: string;
  funcion: string;
  ms: number;
}

export interface DetalleLoaf {
  scriptMs: number;
  estiloLayoutMs: number;
  bloqueoMs: number;
  fuentes: FuenteDeScript[];
}

export interface Tiron {
  /**
   * ms de reloj de juego del primer frame despues del tiron (el que lo detecta);
   * el tiron ocurrio justo antes, durante `duracionMs`.
   */
  tJuego: number;
  /** Duracion del frame (rAF timestamp a timestamp). */
  duracionMs: number;
  /**
   * De long-animation-frame si el navegador lo da: tiempo de script, de
   * estilo/layout (hasta el cierre del frame), bloqueo, y las fuentes de script
   * mas largas (sourceURL, sourceFunctionName, duration), truncadas a 5.
   */
  loaf?: DetalleLoaf;
  /** Notas en pantalla en ese frame (densidad del momento). */
  notasVisibles?: number;
  /** Golpes juzgados (incluidos los miss) en los 500 ms de reloj de juego anteriores a ese frame. */
  golpesRecientes?: number;
  /** De longtask: la tarea larga que mas se solapa con el tiron, en ms (si el navegador la da). */
  tareaLargaMs?: number;
}

/** Lo que usa este modulo de una entrada `long-animation-frame` (ver PerformanceLongAnimationFrameTiming). */
export interface EntradaLoaf {
  startTime: number;
  duration: number;
  blockingDuration: number;
  styleAndLayoutStart: number;
  scripts: readonly { sourceURL: string; sourceFunctionName: string; duration: number }[];
}

/** Lo que usa este modulo de una entrada `longtask`. */
export interface EntradaTareaLarga {
  startTime: number;
  duration: number;
}

export interface ContextoDiagnostico {
  userAgent: string;
  /** UNMASKED_RENDERER de WebGL; `null` si no hubo tirones (no se consulta) o el navegador no lo da. */
  renderer: string | null;
  devicePixelRatio: number;
  ventana: { ancho: number; alto: number };
  baseLatency: number | null;
  outputLatency: number | null;
  skin: string;
  atenuacion: number;
  video: boolean;
  contadores: { teclas: boolean; juicios: boolean; barraDeError: boolean };
  bajaLatencia: boolean;
  mapa: { titulo: string; dificultad: string; notas: number };
  /** La ventana perdio el foco (`blur`) en algun momento de la partida. */
  perdioElFoco: boolean;
  /** La pestana se oculto (`visibilitychange`) en algun momento de la partida. */
  pestanaOculta: boolean;
  /** Que observers daba el navegador: sin long-animation-frame no hay atribucion de script. */
  observadores: { longAnimationFrame: boolean; longTask: boolean };
}

/** Cuantos frames cayeron en cada cubeta de duracion (limite superior inclusivo, en ms). */
export type HistogramaDeFrames = Record<(typeof NOMBRES_CUBETAS)[number], number>;

/**
 * De los tirones de mas de 50 ms (los unicos que pueden traer long-animation-frame)
 * guardados con detalle: cuantos traen script atribuido, cuantos tienen un loaf
 * pero ningun script que lo explique (el cuello esta en GPU, composicion o el
 * sistema) y cuantos no tienen loaf (el navegador no lo da o no lo entrego).
 */
export interface AtribucionDeTirones {
  mayor50: number;
  conScript: number;
  loafSinScript: number;
  sinLoaf: number;
  /** conScript / mayor50 (0 si no hubo ninguno). */
  proporcionConScript: number;
}

export interface ResumenDiagnostico {
  version: 1;
  contexto: ContextoDiagnostico;
  frames: number;
  conteos: { mayor20: number; mayor33: number; mayor50: number };
  histograma: HistogramaDeFrames;
  atribucion: AtribucionDeTirones;
  p50Ms: number;
  p99Ms: number;
  peorMs: number;
  /** Todos los frames de mas de `UMBRAL_TIRON_MS`; `tirones` guarda con detalle los primeros `TOPE_TIRONES`. */
  tironesTotal: number;
  tirones: Tiron[];
}

export interface RegistroDeFrames {
  /**
   * Un frame ya dibujado. `tJuego` es `clock.now()` y `tsRaf` el timestamp que
   * recibe el callback de requestAnimationFrame (solo diagnostico). Devuelve el
   * `Tiron` si el frame duro mas que `UMBRAL_TIRON_MS` y `null` el resto de las
   * veces (sin crear ningun objeto).
   */
  frame(tJuego: Ms, tsRaf: number): Tiron | null;
  /**
   * El proximo frame no cuenta: rAF estuvo detenido a proposito (pausa del juego, pestana
   * oculta) y ese hueco no es un tiron. No se deduce del reloj de juego: en un bloqueo de
   * verdad el reloj de audio tambien se atrasa y se pone al dia en el frame siguiente.
   */
  descartarProximo(): void;
  agregarLoaf(entrada: EntradaLoaf): void;
  agregarTareaLarga(entrada: EntradaTareaLarga): void;
  /** Cierra la cuenta: estadisticas de frames y los tirones con la atribucion que se pudo hacer. */
  resumir(): Omit<ResumenDiagnostico, 'version' | 'contexto'>;
}

// Posiciones del estado numerico (un Float64Array: escribir ahi no aloca, una `let` numerica si puede).
const TS_ANTERIOR = 0;
const DESCARTAR = 2;
const FRAMES = 3;
const MAYOR_20 = 4;
const MAYOR_33 = 5;
const MAYOR_50 = 6;
const PEOR = 7;
const TIRONES_TOTAL = 8;
const MUESTRA_SIGUIENTE = 9;
const CAMPOS = 10;

function redondear1(valor: number): number {
  return Math.round(valor * 10) / 10;
}

function solape(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * Percentil `p` (0 a 1) del histograma: el centro del primer bin donde la suma
 * acumulada llega a `p` de los frames. Si cae en el bin de desborde (mas de
 * 500 ms) se devuelve el peor frame visto.
 */
function percentil(histograma: Uint32Array, total: number, p: number, peor: number): number {
  if (total === 0) return 0;
  const objetivo = Math.max(1, Math.ceil(total * p));
  let acumulado = 0;
  for (let bin = 0; bin < BINS; bin++) {
    acumulado += histograma[bin] ?? 0;
    if (acumulado >= objetivo) return redondear1((bin + 0.5) * ANCHO_BIN_MS);
  }
  return redondear1(peor);
}

function detalleDeLoaf(entrada: EntradaLoaf): DetalleLoaf {
  let scriptMs = 0;
  for (const s of entrada.scripts) scriptMs += s.duration;
  const fuentes = [...entrada.scripts]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, MAX_FUENTES)
    .map((s) => ({
      url: s.sourceURL.slice(0, MAX_URL),
      funcion: s.sourceFunctionName,
      ms: redondear1(s.duration),
    }));
  const finDelFrame = entrada.startTime + entrada.duration;
  return {
    scriptMs: redondear1(scriptMs),
    estiloLayoutMs:
      entrada.styleAndLayoutStart > 0 ? redondear1(Math.max(0, finDelFrame - entrada.styleAndLayoutStart)) : 0,
    bloqueoMs: redondear1(entrada.blockingDuration),
    fuentes,
  };
}

export interface FuentesDeDensidad {
  /** Notas en pantalla en el instante de juego dado; se llama solo al registrar un tiron. */
  notasVisibles?: (tJuego: Ms) => number;
  /** Golpes juzgados desde el principio de la partida (suma de contadores); se llama en cada frame, sin allocar. */
  juzgados?: () => number;
}

function cubetaDe(duracion: number): number {
  for (let i = 0; i < LIMITES_CUBETAS_MS.length; i++) {
    if (duracion <= LIMITES_CUBETAS_MS[i]!) return i;
  }
  return LIMITES_CUBETAS_MS.length;
}

/**
 * La densidad de cada tiron sale de `fuentes`: las notas visibles se piden solo
 * al registrar un tiron; los golpes recientes salen de una muestra por frame
 * (instante de juego y total juzgado) en un anillo preasignado.
 */
export function crearRegistroDeFrames(fuentes: FuentesDeDensidad = {}): RegistroDeFrames {
  const { notasVisibles, juzgados } = fuentes;
  const estado = new Float64Array(CAMPOS);
  const histograma = new Uint32Array(BINS + 1);
  const cubetas = new Uint32Array(NOMBRES_CUBETAS.length);
  // Anillo de muestras: [t0, juzgados0, t1, juzgados1, ...].
  const muestras = new Float64Array(MUESTRAS * 2);
  const tirones: Tiron[] = [];
  // Ventana [desde, hasta] en timestamps de rAF de cada tiron guardado, para buscarles el loaf.
  const ventanas = new Float64Array(TOPE_TIRONES * 2);
  const loafs: EntradaLoaf[] = [];
  const tareasLargas: EntradaTareaLarga[] = [];

  /** Golpes juzgados entre la muestra mas vieja dentro de los ultimos 500 ms y la actual. */
  function golpesRecientes(): number {
    const siguiente = estado[MUESTRA_SIGUIENTE]!;
    const actual = siguiente - 1;
    const tActual = muestras[(actual % MUESTRAS) * 2]!;
    const total = muestras[(actual % MUESTRAS) * 2 + 1]!;
    let base = total;
    for (let k = actual - 1; k >= Math.max(0, siguiente - MUESTRAS); k--) {
      if (tActual - muestras[(k % MUESTRAS) * 2]! > VENTANA_GOLPES_MS) break;
      base = muestras[(k % MUESTRAS) * 2 + 1]!;
    }
    return total - base;
  }

  return {
    frame(tJuego, tsRaf) {
      const tsAnterior = estado[TS_ANTERIOR]!;
      const descartar = estado[DESCARTAR] === 1;
      if (juzgados !== undefined) {
        const i = estado[MUESTRA_SIGUIENTE]!;
        muestras[(i % MUESTRAS) * 2] = tJuego;
        muestras[(i % MUESTRAS) * 2 + 1] = juzgados();
        estado[MUESTRA_SIGUIENTE] = i + 1;
      }
      estado[TS_ANTERIOR] = tsRaf;
      estado[DESCARTAR] = 0;

      // El primer frame (o uno con timestamp raro) es solo la referencia del siguiente.
      if (!(tsAnterior > 0) || !(tsRaf > tsAnterior) || descartar) return null;
      const duracion = tsRaf - tsAnterior;

      estado[FRAMES]! += 1;
      histograma[Math.min(BINS, Math.floor(duracion / ANCHO_BIN_MS))]! += 1;
      cubetas[cubetaDe(duracion)]! += 1;
      if (duracion > estado[PEOR]!) estado[PEOR] = duracion;
      if (duracion > 20) estado[MAYOR_20]! += 1;
      if (duracion > 33) estado[MAYOR_33]! += 1;
      if (duracion > UMBRAL_LOAF_MS) estado[MAYOR_50]! += 1;
      if (duracion <= UMBRAL_TIRON_MS) return null;

      estado[TIRONES_TOTAL]! += 1;
      const tiron: Tiron = { tJuego: redondear1(tJuego), duracionMs: redondear1(duracion) };
      const visibles = notasVisibles?.(tJuego);
      if (visibles !== undefined) tiron.notasVisibles = visibles;
      if (juzgados !== undefined) tiron.golpesRecientes = golpesRecientes();
      if (tirones.length < TOPE_TIRONES) {
        ventanas[tirones.length * 2] = tsAnterior;
        ventanas[tirones.length * 2 + 1] = tsRaf;
        tirones.push(tiron);
      }
      return tiron;
    },

    descartarProximo() {
      estado[DESCARTAR] = 1;
    },

    agregarLoaf(entrada) {
      if (loafs.length < TOPE_TIRONES * 2) loafs.push(entrada);
    },

    agregarTareaLarga(entrada) {
      if (tareasLargas.length < TOPE_TIRONES * 2) tareasLargas.push(entrada);
    },

    resumir() {
      const frames = estado[FRAMES]!;
      const peor = estado[PEOR]!;
      // Cada entrada se le asigna al tiron en cuya ventana cabe y con el que mas se solapa (asi dos
      // tirones seguidos no se reparten el mismo loaf), y cada tiron se queda con la que mas se le solapa.
      const asignarEntradas = <T extends { startTime: number; duration: number }>(
        entradas: readonly T[],
      ): (T | undefined)[] => {
        const elegida: (T | undefined)[] = new Array<T | undefined>(tirones.length).fill(undefined);
        const solapeElegido: number[] = new Array<number>(tirones.length).fill(0);
        for (const entrada of entradas) {
          let mejor = -1;
          let mejorSolape = 0;
          for (let i = 0; i < tirones.length; i++) {
            const desde = ventanas[i * 2]! - MARGEN_ATRIBUCION_MS;
            const hasta = ventanas[i * 2 + 1]! + MARGEN_ATRIBUCION_MS;
            const finEntrada = entrada.startTime + entrada.duration;
            // Un frame lento que explica el tiron cabe en su ventana: uno que arranca mucho antes
            // (la carga inicial, otro tiron) no es la causa aunque se le solape.
            if (entrada.startTime < desde || finEntrada > hasta) continue;
            const s = solape(desde, hasta, entrada.startTime, finEntrada);
            if (s > mejorSolape) {
              mejorSolape = s;
              mejor = i;
            }
          }
          if (mejor >= 0 && mejorSolape > solapeElegido[mejor]!) {
            solapeElegido[mejor] = mejorSolape;
            elegida[mejor] = entrada;
          }
        }
        return elegida;
      };
      const loafPorTiron = asignarEntradas(loafs);
      const tareaPorTiron = asignarEntradas(tareasLargas);
      tirones.forEach((tiron, i) => {
        const loaf = loafPorTiron[i];
        if (loaf !== undefined) tiron.loaf = detalleDeLoaf(loaf);
        const tarea = tareaPorTiron[i];
        if (tarea !== undefined) tiron.tareaLargaMs = redondear1(tarea.duration);
      });
      const atribucion: AtribucionDeTirones = {
        mayor50: 0,
        conScript: 0,
        loafSinScript: 0,
        sinLoaf: 0,
        proporcionConScript: 0,
      };
      for (const tiron of tirones) {
        if (tiron.duracionMs <= UMBRAL_LOAF_MS) continue;
        atribucion.mayor50++;
        if (tiron.loaf === undefined) atribucion.sinLoaf++;
        else if (tiron.loaf.scriptMs > 0) atribucion.conScript++;
        else atribucion.loafSinScript++;
      }
      if (atribucion.mayor50 > 0) {
        atribucion.proporcionConScript =
          Math.round((atribucion.conScript / atribucion.mayor50) * 100) / 100;
      }
      const histogramaChico = {} as HistogramaDeFrames;
      NOMBRES_CUBETAS.forEach((nombre, i) => {
        histogramaChico[nombre] = cubetas[i]!;
      });
      return {
        frames,
        conteos: {
          mayor20: estado[MAYOR_20]!,
          mayor33: estado[MAYOR_33]!,
          mayor50: estado[MAYOR_50]!,
        },
        histograma: histogramaChico,
        atribucion,
        p50Ms: percentil(histograma, frames, 0.5, peor),
        p99Ms: percentil(histograma, frames, 0.99, peor),
        peorMs: redondear1(peor),
        tironesTotal: estado[TIRONES_TOTAL]!,
        tirones,
      };
    },
  };
}

/**
 * Cuantas notas hay entre `tJuego` y `tJuego + scrollDuration` (las que estan en
 * pantalla arriba del receptor). `notas` va ordenado por tiempo ascendente
 * (invariante del chart): busqueda binaria, no recorre todo el mapa.
 */
export function contarNotasVisibles(
  notas: readonly { time: Ms }[],
  tJuego: Ms,
  scrollDuration: Ms,
): number {
  const primera = primeraDesde(notas, tJuego);
  const fin = primeraDesde(notas, tJuego + scrollDuration);
  return fin - primera;
}

/** Indice de la primera nota con `time >= t` (`notas.length` si no hay). */
function primeraDesde(notas: readonly { time: Ms }[], t: Ms): number {
  let bajo = 0;
  let alto = notas.length;
  while (bajo < alto) {
    const medio = (bajo + alto) >> 1;
    if (notas[medio]!.time < t) bajo = medio + 1;
    else alto = medio;
  }
  return bajo;
}

/** "38,0 s": segundos con un decimal y coma decimal. */
export function formatearSegundos(ms: Ms): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

function formatearMs(ms: number): string {
  return `${Math.round(ms)} ms`;
}

function elPeor(tirones: readonly Tiron[]): Tiron | undefined {
  let peor: Tiron | undefined;
  for (const t of tirones) if (peor === undefined || t.duracionMs > peor.duracionMs) peor = t;
  return peor;
}

/**
 * La linea chica de los resultados:
 * "412 frames > 30 ms · 9 > 50 ms · peor 133 ms a 38,0 s". `null` si no hubo
 * ningun frame de mas de 30 ms (en ese caso los resultados no muestran nada).
 */
export function lineaDeTirones(resumen: ResumenDiagnostico): string | null {
  if (resumen.tironesTotal === 0) return null;
  const cuenta = `${resumen.tironesTotal} ${resumen.tironesTotal === 1 ? 'frame' : 'frames'} > 30 ms`;
  const peor = elPeor(resumen.tirones);
  const mayor50 = `${resumen.conteos.mayor50} > 50 ms`;
  if (peor === undefined) return `${cuenta} · ${mayor50}`;
  return `${cuenta} · ${mayor50} · peor ${formatearMs(peor.duracionMs)} a ${formatearSegundos(peor.tJuego)}`;
}

/** Los 10 peores tirones (de mayor a menor duracion), uno por linea, para el `title` de la linea. */
export function detalleDeTirones(resumen: ResumenDiagnostico, maximo = 10): string {
  const peores = [...resumen.tirones].sort((a, b) => b.duracionMs - a.duracionMs).slice(0, maximo);
  const lineas = peores.map((t) => `${formatearSegundos(t.tJuego)} · ${formatearMs(t.duracionMs)}`);
  const resto = resumen.tironesTotal - lineas.length;
  if (resto > 0) lineas.push(`y ${resto} más`);
  return lineas.join('\n');
}
