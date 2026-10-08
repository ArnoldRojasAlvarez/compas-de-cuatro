// T-061: logica pura del diagnostico de tirones. Sin navegador: todo son numeros.

import { describe, expect, it, vi } from 'vitest';
import {
  TOPE_TIRONES,
  contarNotasVisibles,
  crearRegistroDeFrames,
  detalleDeTirones,
  formatearSegundos,
  lineaDeTirones,
  type EntradaLoaf,
  type ResumenDiagnostico,
  type Tiron,
} from './diagnostico-tirones-logica.js';

/** Corre frames con la duracion dada; el reloj de juego avanza lo mismo (audio sin pausa). */
function correr(
  registro: ReturnType<typeof crearRegistroDeFrames>,
  duraciones: readonly number[],
  ts0 = 1000,
  t0 = 0,
): { ts: number; t: number; tirones: Tiron[] } {
  let ts = ts0;
  let t = t0;
  const tirones: Tiron[] = [];
  registro.frame(t, ts);
  for (const d of duraciones) {
    ts += d;
    t += d;
    const tiron = registro.frame(t, ts);
    if (tiron !== null) tirones.push(tiron);
  }
  return { ts, t, tirones };
}

function loaf(startTime: number, duration: number, extra: Partial<EntradaLoaf> = {}): EntradaLoaf {
  return { startTime, duration, blockingDuration: 0, styleAndLayoutStart: 0, scripts: [], ...extra };
}

describe('frames sanos', () => {
  it('no devuelve tirones ni cuenta nada sobre 20 ms, y p50/p99 son la duracion del frame', () => {
    const registro = crearRegistroDeFrames();
    const { tirones } = correr(registro, new Array<number>(600).fill(16.7));
    const r = registro.resumir();
    expect(tirones).toEqual([]);
    expect(r.frames).toBe(600);
    expect(r.conteos).toEqual({ mayor20: 0, mayor33: 0, mayor50: 0 });
    expect(r.tironesTotal).toBe(0);
    expect(r.tirones).toEqual([]);
    expect(r.p50Ms).toBeCloseTo(16.7, 0);
    expect(r.p99Ms).toBeCloseTo(16.7, 0);
    expect(r.peorMs).toBe(16.7);
  });

  it('el primer frame es solo la referencia: no cuenta', () => {
    const registro = crearRegistroDeFrames();
    expect(registro.frame(0, 5000)).toBeNull();
    expect(registro.resumir().frames).toBe(0);
  });
});

