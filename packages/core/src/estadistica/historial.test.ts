// Tests de T-045 para el historial: resumen, serie diaria y ventana de dias.
// El caso central es el promedio ponderado: dos partidas de tamano muy
// distinto no se promedian "a la par".

import { describe, expect, it } from 'vitest';
import {
  TOPE_HISTORIAL,
  diaUtc,
  filtrarPorVentana,
  golpesJuzgados,
  resumirHistorial,
  serieDiaria,
  type RegistroPartida,
} from './historial.js';

function registro(extra: Partial<RegistroPartida> = {}): RegistroPartida {
  return {
    hash: '123',
    fecha: '2026-10-05T12:00:00.000Z',
    score: 500_000,
    accuracy: 0.9,
    notas: 100,
    desviacionMedia: 0,
    desviacionTipica: 0,
    tempranas: 0,
    tardias: 0,
    fallosPorColumna: [0, 0, 0, 0],
    duracionJugadaMs: 60_000,
    ...extra,
  };
}

/** Que ningun numero del resumen sea NaN ni infinito (null es valido: "sin datos"). */
function sinNaN(valor: unknown): void {
  if (typeof valor === 'number') expect(Number.isFinite(valor)).toBe(true);
  else if (Array.isArray(valor)) valor.forEach(sinNaN);
  else if (typeof valor === 'object' && valor !== null)
    Object.values(valor).forEach(sinNaN);
}

