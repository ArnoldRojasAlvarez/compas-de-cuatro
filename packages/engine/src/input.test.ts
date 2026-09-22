// Tests de T-004 (entrada de teclado).
//
// Todo corre contra un EventTarget falso y un toGameTime controlado a mano:
// no hace falta navegador (ver docs/tickets/T-004-pista-y-entrada.md,
// seccion "Tests"). Antes de cada asercion se penso que implementacion
// incorrecta la haria fallar:
//
// - El tiempo sale de `event.timeStamp`: se prueba con un `toGameTime` que
//   aplica una transformacion reconocible (multiplicar por 10) y se verifica
//   que el resultado es exactamente esa transformacion del timeStamp del
//   evento, no un valor ligado a cuando se invoco el handler. Si la
//   implementacion leyera otra cosa (por ejemplo Date.now() disponible en
//   node), el resultado no coincidiria con la transformacion esperada.
// - "Una tecla sostenida genera un solo down" se prueba con dos variantes de
//   autorepeticion (con `repeat: true` y con `repeat` ausente/false pero sin
//   keyup de por medio): las dos tienen que quedar filtradas, y una
//   implementacion que solo mirara `e.repeat` pasaria la primera pero
//   fallaria la segunda.
// - El array reusado de `drain()` se prueba demostrando el mismo
//   comportamiento que advierte el JSDoc de `JudgeEngine.update()`: una
//   referencia guardada de mas de una llamada atras queda con contenido
//   distinto al que tenia cuando se devolvio.

import { describe, expect, it, vi } from 'vitest';
import { createKeyboardInput, type InputEvent } from './input.js';

// ---------------------------------------------------------------------------
// Dobles de prueba
// ---------------------------------------------------------------------------

interface EventoTecladoFalso {
  key: string;
  timeStamp: number;
  repeat?: boolean;
}

/**
 * EventTarget falso: no usa el EventTarget real de node/DOM (que calcula
 * timeStamp solo, fuera de nuestro control) sino un registro manual de
 * listeners por tipo, para poder disparar eventos con timeStamp elegido a
 * mano de forma determinista.
 */
class EventTargetFalso {
  private readonly listeners = new Map<string, Set<(evento: unknown) => void>>();

  addEventListener(tipo: string, listener: (evento: unknown) => void): void {
    if (!this.listeners.has(tipo)) {
      this.listeners.set(tipo, new Set());
    }
    this.listeners.get(tipo)!.add(listener);
  }

  removeEventListener(tipo: string, listener: (evento: unknown) => void): void {
    this.listeners.get(tipo)?.delete(listener);
  }

  dispatch(tipo: 'keydown' | 'keyup', evento: EventoTecladoFalso): void {
    for (const listener of this.listeners.get(tipo) ?? []) {
      listener(evento);
    }
  }

  cantidadDeListeners(tipo: string): number {
    return this.listeners.get(tipo)?.size ?? 0;
  }
}

function crearTarget(): EventTargetFalso {
  return new EventTargetFalso();
}

/** toGameTime de prueba: transformacion reconocible, sin usar reloj real. */
function toGameTimeDeVeces10(timeStamp: number): number {
  return timeStamp * 10;
}

// ---------------------------------------------------------------------------
// El tiempo sale de event.timeStamp
// ---------------------------------------------------------------------------

describe('createKeyboardInput: tiempo de la pulsacion', () => {
  it('el time del InputEvent es toGameTime(event.timeStamp), no otra cosa', () => {
    const target = crearTarget();
    const toGameTime = vi.fn(toGameTimeDeVeces10);
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTime);

    target.dispatch('keydown', { key: 'd', timeStamp: 123.4 });

    expect(toGameTime).toHaveBeenCalledWith(123.4);
    const eventos = input.drain();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.time).toBe(1234);
  });

  it('dos pulsaciones con distinto timeStamp dan distinto time, en el mismo orden de despacho', () => {
    const target = crearTarget();
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTimeDeVeces10);

    target.dispatch('keydown', { key: 'd', timeStamp: 100 });
    target.dispatch('keydown', { key: 'f', timeStamp: 105 });

    const eventos = input.drain();
    expect(eventos.map((e) => e.time)).toEqual([1000, 1050]);
  });
});

// ---------------------------------------------------------------------------
// Autorepeticion: una tecla sostenida genera un solo down
// ---------------------------------------------------------------------------

