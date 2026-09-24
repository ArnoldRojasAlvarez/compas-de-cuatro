// T-014, Parte A/B: conecta el Worker de verdad (dificultad.worker.ts) con
// la cola de prioridad y el cache-o-calcula (dificultad-logica.ts, ambos
// testeados sin DOM) y con la cache persistente de @tetra/storage. Es
// deliberadamente chico y sin tests propios (mismo criterio que db.ts de
// @tetra/storage: la parte que si importa testear, la logica, esta en
// dificultad-logica.ts; esto solo cablea Worker + IndexedDB, que no tienen
// un fake barato para un Worker real).
//
// Uso desde song-select.ts: un cliente por instancia de pantalla, se pide
// `pedir(chart, prioritaria)` por cada dificultad que hay que mostrar, y se
// llama `destruir()` al salir (mismo ciclo de vida que el reproductor de
// preview, ver song-select.ts).

import type { Chart, DifficultyResult } from '@tetra/core';
import { cachearDificultad, leerDificultadDeCache } from '@tetra/storage';
import { ColaConPrioridad, obtenerDificultad } from './dificultad-logica.js';
import type { PedidoDificultad, RespuestaDificultad } from './dificultad.worker.js';

interface TareaWorker {
  id: number;
  chart: Chart;
  resolver: (resultado: DifficultyResult) => void;
  rechazar: (error: unknown) => void;
}

export interface ClienteDificultad {
  /**
   * Pide el resultado de dificultad de `chart`: usa la cache de
   * IndexedDB si ya estaba, si no lo encola para el worker.
   * `prioritaria` adelanta la tarea en la cola (ver ColaConPrioridad):
   * se usa para la dificultad en foco del song select.
   */
  pedir(chart: Chart, prioritaria: boolean): Promise<DifficultyResult>;
  /** Termina el worker. Llamar al salir de la pantalla (mismo criterio que reproductor.destruir() en song-select.ts). */
  destruir(): void;
}

/** Crea un cliente nuevo, con su propio Worker. */
export function crearClienteDificultad(): ClienteDificultad {
  const worker = new Worker(new URL('./dificultad.worker.ts', import.meta.url), { type: 'module' });
  const cola = new ColaConPrioridad<TareaWorker>();
  const enVuelo = new Map<number, TareaWorker>();
  let siguienteId = 0;
  let ocupado = false;

  function despachar(): void {
    if (ocupado) return;
    const tarea = cola.siguiente();
    if (!tarea) return;
    ocupado = true;
    enVuelo.set(tarea.id, tarea);
    const pedido: PedidoDificultad = { id: tarea.id, chart: tarea.chart };
    worker.postMessage(pedido);
  }

  worker.onmessage = (evento: MessageEvent<RespuestaDificultad>) => {
    const { id, resultado } = evento.data;
    const tarea = enVuelo.get(id);
    enVuelo.delete(id);
    ocupado = false;
    tarea?.resolver(resultado);
    despachar();
  };

  worker.onerror = () => {
    // Un chart que hace fallar al worker (no deberia pasar con un Chart
    // valido, ver types.ts) no puede trabar el resto de la cola: se
    // rechazan las tareas en vuelo (el worker no dice cual disparo el
    // error) y se sigue con lo que queda.
    for (const tarea of enVuelo.values()) {
      tarea.rechazar(new Error('El worker de dificultad fallo.'));
    }
    enVuelo.clear();
    ocupado = false;
    despachar();
  };

  function calcularEnWorker(chart: Chart, prioritaria: boolean): Promise<DifficultyResult> {
    return new Promise((resolver, rechazar) => {
      const tarea: TareaWorker = { id: siguienteId, chart, resolver, rechazar };
      siguienteId += 1;
      cola.agregar(tarea, prioritaria);
      despachar();
    });
  }

  function pedir(chart: Chart, prioritaria: boolean): Promise<DifficultyResult> {
    return obtenerDificultad(chart, {
      leerCache: leerDificultadDeCache,
      guardarCache: cachearDificultad,
      calcular: (c) => calcularEnWorker(c, prioritaria),
    });
  }

  function destruir(): void {
    worker.terminate();
  }

  return { pedir, destruir };
}
