// Tests de T-066 paso 3: canciones con audio virtual. Importacion con muestras
// compartidas por hash, borrado, exportacion y reimportacion, limites,
// muestras faltantes, migracion de la base v8 a la v9 y respaldo.
// fake-indexeddb, mismo patron que importacion-sets.test.ts.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  borrarCancion,
  crearRespaldo,
  esCancionVirtual,
  exportarCancion,
  importarArchivoOsz,
  leerMuestras,
  leerRecords,
  leerRespaldo,
  limpiarMuestrasHuerfanas,
  listarCanciones,
  restaurarRespaldo,
  ErrorDeImportacion,
} from './index.js';
import { guardarCancion, listarMuestrasDeLaBase } from './db.js';
import { sha256Hex } from './osz.js';

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

/** Un .osu virtual: notas (con su keysound) y lineas Sample de [Events]. */
function osuVirtual(opciones: {
  version: string;
  notas: string[];
  samples?: string[];
  title?: string;
}): string {
  return [
    'osu file format v14',
    '',
    '[General]',
    'AudioFilename: virtual',
    'Mode: 3',
    '',
    '[Metadata]',
    `Title:${opciones.title ?? 'Set de prueba'}`,
    'Artist:Coleccion',
    'Creator:Alguien',
    `Version:${opciones.version}`,
    '',
    '[Difficulty]',
    'HPDrainRate:5',
    'CircleSize:4',
    'OverallDifficulty:7',
    '',
    '[Events]',
    ...(opciones.samples ?? []),
    '',
    '[TimingPoints]',
    '0,500,4,1,0,80,1,0',
    '',
    '[HitObjects]',
    ...opciones.notas,
    '',
  ].join('\n');
}

const BYTES: Record<string, Uint8Array> = {
  'a.ogg': new Uint8Array([10, 11, 12]),
  'b.ogg': new Uint8Array([20, 21]),
  'compartida.ogg': new Uint8Array([30, 31, 32, 33]),
};

function oszVirtual(
  osus: Record<string, string>,
  muestras: Record<string, Uint8Array> = BYTES,
): File {
  const entradas: Record<string, Uint8Array> = { ...muestras };
  for (const [nombre, texto] of Object.entries(osus)) entradas[nombre] = strToU8(texto);
  return new File([new Uint8Array(zipSync(entradas))], 'set.osz');
}

/** Dos piezas: Canon usa a y la compartida; La Campanella usa b y la compartida. */
function setDeDosPiezas(muestras: Record<string, Uint8Array> = BYTES): File {
  return oszVirtual(
    {
      '1-canon.osu': osuVirtual({
        version: 'Canon - 4K EX',
        notas: ['64,192,1000,1,0,0:0:0:0:a.ogg', '192,192,2000,128,0,2500:0:0:0:60:compartida.ogg'],
        samples: ['Sample,500,0,"compartida.ogg",100'],
      }),
      '2-campanella.osu': osuVirtual({
        version: 'La Campanella - 4K Full',
        notas: ['320,192,1500,1,0,0:0:0:0:b.ogg', '448,192,3000,1,0,0:0:0:0:'],
        samples: ['Sample,100,0,"compartida.ogg",70'],
      }),
    },
    muestras,
  );
}

async function hashDe(nombre: string): Promise<string> {
  return sha256Hex(BYTES[nombre] as Uint8Array<ArrayBuffer>);
}

