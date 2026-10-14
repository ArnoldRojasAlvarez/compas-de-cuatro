// Tests de T-066 (paso 3, D8 y D11): de donde sale el AudioBuffer de una
// dificultad, la cache de una entrada y la cancelacion del render. Vitest corre
// en node: el contexto es un doble con sampleRate 1000 y las canciones salen de
// una base fake-indexeddb, importadas de verdad desde un .osz sintetico.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { importarArchivoOsz, listarCanciones, type CancionGuardada } from '@tetra/storage';
import {
  RenderCancelado,
  audioListoSinRenderizar,
  cederAlNavegador,
  obtenerAudioDeDificultad,
  olvidarAudioRenderizado,
} from './audio-de-cancion.js';

async function vaciarBase(): Promise<void> {
  for (const base of await indexedDB.databases()) {
    if (base.name === undefined) continue;
    await new Promise<void>((resolve, reject) => {
      const peticion = indexedDB.deleteDatabase(base.name!);
      peticion.onsuccess = () => resolve();
      peticion.onerror = () => reject(peticion.error);
    });
  }
}

beforeEach(async () => {
  olvidarAudioRenderizado();
  await vaciarBase();
});

function osuVirtual(version: string, notas: string[]): string {
  return [
    'osu file format v14',
    '',
    '[General]',
    'AudioFilename: virtual',
    'Mode: 3',
    '',
    '[Metadata]',
    'Title:Set',
    'Artist:Autor',
    'Creator:Alguien',
    `Version:${version}`,
    '',
    '[Difficulty]',
    'HPDrainRate:5',
    'CircleSize:4',
    'OverallDifficulty:7',
    '',
    '[TimingPoints]',
    '0,500,4,1,0,100,1,0',
    '',
    '[HitObjects]',
    ...notas,
    '',
  ].join('\n');
}

/** Un set virtual de dos piezas: cada una con un tap de keysound en 10 ms y otro en 20 ms. */
async function importarSet(): Promise<CancionGuardada[]> {
  const zip = zipSync({
    'a.osu': strToU8(osuVirtual('Uno - 4K', ['64,192,10,1,0,0:0:0:100:m.ogg', '192,192,20,1,0,0:0:0:100:m.ogg'])),
    'b.osu': strToU8(osuVirtual('Dos - 4K', ['64,192,10,1,0,0:0:0:100:m.ogg'])),
    'm.ogg': new Uint8Array([50]),
  });
  await importarArchivoOsz(new File([new Uint8Array(zip)], 'set.osz'));
  return (await listarCanciones()).sort((x, y) => y.titulo.localeCompare(x.titulo)); // Uno, Dos
}

function crearContextoFalso(sampleRate = 1000) {
  const decodificar = vi.fn(async (bytes: ArrayBuffer) => {
    const datos = new Uint8Array(bytes);
    const canal = Float32Array.from(datos, (b) => b / 100);
    return { numberOfChannels: 1, length: canal.length, getChannelData: () => canal };
  });
  const crear = vi.fn((canales: number, largo: number, sr: number) => {
    const datos = Array.from({ length: canales }, () => new Float32Array(largo));
    return {
      numberOfChannels: canales,
      length: largo,
      sampleRate: sr,
      duration: largo / sr,
      getChannelData: (c: number) => datos[c]!,
    };
  });
  const ctx = { sampleRate, createBuffer: crear, decodeAudioData: decodificar };
  return { ctx: ctx as unknown as BaseAudioContext, crear, decodificar };
}

