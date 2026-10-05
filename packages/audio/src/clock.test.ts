// Tests de T-001 (reloj de audio).
//
// Vitest corre en entorno node: no existe AudioContext real. El contrato de
// createAudioClock recibe el AudioContext y el AudioBuffer como parametros
// justamente para poder inyectar aca un doble de prueba minimo y avanzar el
// tiempo a mano, de forma determinista, sin audio real.
//
// La regla de "el reloj es el audio" (nada de performance.now, Date.now,
// setTimeout, setInterval ni requestAnimationFrame en gameplay) ya no se
// verifica aca leyendo el codigo fuente con fs: la cubre eslint.config.js
// con no-restricted-globals y no-restricted-properties, y esa cobertura
// alcanza a todo el repo, no solo a este archivo (T-001-F1, hallazgo H2).

import { describe, expect, it, vi } from 'vitest';
import { createAudioClock } from './clock.js';

// ---------------------------------------------------------------------------
// Doble de prueba
// ---------------------------------------------------------------------------

interface SourceFalso {
  buffer: unknown;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function crearSourceFalso(): SourceFalso {
  return {
    buffer: null,
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

/**
 * Doble minimo de AudioContext: expone `currentTime` como propiedad mutable
 * (el test la avanza a mano) y `createBufferSource` devuelve un stub con
 * start, stop, connect y disconnect. `sources` guarda cada source creado
 * para poder inspeccionar sus llamadas.
 */
function crearContextoFalso(outputLatency = 0) {
  const sources: SourceFalso[] = [];
  const ctx = {
    currentTime: 0,
    destination: {},
    outputLatency,
    createBufferSource: vi.fn(() => {
      const source = crearSourceFalso();
      sources.push(source);
      return source;
    }),
  };
  // El cast es necesario porque node no tiene los tipos de Web Audio: el
  // doble solo implementa la porcion de AudioContext que el reloj usa.
  return { ctx: ctx as unknown as AudioContext, sources, raw: ctx };
}

function crearBufferFalso(duracionSegundos: number): AudioBuffer {
  return { duration: duracionSegundos } as unknown as AudioBuffer;
}

// ---------------------------------------------------------------------------
// Criterios de aceptacion
// ---------------------------------------------------------------------------

describe('AudioClock', () => {
  it('antes de start(), now() devuelve 0', () => {
    const { ctx } = crearContextoFalso();
    const clock = createAudioClock(ctx, crearBufferFalso(180));

    expect(clock.now()).toBe(0);
    expect(clock.isRunning).toBe(false);
  });

  it('con leadIn de 2000ms, now() arranca cerca de -2000 y crece hacia 0', () => {
    const { ctx, raw } = crearContextoFalso();
    const clock = createAudioClock(ctx, crearBufferFalso(180));

    clock.start(2000);
    expect(clock.now()).toBeCloseTo(-2000, 5);

    raw.currentTime += 1;
    expect(clock.now()).toBeCloseTo(-1000, 5);

    raw.currentTime += 1;
    expect(clock.now()).toBeCloseTo(0, 5);
  });

  it('seek(30000) deja now() en time - offset, no en time (H3)', () => {
    // Offset realista: 20ms de usuario mas 30ms de latencia de salida, para
    // que el criterio no se cumpla por casualidad con offset 0. Justo
    // despues del seek, lo que se oye todavia se programo hace
    // outputLatency, entonces now() tiene que ir atrasado respecto al
    // tiempo pedido (ver JSDoc de seek() en clock.ts).
    const { ctx } = crearContextoFalso(0.03);
    const clock = createAudioClock(ctx, crearBufferFalso(180), { userOffset: 20 });

    clock.start(0);
    clock.seek(30000);

    expect(clock.offset).toBeCloseTo(50, 5);
    expect(Math.abs(clock.now() - (30000 - clock.offset))).toBeLessThan(5);
  });

  it('cambiar userOffset mueve now() esa misma cantidad, de inmediato (H4)', () => {
    const { ctx, raw } = crearContextoFalso();
    const clock = createAudioClock(ctx, crearBufferFalso(180));

    clock.start(0);
    raw.currentTime += 5;
    const antes = clock.now();

    clock.userOffset = 40;
    expect(clock.now()).toBeCloseTo(antes - 40, 5);
    expect(clock.offset).toBeCloseTo(40, 5);

    clock.userOffset = -10;
    expect(clock.now()).toBeCloseTo(antes + 10, 5);
    expect(clock.offset).toBeCloseTo(-10, 5);
  });

  // ---------------------------------------------------------------------
  // outputLatency (H5): calcularLatenciaSalida no se ejercitaba nunca con
  // un valor distinto de 0, asi que su rama principal no tenia cobertura.
  // ---------------------------------------------------------------------

  it('con useOutputLatency true (por defecto) y outputLatency de 30ms, offset suma userOffset y la latencia', () => {
    const { ctx } = crearContextoFalso(0.03);
    const clock = createAudioClock(ctx, crearBufferFalso(180), { userOffset: 20 });

    expect(clock.outputLatency).toBeCloseTo(30, 5);
    expect(clock.offset).toBeCloseTo(50, 5);
  });

  it('con useOutputLatency false, offset ignora la latencia de salida aunque el navegador la reporte', () => {
    const { ctx } = crearContextoFalso(0.03);
    const clock = createAudioClock(ctx, crearBufferFalso(180), {
      userOffset: 20,
      useOutputLatency: false,
    });

    expect(clock.outputLatency).toBe(0);
    expect(clock.offset).toBe(20);
  });

  it('con outputLatency en undefined, se ignora y no rompe', () => {
    const { ctx, raw } = crearContextoFalso();
    // Simula un navegador que no reporta outputLatency: la propiedad ni
    // esta presente en el objeto, a diferencia de valer 0.
    delete (raw as { outputLatency?: number }).outputLatency;

    const clock = createAudioClock(ctx, crearBufferFalso(180), { userOffset: 20 });

    expect(clock.outputLatency).toBe(0);
    expect(clock.offset).toBe(20);
  });

  it('stop() congela la posicion: now() despues no sigue avanzando', () => {
    const { ctx, raw } = crearContextoFalso();
    const clock = createAudioClock(ctx, crearBufferFalso(180));

    clock.start(0);
    raw.currentTime += 10;
    clock.stop();

    const congelado = clock.now();
    expect(congelado).toBeCloseTo(10000, 5);
    expect(clock.isRunning).toBe(false);

    raw.currentTime += 50; // el audio real seguiria corriendo, el reloj no
    expect(clock.now()).toBe(congelado);
  });

  it('llamar start() dos veces seguidas no deja dos sources sonando a la vez', () => {
    const { ctx, sources } = crearContextoFalso();
    const clock = createAudioClock(ctx, crearBufferFalso(180));

    clock.start(0);
    clock.start(0);

    expect(sources).toHaveLength(2);
    const [primero, segundo] = sources;
    expect(primero!.stop).toHaveBeenCalledTimes(1);
    expect(primero!.disconnect).toHaveBeenCalledTimes(1);
    expect(segundo!.stop).not.toHaveBeenCalled();
    expect(clock.isRunning).toBe(true);
  });

  it('seek() con el reloj detenido cambia la posicion sin arrancar el audio', () => {
    const { ctx, sources } = crearContextoFalso();
    const clock = createAudioClock(ctx, crearBufferFalso(180));

    clock.seek(45000);

    expect(clock.now()).toBeCloseTo(45000, 5);
    expect(clock.isRunning).toBe(false);
    expect(sources).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // Prueba de deriva (H1)
  //
  // La version anterior de este test comparaba clock.now() contra
  // raw.currentTime * 1000 con start(0) sobre un contexto que arranca en
  // currentTime = 0: con startedAt = 0 y offset = 0 las dos expresiones son
  // algebraicamente identicas, asi que el test no podia fallar aunque la
  // implementacion estuviera mal. Daba 0ms de deriva porque no media nada.
  //
  // La deriva real contra hardware de audio (rAF vs. el reloj del sistema
  // de sonido) solo se puede medir en un navegador con audio de verdad, no
  // en vitest: eso queda para el ticket de e2e.
  //
  // Lo que si se puede probar aca es la razon de fondo por la que now() no
  // se desincroniza: en vez de acumular deltas de frame (como haria un
  // contador ingenuo, que es el error que describe CLAUDE.md para rAF),
  // now() vuelve a leer ctx.currentTime en cada llamada. Este test avanza
  // el doble de prueba con pasos irregulares (jitter, frames que no llegan
  // parejos) y verifica dos cosas a la vez: que now() sigue pegado a la
  // posicion real del audio, y que un contador ingenuo que solo suma un
  // delta nominal fijo por paso si se despega. Si el contador ingenuo no
  // se despegara, el jitter del escenario no seria representativo y
  // habria que subirlo.
  // ---------------------------------------------------------------------

  it('now() sigue al audio aunque los frames lleguen irregulares', () => {
    const { ctx, raw } = crearContextoFalso();
    // Pista de prueba de 3.5 minutos, con margen sobre los 3 minutos que
    // exige el ticket.
    const clock = createAudioClock(ctx, crearBufferFalso(210));

    clock.start(0);

    // Pasos irregulares entre 12 y 20ms, con promedio 16ms: un contador
    // ingenuo que asuma el paso nominal fijo de 60Hz (16.667ms) por frame
    // en vez de medir el tiempo real transcurrido se va a despegar. El
    // patron es fijo (no aleatorio) para que el test sea determinista.
    const patronJitterMs = [12, 14, 16, 18, 20, 18, 16, 14];
    const pasoNominalMs = 1000 / 60;
    const totalMs = 3 * 60 * 1000; // 3 minutos

    let tiempoTranscurridoMs = 0;
    let tiempoAcumuladoIngenuo = 0; // contador ingenuo: suma un delta fijo por paso
    let derivaMaxima = 0;
    let indicePatron = 0;

    while (tiempoTranscurridoMs < totalMs) {
      const paso = patronJitterMs[indicePatron % patronJitterMs.length]!;
      indicePatron++;

      raw.currentTime += paso / 1000;
      tiempoTranscurridoMs += paso;
      tiempoAcumuladoIngenuo += pasoNominalMs;

      // Posicion real del audio, calculada desde el buffer: como se
      // arranco con leadIn 0, coincide con el tiempo transcurrido.
      const posicionReal = raw.currentTime * 1000;
      derivaMaxima = Math.max(derivaMaxima, Math.abs(clock.now() - posicionReal));
    }

    const posicionRealFinal = raw.currentTime * 1000;
    const derivaContadorIngenuo = Math.abs(tiempoAcumuladoIngenuo - posicionRealFinal);

    expect(derivaMaxima).toBeLessThan(5);
    // Si esta asercion fallara, el escenario no es representativo: hay que
    // subirle el jitter hasta que el contador ingenuo si se despegue.
    expect(derivaContadorIngenuo).toBeGreaterThan(5);
  });
  it('conecta el source al destino pedido (un GainNode de volumen), no a ctx.destination', () => {
    const { ctx, sources, raw } = crearContextoFalso();
    const ganancia = { gain: { value: 0.5 } } as unknown as AudioNode;
    const clock = createAudioClock(ctx, crearBufferFalso(60), { destino: ganancia });

    clock.start(0);
    clock.seek(1000); // un seek crea otro source: tambien tiene que ir al destino pedido

    expect(sources.length).toBeGreaterThanOrEqual(2);
    for (const source of sources) {
      expect(source.connect).toHaveBeenCalledWith(ganancia);
      expect(source.connect).not.toHaveBeenCalledWith(raw.destination);
    }
  });

  it('sin destino pedido, conecta a ctx.destination como siempre', () => {
    const { ctx, sources, raw } = crearContextoFalso();
    const clock = createAudioClock(ctx, crearBufferFalso(60));

    clock.start(0);

    expect(sources[0]!.connect).toHaveBeenCalledWith(raw.destination);
  });

  it('el destino no altera la posicion del reloj', () => {
    const { ctx, raw } = crearContextoFalso();
    const clock = createAudioClock(ctx, crearBufferFalso(60), { destino: {} as AudioNode });

    clock.start(0);
    raw.currentTime = 2.5;

    expect(clock.now()).toBeCloseTo(2500, 6);
  });
});
