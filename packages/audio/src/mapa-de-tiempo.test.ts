// Tests de T-063 (mapa de tiempo interpolado).
//
// Se simula un AudioContext cuyo `currentTime` avanza por bloques (como en
// Chromium/Windows: una rafaga cada 10 ms) y cuyo `getOutputTimestamp` da la
// posicion de salida real en el instante de la ultima rafaga. La base de
// `performance` es una variable que el test mueve a mano.

import { describe, expect, it } from 'vitest';
import { createAudioClock } from './clock.js';
import {
  PASO_MAXIMO_MS,
  SALTO_DE_REANCLAJE_MS,
  TOLERANCIA_CRUDA_MS,
  crearMapaDeTiempo,
  crearMapaDeTiempoDesde,
  type FuenteDeTiempo,
} from './mapa-de-tiempo.js';

/** Un contexto simulado que rinde por bloques. Tiempos de `performance` en ms. */
function crearContextoPorBloques(opciones: { bloqueMs?: number; latenciaS?: number; velocidad?: number } = {}) {
  const bloqueMs = opciones.bloqueMs ?? 10;
  const latenciaS = opciones.latenciaS ?? 0.04;
  // Cuanto avanza el cristal del audio por ms de `performance` (1 = iguales).
  const velocidad = opciones.velocidad ?? 1;
  let perf = 1000; // performance.now() actual
  let estado: 'running' | 'suspended' = 'running';
  // Instante de performance de la ultima rafaga y cuanto audio se rindio hasta ahi.
  let ultimaRafagaPerf = perf;
  let rendidoS = 0;
  // Mientras esta suspendido el contexto no rinde; al reanudar el reloj de
  // audio no "recupera" el tiempo perdido.
  function rendirHasta(p: number): void {
    while (estado === 'running' && p - ultimaRafagaPerf >= bloqueMs) {
      ultimaRafagaPerf += bloqueMs;
      rendidoS += (bloqueMs / 1000) * velocidad;
    }
  }
  const ctx = {
    get currentTime(): number {
      return rendidoS;
    },
    outputLatency: latenciaS,
    get state(): string {
      return estado;
    },
    getOutputTimestamp(): { contextTime: number; performanceTime: number } {
      // Lo que se oia en la ultima rafaga: lo rendido menos lo que todavia esta en el buffer.
      return { contextTime: rendidoS - latenciaS * velocidad, performanceTime: ultimaRafagaPerf };
    },
    destination: {},
    createBufferSource: () => ({
      buffer: null,
      start: () => undefined,
      stop: () => undefined,
      connect: () => undefined,
      disconnect: () => undefined,
    }),
  };
  return {
    ctx: ctx as unknown as AudioContext,
    ahoraPerf: () => perf,
    /** Avanza `performance` (y el audio, por bloques). */
    avanzar(ms: number): void {
      perf += ms;
      rendirHasta(perf);
    },
    suspender(): void {
      estado = 'suspended';
    },
    reanudar(): void {
      estado = 'running';
      ultimaRafagaPerf = perf;
    },
    /** La posicion de salida "verdadera" en este instante (continua). */
    verdadS(): number {
      return rendidoS - latenciaS * velocidad + ((perf - ultimaRafagaPerf) / 1000) * velocidad;
    },
  };
}

