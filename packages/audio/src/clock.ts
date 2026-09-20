// T-001: reloj del juego derivado del AudioContext.
//
// Regla no negociable (ver CLAUDE.md, "El reloj es el audio"): el tiempo de
// juego sale siempre de `ctx.currentTime`. Prohibido usar performance.now(),
// Date.now(), setTimeout, setInterval o el delta acumulado de
// requestAnimationFrame para nada relacionado con el timing del juego.
//
// AudioContext y AudioBuffer llegan como parametros para poder inyectar un
// doble de prueba en tests (vitest corre en entorno node, sin Web Audio).

import type { Ms } from '@tetra/core';

/** Reloj de reproduccion: unica fuente de verdad temporal del juego. */
export interface AudioClock {
  /**
   * Posicion actual dentro de la pista, en ms desde el inicio del audio.
   * Es la unica fuente de verdad temporal del juego.
   * Devuelve valores negativos durante la cuenta regresiva previa.
   */
  now(): Ms;

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
   */
  readonly offset: Ms;
}

export interface ClockOptions {
  /** Offset manual del usuario, de config. Positivo retrasa las notas. */
  userOffset?: Ms;
  /**
   * Si es true, usa `audioContext.outputLatency` cuando el navegador lo
   * reporta. Por defecto true.
   */
  useOutputLatency?: boolean;
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
    this.duration = buffer.duration * 1000;
    this.userOffset = options.userOffset ?? 0;
    this.outputLatency = this.calcularLatenciaSalida(options);
  }

  get offset(): Ms {
    return this.userOffset + this.outputLatency;
  }

  get isRunning(): boolean {
    return this.running;
  }

  now(): Ms {
    if (!this.running) {
      return this.pausedPosition - this.offset;
    }
    return (this.ctx.currentTime - this.startedAt) * 1000 - this.offset;
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
      // despues de stop() no debe seguir avanzando.
      this.pausedPosition = (this.ctx.currentTime - this.startedAt) * 1000;
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
    source.connect(this.ctx.destination);
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
