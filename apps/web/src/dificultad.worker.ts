// T-014, Parte A: el Web Worker de verdad (el "multithreading" real del
// proyecto). Corre en su propio hilo, aparte del principal: calcular la
// dificultad de una biblioteca entera de canciones no traba la interfaz
// (ver el ticket, "Contexto").
//
// Deliberadamente chico y sin logica propia: importa `calcularDificultad`
// de `@tetra/core` TAL CUAL (core no se entera de que existe este worker,
// ver CLAUDE.md "packages/core no toca el navegador" y el ticket, "usando
// calcularDificultad de @tetra/core tal cual"). Este archivo es la unica
// pieza que sabe que existe un Worker: la cola de prioridad y el
// cache-o-calcula viven en dificultad-logica.ts (testeables sin Worker) y
// dificultad-worker-cliente.ts los conecta con este archivo.
//
// Vite lo reconoce por el patron `new Worker(new URL('./dificultad.worker.ts',
// import.meta.url), { type: 'module' })` en dificultad-worker-cliente.ts: no
// hace falta configuracion adicional (ver vite.config.ts).

import type { Chart, DifficultyResult } from '@tetra/core';
import { calcularDificultad } from '@tetra/core';

/** Un pedido de calculo: un id (para que el cliente sepa a que promesa responder) y el Chart. */
export interface PedidoDificultad {
  id: number;
  chart: Chart;
}

/** La respuesta: mismo id, mas el resultado. */
export interface RespuestaDificultad {
  id: number;
  resultado: DifficultyResult;
}

self.onmessage = (evento: MessageEvent<PedidoDificultad>) => {
  const { id, chart } = evento.data;
  const resultado = calcularDificultad(chart);
  const respuesta: RespuestaDificultad = { id, resultado };
  postMessage(respuesta);
};
