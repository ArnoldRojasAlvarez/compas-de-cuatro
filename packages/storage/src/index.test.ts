// Tests de T-005 (API publica de @tetra/storage: importarOsz/listarMapas),
// actualizados por T-011 a la nueva forma (importarOsz/listarCanciones, ver
// "Parte A" del ticket): una cancion con todas sus dificultades, no una
// entrada por dificultad.
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
import { importarOsz, listarCanciones, importarOsk, listarSkins } from './index.js';

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

function armarOsk(entradas: Record<string, Uint8Array>): Blob {
  return new Blob([zipSync(entradas)], { type: 'application/zip' });
}

const PNG_1X1 = new Uint8Array([1, 2, 3]); // el contenido no importa: storage no decodifica imagenes (ver osk.test.ts)

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

const OSU_SEGUNDA_DIFICULTAD = OSU_DE_PRUEBA.replace('Version:Normal', 'Version:Hard');

describe('importarOsz + listarCanciones', () => {
  it('guarda la cancion y devuelve un id que despues aparece en listarCanciones', async () => {
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'audio.wav': new Uint8Array([9, 9, 9]),
    });

    const id = await importarOsz(osz);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const canciones = await listarCanciones();
    expect(canciones).toHaveLength(1);
    expect(canciones[0]!.id).toBe(id);
    expect(canciones[0]!.titulo).toBe('Cancion de prueba');
    expect(canciones[0]!.artista).toBe('Artista de prueba');
    expect(canciones[0]!.audio.size).toBe(3);
    expect(canciones[0]!.dificultades).toHaveLength(1);
    expect(canciones[0]!.dificultades[0]!.notes).toHaveLength(2);
  });

  it('un .osz con varias dificultades las guarda todas bajo una sola cancion', async () => {
    const osz = armarOsz({
      'Normal.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'Hard.osu': new TextEncoder().encode(OSU_SEGUNDA_DIFICULTAD),
      'audio.wav': new Uint8Array([1, 2, 3]),
    });

    const id = await importarOsz(osz);
    const canciones = await listarCanciones();
    expect(canciones).toHaveLength(1);

    const cancion = canciones[0]!;
    expect(cancion.id).toBe(id);
    // Las dos comparten el mismo audio (una sola cancion, ver el ticket,
    // "Parte A"): no queda duplicado por dificultad.
    expect(cancion.audio.size).toBe(3);
    expect(cancion.dificultades).toHaveLength(2);
    const nombres = cancion.dificultades.map((d) => d.metadata.difficultyName).sort();
    expect(nombres).toEqual(['Hard', 'Normal']);
  });

  it('una dificultad que no parsea (otro modo de juego) se salta y las demas se guardan igual', async () => {
    const osuDeOtroModo = OSU_DE_PRUEBA.replace('Mode: 3', 'Mode: 0').replace(
      'Version:Normal',
      'Version:Standard',
    );
    const osz = armarOsz({
      'Normal.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'Standard.osu': new TextEncoder().encode(osuDeOtroModo),
      'audio.wav': new Uint8Array([1]),
    });

    await importarOsz(osz);
    const canciones = await listarCanciones();
    expect(canciones).toHaveLength(1);
    expect(canciones[0]!.dificultades).toHaveLength(1);
    expect(canciones[0]!.dificultades[0]!.metadata.difficultyName).toBe('Normal');
  });

  it('dos importaciones seguidas quedan como dos canciones con ids distintos', async () => {
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'audio.wav': new Uint8Array([1]),
    });

    const id1 = await importarOsz(osz);
    const id2 = await importarOsz(osz);
    expect(id1).not.toBe(id2);

    const canciones = await listarCanciones();
    expect(canciones).toHaveLength(2);
    const ids = canciones.map((c) => c.id).sort();
    expect(ids).toEqual([id1, id2].sort());
  });

  it('listarCanciones con la base vacia devuelve un array vacio', async () => {
    expect(await listarCanciones()).toEqual([]);
  });

  it('un .osz invalido (sin .osu) rechaza la promesa y no guarda nada', async () => {
    const osz = armarOsz({ 'audio.wav': new Uint8Array([1]) });
    await expect(importarOsz(osz)).rejects.toThrow();
    expect(await listarCanciones()).toEqual([]);
  });
});

