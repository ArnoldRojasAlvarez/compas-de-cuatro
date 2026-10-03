// Logica pura del mapeador (sin DOM ni audio): operaciones sobre las notas,
// historial de deshacer, geometria de la vista, borrador y armado del Chart.
// La pantalla (mapeador.ts) solo dibuja y reenvia eventos a estas funciones,
// y por eso se puede probar casi todo en vitest sin navegador.

import type { Chart, Column, Grilla, HoldNote, Ms, Note } from '@tetra/core';
import { slotMasCercano, tiempoDeSlot } from '@tetra/core';

// ---------------------------------------------------------------------------
// Notas
// ---------------------------------------------------------------------------

/** Tiempo de una nota en ms enteros: lo que se escribe en el .osu y lo que se juega. */
export function redondear(time: Ms): Ms {
  return Math.round(time);
}

/** Tiempo del slot, ya redondeado a ms entero. */
export function tiempoDeSlotEntero(grilla: Grilla, slot: number): Ms {
  return redondear(tiempoDeSlot(grilla, slot));
}

function finDe(nota: Note): Ms {
  return nota.kind === 'hold' ? nota.endTime : nota.time;
}

function ordenar(notas: readonly Note[]): Note[] {
  return [...notas].sort((a, b) => a.time - b.time || a.column - b.column);
}

/** Nota de `columna` que ocupa el instante `time` (el tap exacto o una larga que lo contiene). */
export function notaEn(notas: readonly Note[], columna: Column, time: Ms, tolerancia = 0.5): Note | undefined {
  return notas.find(
    (n) => n.column === columna && time >= n.time - tolerancia && time <= finDe(n) + tolerancia,
  );
}

/**
 * Pone un tap en (`columna`, `time`). Si ya habia una nota que ocupa ese
 * lugar, la quita (alternar). Devuelve el arreglo nuevo, el original no se toca.
 */
export function alternarTap(notas: readonly Note[], columna: Column, time: Ms): Note[] {
  const t = redondear(time);
  const existente = notaEn(notas, columna, t);
  if (existente) return notas.filter((n) => n !== existente);
  return ordenar([...notas, { kind: 'tap', time: t, column: columna }]);
}

/** Como alternarTap pero nunca quita: lo usa la grabacion en vivo (tocar D F J K mientras suena). */
export function agregarTap(notas: readonly Note[], columna: Column, time: Ms): Note[] {
  const t = redondear(time);
  if (notaEn(notas, columna, t)) return [...notas];
  return ordenar([...notas, { kind: 'tap', time: t, column: columna }]);
}

/**
 * Pone una nota larga entre `inicio` y `fin` (en cualquier orden). Borra lo
 * que hubiera en esa columna dentro del intervalo, para no dejar notas
 * solapadas. Si el intervalo queda vacio se pone un tap.
 */
export function colocarLarga(notas: readonly Note[], columna: Column, inicio: Ms, fin: Ms): Note[] {
  const a = redondear(Math.min(inicio, fin));
  const b = redondear(Math.max(inicio, fin));
  if (b <= a) return alternarTap(notas, columna, a);
  const resto = notas.filter((n) => !(n.column === columna && n.time <= b && finDe(n) >= a));
  const larga: HoldNote = { kind: 'hold', time: a, endTime: b, column: columna };
  return ordenar([...resto, larga]);
}

/** Quita la nota que ocupa (`columna`, `time`), si hay. */
export function quitarNota(notas: readonly Note[], columna: Column, time: Ms): Note[] {
  const existente = notaEn(notas, columna, redondear(time));
  return existente ? notas.filter((n) => n !== existente) : [...notas];
}

/** Quita todas las notas entre `desde` y `hasta` (inclusive). */
export function quitarRango(notas: readonly Note[], desde: Ms, hasta: Ms): Note[] {
  return notas.filter((n) => !(n.time <= hasta && finDe(n) >= desde));
}

/**
 * Espeja las columnas (0<->3, 1<->2): util para variar un patron o para que
 * el automatico no cargue siempre la misma mano.
 */
export function espejar(notas: readonly Note[]): Note[] {
  return notas.map((n) => ({ ...n, column: (3 - n.column) as Column }));
}

export interface ResumenNotas {
  total: number;
  taps: number;
  largas: number;
  /** Notas por segundo promedio, 0 si no hay duracion. */
  nps: number;
  /** Tiempo de la ultima nota, 0 si no hay. */
  finMs: Ms;
}