describe('importar un set virtual', () => {
  it('da una cancion virtual por pieza, sin pista y con sus muestras', async () => {
    const r = await importarArchivoOsz(setDeDosPiezas());
    expect(r.canciones.map((c) => [c.titulo, c.estado])).toEqual([
      ['Canon', 'nueva'],
      ['La Campanella', 'nueva'],
    ]);
    const canciones = (await listarCanciones()).sort((a, b) => a.titulo.localeCompare(b.titulo));
    expect(canciones.every(esCancionVirtual)).toBe(true);
    expect(canciones.every((c) => c.audio === undefined)).toBe(true);
    expect(canciones[0]!.conjunto).toBe('Set de prueba');
    expect(Object.keys(canciones[0]!.keysounds!).sort()).toEqual(['a.ogg', 'compartida.ogg']);
    expect(Object.keys(canciones[1]!.keysounds!).sort()).toEqual(['b.ogg', 'compartida.ogg']);
    // la receta quedo en el chart: keysound con volumen resuelto (80 del punto de tiempo)
    const receta = canciones[0]!.dificultades[0]!.audioVirtual!.eventos;
    expect(receta).toEqual([
      { tiempo: 500, archivo: 'compartida.ogg', volumen: 100 },
      { tiempo: 1000, archivo: 'a.ogg', volumen: 80 },
      { tiempo: 2000, archivo: 'compartida.ogg', volumen: 60 },
    ]);
  });

  it('las muestras compartidas se guardan una sola vez, por SHA-256', async () => {
    await importarArchivoOsz(setDeDosPiezas());
    const guardadas = await listarMuestrasDeLaBase();
    expect(guardadas.map((m) => m.hash).sort()).toEqual(
      [await hashDe('a.ogg'), await hashDe('b.ogg'), await hashDe('compartida.ogg')].sort(),
    );
    const blobs = await leerMuestras([await hashDe('compartida.ogg'), 'no-existe']);
    expect(blobs.size).toBe(1);
    expect(new Uint8Array(await blobs.get(await hashDe('compartida.ogg'))!.arrayBuffer())).toEqual(
      BYTES['compartida.ogg'],
    );
  });

  it('dos nombres con los mismos bytes comparten una muestra', async () => {
    const r = await importarArchivoOsz(
      oszVirtual(
        {
          'x.osu': osuVirtual({
            version: 'Normal',
            notas: ['64,192,1000,1,0,0:0:0:0:uno.ogg', '192,192,2000,1,0,0:0:0:0:dos.ogg'],
          }),
        },
        { 'uno.ogg': BYTES['a.ogg']!, 'dos.ogg': BYTES['a.ogg']! },
      ),
    );
    expect(r.canciones).toHaveLength(1);
    expect(await listarMuestrasDeLaBase()).toHaveLength(1);
    const cancion = (await listarCanciones())[0]!;
    expect(cancion.keysounds!['uno.ogg']).toBe(cancion.keysounds!['dos.ogg']);
  });

  it('reimportarlo da ya-estaba en las dos y no duplica muestras', async () => {
    await importarArchivoOsz(setDeDosPiezas());
    const otra = await importarArchivoOsz(setDeDosPiezas());
    expect(otra.canciones.map((c) => c.estado)).toEqual(['ya-estaba', 'ya-estaba']);
    expect(await listarCanciones()).toHaveLength(2);
    expect(await listarMuestrasDeLaBase()).toHaveLength(3);
  });

  it('borrar una conserva la muestra compartida y borra la propia', async () => {
    const r = await importarArchivoOsz(setDeDosPiezas());
    await borrarCancion(r.canciones[0]!.id); // Canon: usa a y la compartida
    const hashes = (await listarMuestrasDeLaBase()).map((m) => m.hash).sort();
    expect(hashes).toEqual([await hashDe('b.ogg'), await hashDe('compartida.ogg')].sort());
    await borrarCancion(r.canciones[1]!.id);
    expect(await listarMuestrasDeLaBase()).toHaveLength(0);
  });

  it('limpiarMuestrasHuerfanas borra solo las que nadie referencia', async () => {
    await importarArchivoOsz(setDeDosPiezas());
    const blob = new Blob([new Uint8Array([9, 9, 9])]);
    await guardarCancion(
      {
        id: 'sin-audio-ni-sonidos',
        titulo: 'x',
        artista: 'y',
        keysounds: {},
        dificultades: [],
      },
      new Map([['huerfana', blob]]),
    );
    expect(await listarMuestrasDeLaBase()).toHaveLength(4);
    expect(await limpiarMuestrasHuerfanas()).toBe(1);
    expect(await listarMuestrasDeLaBase()).toHaveLength(3);
    expect(await limpiarMuestrasHuerfanas()).toBe(0);
  });
});

