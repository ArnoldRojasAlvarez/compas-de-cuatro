// T-004: entrada de teclado.
//
// El punto critico (ver CLAUDE.md y docs/tickets/T-004-pista-y-entrada.md,
// "El punto critico: el tiempo de la pulsacion"): el tiempo de cada evento
// sale de `event.timeStamp`, nunca del momento en que corre el handler. La
// conversion de esa marca (en la base de tiempo de `performance`) al tiempo
// de juego se inyecta desde afuera via `toGameTime`, que es responsabilidad
// de la capa que arma el reloj (apps/web/src/game.ts): este archivo no lee
// ni `performance` ni el reloj de audio, solo recibe la funcion ya armada.

import type { Column, Ms } from '@tetra/core';

export interface InputEvent {
  time: Ms;
  column: Column;
  type: 'down' | 'up';
}

export interface InputSource {
  /**
   * Devuelve los eventos acumulados desde la llamada anterior, en orden
   * cronologico, y vacia la cola.
   * Array reusado: leerlo y soltarlo, no guardarlo. Es el mismo patron que
   * `JudgeEngine.update()` en packages/core/src/judge/engine.ts: el array
   * que se devuelve se vuelve a escribir en la proxima llamada a `drain()`,
   * no antes. Guardar la referencia entre frames muestra datos viejos
   * pisados por los nuevos.
   */
  drain(): readonly InputEvent[];

  /** Cambia el mapeo de teclas. Por defecto D, F, J, K. */
  setKeyMap(keys: readonly [string, string, string, string]): void;

  destroy(): void;
}

const TECLAS_POR_DEFECTO: readonly [string, string, string, string] = ['d', 'f', 'j', 'k'];

/**
 * `toGameTime` convierte el `timeStamp` del evento de teclado al tiempo del
 * reloj de audio. Se inyecta para poder probar sin navegador.
 */
export function createKeyboardInput(
  target: EventTarget,
  toGameTime: (eventTimeStamp: number) => Ms,
): InputSource {
  let mapaTeclas: readonly [string, string, string, string] = TECLAS_POR_DEFECTO;
  const columnaPorTecla = new Map<string, Column>();
  // Teclas fisicamente abajo ahora mismo: filtra la autorepeticion del
  // sistema operativo (mismo keydown disparado en rafaga sin un keyup en
  // medio). Se usa ademas de `event.repeat` porque no todos los origenes de
  // eventos (en particular, el EventTarget falso de los tests) lo setean.
  const teclasPulsadas = new Set<string>();

  // Doble buffer: los listeners escriben en `bufferActivo`, `drain()`
  // intercambia los dos arrays y devuelve el que se acaba de dejar de
  // llenar. Asi el array que se devuelve no se toca de nuevo hasta el
  // proximo intercambio (dos `drain()` mas tarde), en vez de vaciarse bajo
  // los pies de quien todavia lo esta leyendo.
  let bufferActivo: InputEvent[] = [];
  let bufferSalida: InputEvent[] = [];

  function reconstruirMapa(): void {
    columnaPorTecla.clear();
    mapaTeclas.forEach((tecla, indice) => {
      columnaPorTecla.set(tecla.toLowerCase(), indice as Column);
    });
  }
  reconstruirMapa();

  function manejarKeydown(evento: Event): void {
    const e = evento as KeyboardEvent;
    const tecla = e.key.toLowerCase();
    const columna = columnaPorTecla.get(tecla);
    if (columna === undefined) {
      return; // tecla sin mapear, se ignora
    }
    if (e.repeat || teclasPulsadas.has(tecla)) {
      return; // autorepeticion: una tecla sostenida genera un solo down
    }
    teclasPulsadas.add(tecla);
    bufferActivo.push({ time: toGameTime(e.timeStamp), column: columna, type: 'down' });
  }

  function manejarKeyup(evento: Event): void {
    const e = evento as KeyboardEvent;
    const tecla = e.key.toLowerCase();
    const columna = columnaPorTecla.get(tecla);
    if (columna === undefined) {
      return;
    }
    teclasPulsadas.delete(tecla);
    bufferActivo.push({ time: toGameTime(e.timeStamp), column: columna, type: 'up' });
  }

  target.addEventListener('keydown', manejarKeydown);
  target.addEventListener('keyup', manejarKeyup);

  return {
    drain(): readonly InputEvent[] {
      const intercambio = bufferSalida;
      bufferSalida = bufferActivo;
      bufferActivo = intercambio;
      bufferActivo.length = 0;
      return bufferSalida;
    },

    setKeyMap(keys: readonly [string, string, string, string]): void {
      mapaTeclas = keys;
      teclasPulsadas.clear();
      reconstruirMapa();
    },

    destroy(): void {
      target.removeEventListener('keydown', manejarKeydown);
      target.removeEventListener('keyup', manejarKeyup);
      teclasPulsadas.clear();
      bufferActivo.length = 0;
      bufferSalida.length = 0;
    },
  };
}