describe('createKeyboardInput: autorepeticion', () => {
  it('con repeat: true, los keydown repetidos no generan nuevos eventos', () => {
    const target = crearTarget();
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTimeDeVeces10);

    target.dispatch('keydown', { key: 'd', timeStamp: 0, repeat: false });
    target.dispatch('keydown', { key: 'd', timeStamp: 16, repeat: true });
    target.dispatch('keydown', { key: 'd', timeStamp: 32, repeat: true });

    const eventos = input.drain();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.type).toBe('down');
  });

  it('sin repeat seteado pero sin keyup de por medio, el segundo keydown tambien se filtra', () => {
    // Cubre el origen de eventos que no marca `repeat` (como el EventTarget
    // falso si no se lo pide explicitamente): la proteccion tiene que venir
    // tambien del propio estado de "tecla ya abajo", no solo de e.repeat.
    const target = crearTarget();
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTimeDeVeces10);

    target.dispatch('keydown', { key: 'd', timeStamp: 0 });
    target.dispatch('keydown', { key: 'd', timeStamp: 16 });

    expect(input.drain()).toHaveLength(1);
  });

  it('un keyup en medio permite que el siguiente keydown genere un nuevo down', () => {
    const target = crearTarget();
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTimeDeVeces10);

    target.dispatch('keydown', { key: 'd', timeStamp: 0 });
    target.dispatch('keyup', { key: 'd', timeStamp: 10 });
    target.dispatch('keydown', { key: 'd', timeStamp: 20 });

    const eventos = input.drain();
    expect(eventos.map((e) => e.type)).toEqual(['down', 'up', 'down']);
  });
});

// ---------------------------------------------------------------------------
// Dos teclas en el mismo frame
// ---------------------------------------------------------------------------

describe('createKeyboardInput: varias teclas', () => {
  it('pulsar dos teclas seguidas genera dos eventos, en orden y con su columna', () => {
    const target = crearTarget();
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTimeDeVeces10);

    target.dispatch('keydown', { key: 'd', timeStamp: 0 }); // columna 0
    target.dispatch('keydown', { key: 'k', timeStamp: 1 }); // columna 3

    const eventos = input.drain();
    expect(eventos).toHaveLength(2);
    expect(eventos[0]).toMatchObject({ column: 0, type: 'down' });
    expect(eventos[1]).toMatchObject({ column: 3, type: 'down' });
  });

  it('una tecla sin mapear no genera ningun evento', () => {
    const target = crearTarget();
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTimeDeVeces10);

    target.dispatch('keydown', { key: 'x', timeStamp: 0 });

    expect(input.drain()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// drain(): orden cronologico, cola vacia, array reusado
// ---------------------------------------------------------------------------

describe('createKeyboardInput: drain()', () => {
  it('deja la cola vacia: un segundo drain() sin eventos nuevos devuelve vacio', () => {
    const target = crearTarget();
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTimeDeVeces10);

    target.dispatch('keydown', { key: 'd', timeStamp: 0 });
    expect(input.drain()).toHaveLength(1);
    expect(input.drain()).toHaveLength(0);
  });

  it('eventos despues de un drain() aparecen recien en el proximo drain()', () => {
    const target = crearTarget();
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTimeDeVeces10);

    target.dispatch('keydown', { key: 'd', timeStamp: 0 });
    input.drain();

    target.dispatch('keydown', { key: 'f', timeStamp: 10 });
    const eventos = input.drain();

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ column: 1, type: 'down' });
  });

  it('el array devuelto es reusado: se invalida en cuanto se llama a drain() de nuevo', () => {
    // Mismo contrato que JudgeEngine.update() en packages/core (ver su
    // JSDoc): la referencia que devuelve una llamada sirve para leerla ese
    // mismo frame. En cuanto se llama a drain() otra vez, sea cual sea el
    // resultado de esa segunda llamada, el array de la primera ya cambio
    // de contenido por debajo.
    const target = crearTarget();
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTimeDeVeces10);

    target.dispatch('keydown', { key: 'd', timeStamp: 0 });
    const primero: readonly InputEvent[] = input.drain();
    expect(primero).toHaveLength(1);

    // Un segundo drain(), aunque no haya eventos nuevos, ya invalida "primero".
    input.drain();
    expect(primero).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// setKeyMap
// ---------------------------------------------------------------------------

describe('createKeyboardInput: setKeyMap', () => {
  it('remapea que tecla fisica corresponde a que columna', () => {
    const target = crearTarget();
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTimeDeVeces10);

    input.setKeyMap(['q', 'w', 'e', 'r']);

    target.dispatch('keydown', { key: 'd', timeStamp: 0 }); // ya no mapea
    target.dispatch('keydown', { key: 'q', timeStamp: 1 }); // ahora es columna 0

    const eventos = input.drain();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ column: 0, type: 'down' });
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

describe('createKeyboardInput: destroy()', () => {
  it('quita los listeners del target: no quedan fugas', () => {
    const target = crearTarget();
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTimeDeVeces10);

    expect(target.cantidadDeListeners('keydown')).toBe(1);
    expect(target.cantidadDeListeners('keyup')).toBe(1);

    input.destroy();

    expect(target.cantidadDeListeners('keydown')).toBe(0);
    expect(target.cantidadDeListeners('keyup')).toBe(0);
  });

  it('eventos disparados despues de destroy() no se acumulan', () => {
    const target = crearTarget();
    const input = createKeyboardInput(target as unknown as EventTarget, toGameTimeDeVeces10);

    input.destroy();
    target.dispatch('keydown', { key: 'd', timeStamp: 0 });

    expect(input.drain()).toHaveLength(0);
  });
});
