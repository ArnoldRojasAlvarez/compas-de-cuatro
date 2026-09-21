// T-003: motor de juicio, score y HP.
//
// Logica pura: entra un mapa (Chart) y una secuencia de pulsaciones y
// soltadas con su tiempo, sale una lista de juicios y un estado de score.
// No toca el navegador, se prueba entero sin audio ni render (ver
// CLAUDE.md, "core no toca el navegador").
//
// Se llama varias veces por frame (press/release por cada tecla, update una
// vez antes de dibujar), asi que el camino caliente no reserva memoria mas
// alla del HitResult que cada llamada devuelve.

import type {
  Chart,
  Column,
  HitResult,
  HitWindows,
  Judgement,
  Ms,
  Note,
  HoldNote,
  ScoreState,
} from '../types.js';
import { COLUMN_COUNT, isHold } from '../types.js';
import { judge, windowsForOD } from './windows.js';

/**
 * Cuanto suma o resta cada juicio al HP, antes de acotar a [0, 1].
 * `bad` y `miss` se multiplican ademas por `1 + hpDrain / 10` (ver
 * `aplicarJuicio`). Exportada como constante para poder ajustarla sin
 * buscar por todo el archivo: son numeros de arranque que se van a tocar
 * cuando Arnold juegue (ver docs/tickets/T-003-motor-juicio.md).
 */
export const HP_DELTAS: Record<Judgement, number> = {
  max: 0.005,
  perfect: 0.004,
  great: 0.002,
  good: 0,
  bad: -0.01,
  miss: -0.04,
};

/** Peso de cada juicio para accuracy y score. Igual que en osu!mania. */
const PESO_JUICIO: Record<Judgement, number> = {
  max: 320,
  perfect: 300,
  great: 200,
  good: 100,
  bad: 50,
  miss: 0,
};

const FACTOR_VENTANA_COLA = 1.5;

export interface JudgeEngine {
  /**
   * Procesa una pulsacion en una columna.
   * Devuelve el juicio, o `null` si no habia ninguna nota juzgable cerca
   * (pulsacion al aire: no penaliza, solo se ignora).
   */
  press(time: Ms, column: Column): HitResult | null;

  /**
   * Procesa una soltada. Solo importa si hay una LN sostenida en esa columna.
   * Devuelve el juicio de la cola, o `null` si no habia LN activa.
   */
  release(time: Ms, column: Column): HitResult | null;

  /**
   * Marca como miss todo lo que ya se paso de su ventana. Se llama una vez
   * por frame, antes de dibujar.
   *
   * IMPORTANTE: devuelve un array reusado internamente. Cada llamada lo
   * vacia (`length = 0`) y lo vuelve a llenar: es el mismo objeto de
   * JavaScript en cada llamada, no una copia. Quien lo recibe lo lee ese
   * mismo frame y lo suelta. Si se guarda la referencia para leerla mas
   * tarde, su contenido va a haber cambiado por debajo sin aviso (ver el
   * test "update() reusa el array de salida" en engine.test.ts, que
   * demuestra exactamente este comportamiento).
   */
  update(time: Ms): readonly HitResult[];

  readonly state: ScoreState;

  /** true cuando ya se juzgaron todas las notas del mapa (cabeza y cola en las LN). */
  readonly finished: boolean;

  /** true si el HP llego a 0. Una vez true, se queda asi. */
  readonly failed: boolean;
}

function escalarVentanas(windows: HitWindows, factor: number): HitWindows {
  return {
    max: windows.max * factor,
    perfect: windows.perfect * factor,
    great: windows.great * factor,
    good: windows.good * factor,
    bad: windows.bad * factor,
    miss: windows.miss * factor,
  };
}

function contarJuiciosDelMapa(notes: readonly Note[]): number {
  let total = 0;
  for (const nota of notes) {
    total += isHold(nota) ? 2 : 1;
  }
  return total;
}

function estadoInicial(): ScoreState {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    accuracy: 1,
    hp: 1,
    counts: { max: 0, perfect: 0, great: 0, good: 0, bad: 0, miss: 0 },
  };
}

class MotorDeJuicio implements JudgeEngine {
  private readonly ventanas: HitWindows;
  private readonly ventanasCola: HitWindows;
  private readonly hpDrain: number;
  private readonly totalJuicios: number;