describe('tirones', () => {
  it('un frame de 133 ms devuelve el tiron con su duracion y el instante de juego del frame que lo cierra', () => {
    const registro = crearRegistroDeFrames();
    const { tirones } = correr(registro, [16.7, 16.7, 133, 16.7]);
    expect(tirones).toHaveLength(1);
    expect(tirones[0]!.duracionMs).toBe(133);
    expect(tirones[0]!.tJuego).toBeCloseTo(16.7 * 2 + 133, 1);
    const r = registro.resumir();
    expect(r.tironesTotal).toBe(1);
    expect(r.peorMs).toBe(133);
  });

  it('un tiron es todo frame de mas de 30 ms: 30 exacto no cuenta, 31 si, aunque no pase de 50', () => {
    const exacto = crearRegistroDeFrames();
    expect(correr(exacto, [30]).tirones).toEqual([]);
    expect(exacto.resumir().tironesTotal).toBe(0);

    const pasado = crearRegistroDeFrames();
    const { tirones } = correr(pasado, [31, 45]);
    expect(tirones.map((t) => t.duracionMs)).toEqual([31, 45]);
    const r = pasado.resumir();
    expect(r.tironesTotal).toBe(2);
    expect(r.conteos.mayor50).toBe(0);
  });

  it('los conteos de 20, 33 y 50 ms son estrictos', () => {
    const exactos = crearRegistroDeFrames();
    correr(exactos, [20, 33, 50]);
    // 20 no pasa de 20; 33 pasa de 20 pero no de 33; 50 pasa de 20 y de 33 pero no de 50.
    expect(exactos.resumir().conteos).toEqual({ mayor20: 2, mayor33: 1, mayor50: 0 });

    const pasados = crearRegistroDeFrames();
    correr(pasados, [21, 34, 51]);
    expect(pasados.resumir().conteos).toEqual({ mayor20: 3, mayor33: 2, mayor50: 1 });
  });

  it('con la pausa del juego (descartarProximo) el hueco no es un tiron; el reloj de juego no decide', () => {
    const registro = crearRegistroDeFrames();
    const { ts, t } = correr(registro, [16.7, 16.7]);
    registro.descartarProximo();
    // 4 s de pausa: rAF no corre y el reloj de juego queda quieto.
    expect(registro.frame(t + 1, ts + 4000)).toBeNull();
    const r = registro.resumir();
    expect(r.tironesTotal).toBe(0);
    expect(r.frames).toBe(2);
    expect(r.peorMs).toBe(16.7);
  });

  it('un tiron cuyo reloj de audio casi no avanza en ese frame (se pone al dia en el anterior) igual cuenta', () => {
    const registro = crearRegistroDeFrames();
    const { ts, t } = correr(registro, [16.7, 16.7]);
    // En Chrome el reloj de audio se atrasa durante el bloqueo: este frame de 150 ms ve +19 ms de reloj.
    const tiron = registro.frame(t + 19, ts + 150);
    expect(tiron).not.toBeNull();
    expect(tiron!.duracionMs).toBe(150);
  });

  it('un tiron real con el audio corriendo si cuenta aunque dure segundos', () => {
    const registro = crearRegistroDeFrames();
    const { tirones } = correr(registro, [16.7, 2500]);
    expect(tirones).toHaveLength(1);
    expect(tirones[0]!.duracionMs).toBe(2500);
  });

  it('descartarProximo salta un solo frame (la pestana estuvo oculta)', () => {
    const registro = crearRegistroDeFrames();
    const { ts, t } = correr(registro, [16.7]);
    registro.descartarProximo();
    expect(registro.frame(t + 3000, ts + 3000)).toBeNull();
    expect(registro.frame(t + 3000 + 120, ts + 3000 + 120)).not.toBeNull();
    expect(registro.resumir().tironesTotal).toBe(1);
  });

  it('guarda con detalle hasta el tope, pero cuenta todos', () => {
    const registro = crearRegistroDeFrames();
    correr(registro, new Array<number>(TOPE_TIRONES + 50).fill(80));
    expect(TOPE_TIRONES).toBe(300);
    const r = registro.resumir();
    expect(r.tironesTotal).toBe(TOPE_TIRONES + 50);
    expect(r.tirones).toHaveLength(TOPE_TIRONES);
    expect(r.conteos.mayor50).toBe(TOPE_TIRONES + 50);
  });

  it('pide las notas visibles solo al registrar un tiron', () => {
    const notasVisibles = vi.fn(() => 12);
    const registro = crearRegistroDeFrames({ notasVisibles });
    const { ts, t } = correr(registro, new Array<number>(100).fill(16.7));
    expect(notasVisibles).not.toHaveBeenCalled();
    const tiron = registro.frame(t + 90, ts + 90);
    expect(notasVisibles).toHaveBeenCalledTimes(1);
    expect(tiron!.notasVisibles).toBe(12);
  });
});

describe('percentiles', () => {
  it('p50 sigue al frame tipico y p99 al outlier cuando pasa del 1 %', () => {
    const registro = crearRegistroDeFrames();
    correr(registro, [...new Array<number>(97).fill(16.7), 40, 40, 100]);
    const r = registro.resumir();
    expect(r.p50Ms).toBeCloseTo(16.7, 0);
    expect(r.p99Ms).toBeCloseTo(40, 0);
    expect(r.peorMs).toBe(100);
  });

  it('un frame de mas de 500 ms cae en el desborde y el percentil devuelve el peor visto', () => {
    const registro = crearRegistroDeFrames();
    correr(registro, [16.7, 900]);
    expect(registro.resumir().p99Ms).toBe(900);
  });
});

