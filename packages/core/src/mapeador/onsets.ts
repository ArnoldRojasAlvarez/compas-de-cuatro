// Deteccion de onsets (golpes, ataques de nota) por flujo espectral. Pura:
// recibe las muestras mono ya decodificadas (el navegador las saca de un
// AudioBuffer, ver apps/web/src/mapeador-audio.ts) y devuelve tiempos en ms.
//
// Metodo: ventanas de Hann solapadas, magnitud de la FFT comprimida con
// log, flujo espectral (suma de los aumentos positivos entre ventanas
// consecutivas) y seleccion de picos locales sobre un umbral adaptativo.

import type { Ms } from '../types.js';
import { crearPlanFft, fft, potenciaDeDosMinima } from './fft.js';

export interface Onset {
  time: Ms;
  /** Fuerza relativa, 0 a 1 (1 es el onset mas fuerte de la cancion). */
  fuerza: number;
}

export interface AnalisisOnsets {
  /** Flujo espectral por ventana (la "envolvente de ataques"). */
  envolvente: Float32Array;
  /** Ms entre dos valores consecutivos de `envolvente`. */
  pasoMs: Ms;
  /** Ms desde el inicio del audio hasta el ataque que corresponde al indice 0 de la envolvente. */
  origenMs: Ms;
  onsets: Onset[];
}

export interface OpcionesOnsets {
  /** Salto entre ventanas en ms. Default 10. */
  pasoMs?: Ms;
  /** Sensibilidad del umbral: menor detecta mas. Default 1. */
  umbral?: number;
}

const FREC_MAX_HZ = 11000;

/** Media movil centrada de `datos` con radio `radio` (en indices), via suma acumulada. */
function mediaMovil(datos: Float32Array, radio: number): Float32Array {
  const n = datos.length;
  const acum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) acum[i + 1] = acum[i]! + datos[i]!;
  const salida = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radio);
    const b = Math.min(n, i + radio + 1);
    salida[i] = (acum[b]! - acum[a]!) / (b - a);
  }
  return salida;
}

/** Tamano de ventana de la FFT en muestras para esta frecuencia de muestreo (unos 40 ms). */
export function tamanoVentana(sampleRate: number): number {
  return potenciaDeDosMinima(Math.round(sampleRate * 0.04));
}

/**
 * Ms reales entre ventanas: el salto se redondea a muestras enteras, asi que
 * a 22050 Hz un paso pedido de 10 ms es en realidad 10.02 ms. Todo el
 * calculo de tiempos tiene que usar este valor, no el pedido (con el pedido
 * el BPM sale un 0.2 % corrido).
 */
export function pasoRealMs(sampleRate: number, pasoMs: Ms = 10): Ms {
  const salto = Math.max(1, Math.round((sampleRate * pasoMs) / 1000));
  return (salto / sampleRate) * 1000;
}

/** Calcula la envolvente de flujo espectral. Exportada para los tests de tempo. */
export function calcularEnvolvente(
  muestras: Float32Array,
  sampleRate: number,
  pasoMs: Ms = 10,
): Float32Array {
  const tamano = tamanoVentana(sampleRate);
  const salto = Math.max(1, Math.round((sampleRate * pasoMs) / 1000));
  const marcos = Math.max(0, Math.floor((muestras.length - tamano) / salto) + 1);
  const envolvente = new Float32Array(marcos);
  if (marcos === 0) return envolvente;

  const plan = crearPlanFft(tamano);
  const ventana = new Float64Array(tamano);
  for (let i = 0; i < tamano; i++) {
    ventana[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (tamano - 1));
  }
  const re = new Float64Array(tamano);
  const im = new Float64Array(tamano);
  const bins = Math.min(tamano / 2, Math.floor((FREC_MAX_HZ * tamano) / sampleRate));
  const previo = new Float64Array(bins);

  for (let m = 0; m < marcos; m++) {
    const inicio = m * salto;
    for (let i = 0; i < tamano; i++) {
      re[i] = muestras[inicio + i]! * ventana[i]!;
      im[i] = 0;
    }
    fft(plan, re, im);
    let flujo = 0;
    for (let b = 1; b < bins; b++) {
      const mag = Math.log1p((1000 * Math.hypot(re[b]!, im[b]!)) / tamano);
      if (m > 0) {
        const subida = mag - previo[b]!;
        if (subida > 0) flujo += subida;
      }
      previo[b] = mag;
    }
    envolvente[m] = flujo;
  }
  return envolvente;
}

/** Elige los picos de la envolvente (indice y valor relativo) que superan el umbral adaptativo. */
export function elegirPicos(
  envolvente: Float32Array,
  pasoMs: Ms,
  umbral = 1,
): { indice: number; fuerza: number }[] {
  const n = envolvente.length;
  if (n === 0) return [];

  let suma = 0;
  for (let i = 0; i < n; i++) suma += envolvente[i]!;
  const media = suma / n;
  let varianza = 0;
  for (let i = 0; i < n; i++) varianza += (envolvente[i]! - media) ** 2;
  const desvio = Math.sqrt(varianza / n);

  const radioLocal = Math.max(2, Math.round(500 / pasoMs));
  const local = mediaMovil(envolvente, radioLocal);
  const radioPico = Math.max(1, Math.round(30 / pasoMs));
  const distanciaMinima = Math.max(1, Math.round(40 / pasoMs));

  const picos: { indice: number; valor: number }[] = [];
  let ultimo = -distanciaMinima;
  for (let i = 0; i < n; i++) {
    const v = envolvente[i]!;
    if (v <= local[i]! * 1.1 + 0.25 * desvio * umbral) continue;
    let esMaximo = true;
    for (let k = Math.max(0, i - radioPico); k <= Math.min(n - 1, i + radioPico); k++) {
      if (envolvente[k]! > v || (envolvente[k]! === v && k < i)) {
        esMaximo = false;
        break;
      }
    }
    if (!esMaximo) continue;
    if (i - ultimo < distanciaMinima) continue;
    picos.push({ indice: i, valor: v });
    ultimo = i;
  }

  let maximo = 0;
  for (const p of picos) if (p.valor > maximo) maximo = p.valor;
  if (maximo === 0) return [];
  return picos.map((p) => ({ indice: p.indice, fuerza: p.valor / maximo }));
}

/**
 * Ms que hay que sumar al inicio de una ventana para obtener el momento del
 * ataque que la hizo saltar: el flujo sube mas rapido cuando el ataque esta
 * a tres cuartos de la ventana de Hann.
 */
export function corrimientoDeVentanaMs(sampleRate: number): Ms {
  return ((tamanoVentana(sampleRate) / sampleRate) * 1000) * 0.75;
}

/** Analisis completo: envolvente mas onsets. `muestras` son mono. */
export function analizarOnsets(
  muestras: Float32Array,
  sampleRate: number,
  opciones: OpcionesOnsets = {},
): AnalisisOnsets {
  const pedido = opciones.pasoMs ?? 10;
  const envolvente = calcularEnvolvente(muestras, sampleRate, pedido);
  const pasoMs = pasoRealMs(sampleRate, pedido);
  const origenMs = corrimientoDeVentanaMs(sampleRate);
  const picos = elegirPicos(envolvente, pasoMs, opciones.umbral ?? 1);
  return {
    envolvente,
    pasoMs,
    origenMs,
    onsets: picos.map((p) => ({ time: p.indice * pasoMs + origenMs, fuerza: p.fuerza })),
  };
}
