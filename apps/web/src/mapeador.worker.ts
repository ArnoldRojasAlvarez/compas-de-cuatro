// Web Worker del mapeador: analiza el audio (onsets y tempo) fuera del hilo
// principal. Una cancion de tres o cuatro minutos son miles de FFT; en el
// hilo principal congelaria la pantalla varios segundos. Sin logica propia:
// llama a analizarOnsets y estimarTempo de @tetra/core tal cual, igual que
// dificultad.worker.ts hace con calcularDificultad.

import type { AnalisisOnsets, EstimacionTempo } from '@tetra/core';
import { analizarOnsets, estimarTempo } from '@tetra/core';

export interface PedidoAnalisis {
  muestras: Float32Array;
  sampleRate: number;
}

export interface RespuestaAnalisis {
  analisis: AnalisisOnsets;
  tempo: EstimacionTempo | null;
}

self.onmessage = (evento: MessageEvent<PedidoAnalisis>) => {
  const { muestras, sampleRate } = evento.data;
  const analisis = analizarOnsets(muestras, sampleRate);
  const respuesta: RespuestaAnalisis = { analisis, tempo: estimarTempo(analisis) };
  postMessage(respuesta);
};
