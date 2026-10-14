// T-001: reloj del juego derivado del AudioContext.
//
// Regla no negociable (ver CLAUDE.md, "El reloj es el audio"): el tiempo de
// juego sale siempre de `ctx.currentTime`. Prohibido usar performance.now(),
// Date.now(), setTimeout, setInterval o el delta acumulado de
// requestAnimationFrame para nada relacionado con el timing del juego.
//
// AudioContext y AudioBuffer llegan como parametros para poder inyectar un
// doble de prueba en tests (vitest corre en entorno node, sin Web Audio).
//
// T-063: `ctx.currentTime` avanza por bloques (~10 ms en Chromium/Windows).
// Leerlo "en este instante" arrastra hasta un bloque de error, que en una
// pulsacion es jitter puro. Por eso `now()` y `desdeTimeStamp()` pasan por el
// mapa de tiempo (mapa-de-tiempo.ts): la posicion que el contexto dice que se
// oye, anclada a `getOutputTimestamp()` e interpolada con `performance.now()`.
// El audio sigue siendo la fuente de verdad: el mapa se reancla al contexto
// todo el tiempo y no acumula deriva.

import type { Ms } from '@tetra/core';
import { crearMapaDeTiempo, type MapaDeTiempo } from './mapa-de-tiempo.js';

/** Reloj de reproduccion: unica fuente de verdad temporal del juego. */
export interface AudioClock {
  /**
   * Posicion actual dentro de la pista, en ms desde el inicio del audio.
   * Es la unica fuente de verdad temporal del juego.
   * Devuelve valores negativos durante la cuenta regresiva previa.
   */
  now(): Ms;

  /**
   * T-063: tiempo de juego (ms) en que ocurrio un evento fechado en la base de
   * `performance` (su `event.timeStamp`). Es la unica forma correcta de fechar
   * una pulsacion: no depende de cuando corre el handler ni del bloque de
   * audio en que cae. Con el reloj detenido devuelve `now()`.
   */
  desdeTimeStamp(perfMs: number): Ms;

  /** Arranca la reproduccion. `leadIn` ms de silencio antes del tiempo 0. */
  start(leadIn: Ms): void;

  stop(): void;

  /**
   * Salta a una posicion. Usado por el editor y por el modo practica.
   *
   * Justo despues de `seek(time)`, `now()` vale `time - offset`, no `time`:
   * lo que se oye en ese instante todavia se programo hace `outputLatency`,
   * entonces el tiempo de juego tiene que ir atrasado respecto al buffer.
   */
  seek(time: Ms): void;

  readonly isRunning: boolean;

  /** Duracion total de la pista en ms. */
  readonly duration: Ms;

  /** Offset manual del usuario, en ms. Se puede cambiar en caliente. */
  userOffset: Ms;

  /** Latencia de salida detectada, en ms. Solo lectura. */
  readonly outputLatency: Ms;

  /**
   * Compensacion total aplicada a `now()`, en ms.
   * Derivada: `userOffset + outputLatency`. De solo lectura para que no se
   * pueda pisar por accidente y perder la latencia calculada: para cambiar
   * la parte que corresponde al usuario se escribe `userOffset`.
   *
   * T-063: con el mapa de tiempo anclado, la latencia que se descuenta de
   * verdad es la que mide el contexto (`getOutputTimestamp`), no
   * `outputLatency`; este valor sigue siendo el del camino crudo (sin ancla)
   * y el que se usa con el reloj detenido.
   */
  readonly offset: Ms;

  /** T-063: true mientras el mapa de tiempo esta anclado al contexto (interpolando). Solo diagnostico. */
  readonly interpolando: boolean;
}

export interface ClockOptions {
  /** Offset manual del usuario, de config. Positivo retrasa las notas. */
  userOffset?: Ms;
  /**
   * Si es true, usa `audioContext.outputLatency` cuando el navegador lo
   * reporta. Por defecto true.
   */
  useOutputLatency?: boolean;
  /**
   * Nodo al que se conecta el audio de la cancion. Por defecto
   * `ctx.destination`. Sirve para intercalar un `GainNode` de volumen sin que
   * el reloj sepa nada de volumen: la posicion no depende de a donde suene.
   */
  destino?: AudioNode;
  /** Solo para tests: reemplaza `performance.now()` en el mapa de tiempo. */
  ahoraPerf?: () => number;
}

/**
 * Implementacion de AudioClock contra un AudioBufferSourceNode.
 *
 * Nada de `<audio>`: no da precision suficiente y su `currentTime` va a
 * saltos (ver ticket T-001, seccion "Como se implementa").
 */
