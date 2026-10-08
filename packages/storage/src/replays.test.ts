// Tests de T-044 para los replays guardados (tienda 'replays', VERSION_BASE 6):
// guardarPartida con replay, lectura, borrado con la cancion, migracion no
// destructiva desde la version 5 y el respaldo. fake-indexeddb, mismo patron
// que records.test.ts.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { hashMapa, serializarReplay } from '@tetra/core';
import type { Judgement, PartidaJugada, Replay } from '@tetra/core';
import {
  borrarCancion,
  crearRespaldo,
  guardarPartida,
  hashesConReplay,
  importarOsz,
  leerRecords,
  leerReplayGuardado,
  leerRespaldo,
  listarCanciones,
  restaurarRespaldo,
} from './index.js';

const NOMBRE_BASE = 'tetra-mapas';

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

beforeEach(vaciarBase);

function osu(version: string, notas: string[]): string {
  return `osu file format v14

[General]
AudioFilename: audio.wav
Mode: 3

[Metadata]
Title:Cancion de replays
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

async function importar(...dificultades: string[][]): Promise<{ id: string; hashes: string[] }> {
  const entradas: Record<string, Uint8Array> = { 'audio.wav': new Uint8Array([1]) };
  dificultades.forEach((notas, i) => {
    entradas[`d${i}.osu`] = strToU8(osu(`Dif${i}`, notas));
  });
  const id = await importarOsz(new Blob([new Uint8Array(zipSync(entradas))]));
  const cancion = (await listarCanciones()).find((c) => c.id === id)!;
  return { id, hashes: cancion.dificultades.map((d) => String(hashMapa(d))) };
}

function conteos(valores: Partial<Record<Judgement, number>> = {}): Record<Judgement, number> {
  return { max: 0, perfect: 0, great: 0, good: 0, bad: 0, miss: 0, ...valores };
}

function partida(score: number, fecha: string): PartidaJugada {
  return {
    score,
    accuracy: score / 1_000_000,
    maxCombo: 5,
    counts: conteos({ max: 3, miss: 1 }),
    rango: 'B',
    fecha,
  };
}

/** Un replay distinguible por `marca` (el tiempo del primer evento, con decimales). */
function replayDe(hash: string, marca: number): Replay {
  return {
    version: 1,
    hashMapa: hash,
    offsetUsuario: -3.5,
    eventos: [
      { time: marca + 0.125, column: 0, tipo: 'down' },
      { time: marca + 40.5, column: 0, tipo: 'up' },
      { time: marca + 500, column: 2, tipo: 'down' },
    ],
  };
}

const FECHA_1 = '2026-10-01T10:00:00.000Z';
const FECHA_2 = '2026-10-02T10:00:00.000Z';
const FECHA_3 = '2026-10-03T10:00:00.000Z';

/** Escribe un valor crudo en la tienda 'replays', saltandose toda validacion. */
async function ponerReplayCrudo(valor: unknown): Promise<void> {
  await listarCanciones(); // crea o migra la base con el codigo real
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const peticion = indexedDB.open(NOMBRE_BASE);
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('replays', 'readwrite');
    tx.objectStore('replays').put(valor);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('guardarPartida con replay', () => {
  it('la primera partida guarda su replay, igual que se grabo (decimales incluidos)', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    const replay = replayDe(hash, 1000);
    await guardarPartida(hash, partida(500_000, FECHA_1), replay);
    const leido = await leerReplayGuardado(hash);
    expect(leido?.replay).toEqual(replay);
    expect(leido?.fecha).toBe(FECHA_1);
  });

  it('sin replay guardado, leerReplayGuardado da undefined', async () => {
    const { hashes } = await importar(NOTAS_A);
    await guardarPartida(hashes[0]!, partida(500_000, FECHA_1));
    expect(await leerReplayGuardado(hashes[0]!)).toBeUndefined();
    expect(await leerReplayGuardado('inexistente')).toBeUndefined();
  });

  // Una implementacion que guarde siempre el replay de la ultima partida (sin
  // mirar esMejor) falla aca: el replay de la peor pisaria al de la mejor.
  it('una partida peor NO reemplaza el replay; una mejor SI', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    const buena = replayDe(hash, 1000);
    const mala = replayDe(hash, 2000);
    const mejor = replayDe(hash, 3000);

    await guardarPartida(hash, partida(800_000, FECHA_1), buena);
    const peor = await guardarPartida(hash, partida(300_000, FECHA_2), mala);
    expect(peor.esMejor).toBe(false);
    expect((await leerReplayGuardado(hash))?.replay).toEqual(buena);
    expect((await leerReplayGuardado(hash))?.fecha).toBe(FECHA_1);

    const nueva = await guardarPartida(hash, partida(900_000, FECHA_3), mejor);
    expect(nueva.esMejor).toBe(true);
    expect((await leerReplayGuardado(hash))?.replay).toEqual(mejor);
    expect((await leerReplayGuardado(hash))?.fecha).toBe(FECHA_3);

    // Y el record sigue dando 3 intentos con la mejor de ellas.
    const record = (await leerRecords([hash])).get(hash)!;
    expect(record.intentos).toBe(3);
    expect(record.mejor.fecha).toBe(FECHA_3);
  });

  it('una partida peor sin replay tampoco toca el guardado', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    await guardarPartida(hash, partida(800_000, FECHA_1), replayDe(hash, 1000));
    await guardarPartida(hash, partida(100_000, FECHA_2));
    expect((await leerReplayGuardado(hash))?.replay.eventos[0]?.time).toBe(1000.125);
  });

  it('una nueva mejor SIN replay borra el viejo: ya no es el de la mejor partida', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    await guardarPartida(hash, partida(500_000, FECHA_1), replayDe(hash, 1000));
    await guardarPartida(hash, partida(700_000, FECHA_2));
    expect(await leerReplayGuardado(hash)).toBeUndefined();
    expect((await hashesConReplay()).has(hash)).toBe(false);
  });

  it('cada dificultad lleva su replay, y hashesConReplay lista solo las que tienen', async () => {
    const { hashes } = await importar(NOTAS_A, NOTAS_B);
    await guardarPartida(hashes[1]!, partida(500_000, FECHA_1), replayDe(hashes[1]!, 7));
    await guardarPartida(hashes[0]!, partida(500_000, FECHA_1));
    expect([...(await hashesConReplay())]).toEqual([hashes[1]]);
  });

  it('guardar la partida es atomico: record y replay son de la misma partida', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    await guardarPartida(hash, partida(500_000, FECHA_1), replayDe(hash, 1000));
    await guardarPartida(hash, partida(600_000, FECHA_2), replayDe(hash, 2000));
    const record = (await leerRecords([hash])).get(hash)!;
    const guardado = await leerReplayGuardado(hash);
    expect(guardado?.fecha).toBe(record.mejor.fecha);
  });
});

describe('replays corruptos', () => {
  it('un registro con texto que no se lee se ignora, sin lanzar', async () => {
    await ponerReplayCrudo({ hash: 'h1', texto: '{no es json', fecha: FECHA_1 });
    expect(await leerReplayGuardado('h1')).toBeUndefined();
  });

  it('un registro cuyo replay es de otro hash que su clave se ignora', async () => {
    await ponerReplayCrudo({
      hash: 'h1',
      texto: serializarReplay(replayDe('otro', 5)),
      fecha: FECHA_1,
    });
    expect(await leerReplayGuardado('h1')).toBeUndefined();
  });

  it('un registro de tipos raros se ignora', async () => {
    await ponerReplayCrudo({ hash: 'h1', texto: 5, fecha: null });
    expect(await leerReplayGuardado('h1')).toBeUndefined();
  });

  it('un replay de una version futura se ignora', async () => {
    await ponerReplayCrudo({
      hash: 'h1',
      texto: JSON.stringify({ ...JSON.parse(serializarReplay(replayDe('h1', 1))), version: 2 }),
      fecha: FECHA_1,
    });
    expect(await leerReplayGuardado('h1')).toBeUndefined();
  });

  it('guardar una partida nueva mejor reemplaza un replay corrupto', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    await ponerReplayCrudo({ hash, texto: 'roto', fecha: FECHA_1 });
    await guardarPartida(hash, partida(100_000, FECHA_2), replayDe(hash, 9));
    expect((await leerReplayGuardado(hash))?.replay.eventos[0]?.time).toBe(9.125);
  });
});

describe('borrarCancion y replays', () => {
  it('borrar una cancion borra los replays de todas sus dificultades, no los de otras', async () => {
    const borrada = await importar(NOTAS_A, NOTAS_B);
    const otra = await importar(['64,192,0,1,0,0:0:0:0:', '64,192,250,1,0,0:0:0:0:']);
    for (const h of [...borrada.hashes, ...otra.hashes]) {
      await guardarPartida(h, partida(400_000, FECHA_1), replayDe(h, 1));
    }
    await borrarCancion(borrada.id);
    expect([...(await hashesConReplay())]).toEqual(otra.hashes);
  });

  it('si otra cancion tiene el mismo mapa, su replay se conserva (igual que su record)', async () => {
    const primera = await importar(NOTAS_A);
    const copia = await importar(NOTAS_A);
    const hash = primera.hashes[0]!;
    await guardarPartida(hash, partida(400_000, FECHA_1), replayDe(hash, 1));
    await borrarCancion(primera.id);
    expect(await leerReplayGuardado(hash)).toBeDefined();
    await borrarCancion(copia.id);
    expect(await leerReplayGuardado(hash)).toBeUndefined();
  });
});

describe('migracion no destructiva a VERSION_BASE 6 (tienda "replays")', () => {
  it('una base en version 5 conserva canciones y records y gana la tienda de replays', async () => {
    await new Promise<void>((resolve, reject) => {
      const peticion = indexedDB.open(NOMBRE_BASE, 5);
      peticion.onupgradeneeded = () => {
        const db = peticion.result;
        db.createObjectStore('mapas', { keyPath: 'id' });
        db.createObjectStore('skins', { keyPath: 'id' });
        db.createObjectStore('canciones', { keyPath: 'id' });
        db.createObjectStore('dificultades', { keyPath: 'clave' });
        db.createObjectStore('records', { keyPath: 'hash' });
      };
      peticion.onsuccess = () => {
        const db = peticion.result;
        const tx = db.transaction(['canciones', 'records'], 'readwrite');
        tx.objectStore('canciones').put({
          id: 'cancion-v5',
          titulo: 'Cancion de la version 5',
          artista: 'Artista viejo',
          audio: new Blob([new Uint8Array([1, 2, 3])]),
          dificultades: [],
        });
        const p = partida(321_000, FECHA_1);
        tx.objectStore('records').put({ hash: 'h-viejo', mejor: p, ultima: p, intentos: 4 });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      peticion.onerror = () => reject(peticion.error);
    });

    expect((await listarCanciones()).map((c) => c.id)).toEqual(['cancion-v5']);
    const record = (await leerRecords(['h-viejo'])).get('h-viejo')!;
    expect(record.mejor.score).toBe(321_000);
    expect(record.intentos).toBe(4);

    // La tienda nueva funciona sobre la base migrada.
    expect(await leerReplayGuardado('h-viejo')).toBeUndefined();
    await guardarPartida('h-viejo', partida(400_000, FECHA_2), replayDe('h-viejo', 1));
    expect(await leerReplayGuardado('h-viejo')).toBeDefined();
    await borrarCancion('cancion-v5');
    expect(await listarCanciones()).toHaveLength(0);
  });
});

describe('respaldo con replays', () => {
  async function bibliotecaConReplay(): Promise<{ hash: string; replay: Replay }> {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    const replay = replayDe(hash, 1234);
    await guardarPartida(hash, partida(900_000, FECHA_2), replay);
    return { hash, replay };
  }

  it('el respaldo lleva los replays y restaurar en una base vacia los devuelve iguales', async () => {
    const { hash, replay } = await bibliotecaConReplay();
    const zip = await crearRespaldo();
    const manifest = JSON.parse(
      new TextDecoder().decode(unzipSync(new Uint8Array(await zip.arrayBuffer()))['manifest.json']),
    ) as { replays: { hash: string; fecha: string }[]; version: number };
    // La version del respaldo sigue en 1.
    expect(manifest.version).toBe(1);
    expect(manifest.replays.map((r) => [r.hash, r.fecha])).toEqual([[hash, FECHA_2]]);

    await vaciarBase();
    const resumen = await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: false });
    expect(resumen.replaysNuevos).toBe(1);
    expect(resumen.recordsNuevos).toBe(1);
    expect((await leerReplayGuardado(hash))?.replay).toEqual(replay);
    expect((await leerReplayGuardado(hash))?.fecha).toBe(FECHA_2);
  });

  it('un respaldo de antes (sin la clave replays) se lee y restaura sin replays', async () => {
    await bibliotecaConReplay();
    const zip = await crearRespaldo();
    const archivos = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(archivos['manifest.json'])) as Record<string, unknown>;
    delete manifest['replays'];
    archivos['manifest.json'] = strToU8(JSON.stringify(manifest));
    const viejo = new Blob([new Uint8Array(zipSync(archivos))]);

    const leido = await leerRespaldo(viejo);
    expect(leido.replays).toEqual([]);
    await vaciarBase();
    const resumen = await restaurarRespaldo(leido, { sobrescribirAjustes: false });
    expect(resumen.replaysNuevos).toBe(0);
    expect(resumen.recordsNuevos).toBe(1);
    expect(await hashesConReplay()).toEqual(new Set());
  });

  it('los replays mal formados del respaldo se descartan y el resto sigue sirviendo', async () => {
    const { hash, replay } = await bibliotecaConReplay();
    const zip = await crearRespaldo();
    const archivos = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(archivos['manifest.json'])) as {
      replays: unknown[];
    };
    manifest.replays.push(
      { hash: 'x', texto: 'roto', fecha: FECHA_1 },
      { hash: 'y', texto: serializarReplay(replayDe('otro', 1)), fecha: FECHA_1 },
      7,
      null,
    );
    archivos['manifest.json'] = strToU8(JSON.stringify(manifest));
    const leido = await leerRespaldo(new Blob([new Uint8Array(zipSync(archivos))]));
    expect(leido.replays?.map((r) => r.hash)).toEqual([hash]);
    await vaciarBase();
    await restaurarRespaldo(leido, { sobrescribirAjustes: false });
    expect((await leerReplayGuardado(hash))?.replay).toEqual(replay);
  });

  it('importar dos veces el mismo respaldo no cambia nada (el segundo escribe 0 replays)', async () => {
    const { hash } = await bibliotecaConReplay();
    const zip = await crearRespaldo();
    const segunda = await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: false });
    expect(segunda.replaysNuevos).toBe(0);
    expect((await leerReplayGuardado(hash))?.fecha).toBe(FECHA_2);
  });

  it('un record local mejor conserva su replay: el del respaldo (de una partida peor) no lo pisa', async () => {
    const { hash } = await bibliotecaConReplay();
    const zipViejo = await crearRespaldo();
    // Local mejora despues del respaldo.
    const mejor = replayDe(hash, 5555);
    await guardarPartida(hash, partida(950_000, FECHA_3), mejor);

    const resumen = await restaurarRespaldo(await leerRespaldo(zipViejo), { sobrescribirAjustes: false });
    expect(resumen.replaysNuevos).toBe(0);
    expect((await leerReplayGuardado(hash))?.replay).toEqual(mejor);
    expect((await leerRecords([hash])).get(hash)!.mejor.score).toBe(950_000);
  });

  it('un record del respaldo mejor mejora el local y trae SU replay (no queda el viejo)', async () => {
    const { hash, replay } = await bibliotecaConReplay();
    // El respaldo es de una base donde el record local es mejor y tiene otro replay.
    await guardarPartida(hash, partida(990_000, FECHA_3), replayDe(hash, 777));
    const zipMejor = await crearRespaldo();
    // La base local, en cambio, quedo con una partida peor y su replay.
    await vaciarBase();
    const { hashes } = await importar(NOTAS_A);
    expect(hashes[0]).toBe(hash);
    await guardarPartida(hash, partida(100_000, FECHA_1), replay);

    const resumen = await restaurarRespaldo(await leerRespaldo(zipMejor), { sobrescribirAjustes: false });
    expect(resumen.recordsActualizados).toBe(1);
    expect(resumen.replaysNuevos).toBe(1);
    expect((await leerReplayGuardado(hash))?.replay.eventos[0]?.time).toBe(777.125);
    expect((await leerReplayGuardado(hash))?.fecha).toBe(FECHA_3);
  });

  it('un record del respaldo mejor SIN replay borra el replay local, que ya no es el de la mejor', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    await guardarPartida(hash, partida(990_000, FECHA_3)); // sin replay
    const zip = await crearRespaldo();
    await vaciarBase();
    await importar(NOTAS_A);
    await guardarPartida(hash, partida(100_000, FECHA_1), replayDe(hash, 1));

    await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: false });
    expect((await leerRecords([hash])).get(hash)!.mejor.score).toBe(990_000);
    expect(await leerReplayGuardado(hash)).toBeUndefined();
  });

  it('un replay del respaldo para una partida que no es la mejor local no se guarda', async () => {
    const { hash } = await bibliotecaConReplay();
    const zip = await crearRespaldo();
    await vaciarBase();
    await importar(NOTAS_A);
    // Local: otra partida, mejor que la del respaldo, sin replay.
    await guardarPartida(hash, partida(999_000, FECHA_3));
    await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: false });
    expect(await leerReplayGuardado(hash)).toBeUndefined();
  });

  it('el respaldo completa un replay que faltaba cuando es el de la misma mejor partida', async () => {
    const { hash, replay } = await bibliotecaConReplay();
    const zip = await crearRespaldo();
    await vaciarBase();
    await importar(NOTAS_A);
    // Mismo record (misma fecha) pero sin replay: se completa con el del respaldo.
    await guardarPartida(hash, partida(900_000, FECHA_2));
    expect(await leerReplayGuardado(hash)).toBeUndefined();
    const resumen = await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: false });
    expect(resumen.replaysNuevos).toBe(1);
    expect((await leerReplayGuardado(hash))?.replay).toEqual(replay);
  });
});