describe('resumirHistorial', () => {
  it('sin partidas: ceros y promedios en null, nunca NaN', () => {
    const r = resumirHistorial([]);
    expect(r).toEqual({
      partidas: 0,
      tiempoJugadoMs: 0,
      notas: 0,
      accuracyMedia: null,
      desviacionMedia: null,
      desviacionTipica: null,
      tempranas: 0,
      tardias: 0,
      proporcionTemprana: null,
      fallosPorColumna: [0, 0, 0, 0],
      columnaMasFallada: null,
    });
    sinNaN(r);
  });

  it('una partida: el resumen es la partida', () => {
    const r = resumirHistorial([
      registro({
        accuracy: 0.97,
        notas: 200,
        desviacionMedia: -6,
        desviacionTipica: 12,
        tempranas: 120,
        tardias: 60,
        fallosPorColumna: [0, 3, 1, 0],
        duracionJugadaMs: 95_000,
      }),
    ]);
    expect(r.partidas).toBe(1);
    expect(r.tiempoJugadoMs).toBe(95_000);
    expect(r.notas).toBe(200);
    expect(r.accuracyMedia).toBeCloseTo(0.97, 12);
    expect(r.desviacionMedia).toBeCloseTo(-6, 12);
    expect(r.desviacionTipica).toBeCloseTo(12, 12);
    expect(r.proporcionTemprana).toBeCloseTo(120 / 180, 12);
    expect(r.fallosPorColumna).toEqual([0, 3, 1, 0]);
    expect(r.columnaMasFallada).toBe(1);
  });

  it('suma tiempo, notas, tempranas, tardias y fallos de varias partidas', () => {
    const r = resumirHistorial([
      registro({
        duracionJugadaMs: 30_000,
        notas: 50,
        tempranas: 5,
        tardias: 7,
        fallosPorColumna: [1, 0, 2, 0],
      }),
      registro({
        duracionJugadaMs: 45_000,
        notas: 70,
        tempranas: 9,
        tardias: 1,
        fallosPorColumna: [0, 0, 3, 4],
      }),
      registro({
        duracionJugadaMs: 15_000,
        notas: 30,
        tempranas: 2,
        tardias: 2,
        fallosPorColumna: [0, 0, 0, 0],
      }),
    ]);
    expect(r.partidas).toBe(3);
    expect(r.tiempoJugadoMs).toBe(90_000);
    expect(r.notas).toBe(150);
    expect(r.tempranas).toBe(16);
    expect(r.tardias).toBe(10);
    expect(r.proporcionTemprana).toBeCloseTo(16 / 26, 12);
    expect(r.fallosPorColumna).toEqual([1, 0, 5, 4]);
    expect(r.columnaMasFallada).toBe(2);
  });

  it('PONDERA la precision por notas: una partida corta no pesa lo que una larga', () => {
    // 20 notas perfectas y 2000 notas al 50 %. Un promedio simple de promedios
    // daria 0.75; el real es (20 * 1 + 2000 * 0.5) / 2020.
    const r = resumirHistorial([
      registro({ accuracy: 1, notas: 20 }),
      registro({ accuracy: 0.5, notas: 2000 }),
    ]);
    expect(r.accuracyMedia).toBeCloseTo(1020 / 2020, 12);
    expect(r.accuracyMedia).not.toBeCloseTo(0.75, 2);
  });

  it('PONDERA la desviacion media por golpes juzgados (las notas sin los miss)', () => {
    // La corta pega siempre +20 en 10 golpes; la larga -2 en 1000 golpes
    // (1010 notas con 10 miss). Simple: +9. Ponderado: (200 - 2000) / 1010.
    const r = resumirHistorial([
      registro({ notas: 10, desviacionMedia: 20, desviacionTipica: 0 }),
      registro({
        notas: 1010,
        desviacionMedia: -2,
        desviacionTipica: 0,
        fallosPorColumna: [10, 0, 0, 0],
      }),
    ]);
    expect(r.desviacionMedia).toBeCloseTo((10 * 20 + 1000 * -2) / 1010, 12);
    expect(r.desviacionMedia).not.toBeCloseTo(9, 1);
  });

  it('los miss no pesan en la desviacion: una partida de pura miss no la mueve', () => {
    const r = resumirHistorial([
      registro({ notas: 100, desviacionMedia: -4, desviacionTipica: 0 }),
      // 40 notas, las 40 miss: su "media" es un 0 de relleno sin golpes detras.
      registro({
        notas: 40,
        desviacionMedia: 0,
        desviacionTipica: 0,
        fallosPorColumna: [10, 10, 10, 10],
      }),
    ]);
    expect(r.desviacionMedia).toBeCloseTo(-4, 12);
  });

  it('la desviacion tipica se agrupa: suma la dispersion entre partidas, no solo dentro', () => {
    // Cada partida es perfectamente pareja (tipica 0) pero una pega 10 ms
    // temprano y la otra 10 ms tarde: juntas la dispersion es 10.
    const r = resumirHistorial([
      registro({ notas: 100, desviacionMedia: -10, desviacionTipica: 0 }),
      registro({ notas: 100, desviacionMedia: 10, desviacionTipica: 0 }),
    ]);
    expect(r.desviacionMedia).toBeCloseTo(0, 12);
    expect(r.desviacionTipica).toBeCloseTo(10, 12);
  });

  it('la desviacion tipica agrupada coincide con la de todos los golpes juntos', () => {
    // Partida A: errores [0, 10] (media 5, tipica 5). Partida B: errores [20, 30, 40] (media 30, tipica sqrt(200/3)).
    const todos = [0, 10, 20, 30, 40];
    const media = todos.reduce((a, b) => a + b, 0) / todos.length;
    const esperada = Math.sqrt(
      todos.reduce((a, e) => a + (e - media) ** 2, 0) / todos.length,
    );
    const r = resumirHistorial([
      registro({ notas: 2, desviacionMedia: 5, desviacionTipica: 5 }),
      registro({ notas: 3, desviacionMedia: 30, desviacionTipica: Math.sqrt(200 / 3) }),
    ]);
    expect(r.desviacionMedia).toBeCloseTo(media, 12);
    expect(r.desviacionTipica).toBeCloseTo(esperada, 10);
  });

  it('el orden de la entrada no cambia el resumen', () => {
    const a = registro({
      accuracy: 0.8,
      notas: 30,
      desviacionMedia: 4,
      fecha: '2026-10-01T10:00:00.000Z',
    });
    const b = registro({
      accuracy: 0.95,
      notas: 300,
      desviacionMedia: -3,
      fecha: '2026-10-03T10:00:00.000Z',
    });
    const c = registro({
      accuracy: 0.6,
      notas: 90,
      desviacionMedia: 11,
      fecha: '2026-10-02T10:00:00.000Z',
    });
    const uno = resumirHistorial([a, b, c]);
    const otro = resumirHistorial([c, a, b]);
    expect(otro.accuracyMedia).toBeCloseTo(uno.accuracyMedia!, 12);
    expect(otro.desviacionMedia).toBeCloseTo(uno.desviacionMedia!, 12);
    expect(otro.desviacionTipica).toBeCloseTo(uno.desviacionTipica!, 12);
  });

  it('en empate de fallos gana la primera columna; sin fallos no hay columna', () => {
    expect(
      resumirHistorial([registro({ fallosPorColumna: [0, 2, 2, 1] })]).columnaMasFallada,
    ).toBe(1);
    expect(
      resumirHistorial([registro({ fallosPorColumna: [0, 0, 0, 0] })]).columnaMasFallada,
    ).toBeNull();
  });

  it('sin golpes tempranos ni tardios la proporcion es null, no 0/0', () => {
    const r = resumirHistorial([registro({ tempranas: 0, tardias: 0 })]);
    expect(r.proporcionTemprana).toBeNull();
    sinNaN(r);
  });

  it('numeros rotos (NaN, negativos, Infinity) no contaminan el resumen', () => {
    const r = resumirHistorial([
      registro({ accuracy: Number.NaN, notas: 10, desviacionMedia: Number.NaN }),
      registro({
        accuracy: 0.8,
        notas: Number.POSITIVE_INFINITY,
        duracionJugadaMs: -5,
        tempranas: -3,
        tardias: Number.NaN,
        fallosPorColumna: [Number.NaN, -1, 0, 0],
      }),
      registro({
        accuracy: 0.6,
        notas: 100,
        desviacionMedia: 2,
        desviacionTipica: Number.NaN,
      }),
    ]);
    sinNaN(r);
    expect(r.accuracyMedia).toBeCloseTo(0.6, 12);
    expect(r.tiempoJugadoMs).toBe(120_000);
    expect(r.tempranas).toBe(0);
  });

  it('todo en 0 notas: promedios en null en vez de dividir por cero', () => {
    const r = resumirHistorial([registro({ notas: 0 })]);
    expect(r.accuracyMedia).toBeNull();
    expect(r.desviacionMedia).toBeNull();
    expect(r.desviacionTipica).toBeNull();
    sinNaN(r);
  });
});

