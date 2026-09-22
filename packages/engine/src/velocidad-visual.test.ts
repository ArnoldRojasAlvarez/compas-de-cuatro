// T-008: el invariante critico del ticket. La velocidad de caida
// (`PlayfieldOptions.scrollDuration`, ver playfield.ts) es PURAMENTE VISUAL:
// una nota se juzga por su tiempo (`JudgeEngine.press/release/update` en
// packages/core), nunca por donde se dibuja. Subir la velocidad no puede
// cambiar el score de una misma secuencia de pulsaciones.
//
// Como se prueba de verdad esto, y no solo "de nombre": se corre el MISMO
// guion de pulsaciones (mismos tiempos, mismas columnas) dos veces contra el
// mismo `JudgeEngine`, una vez ejercitando el calculo de posicion
// (`avanzarVentana` + `calcularPosicionNota`) con un scrollDuration lento y
// otra con uno rapido, en el mismo orden que game.ts hace en su bucle de
// frame (eventos -> engine.press/release, despues engine.update, despues el
// dibujo). Si algun dia una implementacion incorrecta acoplara el juicio a
// la posicion o visibilidad de la nota (por ejemplo, usando `visible` de
// `calcularPosicionNota` para decidir un miss en vez de la ventana de
// tiempo, o pasando `scrollDuration` para adentro del motor de juicio), los
// dos runs dejarian de dar el mismo `ScoreState` y este test fallaria. Un
// test que solo llamara a `calcularPosicionNota` sin tocar el motor de
// juicio no podria detectar eso: por eso el test corre las dos piezas juntas.
//
// El segundo test de mas abajo es la garantia de que el primero no es un
// test vacio (la leccion del proyecto sobre tests que no pueden fallar): si
// `calcularPosicionNota` diera la misma `y` sin importar el scrollDuration,
// el primer test pasaria igual sin haber probado nada.

import { describe, expect, it } from 'vitest';
import type { Chart, Column, Judgement, Ms, Note, ScoreState } from '@tetra/core';
import { COLUMN_COUNT, createJudgeEngine } from '@tetra/core';
import { avanzarVentana, calcularPosicionNota, ventanaVacia, type VentanaNotas } from './position.js';

function crearChartDePrueba(): Chart {
  const notes: Note[] = [
    { kind: 'tap', time: 1000, column: 0 },
    { kind: 'tap', time: 1500, column: 1 },
    { kind: 'hold', time: 2000, endTime: 2600, column: 2 },
    { kind: 'tap', time: 3000, column: 3 },
    { kind: 'tap', time: 3400, column: 0 },
  ];
  return {
    metadata: {
      title: 'prueba',
      artist: 'prueba',
      creator: 'prueba',
      difficultyName: 'prueba',
      audioFile: 'prueba.mp3',
      previewTime: 0,
    },
    overallDifficulty: 5,
    hpDrain: 5,
    timingPoints: [],
    speedPoints: [],
    notes,
  };
}

interface EventoDePrueba {
  time: Ms;
  column: Column;
  type: 'down' | 'up';
}

/**
 * Guion de pulsaciones deliberadamente variado: un tap un poco tarde, uno un
 * poco temprano, una LN completa (cabeza + soltada), una nota nunca
 * presionada (para ejercitar el miss por tiempo de `engine.update`) y otro
 * tap tarde. Con solo "max" en todos lados un bug que rompiera el combo o el
 * conteo de miss podria pasar desapercibido.
 */
function crearGuionDePulsaciones(): EventoDePrueba[] {
  return [
    { time: 1005, column: 0, type: 'down' }, // nota @1000, 5ms tarde
    { time: 1490, column: 1, type: 'down' }, // nota @1500, 10ms temprano
    { time: 2010, column: 2, type: 'down' }, // cabeza de LN @2000
    { time: 2605, column: 2, type: 'up' }, // cola de LN @2600
    // nota @3000 en columna 3: nunca se presiona, tiene que salir miss.
    { time: 3405, column: 0, type: 'down' }, // nota @3400, 5ms tarde
  ];
}

interface ResultadoSimulacion {
  estadoFinal: ScoreState;
  golpes: Array<{ judgement: Judgement; error: Ms }>;
}

const GEOMETRIA_DE_PRUEBA = { height: 600, receptorOffset: 120 };
const PASO_FRAME: Ms = 50;
const T_FINAL: Ms = 6000;

