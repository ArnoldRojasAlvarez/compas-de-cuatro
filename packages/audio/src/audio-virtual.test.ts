// Tests de T-066 (paso 3, D8): renderizarAudioVirtual. Vitest corre en node, sin
// Web Audio: el contexto es un doble con sampleRate 1000 (1 ms = 1 muestra)
// cuyo `decodeAudioData` arma buffers conocidos desde los bytes: cada byte de la
// "muestra" es un valor de 0 a 100 que pasa a ser amplitud /100 (mono).

import { describe, expect, it, vi } from 'vitest';
import type { Chart, EventoDeMuestra } from '@tetra/core';
import { renderizarAudioVirtual } from './audio-virtual.js';

const SAMPLE_RATE = 1000;

function bufferFalso(canales: Float32Array[], sampleRate = SAMPLE_RATE): AudioBuffer {
  return {
    numberOfChannels: canales.length,
    length: canales[0]!.length,
    sampleRate,
    duration: canales[0]!.length / sampleRate,
    getChannelData: (c: number) => canales[c]!,
  } as unknown as AudioBuffer;
}

function crearContextoFalso() {
  const decodificar = vi.fn(async (bytes: ArrayBuffer): Promise<AudioBuffer> => {
    const datos = new Uint8Array(bytes);
    if (datos.length === 0) throw new Error('no decodifica');
    return bufferFalso([Float32Array.from(datos, (b) => b / 100)]);
  });
  const ctx = {
    sampleRate: SAMPLE_RATE,
    createBuffer: (canales: number, largo: number, sr: number) =>
      bufferFalso(
        Array.from({ length: canales }, () => new Float32Array(largo)),
        sr,
      ),
    decodeAudioData: decodificar,
  };
  return { ctx: ctx as unknown as BaseAudioContext, decodificar };
}

function chartCon(eventos: EventoDeMuestra[], ultimaNota = 100): Chart {
  return {
    metadata: {
      title: 't',
      artist: 'a',
      creator: 'c',
      difficultyName: 'd',
      audioFile: 'virtual',
      previewTime: 0,
    },
    overallDifficulty: 7,
    hpDrain: 5,
    timingPoints: [{ time: 0, bpm: 120, meter: 4 }],
    speedPoints: [],
    notes: [{ kind: 'tap', time: ultimaNota, column: 0 }],
    audioVirtual: { eventos },
  };
}

/** Muestras en memoria: nombre -> valores de 0 a 100. */
function lector(muestras: Record<string, number[]>) {
  return vi.fn(async (archivo: string): Promise<ArrayBuffer | undefined> => {
    const datos = muestras[archivo];
    return datos === undefined ? undefined : Uint8Array.from(datos).buffer;
  });
}

