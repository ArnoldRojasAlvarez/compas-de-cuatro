// Tests de T-045 para el historial de partidas (tienda 'historial',
// VERSION_BASE 7): guardar y leer en orden, tope de 2000, registros corruptos,
// que borrar la cancion no lo toque, migracion no destructiva desde la version
// 6 y el respaldo. fake-indexeddb, mismo patron que replays.test.ts.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { TOPE_HISTORIAL, hashMapa } from '@tetra/core';
import type { RegistroPartida } from '@tetra/core';
import {
  borrarCancion,
  crearRespaldo,
  exportarRespaldo,
  guardarEnHistorial,
  importarOsz,
  leerHistorial,
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

/** Un registro; `n` mueve la fecha n minutos desde el 1 de octubre para tener muchos distintos y ordenables. */
function registro(n: number, extra: Partial<RegistroPartida> = {}): RegistroPartida {
  const ms = Date.parse('2026-10-01T00:00:00.000Z') + n * 60_000;
  return {
    hash: 'hash-a',
    fecha: new Date(ms).toISOString(),
    score: 100_000 + n,
    accuracy: 0.9,
    notas: 100,
    desviacionMedia: -3,
    desviacionTipica: 11,
    tempranas: 40,
    tardias: 30,
    fallosPorColumna: [1, 0, 2, 0],
    duracionJugadaMs: 60_000,
    ...extra,
  };
}

/** Abre la base cruda (la que ya creo el codigo real) y escribe `valores` en 'historial'. */
async function escribirCrudo(
  valores: { clave: string; valor: unknown }[],
): Promise<void> {
  await listarCanciones(); // crea o migra la base con el codigo real
  await new Promise<void>((resolve, reject) => {
    const peticion = indexedDB.open(NOMBRE_BASE);
    peticion.onsuccess = () => {
      const db = peticion.result;
      const tx = db.transaction('historial', 'readwrite');
      for (const { clave, valor } of valores)
        tx.objectStore('historial').put(valor, clave);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    peticion.onerror = () => reject(peticion.error);
  });
}

describe('guardarEnHistorial y leerHistorial', () => {
  it('sin nada guardado el historial esta vacio', async () => {
    expect(await leerHistorial()).toEqual([]);
  });

  it('devuelve lo guardado, del mas viejo al mas nuevo, aunque se haya guardado en desorden', async () => {
    await guardarEnHistorial(registro(5));
    await guardarEnHistorial(registro(1));
    await guardarEnHistorial(registro(3));
    const leido = await leerHistorial();
    expect(leido.map((r) => r.score)).toEqual([100_001, 100_003, 100_005]);
    expect(leido[0]).toEqual(registro(1));
  });

  it('dos partidas del mismo mapa en el mismo instante no se pisan si cambia el mapa, y la misma si', async () => {
    await guardarEnHistorial(registro(1, { hash: 'a' }));
    await guardarEnHistorial(registro(1, { hash: 'b' }));
    expect(await leerHistorial()).toHaveLength(2);
    await guardarEnHistorial(registro(1, { hash: 'a', score: 7 }));
    const leido = await leerHistorial();
    expect(leido).toHaveLength(2);
    expect(leido.find((r) => r.hash === 'a')!.score).toBe(7);
  });

  it('no crece sin tope: al pasar de 2000 sale la mas vieja', async () => {
    for (let n = 0; n < TOPE_HISTORIAL + 3; n++) await guardarEnHistorial(registro(n));
    const leido = await leerHistorial();
    expect(leido).toHaveLength(TOPE_HISTORIAL);
    // Se fueron las tres mas viejas; quedan la 3 a la 2002.
    expect(leido[0]!.score).toBe(100_003);
    expect(leido[leido.length - 1]!.score).toBe(100_000 + TOPE_HISTORIAL + 2);
  }, 60_000);

  it('el tope borra por antiguedad de la partida, no por orden de llegada', async () => {
    for (let n = 1; n <= TOPE_HISTORIAL; n++) await guardarEnHistorial(registro(n));
    // Llega una partida con fecha anterior a todas: es la mas vieja y es la que sale.
    await guardarEnHistorial(registro(0));
    const leido = await leerHistorial();
    expect(leido).toHaveLength(TOPE_HISTORIAL);
    expect(leido[0]!.score).toBe(100_001);
  }, 60_000);

  it('un registro corrupto se ignora al leer y no tumba a los demas', async () => {
    await guardarEnHistorial(registro(1));
    await escribirCrudo([
      { clave: 'a', valor: 'basura' },
      { clave: 'b', valor: { ...registro(2), accuracy: 'alta' } },
      { clave: 'c', valor: { ...registro(3), fallosPorColumna: [1, 2] } },
      { clave: 'd', valor: { ...registro(4), notas: -5 } },
      { clave: 'e', valor: { ...registro(5), fecha: 'ayer' } },
      { clave: 'f', valor: null },
      { clave: '2026-10-02|ok', valor: registro(6) },
    ]);
    const leido = await leerHistorial();
    expect(leido.map((r) => r.score).sort()).toEqual([100_001, 100_006]);
  });
});

describe('el historial es del jugador, no de la cancion', () => {
  function osu(): string {
    return `osu file format v14

[General]
AudioFilename: audio.wav
Mode: 3

[Metadata]
Title:Cancion del historial
Artist:Artista
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
  }

  it('borrar una cancion no borra las partidas que se jugaron en ella', async () => {
    const id = await importarOsz(
      new Blob([
        new Uint8Array(
          zipSync({ 'a.osu': strToU8(osu()), 'audio.wav': new Uint8Array([1]) }),
        ),
      ]),
    );
    const cancion = (await listarCanciones()).find((c) => c.id === id)!;
    const hash = String(hashMapa(cancion.dificultades[0]!));
    await guardarEnHistorial(registro(1, { hash }));
    await guardarEnHistorial(registro(2, { hash }));

    await borrarCancion(id);

    expect(await listarCanciones()).toHaveLength(0);
    expect((await leerHistorial()).map((r) => r.hash)).toEqual([hash, hash]);
  });
});

describe('migracion no destructiva a VERSION_BASE 7 (tienda "historial")', () => {
  it('una base en version 6 conserva canciones y records y gana la tienda del historial', async () => {
    await new Promise<void>((resolve, reject) => {
      const peticion = indexedDB.open(NOMBRE_BASE, 6);
      peticion.onupgradeneeded = () => {
        const db = peticion.result;
        db.createObjectStore('mapas', { keyPath: 'id' });
        db.createObjectStore('skins', { keyPath: 'id' });
        db.createObjectStore('canciones', { keyPath: 'id' });
        db.createObjectStore('dificultades', { keyPath: 'clave' });
        db.createObjectStore('records', { keyPath: 'hash' });
        db.createObjectStore('replays', { keyPath: 'hash' });
      };
      peticion.onsuccess = () => {
        const db = peticion.result;
        const tx = db.transaction(['canciones', 'records'], 'readwrite');
        tx.objectStore('canciones').put({
          id: 'cancion-v6',
          titulo: 'Cancion de la version 6',
          artista: 'Artista viejo',
          audio: new Blob([new Uint8Array([1, 2, 3])]),
          dificultades: [],
        });
        tx.objectStore('records').put({
          hash: 'h-viejo',
          mejor: {
            score: 1,
            accuracy: 1,
            maxCombo: 1,
            counts: { max: 1, perfect: 0, great: 0, good: 0, bad: 0, miss: 0 },
            rango: 'SS',
            fecha: '2026-10-01T00:00:00.000Z',
          },
          intentos: 2,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      peticion.onerror = () => reject(peticion.error);
    });

    expect((await listarCanciones()).map((c) => c.id)).toEqual(['cancion-v6']);
    // La tienda nueva funciona sobre la base migrada.
    expect(await leerHistorial()).toEqual([]);
    await guardarEnHistorial(registro(1));
    expect(await leerHistorial()).toHaveLength(1);
    // Y lo que habia sigue ahi.
    expect((await listarCanciones()).map((c) => c.id)).toEqual(['cancion-v6']);
  });
});

describe('respaldo con historial', () => {
  it('el respaldo lleva el historial (version del formato sigue en 1) y restaurar en una base vacia lo devuelve igual', async () => {
    await guardarEnHistorial(registro(1));
    await guardarEnHistorial(registro(2, { hash: 'hash-b' }));
    const zip = await crearRespaldo();
    const manifest = JSON.parse(
      new TextDecoder().decode(
        unzipSync(new Uint8Array(await zip.arrayBuffer()))['manifest.json'],
      ),
    ) as { historial: unknown[]; version: number };
    expect(manifest.version).toBe(1);
    expect(manifest.historial).toHaveLength(2);

    await vaciarBase();
    expect(await leerHistorial()).toEqual([]);

    const resumen = await restaurarRespaldo(await leerRespaldo(zip), {
      sobrescribirAjustes: false,
    });
    expect(resumen.historialNuevo).toBe(2);
    expect(await leerHistorial()).toEqual([registro(1), registro(2, { hash: 'hash-b' })]);
  });

  it('restaurar dos veces el mismo respaldo no duplica partidas', async () => {
    await guardarEnHistorial(registro(1));
    const zip = await crearRespaldo();
    await vaciarBase();
    const primera = await restaurarRespaldo(await leerRespaldo(zip), {
      sobrescribirAjustes: false,
    });
    const segunda = await restaurarRespaldo(await leerRespaldo(zip), {
      sobrescribirAjustes: false,
    });
    expect(primera.historialNuevo).toBe(1);
    expect(segunda.historialNuevo).toBe(0);
    expect(await leerHistorial()).toHaveLength(1);
  });

  it('se une con lo que ya hay sin tocarlo', async () => {
    await guardarEnHistorial(registro(1));
    await guardarEnHistorial(registro(3));
    const zip = await crearRespaldo();
    await vaciarBase();
    await guardarEnHistorial(registro(2));
    await guardarEnHistorial(registro(3));
    const resumen = await restaurarRespaldo(await leerRespaldo(zip), {
      sobrescribirAjustes: false,
    });
    expect(resumen.historialNuevo).toBe(1); // la 1; la 3 ya estaba
    expect((await leerHistorial()).map((r) => r.score)).toEqual([
      100_001, 100_002, 100_003,
    ]);
  });

  it('un respaldo de antes (sin historial) se lee y restaura sin tocar el historial de ahora', async () => {
    await guardarEnHistorial(registro(1));
    const zip = await crearRespaldo();
    const archivos = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const manifest = JSON.parse(
      new TextDecoder().decode(archivos['manifest.json']),
    ) as Record<string, unknown>;
    delete manifest['historial'];
    archivos['manifest.json'] = strToU8(JSON.stringify(manifest));
    const viejo = new Blob([new Uint8Array(zipSync(archivos))]);

    const leido = await leerRespaldo(viejo);
    expect(leido.historial).toEqual([]);
    const resumen = await restaurarRespaldo(leido, { sobrescribirAjustes: false });
    expect(resumen.historialNuevo).toBe(0);
    expect(await leerHistorial()).toHaveLength(1);
  });

  it('las filas rotas del respaldo se descartan y las buenas entran', async () => {
    await guardarEnHistorial(registro(1));
    const zip = await crearRespaldo();
    const archivos = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(archivos['manifest.json'])) as {
      historial: unknown[];
    };
    manifest.historial.push({ hash: 'x' }, 'basura', {
      ...registro(2),
      accuracy: 'nada',
    });
    archivos['manifest.json'] = strToU8(JSON.stringify(manifest));
    const leido = await leerRespaldo(new Blob([new Uint8Array(zipSync(archivos))]));
    expect(leido.historial).toEqual([registro(1)]);
  });

  it('al restaurar tambien rige el tope: se quedan las 2000 mas nuevas', async () => {
    const muchos = Array.from({ length: TOPE_HISTORIAL + 5 }, (_, n) => registro(n));
    const zip = await exportarRespaldo({
      version: 1,
      canciones: [],
      skins: [],
      records: [],
      historial: muchos,
      ajustes: {},
    });
    const resumen = await restaurarRespaldo(await leerRespaldo(zip), {
      sobrescribirAjustes: false,
    });
    expect(resumen.historialNuevo).toBe(TOPE_HISTORIAL);
    const leido = await leerHistorial();
    expect(leido).toHaveLength(TOPE_HISTORIAL);
    expect(leido[0]!.score).toBe(100_005);
  });
});