describe('con el .osz real del fixture de T-005', () => {
  it('importa fixtures/mania-test/mapa-de-prueba.osz de punta a punta', async () => {
    const ruta = join(__dirname, '..', '..', '..', 'fixtures', 'mania-test', 'mapa-de-prueba.osz');
    const bytes = readFileSync(ruta);
    const osz = new Blob([bytes], { type: 'application/zip' });

    const id = await importarOsz(osz);
    const canciones = await listarCanciones();
    expect(canciones).toHaveLength(1);

    const guardado = canciones[0]!;
    expect(guardado.id).toBe(id);
    expect(guardado.titulo).toBe('Mapa de prueba T-005');
    expect(guardado.dificultades).toHaveLength(1);
    const chart = guardado.dificultades[0]!;
    // Generado por tools/generar-fixture-mania-test.mjs: 20 notas, la
    // ultima es una hold de 5700 a 6300 ms (ver ese script).
    expect(chart.notes).toHaveLength(20);
    const ultima = chart.notes[19]!;
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

// T-009: mismo patron que arriba, para importarOsk/listarSkins.
describe('importarOsk + listarSkins', () => {
  it('guarda la skin y devuelve un id que despues aparece en listarSkins', async () => {
    const osk = armarOsk({
      'mania-note1.png': PNG_1X1,
      'mania-note2.png': PNG_1X1,
      'mania-key1.png': PNG_1X1,
      'mania-key2.png': PNG_1X1,
    });

    const id = await importarOsk(osk);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const skins = await listarSkins();
    expect(skins).toHaveLength(1);
    expect(skins[0]!.id).toBe(id);
    expect(skins[0]!.imagenes.note1).toBeInstanceOf(Blob);
    expect(skins[0]!.imagenes.note2).toBeInstanceOf(Blob);
    // No se pidieron los cuerpos/colas de LN en este .osk de prueba:
    // tienen que quedar ausentes, no inventados (ver el ticket, "Fallback").
    expect(skins[0]!.imagenes.note1H).toBeUndefined();
  });

  it('el nombre guardado sale de File.name cuando el archivo es un File de verdad', async () => {
    const osk = armarOsk({ 'mania-note1.png': PNG_1X1 });
    const archivo = new File([await osk.arrayBuffer()], 'Sad Cookie.osk', {
      type: 'application/zip',
    });

    await importarOsk(archivo);
    const skins = await listarSkins();
    expect(skins[0]!.nombre).toBe('Sad Cookie.osk');
  });

  it('dos importaciones seguidas quedan como dos skins con ids distintos', async () => {
    const osk = armarOsk({ 'mania-note1.png': PNG_1X1 });

    const id1 = await importarOsk(osk);
    const id2 = await importarOsk(osk);
    expect(id1).not.toBe(id2);

    const skins = await listarSkins();
    expect(skins).toHaveLength(2);
  });

  it('listarSkins con la base vacia devuelve un array vacio', async () => {
    expect(await listarSkins()).toEqual([]);
  });

  it('importar una skin no toca las canciones guardadas, y viceversa (tiendas separadas)', async () => {
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'audio.wav': new Uint8Array([1]),
    });
    const osk = armarOsk({ 'mania-note1.png': PNG_1X1 });

    await importarOsz(osz);
    await importarOsk(osk);

    expect(await listarCanciones()).toHaveLength(1);
    expect(await listarSkins()).toHaveLength(1);
  });

  it('un .osk invalido (sin ninguna imagen conocida) rechaza la promesa y no guarda nada', async () => {
    const osk = armarOsk({ 'skin.ini': new TextEncoder().encode('[General]\n') });
    await expect(importarOsk(osk)).rejects.toThrow();
    expect(await listarSkins()).toEqual([]);
  });
});

describe('con el .osk real del fixture de T-009', () => {
  it('importa fixtures/skin-test/skin-de-prueba.osk de punta a punta', async () => {
    const ruta = join(__dirname, '..', '..', '..', 'fixtures', 'skin-test', 'skin-de-prueba.osk');
    const bytes = readFileSync(ruta);
    const osk = new Blob([bytes], { type: 'application/zip' });

    const id = await importarOsk(osk);
    const skins = await listarSkins();
    expect(skins).toHaveLength(1);

    const guardado = skins[0]!;
    expect(guardado.id).toBe(id);
    // Generado por tools/generar-fixture-skin-test.mjs: las 10 imagenes
    // presentes, todas PNG de 1x1 (ver ese script).
    const claves = [
      'note1',
      'note2',
      'note1H',
      'note2H',
      'note1L',
      'note2L',
      'key1',
      'key2',
      'key1D',
      'key2D',
    ] as const;
    for (const clave of claves) {
      const blob = guardado.imagenes[clave];
      expect(blob).toBeInstanceOf(Blob);
      expect(blob?.type).toBe('image/png');
      expect(blob?.size).toBeGreaterThan(0);
    }
  });
});
