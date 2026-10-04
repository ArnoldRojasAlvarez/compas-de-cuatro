// Tests de T-003 (motor de juicio, score y HP).
//
// Los mapas de prueba se arman a mano con los helpers de abajo, no se leen
// de archivos (ver docs/tickets/T-003-motor-juicio.md, seccion "Tests").
//
// Sobre el hallazgo de T-001 (test que se comparaba contra si mismo y no
// podia fallar nunca): antes de escribir cada asercion se penso que
// implementacion incorrecta la haria fallar. En particular:
// - El test de rendimiento no solo mide tiempo: tambien exige
//   `motor.state.counts.max === 3500` y `finished === true`, asi que una
//   implementacion que "retorna temprano" sin procesar nada de verdad
//   pasaria rapido pero fallaria esas dos aserciones.
// - El test de precision con mapa mixto trae el calculo de accuracy y score
//   hecho a mano en el comentario, con los pesos de la tabla del ticket, no
//   llamando de nuevo a la formula del motor.

import { describe, expect, it } from 'vitest';
import type { Chart, Column, HoldNote, Note, TapNote } from '../types.js';
import { createJudgeEngine } from './engine.js';
import { windowsForOD } from './windows.js';

// Vitest corre en Node y `process` existe en runtime, pero el repo no tiene
// @types/node instalado (no hace falta para el codigo de produccion: core
// no puede tocar nada especifico de una plataforma, ver CLAUDE.md). Se
// declara aca el minimo necesario para cronometrar el test de rendimiento,
// en vez de agregar una dependencia nueva solo para este test o de usar
// `performance.now()` / `Date.now()`, prohibidos en todo `packages/core`
// por las reglas de timing del juego (que no aplican a este cronometro de
// test, pero el lint no distingue el motivo, asi que se evita el patron).
declare const process: { hrtime: { bigint: () => bigint } };

// ---------------------------------------------------------------------------
// Helpers para armar mapas de prueba
// ---------------------------------------------------------------------------

function crearNotaSimple(column: Column, time: number): TapNote {
  return { kind: 'tap', time, column };
}

function crearNotaLarga(column: Column, time: number, endTime: number): HoldNote {
  return { kind: 'hold', time, endTime, column };
}

function crearMapa(notes: Note[], overallDifficulty = 7.3, hpDrain = 5): Chart {
  return {
    metadata: {
      title: 'Mapa de prueba',
      artist: 'Prueba',
      creator: 'Arnold Alvarez',
      difficultyName: 'Test',
      audioFile: 'test.mp3',
      previewTime: 0,
    },
    overallDifficulty,
    hpDrain,
    timingPoints: [],
    speedPoints: [],
    notes,
  };
}

// ---------------------------------------------------------------------------
// Emparejar pulsacion con nota
// ---------------------------------------------------------------------------