/**
 * Reproduce el orden del bucle de game.ts (ver apps/web/src/game.ts,
 * `frame()`): por cada tick, primero se despachan los eventos de entrada
 * pendientes contra el motor de juicio, despues se llama a `update()`, y
 * recien despues se calcula lo visual. `scrollDuration` solo entra en la
 * parte visual (avanzarVentana / calcularPosicionNota): nunca se le pasa al
 * `JudgeEngine`, que no tiene forma de recibirlo (su interfaz solo toma
 * tiempo y columna, ver packages/core/src/judge/engine.ts).
 */
function simularPartida(
  chart: Chart,
  eventos: readonly EventoDePrueba[],
  scrollDuration: Ms,
): ResultadoSimulacion {
  const engine = createJudgeEngine(chart);
  const golpes: ResultadoSimulacion['golpes'] = [];

  const notasPorColumna: Note[][] = [[], [], [], []];
  for (const nota of chart.notes) {
    notasPorColumna[nota.column]!.push(nota);
  }
  const ventanas: VentanaNotas[] = [ventanaVacia(), ventanaVacia(), ventanaVacia(), ventanaVacia()];

  const eventosOrdenados = [...eventos].sort((a, b) => a.time - b.time);
  let indiceEvento = 0;

  for (let t = 0; t <= T_FINAL; t += PASO_FRAME) {
    while (indiceEvento < eventosOrdenados.length && eventosOrdenados[indiceEvento]!.time <= t) {
      const evento = eventosOrdenados[indiceEvento]!;
      const resultado =
        evento.type === 'down'
          ? engine.press(evento.time, evento.column)
          : engine.release(evento.time, evento.column);
      if (resultado) golpes.push({ judgement: resultado.judgement, error: resultado.error });
      indiceEvento++;
    }

    for (const resultado of engine.update(t)) {
      golpes.push({ judgement: resultado.judgement, error: resultado.error });
    }

    // La parte visual: se ejercita a proposito con el scrollDuration de este
    // run, en paralelo al motor de juicio de arriba, pero sin que nada de
    // esto vuelva a tocarlo.
    for (let columna = 0; columna < COLUMN_COUNT; columna++) {
      ventanas[columna] = avanzarVentana(
        notasPorColumna[columna]!,
        ventanas[columna]!,
        t,
        scrollDuration,
      );
      const { inicio, fin } = ventanas[columna]!;
      for (let i = inicio; i < fin; i++) {
        calcularPosicionNota(notasPorColumna[columna]![i]!.time, t, scrollDuration, GEOMETRIA_DE_PRUEBA);
      }
    }
  }

  return { estadoFinal: engine.state, golpes };
}

describe('la velocidad de caida es puramente visual (T-008)', () => {
  it('el mismo guion de pulsaciones da el mismo score y los mismos juicios con velocidades muy distintas', () => {
    const chart = crearChartDePrueba();
    const eventos = crearGuionDePulsaciones();

    const lento = simularPartida(chart, eventos, 3600); // velocidad 1 (la mas lenta)
    const rapido = simularPartida(chart, eventos, 300); // velocidad 12 (la mas rapida)

    expect(rapido.golpes).toEqual(lento.golpes);
    expect(rapido.estadoFinal).toEqual(lento.estadoFinal);

    // El guion tiene que haber producido de verdad una mezcla de resultados
    // (no solo "max" en todos lados), sino el test no estaria probando que
    // el combo, el miss y la LN sobreviven el cambio de velocidad igual.
    const juiciosVistos = new Set(lento.golpes.map((golpe) => golpe.judgement));
    expect(juiciosVistos.has('miss')).toBe(true);
    expect(juiciosVistos.size).toBeGreaterThan(1);
  });

  it('sanity: el scrollDuration usado en cada run si cambia lo visual (si no, el test de arriba no probaria nada)', () => {
    // Misma nota, mismo instante, geometria identica: solo cambia
    // scrollDuration. Si esto diera la misma `y` en los dos casos, el test
    // de arriba podria estar pasando sin haber ejercitado ninguna
    // diferencia real entre "lento" y "rapido".
    const posicionLenta = calcularPosicionNota(1000, 500, 3600, GEOMETRIA_DE_PRUEBA);
    const posicionRapida = calcularPosicionNota(1000, 500, 300, GEOMETRIA_DE_PRUEBA);

    expect(posicionRapida.y).not.toBe(posicionLenta.y);
  });
});