class AudioContextClock implements AudioClock {
  private readonly ctx: AudioContext;
  private readonly buffer: AudioBuffer;
  private readonly destino: AudioNode;
  /** T-063: posicion de salida interpolada (ver mapa-de-tiempo.ts). */
  private readonly mapa: MapaDeTiempo;

  private source: AudioBufferSourceNode | null = null;
  /** Valor de ctx.currentTime (segundos) en el que la posicion vale 0. */
  private startedAt = 0;
  /** Posicion congelada, en ms y sin offset aplicado, mientras esta detenido. */
  private pausedPosition: Ms = 0;
  private running = false;

  readonly duration: Ms;
  userOffset: Ms;
  readonly outputLatency: Ms;

  constructor(ctx: AudioContext, buffer: AudioBuffer, options: ClockOptions = {}) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.destino = options.destino ?? ctx.destination;
    this.duration = buffer.duration * 1000;
    this.userOffset = options.userOffset ?? 0;
    this.outputLatency = this.calcularLatenciaSalida(options);
    this.mapa = crearMapaDeTiempo(ctx, {
      latenciaSalida: this.outputLatency / 1000,
      ...(options.ahoraPerf !== undefined && { ahoraPerf: options.ahoraPerf }),
    });
  }

  get offset(): Ms {
    return this.userOffset + this.outputLatency;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get interpolando(): boolean {
    return this.mapa.anclado;
  }

  // `mapa.ahora()` es la posicion que se OYE (ya trae la latencia de salida
  // descontada: con ancla, la que mide el contexto; sin ancla, `outputLatency`),
  // asi que aca solo se resta el offset del usuario. Sin ancla la cuenta es
  // identica a la de antes de T-063: (currentTime - startedAt) * 1000 - offset.
  now(): Ms {
    if (!this.running) {
      return this.pausedPosition - this.offset;
    }
    return (this.mapa.ahora() - this.startedAt) * 1000 - this.userOffset;
  }

  desdeTimeStamp(perfMs: number): Ms {
    if (!this.running) return this.now();
    return (this.mapa.aContexto(perfMs) - this.startedAt) * 1000 - this.userOffset;
  }

  start(leadIn: Ms): void {
    // Si ya estaba sonando, se corta el source anterior antes de crear uno
    // nuevo: nunca deben quedar dos sources sonando a la vez.
    this.detenerSourceActual();

    this.startedAt = this.ctx.currentTime + leadIn / 1000;
    this.source = this.crearSource();
    this.source.start(this.startedAt, 0);
    this.running = true;
  }

  stop(): void {
    if (this.running) {
      // Se congela la posicion actual antes de cortar el source: now()
      // despues de stop() no debe seguir avanzando. Se guarda sin offset,
      // igual que la leeria now() detenido.
      this.pausedPosition = this.now() + this.offset;
    }
    this.detenerSourceActual();
    this.running = false;
  }

  seek(time: Ms): void {
    if (!this.running) {
      // Reloj detenido: solo se mueve la posicion guardada, sin arrancar audio.
      this.pausedPosition = time;
      return;
    }

    this.detenerSourceActual();
    // Se acota al rango del buffer para no pedirle a la Web Audio API un
    // offset invalido (por ejemplo, uno mas alla del final de la pista).
    const offsetSegundos = Math.min(Math.max(time / 1000, 0), this.buffer.duration);
    this.startedAt = this.ctx.currentTime - time / 1000;
    this.source = this.crearSource();
    this.source.start(this.ctx.currentTime, offsetSegundos);
    this.running = true;
    // El mapa no cambia con el seek: la relacion entre el contexto y
    // `performance` sigue igual, solo se movio `startedAt`.
  }

  private calcularLatenciaSalida(options: ClockOptions): Ms {
    const useOutputLatency = options.useOutputLatency ?? true;
    if (!useOutputLatency) {
      return 0;
    }

    const latency = this.ctx.outputLatency;
    // Se ignora si el navegador no lo reporta (undefined o 0).
    if (!latency) {
      return 0;
    }
    return latency * 1000;
  }

  private crearSource(): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.destino);
    return source;
  }

  private detenerSourceActual(): void {
    if (!this.source) {
      return;
    }
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }
}

export function createAudioClock(
  ctx: AudioContext,
  buffer: AudioBuffer,
  options?: ClockOptions,
): AudioClock {
  return new AudioContextClock(ctx, buffer, options);
}
