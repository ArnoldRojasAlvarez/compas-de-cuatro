// Tests de T-065: replays de las partidas recientes (tienda 'recientes',
// VERSION_BASE 8). Guardado junto al record, lista, conservar, purga (7 dias y
// tope de 200), borrado con la cancion, migracion no destructiva desde la
// version 7, respaldo (solo viajan las fijadas) y el determinismo de un replay
// guardado como reciente. fake-indexeddb, mismo patron que replays.test.ts.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  createJudgeEngine,
  crearGrabadorDeReplay,
  crearReproductorDeReplay,
  entregarEvento,
  expirarConMargen,
  expirarSinMargen,
  hashMapa,
  serializarReplay,
} from '@tetra/core';
import type { Chart, EventoReplay, Judgement, PartidaJugada, Replay, ScoreState } from '@tetra/core';
import {
  borrarCancion,
  conservarPartidaReciente,
  crearRespaldo,
  DIAS_REPLAYS_RECIENTES,
  guardarPartida,
  idDeReplayReciente,
  idsAPurgar,
  importarOsz,
  leerRecords,
  leerReplayGuardado,
  leerReplayReciente,
  leerRespaldo,
  listarCanciones,
  listarPartidasRecientes,
  purgarReplaysRecientes,
  restaurarRespaldo,
  TOPE_REPLAYS_RECIENTES,
} from './index.js';
import { guardarCancion, purgarRecientesDeLaBase } from './db.js';

const NOMBRE_BASE = 'tetra-mapas';
const DIA_MS = 24 * 60 * 60 * 1000;
const AHORA = Date.parse('2026-10-20T12:00:00.000Z');

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
Title:Cancion de recientes
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

function fechaHaceDias(dias: number): string {
  return new Date(AHORA - dias * DIA_MS).toISOString();
}

/** Abre la base tal cual esta (sin pasar por el codigo de la app) y corre `f` sobre la tienda. */
async function conTienda<T>(
  tienda: string,
  modo: IDBTransactionMode,
  f: (t: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  await listarCanciones(); // crea o migra la base con el codigo real
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const peticion = indexedDB.open(NOMBRE_BASE);
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(tienda, modo);
      const peticion = f(tx.objectStore(tienda));
      tx.oncomplete = () => resolve(peticion.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

describe('guardar las recientes junto al record', () => {
  it('toda partida completada con replay queda entre las recientes, mejore o no el record', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    await guardarPartida(hash, partida(900_000, fechaHaceDias(3)), replayDe(hash, 1));
    await guardarPartida(hash, partida(500_000, fechaHaceDias(2)), replayDe(hash, 2));
    await guardarPartida(hash, partida(700_000, fechaHaceDias(1)), replayDe(hash, 3));

    const lista = await listarPartidasRecientes(hash);
    // De la mas nueva a la mas vieja.
    expect(lista.map((r) => r.partida.score)).toEqual([700_000, 500_000, 900_000]);
    expect(lista.every((r) => !r.fijado)).toBe(true);
    expect(lista[0]!.id).toBe(idDeReplayReciente(hash, fechaHaceDias(1)));
    // El replay de la mejor sigue siendo el de la partida de 900 000 (T-044 no cambia).
    expect((await leerReplayGuardado(hash))?.replay).toEqual(replayDe(hash, 1));
  });

  it('el replay de una reciente vuelve igual que se grabo, decimales incluidos', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    const replay = replayDe(hash, 1234.56789012345);
    await guardarPartida(hash, partida(800_000, fechaHaceDias(1)), replay);
    const [reciente] = await listarPartidasRecientes(hash);
    const leido = await leerReplayReciente(reciente!.id);
    expect(leido?.replay).toEqual(replay);
    expect(leido?.fecha).toBe(fechaHaceDias(1));
  });

  it('una partida sin replay no deja reciente', async () => {
    const { hashes } = await importar(NOTAS_A);
    await guardarPartida(hashes[0]!, partida(800_000, fechaHaceDias(1)));
    expect(await listarPartidasRecientes(hashes[0]!)).toEqual([]);
  });

  it('cada dificultad lleva su lista', async () => {
    const { hashes } = await importar(NOTAS_A, NOTAS_B);
    await guardarPartida(hashes[0]!, partida(800_000, fechaHaceDias(1)), replayDe(hashes[0]!, 1));
    expect(await listarPartidasRecientes(hashes[0]!)).toHaveLength(1);
    expect(await listarPartidasRecientes(hashes[1]!)).toHaveLength(0);
  });

  it('la fila trae el resumen de la partida para listarla sin abrir el replay', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    const p = { ...partida(812_345, fechaHaceDias(1)), rango: 'A' as const, accuracy: 0.9123 };
    await guardarPartida(hash, p, replayDe(hash, 1));
    const [reciente] = await listarPartidasRecientes(hash);
    expect(reciente!.partida).toEqual(p);
    expect('texto' in reciente!).toBe(false);
  });
});

