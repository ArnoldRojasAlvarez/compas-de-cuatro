// T-004: entrada de teclado.
//
// El punto critico (ver CLAUDE.md y docs/tickets/T-004-pista-y-entrada.md,
// "El punto critico: el tiempo de la pulsacion"): el tiempo de cada evento
// sale de `event.timeStamp`, nunca del momento en que corre el handler. La
// conversion de esa marca (en la base de tiempo de `performance`) al tiempo
// de juego se inyecta desde afuera via `toGameTime`, que es responsabilidad
// de la capa que arma el reloj (apps/web/src/game.ts): este archivo no lee
// ni `performance` ni el reloj de audio, solo recibe la funcion ya armada.
//
// T-012, "Parte A": bug de entrada arreglado. El emparejamiento era por
// `e.key.toLowerCase()`, y eso fallaba de tres formas (ver el ticket):
//
// 1. Tecla pegada: con un simbolo mapeado, soltar con Shift apretado cambia
//    el `key` del keyup respecto al del keydown (por ejemplo `;` baja y `:`
//    sube), el emparejamiento por key no encuentra la tecla sostenida, y la
//    columna queda muerta para siempre (toda pulsacion nueva se descarta
//    como autorrepeticion, porque el codigo sigue en `codigosPulsados`).
// 2. `e.key` depende de la distribucion del teclado; lo estandar en juegos
//    de ritmo es la posicion fisica de la tecla.
// 3. Perdida de foco: si la ventana pierde el foco con una tecla apretada
//    (alt-tab), el `keyup` nunca llega y la columna queda muerta al volver.
//
// La solucion a las tres: emparejar por `e.code` (posicion fisica: 'KeyD',
// 'KeyF', 'KeyJ', 'KeyK', 'Semicolon', 'Space', etc.), que no cambia con
// Shift ni con el idioma del teclado, y soltar todas las teclas sostenidas
// al perder el foco (ver manejarBlur mas abajo).

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

  /**
   * Cambia el mapeo de teclas. T-012: recibe codigos fisicos (`e.code`,
   * por ejemplo 'KeyD'), no teclas (`e.key`): ver el comentario de arriba
   * de todo el archivo. Por defecto, KeyD, KeyF, KeyJ, KeyK.
   */
  setKeyMap(codes: readonly [string, string, string, string]): void;

  destroy(): void;
}

const CODIGOS_POR_DEFECTO: readonly [string, string, string, string] = [
  'KeyD',
  'KeyF',
  'KeyJ',
  'KeyK',
];

/**
 * `toGameTime` convierte el `timeStamp` del evento de teclado al tiempo del
 * reloj de audio. Se inyecta para poder probar sin navegador.
 *
 * `blurTarget` (T-012, "Parte A"): de que objeto escuchar el evento `blur`
 * para soltar las teclas sostenidas al perder el foco. Por defecto es el
 * mismo `target` del que se escuchan keydown/keyup: en produccion `target`
 * es `window` (ver apps/web/src/game.ts), que es tambien quien dispara
 * `blur` cuando la ventana pierde el foco, asi que alcanza sin pedir nada
 * aparte. Se deja como parametro aparte (no fusionado con `target`) para
 * los tests, que usan un EventTarget falso sin verdadero comportamiento de
 * ventana, y para el caso hipotetico de un `target` que no sea la ventana
 * (por ejemplo, si algun dia la entrada se escuchara de un elemento en vez
 * de `window`): ahi `blur` de ese elemento no alcanzaria, y este parametro
 * permite seguir escuchando el `blur` de la ventana real aparte.
 */
