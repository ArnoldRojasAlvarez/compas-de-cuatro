// Tests de T-005 (API publica de @tetra/storage: importarOsz/listarMapas).
//
// vitest corre en entorno node (ver vitest.config.ts), que no trae
// IndexedDB: se usa fake-indexeddb (ver el ticket, "Para la capa de
// IndexedDB, si se testea, va con Playwright o con un fake de IndexedDB,
// no en core") para probar el guardado y la lectura de verdad, sin
// necesidad de un navegador.
//
// El ultimo bloque usa el .osz real y committeado en
// fixtures/mania-test/mapa-de-prueba.osz (generado por
// tools/generar-fixture-mania-test.mjs): es la prueba mas cercana a "un
// .osz real importado" que se puede hacer sin un navegador (ver el reporte
// de T-005 sobre que falta para el criterio completo de "jugable").

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { importarOsz, listarMapas } from './index.js';

const OSU_DE_PRUEBA = `osu file format v14

[General]
AudioFilename: audio.wav
Mode: 3

[Metadata]
Title:Cancion de prueba
Artist:Artista de prueba
Creator:Arnold
Version:Normal

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:6

[TimingPoints]
0,500,4,2,1,50,1,0

[HitObjects]
64,192,0,1,0,0:0:0:0:
192,192,500,1,0,0:0:0:0:
`;

function armarOsz(entradas: Record<string, Uint8Array>): Blob {
  return new Blob([zipSync(entradas)], { type: 'application/zip' });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

beforeEach(async () => {
  // fake-indexeddb no borra su estado solo entre tests: se limpia a mano
  // para que cada test arranque con la base vacia, indexedDB.databases()
  // existe en fake-indexeddb aunque en navegadores reales su soporte es
  // mas nuevo.
  const bases = await indexedDB.databases();
  for (const base of bases) {
    if (base.name !== undefined) {
      indexedDB.deleteDatabase(base.name);
    }
  }
});

describe('importarOsz + listarMapas', () => {
  it('guarda el mapa y devuelve un id que despues aparece en listarMapas', async () => {
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'audio.wav': new Uint8Array([9, 9, 9]),
    });

    const id = await importarOsz(osz);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const mapas = await listarMapas();
    expect(mapas).toHaveLength(1);
    expect(mapas[0]!.id).toBe(id);
    expect(mapas[0]!.chart.metadata.title).toBe('Cancion de prueba');
    expect(mapas[0]!.chart.notes).toHaveLength(2);
    expect(mapas[0]!.audio.size).toBe(3);
  });

  it('dos importaciones seguidas quedan como dos mapas con ids distintos', async () => {
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'audio.wav': new Uint8Array([1]),
    });

    const id1 = await importarOsz(osz);
    const id2 = await importarOsz(osz);
    expect(id1).not.toBe(id2);

    const mapas = await listarMapas();
    expect(mapas).toHaveLength(2);
    const ids = mapas.map((m) => m.id).sort();
    expect(ids).toEqual([id1, id2].sort());
  });

  it('listarMapas con la base vacia devuelve un array vacio', async () => {
    expect(await listarMapas()).toEqual([]);
  });

  it('un .osz invalido (sin .osu) rechaza la promesa y no guarda nada', async () => {
    const osz = armarOsz({ 'audio.wav': new Uint8Array([1]) });
    await expect(importarOsz(osz)).rejects.toThrow();
    expect(await listarMapas()).toEqual([]);
  });
});

describe('con el .osz real del fixture de T-005', () => {
  it('importa fixtures/mania-test/mapa-de-prueba.osz de punta a punta', async () => {
    const ruta = join(__dirname, '..', '..', '..', 'fixtures', 'mania-test', 'mapa-de-prueba.osz');
    const bytes = readFileSync(ruta);
    const osz = new Blob([bytes], { type: 'application/zip' });

    const id = await importarOsz(osz);
    const mapas = await listarMapas();
    expect(mapas).toHaveLength(1);

    const guardado = mapas[0]!;
    expect(guardado.id).toBe(id);
    expect(guardado.chart.metadata.title).toBe('Mapa de prueba T-005');
    // Generado por tools/generar-fixture-mania-test.mjs: 20 notas, la
    // ultima es una hold de 5700 a 6300 ms (ver ese script).
    expect(guardado.chart.notes).toHaveLength(20);
    const ultima = guardado.chart.notes[19]!;
    expect(ultima.kind).toBe('hold');
    if (ultima.kind === 'hold') {
      expect(ultima.time).toBe(5700);
      expect(ultima.endTime).toBe(6300);
    }
    // El audio del fixture es un WAV de 7 segundos: tiene que haber
    // quedado guardado como Blob, no como texto ni vacio.
    expect(guardado.audio.type).toBe('audio/wav');
    expect(guardado.audio.size).toBeGreaterThan(44); // mas que solo el header WAV
  });
});