describe('conservar', () => {
  it('fija una reciente, y soltarla la deja como estaba', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    await guardarPartida(hash, partida(800_000, fechaHaceDias(1)), replayDe(hash, 1));
    const [reciente] = await listarPartidasRecientes(hash);
    expect(await conservarPartidaReciente(reciente!.id)).toBe(true);
    expect((await listarPartidasRecientes(hash))[0]!.fijado).toBe(true);
    expect(await conservarPartidaReciente(reciente!.id, false)).toBe(true);
    expect((await listarPartidasRecientes(hash))[0]!.fijado).toBe(false);
  });

  it('una que ya no existe devuelve false sin crear nada', async () => {
    await listarCanciones();
    expect(await conservarPartidaReciente('no|existe')).toBe(false);
    expect(await listarPartidasRecientes('no')).toEqual([]);
  });
});

describe('purga', () => {
  it('idsAPurgar: las de mas de 7 dias salen, las fijadas no, y el tope deja las mas nuevas', () => {
    const fila = (id: string, dias: number, fijado = false) => ({
      id,
      fecha: fechaHaceDias(dias),
      fijado,
    });
    const filas = [
      fila('reciente', 1),
      fila('seis-dias', 6.9),
      fila('ocho-dias', 8),
      fila('vieja-fijada', 40, true),
      fila('exacta', 7.01),
      { id: 'sin-fecha', fecha: 'no es una fecha', fijado: false },
    ];
    expect(idsAPurgar(filas, AHORA).sort()).toEqual(['exacta', 'ocho-dias', 'sin-fecha']);

    // Con tope 2: se quedan las 2 mas nuevas de las vigentes; la fijada no cuenta.
    expect(idsAPurgar(filas, AHORA, DIAS_REPLAYS_RECIENTES, 1).sort()).toEqual([
      'exacta',
      'ocho-dias',
      'seis-dias',
      'sin-fecha',
    ]);
    expect(TOPE_REPLAYS_RECIENTES).toBe(200);
    expect(DIAS_REPLAYS_RECIENTES).toBe(7);
  });

  it('borra las de mas de 7 dias y conserva las demas; la mejor partida y las fijadas sobreviven', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    // La mejor es de hace 10 dias (900 000): su reciente se purga, su replay de mejor no.
    await guardarPartida(hash, partida(900_000, fechaHaceDias(10)), replayDe(hash, 1));
    await guardarPartida(hash, partida(600_000, fechaHaceDias(9)), replayDe(hash, 2));
    await guardarPartida(hash, partida(610_000, fechaHaceDias(6)), replayDe(hash, 3));
    await guardarPartida(hash, partida(620_000, fechaHaceDias(0.5)), replayDe(hash, 4));
    // Una vieja pero fijada.
    const antes = await listarPartidasRecientes(hash);
    const vieja = antes.find((r) => r.partida.score === 600_000)!;
    await conservarPartidaReciente(vieja.id);

    expect(await purgarReplaysRecientes(AHORA)).toBe(1); // solo la de 10 dias, sin fijar

    const despues = await listarPartidasRecientes(hash);
    expect(despues.map((r) => r.partida.score)).toEqual([620_000, 610_000, 600_000]);
    expect(despues.find((r) => r.partida.score === 600_000)!.fijado).toBe(true);
    // El replay de la mejor partida (de hace 10 dias) sigue ahi.
    expect((await leerReplayGuardado(hash))?.replay).toEqual(replayDe(hash, 1));
    expect((await leerRecords([hash])).get(hash)?.mejor.score).toBe(900_000);
    // Purgar de nuevo no borra nada.
    expect(await purgarReplaysRecientes(AHORA)).toBe(0);
  });

  it('el tope de 200 deja las 200 mas nuevas sin fijar, y las fijadas no cuentan', async () => {
    await listarCanciones();
    // Filas escritas a mano (200 partidas por la API serian lentas): 205 sin fijar + 1 fijada mas vieja que todas.
    const filas: { i: number; fecha: string }[] = [];
    for (let i = 0; i < 205; i++) {
      const fecha = new Date(AHORA - (i + 1) * 60_000).toISOString(); // i = 0 la mas nueva
      filas.push({ i, fecha });
    }
    const hash = 'h-tope';
    await conTienda('recientes', 'readwrite', (t) => {
      let ultima!: IDBRequest;
      for (const { i, fecha } of filas) {
        ultima = t.put({
          id: idDeReplayReciente(hash, fecha),
          hash,
          fecha,
          texto: serializarReplay(replayDe(hash, i)),
          partida: partida(i, fecha),
          fijado: false,
        });
      }
      const fecha = new Date(AHORA - 3 * 60 * 60_000 - 30_000).toISOString();
      ultima = t.put({
        id: idDeReplayReciente(hash, fecha),
        hash,
        fecha,
        texto: serializarReplay(replayDe(hash, 999)),
        partida: partida(999, fecha),
        fijado: true,
      });
      return ultima;
    });

    expect(await purgarReplaysRecientes(AHORA)).toBe(5);
    const lista = await listarPartidasRecientes(hash);
    expect(lista).toHaveLength(201); // 200 + la fijada
    expect(lista.filter((r) => r.fijado)).toHaveLength(1);
    // Se fueron las 5 mas viejas: los scores guardados son el indice (0 = la mas nueva).
    const scores = lista.filter((r) => !r.fijado).map((r) => r.partida.score);
    expect(Math.max(...scores)).toBe(199);
    expect(Math.min(...scores)).toBe(0);
  });

  it('una fila corrupta se borra sin lanzar', async () => {
    await listarCanciones();
    await conTienda('recientes', 'readwrite', (t) =>
      t.put({ id: 'x|y', hash: 'x', fecha: 'y', texto: 5 }),
    );
    expect(await purgarReplaysRecientes(AHORA)).toBe(1);
    expect(await conTienda('recientes', 'readonly', (t) => t.count())).toBe(0);
  });

  it('con parametros propios: los dias y el tope se pueden cambiar', async () => {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    await guardarPartida(hash, partida(1, fechaHaceDias(3)), replayDe(hash, 1));
    await guardarPartida(hash, partida(2, fechaHaceDias(2)), replayDe(hash, 2));
    await guardarPartida(hash, partida(3, fechaHaceDias(1)), replayDe(hash, 3));
    expect(await purgarRecientesDeLaBase(AHORA, 7, 2)).toBe(1);
    expect((await listarPartidasRecientes(hash)).map((r) => r.partida.score)).toEqual([3, 2]);
    expect(await purgarRecientesDeLaBase(AHORA, 1.5, 2)).toBe(1);
    expect((await listarPartidasRecientes(hash)).map((r) => r.partida.score)).toEqual([3]);
  });
});