describe('obtenerAudioDeDificultad: cancion virtual', () => {
  it('renderiza la receta de la dificultad: la muestra cae en el tiempo de cada nota', async () => {
    const [uno] = await importarSet();
    const { ctx } = crearContextoFalso();
    const buffer = await obtenerAudioDeDificultad(uno!, uno!.dificultades[0]!, ctx);
    const izq = buffer.getChannelData(0);
    expect(izq[10]).toBeCloseTo(0.5, 6);
    expect(izq[20]).toBeCloseTo(0.5, 6);
    expect(izq[15]).toBe(0);
  });

  it('el preview y "Jugar" no renderizan dos veces la misma dificultad', async () => {
    const [uno] = await importarSet();
    const { ctx, crear } = crearContextoFalso();
    const chart = uno!.dificultades[0]!;
    const preview = obtenerAudioDeDificultad(uno!, chart, ctx);
    expect(audioListoSinRenderizar(uno!, chart, 1000)).toBe(true); // ya hay un render en curso
    const jugar = obtenerAudioDeDificultad(uno!, chart, ctx);
    expect(await jugar).toBe(await preview);
    // y despues de terminado, un tercer pedido tambien sale de la cache
    expect(await obtenerAudioDeDificultad(uno!, chart, ctx)).toBe(await preview);
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('otra dificultad, otra cancion u otro sampleRate renderizan de nuevo (una sola entrada)', async () => {
    const [uno, dos] = await importarSet();
    const { ctx, crear } = crearContextoFalso();
    const a = await obtenerAudioDeDificultad(uno!, uno!.dificultades[0]!, ctx);
    const b = await obtenerAudioDeDificultad(dos!, dos!.dificultades[0]!, ctx);
    expect(b).not.toBe(a);
    expect(crear).toHaveBeenCalledTimes(2);
    // la entrada anterior ya no esta: volver a la primera renderiza otra vez
    await obtenerAudioDeDificultad(uno!, uno!.dificultades[0]!, ctx);
    expect(crear).toHaveBeenCalledTimes(3);
    // y con otro sampleRate tambien
    const otro = crearContextoFalso(2000);
    await obtenerAudioDeDificultad(uno!, uno!.dificultades[0]!, otro.ctx);
    expect(otro.crear).toHaveBeenCalledTimes(1);
  });

  it('un pedido cancelado rechaza con RenderCancelado y no queda en la cache', async () => {
    const [uno] = await importarSet();
    const { ctx, crear } = crearContextoFalso();
    const chart = uno!.dificultades[0]!;
    await expect(
      obtenerAudioDeDificultad(uno!, chart, ctx, { cancelado: () => true }),
    ).rejects.toBeInstanceOf(RenderCancelado);
    expect(audioListoSinRenderizar(uno!, chart, 1000)).toBe(false);
    await expect(obtenerAudioDeDificultad(uno!, chart, ctx)).resolves.toBeDefined();
    expect(crear.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('si el preview se cancela pero "Jugar" sigue esperando, el render termina', async () => {
    const [uno] = await importarSet();
    const { ctx } = crearContextoFalso();
    const chart = uno!.dificultades[0]!;
    const preview = obtenerAudioDeDificultad(uno!, chart, ctx, { cancelado: () => true });
    const jugar = obtenerAudioDeDificultad(uno!, chart, ctx);
    const [buffer] = await Promise.all([jugar, preview]);
    expect(buffer.getChannelData(0)[10]).toBeCloseTo(0.5, 6);
  });
});

describe('obtenerAudioDeDificultad: cancion con pista', () => {
  it('decodifica la pista y no usa la cache del render', async () => {
    const cancion = {
      id: 'real',
      titulo: 'Real',
      artista: 'x',
      audio: new Blob([new Uint8Array([1, 2, 3])]),
      dificultades: [],
    } satisfies CancionGuardada;
    const { ctx, decodificar, crear } = crearContextoFalso();
    const chart = (await importarSet())[0]!.dificultades[0]!;
    const buffer = await obtenerAudioDeDificultad(cancion, chart, ctx);
    expect(decodificar).toHaveBeenCalledTimes(1);
    expect(crear).not.toHaveBeenCalled();
    expect(buffer.getChannelData(0)).toHaveLength(3);
    expect(audioListoSinRenderizar(cancion, chart, 1000)).toBe(true);
  });

  it('una cancion sin pista ni sonidos rechaza con un mensaje claro', async () => {
    const vacia = { id: 'x', titulo: 'x', artista: 'x', dificultades: [] } satisfies CancionGuardada;
    const { ctx } = crearContextoFalso();
    const chart = (await importarSet())[0]!.dificultades[0]!;
    await expect(obtenerAudioDeDificultad(vacia, chart, ctx)).rejects.toThrow('no tiene audio');
  });
});

describe('cederAlNavegador', () => {
  it('resuelve despues de dejar pasar una tarea', async () => {
    const orden: string[] = [];
    const cedida = cederAlNavegador().then(() => orden.push('cedida'));
    orden.push('sincrono');
    await cedida;
    expect(orden).toEqual(['sincrono', 'cedida']);
  });
});
