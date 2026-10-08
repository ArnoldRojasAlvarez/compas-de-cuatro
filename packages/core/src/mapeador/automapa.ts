// Mapeo automatico: de onsets detectados a notas jugables. Pura y
// determinista (misma entrada y misma `semilla`, mismas notas).
//
// Pasos:
//   1. Cada onset se cuantiza al slot mas cercano de la grilla (grilla.ts).
//   2. Se descartan los mas debiles hasta respetar la densidad objetivo del
//      nivel (notas por segundo, por ventana de 2 s) y la separacion minima.
//   3. Cada fila recibe columnas: alterna manos, evita jacks cuando la
//      separacion es corta, y los onsets mas fuertes pueden ser acordes.
//   4. Opcionalmente, los huecos largos se llenan con notas largas.

import type { Column, HoldNote, Ms, Note, TapNote } from '../types.js';
import type { Grilla } from './grilla.js';
import { duracionPulso, duracionSlot, tiempoDeSlot, slotMasCercano } from './grilla.js';
import type { Onset } from './onsets.js';

export type NivelAuto = 'facil' | 'normal' | 'dificil' | 'experto';

export interface PresetAuto {
  nombre: string;
  /** Notas por segundo objetivo (techo, por ventana de 2 s). */
  nps: number;
  /** Separacion minima entre filas, en pulsos. */
  separacionMinPulsos: number;
  /** Fraccion de las filas mas fuertes que pueden ser acordes de dos notas. */
  fraccionDobles: number;
  /** Fraccion de los dobles que pasan a ser triples (solo si hay mas de 2 columnas libres). */
  fraccionTriples: number;
  /** Probabilidad de repetir columna (jack) cuando la separacion lo permite. */
  probJack: number;
  /** Fraccion de los huecos largos que se llenan con una nota larga (si estan activadas). */
  fraccionLargas: number;
  overallDifficulty: number;
  hpDrain: number;
}

export const PRESETS_AUTO: Readonly<Record<NivelAuto, PresetAuto>> = {
  facil: {
    nombre: 'Fácil',
    nps: 1.6,
    separacionMinPulsos: 1,
    fraccionDobles: 0,
    fraccionTriples: 0,
    probJack: 0,
    fraccionLargas: 0.3,
    overallDifficulty: 5,
    hpDrain: 4,
  },
  normal: {
    nombre: 'Normal',
    nps: 2.8,
    separacionMinPulsos: 0.5,
    fraccionDobles: 0.08,
    fraccionTriples: 0,
    probJack: 0.05,
    fraccionLargas: 0.35,
    overallDifficulty: 6.5,
    hpDrain: 5,
  },
  dificil: {
    nombre: 'Difícil',
    nps: 4.8,
    separacionMinPulsos: 0.25,
    fraccionDobles: 0.18,
    fraccionTriples: 0.05,
    probJack: 0.15,
    fraccionLargas: 0.35,
    overallDifficulty: 7.5,
    hpDrain: 6,
  },
  experto: {
    nps: 7.5,
    nombre: 'Experto',
    separacionMinPulsos: 0.25,
    fraccionDobles: 0.3,
    fraccionTriples: 0.12,
    probJack: 0.3,
    fraccionLargas: 0.3,
    overallDifficulty: 8.5,
    hpDrain: 7,
  },
};

export interface OpcionesAutomapa {
  nivel: NivelAuto;
  /** Multiplica la densidad del preset (0.5 a 1.5 es lo razonable). Default 1. */
  densidad?: number;
  /** Llenar huecos largos con notas largas. Default false. */
  notasLargas?: boolean;
  /** Semilla del generador pseudoaleatorio. Default 1. */
  semilla?: number;
}

