// T-044: replay y modo auto. Logica pura (sin navegador): el formato de un
// replay, el jugador perfecto que lo genera, como se serializa y un cursor
// que entrega los eventos por tiempo de juego.
//
// Un replay es la lista de pulsaciones y soltadas EXACTAMENTE como las recibio
// el motor de juicio, cada una con su propio `time` (tiempo de juego, el mismo
// del reloj de audio). Alimentar al motor con esos mismos eventos, en ese mismo
// orden, da el mismo score, combo y conteos: el motor no mira nada mas. Por eso
// el cursor reparte los eventos por el `time` de cada uno y no por el del frame
// en el que se inyectan (ver `crearReproductorDeReplay`).

import { hashMapa } from './difficulty/hash.js';
import type { JudgeEngine } from './judge/engine.js';
import type { Chart, Column, HitResult, Ms } from './types.js';
import { isHold } from './types.js';

export interface EventoReplay {
  /** Tiempo de juego (ms desde el inicio del audio), el que recibe el motor. */
  time: Ms;
  column: Column;
  tipo: 'down' | 'up';
}

export interface Replay {
  version: 1;
  /** `String(hashMapa(chart))` del mapa jugado: un replay solo vale para el mapa que lo grabo. */
  hashMapa: string;
  /** Offset del usuario (global mas local de la cancion) con el que se grabo, solo informativo: los `time` ya vienen en tiempo de juego. */
  offsetUsuario: Ms;
  /** En el orden en que se entregaron al motor. */
  eventos: EventoReplay[];
}

/** Cuanto se sostiene una nota simple en el replay perfecto (ms). */
export const MS_SOSTENER_NOTA_SIMPLE = 40;

/** La clave con la que un replay se asocia a un mapa. */
export function hashDeReplay(chart: Chart): string {
  return String(hashMapa(chart));
}

/** true si el replay se grabo sobre este mapa (mismo contenido de notas y OD). */
export function replayEsDeEsteMapa(replay: Replay, chart: Chart): boolean {
  return replay.hashMapa === hashDeReplay(chart);
}

/**
 * Los eventos de un jugador perfecto. Down en `time` de cada nota; up en
 * `endTime` para las largas y a `time + 40 ms` para las simples (no en el mismo
 * ms: un motor podria ver down/up simultaneos como raro). Nunca pulsa dos veces
 * la misma columna a la vez: si la siguiente nota de la columna llega antes de
 * que termine la sostenida, el up va a la mitad entre las dos.
 *
 * Orden de salida: por tiempo; en empate el up va antes que el down (una
 * columna se suelta antes de volver a pulsarse) y luego por columna.
 */
export function replayPerfecto(chart: Chart): Replay {
  // Notas de cada columna, en orden (chart.notes ya viene ordenado por tiempo).
  const porColumna: Chart['notes'][] = [[], [], [], []];
  for (const nota of chart.notes) porColumna[nota.column]!.push(nota);

  const eventos: EventoReplay[] = [];
  for (const [indiceColumna, notas] of porColumna.entries()) {
    const column = indiceColumna as Column;
    for (let i = 0; i < notas.length; i++) {
      const nota = notas[i]!;
      const siguiente = notas[i + 1];
      let soltar = isHold(nota) ? nota.endTime : nota.time + MS_SOSTENER_NOTA_SIMPLE;
      // Una larga puede soltarse justo cuando empieza la siguiente (up antes que
      // down, en el mismo ms); una simple no: ahi el up va a la mitad.
      const choca =
        siguiente !== undefined &&
        (isHold(nota) ? siguiente.time < soltar : siguiente.time <= soltar);
      if (choca) soltar = (nota.time + siguiente.time) / 2;
      eventos.push({ time: nota.time, column, tipo: 'down' });
      eventos.push({ time: soltar, column, tipo: 'up' });
    }
  }
  eventos.sort(compararEventos);
  return { version: 1, hashMapa: hashDeReplay(chart), offsetUsuario: 0, eventos };
}

