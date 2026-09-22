// T-007: estadisticas de precision sobre los golpes de una partida. Logica
// pura (sin DOM, sin localStorage, sin @tetra/audio): entra un array de
// numeros o de golpes, sale un numero. Se saca a este modulo aparte
// (en vez de calcularlo inline en results.ts) justamente para poder
// testearlo con valores calculados a mano, sin depender del navegador (ver
// docs/tickets/T-007-calibracion-offset.md, "Como probar el calculo sin
// navegador").
//
// Vive en apps/web y no en packages/core: es estadistica de la pantalla de
// resultados, no una regla del juego que necesite portarse a otra
// implementacion del motor (ver CLAUDE.md, regla 2).

import type { Judgement, Ms } from '@tetra/core';

/** Lo minimo de un golpe que hace falta para las estadisticas: su juicio y su error. */
export interface GolpeRegistrado {
  readonly judgement: Judgement;
  readonly error: Ms;
}

/**
 * Errores de los golpes que no fueron miss, en ms.
 *
 * T-007, "Parte A" pide la media, la desviacion estandar y el conteo
 * temprano/tarde solo sobre estos: un miss se juzga recien cuando ya paso
 * la ventana de tiempo (ver packages/core/src/judge/engine.ts,
 * `procesarMissPorTiempo`), asi que su `error` no describe la precision de
 * una pulsacion real, sino cuanto tiempo paso hasta que se dio por perdida.
 * Mezclarlo con los demas errores rompería la media y la desviacion
 * estandar sin aportar nada sobre que tan bien apunta el jugador.
 */
export function erroresJuzgados(golpes: readonly GolpeRegistrado[]): Ms[] {
  return golpes.filter((golpe) => golpe.judgement !== 'miss').map((golpe) => golpe.error);
}

/** Media de un array de errores, en ms. 0 si el array esta vacio (nada que promediar). */
export function media(errores: readonly Ms[]): Ms {
  if (errores.length === 0) return 0;
  const suma = errores.reduce((acumulado, error) => acumulado + error, 0);
  return suma / errores.length;
}

/**
 * Desviacion estandar de un array de errores, en ms: describe que tan
 * disperso pega el jugador (un valor bajo es consistente), no si pega
 * temprano o tarde en promedio (eso lo dice `media`).
 *
 * Es la desviacion estandar POBLACIONAL (se divide por `n`, no por `n-1`):
 * este numero describe la dispersion de ESTOS golpes tal cual se dieron, no
 * intenta estimar la dispersion de una poblacion mas grande a partir de una
 * muestra. 0 si el array tiene 0 o 1 elementos (no hay dispersion posible).
 */
export function desviacionEstandar(errores: readonly Ms[]): Ms {
  if (errores.length <= 1) return 0;
  const promedio = media(errores);
  const sumaCuadrados = errores.reduce(
    (acumulado, error) => acumulado + (error - promedio) ** 2,
    0,
  );
  return Math.sqrt(sumaCuadrados / errores.length);
}

export interface ConteoTempranoTarde {
  readonly temprano: number;
  readonly tarde: number;
}

/**
 * Cuenta cuantos errores cayeron temprano (negativo) y cuantos tarde
 * (positivo). Un error de exactamente 0 no entra en ninguno de los dos
 * conteos (no fue ni temprano ni tarde).
 */
export function contarTempranoTarde(errores: readonly Ms[]): ConteoTempranoTarde {
  let temprano = 0;
  let tarde = 0;
  for (const error of errores) {
    if (error < 0) temprano++;
    else if (error > 0) tarde++;
  }
  return { temprano, tarde };
}

/** 'temprano' si el valor es negativo, 'tarde' si es positivo, null si es exactamente 0. */
export function etiquetaDeSigno(valor: Ms): 'temprano' | 'tarde' | null {
  if (valor < 0) return 'temprano';
  if (valor > 0) return 'tarde';
  return null;
}

/**
 * Calcula el offset corregido a partir del offset actual y la media de
 * error de la partida que se acaba de jugar. Es la funcion detras del boton
 * "corregir offset segun esta partida" de la pantalla de resultados (T-007,
 * "Parte B").
 *
 * El signo, con cuentas (ver T-007, "El signo, que es donde esto se rompe"):
 *
 * Dos hechos ya establecidos en el resto del codigo, sin tocar:
 *
 * 1. `clock.now()` (packages/audio/src/clock.ts) devuelve
 *    `tiempoDeJuego = tiempoReal - offset`, con `offset = userOffset +
 *    outputLatency` (JSDoc de `AudioClock.offset`).
 * 2. El motor de juicio (packages/core/src/judge/engine.ts) calcula
 *    `error = tiempoDeJuego - nota.time`.
 *
 * Combinando las dos: `error = (tiempoReal - nota.time) - offset`. Se llama
 * `sesgoFisico` a `tiempoReal - nota.time`: es el habito de pulsacion del
 * jugador, en terminos de tiempo real, antes de que el offset lo corrija.
 * Esta funcion asume que ese habito se mantiene igual en la proxima
 * partida (es la unica asuncion posible para un boton automatico: no hay
 * forma de saber si el jugador va a cambiar su forma de tocar, pero si se
 * puede asumir que su sesgo fisico, el que causo el error medido, sigue
 * ahi).
 *
 * Con esa asuncion, `sesgoFisico = mediaError + offsetActual` (despejando
 * de la formula de arriba con el offset de esta partida). Para que el
 * error de la proxima partida de cero con el offset nuevo:
 *
 *   0 = sesgoFisico - offsetNuevo
 *   offsetNuevo = sesgoFisico = mediaError + offsetActual
 *
 * Es decir: se SUMA la media al offset actual, no se resta.
 *
 * Ejemplo con los numeros de Arnold: pega temprano, mediaError = -24.
 * offsetNuevo = offsetActual - 24: el offset baja (queda mas negativo o
 * menos positivo). Con un offset mas chico, `tiempoDeJuego = tiempoReal -
 * offset` da un valor MAS GRANDE para el mismo tiempoReal, entonces
 * `error = tiempoDeJuego - nota.time` sube hacia cero: el error negativo
 * se corrige subiendo, no bajando mas.
 *
 * El bug clasico de signo invertido es restar la media en vez de sumarla
 * (`offsetActual - mediaError`): con ese error, el offset subiria a +24 en
 * vez de bajar a -24, y la proxima partida el mismo sesgo fisico daria un
 * error de -48 en vez de 0: DUPLICA el sesgo en vez de cancelarlo. El test
 * de signo en estadisticas.test.ts esta escrito para fallar exactamente en
 * ese caso.
 */
export function calcularOffsetCorregido(offsetActual: Ms, mediaError: Ms): Ms {
  return offsetActual + mediaError;
}
