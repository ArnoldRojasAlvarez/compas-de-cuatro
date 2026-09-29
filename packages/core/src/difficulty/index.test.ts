// Tests de T-013 (motor de dificultad, vector de siete skillsets).
//
// Los mapas de prueba se arman con generadores locales (ver
// docs/tickets/T-013-motor-dificultad.md, seccion "Tests": "armar los mapas
// de prueba con un generador local en el test, no archivos").
//
// Son propiedades, no numeros magicos que dependan de la calibracion (esa
// es T-014). La leccion del proyecto (ver docs/HANDOFF.md, "Lecciones"): un
// test que no puede fallar no sirve. Antes de cada asercion se penso que
// implementacion incorrecta la haria fallar; se deja anotado en los casos
// menos obvios.
//
// Sobre el cronometro del test de rendimiento: igual razonamiento que
// packages/core/src/judge/engine.test.ts (ver el comentario ahi). `core` no
// tiene lib DOM ni @types/node, asi que se declara el minimo necesario en
// vez de agregar una dependencia o usar performance.now()/Date.now(),
// prohibidos en todo `packages/core` por CLAUDE.md.
declare const process: { hrtime: { bigint: () => bigint } };

import { describe, expect, it } from 'vitest';
import type { Chart, Column, Note } from '../types.js';
import { SKILLSETS } from '../types.js';
import { PARAMETROS_DIFICULTAD, calcularDificultad, construirFilas } from './index.js';

// ---------------------------------------------------------------------------
// Helpers para armar mapas y patrones de prueba
// ---------------------------------------------------------------------------

function nota(column: Column, time: number): Note {
  return { kind: 'tap', time, column };
}

function crearMapa(notes: Note[]): Chart {
  return {
    metadata: {
      title: 'Mapa de prueba',
      artist: 'Prueba',
      creator: 'Arnold Alvarez',
      difficultyName: 'Test',
      audioFile: 'test.mp3',
      previewTime: 0,
    },
    overallDifficulty: 7,
    hpDrain: 5,
    timingPoints: [],
    speedPoints: [],
    notes,
  };
}

/**
 * Los seis patrones canonicos de las skillsets de pico, mas el par de
 * technical (irregular/regular). Son los mismos que se usaron para derivar
 * `PARAMETROS_DIFICULTAD.escala` (ver su JSDoc): a 12 notas por segundo
 * (1/4 a 180 BPM, el stream de referencia del ticket), sin ningun jack
 * salvo en los patrones que estan hechos para tenerlo (jackspeed y
 * chordjack).
 */
const NPS_REFERENCIA = 12;
const DT_STREAM = 1000 / NPS_REFERENCIA; // ~83.33ms: 1 nota por fila
const DT_JUMPSTREAM = 1500 / NPS_REFERENCIA; // 3 notas cada 2 filas
const DT_HANDSTREAM = 2000 / NPS_REFERENCIA; // 4 notas cada 2 filas
const DT_CHORDJACK = 2000 / NPS_REFERENCIA; // 2 notas por fila

/** Roll 0,1,2,3,0,1,2,3... en filas de 1: nunca repite columna entre filas adyacentes. */
function patronStream(duracionMs: number, dt: number = DT_STREAM): Note[] {
  const notes: Note[] = [];
  let t = 0;
  let c = 0;
  while (t < duracionMs) {
    notes.push(nota((c % 4) as Column, t));
    c++;
    t += dt;
  }
  return notes;
}

/** Una sola columna (0) repetida cada fila: jack puro. */
function patronJackspeed(duracionMs: number, dt: number = DT_STREAM): Note[] {
  const notes: Note[] = [];
  let t = 0;
  while (t < duracionMs) {
    notes.push(nota(0, t));
    t += dt;
  }
  return notes;
}

/**
 * Filas de 2 ({0,1}) alternando con filas de 1 ({2}), sin repetir columnas:
 * el grupo {0,1} y la columna 2 son disjuntos, asi que ninguna fila
 * comparte columna con la anterior sin importar el orden.
 */
function patronJumpstream(duracionMs: number, dt: number = DT_JUMPSTREAM): Note[] {
  const notes: Note[] = [];
  let t = 0;
  let par = true;
  while (t < duracionMs) {
    if (par) {
      notes.push(nota(0, t), nota(1, t));
    } else {
      notes.push(nota(2, t));
    }
    par = !par;
    t += dt;
  }
  return notes;
}