describe('avisos y errores del audio virtual', () => {
  it('una muestra que falta se avisa y la importacion sigue', async () => {
    const sinB = { ...BYTES };
    delete sinB['b.ogg'];
    const r = await importarArchivoOsz(setDeDosPiezas(sinB));
    expect(r.canciones).toHaveLength(2);
    expect(r.avisos).toEqual(['Falta 1 muestra de sonido en "La Campanella": esa nota no va a sonar.']);
  });

  it('varias faltantes se avisan en plural', async () => {
    const r = await importarArchivoOsz(
      oszVirtual(
        {
          'x.osu': osuVirtual({
            version: 'Normal',
            notas: [
              '64,192,1000,1,0,0:0:0:0:a.ogg',
              '192,192,2000,1,0,0:0:0:0:falta1.ogg',
              '320,192,3000,1,0,0:0:0:0:falta2.ogg',
            ],
          }),
        },
        { 'a.ogg': BYTES['a.ogg']! },
      ),
    );
    expect(r.avisos).toEqual([
      'Faltan 2 muestras de sonido en "Set de prueba": esas notas no van a sonar.',
    ]);
  });

  it('si faltan todas, muestras-faltantes con el mensaje de la tabla', async () => {
    await expect(importarArchivoOsz(setDeDosPiezas({}))).rejects.toMatchObject({
      codigo: 'muestras-faltantes',
      message:
        'Falta el audio virtual: ninguna de las 2 muestras de sonido que pide el mapa viene en el .osz.',
    });
    expect(await listarCanciones()).toHaveLength(0);
  });

  it('una dificultad con mas de 60 000 eventos se omite con aviso y las demas entran', async () => {
    const muchas = Array.from({ length: 60_001 }, (_, i) => `Sample,${i},0,"a.ogg",100`);
    const r = await importarArchivoOsz(
      oszVirtual({
        'ok.osu': osuVirtual({
          version: 'Facil',
          notas: ['64,192,1000,1,0,0:0:0:0:a.ogg'],
        }),
        'enorme.osu': osuVirtual({
          version: 'Enorme',
          notas: ['64,192,1000,1,0,0:0:0:0:a.ogg'],
          samples: muchas,
        }),
      }),
    );
    expect(r.canciones).toHaveLength(1);
    expect(r.canciones[0]!.titulo).toBe('Set de prueba');
    expect(r.avisos).toEqual([
      'Se omitió "Enorme": pasa el límite del audio virtual (10 minutos y 60 000 sonidos).',
    ]);
    const cancion = (await listarCanciones())[0]!;
    expect(cancion.dificultades.map((d) => d.metadata.difficultyName)).toEqual(['Facil']);
  });

  it('un evento pasados los 10 minutos tambien se omite; si es la unica, virtual-fuera-de-limite', async () => {
    const e = await importarArchivoOsz(
      oszVirtual({
        'largo.osu': osuVirtual({
          version: 'Largo',
          notas: ['64,192,1000,1,0,0:0:0:0:a.ogg'],
          samples: ['Sample,600001,0,"a.ogg",100'],
        }),
      }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(e).toBeInstanceOf(ErrorDeImportacion);
    expect((e as ErrorDeImportacion).codigo).toBe('virtual-fuera-de-limite');
    expect((e as ErrorDeImportacion).message).toBe(
      'Ninguna dificultad entra en el límite del audio virtual (10 minutos y 60 000 sonidos).',
    );
  });

  it('un evento justo en los 10 minutos entra', async () => {
    const r = await importarArchivoOsz(
      oszVirtual({
        'largo.osu': osuVirtual({
          version: 'Largo',
          notas: ['64,192,1000,1,0,0:0:0:0:a.ogg'],
          samples: ['Sample,600000,0,"a.ogg",100'],
        }),
      }),
    );
    expect(r.canciones).toHaveLength(1);
  });
});

describe('exportar una cancion virtual', () => {
  it('el .osz lleva las muestras y AudioFilename virtual, y reimportarlo da ya-estaba', async () => {
    const r = await importarArchivoOsz(setDeDosPiezas());
    const canon = r.canciones[0]!;
    const exportado = await exportarCancion(canon.id);
    const zip = unzipSync(new Uint8Array(await exportado.arrayBuffer()));
    expect(Object.keys(zip).filter((n) => n.endsWith('.ogg')).sort()).toEqual([
      'a.ogg',
      'compartida.ogg',
    ]);
    expect(Array.from(zip['a.ogg']!)).toEqual(Array.from(BYTES['a.ogg']!));
    const osus = Object.keys(zip).filter((n) => n.endsWith('.osu'));
    expect(osus).toHaveLength(1);
    const texto = new TextDecoder().decode(zip[osus[0]!]);
    expect(texto).toContain('AudioFilename: virtual');
    expect(texto).toContain('Sample,1000,0,"a.ogg",80');
    expect(texto).toContain('Sample,2000,0,"compartida.ogg",60');
    expect(texto).not.toContain(':a.ogg');

    const otra = await importarArchivoOsz(exportado);
    expect(otra.canciones).toHaveLength(1);
    expect(otra.canciones[0]!.estado).toBe('ya-estaba');
    expect(otra.canciones[0]!.id).toBe(canon.id);
    expect(await listarMuestrasDeLaBase()).toHaveLength(3);
  });

  it('el .osz exportado entra en una biblioteca vacia con la misma receta', async () => {
    const r = await importarArchivoOsz(setDeDosPiezas());
    const original = (await listarCanciones()).find((c) => c.id === r.canciones[0]!.id)!;
    const exportado = await exportarCancion(original.id);
    await vaciarBase();
    const nueva = await importarArchivoOsz(exportado);
    expect(nueva.canciones[0]!.estado).toBe('nueva');
    const cancion = (await listarCanciones())[0]!;
    expect(cancion.dificultades[0]!.audioVirtual).toEqual(original.dificultades[0]!.audioVirtual);
    expect(cancion.keysounds).toEqual(original.keysounds);
  });
});

describe('migracion no destructiva a VERSION_BASE 9 (tienda "muestras")', () => {
  it('una base v8 real conserva todo y gana la tienda', async () => {
    // Una base v8 tal cual la dejaba T-065: las ocho tiendas con sus indices.
    await new Promise<void>((resolve, reject) => {
      const peticion = indexedDB.open(NOMBRE_BASE, 8);
      peticion.onupgradeneeded = () => {
        const db = peticion.result;
        db.createObjectStore('mapas', { keyPath: 'id' });
        db.createObjectStore('skins', { keyPath: 'id' });
        db.createObjectStore('canciones', { keyPath: 'id' });
        db.createObjectStore('dificultades', { keyPath: 'clave' });
        db.createObjectStore('records', { keyPath: 'hash' });
        db.createObjectStore('replays', { keyPath: 'hash' });
        db.createObjectStore('historial');
        const recientes = db.createObjectStore('recientes', { keyPath: 'id' });
        recientes.createIndex('hash', 'hash');
        recientes.createIndex('fecha', 'fecha');
      };
      peticion.onsuccess = () => {
        const db = peticion.result;
        const tx = db.transaction(['canciones', 'records'], 'readwrite');
        tx.objectStore('canciones').put({
          id: 'cancion-v8',
          titulo: 'Cancion de la version 8',
          artista: 'Artista viejo',
          audio: new Blob([new Uint8Array([1, 2, 3])]),
          dificultades: [],
        });
        const partida = {
          score: 123_456,
          accuracy: 0.9,
          maxCombo: 10,
          counts: { max: 1, perfect: 1, great: 0, good: 0, bad: 0, miss: 0 },
          rango: 'B',
          fecha: '2026-10-01T00:00:00.000Z',
        };
        tx.objectStore('records').put({ hash: 'h8', mejor: partida, ultima: partida, intentos: 2 });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      peticion.onerror = () => reject(peticion.error);
    });

    // Lo de antes sigue ahi, leido con el codigo real (que sube la base a la 9).
    const canciones = await listarCanciones();
    expect(canciones.map((c) => c.id)).toEqual(['cancion-v8']);
    expect(canciones[0]!.audio!.size).toBe(3);
    expect(esCancionVirtual(canciones[0]!)).toBe(false);
    expect((await leerRecords(['h8'])).get('h8')!.mejor.score).toBe(123_456);

    const info = await new Promise<{ version: number; tiendas: string[]; keyPath: unknown }>(
      (resolve, reject) => {
        const peticion = indexedDB.open(NOMBRE_BASE);
        peticion.onsuccess = () => {
          const db = peticion.result;
          resolve({
            version: db.version,
            tiendas: Array.from(db.objectStoreNames).sort(),
            keyPath: db.transaction('muestras', 'readonly').objectStore('muestras').keyPath,
          });
          db.close();
        };
        peticion.onerror = () => reject(peticion.error);
      },
    );
    expect(info.version).toBe(9);
    expect(info.keyPath).toBe('hash');
    expect(info.tiendas).toEqual([
      'canciones',
      'dificultades',
      'historial',
      'mapas',
      'muestras',
      'recientes',
      'records',
      'replays',
      'skins',
    ]);

    // Y la tienda nueva funciona: un set virtual entra y la vieja sigue intacta.
    await importarArchivoOsz(setDeDosPiezas());
    expect(await listarCanciones()).toHaveLength(3);
    expect(await listarMuestrasDeLaBase()).toHaveLength(3);
    await borrarCancion('cancion-v8');
    expect(await listarCanciones()).toHaveLength(2);
  });
});

describe('respaldo con canciones virtuales', () => {
  it('las muestras viajan una vez y vuelven en una biblioteca vacia', async () => {
    const r = await importarArchivoOsz(setDeDosPiezas());
    const zip = await crearRespaldo();
    const archivos = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    // 3 muestras distintas aunque la compartida la usen dos canciones.
    expect(Object.keys(archivos).filter((n) => n.startsWith('muestras/'))).toHaveLength(3);
    // ninguna cancion virtual lleva audio de pista
    expect(Object.keys(archivos).filter((n) => /canciones\/\d+\/audio/.test(n))).toHaveLength(0);

    const contenido = await leerRespaldo(zip);
    expect(contenido.muestras).toHaveLength(3);
    expect(contenido.canciones.every((c) => c.audio === undefined)).toBe(true);
    expect(contenido.canciones.map((c) => c.keysounds).every((k) => k !== undefined)).toBe(true);

    await vaciarBase();
    const resumen = await restaurarRespaldo(contenido, { sobrescribirAjustes: false });
    expect(resumen.cancionesNuevas).toBe(2);
    const restauradas = await listarCanciones();
    expect(restauradas).toHaveLength(2);
    expect(restauradas.every(esCancionVirtual)).toBe(true);
    expect(await listarMuestrasDeLaBase()).toHaveLength(3);
    // y se puede exportar: las muestras llegaron
    const exportado = await exportarCancion(r.canciones[0]!.id);
    const dentro = unzipSync(new Uint8Array(await exportado.arrayBuffer()));
    expect(Array.from(dentro['a.ogg']!)).toEqual(Array.from(BYTES['a.ogg']!));
  });

  it('restaurar dos veces no duplica nada', async () => {
    await importarArchivoOsz(setDeDosPiezas());
    const contenido = await leerRespaldo(await crearRespaldo());
    const resumen = await restaurarRespaldo(contenido, { sobrescribirAjustes: false });
    expect(resumen.cancionesNuevas).toBe(0);
    expect(resumen.cancionesExistentes).toBe(2);
    expect(await listarMuestrasDeLaBase()).toHaveLength(3);
  });

  it('un respaldo con una cancion sin audio ni sonidos es un respaldo danado', async () => {
    await importarArchivoOsz(setDeDosPiezas());
    const archivos = unzipSync(new Uint8Array(await (await crearRespaldo()).arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(archivos['manifest.json']));
    delete manifest.canciones[0].keysounds;
    archivos['manifest.json'] = strToU8(JSON.stringify(manifest));
    await expect(
      leerRespaldo(new Blob([new Uint8Array(zipSync(archivos))])),
    ).rejects.toThrow(/no tiene audio/);
  });
});
