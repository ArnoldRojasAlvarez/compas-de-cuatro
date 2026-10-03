// Cliente del worker de analisis del mapeador (mapeador.worker.ts). Pide el
// analisis de un audio y devuelve una promesa. Si el Worker no se puede crear
// o falla, cae al calculo en el hilo principal: el mapeador sigue andando,
// solo que la pantalla se queda congelada mientras analiza.

import { analizarOnsets, estimarTempo } from '@tetra/core';
import type { PedidoAnalisis, RespuestaAnalisis } from './mapeador.worker.js';

function analizarEnHiloPrincipal(muestras: Float32Array, sampleRate: number): RespuestaAnalisis {
  const analisis = analizarOnsets(muestras, sampleRate);
  return { analisis, tempo: estimarTempo(analisis) };
}

/**
 * Analiza `muestras` (mono). Al worker se le transfiere una COPIA: transferir
 * las originales desconectaria el audio del AudioBuffer que las dio, y el
 * respaldo en el hilo principal las necesita enteras.
 */
export function analizarAudio(muestras: Float32Array, sampleRate: number): Promise<RespuestaAnalisis> {
  const pedido: PedidoAnalisis = { muestras: muestras.slice(), sampleRate };
  return new Promise((resolver) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./mapeador.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolver(analizarEnHiloPrincipal(muestras, sampleRate));
      return;
    }
    worker.onmessage = (evento: MessageEvent<RespuestaAnalisis>) => {
      worker.terminate();
      resolver(evento.data);
    };
    worker.onerror = () => {
      worker.terminate();
      resolver(analizarEnHiloPrincipal(muestras, sampleRate));
    };
    worker.postMessage(pedido, [pedido.muestras.buffer]);
  });
}