function compararEventos(a: EventoReplay, b: EventoReplay): number {
  if (a.time !== b.time) return a.time - b.time;
  if (a.tipo !== b.tipo) return a.tipo === 'up' ? -1 : 1;
  return a.column - b.column;
}

// ---------------------------------------------------------------------------
// Serializacion
// ---------------------------------------------------------------------------

/**
 * Texto del replay: JSON compacto con cada evento como `[time, columna, tipo]`
 * (tipo 0 = down, 1 = up). Los tiempos se escriben tal cual (la ida y vuelta de
 * JSON conserva los decimales exactos, y de eso depende el determinismo).
 *
 *   {"version":1,"hashMapa":"123","offsetUsuario":-12,"eventos":[[1000,0,0],[1040,0,1]]}
 */
export function serializarReplay(r: Replay): string {
  return JSON.stringify({
    version: r.version,
    hashMapa: r.hashMapa,
    offsetUsuario: r.offsetUsuario,
    eventos: r.eventos.map((e) => [e.time, e.column, e.tipo === 'down' ? 0 : 1]),
  });
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * Lee el texto de un replay. `null` si no es JSON, si la version no es la 1
 * (una version futura no se adivina) o si algo esta mal formado: nunca lanza.
 */
export function leerReplay(texto: string): Replay | null {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!esObjeto(crudo) || crudo['version'] !== 1) return null;
  const { hashMapa: hash, offsetUsuario, eventos: lista } = crudo;
  if (typeof hash !== 'string' || hash === '') return null;
  if (typeof offsetUsuario !== 'number' || !Number.isFinite(offsetUsuario)) return null;
  if (!Array.isArray(lista)) return null;

  const eventos: EventoReplay[] = [];
  for (const item of lista as unknown[]) {
    if (!Array.isArray(item) || item.length !== 3) return null;
    const [time, column, tipo] = item as unknown[];
    if (typeof time !== 'number' || !Number.isFinite(time)) return null;
    if (column !== 0 && column !== 1 && column !== 2 && column !== 3) return null;
    if (tipo !== 0 && tipo !== 1) return null;
    eventos.push({ time, column, tipo: tipo === 0 ? 'down' : 'up' });
  }
  return { version: 1, hashMapa: hash, offsetUsuario, eventos };
}

// ---------------------------------------------------------------------------
// Reproduccion por tiempo de juego
// ---------------------------------------------------------------------------

export interface ReproductorDeReplay {
  /**
   * Entrega, en orden, los eventos que todavia no se entregaron y cuyo `time`
   * sea menor o igual a `t` (el reloj de juego de este frame). Cada evento
   * conserva SU `time`: quien lo recibe se lo pasa al motor tal cual.
   */
  avanzar(t: Ms, emitir: (evento: EventoReplay) => void): void;
  /** Descarta, sin entregarlos, los eventos con `time` menor a `t` (saltar hacia adelante: lo salteado no se juzga). */
  saltarHasta(t: Ms): void;
  /** true cuando ya se entregaron todos. */
  readonly terminado: boolean;
}

/**
 * Cursor sobre los eventos de un replay. Va por posicion, sin reservar memoria
 * por frame. No ordena: respeta el orden grabado, asi un evento fechado un poco
 * antes que el anterior (jitter de la conversion de `timeStamp`) sale justo
 * despues de el, igual que le llego al motor la primera vez.
 */