describe('borrarCancion y recientes', () => {
  it('borra las recientes de todas las dificultades, tambien las fijadas, y no las de otra cancion', async () => {
    const a = await importar(NOTAS_A, NOTAS_B);
    const otra = await importar(['64,192,0,1,0,0:0:0:0:', '448,192,700,1,0,0:0:0:0:']);
    for (const hash of [...a.hashes, ...otra.hashes]) {
      await guardarPartida(hash, partida(100_000, fechaHaceDias(1)), replayDe(hash, 1));
    }
    const [primera] = await listarPartidasRecientes(a.hashes[0]!);
    await conservarPartidaReciente(primera!.id);

    await borrarCancion(a.id);

    expect(await listarPartidasRecientes(a.hashes[0]!)).toEqual([]);
    expect(await listarPartidasRecientes(a.hashes[1]!)).toEqual([]);
    expect(await listarPartidasRecientes(otra.hashes[0]!)).toHaveLength(1);
  });

  it('si otra cancion tiene el mismo mapa, sus recientes se conservan (igual que su record)', async () => {
    const a = await importar(NOTAS_A);
    await duplicarEnLaBase(a.id);
    const hash = a.hashes[0]!;
    await guardarPartida(hash, partida(100_000, fechaHaceDias(1)), replayDe(hash, 1));
    await borrarCancion(a.id);
    expect(await listarPartidasRecientes(hash)).toHaveLength(1);
  });
});