describe('golpesJuzgados', () => {
  it('son las notas menos los miss, y nunca baja de 0', () => {
    expect(golpesJuzgados(registro({ notas: 100, fallosPorColumna: [1, 2, 3, 4] }))).toBe(
      90,
    );
    expect(golpesJuzgados(registro({ notas: 5, fallosPorColumna: [10, 0, 0, 0] }))).toBe(
      0,
    );
  });
});

describe('serieDiaria', () => {
  it('sin partidas es una serie vacia', () => {
    expect(serieDiaria([], 'accuracy')).toEqual([]);
    expect(serieDiaria([], 'desviacionMedia')).toEqual([]);
  });

  it('un solo dia: un punto con su valor', () => {
    const serie = serieDiaria([registro({ accuracy: 0.93 })], 'accuracy');
    expect(serie).toEqual([{ dia: '2026-10-05', valor: 0.93 }]);
  });

  it('varios dias, entregados en desorden, salen ordenados de mas viejo a mas nuevo', () => {
    const serie = serieDiaria(
      [
        registro({ fecha: '2026-10-07T09:00:00.000Z', desviacionMedia: -1 }),
        registro({ fecha: '2026-10-02T09:00:00.000Z', desviacionMedia: 8 }),
        registro({ fecha: '2026-10-05T09:00:00.000Z', desviacionMedia: 3 }),
      ],
      'desviacionMedia',
    );
    expect(serie.map((p) => p.dia)).toEqual(['2026-10-02', '2026-10-05', '2026-10-07']);
    expect(serie.map((p) => p.valor)).toEqual([8, 3, -1]);
  });

  it('un dia con varias partidas se PONDERA por notas', () => {
    // Misma tarde: 20 notas al 100 % y 2000 al 50 %. Simple: 0.75.
    const serie = serieDiaria(
      [
        registro({ fecha: '2026-10-05T10:00:00.000Z', accuracy: 1, notas: 20 }),
        registro({ fecha: '2026-10-05T18:00:00.000Z', accuracy: 0.5, notas: 2000 }),
      ],
      'accuracy',
    );
    expect(serie).toHaveLength(1);
    expect(serie[0]!.valor).toBeCloseTo(1020 / 2020, 12);
  });

  it('la desviacion de un dia pondera por golpes juzgados, no por notas', () => {
    // 1000 notas con 990 miss (10 golpes, +30) y 100 notas sin miss (100 golpes, 0).
    const serie = serieDiaria(
      [
        registro({
          notas: 1000,
          desviacionMedia: 30,
          fallosPorColumna: [300, 300, 200, 190],
        }),
        registro({ notas: 100, desviacionMedia: 0 }),
      ],
      'desviacionMedia',
    );
    expect(serie[0]!.valor).toBeCloseTo((10 * 30) / 110, 12);
  });

  it('un dia de pura miss no aparece en la serie de desviacion (pero si en la de precision)', () => {
    const dia = [
      registro({
        notas: 20,
        accuracy: 0,
        desviacionMedia: 0,
        fallosPorColumna: [5, 5, 5, 5],
      }),
    ];
    expect(serieDiaria(dia, 'desviacionMedia')).toEqual([]);
    expect(serieDiaria(dia, 'accuracy')).toEqual([{ dia: '2026-10-05', valor: 0 }]);
  });

  it('una fecha ilegible no aparece, y los valores NaN tampoco', () => {
    const serie = serieDiaria(
      [
        registro({ fecha: 'ayer' }),
        registro({ fecha: '2026-10-05T10:00:00.000Z', accuracy: Number.NaN }),
        registro({ fecha: '2026-10-06T10:00:00.000Z', accuracy: 0.7 }),
      ],
      'accuracy',
    );
    expect(serie).toEqual([{ dia: '2026-10-06', valor: 0.7 }]);
  });

  it('el dia lo decide quien llama: dos horas UTC pueden ser el mismo dia local', () => {
    const registros = [
      registro({ fecha: '2026-10-05T23:30:00.000Z', accuracy: 0.8, notas: 100 }),
      registro({ fecha: '2026-10-06T01:30:00.000Z', accuracy: 0.6, notas: 100 }),
    ];
    expect(serieDiaria(registros, 'accuracy')).toHaveLength(2);
    // Cinco horas atras (UTC-5): las dos caen el 5.
    const localMenos5 = (f: string): string =>
      new Date(Date.parse(f) - 5 * 3_600_000).toISOString().slice(0, 10);
    const serie = serieDiaria(registros, 'accuracy', localMenos5);
    expect(serie).toHaveLength(1);
    expect(serie[0]!.valor).toBeCloseTo(0.7, 12);
  });

  it('no hay NaN con un solo dia ni con muchos registros iguales', () => {
    const muchos = Array.from({ length: 50 }, () => registro());
    for (const campo of ['accuracy', 'desviacionMedia'] as const) {
      for (const p of serieDiaria(muchos, campo)) {
        expect(Number.isFinite(p.valor)).toBe(true);
      }
    }
  });
});

