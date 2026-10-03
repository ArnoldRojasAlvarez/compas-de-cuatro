// Estimacion de BPM y offset a partir de la envolvente de onsets. Pura.
//
// Dos pasos: (1) busqueda gruesa de la grilla de pulsos que mas energia de
// ataque recoge (con un prior suave hacia 125 BPM, porque la mitad y el
// doble de un tempo tambien recogen energia) y (2) refinamiento por minimos
// cuadrados sobre los onsets fuertes, que es lo que evita la deriva: un BPM
// con 0.1 de error corre la grilla 140 ms a los tres minutos.

import type { Ms } from '../types.js';
import type { AnalisisOnsets } from './onsets.js';

export interface EstimacionTempo {
  /** BPM refinado, con decimales. */
  bpm: number;
  /** Tiempo del primer pulso dentro de [0, duracion de un pulso). */
  offsetMs: Ms;
  /** 0 a 1: que tanta parte de los onsets fuertes cae sobre la grilla. */
  confianza: number;
  /** El BPM redondeado a entero si esta a menos de 0.2 de uno, si no el mismo `bpm`. */
  bpmSugerido: number;
}

export interface OpcionesTempo {
  bpmMin?: number;
  bpmMax?: number;
  /** BPM hacia el que tira el prior. Default 125. */
  bpmCentro?: number;
}

function prior(bpm: number, centro: number): number {
  const octavas = Math.log2(bpm / centro);
  return Math.exp(-0.5 * (octavas / 0.6) ** 2);
}

/** Ajuste por minimos cuadrados t = off + n * beat sobre pares (n, t). */
function ajustar(
  pares: readonly { n: number; t: number; peso: number }[],
): { off: number; beat: number } | null {
  if (pares.length < 3) return null;
  let sw = 0;
  let sn = 0;
  let st = 0;
  let snn = 0;
  let snt = 0;
  for (const { n, t, peso } of pares) {
    sw += peso;
    sn += peso * n;
    st += peso * t;
    snn += peso * n * n;
    snt += peso * n * t;
  }
  const den = sw * snn - sn * sn;
  if (Math.abs(den) < 1e-9) return null;
  const beat = (sw * snt - sn * st) / den;
  const off = (st - beat * sn) / sw;
  return { off, beat };
}

/** Estima BPM y offset. Devuelve `null` si no hay onsets suficientes para decidir. */
export function estimarTempo(
  analisis: AnalisisOnsets,
  opciones: OpcionesTempo = {},
): EstimacionTempo | null {
  const bpmMin = opciones.bpmMin ?? 70;
  const bpmMax = opciones.bpmMax ?? 190;
  const centro = opciones.bpmCentro ?? 125;
  const { envolvente, pasoMs, origenMs, onsets } = analisis;
  if (onsets.length < 8 || envolvente.length < 100) return null;

  // Busqueda gruesa sobre la envolvente.
  let mejor = { bpm: 0, fase: 0, puntaje: -1 };
  const largo = envolvente.length;
  for (let bpm = bpmMin; bpm <= bpmMax; bpm += 0.25) {
    const periodo = 60000 / bpm / pasoMs;
    const pesoPrior = prior(bpm, centro);
    for (let fase = 0; fase < periodo; fase++) {
      let suma = 0;
      let cuenta = 0;
      for (let pos = fase; pos < largo; pos += periodo) {
        suma += envolvente[Math.round(pos)] ?? 0;
        cuenta++;
      }
      if (cuenta === 0) continue;
      const puntaje = (suma / cuenta) * pesoPrior;
      if (puntaje > mejor.puntaje) mejor = { bpm, fase, puntaje };
    }
  }
  if (mejor.puntaje <= 0) return null;

  let beat = 60000 / mejor.bpm;
  let off = mejor.fase * pasoMs + origenMs;

  // Refinamiento sobre los onsets fuertes.
  const fuertes = onsets.filter((o) => o.fuerza >= 0.25);
  const base = fuertes.length >= 8 ? fuertes : onsets;
  const tolerancia = Math.min(40, beat * 0.12);
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const pares: { n: number; t: number; peso: number }[] = [];
    for (const o of base) {
      const n = Math.round((o.time - off) / beat);
      const residuo = o.time - (off + n * beat);
      if (Math.abs(residuo) <= tolerancia) pares.push({ n, t: o.time, peso: o.fuerza });
    }
    const ajuste = ajustar(pares);
    if (!ajuste || ajuste.beat < 60000 / (bpmMax + 10) || ajuste.beat > 60000 / (bpmMin - 10)) break;
    beat = ajuste.beat;
    off = ajuste.off;
  }

  // Offset dentro del primer pulso.
  off = ((off % beat) + beat) % beat;

  // La confianza se mide contra la grilla de medios pulsos: una corchea es
  // ritmicamente legítima aunque no caiga sobre un pulso.
  let dentro = 0;
  const medio = beat / 2;
  for (const o of base) {
    const n = Math.round((o.time - off) / medio);
    if (Math.abs(o.time - (off + n * medio)) <= tolerancia) dentro++;
  }

  const bpm = 60000 / beat;
  const entero = Math.round(bpm);
  return {
    bpm,
    offsetMs: off,
    confianza: base.length === 0 ? 0 : dentro / base.length,
    bpmSugerido: Math.abs(bpm - entero) < 0.2 ? entero : Math.round(bpm * 100) / 100,
  };
}