describe('migracion no destructiva a VERSION_BASE 8 (tienda "recientes")', () => {
  it('una base en version 7 conserva canciones, records, replays e historial y gana la tienda', async () => {
    const fecha = fechaHaceDias(2);
    const p = partida(321_000, fecha);
    const replayMejor = replayDe('h-viejo', 77);
    await new Promise<void>((resolve, reject) => {
      const peticion = indexedDB.open(NOMBRE_BASE, 7);
      peticion.onupgradeneeded = () => {
        const db = peticion.result;
        db.createObjectStore('mapas', { keyPath: 'id' });
        db.createObjectStore('skins', { keyPath: 'id' });
        db.createObjectStore('canciones', { keyPath: 'id' });
        db.createObjectStore('dificultades', { keyPath: 'clave' });
        db.createObjectStore('records', { keyPath: 'hash' });
        db.createObjectStore('replays', { keyPath: 'hash' });
        db.createObjectStore('historial');
      };
      peticion.onsuccess = () => {
        const db = peticion.result;
        const tx = db.transaction(['canciones', 'records', 'replays', 'historial'], 'readwrite');
        tx.objectStore('canciones').put({
          id: 'cancion-v7',
          titulo: 'Cancion de la version 7',
          artista: 'Artista viejo',
          audio: new Blob([new Uint8Array([1, 2, 3])]),
          dificultades: [],
        });
        tx.objectStore('records').put({ hash: 'h-viejo', mejor: p, ultima: p, intentos: 4 });
        tx.objectStore('replays').put({
          hash: 'h-viejo',
          texto: serializarReplay(replayMejor),
          fecha,
        });
        tx.objectStore('historial').put({ cualquier: 'cosa' }, `${fecha}|h-viejo`);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      peticion.onerror = () => reject(peticion.error);
    });

    // Todo lo de antes sigue ahi.
    expect((await listarCanciones()).map((c) => c.id)).toEqual(['cancion-v7']);
    const record = (await leerRecords(['h-viejo'])).get('h-viejo')!;
    expect(record.mejor.score).toBe(321_000);
    expect(record.intentos).toBe(4);
    expect((await leerReplayGuardado('h-viejo'))?.replay).toEqual(replayMejor);
    expect(await conTienda('historial', 'readonly', (t) => t.count())).toBe(1);

    // Y la tienda nueva existe, con sus indices, y funciona.
    const info = await new Promise<{ version: number; indices: string[]; keyPath: unknown }>(
      (resolve, reject) => {
        const peticion = indexedDB.open(NOMBRE_BASE);
        peticion.onsuccess = () => {
          const db = peticion.result;
          const tienda = db.transaction('recientes', 'readonly').objectStore('recientes');
          resolve({
            version: db.version,
            indices: Array.from(tienda.indexNames),
            keyPath: tienda.keyPath,
          });
          db.close();
        };
        peticion.onerror = () => reject(peticion.error);
      },
    );
    expect(info.version).toBe(9); // T-066 paso 3 subio la base a la version 9
    expect(info.keyPath).toBe('id');
    expect(info.indices.sort()).toEqual(['fecha', 'hash']);
    expect(await listarPartidasRecientes('h-viejo')).toEqual([]);
    await guardarPartida('h-viejo', partida(400_000, fechaHaceDias(1)), replayDe('h-viejo', 5));
    expect(await listarPartidasRecientes('h-viejo')).toHaveLength(1);
    await borrarCancion('cancion-v7');
    expect(await listarCanciones()).toHaveLength(0);
  });

  it('abrir de nuevo una base que ya esta en la version 8 no pierde las recientes', async () => {
    const { hashes } = await importar(NOTAS_A);
    await guardarPartida(hashes[0]!, partida(1, fechaHaceDias(1)), replayDe(hashes[0]!, 1));
    expect(await listarPartidasRecientes(hashes[0]!)).toHaveLength(1);
    expect(await listarPartidasRecientes(hashes[0]!)).toHaveLength(1);
  });
});

describe('respaldo y recientes (decision de T-065: solo viajan las fijadas)', () => {
  async function biblioteca(): Promise<{ hash: string }> {
    const { hashes } = await importar(NOTAS_A);
    const hash = hashes[0]!;
    await guardarPartida(hash, partida(900_000, fechaHaceDias(3)), replayDe(hash, 1));
    await guardarPartida(hash, partida(500_000, fechaHaceDias(2)), replayDe(hash, 2));
    await guardarPartida(hash, partida(700_000, fechaHaceDias(1)), replayDe(hash, 3));
    return { hash };
  }

  async function manifestDe(zip: Blob): Promise<{ recientes?: { id: string; fijado: boolean }[]; version: number }> {
    const archivos = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    return JSON.parse(new TextDecoder().decode(archivos['manifest.json'])) as {
      recientes?: { id: string; fijado: boolean }[];
      version: number;
    };
  }

  it('sin ninguna fijada el respaldo no lleva recientes', async () => {
    await biblioteca();
    const manifest = await manifestDe(await crearRespaldo());
    expect(manifest.version).toBe(1);
    expect(manifest.recientes).toEqual([]);
  });

  it('las fijadas viajan y vuelven en una base vacia; las otras no', async () => {
    const { hash } = await biblioteca();
    const lista = await listarPartidasRecientes(hash);
    const fijada = lista.find((r) => r.partida.score === 500_000)!;
    await conservarPartidaReciente(fijada.id);

    const zip = await crearRespaldo();
    expect((await manifestDe(zip)).recientes?.map((r) => r.id)).toEqual([fijada.id]);

    await vaciarBase();
    const resumen = await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: false });
    expect(resumen.recientesNuevos).toBe(1);
    const tras = await listarPartidasRecientes(hash);
    expect(tras.map((r) => [r.partida.score, r.fijado])).toEqual([[500_000, true]]);
    expect((await leerReplayReciente(fijada.id))?.replay).toEqual(replayDe(hash, 2));
    // El replay de la mejor tambien volvio (T-044).
    expect((await leerReplayGuardado(hash))?.replay).toEqual(replayDe(hash, 1));
  });

  it('restaurar dos veces el mismo respaldo no duplica ni cuenta de nuevo', async () => {
    const { hash } = await biblioteca();
    const [primera] = await listarPartidasRecientes(hash);
    await conservarPartidaReciente(primera!.id);
    const zip = await crearRespaldo();
    await vaciarBase();
    const a = await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: false });
    const b = await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: false });
    expect(a.recientesNuevos).toBe(1);
    expect(b.recientesNuevos).toBe(0);
    expect(await listarPartidasRecientes(hash)).toHaveLength(1);
  });

  it('restaurar sobre una base que ya la tiene sin fijar la deja fijada', async () => {
    const { hash } = await biblioteca();
    const [primera] = await listarPartidasRecientes(hash);
    await conservarPartidaReciente(primera!.id);
    const zip = await crearRespaldo();
    await conservarPartidaReciente(primera!.id, false);
    await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: false });
    const tras = await listarPartidasRecientes(hash);
    expect(tras).toHaveLength(3);
    expect(tras.filter((r) => r.fijado).map((r) => r.id)).toEqual([primera!.id]);
  });

  it('un respaldo de antes (sin la clave recientes) se lee y restaura igual', async () => {
    await biblioteca();
    const zip = await crearRespaldo();
    const archivos = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(archivos['manifest.json'])) as Record<
      string,
      unknown
    >;
    delete manifest['recientes'];
    archivos['manifest.json'] = strToU8(JSON.stringify(manifest));
    const viejo = new Blob([new Uint8Array(zipSync(archivos))]);
    const leido = await leerRespaldo(viejo);
    expect(leido.recientes).toEqual([]);
    await vaciarBase();
    const resumen = await restaurarRespaldo(leido, { sobrescribirAjustes: false });
    expect(resumen.recientesNuevos).toBe(0);
    expect(resumen.recordsNuevos).toBe(1);
  });

  it('las filas mal formadas o sin fijar del manifest se descartan y el resto sirve', async () => {
    const { hash } = await biblioteca();
    const [primera] = await listarPartidasRecientes(hash);
    await conservarPartidaReciente(primera!.id);
    const zip = await crearRespaldo();
    const archivos = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(archivos['manifest.json'])) as {
      recientes: unknown[];
    };
    const buena = manifest.recientes[0] as Record<string, unknown>;
    manifest.recientes = [
      buena,
      { ...buena, id: 'otro|id' }, // el id no corresponde a hash y fecha
      { ...buena, texto: '{no es un replay' },
      { ...buena, fecha: 'ayer', id: `${hash}|ayer` },
      { ...buena, id: `${hash}|${fechaHaceDias(5)}`, fecha: fechaHaceDias(5), fijado: false }, // sin fijar
      'basura',
    ];
    archivos['manifest.json'] = strToU8(JSON.stringify(manifest));
    const leido = await leerRespaldo(new Blob([new Uint8Array(zipSync(archivos))]));
    expect(leido.recientes?.map((r) => r.id)).toEqual([primera!.id]);
  });
});

