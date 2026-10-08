// Tests de T-027 (hitsounds). Vitest corre en node: no hay Web Audio, asi que
// el contexto es un doble que solo implementa lo que usa hitsound.ts
// (sampleRate, createBuffer, createBufferSource, destination).

import { describe, expect, it, vi } from 'vitest';
import { TIPOS_HITSOUND, crearHitsound, reproducirHitsound, type TipoHitsound } from './hitsound.js';

function crearContextoFalso(sampleRate = 44100) {
  const sources: { buffer: unknown; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> }[] = [];
  const destination = { nombre: 'destino' };
  const ctx = {
    sampleRate,
    destination,
    createBuffer: vi.fn((canales: number, largo: number, sr: number) => {
      const datos = new Float32Array(largo);
      return {
        numberOfChannels: canales,
        length: largo,
        sampleRate: sr,
        duration: largo / sr,
        getChannelData: () => datos,
      };
    }),
    createBufferSource: vi.fn(() => {
      const source = { buffer: null as unknown, connect: vi.fn(), start: vi.fn() };
      sources.push(source);
      return source;
    }),
  };
  // Cast: el doble implementa solo la porcion de BaseAudioContext que se usa.
  return { ctx: ctx as unknown as BaseAudioContext, raw: ctx, sources, destination };
}

function muestras(tipo: TipoHitsound, sampleRate = 44100): Float32Array {
  const { ctx } = crearContextoFalso(sampleRate);
  return crearHitsound(ctx, tipo).getChannelData(0);
}

describe('crearHitsound', () => {
  it('es corto: entre 20 y 120 ms, y mono', () => {
    for (const tipo of TIPOS_HITSOUND) {
      const { ctx } = crearContextoFalso();
      const buffer = crearHitsound(ctx, tipo);
      expect(buffer.numberOfChannels).toBe(1);
      expect(buffer.duration).toBeGreaterThanOrEqual(0.02);
      expect(buffer.duration).toBeLessThanOrEqual(0.12);
    }
  });

  it('el largo sigue la frecuencia de muestreo del contexto', () => {
    expect(muestras('normal', 48000).length).toBeGreaterThan(muestras('normal', 22050).length);
    const { ctx, raw } = crearContextoFalso(48000);
    crearHitsound(ctx, 'normal');
    expect(raw.createBuffer.mock.calls[0]?.[2]).toBe(48000);
  });

  it('no es silencio, no satura y no tiene valores invalidos', () => {
    for (const tipo of TIPOS_HITSOUND) {
      const datos = muestras(tipo);
      let pico = 0;
      for (const m of datos) {
        expect(Number.isFinite(m)).toBe(true);
        pico = Math.max(pico, Math.abs(m));
      }
      expect(pico).toBeGreaterThan(0.4);
      expect(pico).toBeLessThanOrEqual(1);
    }
  });

  it('arranca y termina en silencio (sin escalon ni clic de corte)', () => {
    for (const tipo of TIPOS_HITSOUND) {
      const datos = muestras(tipo);
      expect(Math.abs(datos[0]!)).toBeLessThan(0.05);
      expect(Math.abs(datos[datos.length - 1]!)).toBeLessThan(0.001);
    }
  });

  it('cada tipo suena distinto: largo y forma de onda', () => {
    const normal = muestras('normal');
    const suave = muestras('suave');
    const seco = muestras('seco');
    expect(new Set([normal.length, suave.length, seco.length]).size).toBe(3);
    // Mismos primeros 20 ms, sin importar el largo: ninguno repite a otro.
    const prefijo = 882;
    const distancia = (a: Float32Array, b: Float32Array): number => {
      let suma = 0;
      for (let i = 0; i < prefijo; i++) suma += Math.abs(a[i]! - b[i]!);
      return suma;
    };
    expect(distancia(normal, suave)).toBeGreaterThan(1);
    expect(distancia(normal, seco)).toBeGreaterThan(1);
    expect(distancia(suave, seco)).toBeGreaterThan(1);
  });

  it('suave tiene el ataque mas lento y seco el mas corto', () => {
    // Muestras hasta llegar al 90 % del pico: mide cuanto tarda en "pegar".
    const muestrasAlPico = (datos: Float32Array): number => {
      let pico = 0;
      for (const m of datos) pico = Math.max(pico, Math.abs(m));
      return datos.findIndex((m) => Math.abs(m) >= 0.9 * pico);
    };
    expect(muestrasAlPico(muestras('suave'))).toBeGreaterThan(muestrasAlPico(muestras('seco')));
  });

  it('es deterministico: dos llamadas dan las mismas muestras', () => {
    for (const tipo of TIPOS_HITSOUND) {
      expect(Array.from(muestras(tipo))).toEqual(Array.from(muestras(tipo)));
    }
  });
});

describe('reproducirHitsound', () => {
  it('programa un source con el buffer en el instante pedido, sin leer ningun reloj', () => {
    const { ctx, sources, destination } = crearContextoFalso();
    const buffer = crearHitsound(ctx, 'normal');
    reproducirHitsound(ctx, buffer, 12.345);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.buffer).toBe(buffer);
    expect(sources[0]!.start).toHaveBeenCalledTimes(1);
    expect(sources[0]!.start).toHaveBeenCalledWith(12.345);
    // Sin destino explicito va directo a la salida.
    expect(sources[0]!.connect).toHaveBeenCalledTimes(1);
    expect(sources[0]!.connect).toHaveBeenCalledWith(destination);
  });

  it('devuelve el source programado, para enterarse de cuando termina', () => {
    const { ctx, sources } = crearContextoFalso();
    const source = reproducirHitsound(ctx, crearHitsound(ctx, 'normal'), 1);
    expect(source).toBe(sources[0]);
  });

  it('conecta al nodo de efectos cuando se lo dan', () => {
    const { ctx, sources } = crearContextoFalso();
    const efectos = { nombre: 'efectos' } as unknown as AudioNode;
    reproducirHitsound(ctx, crearHitsound(ctx, 'seco'), 1, efectos);
    expect(sources[0]!.connect).toHaveBeenCalledTimes(1);
    expect(sources[0]!.connect).toHaveBeenCalledWith(efectos);
  });

  it('no re-crea el buffer: cada golpe es un source nuevo sobre el mismo buffer', () => {
    const { ctx, raw, sources } = crearContextoFalso();
    const buffer = crearHitsound(ctx, 'suave');
    reproducirHitsound(ctx, buffer, 1);
    reproducirHitsound(ctx, buffer, 2);
    reproducirHitsound(ctx, buffer, 3);
    expect(raw.createBuffer).toHaveBeenCalledTimes(1);
    expect(sources.map((s) => s.buffer)).toEqual([buffer, buffer, buffer]);
  });

  it('un tiempo ya pasado se respeta (suena en el acto), uno negativo se lleva a 0', () => {
    const { ctx, sources } = crearContextoFalso();
    const buffer = crearHitsound(ctx, 'normal');
    reproducirHitsound(ctx, buffer, 0.5);
    reproducirHitsound(ctx, buffer, -0.02);
    expect(sources[0]!.start).toHaveBeenCalledWith(0.5);
    // start(negativo) lanza RangeError en Web Audio.
    expect(sources[1]!.start).toHaveBeenCalledWith(0);
  });
});