export function createKeyboardInput(
  target: EventTarget,
  toGameTime: (eventTimeStamp: number) => Ms,
  blurTarget: EventTarget = target,
): InputSource {
  let mapaCodigos: readonly [string, string, string, string] = CODIGOS_POR_DEFECTO;
  const columnaPorCodigo = new Map<string, Column>();
  // Codigos fisicamente abajo ahora mismo: filtra la autorepeticion del
  // sistema operativo (mismo keydown disparado en rafaga sin un keyup en
  // medio) y es lo que manejarBlur() recorre para soltar todo al perder el
  // foco. Se usa ademas de `event.repeat` porque no todos los origenes de
  // eventos (en particular, el EventTarget falso de los tests) lo setean.
  const codigosPulsados = new Set<string>();

  // Doble buffer: los listeners escriben en `bufferActivo`, `drain()`
  // intercambia los dos arrays y devuelve el que se acaba de dejar de
  // llenar. Asi el array que se devuelve no se toca de nuevo hasta el
  // proximo intercambio (dos `drain()` mas tarde), en vez de vaciarse bajo
  // los pies de quien todavia lo esta leyendo.
  let bufferActivo: InputEvent[] = [];
  let bufferSalida: InputEvent[] = [];

  function reconstruirMapa(): void {
    columnaPorCodigo.clear();
    mapaCodigos.forEach((codigo, indice) => {
      columnaPorCodigo.set(codigo, indice as Column);
    });
  }
  reconstruirMapa();

  function manejarKeydown(evento: Event): void {
    const e = evento as KeyboardEvent;
    const columna = columnaPorCodigo.get(e.code);
    if (columna === undefined) {
      return; // codigo sin mapear, se ignora
    }
    if (e.repeat || codigosPulsados.has(e.code)) {
      return; // autorepeticion: una tecla sostenida genera un solo down
    }
    codigosPulsados.add(e.code);
    bufferActivo.push({ time: toGameTime(e.timeStamp), column: columna, type: 'down' });
  }

  function manejarKeyup(evento: Event): void {
    const e = evento as KeyboardEvent;
    const columna = columnaPorCodigo.get(e.code);
    if (columna === undefined) {
      return;
    }
    codigosPulsados.delete(e.code);
    bufferActivo.push({ time: toGameTime(e.timeStamp), column: columna, type: 'up' });
  }

  /**
   * T-012, "Parte A": al perder el foco (alt-tab, cambiar de ventana, etc.)
   * se sueltan todas las teclas sostenidas, cada una con un `up` fechado en
   * el momento del blur (convertido por `toGameTime`, igual que cualquier
   * otro evento): asi una LN sostenida al hacer alt-tab se juzga como
   * soltada, que es lo correcto, en vez de quedar viva para siempre porque
   * su `keyup` nunca va a llegar.
   */
  function manejarBlur(evento: Event): void {
    if (codigosPulsados.size === 0) return;
    const tiempo = toGameTime(evento.timeStamp);
    for (const codigo of codigosPulsados) {
      const columna = columnaPorCodigo.get(codigo);
      if (columna !== undefined) {
        bufferActivo.push({ time: tiempo, column: columna, type: 'up' });
      }
    }
    codigosPulsados.clear();
  }

  target.addEventListener('keydown', manejarKeydown);
  target.addEventListener('keyup', manejarKeyup);
  blurTarget.addEventListener('blur', manejarBlur);

  return {
    drain(): readonly InputEvent[] {
      const intercambio = bufferSalida;
      bufferSalida = bufferActivo;
      bufferActivo = intercambio;
      bufferActivo.length = 0;
      return bufferSalida;
    },

    setKeyMap(codes: readonly [string, string, string, string]): void {
      mapaCodigos = codes;
      codigosPulsados.clear();
      reconstruirMapa();
    },

    destroy(): void {
      target.removeEventListener('keydown', manejarKeydown);
      target.removeEventListener('keyup', manejarKeyup);
      blurTarget.removeEventListener('blur', manejarBlur);
      codigosPulsados.clear();
      bufferActivo.length = 0;
      bufferSalida.length = 0;
    },
  };
}

/** Mapeo de codigos por defecto (D, F, J, K), exportado para que apps/web
 * (el remapeo de teclas de ajustes) lo use como "volver a valores por
 * defecto" sin duplicar la lista. */
export const CODIGOS_TECLAS_POR_DEFECTO = CODIGOS_POR_DEFECTO;