describe('atribucion con long-animation-frame y longtask', () => {
  it('un loaf que se solapa con el tiron se adjunta: script, estilo/layout, bloqueo y fuentes por duracion', () => {
    const registro = crearRegistroDeFrames();
    // Tiron entre ts 1033.4 y 1166.4.
    const { tirones } = correr(registro, [16.7, 16.7, 133]);
    registro.agregarLoaf(
      loaf(1040, 120, {
        blockingDuration: 70,
        styleAndLayoutStart: 1150,
        scripts: [
          { sourceURL: 'a.js', sourceFunctionName: 'chica', duration: 5 },
          { sourceURL: 'b.js', sourceFunctionName: 'grande', duration: 100 },
        ],
      }),
    );
    registro.resumir();
    expect(tirones[0]!.loaf).toEqual({
      scriptMs: 105,
      estiloLayoutMs: 10,
      bloqueoMs: 70,
      fuentes: [
        { url: 'b.js', funcion: 'grande', ms: 100 },
        { url: 'a.js', funcion: 'chica', ms: 5 },
      ],
    });
  });

  it('trunca las fuentes a 5 y las URL largas', () => {
    const registro = crearRegistroDeFrames();
    const { tirones } = correr(registro, [16.7, 133]);
    const scripts = Array.from({ length: 8 }, (_, i) => ({
      sourceURL: 'https://x.test/' + 'u'.repeat(300),
      sourceFunctionName: `f${i}`,
      duration: i + 1,
    }));
    registro.agregarLoaf(loaf(1020, 130, { scripts }));
    registro.resumir();
    const fuentes = tirones[0]!.loaf!.fuentes;
    expect(fuentes).toHaveLength(5);
    expect(fuentes.map((f) => f.funcion)).toEqual(['f7', 'f6', 'f5', 'f4', 'f3']);
    expect(fuentes[0]!.url.length).toBeLessThanOrEqual(120);
  });

  it('con varios loaf elige el que mas se solapa, y uno lejano no se adjunta', () => {
    const registro = crearRegistroDeFrames();
    const { tirones } = correr(registro, [16.7, 133]);
    registro.agregarLoaf(loaf(5000, 200, { blockingDuration: 1 }));
    registro.agregarLoaf(loaf(1000, 20, { blockingDuration: 2 }));
    registro.agregarLoaf(loaf(1030, 110, { blockingDuration: 3 }));
    registro.resumir();
    expect(tirones[0]!.loaf!.bloqueoMs).toBe(3);
  });

  it('un loaf larguisimo que arranca mucho antes (la carga inicial) no se le adjunta a un tiron corto', () => {
    const registro = crearRegistroDeFrames();
    const { tirones } = correr(registro, [16.7, 40]);
    registro.agregarLoaf(loaf(0, 1400, { blockingDuration: 1300 }));
    registro.resumir();
    expect('loaf' in tirones[0]!).toBe(false);
  });

  it('sin ningun loaf cerca el tiron no trae la propiedad loaf', () => {
    const registro = crearRegistroDeFrames();
    const { tirones } = correr(registro, [16.7, 133]);
    registro.agregarLoaf(loaf(9000, 100));
    registro.resumir();
    expect('loaf' in tirones[0]!).toBe(false);
  });

  it('una tarea larga que se solapa deja su duracion en tareaLargaMs', () => {
    const registro = crearRegistroDeFrames();
    const { tirones } = correr(registro, [16.7, 133]);
    registro.agregarTareaLarga({ startTime: 1030, duration: 118 });
    registro.agregarTareaLarga({ startTime: 8000, duration: 300 });
    registro.resumir();
    expect(tirones[0]!.tareaLargaMs).toBe(118);
  });
});

describe('densidad del momento', () => {
  it('golpesRecientes cuenta lo juzgado en los 500 ms de reloj de juego anteriores al tiron', () => {
    let juzgados = 0;
    const registro = crearRegistroDeFrames({ juzgados: () => juzgados });
    let ts = 1000;
    let t = 0;
    registro.frame(t, ts);
    // 2 s a 60 fps con un golpe cada frame: en 500 ms entran 30 frames, 30 golpes.
    for (let i = 0; i < 120; i++) {
      ts += 16.6667;
      t += 16.6667;
      juzgados += 1;
      registro.frame(t, ts);
    }
    juzgados += 4; // golpes del frame del tiron
    ts += 100;
    t += 100;
    const tiron = registro.frame(t, ts)!;
    // Los 500 ms anteriores a t abarcan 400 ms de frames sanos (24 golpes) mas el frame lento (4).
    expect(tiron.golpesRecientes).toBeGreaterThanOrEqual(26);
    expect(tiron.golpesRecientes).toBeLessThanOrEqual(34);
  });

  it('sin golpes en la ventana da 0, y sin la fuente no hay propiedad', () => {
    const quieto = crearRegistroDeFrames({ juzgados: () => 7 });
    const { tirones } = correr(quieto, [16.7, 16.7, 100]);
    expect(tirones[0]!.golpesRecientes).toBe(0);
    const sinFuente = crearRegistroDeFrames();
    expect('golpesRecientes' in correr(sinFuente, [16.7, 100]).tirones[0]!).toBe(false);
  });
});

describe('histograma de duraciones', () => {
  it('reparte los frames en las cubetas 0-17, 17-20, 20-25, 25-33, 33-50, 50-100 y >100 (limite superior inclusivo)', () => {
    const registro = crearRegistroDeFrames();
    correr(registro, [16.7, 17, 18, 20, 22, 25, 30, 33, 40, 50, 75, 100, 101, 300]);
    expect(registro.resumir().histograma).toEqual({
      '0-17': 2,
      '17-20': 2,
      '20-25': 2,
      '25-33': 2,
      '33-50': 2,
      '50-100': 2,
      '>100': 2,
    });
  });

  it('la suma de cubetas es el total de frames', () => {
    const registro = crearRegistroDeFrames();
    correr(registro, new Array<number>(40).fill(16.7));
    const h = registro.resumir().histograma;
    expect(Object.values(h).reduce((a, b) => a + b, 0)).toBe(40);
  });
});

