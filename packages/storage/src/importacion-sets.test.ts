// Tests de T-066 (paso 2) contra IndexedDB (fake-indexeddb): un .osz con dos
// pistas da dos canciones, reimportarlo no duplica ninguna, y un grupo sin
// audio no tumba al otro.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import {
  ErrorDeImportacion,
  fusionarDuplicados,
  importarArchivoOsz,
  importarOsz,
  listarCanciones,
} from './index.js';

beforeEach(async () => {
  for (const base of await indexedDB.databases()) {
    if (base.name === undefined) continue;
    await new Promise<void>((resolve, reject) => {
      const peticion = indexedDB.deleteDatabase(base.name!);
      peticion.onsuccess = () => resolve();
      peticion.onerror = () => reject(peticion.error);
    });
  }
});

const NOTAS_UNO = ['64,192,0,1,0,0:0:0:0:', '192,192,500,1,0,0:0:0:0:'];
const NOTAS_UNO_HARD = [
  '64,192,0,1,0,0:0:0:0:',
  '320,192,500,1,0,0:0:0:0:',
  '448,192,900,1,0,0:0:0:0:',
];
const NOTAS_DOS = ['448,192,0,1,0,0:0:0:0:', '320,192,250,1,0,0:0:0:0:'];

function osu(version: string, audio: string, notas: string[]): string {
  return `osu file format v14

[General]
AudioFilename: ${audio}
Mode: 3

[Metadata]
Title:Set de dos pistas
Artist:Artista
Creator:Arnold
Version:${version}

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:6

[TimingPoints]
0,500,4,2,1,50,1,0

[HitObjects]
${notas.join('\n')}
`;
}

function oszDeDosPistas(opciones: { sinSegundaPista?: boolean } = {}): Blob {
  const entradas: Record<string, Uint8Array> = {
    'a-uno-easy.osu': new TextEncoder().encode(osu('Easy', 'uno.mp3', NOTAS_UNO)),
    'b-uno-hard.osu': new TextEncoder().encode(osu('Hard', 'uno.mp3', NOTAS_UNO_HARD)),
    'c-dos.osu': new TextEncoder().encode(osu('Unica', 'dos.ogg', NOTAS_DOS)),
    'uno.mp3': new Uint8Array([1]),
  };
  if (opciones.sinSegundaPista !== true) entradas['dos.ogg'] = new Uint8Array([2, 2]);
  return new Blob([new Uint8Array(zipSync(entradas))]);
}

describe('importarArchivoOsz: un .osz con dos pistas (T-066 paso 2)', () => {
  it('da dos canciones, cada una con su audio y sus dificultades', async () => {
    const r = await importarArchivoOsz(oszDeDosPistas());
    expect(r.canciones).toHaveLength(2);
    expect(r.canciones.map((c) => c.estado)).toEqual(['nueva', 'nueva']);
    expect(r.canciones.map((c) => c.titulo)).toEqual([
      'Set de dos pistas (uno)',
      'Set de dos pistas (dos)',
    ]);
    expect(r.titulo).toBe('Set de dos pistas');

    const guardadas = await listarCanciones();
    expect(guardadas).toHaveLength(2);
    const porId = new Map(guardadas.map((c) => [c.id, c]));
    const uno = porId.get(r.canciones[0]!.id)!;
    const dos = porId.get(r.canciones[1]!.id)!;
    expect(uno.audio!.size).toBe(1);
    expect(uno.dificultades.map((d) => d.metadata.difficultyName)).toEqual(['Easy', 'Hard']);
    expect(dos.audio!.size).toBe(2);
    expect(dos.dificultades.map((d) => d.metadata.difficultyName)).toEqual(['Unica']);
    expect(uno.conjunto).toBeUndefined();
  });

  it('reimportarlo da ya-estaba en las dos y no duplica ninguna', async () => {
    const primera = await importarArchivoOsz(oszDeDosPistas());
    const segunda = await importarArchivoOsz(oszDeDosPistas());
    expect(segunda.canciones.map((c) => c.estado)).toEqual(['ya-estaba', 'ya-estaba']);
    expect(segunda.canciones.map((c) => c.id)).toEqual(primera.canciones.map((c) => c.id));
    expect(await listarCanciones()).toHaveLength(2);
    // Y la fusion de duplicados al arrancar no encuentra nada que hacer.
    expect(await fusionarDuplicados()).toEqual([]);
    expect(await listarCanciones()).toHaveLength(2);
  });

  it('un grupo sin audio da aviso y el otro entra; reimportar completo despues agrega el faltante', async () => {
    const r = await importarArchivoOsz(oszDeDosPistas({ sinSegundaPista: true }));
    expect(r.canciones).toHaveLength(1);
    expect(r.avisos).toEqual(['Se omitió "Set de dos pistas (dos)": falta el audio "dos.ogg".']);
    expect(await listarCanciones()).toHaveLength(1);

    const completo = await importarArchivoOsz(oszDeDosPistas());
    expect(completo.canciones.map((c) => c.estado)).toEqual(['ya-estaba', 'nueva']);
    expect(await listarCanciones()).toHaveLength(2);
  });

  it('si ningun grupo tiene audio, lanza audio-faltante y no guarda nada', async () => {
    const entradas = {
      'a.osu': new TextEncoder().encode(osu('A', 'uno.mp3', NOTAS_UNO)),
      'b.osu': new TextEncoder().encode(osu('B', 'dos.ogg', NOTAS_DOS)),
    };
    const archivo = new Blob([new Uint8Array(zipSync(entradas))]);
    const error = await importarArchivoOsz(archivo).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorDeImportacion);
    expect((error as ErrorDeImportacion).codigo).toBe('audio-faltante');
    expect(await listarCanciones()).toHaveLength(0);
  });

  it('importarOsz devuelve el id de la primera cancion del set', async () => {
    const id = await importarOsz(oszDeDosPistas());
    const guardadas = await listarCanciones();
    expect(guardadas).toHaveLength(2);
    expect(guardadas.find((c) => c.id === id)!.titulo).toBe('Set de dos pistas (uno)');
  });
});
