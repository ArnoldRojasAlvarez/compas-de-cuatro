// T-066 (paso 3, D8): renderiza el audio virtual de una dificultad. Crea el
// AudioBuffer de salida (2 canales, al sampleRate del contexto que lo va a
// reproducir, asi no se remuestrea al tocar) y suma encima, de a una muestra
// por vez: decodificar, sumar todos sus eventos, soltarla. La memoria pico es
// la salida mas una muestra decodificada, no todas a la vez como pasaria con
// un OfflineAudioContext. La suma en si es una funcion pura de core
// (`mezclarMuestra`), testeable sin navegador.
//
// No toca el reloj del juego: el AudioBuffer resultante se usa igual que el
// de una pista decodificada (T-063 no cambia).

import type { Chart } from '@tetra/core';
import {
  duracionDeAudioVirtual,
  indiceDeMuestra,
  mezclarMuestra,
  normalizarPico,
} from '@tetra/core';

export interface EntradaRenderVirtual {
  /** Con `audioVirtual`. */
  chart: Chart;
  /** Bytes frescos de una muestra (`decodeAudioData` los desprende); `undefined` si falta. */
  leerMuestra: (archivo: string) => Promise<ArrayBuffer | undefined>;
  ctx: BaseAudioContext;
  /** Cede el hilo entre muestras (en la web, con MessageChannel). Por defecto no cede. */
  ceder?: () => Promise<void>;
}

export interface ResultadoRenderVirtual {
  buffer: AudioBuffer;
  /** Muestras que faltaban o no decodificaron, ordenadas. */
  faltantes: string[];
  /** Factor de `normalizarPico` (1 si no toco nada). */
  ganancia: number;
}

/** Eventos de una misma muestra, en paralelo: inicio (en muestras de audio) y ganancia lineal. */
interface UsosDeMuestra {
  inicios: number[];
  ganancias: number[];
}

export async function renderizarAudioVirtual(
  entrada: EntradaRenderVirtual,
): Promise<ResultadoRenderVirtual> {
  const { chart, leerMuestra, ctx, ceder } = entrada;
  const eventos = chart.audioVirtual?.eventos ?? [];
  const sampleRate = ctx.sampleRate;

  const largo = Math.max(1, Math.ceil((duracionDeAudioVirtual(chart) * sampleRate) / 1000));
  const buffer = ctx.createBuffer(2, largo, sampleRate);
  const salida = [buffer.getChannelData(0), buffer.getChannelData(1)];

  const porArchivo = new Map<string, UsosDeMuestra>();
  for (const evento of eventos) {
    let usos = porArchivo.get(evento.archivo);
    if (usos === undefined) {
      usos = { inicios: [], ganancias: [] };
      porArchivo.set(evento.archivo, usos);
    }
    usos.inicios.push(indiceDeMuestra(evento.tiempo, sampleRate));
    usos.ganancias.push(evento.volumen / 100);
  }

  const faltantes: string[] = [];
  for (const [archivo, usos] of porArchivo) {
    const bytes = await leerMuestra(archivo);
    if (bytes === undefined) {
      faltantes.push(archivo);
    } else {
      let decodificada: AudioBuffer | undefined;
      try {
        decodificada = await ctx.decodeAudioData(bytes);
      } catch {
        decodificada = undefined;
      }
      if (decodificada === undefined) {
        faltantes.push(archivo);
      } else {
        const canales: Float32Array[] = [];
        for (let c = 0; c < Math.min(2, decodificada.numberOfChannels); c++) {
          canales.push(decodificada.getChannelData(c));
        }
        mezclarMuestra(salida, canales, usos.inicios, usos.ganancias);
      }
    }
    if (ceder !== undefined) await ceder();
  }

  faltantes.sort();
  const ganancia = normalizarPico(salida);
  return { buffer, faltantes, ganancia };
}