describe('diaUtc', () => {
  it('toma el dia UTC de un ISO y devuelve vacio si no se lee', () => {
    expect(diaUtc('2026-10-05T23:59:59.999Z')).toBe('2026-10-05');
    expect(diaUtc('basura')).toBe('');
  });
});

describe('filtrarPorVentana', () => {
  const ahora = Date.parse('2026-10-10T12:00:00.000Z');
  const hoy = registro({ fecha: '2026-10-10T08:00:00.000Z' });
  const haceSeis = registro({ fecha: '2026-10-04T13:00:00.000Z' });
  const haceOcho = registro({ fecha: '2026-10-02T11:00:00.000Z' });
  const haceCuarenta = registro({ fecha: '2026-08-31T11:00:00.000Z' });
  const todas = [haceCuarenta, hoy, haceOcho, haceSeis];

  it('null devuelve todo, en el mismo orden', () => {
    expect(filtrarPorVentana(todas, null, ahora)).toEqual(todas);
  });

  it('7 dias deja las ultimas 168 horas', () => {
    expect(filtrarPorVentana(todas, 7, ahora)).toEqual([hoy, haceSeis]);
  });

  it('30 dias deja hasta hace 30 dias', () => {
    expect(filtrarPorVentana(todas, 30, ahora)).toEqual([hoy, haceOcho, haceSeis]);
  });

  it('el borde exacto cuenta como dentro; una fecha ilegible o futura, como fuera', () => {
    const borde = registro({ fecha: '2026-10-03T12:00:00.000Z' });
    const futura = registro({ fecha: '2026-10-11T12:00:00.000Z' });
    const rota = registro({ fecha: 'nunca' });
    expect(filtrarPorVentana([borde, futura, rota], 7, ahora)).toEqual([borde]);
  });
});

describe('TOPE_HISTORIAL', () => {
  it('son 2000 partidas', () => {
    expect(TOPE_HISTORIAL).toBe(2000);
  });
});
