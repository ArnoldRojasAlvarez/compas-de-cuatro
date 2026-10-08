// Tests de T-044: replay, jugador perfecto y determinismo del motor.
//
// Antes de cada asercion se penso que implementacion incorrecta la haria
// fallar (ver el comentario de cada bloque). Los mapas son sinteticos (core no
// lee archivos) pero cubren lo dificil: acordes, largas, minijacks y notas de
// una misma columna a menos de 40 ms.

import { describe, expect, it } from 'vitest';
import { createJudgeEngine } from './judge/engine.js';
import { windowsForOD } from './judge/windows.js';
import {
  crearGrabadorDeReplay,
  crearReproductorDeReplay,
  MARGEN_DE_EXPIRACION_MS,
  entregarEvento,
  expirarConMargen,
  expirarSinMargen,
  hashDeReplay,
  leerReplay,
  replayEsDeEsteMapa,
  replayPerfecto,
  serializarReplay,
  type EventoReplay,
  type Replay,
} from './replay.js';
import type { Chart, Column, Note, ScoreState } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function crearMapa(notes: Note[], overallDifficulty = 7.3): Chart {
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
    hpDrain: 5,
    timingPoints: [],
    speedPoints: [],
    notes,
  };
}

/** Generador pseudoaleatorio determinista (mulberry32): el mismo seed da el mismo mapa. */
function azar(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Un mapa de unos 2 minutos con simples, largas y acordes, en una grilla de
 * 125 ms con saltos de 0 a 2 pasos. Nunca solapa dos notas de una misma
 * columna (una larga termina antes de la siguiente de su columna).
 */
function mapaAleatorio(semilla: number, pasos = 900): Chart {
  const rnd = azar(semilla);
  const libreDesde = [0, 0, 0, 0];
  const notas: Note[] = [];
  let tiempo = 1000;
  for (let paso = 0; paso < pasos; paso++) {
    tiempo += 125 * Math.floor(rnd() * 3);
    const cantidad = 1 + Math.floor(rnd() * 2.2);
    for (let k = 0; k < cantidad; k++) {
      const column = Math.floor(rnd() * 4) as Column;
      if (libreDesde[column]! > tiempo) continue;
      if (notas.some((n) => n.time === tiempo && n.column === column)) continue;
      if (rnd() < 0.25) {
        const fin = tiempo + 125 * (1 + Math.floor(rnd() * 4));
        notas.push({ kind: 'hold', time: tiempo, endTime: fin, column });
        libreDesde[column] = fin;
      } else {
        notas.push({ kind: 'tap', time: tiempo, column });
        libreDesde[column] = tiempo;
      }
    }
    tiempo += 125;
  }
  notas.sort((a, b) => a.time - b.time);
  return crearMapa(notas);
}

/** Politica con la que se entregan los eventos al motor. */
type Politica = 'update-antes-de-cada-evento' | 'ingenua';

function ultimoInstante(chart: Chart): number {
  return chart.notes.reduce((m, n) => Math.max(m, n.kind === 'hold' ? n.endTime : n.time), 0);
}

/** Copia profunda de un estado, para compararlo despues de seguir usando el motor. */
function foto(estado: ScoreState): ScoreState {
  return { ...estado, counts: { ...estado.counts } };
}

/**
 * El bucle de partida de game.ts, sin audio ni DOM: en cada frame (cada
 * `msPorFrame` de tiempo de juego) se entregan al motor los eventos con
 * `time <= t`, cada uno con su propio `time`, y despues se llama a
 * `update(t)`. Termina cuando el motor termino. Devuelve el estado final.
 *
 * La politica `ingenua` (eventos del frame y luego `update`, sin el `update`
 * previo a cada evento) es la que NO es determinista: existe para probar que
 * los tests la detectan.
 */
function jugar(
  chart: Chart,
  eventos: readonly EventoReplay[],
  msPorFrame: number,
  politica: Politica = 'update-antes-de-cada-evento',
  duracion: number = ultimoInstante(chart) + 5000,
): ScoreState {
  const motor = createJudgeEngine(chart);
  const replay: Replay = { version: 1, hashMapa: '1', offsetUsuario: 0, eventos: [...eventos] };
  const reproductor = crearReproductorDeReplay(replay);
  const sinNada = (): void => undefined;
  const inyectar = (e: EventoReplay): void => {
    if (politica === 'ingenua') {
      if (e.tipo === 'down') motor.press(e.time, e.column);
      else motor.release(e.time, e.column);
    } else {
      entregarEvento(motor, e, sinNada);
    }
  };
  // El bucle de game.ts: eventos, expiracion con margen y, al terminar, expiracion sin margen.
  for (let t = -1500; ; t += msPorFrame) {
    reproductor.avanzar(t, inyectar);
    if (politica === 'ingenua') motor.update(t);
    else expirarConMargen(motor, t, sinNada);
    if (motor.finished || t >= duracion) {
      expirarSinMargen(motor, t, sinNada);
      break;
    }
  }
  expect(motor.finished).toBe(true);
  return foto(motor.state);
}

/**
 * Una partida EN VIVO: los eventos "humanos" (cada uno con su tiempo real)
 * llegan en orden, cada uno en el primer frame cuyo `t` lo alcanza mas un
 * retraso de entrega de hasta 40 ms (el evento se entrega despues del rAF en
 * que ocurrio), con un ruido de hasta 4 ms en su tiempo (la conversion de
 * `timeStamp` a tiempo de juego no es exacta). Pasan por el grabador, por
 * `entregarEvento` y por `expirarConMargen` como en game.ts. Devuelve el estado
 * final y lo que quedo grabado.
 */
function jugarEnVivo(
  chart: Chart,
  humanos: readonly EventoReplay[],
  msPorFrame: number,
  semilla: number,
): { estado: ScoreState; grabados: EventoReplay[] } {
  const rnd = azar(semilla);
  const motor = createJudgeEngine(chart);
  const grabador = crearGrabadorDeReplay();
  const sinNada = (): void => undefined;
  const retrasos = humanos.map(() => rnd() * 40);
  const duracion = ultimoInstante(chart) + 5000;
  let siguiente = 0;
  for (let t = -1500; ; t += msPorFrame) {
    while (siguiente < humanos.length && humanos[siguiente]!.time + retrasos[siguiente]! <= t) {
      const h = humanos[siguiente]!;
      siguiente++;
      const llegado = grabador.registrar(h.time - rnd() * 4, h.column, h.tipo);
      entregarEvento(motor, llegado, sinNada);
    }
    grabador.actualizado(expirarConMargen(motor, t, sinNada));
    if (motor.finished || t >= duracion) {
      expirarSinMargen(motor, t, sinNada);
      break;
    }
  }
  expect(motor.finished).toBe(true);
  return { estado: foto(motor.state), grabados: grabador.replay('1', 0).eventos };
}

/**
 * Una "partida humana" sintetica: cada nota se pulsa con un error aleatorio
 * (casi siempre dentro de ventana, a veces fuera: miss), las largas se sueltan
 * tambien con error, y de vez en cuando hay una pulsacion al aire. Devuelve
 * los eventos en orden cronologico.
 */
function partidaHumana(chart: Chart, semilla: number): EventoReplay[] {
  const rnd = azar(semilla);
  const eventos: EventoReplay[] = [];
  const error = (): number => (rnd() - 0.5) * (rnd() < 0.08 ? 400 : 110);
  // Una tecla fisica alterna down y up: no se pulsa una columna que sigue
  // apretada (el teclado real no manda dos down seguidos, ver createKeyboardInput).
  const libreDesde = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (const nota of chart.notes) {
    if (rnd() < 0.03) continue; // nota que no se toco
    const abajo = Math.max(nota.time + error(), libreDesde[nota.column]! + 2);
    eventos.push({ time: abajo, column: nota.column, tipo: 'down' });
    const arriba = Math.max(
      nota.kind === 'hold' ? nota.endTime + error() : abajo + 30 + rnd() * 40,
      abajo + 5,
    );
    eventos.push({ time: arriba, column: nota.column, tipo: 'up' });
    libreDesde[nota.column] = arriba;
    if (rnd() < 0.04) {
      // Una pulsacion al aire en otra columna, si esta libre.
      const otra = ((nota.column + 1) % 4) as Column;
      const aire = Math.max(nota.time + 700, libreDesde[otra]! + 2);
      eventos.push({ time: aire, column: otra, tipo: 'down' });
      eventos.push({ time: aire + 40, column: otra, tipo: 'up' });
      libreDesde[otra] = aire + 40;
    }
  }
  return eventos.sort((a, b) => a.time - b.time);
}

function totalDeJuicios(notas: readonly Note[]): number {
  return notas.reduce((total, n) => total + (n.kind === 'hold' ? 2 : 1), 0);
}

function soloMax(estado: ScoreState, notas: readonly Note[]): boolean {
  return estado.counts.max === totalDeJuicios(notas);
}

// ---------------------------------------------------------------------------
// replayPerfecto
// ---------------------------------------------------------------------------

describe('replayPerfecto + motor de juicio', () => {
  // Un bot que se equivoca en la forma (por ejemplo, que suelte las largas en
  // `time` en vez de en `endTime`, o que no suelte nunca) deja de dar MAX en la
  // cola, y el conteo exacto `max === juicios totales` lo detecta.
  it.each([1, 2, 3, 4, 5])(
    'mapa aleatorio %i: todo MAX, score 1 000 000, a cualquier frecuencia de frame',
    (semilla) => {
      const chart = mapaAleatorio(semilla);
      expect(chart.notes.some((n) => n.kind === 'hold')).toBe(true);
      const replay = replayPerfecto(chart);
      for (const msPorFrame of [1000 / 240, 1000 / 60, 1000 / 30, 100]) {
        const estado = jugar(chart, replay.eventos, msPorFrame);
        expect(soloMax(estado, chart.notes)).toBe(true);
        expect(estado.score).toBe(1_000_000);
        expect(estado.accuracy).toBe(1);
        expect(estado.counts).toEqual({
          max: totalDeJuicios(chart.notes),
          perfect: 0,
          great: 0,
          good: 0,
          bad: 0,
          miss: 0,
        });
        // El combo cuenta cabezas y colas: es el total de juicios.
        expect(estado.maxCombo).toBe(totalDeJuicios(chart.notes));
      }
    },
  );

  it('una nota simple se suelta 40 ms despues; una larga, en su endTime', () => {
    const chart = crearMapa([
      { kind: 'tap', time: 1000, column: 0 },
      { kind: 'hold', time: 2000, endTime: 2600, column: 1 },
    ]);
    expect(replayPerfecto(chart).eventos).toEqual([
      { time: 1000, column: 0, tipo: 'down' },
      { time: 1040, column: 0, tipo: 'up' },
      { time: 2000, column: 1, tipo: 'down' },
      { time: 2600, column: 1, tipo: 'up' },
    ]);
  });

  // Un bot ingenuo que suelte siempre en time + 40 pulsaria la columna dos
  // veces a la vez cuando hay dos notas a 30 ms: el up de la primera caeria
  // despues del down de la segunda.
  it('nunca pulsa dos veces la misma columna a la vez: con notas a menos de 40 ms el up va a la mitad', () => {
    const chart = crearMapa([
      { kind: 'tap', time: 1000, column: 2 },
      { kind: 'tap', time: 1030, column: 2 },
      { kind: 'tap', time: 1070, column: 2 },
      { kind: 'tap', time: 1500, column: 2 },
    ]);
    const eventos = replayPerfecto(chart).eventos;
    expect(eventos).toEqual([
      { time: 1000, column: 2, tipo: 'down' },
      { time: 1015, column: 2, tipo: 'up' },
      { time: 1030, column: 2, tipo: 'down' },
      { time: 1050, column: 2, tipo: 'up' },
      { time: 1070, column: 2, tipo: 'down' },
      { time: 1110, column: 2, tipo: 'up' },
      { time: 1500, column: 2, tipo: 'down' },
      { time: 1540, column: 2, tipo: 'up' },
    ]);
    expect(soloMax(jugar(chart, eventos, 16), chart.notes)).toBe(true);
    // Y en cualquier mapa, por columna, los eventos alternan down y up.
    const grande = replayPerfecto(mapaAleatorio(9));
    for (const columna of [0, 1, 2, 3]) {
      let abajo = false;
      for (const e of grande.eventos.filter((x) => x.column === columna)) {
        expect(abajo).toBe(e.tipo === 'up');
        abajo = e.tipo === 'down';
      }
    }
  });

  it('una larga seguida de una nota en el mismo ms de su fin: suelta y vuelve a pulsar, sin recortar la larga', () => {
    const chart = crearMapa([
      { kind: 'hold', time: 1000, endTime: 1500, column: 0 },
      { kind: 'tap', time: 1500, column: 0 },
    ]);
    const eventos = replayPerfecto(chart).eventos;
    expect(eventos.slice(0, 3)).toEqual([
      { time: 1000, column: 0, tipo: 'down' },
      { time: 1500, column: 0, tipo: 'up' },
      { time: 1500, column: 0, tipo: 'down' },
    ]);
    expect(soloMax(jugar(chart, eventos, 16), chart.notes)).toBe(true);
  });

  it('los eventos salen ordenados por tiempo', () => {
    const { eventos } = replayPerfecto(mapaAleatorio(7));
    for (let i = 1; i < eventos.length; i++) {
      expect(eventos[i]!.time).toBeGreaterThanOrEqual(eventos[i - 1]!.time);
    }
  });

  it('un mapa sin notas da un replay sin eventos', () => {
    expect(replayPerfecto(crearMapa([])).eventos).toEqual([]);
  });

  it('guarda el hash del mapa, y solo es "de este mapa" si las notas coinciden', () => {
    const chart = mapaAleatorio(1);
    const replay = replayPerfecto(chart);
    expect(replay.hashMapa).toBe(hashDeReplay(chart));
    expect(replayEsDeEsteMapa(replay, chart)).toBe(true);
    expect(replayEsDeEsteMapa(replay, mapaAleatorio(2))).toBe(false);
    expect(replayEsDeEsteMapa(replay, { ...chart, overallDifficulty: 5 })).toBe(false);
  });

  // Mutantes: la prueba "todo MAX" solo tiene sentido si un bot apenas peor la
  // rompe. Se fija el borde exacto de las ventanas. (El ticket pedia un bot "1
  // ms tarde en las largas"; con la ventana MAX de 16,5 ms de la cabeza y 24,75
  // de la cola, 1 ms todavia es MAX: aca se prueba el borde real.)
  describe('un bot defectuoso NO saca todo MAX', () => {
    const chart = mapaAleatorio(11);
    const ventanas = windowsForOD(chart.overallDifficulty);
    const perfecto = replayPerfecto(chart).eventos;

    function desplazado(ms: number, cuales: (e: EventoReplay) => boolean): EventoReplay[] {
      return perfecto.map((e) => (cuales(e) ? { ...e, time: e.time + ms } : e));
    }

    it('con toda pulsacion dentro de la ventana MAX (16 ms tarde) sigue siendo todo MAX', () => {
      const estado = jugar(chart, desplazado(16, () => true), 16);
      expect(soloMax(estado, chart.notes)).toBe(true);
    });

    it('con toda pulsacion apenas fuera de la ventana MAX (17 ms tarde) ya no lo es', () => {
      expect(ventanas.max).toBe(16.5);
      const estado = jugar(chart, desplazado(17, () => true), 16);
      expect(soloMax(estado, chart.notes)).toBe(false);
      expect(estado.counts.perfect).toBeGreaterThan(0);
    });

    it('un bot que suelta las largas tarde (mas alla de la ventana MAX de la cola) pierde el MAX de las colas', () => {
      // Ventana MAX de la cola: 16,5 x 1,5 = 24,75 ms. A 24 ms tarde sigue en MAX; a 26 no.
      const justo = jugar(chart, desplazado(24, (e) => e.tipo === 'up'), 16);
      expect(soloMax(justo, chart.notes)).toBe(true);
      const tarde = jugar(chart, desplazado(26, (e) => e.tipo === 'up'), 16);
      expect(soloMax(tarde, chart.notes)).toBe(false);
      expect(tarde.score).toBeLessThan(1_000_000);
    });

    it('un bot que nunca suelta las largas pierde sus colas', () => {
      // Una larga por columna, sin otra nota detras en su columna.
      const aparte = crearMapa([
        { kind: 'hold', time: 1000, endTime: 1600, column: 0 },
        { kind: 'hold', time: 2000, endTime: 2600, column: 1 },
        { kind: 'tap', time: 3000, column: 2 },
      ]);
      const sinSoltar = replayPerfecto(aparte).eventos.filter((e) => e.tipo === 'down');
      const estado = jugar(aparte, sinSoltar, 16);
      expect(estado.counts.miss).toBe(2);
      expect(estado.counts.max).toBe(3);
      expect(soloMax(estado, aparte.notes)).toBe(false);
    });

    it('un bot que suelta las largas en su cabeza en vez de en su endTime las pierde', () => {
      const aparte = crearMapa([{ kind: 'hold', time: 1000, endTime: 1600, column: 0 }]);
      const cortado: EventoReplay[] = [
        { time: 1000, column: 0, tipo: 'down' },
        { time: 1040, column: 0, tipo: 'up' },
      ];
      const estado = jugar(aparte, cortado, 16);
      expect(estado.counts.max).toBe(1);
      expect(estado.counts.miss).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Determinismo: grabar y reproducir da lo mismo
// ---------------------------------------------------------------------------

describe('determinismo: reproducir un replay grabado da el mismo score, combo y conteos', () => {
  // Una implementacion que inyecte los eventos con el tiempo del FRAME en vez
  // de su propio `time` cambiaria los errores y, con ellos, los juicios. Una
  // que no llame a `update` antes de cada evento (politica ingenua) da otro
  // resultado segun la frecuencia de frames: la nota anterior de la columna se
  // descarta antes o despues de la pulsacion segun donde caiga el frame.
  it.each([21, 22, 23, 24])(
    'partida en vivo %i: la reproduccion a otra frecuencia da exactamente el mismo estado',
    (semilla) => {
      const chart = mapaAleatorio(semilla);
      const humanos = partidaHumana(chart, semilla * 7);
      const vivo = jugarEnVivo(chart, humanos, 1000 / 60, semilla);

      // La partida no es trivial: hay de todo.
      expect(vivo.estado.counts.miss).toBeGreaterThan(0);
      expect(vivo.estado.counts.max).toBeGreaterThan(0);
      expect(
        vivo.estado.counts.perfect + vivo.estado.counts.great + vivo.estado.counts.good,
      ).toBeGreaterThan(0);
      expect(vivo.estado.score).toBeLessThan(1_000_000);

      // Se serializa, se lee y se reproduce a otras frecuencias de frame.
      const texto = serializarReplay({
        version: 1,
        hashMapa: hashDeReplay(chart),
        offsetUsuario: -7,
        eventos: vivo.grabados,
      });
      const leido = leerReplay(texto);
      expect(leido).not.toBeNull();
      for (const msPorFrame of [1000 / 240, 1000 / 144, 1000 / 60, 1000 / 24, 250, 1000]) {
        expect(jugar(chart, leido!.eventos, msPorFrame)).toEqual(vivo.estado);
      }
    },
  );

  it('la politica ingenua (sin update antes de cada evento) SI cambia con la frecuencia: los tests la atrapan', () => {
    const diferentes = [21, 22, 23, 24].filter((semilla) => {
      const chart = mapaAleatorio(semilla);
      const eventos = partidaHumana(chart, semilla * 7);
      const a = jugar(chart, eventos, 1000 / 60, 'ingenua');
      const b = jugar(chart, eventos, 250, 'ingenua');
      return JSON.stringify(a) !== JSON.stringify(b);
    });
    expect(diferentes.length).toBeGreaterThan(0);
  });

  it('el estado depende de los eventos: cambiar uno solo lo cambia', () => {
    const chart = mapaAleatorio(31);
    const grabada = partidaHumana(chart, 99);
    const original = jugar(chart, grabada, 16);
    // Un evento corrido 40 ms (casi seguro cambia su juicio) tiene que cambiar el estado.
    const indice = grabada.findIndex((e) => e.tipo === 'down' && e.time > 20_000);
    const alterada = grabada.map((e, i) => (i === indice ? { ...e, time: e.time + 40 } : e));
    expect(jugar(chart, alterada, 16)).not.toEqual(original);
  });
});

describe('expiracion con margen (T-044)', () => {
  it('el margen es de 50 ms', () => {
    expect(MARGEN_DE_EXPIRACION_MS).toBe(50);
  });

  // Con la expiracion por frame sin margen (`update(t)` y piso `t`), una pulsacion
  // que llega un frame tarde se corre hasta el `t` del frame anterior y un MAX
  // pasa a PERFECT. Con el margen se juzga con su tiempo exacto. (Probado: con
  // MARGEN_DE_EXPIRACION_MS = 0 este test falla.)
  it('una pulsacion entregada un frame tarde se juzga con su tiempo exacto, igual que si hubiera llegado a tiempo', () => {
    const chart = crearMapa([{ kind: 'tap', time: 2000, column: 0 }]);
    const sinNada = (): void => undefined;

    // A tiempo: el keydown (a +15 ms de la nota, MAX) llega antes de que el frame expire.
    const aTiempo = createJudgeEngine(chart);
    const grabadorA = crearGrabadorDeReplay();
    grabadorA.actualizado(expirarConMargen(aTiempo, 1990, sinNada));
    const aTiempoRes = entregarEvento(aTiempo, grabadorA.registrar(2015, 0, 'down'), sinNada);

    // Tarde: el mismo keydown (time 2015) llega despues de que el frame de t = 2030
    // ya expiro y subio el piso.
    const tarde = createJudgeEngine(chart);
    const grabadorT = crearGrabadorDeReplay();
    grabadorT.actualizado(expirarConMargen(tarde, 1990, sinNada));
    grabadorT.actualizado(expirarConMargen(tarde, 2030, sinNada));
    const evento = grabadorT.registrar(2015, 0, 'down');
    expect(evento.time).toBe(2015);
    const tardeRes = entregarEvento(tarde, evento, sinNada);
    grabadorT.actualizado(expirarConMargen(tarde, 2060, sinNada));

    expect(aTiempoRes?.judgement).toBe('max');
    expect(tardeRes?.judgement).toBe('max');
    expect(tardeRes?.error).toBe(15);
    expect(tardeRes?.error).toBe(aTiempoRes?.error);
    expect(tarde.state).toEqual(aTiempo.state);
  });

  it('pasado el margen (mas de 50 ms tarde) la pulsacion si se corre al piso, para que el motor no reciba un evento en su pasado', () => {
    const grabador = crearGrabadorDeReplay();
    const motor = createJudgeEngine(crearMapa([{ kind: 'tap', time: 2000, column: 0 }]));
    grabador.actualizado(expirarConMargen(motor, 2200, () => undefined)); // piso 2150
    expect(grabador.registrar(2100, 0, 'down').time).toBe(2150);
    expect(grabador.registrar(2160, 0, 'up').time).toBe(2160);
  });

  it('expirarConMargen devuelve t menos el margen y expira solo hasta ahi', () => {
    // Nota en 1000: su ventana de miss vence en 1000 + 166,1 = 1166,1.
    const motor = createJudgeEngine(crearMapa([{ kind: 'tap', time: 1000, column: 1 }]));
    const vistos: string[] = [];
    expect(expirarConMargen(motor, 1200, (r) => vistos.push(r.judgement))).toBe(1150);
    expect(vistos).toEqual([]); // 1150 todavia no paso 1166,1
    expect(expirarConMargen(motor, 1230, (r) => vistos.push(r.judgement))).toBe(1180);
    expect(vistos).toEqual(['miss']);
  });

  // Sin el vaciado final, el miss de la ultima nota cerca del fin de la cancion
  // se quedaria sin contar (su ventana vence dentro del margen).
  it('un miss en la ultima nota cerca del final de la cancion queda contado en el estado final', () => {
    const chart = crearMapa([
      { kind: 'tap', time: 1000, column: 0 },
      { kind: 'tap', time: 9980, column: 1 },
    ]);
    // Solo se toca la primera. La ventana de miss de la ultima vence en 9980 + 166,1 = 10146,1;
    // la cancion dura 10170: ahi `t - 50` = 10120 todavia no la vence.
    const eventos = replayPerfecto(chart).eventos.filter((e) => e.column === 0);
    const estado = jugar(chart, eventos, 1000 / 60, 'update-antes-de-cada-evento', 10170);
    expect(estado.counts.max).toBe(1);
    expect(estado.counts.miss).toBe(1);

    // Y a mano: sin el vaciado final ese miss no estaba.
    const motor = createJudgeEngine(chart);
    entregarEvento(motor, { time: 1000, column: 0, tipo: 'down' }, () => undefined);
    expirarConMargen(motor, 10170, () => undefined);
    expect(motor.state.counts.miss).toBe(0);
    expirarSinMargen(motor, 10170, () => undefined);
    expect(motor.state.counts.miss).toBe(1);
  });

  it('el vaciado final tambien cuenta, igual, al reproducir a otra frecuencia', () => {
    const chart = crearMapa([
      { kind: 'tap', time: 1000, column: 0 },
      { kind: 'hold', time: 9900, endTime: 9990, column: 2 },
    ]);
    const eventos = replayPerfecto(chart).eventos.filter((e) => e.column === 0);
    const a = jugar(chart, eventos, 1000 / 144, 'update-antes-de-cada-evento', 10170);
    const b = jugar(chart, eventos, 250, 'update-antes-de-cada-evento', 10170);
    expect(a.counts.miss).toBe(2); // cabeza y cola
    expect(b).toEqual(a);
  });
});

describe('entregarEvento y crearGrabadorDeReplay', () => {
  it('entregarEvento resuelve lo que ya expiro antes de la pulsacion: la pulsacion juzga la nota siguiente', () => {
    // Dos notas en la misma columna: la primera se deja pasar y se pulsa la segunda.
    // Pulsacion en 1260: la primera (1000) ya expiro (1000 + 166,1 < 1260) y la
    // segunda (1250) cae a +10 ms (MAX). Sin el update previo, la pulsacion se
    // intentaria contra la primera (error +260) y se perderia.
    const chart = crearMapa([
      { kind: 'tap', time: 1000, column: 0 },
      { kind: 'tap', time: 1250, column: 0 },
    ]);
    const motor = createJudgeEngine(chart);
    const expirados: string[] = [];
    const resultado = entregarEvento(motor, { time: 1260, column: 0, tipo: 'down' }, (r) =>
      expirados.push(r.judgement),
    );
    expect(expirados).toEqual(['miss']);
    expect(resultado?.judgement).toBe('max');
    expect(resultado?.note.time).toBe(1250);

    // El camino ingenuo, sin el update previo, pierde esa pulsacion.
    const ingenuo = createJudgeEngine(chart);
    expect(ingenuo.press(1260, 0)).toBeNull();
  });

  it('entregarEvento suelta con release y devuelve null si no hay larga activa', () => {
    const chart = crearMapa([{ kind: 'hold', time: 1000, endTime: 1500, column: 1 }]);
    const motor = createJudgeEngine(chart);
    const sinNada = (): void => undefined;
    expect(entregarEvento(motor, { time: 900, column: 1, tipo: 'up' }, sinNada)).toBeNull();
    expect(
      entregarEvento(motor, { time: 1000, column: 1, tipo: 'down' }, sinNada)?.judgement,
    ).toBe('max');
    expect(entregarEvento(motor, { time: 1500, column: 1, tipo: 'up' }, sinNada)?.judgement).toBe(
      'max',
    );
    expect(motor.finished).toBe(true);
  });

  it('el grabador nunca graba un evento antes que el anterior ni antes del ultimo update', () => {
    const g = crearGrabadorDeReplay();
    expect(g.registrar(100, 0, 'down').time).toBe(100);
    expect(g.registrar(99, 1, 'down').time).toBe(100);
    g.actualizado(120);
    expect(g.registrar(118, 0, 'up').time).toBe(120);
    expect(g.registrar(130, 0, 'down').time).toBe(130);
    // Un update atrasado no baja el piso.
    g.actualizado(110);
    expect(g.registrar(125, 2, 'down').time).toBe(130);
    const replay = g.replay('abc', -4);
    expect(replay.hashMapa).toBe('abc');
    expect(replay.offsetUsuario).toBe(-4);
    expect(replay.eventos.map((e) => e.time)).toEqual([100, 100, 120, 130, 130]);
  });

  it('el evento devuelto es el grabado', () => {
    const g = crearGrabadorDeReplay();
    const e = g.registrar(50, 3, 'up');
    expect(g.replay('1', 0).eventos).toEqual([e]);
  });

  it('el replay devuelto es una copia: grabar mas despues no lo cambia', () => {
    const g = crearGrabadorDeReplay();
    g.registrar(1, 0, 'down');
    const r = g.replay('1', 0);
    g.registrar(2, 0, 'up');
    expect(r.eventos).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Serializacion
// ---------------------------------------------------------------------------

describe('serializarReplay / leerReplay', () => {
  const muestra: Replay = {
    version: 1,
    hashMapa: '3735928559',
    offsetUsuario: -12.5,
    eventos: [
      { time: 1000.125, column: 0, tipo: 'down' },
      { time: 1040, column: 0, tipo: 'up' },
      { time: 1234.5678901234567, column: 3, tipo: 'down' },
    ],
  };

  it('ida y vuelta: queda igual, decimales incluidos', () => {
    expect(leerReplay(serializarReplay(muestra))).toEqual(muestra);
  });

  it('ida y vuelta de un replay perfecto grande', () => {
    const replay = replayPerfecto(mapaAleatorio(3));
    expect(leerReplay(serializarReplay(replay))).toEqual(replay);
  });

  it('un replay sin eventos es valido (una partida sin una sola pulsacion)', () => {
    const vacio: Replay = { ...muestra, eventos: [] };
    expect(leerReplay(serializarReplay(vacio))).toEqual(vacio);
  });

  it('el formato es el documentado: eventos como [time, columna, 0|1]', () => {
    expect(JSON.parse(serializarReplay(muestra))).toEqual({
      version: 1,
      hashMapa: '3735928559',
      offsetUsuario: -12.5,
      eventos: [
        [1000.125, 0, 0],
        [1040, 0, 1],
        [1234.5678901234567, 3, 0],
      ],
    });
  });

  it('version desconocida: null (ni se adivina una version futura ni una anterior)', () => {
    const base = JSON.parse(serializarReplay(muestra)) as Record<string, unknown>;
    expect(leerReplay(JSON.stringify({ ...base, version: 2 }))).toBeNull();
    expect(leerReplay(JSON.stringify({ ...base, version: 0 }))).toBeNull();
    expect(leerReplay(JSON.stringify({ ...base, version: '1' }))).toBeNull();
    expect(leerReplay(JSON.stringify({ ...base, version: undefined }))).toBeNull();
  });

  it.each([
    ['vacio', ''],
    ['no es JSON', 'esto no es un replay'],
    ['JSON cortado', '{"version":1,"hashMapa":"1","offsetUsuario":0,"eventos":[[1,0,0'],
    ['null', 'null'],
    ['un arreglo', '[]'],
    ['un numero', '5'],
  ])('texto corrupto (%s): null y no lanza', (_nombre, texto) => {
    expect(leerReplay(texto)).toBeNull();
  });

  it.each([
    ['sin hash', { hashMapa: undefined }],
    ['hash vacio', { hashMapa: '' }],
    ['hash numerico', { hashMapa: 5 }],
    ['offset no numerico', { offsetUsuario: 'x' }],
    ['offset ausente', { offsetUsuario: null }],
    ['eventos no es lista', { eventos: {} }],
    ['evento corto', { eventos: [[1, 0]] }],
    ['evento largo', { eventos: [[1, 0, 0, 9]] }],
    ['tiempo no numerico', { eventos: [['1', 0, 0]] }],
    ['tiempo NaN (null en JSON)', { eventos: [[null, 0, 0]] }],
    ['columna 4', { eventos: [[1, 4, 0]] }],
    ['columna negativa', { eventos: [[1, -1, 0]] }],
    ['columna con decimales', { eventos: [[1, 1.5, 0]] }],
    ['tipo 2', { eventos: [[1, 0, 2]] }],
    ['tipo texto', { eventos: [[1, 0, 'down']] }],
    ['un evento no es lista', { eventos: [{ time: 1, column: 0, tipo: 'down' }] }],
  ])('campo mal formado (%s): null', (_nombre, cambio) => {
    const base = JSON.parse(serializarReplay(muestra)) as Record<string, unknown>;
    expect(leerReplay(JSON.stringify({ ...base, ...cambio }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reproductor por tiempo de juego
// ---------------------------------------------------------------------------

describe('crearReproductorDeReplay', () => {
  const eventos: EventoReplay[] = [
    { time: 100, column: 0, tipo: 'down' },
    { time: 140, column: 0, tipo: 'up' },
    { time: 150, column: 1, tipo: 'down' },
    { time: 400, column: 2, tipo: 'down' },
  ];
  const replay: Replay = { version: 1, hashMapa: '1', offsetUsuario: 0, eventos };

  function recoger(r: ReturnType<typeof crearReproductorDeReplay>, t: number): EventoReplay[] {
    const salida: EventoReplay[] = [];
    r.avanzar(t, (e) => salida.push(e));
    return salida;
  }

  it('entrega solo los eventos con time <= t, en orden, y cada uno una sola vez', () => {
    const r = crearReproductorDeReplay(replay);
    expect(recoger(r, 99.9)).toEqual([]);
    expect(recoger(r, 100)).toEqual([eventos[0]]);
    expect(recoger(r, 100)).toEqual([]);
    expect(recoger(r, 160)).toEqual([eventos[1], eventos[2]]);
    expect(r.terminado).toBe(false);
    expect(recoger(r, 10_000)).toEqual([eventos[3]]);
    expect(r.terminado).toBe(true);
  });

  it('cada evento conserva su propio time (no el del frame que lo entrega)', () => {
    const r = crearReproductorDeReplay(replay);
    const tiempos = recoger(r, 9999).map((e) => e.time);
    expect(tiempos).toEqual([100, 140, 150, 400]);
  });

  it('saltarHasta descarta lo anterior sin entregarlo y deja lo demas', () => {
    const r = crearReproductorDeReplay(replay);
    r.saltarHasta(150);
    expect(recoger(r, 9999)).toEqual([eventos[2], eventos[3]]);
  });

  it('un evento fechado antes que el anterior sale justo despues de el, en el orden grabado', () => {
    const jitter: EventoReplay[] = [
      { time: 100, column: 0, tipo: 'down' },
      { time: 99.5, column: 1, tipo: 'down' },
      { time: 200, column: 2, tipo: 'down' },
    ];
    const r = crearReproductorDeReplay({ ...replay, eventos: jitter });
    expect(recoger(r, 100)).toEqual([jitter[0], jitter[1]]);
  });

  it('no modifica el replay', () => {
    const copia = JSON.stringify(replay);
    const r = crearReproductorDeReplay(replay);
    r.saltarHasta(120);
    recoger(r, 1000);
    expect(JSON.stringify(replay)).toBe(copia);
  });
});