/**
 * Filas de 3 ({0,1,2}) alternando con filas de 1 ({3}), sin repetir
 * columnas (mismo truco de grupos disjuntos que jumpstream: con 4 columnas
 * no hay forma de alternar dos filas de 3 SIN compartir columna, asi que el
 * patron "limpio" en 4K es necesariamente 3+1, no 3+3).
 */
function patronHandstream(duracionMs: number, dt: number = DT_HANDSTREAM): Note[] {
  const notes: Note[] = [];
  let t = 0;
  let par = true;
  while (t < duracionMs) {
    if (par) {
      notes.push(nota(0, t), nota(1, t), nota(2, t));
    } else {
      notes.push(nota(3, t));
    }
    par = !par;
    t += dt;
  }
  return notes;
}

/** El acorde {0,1} repetido en cada fila: jack de dos columnas a la vez. */
function patronChordjack(duracionMs: number, dt: number = DT_CHORDJACK): Note[] {
  const notes: Note[] = [];
  let t = 0;
  while (t < duracionMs) {
    notes.push(nota(0, t), nota(1, t));
    t += dt;
  }
  return notes;
}

/** Stream con ritmo irregular: dt alterna entre dos valores, por ejemplo 60ms y 140ms. */
function patronRitmoIrregular(duracionMs: number, dt1: number, dt2: number): Note[] {
  const notes: Note[] = [];
  let t = 0;
  let c = 0;
  let usarDt1 = true;
  while (t < duracionMs) {
    notes.push(nota((c % 4) as Column, t));
    c++;
    t += usarDt1 ? dt1 : dt2;
    usarDt1 = !usarDt1;
  }
  return notes;
}

// ---------------------------------------------------------------------------
// 1. Vacio y degenerado
// ---------------------------------------------------------------------------