// ---------------------------------------------------------------------------
// Determinismo de un replay guardado como reciente
// ---------------------------------------------------------------------------

function azar(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un mapa de ~96 notas (simples, largas y acordes) como texto de .osu. */
function notasDeUnaPartidaLarga(): string[] {
  const x = [64, 192, 320, 448];
  const lineas: string[] = [];
  for (let i = 0; i < 64; i++) {
    const tiempo = 1000 + i * 250;
    const columna = (i * 3 + (i % 5)) % 4;
    if (i % 7 === 3) {
      lineas.push(`${x[columna]},192,${tiempo},128,0,${tiempo + 200}:0:0:0:0:`);
    } else {
      lineas.push(`${x[columna]},192,${tiempo},1,0,0:0:0:0:`);
    }
    if (i % 6 === 0) lineas.push(`${x[(columna + 2) % 4]},192,${tiempo},1,0,0:0:0:0:`);
  }
  return lineas;
}

function foto(estado: ScoreState): ScoreState {
  return { ...estado, counts: { ...estado.counts } };
}

/**
 * Una partida "humana" sobre el chart: cada nota con un error aleatorio y
 * tiempos con muchos decimales, como los que da el reloj interpolado (T-063);
 * algunas sin tocar y alguna pulsacion al aire.
 */
function partidaHumana(chart: Chart, semilla: number): EventoReplay[] {
  const rnd = azar(semilla);
  const eventos: EventoReplay[] = [];
  const error = (): number => (rnd() - 0.5) * (rnd() < 0.1 ? 400 : 120);
  const libreDesde = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (const nota of chart.notes) {
    if (rnd() < 0.04) continue;
    const abajo = Math.max(nota.time + error(), libreDesde[nota.column]! + 2);
    eventos.push({ time: abajo, column: nota.column, tipo: 'down' });
    const arriba = Math.max(
      nota.kind === 'hold' ? nota.endTime + error() : abajo + 30 + rnd() * 40,
      abajo + 5,
    );
    eventos.push({ time: arriba, column: nota.column, tipo: 'up' });
    libreDesde[nota.column] = arriba;
  }
  return eventos.sort((a, b) => a.time - b.time);
}

/** El bucle de game.ts, en vivo: graba lo que recibe el motor. */
function jugarEnVivo(
  chart: Chart,
  humanos: readonly EventoReplay[],
  msPorFrame: number,
): { estado: ScoreState; replay: Replay } {
  const rnd = azar(4242);
  const motor = createJudgeEngine(chart);
  const grabador = crearGrabadorDeReplay();
  const sinNada = (): void => undefined;
  const retrasos = humanos.map(() => rnd() * 40);
  const ultima = chart.notes.reduce((m, n) => Math.max(m, n.kind === 'hold' ? n.endTime : n.time), 0);
  let siguiente = 0;
  for (let t = -1500; ; t += msPorFrame) {
    while (siguiente < humanos.length && humanos[siguiente]!.time + retrasos[siguiente]! <= t) {
      const h = humanos[siguiente]!;
      siguiente++;
      const llegado = grabador.registrar(h.time - rnd() * 4, h.column, h.tipo);
      entregarEvento(motor, llegado, sinNada);
    }
    grabador.actualizado(expirarConMargen(motor, t, sinNada));
    if (motor.finished || t >= ultima + 5000) {
      expirarSinMargen(motor, t, sinNada);
      break;
    }
  }
  expect(motor.finished).toBe(true);
  return { estado: foto(motor.state), replay: grabador.replay(String(hashMapa(chart)), -7.25) };
}

/** La reproduccion de game.ts (auto o replay): eventos por tiempo de juego, expiracion con margen. */
function reproducir(chart: Chart, replay: Replay, msPorFrame: number): ScoreState {
  const motor = createJudgeEngine(chart);
  const reproductor = crearReproductorDeReplay(replay);
  const sinNada = (): void => undefined;
  const ultima = chart.notes.reduce((m, n) => Math.max(m, n.kind === 'hold' ? n.endTime : n.time), 0);
  for (let t = -1500; ; t += msPorFrame) {
    reproductor.avanzar(t, (e) => entregarEvento(motor, e, sinNada));
    expirarConMargen(motor, t, sinNada);
    if (motor.finished || t >= ultima + 5000) {
      expirarSinMargen(motor, t, sinNada);
      break;
    }
  }
  expect(motor.finished).toBe(true);
  return foto(motor.state);
}

describe('determinismo: un replay guardado como reciente da exactamente el mismo resultado', () => {
  it.each([5, 6, 7])(
    'partida %i: jugada en vivo, guardada en la base y reproducida a otras frecuencias',
    async (semilla) => {
      const { id } = await importar(notasDeUnaPartidaLarga());
      const cancion = (await listarCanciones()).find((c) => c.id === id)!;
      const chart = cancion.dificultades[0]!;
      const hash = String(hashMapa(chart));

      const vivo = jugarEnVivo(chart, partidaHumana(chart, semilla), 1000 / 60);
      // La partida no es trivial: hay de todo, y los tiempos tienen decimales largos.
      expect(vivo.estado.counts.miss).toBeGreaterThan(0);
      expect(vivo.estado.counts.max).toBeGreaterThan(0);
      expect(vivo.estado.score).toBeLessThan(1_000_000);
      expect(vivo.replay.eventos.some((e) => !Number.isInteger(e.time))).toBe(true);

      // Se guarda como reciente de la misma manera que lo hace la app...
      const fecha = fechaHaceDias(0.1);
      await guardarPartida(hash, partida(vivo.estado.score, fecha), vivo.replay);
      // ...y, para que NO sea la mejor, se guarda antes otra mejor: asi el replay
      // solo existe en 'recientes' y la prueba no se apoya en la tienda 'replays'.
      await guardarPartida(hash, partida(2_000_000, fechaHaceDias(0.05)), replayDe(hash, 1));
      expect((await leerReplayGuardado(hash))?.fecha).toBe(fechaHaceDias(0.05));

      const reciente = (await listarPartidasRecientes(hash)).find((r) => r.fecha === fecha)!;
      const guardado = await leerReplayReciente(reciente.id);
      expect(guardado).toBeDefined();
      // Mismo replay, evento por evento, decimales incluidos.
      expect(guardado!.replay).toEqual(vivo.replay);

      for (const msPorFrame of [1000 / 240, 1000 / 144, 1000 / 60, 1000 / 24, 250]) {
        expect(reproducir(chart, guardado!.replay, msPorFrame)).toEqual(vivo.estado);
      }
    },
  );
});