  /** Notas de cada columna, en el mismo orden ascendente que `chart.notes`. */
  private readonly notasPorColumna: readonly Note[][];
  /** Indice, por columna, de la proxima nota (cabeza) sin juzgar. */
  private readonly punteroPorColumna: number[];
  /** LN cuya cabeza ya se acerto y que esta esperando `release()`, por columna. */
  private readonly holdActivaPorColumna: Array<HoldNote | null>;

  private sumaPesos = 0;
  private juiciosEmitidos = 0;
  private hpFalloDefinitivo = false;

  /**
   * Juicios de cola forzados por una cabeza en miss dentro de `press()` (ver
   * comentario en `press`): `press` solo puede devolver un HitResult, asi
   * que el de la cola queda en cola para salir en la proxima llamada a
   * `update()`.
   */
  private readonly colaDeEmision: HitResult[] = [];
  /** Buffer reusado que devuelve `update()`. Ver JSDoc de `update` en la interfaz. */
  private readonly bufferSalida: HitResult[] = [];

  private readonly _state: ScoreState = estadoInicial();

  constructor(chart: Chart) {
    this.ventanas = windowsForOD(chart.overallDifficulty);
    this.ventanasCola = escalarVentanas(this.ventanas, FACTOR_VENTANA_COLA);
    this.hpDrain = chart.hpDrain;
    this.totalJuicios = contarJuiciosDelMapa(chart.notes);

    const porColumna: Note[][] = [[], [], [], []];
    for (const nota of chart.notes) {
      // chart.notes viene ordenado por time ascendente (invariante del
      // parser, ver types.ts): al filtrar por columna preservando el orden
      // de recorrido, cada arreglo por columna queda ordenado tambien, sin
      // hacer falta un sort aca.
      porColumna[nota.column]!.push(nota);
    }
    this.notasPorColumna = porColumna;

    this.punteroPorColumna = [0, 0, 0, 0];
    this.holdActivaPorColumna = [null, null, null, null];
  }

  get state(): ScoreState {
    return this._state;
  }

  get finished(): boolean {
    return this.juiciosEmitidos >= this.totalJuicios;
  }

  get failed(): boolean {
    return this.hpFalloDefinitivo;
  }

  press(time: Ms, column: Column): HitResult | null {
    const notas = this.notasPorColumna[column]!;
    const indice = this.punteroPorColumna[column]!;
    const nota = notas[indice];
    if (nota === undefined) {
      return null; // no quedan notas pendientes en esta columna
    }

    const error = time - nota.time;
    const juicio = judge(error, this.ventanas);
    if (juicio === null) {
      return null; // pulsacion al aire: no penaliza, la nota sigue pendiente
    }

    // A partir de aca la nota queda juzgada (como cabeza, si es LN): se
    // consume del puntero pase lo que pase con el juicio.
    this.punteroPorColumna[column] = indice + 1;
    this.aplicarJuicio(juicio);

    if (isHold(nota)) {
      if (juicio === 'miss') {
        // Cabeza en miss: la cola tambien cuenta miss y la LN no se puede
        // recuperar sosteniendo (ver docs/tickets/T-003, "Notas largas").
        // Se aplica al estado ya mismo (accuracy/score/hp tienen que
        // reflejarlo de inmediato), pero press() solo puede devolver un
        // HitResult: el de la cola se encola y sale en la proxima llamada a
        // update(), que corre una vez por frame antes de dibujar, es decir
        // en la practica el mismo frame en el que se produjo la pulsacion.
        this.aplicarJuicio('miss');
        this.colaDeEmision.push({
          note: nota,
          judgement: 'miss',
          error: time - nota.endTime,
        });
      } else {
        this.holdActivaPorColumna[column] = nota;
      }
    }

    return { note: nota, judgement: juicio, error };
  }

  release(time: Ms, column: Column): HitResult | null {
    const nota = this.holdActivaPorColumna[column];
    if (nota === null || nota === undefined) {
      return null; // no habia LN activa en esta columna
    }

    this.holdActivaPorColumna[column] = null;

    const error = time - nota.endTime;
    // judge() devuelve null tanto si se solto demasiado temprano (todavia
    // no entro a la ventana de la cola) como demasiado tarde: en los dos
    // casos cuenta miss, no hay "aire" posible una vez que la cabeza ya se
    // acerto y la LN quedo activa.
    const juicio = judge(error, this.ventanasCola) ?? 'miss';
    this.aplicarJuicio(juicio);

    return { note: nota, judgement: juicio, error };
  }