describe('press: emparejar pulsacion con nota', () => {
  it('press exacto sobre una nota devuelve max y sube el combo', () => {
    const nota = crearNotaSimple(0, 1000);
    const motor = createJudgeEngine(crearMapa([nota]));

    const resultado = motor.press(1000, 0);

    expect(resultado?.judgement).toBe('max');
    expect(resultado?.error).toBe(0);
    expect(motor.state.combo).toBe(1);
    expect(motor.state.maxCombo).toBe(1);
  });

  it('press al aire devuelve null, no cambia el estado y no rompe el combo, y la nota sigue pendiente', () => {
    const nota = crearNotaSimple(0, 1000);
    const motor = createJudgeEngine(crearMapa([nota]));

    // Demasiado temprano: fuera hasta de la ventana de miss.
    const resultado = motor.press(1, 0);

    expect(resultado).toBeNull();
    expect(motor.state.combo).toBe(0);
    expect(motor.state.counts.max).toBe(0);

    // La nota no se consumio: un press certero despues todavia la juzga.
    expect(motor.press(1000, 0)?.judgement).toBe('max');
  });

  it('press en la columna 0 no juzga una nota de la columna 1', () => {
    const notaCol1 = crearNotaSimple(1, 1000);
    const motor = createJudgeEngine(crearMapa([notaCol1]));

    const resultado = motor.press(1000, 0);

    expect(resultado).toBeNull();
    expect(motor.state.counts.max).toBe(0);
    expect(motor.press(1000, 1)?.judgement).toBe('max');
  });

  it('minijack: dos notas muy juntas en la misma columna se emparejan en orden, sin repetir ni saltar', () => {
    const nota1 = crearNotaSimple(0, 1000);
    const nota2 = crearNotaSimple(0, 1050); // 50ms de diferencia: minijack tipico
    const motor = createJudgeEngine(crearMapa([nota1, nota2]));

    const resultado1 = motor.press(1000, 0);
    const resultado2 = motor.press(1050, 0);

    expect(resultado1?.note).toBe(nota1);
    expect(resultado1?.judgement).toBe('max');
    expect(resultado2?.note).toBe(nota2);
    expect(resultado2?.judgement).toBe('max');
    expect(motor.state.combo).toBe(2);

    // Ya no quedan notas pendientes en la columna: una tercera pulsacion es aire.
    expect(motor.press(1100, 0)).toBeNull();
  });

  it('minijack: siempre empareja con la nota pendiente mas temprana, nunca con la mas cercana en el tiempo', () => {
    const nota1 = crearNotaSimple(0, 1000);
    const nota2 = crearNotaSimple(0, 1010); // 10ms de diferencia
    const motor = createJudgeEngine(crearMapa([nota1, nota2]));

    // La pulsacion cae mucho mas cerca de nota2 (1ms) que de nota1 (9ms),
    // pero nota1 es la pendiente mas temprana y sigue dentro de su ventana
    // de miss: tiene que ganar ella. Un emparejamiento "por cercania" en vez
    // de "por orden de columna" tomaria nota2 aca y se equivocaria.
    const resultado = motor.press(1009, 0);
    expect(resultado?.note).toBe(nota1);
    expect(resultado?.error).toBe(9);

    const siguiente = motor.press(1010, 0);
    expect(siguiente?.note).toBe(nota2);
    expect(siguiente?.error).toBe(0);
  });

  it('bad rompe el combo', () => {
    const nota1 = crearNotaSimple(0, 1000);
    const nota2 = crearNotaSimple(1, 2000);
    const motor = createJudgeEngine(crearMapa([nota1, nota2]));

    motor.press(1000, 0);
    expect(motor.state.combo).toBe(1);

    // OD 7.3: good = 105.1, bad = 129.1. Error 120 cae en bad.
    const resultado = motor.press(2120, 1);
    expect(resultado?.judgement).toBe('bad');
    expect(motor.state.combo).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Miss por tiempo (update)
// ---------------------------------------------------------------------------

describe('update: miss por tiempo', () => {
  it('una nota que pasa su ventana de miss aparece en el update siguiente con miss, una sola vez', () => {
    const nota = crearNotaSimple(0, 1000);
    const w = windowsForOD(7.3);
    const motor = createJudgeEngine(crearMapa([nota]));

    const t = 1000 + w.miss + 1;
    const primero = motor.update(t);
    expect(primero).toHaveLength(1);
    expect(primero[0]?.judgement).toBe('miss');
    expect(primero[0]?.note).toBe(nota);

    const segundo = motor.update(t);
    expect(segundo).toHaveLength(0);
    expect(motor.state.counts.miss).toBe(1);
  });

  it('update() reusa el array de salida: guardar la referencia es una trampa', () => {
    const nota = crearNotaSimple(0, 1000);
    const w = windowsForOD(7.3);
    const motor = createJudgeEngine(crearMapa([nota]));

    const primeraLlamada = motor.update(1000 + w.miss + 1);
    expect(primeraLlamada).toHaveLength(1);
    expect(primeraLlamada[0]?.judgement).toBe('miss');

    // La siguiente llamada no tiene nada nuevo que reportar, pero vacia y
    // reescribe el MISMO array: si alguien guardo "primeraLlamada" pensando
    // que era una copia propia, su contenido cambia por debajo sin que el
    // caller haga nada.
    const segundaLlamada = motor.update(999_999_999);
    expect(segundaLlamada).toHaveLength(0);
    expect(primeraLlamada).toHaveLength(0); // la referencia vieja tambien quedo vacia
    expect(primeraLlamada).toBe(segundaLlamada); // es literalmente el mismo array
  });
});

// ---------------------------------------------------------------------------
// Notas largas
// ---------------------------------------------------------------------------

describe('notas largas (LN)', () => {
  it('la cola de una LN usa ventanas 1.5 veces mas anchas que la cabeza', () => {
    const nota = crearNotaLarga(0, 1000, 2000);
    const motor = createJudgeEngine(crearMapa([nota]));

    expect(motor.press(1000, 0)?.judgement).toBe('max');

    // OD 7.3: great = 75.1, good = 105.1. Un error de 100ms seria 'good' con
    // la ventana normal. Con la ventana de cola escalada x1.5 (great pasa a
    // 112.65) el mismo error cae dentro de 'great'. Si el resultado da
    // 'good', la escala x1.5 no se esta aplicando.
    const resultado = motor.release(2100, 0);
    expect(resultado?.judgement).toBe('great');
    expect(resultado?.error).toBe(100);
  });

  it('soltar una LN mucho antes de su ventana de cola da miss', () => {
    const nota = crearNotaLarga(0, 1000, 2000);
    const motor = createJudgeEngine(crearMapa([nota]));

    motor.press(1000, 0);
    // 800ms antes del final: afuera hasta de la ventana de cola escalada
    // (166.1 * 1.5 = 249.15 con OD 7.3).
    const resultado = motor.release(1200, 0);
    expect(resultado?.judgement).toBe('miss');
  });

  it('release() sin LN activa en esa columna devuelve null', () => {
    const nota = crearNotaSimple(0, 1000); // nota simple, no LN
    const motor = createJudgeEngine(crearMapa([nota]));

    motor.press(1000, 0);
    expect(motor.release(1500, 0)).toBeNull();
  });

  it('cabeza en miss fuerza cola en miss, sin poder recuperarla sosteniendo', () => {
    const nota = crearNotaLarga(0, 1000, 2000);
    const w = windowsForOD(7.3);
    const motor = createJudgeEngine(crearMapa([nota]));

    // Pulsacion tan desviada que cae justo en el borde de la ventana de
    // miss de la cabeza (adentro, si no seria aire): la cabeza se juzga
    // 'miss' en vez de simplemente no encontrar nota.
    const resultadoCabeza = motor.press(1000 + w.miss, 0);
    expect(resultadoCabeza?.judgement).toBe('miss');

    // No quedo LN activa: sostener y soltar despues no hace nada.
    expect(motor.release(2000, 0)).toBeNull();

    // El juicio de la cola forzado por la cabeza sale en la proxima llamada
    // a update() (ver JSDoc de update() en engine.ts).
    const resultadosUpdate = motor.update(1000);
    expect(resultadosUpdate).toHaveLength(1);
    expect(resultadosUpdate[0]?.judgement).toBe('miss');
    expect(resultadosUpdate[0]?.note).toBe(nota);

    // Dos juicios de miss contados (cabeza + cola), no uno solo.
    expect(motor.state.counts.miss).toBe(2);
    expect(motor.finished).toBe(true);
  });

  it('si la cabeza de una LN pasa a miss por tiempo, la cola tambien, en el mismo update', () => {
    const nota = crearNotaLarga(0, 1000, 2000);
    const w = windowsForOD(7.3);
    const motor = createJudgeEngine(crearMapa([nota]));

    const resultados = motor.update(1000 + w.miss + 1);

    expect(resultados).toHaveLength(2);
    expect(resultados[0]?.judgement).toBe('miss');
    expect(resultados[1]?.judgement).toBe('miss');
    expect(motor.state.counts.miss).toBe(2);
    expect(motor.finished).toBe(true);
  });

  it('una LN sostenida mas alla de su ventana de cola sin soltarla cuenta miss (para que finished pueda llegar a true)', () => {
    const nota = crearNotaLarga(0, 1000, 2000);
    const w = windowsForOD(7.3);
    const motor = createJudgeEngine(crearMapa([nota]));

    expect(motor.press(1000, 0)?.judgement).toBe('max');
    expect(motor.finished).toBe(false);

    const tailMissTime = 2000 + w.miss * 1.5 + 1;
    const resultados = motor.update(tailMissTime);

    expect(resultados).toHaveLength(1);
    expect(resultados[0]?.judgement).toBe('miss');
    expect(motor.finished).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Score, precision y HP
// ---------------------------------------------------------------------------

describe('score, precision y HP', () => {
  it('con todo en max, accuracy da 1 y score da 1000000', () => {
    const notas = [crearNotaSimple(0, 1000), crearNotaSimple(1, 2000), crearNotaSimple(2, 3000)];
    const motor = createJudgeEngine(crearMapa(notas));

    for (const nota of notas) {
      motor.press(nota.time, nota.column);
    }

    expect(motor.state.accuracy).toBe(1);
    expect(motor.state.score).toBe(1_000_000);
    expect(motor.finished).toBe(true);
  });

  it('con todo en miss, accuracy da 0, score da 0 y failed es true', () => {
    const w = windowsForOD(7.3);
    const notas = Array.from({ length: 15 }, (_, i) =>
      crearNotaSimple((i % 4) as Column, 1000 * (i + 1)),
    );
    // hpDrain alto para garantizar que el HP llegue a 0 con 15 misses.
    const motor = createJudgeEngine(crearMapa(notas, 7.3, 10));

    motor.update(15_000 + w.miss + 1);

    expect(motor.state.accuracy).toBe(0);
    expect(motor.state.score).toBe(0);
    expect(motor.state.hp).toBe(0);
    expect(motor.failed).toBe(true);
    expect(motor.finished).toBe(true);
  });

  it('mapa mixto: la precision coincide con la formula calculada a mano', () => {
    const w = windowsForOD(5);
    const notaMax = crearNotaSimple(0, 1000); // se pulsa con error 0
    const notaGreat = crearNotaSimple(1, 2000); // se pulsa con error 50
    const notaGood = crearNotaSimple(2, 3000); // se pulsa con error 100
    const notaMiss = crearNotaSimple(3, 4000); // nunca se pulsa

    const motor = createJudgeEngine(
      crearMapa([notaMax, notaGreat, notaGood, notaMiss], 5),
    );

    expect(motor.press(1000, 0)?.judgement).toBe('max');
    expect(motor.press(2050, 1)?.judgement).toBe('great');
    expect(motor.press(3100, 2)?.judgement).toBe('good');
    motor.update(4000 + w.miss + 1);

    // Calculo a mano con la tabla de pesos del ticket (max=320, great=200,
    // good=100, miss=0), sin volver a pasar por la formula del motor:
    //   suma de pesos = 320 + 200 + 100 + 0 = 620
    //   accuracy = 620 / (320 * 4 juicios emitidos) = 620 / 1280 = 0.484375
    //   score = floor(1_000_000 * 620 / (320 * 4 notas del mapa))
    //         = floor(1_000_000 * 620 / 1280) = floor(484375) = 484375
    expect(motor.state.accuracy).toBeCloseTo(0.484375, 6);
    expect(motor.state.score).toBe(484_375);
  });

  it('finished pasa a true solo cuando se juzgo hasta la ultima nota', () => {
    const notas = [crearNotaSimple(0, 1000), crearNotaSimple(1, 2000)];
    const motor = createJudgeEngine(crearMapa(notas));

    motor.press(1000, 0);
    expect(motor.finished).toBe(false);

    motor.press(2000, 1);
    expect(motor.finished).toBe(true);
  });

  it('el HP se acota entre 0 y 1: no pasa de 1 aunque los juicios positivos alcancen para superarlo', () => {
    const w = windowsForOD(7.3);
    const notasMiss = Array.from({ length: 5 }, (_, i) =>
      crearNotaSimple((i % 4) as Column, 1000 + i * 100),
    );
    const notasMax = Array.from({ length: 100 }, (_, i) =>
      crearNotaSimple((i % 4) as Column, 10_000 + i * 100),
    );
    const motor = createJudgeEngine(crearMapa([...notasMiss, ...notasMax], 7.3, 10));

    // Con hpDrain 10, cada miss castiga 0.04 * (1 + 10/10) = 0.08. Las 5
    // misses bajan el HP de 1 a 1 - 5*0.08 = 0.6.
    motor.update(1400 + w.miss + 1);
    expect(motor.state.hp).toBeCloseTo(0.6, 5);

    // Las 100 notas en max suman 100 * 0.005 = 0.5, que sin acotar llevarian
    // el HP a 0.6 + 0.5 = 1.1. El resultado tiene que quedar en 1, no en 1.1.
    for (const nota of notasMax) {
      motor.press(nota.time, nota.column);
    }
    expect(motor.state.hp).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Rendimiento
// ---------------------------------------------------------------------------

describe('rendimiento', () => {
  it('procesa un mapa de 3500 notas completo en menos de 50ms', () => {
    const cantidad = 3500;
    const notas = Array.from({ length: cantidad }, (_, i) =>
      crearNotaSimple((i % 4) as Column, 1000 + i * 50),
    );
    const chart = crearMapa(notas);

    // Mejor de varias corridas: el minimo ignora los picos de carga de la
    // maquina (otros procesos, el servidor de desarrollo abierto) y sigue
    // delatando una regresion algoritmica real, que seria lenta en TODAS las
    // corridas. Un limite sobre una sola corrida media la maquina, no el codigo.
    const CORRIDAS = 7;
    let duracionMs = Infinity;
    let motor = createJudgeEngine(chart);
    for (let corrida = 0; corrida < CORRIDAS; corrida++) {
      motor = createJudgeEngine(chart);
      const inicio = process.hrtime.bigint();

      for (const nota of chart.notes) {
        motor.press(nota.time, nota.column);
        motor.update(nota.time);
      }
      const ultimaNota = chart.notes[chart.notes.length - 1]!;
      motor.update(ultimaNota.time + 1000);

      duracionMs = Math.min(duracionMs, Number(process.hrtime.bigint() - inicio) / 1_000_000);
    }

    // No alcanza con que el cronometro de poco: si una implementacion
    // incorrecta "retornara temprano" sin procesar nada, seria rapidisima
    // pero estas dos aserciones la delatarian, porque exigen que el motor
    // haya emparejado y juzgado de verdad las 3500 notas.
    expect(motor.state.counts.max).toBe(cantidad);
    expect(motor.finished).toBe(true);

    expect(duracionMs).toBeLessThan(50);
  });
});