describe('crearMapaDeTiempo (contra un contexto por bloques)', () => {
  it('sin getOutputTimestamp cae al camino crudo: currentTime - latencia, corrido por la edad del evento', () => {
    let perf = 500;
    const ctx = { currentTime: 2, outputLatency: 0.04 } as unknown as AudioContext;
    const mapa = crearMapaDeTiempo(ctx, { latenciaSalida: 0.04, ahoraPerf: () => perf });
    expect(mapa.anclado).toBe(false);
    expect(mapa.ahora()).toBeCloseTo(1.96, 9);
    perf = 512;
    // Un evento de hace 12 ms vale 12 ms menos que ahora.
    expect(mapa.aContexto(500)).toBeCloseTo(1.96 - 0.012, 9);
  });

  it('con ancla, el error de la conversion es mucho menor que un bloque (el crudo tiene hasta un bloque)', () => {
    const sim = crearContextoPorBloques({ bloqueMs: 10 });
    const mapa = crearMapaDeTiempo(sim.ctx, { latenciaSalida: 0.04, ahoraPerf: sim.ahoraPerf });
    sim.avanzar(30);
    mapa.ahora();
    expect(mapa.anclado).toBe(true);
    let peorAnclado = 0;
    let peorCrudo = 0;
    // 200 "pulsaciones" en fases al azar del bloque, convertidas un rato despues.
    for (let i = 0; i < 200; i++) {
      sim.avanzar(1 + (i * 7) % 13);
      const ts = sim.ahoraPerf();
      const verdad = sim.verdadS();
      sim.avanzar((i * 3) % 16); // el handler corre despues del evento
      const anclado = mapa.aContexto(ts);
      const crudo = sim.ctx.currentTime - 0.04 - (sim.ahoraPerf() - ts) / 1000;
      peorAnclado = Math.max(peorAnclado, Math.abs(anclado - verdad) * 1000);
      peorCrudo = Math.max(peorCrudo, Math.abs(crudo - verdad) * 1000);
    }
    expect(peorAnclado).toBeLessThan(0.5);
    // El crudo de verdad se equivoca hasta un bloque: si esto fallara, el
    // simulador no estaria cuantizando y el test de arriba no probaria nada.
    expect(peorCrudo).toBeGreaterThan(8);
  });

  it('no acumula deriva: con el cristal del audio 200 ppm mas lento, sigue al audio durante 10 minutos', () => {
    const sim = crearContextoPorBloques({ velocidad: 1 - 200e-6 });
    const mapa = crearMapaDeTiempo(sim.ctx, { latenciaSalida: 0.04, ahoraPerf: sim.ahoraPerf });
    let peor = 0;
    for (let t = 0; t < 600_000; t += 16) {
      sim.avanzar(16);
      peor = Math.max(peor, Math.abs(mapa.ahora() - sim.verdadS()) * 1000);
    }
    // Un reloj de performance.now() sin reanclar se iria 120 ms; el mapa, nada.
    expect(peor).toBeLessThan(0.5);
  });

  it('ahora() es monotona aunque el ancla se corrija hacia atras', () => {
    let perf = 0;
    let contextTime = 1;
    let performanceTime = 0;
    const fuente: FuenteDeTiempo = {
      ahoraPerf: () => perf,
      ancla: () => ({ contextTime, performanceTime }),
      salidaCruda: () => contextTime,
      corriendo: () => true,
    };
    const mapa = crearMapaDeTiempoDesde(fuente);
    const lecturas: number[] = [];
    for (let i = 0; i < 100; i++) {
      perf += 1;
      // Cada 10 ms el dispositivo dice que en realidad va 3 ms mas atras (ruido, bajo el umbral de salto).
      if (i % 10 === 0) {
        performanceTime = perf;
        contextTime = 1 + perf / 1000 - 0.003 * (i / 10 + 1);
      }
      lecturas.push(mapa.ahora());
    }
    for (let i = 1; i < lecturas.length; i++) {
      expect(lecturas[i]).toBeGreaterThanOrEqual(lecturas[i - 1]!);
    }
    // Y a pesar de eso sigue al ancla: la correccion es acotada por muestra, no infinita.
    const ultimaAncla = contextTime + (perf - performanceTime) / 1000;
    expect(Math.abs(lecturas[lecturas.length - 1]! - ultimaAncla) * 1000).toBeLessThan(
      10 * PASO_MAXIMO_MS + 30,
    );
  });

  it('un salto grande del ancla (mas que el umbral) se toma de inmediato, sin filtrar', () => {
    let perf = 0;
    let contextTime = 0;
    let performanceTime = 0;
    const fuente: FuenteDeTiempo = {
      ahoraPerf: () => perf,
      ancla: () => ({ contextTime, performanceTime }),
      salidaCruda: () => contextTime,
      corriendo: () => true,
    };
    const mapa = crearMapaDeTiempoDesde(fuente);
    perf = 10;
    performanceTime = 10;
    contextTime = 1;
    expect(mapa.ahora()).toBeCloseTo(1, 9);
    // El dispositivo cambio: ahora la salida va (umbral + 30) ms adelante.
    perf = 20;
    performanceTime = 20;
    contextTime = 1.01 + (SALTO_DE_REANCLAJE_MS + 30) / 1000;
    expect(mapa.ahora()).toBeCloseTo(contextTime, 9);
  });

  it('en pausa devuelve la posicion cruda congelada y al reanudar se reancla sin salto hacia atras', () => {
    const sim = crearContextoPorBloques();
    const mapa = crearMapaDeTiempo(sim.ctx, { latenciaSalida: 0.04, ahoraPerf: sim.ahoraPerf });
    for (let i = 0; i < 20; i++) {
      sim.avanzar(16);
      mapa.ahora();
    }
    const antesDePausa = mapa.ahora();
    sim.suspender();
    sim.avanzar(3000);
    const enPausa = mapa.ahora();
    expect(mapa.anclado).toBe(false);
    expect(enPausa).toBeGreaterThanOrEqual(antesDePausa);
    expect(enPausa - antesDePausa).toBeLessThan(0.02); // no avanzo los 3 s de pausa
    sim.avanzar(1000);
    expect(mapa.ahora()).toBe(enPausa); // sigue congelado
    sim.reanudar();
    sim.avanzar(16);
    const trasReanudar = mapa.ahora();
    expect(trasReanudar).toBeGreaterThanOrEqual(enPausa);
    sim.avanzar(40);
    expect(mapa.anclado).toBe(true);
    expect(Math.abs(mapa.ahora() - sim.verdadS()) * 1000).toBeLessThan(0.5);
  });

  it('el audio manda: un ancla que contradice a la lectura cruda por mas de la tolerancia se descarta', () => {
    let perf = 1000;
    let cruda = 2; // currentTime - latencia, en s
    // El ancla dice que se oye 5 s mas adelante de lo que el contexto rindio: basura.
    const fuente: FuenteDeTiempo = {
      ahoraPerf: () => perf,
      ancla: () => ({ contextTime: cruda + 5, performanceTime: perf }),
      salidaCruda: () => cruda,
      corriendo: () => true,
    };
    const mapa = crearMapaDeTiempoDesde(fuente);
    expect(mapa.ahora()).toBeCloseTo(2, 9);
    expect(mapa.anclado).toBe(false);
    perf += 16;
    cruda += 0.016;
    expect(mapa.aContexto(perf - 4)).toBeCloseTo(cruda - 0.004, 9);
  });

  it('el audio manda: si el hilo de audio se atasca y performance sigue, el interpolado no se aleja mas de la tolerancia', () => {
    let perf = 0;
    let rendido = 0; // s
    let ultimaRafagaPerf = 0;
    const fuente: FuenteDeTiempo = {
      ahoraPerf: () => perf,
      ancla: () => ({ contextTime: rendido, performanceTime: ultimaRafagaPerf }),
      salidaCruda: () => rendido,
      corriendo: () => true,
    };
    const mapa = crearMapaDeTiempoDesde(fuente);
    // 1 s normal.
    for (let i = 0; i < 100; i++) {
      perf += 10;
      rendido += 0.01;
      ultimaRafagaPerf = perf;
      mapa.ahora();
    }
    expect(mapa.anclado).toBe(true);
    // El audio se congela 2 s (el contexto sigue "running", nadie rinde) y performance avanza.
    for (let i = 0; i < 200; i++) {
      perf += 10;
      const valor = mapa.ahora();
      expect(valor - rendido).toBeLessThanOrEqual(TOLERANCIA_CRUDA_MS / 1000 + 1e-9);
      expect(valor).toBeGreaterThanOrEqual(rendido);
    }
    // Vuelve el audio: en cuanto las muestras son coherentes, sigue al audio sin salto hacia atras.
    const congelado = mapa.ahora();
    for (let i = 0; i < 100; i++) {
      perf += 10;
      rendido += 0.01;
      ultimaRafagaPerf = perf;
      const valor = mapa.ahora();
      expect(valor).toBeGreaterThanOrEqual(congelado);
    }
    expect(Math.abs(mapa.ahora() - rendido) * 1000).toBeLessThan(TOLERANCIA_CRUDA_MS);
  });

  it('antes de la primera rafaga (ancla en ceros) usa el camino crudo', () => {
    const ctx = {
      currentTime: 0,
      outputLatency: 0.04,
      state: 'running',
      getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    } as unknown as AudioContext;
    const mapa = crearMapaDeTiempo(ctx, { latenciaSalida: 0.04, ahoraPerf: () => 100 });
    expect(mapa.ahora()).toBeCloseTo(-0.04, 9);
    expect(mapa.anclado).toBe(false);
  });
});