/** Generador pseudoaleatorio chico y determinista. */
export function crearAleatorio(semilla: number): () => number {
  let a = semilla >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Candidato {
  slot: number;
  fuerza: number;
}

const VENTANA_MS = 2000;

/** Pasos 1 y 2: onsets a slots, con densidad y separacion respetadas. */
export function elegirSlots(
  onsets: readonly Onset[],
  grilla: Grilla,
  preset: PresetAuto,
  densidad: number,
): Candidato[] {
  // Cuantizar y fusionar los que caen en el mismo slot (gana el mas fuerte).
  const porSlot = new Map<number, number>();
  for (const o of onsets) {
    const slot = slotMasCercano(grilla, o.time);
    const previo = porSlot.get(slot);
    if (previo === undefined || o.fuerza > previo) porSlot.set(slot, o.fuerza);
  }
  const candidatos: Candidato[] = [...porSlot].map(([slot, fuerza]) => ({ slot, fuerza }));

  // Cuota por ventana: se queda con los mas fuertes de cada ventana de 2 s.
  const cuota = Math.max(1, Math.round(preset.nps * densidad * (VENTANA_MS / 1000)));
  const porVentana = new Map<number, Candidato[]>();
  for (const c of candidatos) {
    const ventana = Math.floor(tiempoDeSlot(grilla, c.slot) / VENTANA_MS);
    const lista = porVentana.get(ventana);
    if (lista) lista.push(c);
    else porVentana.set(ventana, [c]);
  }
  let preseleccion: Candidato[] = [];
  for (const lista of porVentana.values()) {
    lista.sort((a, b) => b.fuerza - a.fuerza || a.slot - b.slot);
    preseleccion = preseleccion.concat(lista.slice(0, cuota));
  }

  // Separacion minima, de mas fuerte a mas debil.
  const separacionSlots = Math.max(
    1,
    Math.round(preset.separacionMinPulsos * grilla.divisor),
  );
  preseleccion.sort((a, b) => b.fuerza - a.fuerza || a.slot - b.slot);
  const aceptados: Candidato[] = [];
  const ocupados: number[] = [];
  for (const c of preseleccion) {
    let libre = true;
    for (const s of ocupados) {
      if (Math.abs(s - c.slot) < separacionSlots) {
        libre = false;
        break;
      }
    }
    if (libre) {
      aceptados.push(c);
      ocupados.push(c.slot);
    }
  }
  aceptados.sort((a, b) => a.slot - b.slot);
  return aceptados;
}

const COLUMNAS: readonly Column[] = [0, 1, 2, 3];

function mano(columna: number): 0 | 1 {
  return columna < 2 ? 0 : 1;
}

/** Genera las notas del mapa. Devuelve las notas ordenadas por tiempo. */
export function generarNotas(
  onsets: readonly Onset[],
  grilla: Grilla,
  opciones: OpcionesAutomapa,
): Note[] {
  const preset = PRESETS_AUTO[opciones.nivel];
  const densidad = opciones.densidad ?? 1;
  const aleatorio = crearAleatorio(opciones.semilla ?? 1);
  const filas = elegirSlots(onsets, grilla, preset, densidad);
  if (filas.length === 0) return [];

  // Umbral de fuerza para dobles: el percentil (1 - fraccionDobles) de las filas.
  const fuerzas = filas.map((f) => f.fuerza).sort((a, b) => a - b);
  const umbralDoble =
    preset.fraccionDobles <= 0
      ? Infinity
      : (fuerzas[Math.min(fuerzas.length - 1, Math.floor(fuerzas.length * (1 - preset.fraccionDobles)))] ?? 1);

  const ocupadoHasta: Ms[] = [-Infinity, -Infinity, -Infinity, -Infinity];
  const notas: Note[] = [];
  let ultimaMascara = 0;
  let ultimaMano: 0 | 1 = 1;
  let ultimoSlot = -Infinity;
  const slotMs = duracionSlot(grilla);
  const pulsoMs = duracionPulso(grilla.bpm);

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i]!;
    const time = tiempoDeSlot(grilla, fila.slot);
    const brecha = (fila.slot - ultimoSlot) * slotMs;
    const jackPermitido = brecha >= pulsoMs * 0.5 && aleatorio() < preset.probJack;

    const libres = COLUMNAS.filter((c) => ocupadoHasta[c]! <= time);
    if (libres.length === 0) continue;

    // Cuantas notas tiene esta fila.
    let cantidad = 1;
    if (fila.fuerza >= umbralDoble && libres.length >= 2) {
      cantidad = 2;
      if (libres.length >= 3 && aleatorio() < preset.fraccionTriples) cantidad = 3;
    }

    const elegidas: Column[] = [];
    const sinJack = libres.filter((c) => (ultimaMascara & (1 << c)) === 0);
    const reserva = jackPermitido || sinJack.length === 0 ? libres : sinJack;

    if (cantidad === 1) {
      // Prefiere la mano opuesta a la ultima (alternar), con un poco de azar.
      const opuesta = reserva.filter((c) => mano(c) !== ultimaMano);
      const conjunto = opuesta.length > 0 && aleatorio() < 0.7 ? opuesta : reserva;
      elegidas.push(conjunto[Math.floor(aleatorio() * conjunto.length)]!);
    } else {
      // Dobles: una nota por mano casi siempre.
      const izq = reserva.filter((c) => mano(c) === 0);
      const der = reserva.filter((c) => mano(c) === 1);
      if (izq.length > 0 && der.length > 0 && (cantidad === 2 ? aleatorio() < 0.85 : true)) {
        elegidas.push(izq[Math.floor(aleatorio() * izq.length)]!);
        elegidas.push(der[Math.floor(aleatorio() * der.length)]!);
      } else {
        const barajadas = [...reserva].sort(() => aleatorio() - 0.5);
        elegidas.push(barajadas[0]!, barajadas[1]!);
      }
      if (cantidad === 3) {
        const resto = libres.filter((c) => !elegidas.includes(c));
        if (resto.length > 0) elegidas.push(resto[Math.floor(aleatorio() * resto.length)]!);
      }
    }

    // Nota larga: solo en filas de una nota, si el hueco hasta la siguiente
    // fila da al menos un pulso entero.
    let finLargo: Ms | null = null;
    if (opciones.notasLargas && elegidas.length === 1) {
      const siguiente = filas[i + 1];
      const hueco = siguiente
        ? (siguiente.slot - fila.slot) * slotMs
        : pulsoMs * 2;
      if (hueco >= pulsoMs && aleatorio() < preset.fraccionLargas) {
        const slotsDeLargo = Math.max(
          1,
          Math.floor(hueco / slotMs) - Math.max(1, Math.round(grilla.divisor / 2)),
        );
        if (slotsDeLargo * slotMs >= pulsoMs * 0.5) {
          finLargo = time + slotsDeLargo * slotMs;
        }
      }
    }

    let mascara = 0;
    for (const columna of elegidas) {
      mascara |= 1 << columna;
      if (finLargo !== null) {
        const larga: HoldNote = { kind: 'hold', time, endTime: finLargo, column: columna };
        notas.push(larga);
        ocupadoHasta[columna] = finLargo + slotMs;
      } else {
        const simple: TapNote = { kind: 'tap', time, column: columna };
        notas.push(simple);
        ocupadoHasta[columna] = time;
      }
    }
    ultimaMascara = mascara;
    ultimaMano = mano(elegidas[elegidas.length - 1]!);
    ultimoSlot = fila.slot;
  }

  notas.sort((a, b) => a.time - b.time || a.column - b.column);
  return notas;
}