export function resumirNotas(notas: readonly Note[]): ResumenNotas {
  let largas = 0;
  let finMs = 0;
  let inicio = Infinity;
  for (const n of notas) {
    if (n.kind === 'hold') largas++;
    finMs = Math.max(finMs, finDe(n));
    inicio = Math.min(inicio, n.time);
  }
  const duracion = notas.length === 0 ? 0 : (finMs - inicio) / 1000;
  return {
    total: notas.length,
    taps: notas.length - largas,
    largas,
    nps: duracion > 0 ? notas.length / duracion : 0,
    finMs,
  };
}

// ---------------------------------------------------------------------------
// Historial (deshacer / rehacer)
// ---------------------------------------------------------------------------

export interface Historial<T> {
  readonly actual: T;
  readonly puedeDeshacer: boolean;
  readonly puedeRehacer: boolean;
  /** Registra un estado nuevo. Si es identico (===) al actual no hace nada. */
  registrar(estado: T): void;
  deshacer(): T;
  rehacer(): T;
}

/** Historial acotado: guarda como mucho `limite` estados hacia atras. */
export function crearHistorial<T>(inicial: T, limite = 200): Historial<T> {
  const pasado: T[] = [];
  let futuro: T[] = [];
  let actual = inicial;
  return {
    get actual() {
      return actual;
    },
    get puedeDeshacer() {
      return pasado.length > 0;
    },
    get puedeRehacer() {
      return futuro.length > 0;
    },
    registrar(estado) {
      if (estado === actual) return;
      pasado.push(actual);
      if (pasado.length > limite) pasado.shift();
      futuro = [];
      actual = estado;
    },
    deshacer() {
      const previo = pasado.pop();
      if (previo !== undefined) {
        futuro.push(actual);
        actual = previo;
      }
      return actual;
    },
    rehacer() {
      const siguiente = futuro.pop();
      if (siguiente !== undefined) {
        pasado.push(actual);
        actual = siguiente;
      }
      return actual;
    },
  };
}

// ---------------------------------------------------------------------------
// Vista: tiempo <-> pixel
// ---------------------------------------------------------------------------

export interface Vista {
  /** Tiempo (ms) que esta justo sobre la linea del cabezal. */
  tiempo: Ms;
  /** Pixeles por ms: el zoom. */
  pxPorMs: number;
  /** Y (px) de la linea del cabezal. El futuro queda arriba, como en la partida. */
  yCabezal: number;
}

export const ZOOM_MIN = 0.08;
export const ZOOM_MAX = 1.2;

export function limitarZoom(pxPorMs: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pxPorMs));
}

export function yDeTiempo(vista: Vista, time: Ms): number {
  return vista.yCabezal - (time - vista.tiempo) * vista.pxPorMs;
}

export function tiempoDeY(vista: Vista, y: number): Ms {
  return vista.tiempo + (vista.yCabezal - y) / vista.pxPorMs;
}

/** Columna bajo la coordenada x, o `null` si cae fuera de las cuatro pistas. */
export function columnaDeX(x: number, izquierda: number, anchoColumna: number): Column | null {
  const indice = Math.floor((x - izquierda) / anchoColumna);
  return indice >= 0 && indice < 4 ? (indice as Column) : null;
}

/** Slot al que apunta el mouse en `y`, ajustado a la grilla. */
export function slotDeY(vista: Vista, grilla: Grilla, y: number): number {
  return slotMasCercano(grilla, tiempoDeY(vista, y));
}

// ---------------------------------------------------------------------------
// Onda de audio
// ---------------------------------------------------------------------------

/**
 * Picos de amplitud por cubeta de `msPorCubeta`: lo que se dibuja como onda
 * detras de las pistas. Una cubeta guarda el maximo de |muestra| (0 a 1).
 */
export function calcularPicos(muestras: Float32Array, sampleRate: number, msPorCubeta: Ms): Float32Array {
  const porCubeta = Math.max(1, Math.round((sampleRate * msPorCubeta) / 1000));
  const cubetas = Math.ceil(muestras.length / porCubeta);
  const picos = new Float32Array(cubetas);
  for (let c = 0; c < cubetas; c++) {
    let max = 0;
    const fin = Math.min(muestras.length, (c + 1) * porCubeta);
    for (let i = c * porCubeta; i < fin; i++) {
      const v = Math.abs(muestras[i]!);
      if (v > max) max = v;
    }
    picos[c] = max;
  }
  return picos;
}