describe('renderizarAudioVirtual', () => {
  it('pone cada evento en su indice con su volumen', async () => {
    const { ctx } = crearContextoFalso();
    const chart = chartCon([
      { tiempo: 10, archivo: 'a.ogg', volumen: 100 },
      { tiempo: 20, archivo: 'b.ogg', volumen: 50 },
    ]);
    const { buffer, faltantes, ganancia } = await renderizarAudioVirtual({
      chart,
      leerMuestra: lector({ 'a.ogg': [50, 40], 'b.ogg': [80] }),
      ctx,
    });
    const izq = buffer.getChannelData(0);
    const der = buffer.getChannelData(1);
    expect(izq[10]).toBeCloseTo(0.5, 6);
    expect(izq[11]).toBeCloseTo(0.4, 6);
    expect(izq[20]).toBeCloseTo(0.4, 6); // 0,8 * 0,5
    expect(izq[9]).toBe(0);
    expect(izq[12]).toBe(0);
    expect(izq[21]).toBe(0);
    // mono a los dos canales
    expect(Array.from(der)).toEqual(Array.from(izq));
    expect(faltantes).toEqual([]);
    expect(ganancia).toBe(1);
  });

  it('redondea el inicio al indice mas cercano (2,6 ms cae en el 3)', async () => {
    const { ctx } = crearContextoFalso();
    const chart = chartCon([{ tiempo: 2.6, archivo: 'a.ogg', volumen: 100 }]);
    const { buffer } = await renderizarAudioVirtual({
      chart,
      leerMuestra: lector({ 'a.ogg': [100] }),
      ctx,
    });
    expect(buffer.getChannelData(0)[3]).toBeCloseTo(1, 6);
    expect(buffer.getChannelData(0)[2]).toBe(0);
  });

  it('el largo es el de duracionDeAudioVirtual al sampleRate del contexto', async () => {
    const { ctx } = crearContextoFalso();
    // ultimo evento 1000 + 8000 = 9000; ultima nota 100 + 2000.
    const chart = chartCon([{ tiempo: 1000, archivo: 'a.ogg', volumen: 100 }]);
    const { buffer } = await renderizarAudioVirtual({ chart, leerMuestra: lector({}), ctx });
    expect(buffer.length).toBe(9000);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.sampleRate).toBe(SAMPLE_RATE);
  });

  it('dos eventos de la misma muestra suman donde se superponen', async () => {
    const { ctx } = crearContextoFalso();
    const chart = chartCon([
      { tiempo: 0, archivo: 'a.ogg', volumen: 100 },
      { tiempo: 1, archivo: 'a.ogg', volumen: 100 },
    ]);
    const { buffer } = await renderizarAudioVirtual({
      chart,
      leerMuestra: lector({ 'a.ogg': [30, 30, 30] }),
      ctx,
    });
    const izq = buffer.getChannelData(0);
    expect(izq[0]).toBeCloseTo(0.3, 6);
    expect(izq[1]).toBeCloseTo(0.6, 6);
    expect(izq[2]).toBeCloseTo(0.6, 6);
    expect(izq[3]).toBeCloseTo(0.3, 6);
  });

  it('informa las muestras que faltan o no decodifican, ordenadas, y sigue con las demas', async () => {
    const { ctx } = crearContextoFalso();
    const chart = chartCon([
      { tiempo: 5, archivo: 'z.ogg', volumen: 100 },
      { tiempo: 6, archivo: 'rota.ogg', volumen: 100 },
      { tiempo: 7, archivo: 'a.ogg', volumen: 100 },
      { tiempo: 8, archivo: 'buena.ogg', volumen: 100 },
    ]);
    const { buffer, faltantes } = await renderizarAudioVirtual({
      chart,
      leerMuestra: lector({ 'rota.ogg': [], 'buena.ogg': [20] }), // vacia: el doble no decodifica
      ctx,
    });
    expect(faltantes).toEqual(['a.ogg', 'rota.ogg', 'z.ogg']);
    expect(buffer.getChannelData(0)[8]).toBeCloseTo(0.2, 6);
  });

  it('cada muestra se decodifica una sola vez aunque tenga muchos eventos', async () => {
    const { ctx, decodificar } = crearContextoFalso();
    const eventos: EventoDeMuestra[] = [];
    for (let i = 0; i < 50; i++) eventos.push({ tiempo: i * 3, archivo: 'a.ogg', volumen: 10 });
    for (let i = 0; i < 20; i++) eventos.push({ tiempo: i * 3 + 1, archivo: 'b.ogg', volumen: 10 });
    const leerMuestra = lector({ 'a.ogg': [10], 'b.ogg': [10] });
    await renderizarAudioVirtual({ chart: chartCon(eventos), leerMuestra, ctx });
    expect(decodificar).toHaveBeenCalledTimes(2);
    expect(leerMuestra).toHaveBeenCalledTimes(2);
  });

  it('cede el hilo entre muestras', async () => {
    const { ctx } = crearContextoFalso();
    const chart = chartCon([
      { tiempo: 0, archivo: 'a.ogg', volumen: 100 },
      { tiempo: 1, archivo: 'b.ogg', volumen: 100 },
      { tiempo: 2, archivo: 'c.ogg', volumen: 100 },
    ]);
    const ceder = vi.fn(async () => undefined);
    await renderizarAudioVirtual({
      chart,
      leerMuestra: lector({ 'a.ogg': [1], 'b.ogg': [1], 'c.ogg': [1] }),
      ctx,
      ceder,
    });
    expect(ceder).toHaveBeenCalledTimes(3);
  });

  it('si la mezcla satura la baja a 0,98 de pico; si no, no la toca', async () => {
    const { ctx } = crearContextoFalso();
    const chart = chartCon([
      { tiempo: 0, archivo: 'a.ogg', volumen: 100 },
      { tiempo: 0, archivo: 'b.ogg', volumen: 100 },
    ]);
    const { buffer, ganancia } = await renderizarAudioVirtual({
      chart,
      leerMuestra: lector({ 'a.ogg': [100], 'b.ogg': [100] }), // pico 2
      ctx,
    });
    expect(ganancia).toBeCloseTo(0.49, 6);
    expect(buffer.getChannelData(0)[0]).toBeCloseTo(0.98, 6);
  });

  it('una muestra estereo respeta L y R', async () => {
    const { ctx } = crearContextoFalso();
    (ctx.decodeAudioData as unknown) = vi.fn(async () =>
      bufferFalso([Float32Array.of(0.5), Float32Array.of(-0.5)]),
    );
    const chart = chartCon([{ tiempo: 4, archivo: 'a.ogg', volumen: 100 }]);
    const { buffer } = await renderizarAudioVirtual({
      chart,
      leerMuestra: lector({ 'a.ogg': [1] }),
      ctx,
    });
    expect(buffer.getChannelData(0)[4]).toBeCloseTo(0.5, 6);
    expect(buffer.getChannelData(1)[4]).toBeCloseTo(-0.5, 6);
  });

  it('descarta la cola casi muda de una muestra (menos de unos -70 dBFS) sin tocar lo audible', async () => {
    const { ctx } = crearContextoFalso();
    (ctx.decodeAudioData as unknown) = vi.fn(async () =>
      bufferFalso([Float32Array.of(0.5, 0.25, 0.0001, 0.0001)]),
    );
    const chart = chartCon([{ tiempo: 2, archivo: 'a.ogg', volumen: 100 }]);
    const { buffer } = await renderizarAudioVirtual({
      chart,
      leerMuestra: lector({ 'a.ogg': [1] }),
      ctx,
    });
    const izq = buffer.getChannelData(0);
    expect(izq[2]).toBeCloseTo(0.5, 6);
    expect(izq[3]).toBeCloseTo(0.25, 6);
    expect(izq[4]).toBe(0);
    expect(izq[5]).toBe(0);
  });

  it('una muestra enteramente muda no es faltante: simplemente no aporta', async () => {
    const { ctx } = crearContextoFalso();
    (ctx.decodeAudioData as unknown) = vi.fn(async () => bufferFalso([new Float32Array(10)]));
    const chart = chartCon([{ tiempo: 2, archivo: 'a.ogg', volumen: 100 }]);
    const { faltantes } = await renderizarAudioVirtual({
      chart,
      leerMuestra: lector({ 'a.ogg': [1] }),
      ctx,
    });
    expect(faltantes).toEqual([]);
  });

  it('cede el hilo tambien dentro de una muestra con muchos eventos', async () => {
    const { ctx } = crearContextoFalso();
    // 100 000 frames y 2 canales: 20 eventos por tanda, 100 eventos = 5 tandas.
    (ctx.decodeAudioData as unknown) = vi.fn(async () =>
      bufferFalso([new Float32Array(100_000).fill(0.001)]),
    );
    const eventos = Array.from({ length: 100 }, (_, i) => ({
      tiempo: i * 10,
      archivo: 'larga.ogg',
      volumen: 100,
    }));
    const ceder = vi.fn(async () => undefined);
    await renderizarAudioVirtual({
      chart: chartCon(eventos),
      leerMuestra: lector({ 'larga.ogg': [1] }),
      ctx,
      ceder,
    });
    expect(ceder.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('lee y decodifica las muestras siguientes antes de terminar de mezclar la actual', async () => {
    const { ctx } = crearContextoFalso();
    const pedidas: string[] = [];
    const leerMuestra = vi.fn(async (archivo: string) => {
      pedidas.push(archivo);
      return Uint8Array.from([10]).buffer;
    });
    let cedidas = 0;
    const eventos = ['a', 'b', 'c', 'd'].map((n, i) => ({
      tiempo: i,
      archivo: `${n}.ogg`,
      volumen: 100,
    }));
    await renderizarAudioVirtual({
      chart: chartCon(eventos),
      leerMuestra,
      ctx,
      ceder: async () => {
        cedidas++;
        // Al ceder tras la primera muestra, las dos siguientes ya fueron pedidas.
        if (cedidas === 1) expect(pedidas.slice(0, 3)).toEqual(['a.ogg', 'b.ogg', 'c.ogg']);
      },
    });
    expect(pedidas).toEqual(['a.ogg', 'b.ogg', 'c.ogg', 'd.ogg']);
  });
});