describe('AudioClock con el mapa de tiempo', () => {
  function crearReloj(sim: ReturnType<typeof crearContextoPorBloques>, userOffset = 0) {
    const buffer = { duration: 180 } as unknown as AudioBuffer;
    return createAudioClock(sim.ctx, buffer, { userOffset, ahoraPerf: sim.ahoraPerf });
  }

  it('desdeTimeStamp fecha una pulsacion con el instante en que ocurrio, no con el bloque en que se lee', () => {
    const sim = crearContextoPorBloques();
    const clock = crearReloj(sim);
    clock.start(0);
    sim.avanzar(500);
    clock.now();
    const ts = sim.ahoraPerf();
    const tiempoReal = clock.now();
    // El handler corre 9 ms despues, dentro del mismo bloque: now() no cambio.
    sim.avanzar(9);
    expect(clock.desdeTimeStamp(ts)).toBeCloseTo(tiempoReal, 3);
    // Y un evento de hace 25 ms vale 25 ms menos.
    expect(clock.desdeTimeStamp(ts - 25)).toBeCloseTo(tiempoReal - 25, 3);
  });

  it('now() avanza suave entre bloques (no se queda quieto 10 ms y salta)', () => {
    const sim = crearContextoPorBloques();
    const clock = crearReloj(sim);
    clock.start(0);
    sim.avanzar(200);
    clock.now();
    const deltas: number[] = [];
    let anterior = clock.now();
    for (let i = 0; i < 50; i++) {
      sim.avanzar(4);
      const t = clock.now();
      deltas.push(t - anterior);
      anterior = t;
    }
    for (const d of deltas) expect(d).toBeCloseTo(4, 1);
  });

  it('con el ancla, el userOffset sigue moviendo now() y desdeTimeStamp por igual', () => {
    const sim = crearContextoPorBloques();
    const clock = crearReloj(sim, 0);
    clock.start(0);
    sim.avanzar(300);
    const ts = sim.ahoraPerf();
    const sinOffset = clock.desdeTimeStamp(ts);
    clock.userOffset = 25;
    expect(clock.desdeTimeStamp(ts)).toBeCloseTo(sinOffset - 25, 9);
    expect(clock.interpolando).toBe(true);
  });

  it('stop() congela now() en el valor interpolado y desdeTimeStamp devuelve lo mismo', () => {
    const sim = crearContextoPorBloques();
    const clock = crearReloj(sim);
    clock.start(0);
    sim.avanzar(333);
    const antes = clock.now();
    clock.stop();
    expect(clock.now()).toBeCloseTo(antes, 6);
    sim.avanzar(100);
    expect(clock.now()).toBeCloseTo(antes, 6);
    expect(clock.desdeTimeStamp(sim.ahoraPerf())).toBeCloseTo(antes, 6);
  });

  it('seek() hacia atras mueve now() hacia atras (el guard de monotonia es del contexto, no de la pista)', () => {
    const sim = crearContextoPorBloques();
    const clock = crearReloj(sim);
    clock.start(0);
    sim.avanzar(5000);
    clock.now();
    clock.seek(1000);
    sim.avanzar(16);
    const t = clock.now();
    expect(t).toBeGreaterThan(900);
    expect(t).toBeLessThan(1100);
  });
});