/** Mezcla un audio de varios canales a mono (promedio). */
export function mezclarMono(canales: readonly Float32Array[]): Float32Array {
  const primero = canales[0];
  if (!primero) return new Float32Array(0);
  if (canales.length === 1) return primero;
  const mono = new Float32Array(primero.length);
  for (const canal of canales) {
    for (let i = 0; i < mono.length; i++) mono[i]! += canal[i]! / canales.length;
  }
  return mono;
}

// ---------------------------------------------------------------------------
// Chart y borrador
// ---------------------------------------------------------------------------

export interface MetadatosMapa {
  titulo: string;
  artista: string;
  creador: string;
  dificultad: string;
  audioArchivo: string;
}

export interface AjustesMapa {
  overallDifficulty: number;
  hpDrain: number;
}

/** Arma el Chart que se juega y se exporta. Los tiempos salen en ms enteros y ordenados. */
export function construirChart(
  meta: MetadatosMapa,
  grilla: Grilla,
  ajustes: AjustesMapa,
  notas: readonly Note[],
  previewTime: Ms = 0,
): Chart {
  const enteras = ordenar(
    notas.map((n) =>
      n.kind === 'hold'
        ? { ...n, time: redondear(n.time), endTime: redondear(n.endTime) }
        : { ...n, time: redondear(n.time) },
    ),
  );
  return {
    metadata: {
      title: meta.titulo.trim() || 'Sin titulo',
      artist: meta.artista.trim() || 'Desconocido',
      creator: meta.creador.trim() || 'Anonimo',
      difficultyName: meta.dificultad.trim() || 'Normal',
      audioFile: meta.audioArchivo,
      previewTime: redondear(previewTime),
    },
    overallDifficulty: ajustes.overallDifficulty,
    hpDrain: ajustes.hpDrain,
    timingPoints: [{ time: redondear(grilla.offsetMs), bpm: grilla.bpm, meter: 4 }],
    speedPoints: [],
    notes: enteras,
  };
}

export interface Borrador {
  version: 1;
  meta: MetadatosMapa;
  grilla: Grilla;
  ajustes: AjustesMapa;
  notas: Note[];
}

const CLAVE_BORRADOR = 'tetra:mapeador-borrador';

export function guardarBorrador(borrador: Borrador, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(CLAVE_BORRADOR, JSON.stringify(borrador));
    return true;
  } catch {
    return false;
  }
}

function esNota(valor: unknown): valor is Note {
  if (typeof valor !== 'object' || valor === null) return false;
  const n = valor as Record<string, unknown>;
  const columnaValida =
    typeof n.column === 'number' && Number.isInteger(n.column) && n.column >= 0 && n.column <= 3;
  if (!columnaValida || typeof n.time !== 'number' || !Number.isFinite(n.time)) return false;
  if (n.kind === 'tap') return true;
  return (
    n.kind === 'hold' &&
    typeof n.endTime === 'number' &&
    Number.isFinite(n.endTime) &&
    n.endTime > n.time
  );
}

/** Lee el borrador. `null` si no hay, si no es JSON o si no tiene la forma esperada. */
export function leerBorrador(storage: Storage = localStorage): Borrador | null {
  let crudo: string | null;
  try {
    crudo = storage.getItem(CLAVE_BORRADOR);
  } catch {
    return null;
  }
  if (crudo === null) return null;
  try {
    const v = JSON.parse(crudo) as Partial<Borrador> | null;
    if (!v || v.version !== 1 || !v.meta || !v.grilla || !v.ajustes || !Array.isArray(v.notas)) return null;
    const g = v.grilla;
    if (!Number.isFinite(g.bpm) || g.bpm <= 0 || !Number.isFinite(g.offsetMs) || !(g.divisor > 0)) return null;
    if (!v.notas.every(esNota)) return null;
    return v as Borrador;
  } catch {
    return null;
  }
}

export function borrarBorrador(storage: Storage = localStorage): void {
  try {
    storage.removeItem(CLAVE_BORRADOR);
  } catch {
    // sin almacenamiento no hay borrador que borrar.
  }
}

/** Convierte un numero escrito por el usuario; `null` si no es un numero finito. */
export function leerNumero(texto: string): number | null {
  const v = Number(texto.trim().replace(',', '.'));
  return texto.trim() !== '' && Number.isFinite(v) ? v : null;
}
