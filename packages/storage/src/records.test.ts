// Tests de T-055 para los records (guardarPartida / leerRecords, ver
// index.ts y db.ts) y la migracion no destructiva de VERSION_BASE 4 a 5.
// fake-indexeddb, mismo patron que index.test.ts.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { hashMapa } from '@tetra/core';
import type { Judgement, PartidaJugada } from '@tetra/core';
import {
  borrarCancion,
  guardarPartida,
  importarOsz,
  leerRecords,
  listarCanciones,
} from './index.js';
import { guardarCancion } from './db.js';

const NOMBRE_BASE = 'tetra-mapas';

beforeEach(async () => {
  const bases = await indexedDB.databases();
  for (const base of bases) {
    if (base.name !== undefined) indexedDB.deleteDatabase(base.name);
  }
});

function osu(version: string, notas: string[]): string {
  return `osu file format v14

[General]
AudioFilename: audio.wav
Mode: 3

[Metadata]
Title:Cancion de records
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

const NOTAS_A = ['64,192,0,1,0,0:0:0:0:', '192,192,500,1,0,0:0:0:0:'];
const NOTAS_B = ['64,192,0,1,0,0:0:0:0:', '320,192,500,1,0,0:0:0:0:', '448,192,1000,1,0,0:0:0:0:'];

/** Importa una cancion con una dificultad por cada lista de notas y devuelve su id y los hashes de las dificultades. */
async function importar(...dificultades: string[][]): Promise<{ id: string; hashes: string[] }> {
  const entradas: Record<string, Uint8Array> = { 'audio.wav': new Uint8Array([1]) };
  dificultades.forEach((notas, i) => {
    entradas[`d${i}.osu`] = new TextEncoder().encode(osu(`Dif${i}`, notas));
  });
  const id = await importarOsz(new Blob([zipSync(entradas)]));
  const cancion = (await listarCanciones()).find((c) => c.id === id)!;
  return { id, hashes: cancion.dificultades.map((d) => String(hashMapa(d))) };
}

/**
 * T-066: importar dos veces ya no duplica, asi que para probar que borrar una
 * cancion respeta lo que comparte con otra se escribe la copia directo en la
 * base (como queda, por ejemplo, tras restaurar un respaldo antes de fusionar).
 */
async function duplicarEnLaBase(id: string): Promise<string> {
  const original = (await listarCanciones()).find((c) => c.id === id)!;
  const copia = { ...original, id: `${id}-copia` };
  await guardarCancion(copia);
  return copia.id;
}

function conteos(valores: Partial<Record<Judgement, number>> = {}): Record<Judgement, number> {
  return { max: 0, perfect: 0, great: 0, good: 0, bad: 0, miss: 0, ...valores };
}

function partida(score: number, extra: Partial<PartidaJugada> = {}): PartidaJugada {
  return {
    score,
    accuracy: score / 1_000_000,
    maxCombo: 5,
    counts: conteos({ max: 3, miss: 1 }),
    rango: 'B',
    fecha: '2026-10-05T12:00:00.000Z',
    ...extra,
  };
}

/** Escribe un valor crudo en la tienda 'records', saltandose toda validacion. */
async function ponerCrudo(valor: unknown): Promise<void> {
  // Abrir la base con el codigo real primero: la crea (o migra) con todas sus tiendas.
  await listarCanciones();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const peticion = indexedDB.open(NOMBRE_BASE);
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').put(valor);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('guardarPartida / leerRecords', () => {
  it('la primera partida es record sin anterior', async () => {
    const { hashes } = await importar(NOTAS_A);
    const r = await guardarPartida(hashes[0]!, partida(500_000));
    expect(r.esMejor).toBe(true);
    expect(r.anterior).toBeUndefined();
    expect(r.record.intentos).toBe(1);
  });

  it('dos partidas: conserva la mejor, guarda la ultima y cuenta 2 intentos', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    const buena = partida(800_000, { maxCombo: 40 });
    const mala = partida(300_000, { maxCombo: 7 });
    await guardarPartida(hash, buena);
    const segunda = await guardarPartida(hash, mala);

    // Una implementacion que siempre reemplaza por la ultima falla aca.
    expect(segunda.esMejor).toBe(false);
    expect(segunda.anterior).toEqual(buena);

    const leido = (await leerRecords([hash])).get(hash)!;
    expect(leido.mejor).toEqual(buena);
    expect(leido.ultima).toEqual(mala);
    expect(leido.intentos).toBe(2);
  });

  it('una partida mejor avisa esMejor con el anterior para calcular la diferencia', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    await guardarPartida(hash, partida(500_000));
    const r = await guardarPartida(hash, partida(512_340));
    expect(r.esMejor).toBe(true);
    expect(r.anterior?.score).toBe(500_000);
    expect(r.record.mejor.score - r.anterior!.score).toBe(12_340);
  });

  it('los conteos guardados son los mismos que se leen (ida y vuelta completa)', async () => {
    const { hashes } = await importar(NOTAS_A);
    const p = partida(700_000, {
      counts: conteos({ max: 812, perfect: 140, great: 12, good: 3, bad: 0, miss: 2 }),
      rango: 'SS',
      desviacionMedia: -3.5,
      pulsaciones: [10, 20, 30, 40],
    });
    await guardarPartida(hashes[0]!, p);
    const leido = (await leerRecords(hashes)).get(hashes[0]!)!;
    expect(leido.mejor).toEqual(p);
  });

  it('lee muchos de una vez y omite los hashes sin record', async () => {
    const { hashes } = await importar(NOTAS_A, NOTAS_B);
    expect(hashes[0]).not.toBe(hashes[1]);
    await guardarPartida(hashes[0]!, partida(100_000));
    await guardarPartida(hashes[1]!, partida(200_000));
    const leidos = await leerRecords([hashes[0]!, hashes[1]!, 'inexistente']);
    expect(leidos.size).toBe(2);
    expect(leidos.get(hashes[0]!)!.mejor.score).toBe(100_000);
    expect(leidos.get(hashes[1]!)!.mejor.score).toBe(200_000);
    expect((await leerRecords([])).size).toBe(0);
  });

  it('cada dificultad lleva su propio record', async () => {
    const { hashes } = await importar(NOTAS_A, NOTAS_B);
    await guardarPartida(hashes[0]!, partida(900_000));
    await guardarPartida(hashes[1]!, partida(100_000));
    const leidos = await leerRecords(hashes);
    expect(leidos.get(hashes[0]!)!.intentos).toBe(1);
    expect(leidos.get(hashes[1]!)!.mejor.score).toBe(100_000);
  });
});

describe('borrarCancion y records', () => {
  it('borrar una cancion borra los records de todas sus dificultades, no los de otras', async () => {
    const borrada = await importar(NOTAS_A, NOTAS_B);
    const otra = await importar(['64,192,0,1,0,0:0:0:0:', '64,192,250,1,0,0:0:0:0:']);
    for (const h of [...borrada.hashes, ...otra.hashes]) await guardarPartida(h, partida(400_000));

    await borrarCancion(borrada.id);

    const leidos = await leerRecords([...borrada.hashes, ...otra.hashes]);
    expect([...leidos.keys()]).toEqual(otra.hashes);
  });

  it('si otra cancion tiene el mismo mapa (copia de la misma cancion), su record se conserva', async () => {
    const primera = await importar(NOTAS_A);
    const copiaId = await duplicarEnLaBase(primera.id);
    await guardarPartida(primera.hashes[0]!, partida(400_000));

    await borrarCancion(primera.id);
    expect((await leerRecords(primera.hashes)).size).toBe(1);

    await borrarCancion(copiaId);
    expect((await leerRecords(primera.hashes)).size).toBe(0);
  });

  it('borrar un id inexistente no falla ni toca records', async () => {
    const { hashes } = await importar(NOTAS_A);
    await guardarPartida(hashes[0]!, partida(400_000));
    await borrarCancion('no-existe');
    expect((await leerRecords(hashes)).size).toBe(1);
  });
});

describe('registros corruptos', () => {
  it('se ignoran al leer y no tumban a los buenos', async () => {
    const { hashes } = await importar(NOTAS_A, NOTAS_B);
    await guardarPartida(hashes[0]!, partida(400_000));
    await ponerCrudo({ hash: hashes[1]!, intentos: 3 }); // sin `mejor`
    await ponerCrudo({ hash: 'raro', mejor: 'texto', ultima: null, intentos: 'x' });
    await ponerCrudo({
      hash: 'conteos-rotos',
      mejor: { ...partida(1), counts: { max: 'diez' } },
      ultima: partida(1),
      intentos: 1,
    });

    const leidos = await leerRecords([hashes[0]!, hashes[1]!, 'raro', 'conteos-rotos']);
    expect([...leidos.keys()]).toEqual([hashes[0]]);
  });

  it('un record con `mejor` valido pero ultima e intentos rotos se rescata', async () => {
    await ponerCrudo({ hash: 'medio', mejor: partida(300_000), ultima: 5, intentos: -2 });
    const r = (await leerRecords(['medio'])).get('medio')!;
    expect(r.mejor.score).toBe(300_000);
    expect(r.ultima).toEqual(r.mejor);
    expect(r.intentos).toBe(1);
  });

  it('guardar sobre un registro corrupto lo reemplaza como si fuera el primero', async () => {
    const { hashes } = await importar(NOTAS_A);
    await ponerCrudo({ hash: hashes[0]!, mejor: null });
    const r = await guardarPartida(hashes[0]!, partida(250_000));
    expect(r.anterior).toBeUndefined();
    expect(r.record.intentos).toBe(1);
  });
});

describe('migracion no destructiva a VERSION_BASE 5 (tienda "records")', () => {
  it('una base en version 4 conserva sus canciones y gana la tienda de records', async () => {
    await new Promise<void>((resolve, reject) => {
      const peticion = indexedDB.open(NOMBRE_BASE, 4);
      peticion.onupgradeneeded = () => {
        const db = peticion.result;
        db.createObjectStore('mapas', { keyPath: 'id' });
        db.createObjectStore('skins', { keyPath: 'id' });
        db.createObjectStore('canciones', { keyPath: 'id' });
        db.createObjectStore('dificultades', { keyPath: 'clave' });
      };
      peticion.onsuccess = () => {
        const db = peticion.result;
        const tx = db.transaction('canciones', 'readwrite');
        tx.objectStore('canciones').put({
          id: 'cancion-v4',
          titulo: 'Cancion de la version 4',
          artista: 'Artista viejo',
          audio: new Blob([new Uint8Array([1, 2, 3])]),
          dificultades: [],
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      peticion.onerror = () => reject(peticion.error);
    });

    const canciones = await listarCanciones();
    expect(canciones.map((c) => c.id)).toEqual(['cancion-v4']);

    const r = await guardarPartida('hash-nuevo', partida(123_456));
    expect(r.record.intentos).toBe(1);
    expect((await leerRecords(['hash-nuevo'])).get('hash-nuevo')!.mejor.score).toBe(123_456);
    // Borrar la cancion vieja (sin dificultades) tampoco falla con la tienda nueva.
    await borrarCancion('cancion-v4');
    expect(await listarCanciones()).toHaveLength(0);
  });
});