export function crearReproductorDeReplay(replay: Replay): ReproductorDeReplay {
  const eventos = replay.eventos;
  let siguiente = 0;
  return {
    avanzar(t: Ms, emitir: (evento: EventoReplay) => void): void {
      while (siguiente < eventos.length && eventos[siguiente]!.time <= t) {
        emitir(eventos[siguiente]!);
        siguiente++;
      }
    },
    saltarHasta(t: Ms): void {
      while (siguiente < eventos.length && eventos[siguiente]!.time < t) siguiente++;
    },
    get terminado(): boolean {
      return siguiente >= eventos.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Entregar eventos al motor y grabarlos (compartido por la partida y los tests)
// ---------------------------------------------------------------------------

/**
 * Entrega un evento al motor de juicio. Antes de la pulsacion o soltada llama
 * a `motor.update(evento.time)`: lo que expire hasta ese instante (notas cuya
 * ventana ya paso) se resuelve ANTES del evento, en cualquier frame que se
 * entregue. `alExpirar` recibe cada juicio por tiempo (el arreglo del motor es
 * reusado: se lee en el acto, no se guarda). Devuelve el juicio del evento, o
 * `null` si no habia nota que juzgar.
 */
export function entregarEvento(
  motor: JudgeEngine,
  evento: EventoReplay,
  alExpirar: (resultado: HitResult) => void,
): HitResult | null {
  for (const expirado of motor.update(evento.time)) alExpirar(expirado);
  return evento.tipo === 'down'
    ? motor.press(evento.time, evento.column)
    : motor.release(evento.time, evento.column);
}

/**
 * Cuanto se atrasa la expiracion por frame (ms de tiempo de juego). Un keydown
 * que ocurrio antes del `t` de un frame puede llegar recien en el siguiente
 * (el evento se entrega despues del rAF en que ocurrio): si el frame ya hubiera
 * expirado hasta su `t`, el grabador tendria que correr esa pulsacion hacia
 * adelante y su juicio saldria distinto al exacto. Con este margen, una
 * pulsacion atrasada hasta 50 ms se juzga con su tiempo real.
 */
export const MARGEN_DE_EXPIRACION_MS = 50;

/**
 * La expiracion de un frame: `motor.update(t - MARGEN_DE_EXPIRACION_MS)`. Las
 * notas que vencen en ese margen se resuelven en el frame siguiente (o antes,
 * si llega un evento: `entregarEvento` expira hasta su tiempo). `alExpirar`
 * recibe cada juicio por tiempo. Devuelve el instante hasta el que se expiro:
 * pasaselo a `GrabadorDeReplay.actualizado` (no `t`).
 */
export function expirarConMargen(
  motor: JudgeEngine,
  t: Ms,
  alExpirar: (resultado: HitResult) => void,
): Ms {
  const hasta = t - MARGEN_DE_EXPIRACION_MS;
  for (const expirado of motor.update(hasta)) alExpirar(expirado);
  return hasta;
}

/**
 * Al terminar la partida: expira todo lo que ya vencio hasta `t`, sin margen,
 * para que ningun miss de las ultimas notas quede fuera del estado final.
 */
export function expirarSinMargen(
  motor: JudgeEngine,
  t: Ms,
  alExpirar: (resultado: HitResult) => void,
): void {
  for (const expirado of motor.update(t)) alExpirar(expirado);
}

export interface GrabadorDeReplay {
  /**
   * Anota un evento recien llegado (con su tiempo de juego) y devuelve el que
   * hay que entregar al motor, que es el mismo que quedo grabado: su `time` es
   * el recibido, o el mayor entre el evento y la actualizacion anteriores si el
   * ruido lo dejo en el pasado.
   */
  registrar(time: Ms, column: Column, tipo: EventoReplay['tipo']): EventoReplay;
  /**
   * El motor se actualizo hasta `t` (una vez por frame, con el valor que devuelve
   * `expirarConMargen`, que ya trae el margen): ningun evento posterior queda antes.
   */
  actualizado(t: Ms): void;
  /** El replay con todo lo grabado hasta ahora. */
  replay(hashMapa: string, offsetUsuario: Ms): Replay;
}

export function crearGrabadorDeReplay(): GrabadorDeReplay {
  const eventos: EventoReplay[] = [];
  let piso = Number.NEGATIVE_INFINITY;
  return {
    registrar(time: Ms, column: Column, tipo: EventoReplay['tipo']): EventoReplay {
      const evento: EventoReplay = { time: time < piso ? piso : time, column, tipo };
      piso = evento.time;
      eventos.push(evento);
      return evento;
    },
    actualizado(t: Ms): void {
      if (t > piso) piso = t;
    },
    replay(hash: string, offsetUsuario: Ms): Replay {
      return { version: 1, hashMapa: hash, offsetUsuario, eventos: eventos.slice() };
    },
  };
}