describe('proporcion de tirones atribuidos a script', () => {
  it('cuenta, entre los de mas de 50 ms, los que traen script, los de loaf sin script y los sin loaf; los de 30 a 50 ms no entran', () => {
    const registro = crearRegistroDeFrames();
    // Cuatro tirones seguidos (ts desde 1000): 1016.7-1116.7 (script), 1133.4-1233.4 (loaf sin script),
    // 1250.1-1350.1 (sin loaf) y uno de 40 ms.
    const { tirones } = correr(registro, [16.7, 100, 16.7, 100, 16.7, 100, 16.7, 40]);
    expect(tirones).toHaveLength(4);
    registro.agregarLoaf(
      loaf(1020, 95, { scripts: [{ sourceURL: 'a.js', sourceFunctionName: 'f', duration: 80 }] }),
    );
    registro.agregarLoaf(loaf(1140, 90, { blockingDuration: 60 }));
    const r = registro.resumir();
    expect(r.tironesTotal).toBe(4);
    expect(r.atribucion).toEqual({
      mayor50: 3,
      conScript: 1,
      loafSinScript: 1,
      sinLoaf: 1,
      proporcionConScript: 0.33,
    });
  });

  it('sin tirones de mas de 50 ms la proporcion es 0', () => {
    const registro = crearRegistroDeFrames();
    correr(registro, [16.7, 40]);
    expect(registro.resumir().atribucion.proporcionConScript).toBe(0);
    expect(registro.resumir().atribucion.mayor50).toBe(0);
  });
});

describe('contarNotasVisibles', () => {
  const notas = [0, 100, 200, 300, 400, 500, 600].map((time) => ({ time }));

  it('cuenta las notas entre ahora y ahora + scrollDuration', () => {
    expect(contarNotasVisibles(notas, 150, 300)).toBe(3); // 200, 300, 400
    expect(contarNotasVisibles(notas, 0, 1000)).toBe(7);
  });

  it('la nota justo en el receptor cuenta y la justo en el borde de arriba no', () => {
    expect(contarNotasVisibles(notas, 200, 200)).toBe(2); // 200 y 300; 400 queda afuera
  });

  it('sin notas por delante o con lista vacia da 0', () => {
    expect(contarNotasVisibles(notas, 700, 500)).toBe(0);
    expect(contarNotasVisibles([], 0, 500)).toBe(0);
  });
});

describe('texto de los resultados', () => {
  function resumenCon(
    tirones: { tJuego: number; duracionMs: number }[],
    total = tirones.length,
  ): ResumenDiagnostico {
    return {
      version: 1,
      contexto: {} as ResumenDiagnostico['contexto'],
      frames: 1000,
      conteos: { mayor20: 0, mayor33: 0, mayor50: tirones.filter((t) => t.duracionMs > 50).length },
      histograma: {} as ResumenDiagnostico['histograma'],
      atribucion: {} as ResumenDiagnostico['atribucion'],
      p50Ms: 16.7,
      p99Ms: 17,
      peorMs: 0,
      tironesTotal: total,
      tirones,
    };
  }

  it('sin tirones no hay linea', () => {
    expect(lineaDeTirones(resumenCon([]))).toBeNull();
  });

  it('"412 frames > 30 ms · 9 > 50 ms · peor 133 ms a 38,0 s"', () => {
    const tirones = [
      { tJuego: 12_000, duracionMs: 60 },
      { tJuego: 38_000, duracionMs: 133.4 },
      ...Array.from({ length: 7 }, (_, i) => ({ tJuego: 50_000 + i, duracionMs: 55 })),
    ];
    const r = resumenCon(tirones, 412);
    expect(lineaDeTirones(r)).toBe('412 frames > 30 ms · 9 > 50 ms · peor 133 ms a 38,0 s');
  });

  it('en singular dice "1 frame"', () => {
    expect(lineaDeTirones(resumenCon([{ tJuego: 1500, duracionMs: 40 }]))).toBe(
      '1 frame > 30 ms · 0 > 50 ms · peor 40 ms a 1,5 s',
    );
  });

  it('el detalle lista los 10 peores por duracion y dice cuantos faltan', () => {
    const tirones = Array.from({ length: 12 }, (_, i) => ({ tJuego: i * 1000, duracionMs: 60 + i }));
    const lineas = detalleDeTirones(resumenCon(tirones)).split('\n');
    expect(lineas).toHaveLength(11);
    expect(lineas[0]).toBe('11,0 s · 71 ms');
    expect(lineas[9]).toBe('2,0 s · 62 ms');
    expect(lineas[10]).toBe('y 2 más');
  });

  it('formatearSegundos usa coma decimal', () => {
    expect(formatearSegundos(38_040)).toBe('38,0 s');
    expect(formatearSegundos(1250)).toBe('1,3 s');
  });
});