describe('vacio y degenerado', () => {
  it('un mapa sin notas da el vector entero en 0 y overall 0, sin NaN', () => {
    const resultado = calcularDificultad(crearMapa([]));

    for (const skillset of SKILLSETS) {
      expect(resultado.vector[skillset]).toBe(0);
    }
    expect(resultado.overall).toBe(0);
  });

  it('una sola nota da valores finitos (no hay fila anterior con la que calcular un dt)', () => {
    const resultado = calcularDificultad(crearMapa([nota(0, 1000)]));

    for (const skillset of SKILLSETS) {
      expect(Number.isFinite(resultado.vector[skillset])).toBe(true);
    }
    expect(Number.isFinite(resultado.overall)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Filas
// ---------------------------------------------------------------------------

describe('construirFilas', () => {
  it('tres notas en el mismo ms forman una fila de size 3 con la mascara correcta', () => {
    const filas = construirFilas([nota(0, 1000), nota(1, 1000), nota(2, 1000)]);

    expect(filas).toHaveLength(1);
    expect(filas[0]?.size).toBe(3);
    // bit 0 + bit 1 + bit 2 = 0b0111 = 7
    expect(filas[0]?.mask).toBe(0b0111);
  });

  it('dos notas a 0.5ms de diferencia tambien forman una sola fila (tolerancia de 1ms)', () => {
    const filas = construirFilas([nota(0, 1000), nota(1, 1000.5)]);

    expect(filas).toHaveLength(1);
    expect(filas[0]?.size).toBe(2);
    expect(filas[0]?.mask).toBe(0b0011);
  });

  it('dos notas a 2ms de diferencia forman dos filas separadas', () => {
    const filas = construirFilas([nota(0, 1000), nota(1, 1002)]);

    expect(filas).toHaveLength(2);
    expect(filas[0]?.size).toBe(1);
    expect(filas[1]?.size).toBe(1);
  });

  it('la cabeza de una nota larga cuenta como nota de su fila', () => {
    const cabeza: Note = { kind: 'hold', time: 1000, endTime: 2000, column: 0 };
    const filas = construirFilas([cabeza, nota(1, 1000)]);

    expect(filas).toHaveLength(1);
    expect(filas[0]?.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Discriminacion
// ---------------------------------------------------------------------------

describe('discriminacion: cada patron canonico tiene como skillset maximo el suyo', () => {
  // Mapas cortos, de unos 10 segundos: a proposito, no 60s. Stamina esta
  // disenada para dominar los mapas largos (es la propiedad de la seccion
  // "Stamina mide duracion" mas abajo); en un mapa de 60s le ganaria
  // legitimamente a los seis patrones de pico, y eso no seria un bug del
  // motor sino del test. Con 10s, stamina todavia no alcanzo a los picos.
  const DURACION_MS = 10_000;

  function argmax(vector: Record<string, number>): string {
    return SKILLSETS.reduce((mejor, actual) =>
      vector[actual]! > vector[mejor]! ? actual : mejor,
    );
  }

  it('roll de un carril por fila da argmax stream', () => {
    const resultado = calcularDificultad(crearMapa(patronStream(DURACION_MS)));
    expect(argmax(resultado.vector)).toBe('stream');
  });

  it('filas de 2 alternando con filas de 1 (sin jacks) da argmax jumpstream', () => {
    const resultado = calcularDificultad(crearMapa(patronJumpstream(DURACION_MS)));
    expect(argmax(resultado.vector)).toBe('jumpstream');
  });

  it('filas de 3 alternando con filas de 1 (sin jacks) da argmax handstream', () => {
    const resultado = calcularDificultad(crearMapa(patronHandstream(DURACION_MS)));
    expect(argmax(resultado.vector)).toBe('handstream');
  });

  it('una sola columna repetida rapido da argmax jackspeed', () => {
    const resultado = calcularDificultad(crearMapa(patronJackspeed(DURACION_MS)));
    expect(argmax(resultado.vector)).toBe('jackspeed');
  });

  it('el mismo acorde de 2 repetido da argmax chordjack', () => {
    const resultado = calcularDificultad(crearMapa(patronChordjack(DURACION_MS)));
    expect(argmax(resultado.vector)).toBe('chordjack');
  });

  it('stream con ritmo irregular da technical mucho mayor que el mismo stream con ritmo parejo, y en el parejo technical es casi 0', () => {
    // El ticket NO pide que "technical" sea el argmax aca (a diferencia de
    // los cinco patrones de arriba): technical mide irregularidad encima de
    // un patron base, no reemplaza al patron. La propiedad es la
    // comparacion entre las dos variantes, no el argmax de ninguna.
    const irregular = calcularDificultad(
      crearMapa(patronRitmoIrregular(DURACION_MS, 60, 140)),
    );
    const parejo = calcularDificultad(crearMapa(patronStream(DURACION_MS, 100)));

    // dt=100 exacto en cada fila: ratioRitmo da ln(1)=0 exacto en punto
    // flotante (100 es entero exacto en binario, no hay deriva de redondeo
    // acumulada), asi que technical tiene que dar exactamente 0, no "casi".
    expect(parejo.vector.technical).toBe(0);
    // "Mucho mayor" en terminos absolutos, no solo relativo a un valor casi
    // nulo: una implementacion que calculara technical mal (por ejemplo
    // invirtiendo el tope o ignorando el ratio) podria dar un numero
    // positivo pero insignificante y esta asercion lo agarraria.
    expect(irregular.vector.technical).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Velocidad
// ---------------------------------------------------------------------------

describe('velocidad', () => {
  it('el mismo patron 1.5 veces mas rapido da un valor estrictamente mayor en su skillset', () => {
    const lento = calcularDificultad(crearMapa(patronStream(10_000, 1000 / 8))); // 8 nps
    const rapido = calcularDificultad(crearMapa(patronStream(10_000, 1000 / 12))); // 12 nps = 8 * 1.5

    expect(rapido.vector.stream).toBeGreaterThan(lento.vector.stream);
  });
});

// ---------------------------------------------------------------------------
// 5. Stamina mide duracion
// ---------------------------------------------------------------------------

describe('stamina mide duracion', () => {
  it('la proporcion stamina(90)/stamina(15) es mayor que stream(90)/stream(15)', () => {
    const corto = calcularDificultad(crearMapa(patronStream(15_000)));
    const largo = calcularDificultad(crearMapa(patronStream(90_000)));

    const ratioStamina = largo.vector.stamina / corto.vector.stamina;
    const ratioStream = largo.vector.stream / corto.vector.stream;

    // Una implementacion que le diera a stamina el mismo decaimiento rapido
    // que a los otros seis (en vez del decaimiento lento que exige el
    // ticket) haria que las dos proporciones salieran practicamente
    // iguales: esta asercion la distingue.
    expect(ratioStamina).toBeGreaterThan(ratioStream);
  });
});

// ---------------------------------------------------------------------------
// 5b. Stamina v2 (T-016): media movil de la dificultad de patron
// ---------------------------------------------------------------------------

/**
 * Mapa facil y largo con patrones mezclados, en un orden fijo y determinista:
 * ciclo de seis filas de 1 y de 2 notas, cada fila disjunta de la anterior
 * (sin jacks, tampoco en la vuelta del ciclo). 9 notas por ciclo de 6 filas
 * cada 300ms: 1.5 notas por fila a 3.33 filas por segundo = 5 notas por segundo.
 */
function mapaFacilMezclado(duracionMs: number): Note[] {
  const ciclo: Column[][] = [[0], [1, 2], [3], [0, 1], [2], [1, 3]];
  const notes: Note[] = [];
  let i = 0;
  for (let t = 0; t < duracionMs; t += 300) {
    for (const c of ciclo[i % ciclo.length]!) notes.push(nota(c, t));
    i++;
  }
  return notes;
}

const MAPAS_REFERENCIA_V1: Array<[string, Note[]]> = [
  ['mezclado', mapaFacilMezclado(60_000)],
  ['jumpstream', patronJumpstream(10_000)],
  ['handstream', patronHandstream(10_000)],
  ['chordjack', patronChordjack(10_000)],
  ['irregular', patronRitmoIrregular(10_000, 60, 140)],
];

describe('stamina v2', () => {
  it('un mapa largo (240s) y facil (5 nps, filas de 1 y 2 mezcladas) NO tiene stamina como skillset maximo', () => {
    const notes = mapaFacilMezclado(240_000);
    // Sanidad del generador: de verdad son unas 5 notas por segundo.
    expect(notes.length / 240).toBeGreaterThan(4.9);
    expect(notes.length / 240).toBeLessThan(5.1);

    const { vector } = calcularDificultad(crearMapa(notes));
    const maximoDePatron = Math.max(
      ...SKILLSETS.filter((k) => k !== 'stamina').map((k) => vector[k]),
    );

    // Con el modelo viejo (stamina sumaba todas las notas) stamina ganaba en
    // este mapa: este test fallaba. Con la media movil, stamina no puede
    // superar el strain de patron que promedia.
    expect(vector.stamina).toBeLessThan(maximoDePatron);
  });

  it('un chordjack sostenido de 180s deja a stamina a la altura del chordjack', () => {
    // Numeros medidos: stamina/chordjack = 1.48 con m en estrellas, y 0.375 con
    // el max de strains crudos (el defecto). Umbral 0.8: entre ambos.
    const { vector } = calcularDificultad(crearMapa(patronChordjack(180_000)));
    expect(vector.stamina).toBeGreaterThanOrEqual(0.8 * vector.chordjack);
  });

  it('el mismo stream denso de 180s tiene mas stamina que el de 15s, y un overall mayor o igual', () => {
    const corto = calcularDificultad(crearMapa(patronStream(15_000)));
    const largo = calcularDificultad(crearMapa(patronStream(180_000)));

    expect(largo.vector.stamina).toBeGreaterThan(corto.vector.stamina);
    expect(largo.overall).toBeGreaterThanOrEqual(corto.overall);
  });

  it('con exponenteEstrellas = 1 los seis skillsets de pico dan los mismos valores que en v1', () => {
    // Valores obtenidos corriendo el modelo v1 (antes de T-016) sobre estos
    // mapas (`stamina` cambio a proposito y no se compara; los otros seis no,
    // salvo chordjack.jackspeed por T-017, ver abajo).
    const V1: Record<string, Record<string, number>> = {
      mezclado: {
        stream: 0.168617436816568,
        jumpstream: 0.7371773961011495,
        handstream: 0,
        jackspeed: 0,
        chordjack: 0,
        technical: 0,
      },
      jumpstream: {
        stream: 0.7413204586122378,
        jumpstream: 3.215527436496619,
        handstream: 0,
        jackspeed: 0,
        chordjack: 0,
        technical: 0,
      },
      handstream: {
        stream: 0.42290998789913553,
        jumpstream: 0,
        handstream: 3.2096541210104452,
        jackspeed: 0,
        chordjack: 0,
        technical: 1.7787561674984835e-16,
      },
      chordjack: {
        stream: 0,
        jumpstream: 0,
        handstream: 0,
        // T-017: cambio a proposito. Antes de T-017 este acorde repetido no
        // aportaba a jackspeed (0); ahora una fila con jack alimenta jackspeed tambien.
        jackspeed: 0.8180981243647812,
        chordjack: 3.2253593617033736,
        technical: 1.7787561674984835e-16,
      },
      irregular: {
        stream: 2.70852791995906,
        jumpstream: 0,
        handstream: 0,
        jackspeed: 0,
        chordjack: 0,
        technical: 2.2373736851857404,
      },
    };

    for (const [nombre, notes] of MAPAS_REFERENCIA_V1) {
      const { vector } = calcularDificultad(crearMapa(notes));
      for (const [k, esperado] of Object.entries(V1[nombre]!)) {
        expect(vector[k as keyof typeof vector], `${nombre}.${k}`).toBe(esperado);
      }
    }

    // Al final, para poder correr este test tambien contra el modelo viejo.
    expect(PARAMETROS_DIFICULTAD.exponenteEstrellas).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5c. Jackspeed por columna (T-017)
// ---------------------------------------------------------------------------

/**
 * Ciclo [12][2][23] repetido: la columna 2 (en base 0, la del medio) se
 * repite en cada fila, pero las filas tienen dos, una y dos notas. Es un jack
 * de un dedo dentro de filas de distinto tamano. Columnas en base 0: [12] =
 * {1,2}, [2] = {2}, [23] = {2,3}. Cada fila comparte exactamente UNA columna
 * con la anterior (la 2), asi que nunca hay dos columnas repetidas juntas.
 */
function patronJackDeUnDedoEnAcordes(duracionMs: number, dt: number = 1000 / 12): Note[] {
  const ciclo: Column[][] = [[1, 2], [2], [2, 3]];
  const notes: Note[] = [];
  let i = 0;
  for (let t = 0; t < duracionMs; t += dt) {
    for (const c of ciclo[i % ciclo.length]!) notes.push(nota(c, t));
    i++;
  }
  return notes;
}

/** Jackspeed medido con el modelo v2 (main, T-016) sobre `patronJackDeUnDedoEnAcordes(10_000)`. */
const JACKSPEED_V2_ACORDES_CON_JACK = 1.1146920885168663;

describe('jackspeed por columna (T-017)', () => {
  it('[12][2][23] repetido: jackspeed es al menos 2.5 veces el del modelo v2', () => {
    const { vector } = calcularDificultad(crearMapa(patronJackDeUnDedoEnAcordes(10_000)));

    // Con el modelo v2 solo las filas de 1 nota alimentaban jackspeed (1.11
    // en este mapa); las filas de 2 caian solo en chordjack. Con T-017 todas
    // las filas con la columna 2 repetida aportan: medido 3.234 (2.9x el v2).
    // Umbral 2.5x: entre ambos, sin pegarse al valor medido.
    expect(vector.jackspeed).toBeGreaterThanOrEqual(2.5 * JACKSPEED_V2_ACORDES_CON_JACK);
    // El acorde con jack parcial sigue contando como chordjack (definicion de T-013).
    expect(vector.chordjack).toBeGreaterThan(0);
  });

  it('un jack puro de una columna [1][1][1]: jackspeed es el maximo del vector', () => {
    const notes: Note[] = [];
    for (let t = 0; t < 10_000; t += 1000 / 12) notes.push(nota(1, t));
    const { vector } = calcularDificultad(crearMapa(notes));

    const maximo = Math.max(...SKILLSETS.map((k) => vector[k]));
    expect(vector.jackspeed).toBe(maximo);
    expect(vector.jackspeed).toBeGreaterThan(1);
  });

  it('[12][12][12] repetido: chordjack es el maximo del vector', () => {
    const notes: Note[] = [];
    for (let t = 0; t < 10_000; t += 1000 / 6) notes.push(nota(1, t), nota(2, t));
    const { vector } = calcularDificultad(crearMapa(notes));

    const maximo = Math.max(...SKILLSETS.map((k) => vector[k]));
    expect(vector.chordjack).toBe(maximo);
  });
});

// ---------------------------------------------------------------------------
// 6. Simetria espejo
// ---------------------------------------------------------------------------

describe('simetria espejo', () => {
  it('reflejar las columnas (c -> 3 - c) da EXACTAMENTE el mismo vector', () => {
    const original = patronJumpstream(10_000);
    const espejo = original.map((n): Note => ({
      ...n,
      column: (3 - n.column) as Column,
    }));

    const vectorOriginal = calcularDificultad(crearMapa(original)).vector;
    const vectorEspejo = calcularDificultad(crearMapa(espejo)).vector;

    // Un motor que trate distinto una mano de la otra (por ejemplo, que
    // itere columnas en un orden que rompa el empate al buscar dcMinimo, o
    // que use el indice de columna como parte de algun aporte) fallaria
    // aca. toEqual pide igualdad exacta, no "cercana".
    expect(vectorEspejo).toEqual(vectorOriginal);
  });
});

// ---------------------------------------------------------------------------
// 7. Invariancia temporal
// ---------------------------------------------------------------------------

describe('invariancia temporal', () => {
  it('correr todas las notas +10s (multiplo exacto de la seccion de 400ms) da el mismo vector', () => {
    const original = patronHandstream(10_000);
    const desplazado = original.map((n): Note => ({ ...n, time: n.time + 10_000 }));

    const vectorOriginal = calcularDificultad(crearMapa(original)).vector;
    const vectorDesplazado = calcularDificultad(crearMapa(desplazado)).vector;

    // A diferencia de la simetria espejo (que es EXACTA porque no cambia
    // ninguna magnitud de punto flotante, solo que bit de columna se mira),
    // desplazar el tiempo +10s si cambia la magnitud de cada `time` antes de
    // restar (10000+x en vez de x), y la resta de punto flotante no es
    // perfectamente invariante a un cambio de magnitud: quedan diferencias
    // de ruido de redondeo del orden de 1e-13 relativo (confirmado a mano:
    // sin este comentario, un `toEqual` estricto fallaba por diferencias en
    // el ultimo bit, por ejemplo 0.42290998789913553 vs 0.4229099878991354).
    // Eso es ruido de IEEE754, no una implementacion que trate el tiempo de
    // forma distinta. Una implementacion que si tratara distinto (por
    // ejemplo, que dependiera del tiempo absoluto en vez de dt entre filas)
    // daria una diferencia muchisimo mayor que este piso de ruido, y esta
    // tolerancia la seguiria agarrando.
    for (const skillset of SKILLSETS) {
      const a = vectorOriginal[skillset];
      const b = vectorDesplazado[skillset];
      const toleracia = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      expect(Math.abs(a - b)).toBeLessThanOrEqual(toleracia);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. overall es el maximo
// ---------------------------------------------------------------------------

describe('overall', () => {
  it('es siempre el maximo del vector, para varios patrones distintos', () => {
    const patrones = [
      patronStream(10_000),
      patronJumpstream(10_000),
      patronHandstream(10_000),
      patronJackspeed(10_000),
      patronChordjack(10_000),
      patronRitmoIrregular(10_000, 60, 140),
    ];

    for (const notes of patrones) {
      const resultado = calcularDificultad(crearMapa(notes));
      const maximoEsperado = Math.max(...SKILLSETS.map((k) => resultado.vector[k]));
      expect(resultado.overall).toBe(maximoEsperado);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Determinismo
// ---------------------------------------------------------------------------

describe('determinismo', () => {
  it('dos llamadas con el mismo chart dan resultados identicos', () => {
    const chart = crearMapa(patronHandstream(10_000));

    const primera = calcularDificultad(chart);
    const segunda = calcularDificultad(chart);

    expect(segunda).toEqual(primera);
  });
});

// ---------------------------------------------------------------------------
// 10. Rendimiento
// ---------------------------------------------------------------------------

describe('rendimiento', () => {
  it('procesa un mapa de 3500 notas en menos de 50ms, y de verdad calcula algo', () => {
    const cantidad = 3500;
    const notes: Note[] = Array.from({ length: cantidad }, (_, i) =>
      nota((i % 4) as Column, i * 50),
    );
    const chart = crearMapa(notes);

    const inicio = process.hrtime.bigint();
    const resultado = calcularDificultad(chart);
    const duracionMs = Number(process.hrtime.bigint() - inicio) / 1_000_000;

    // No alcanza con que el cronometro de poco: una implementacion que
    // "retornara temprano" sin procesar nada seria rapidisima, pero esta
    // asercion la delataria, porque exige que el motor haya calculado algo
    // de verdad (ver el mismo razonamiento en judge/engine.test.ts).
    expect(resultado.vector.stream).toBeGreaterThan(0);
    expect(resultado.overall).toBeGreaterThan(0);

    expect(duracionMs).toBeLessThan(50);
  });
});