  update(time: Ms): readonly HitResult[] {
    this.bufferSalida.length = 0;

    for (const pendiente of this.colaDeEmision) {
      this.bufferSalida.push(pendiente);
    }
    this.colaDeEmision.length = 0;

    for (let columna = 0; columna < COLUMN_COUNT; columna++) {
      this.procesarMissPorTiempo(columna as Column, time);
    }

    return this.bufferSalida;
  }

  private procesarMissPorTiempo(columna: Column, time: Ms): void {
    const notas = this.notasPorColumna[columna]!;

    // Cabezas (y notas simples) que ya pasaron su ventana de miss sin ser
    // juzgadas. Las notas estan ordenadas por tiempo: en cuanto una nota
    // todavia esta dentro de su ventana, ninguna de las siguientes se paso
    // tampoco, asi que se puede cortar el bucle ahi sin recorrer el resto.
    let indice = this.punteroPorColumna[columna]!;
    while (indice < notas.length) {
      const nota = notas[indice]!;
      if (time <= nota.time + this.ventanas.miss) {
        break;
      }

      this.aplicarJuicio('miss');
      this.bufferSalida.push({ note: nota, judgement: 'miss', error: time - nota.time });

      if (isHold(nota)) {
        // La cabeza se paso de tiempo: la cola tambien cuenta miss, en el
        // mismo update (docs/tickets/T-003, "Miss por tiempo").
        this.aplicarJuicio('miss');
        this.bufferSalida.push({ note: nota, judgement: 'miss', error: time - nota.endTime });
      }

      indice++;
    }
    this.punteroPorColumna[columna] = indice;

    // Cola de una LN activa (cabeza ya acertada) que se paso de su propia
    // ventana sin soltarse. No esta escrito asi de literal en el ticket
    // (que solo cubre la cabeza en la seccion "Miss por tiempo"), pero es la
    // extension natural de la misma regla al otro extremo de la nota: sin
    // esto, sostener una LN mas alla de su ventana y no soltarla nunca
    // dejaria la nota en el limbo para siempre y `finished` no podria llegar
    // a ser true. Se documenta ademas como decision en el reporte final.
    const sostenida = this.holdActivaPorColumna[columna];
    if (
      sostenida !== null &&
      sostenida !== undefined &&
      time > sostenida.endTime + this.ventanasCola.miss
    ) {
      this.holdActivaPorColumna[columna] = null;
      this.aplicarJuicio('miss');
      this.bufferSalida.push({
        note: sostenida,
        judgement: 'miss',
        error: time - sostenida.endTime,
      });
    }
  }

  private aplicarJuicio(juicio: Judgement): void {
    this.sumaPesos += PESO_JUICIO[juicio];
    this.juiciosEmitidos++;
    this._state.counts[juicio]++;

    if (juicio === 'miss' || juicio === 'bad') {
      this._state.combo = 0;
    } else {
      this._state.combo++;
      if (this._state.combo > this._state.maxCombo) {
        this._state.maxCombo = this._state.combo;
      }
    }

    const escalaCastigo = juicio === 'bad' || juicio === 'miss' ? 1 + this.hpDrain / 10 : 1;
    const hpSinAcotar = this._state.hp + HP_DELTAS[juicio] * escalaCastigo;
    this._state.hp = Math.min(1, Math.max(0, hpSinAcotar));
    if (this._state.hp <= 0) {
      this.hpFalloDefinitivo = true;
    }

    // accuracy usa la cantidad de juicios emitidos hasta ahora (promedio
    // corriente); score usa el total de juicios del mapa completo, fijo
    // (avanza en proporcion a lo que falta del mapa, no solo a lo emitido).
    // Ver docs/tickets/T-003-motor-juicio.md, "Score, precision y HP".
    this._state.accuracy = this.sumaPesos / (320 * this.juiciosEmitidos);
    this._state.score = Math.floor((1_000_000 * this.sumaPesos) / (320 * this.totalJuicios));
  }
}

export function createJudgeEngine(chart: Chart): JudgeEngine {
  return new MotorDeJuicio(chart);
}
