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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import {
  borrarCancion,
  estimarAlmacenamiento,
  exportarCancion,
  importarOsz,
  listarCanciones,
  importarOsk,
  listarSkins,
  pedirAlmacenamientoPersistente,
} from './index.js';

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

// T-049: biblioteca persistente (borrar, exportar, almacenamiento) y fondo/video al importar.

/** .osu con una dificultad (`version`), eventos propios y notas propias. */
function osuConEventos(version: string, eventos: string[], notas: string[]): Uint8Array {
  const texto = OSU_DE_PRUEBA.replace('Version:Normal', `Version:${version}`)
    .replace('[TimingPoints]', `[Events]\n${eventos.join('\n')}\n\n[TimingPoints]`)
    .replace(/\[HitObjects\][\s\S]*$/, `[HitObjects]\n${notas.join('\n')}\n`);
  return new TextEncoder().encode(texto);
}

const AUDIO_BYTES = new Uint8Array([9, 8, 7, 6, 5]);
const FONDO_BYTES = new Uint8Array([1, 1, 2, 2, 3, 3]);
const VIDEO_BYTES = new Uint8Array([4, 4, 4, 5, 5, 5, 5]);

/** Un .osz completo: dos dificultades, fondo con otra capitalizacion y video mp4. */
function oszCompleto(): Blob {
  return armarOsz({
    'Easy.osu': osuConEventos(
      'Easy',
      ['0,0,"bg.jpg",0,0', 'Video,-120,"vid.mp4"'],
      ['64,192,0,1,0,0:0:0:0:', '320,192,500,128,0,900:0:0:0:0:'],
    ),
    'Hard.osu': osuConEventos(
      'Hard',
      ['0,0,"bg.jpg",0,0', 'Video,-120,"vid.mp4"'],
      ['64,192,0,1,0,0:0:0:0:', '192,192,250,1,0,0:0:0:0:', '448,192,500,1,0,0:0:0:0:'],
    ),
    'audio.wav': AUDIO_BYTES,
    'BG.JPG': FONDO_BYTES,
    'vid.mp4': VIDEO_BYTES,
  });
}

async function bytesDeBlob(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

describe('importarOsz: fondo, video e importadaEn (T-049)', () => {
  it('guarda fondo, video, offset e importadaEn', async () => {
    const antes = Date.now();
    await importarOsz(oszCompleto());
    const despues = Date.now();

    const [c] = await listarCanciones();
    expect(await bytesDeBlob(c!.background!)).toEqual(Array.from(FONDO_BYTES));
    expect(c!.background!.type).toBe('image/jpeg');
    expect(await bytesDeBlob(c!.video!)).toEqual(Array.from(VIDEO_BYTES));
    expect(c!.video!.type).toBe('video/mp4');
    expect(c!.videoOffset).toBe(-120);
    expect(c!.importadaEn).toBeGreaterThanOrEqual(antes);
    expect(c!.importadaEn).toBeLessThanOrEqual(despues);
  });

  it('un .osz con video .avi importa sin video y sin error', async () => {
    const osz = armarOsz({
      'Normal.osu': osuConEventos('Normal', ['Video,0,"vid.avi"'], ['64,192,0,1,0,0:0:0:0:']),
      'audio.wav': AUDIO_BYTES,
      'vid.avi': VIDEO_BYTES,
    });
    await importarOsz(osz);
    const [c] = await listarCanciones();
    expect(c!.video).toBeUndefined();
    expect('video' in c!).toBe(false);
    expect('videoOffset' in c!).toBe(false);
    expect(c!.dificultades).toHaveLength(1);
  });

  it('un .osz sin fondo ni video no guarda esos campos', async () => {
    const osz = armarOsz({
      'mapa.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
      'audio.wav': AUDIO_BYTES,
    });
    await importarOsz(osz);
    const [c] = await listarCanciones();
    expect('background' in c!).toBe(false);
    expect('video' in c!).toBe(false);
  });

  it('pide almacenamiento persistente despues de guardar, sin esperarlo', async () => {
    // Una promesa que nunca se resuelve: si importarOsz la esperara, el test no terminaria.
    const persist = vi.fn(() => new Promise<boolean>(() => {}));
    vi.stubGlobal('navigator', { storage: { persist } });
    try {
      await importarOsz(oszCompleto());
      expect(persist).toHaveBeenCalledTimes(1);
      expect(await listarCanciones()).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('si persist() falla, la importacion igual termina bien', async () => {
    vi.stubGlobal('navigator', {
      storage: { persist: () => Promise.reject(new Error('no')) },
    });
    try {
      await expect(importarOsz(oszCompleto())).resolves.toEqual(expect.any(String));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('borrarCancion', () => {
  it('la saca de listarCanciones y deja las demas', async () => {
    const id1 = await importarOsz(oszCompleto());
    const id2 = await importarOsz(oszCompleto());
    await borrarCancion(id1);
    const ids = (await listarCanciones()).map((c) => c.id);
    expect(ids).toEqual([id2]);
  });

  it('borrar un id que no existe no lanza', async () => {
    await expect(borrarCancion('no-existe')).resolves.toBeUndefined();
  });
});

describe('exportarCancion', () => {
  it('exportar y reimportar da la misma cancion', async () => {
    const id = await importarOsz(oszCompleto());
    const original = (await listarCanciones())[0]!;

    const exportado = await exportarCancion(id);
    expect(exportado.type).toBe('application/zip');
    const id2 = await importarOsz(exportado);
    expect(id2).not.toBe(id);

    const reimportada = (await listarCanciones()).find((c) => c.id === id2)!;
    expect(reimportada.titulo).toBe(original.titulo);
    expect(reimportada.artista).toBe(original.artista);
    expect(reimportada.dificultades.map((d) => d.metadata.difficultyName).sort()).toEqual([
      'Easy',
      'Hard',
    ]);
    for (const d of original.dificultades) {
      const igual = reimportada.dificultades.find(
        (r) => r.metadata.difficultyName === d.metadata.difficultyName,
      )!;
      expect(igual.notes).toEqual(d.notes);
      expect(igual.overallDifficulty).toBe(d.overallDifficulty);
      expect(igual.metadata.creator).toBe(d.metadata.creator);
    }
    expect(await bytesDeBlob(reimportada.audio)).toEqual(Array.from(AUDIO_BYTES));
    expect(await bytesDeBlob(reimportada.background!)).toEqual(Array.from(FONDO_BYTES));
    expect(await bytesDeBlob(reimportada.video!)).toEqual(Array.from(VIDEO_BYTES));
    expect(reimportada.videoOffset).toBe(-120);
  });

  it('el .osz exportado trae audio, fondo, video y un .osu por dificultad', async () => {
    const id = await importarOsz(oszCompleto());
    const zip = unzipSync(new Uint8Array(await (await exportarCancion(id)).arrayBuffer()));
    const nombres = Object.keys(zip).sort();
    expect(nombres.filter((n) => n.endsWith('.osu'))).toHaveLength(2);
    expect(nombres).toContain('audio.wav');
    // El nombre es el que declara el .osu ("bg.jpg"), no el que tenia en el zip original.
    expect(nombres).toContain('bg.jpg');
    expect(nombres).toContain('vid.mp4');
    expect(nombres).toHaveLength(5);
  });

  it('sin fondo ni video exporta solo audio y .osu', async () => {
    const id = await importarOsz(
      armarOsz({
        'mapa.osu': new TextEncoder().encode(OSU_DE_PRUEBA),
        'audio.wav': AUDIO_BYTES,
      }),
    );
    const zip = unzipSync(new Uint8Array(await (await exportarCancion(id)).arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual([
      'Artista de prueba - Cancion de prueba (Arnold) [Normal].osu',
      'audio.wav',
    ]);
  });

  it('un video no reproducible (que no se guardo) no aparece en el .osz exportado', async () => {
    const id = await importarOsz(
      armarOsz({
        'Normal.osu': osuConEventos('Normal', ['Video,0,"vid.avi"'], ['64,192,0,1,0,0:0:0:0:']),
        'audio.wav': AUDIO_BYTES,
        'vid.avi': VIDEO_BYTES,
      }),
    );
    const zip = unzipSync(new Uint8Array(await (await exportarCancion(id)).arrayBuffer()));
    expect(Object.keys(zip).some((n) => n.endsWith('.avi'))).toBe(false);
  });

  it('si dos dificultades declaran fondos distintos, todas apuntan al que viaja en el zip', async () => {
    const id = await importarOsz(
      armarOsz({
        'A.osu': osuConEventos('A', ['0,0,"uno.jpg",0,0'], ['64,192,0,1,0,0:0:0:0:']),
        'B.osu': osuConEventos('B', ['0,0,"dos.jpg",0,0'], ['64,192,0,1,0,0:0:0:0:']),
        'audio.wav': AUDIO_BYTES,
        'uno.jpg': FONDO_BYTES,
        'dos.jpg': new Uint8Array([0]),
      }),
    );
    const zip = unzipSync(new Uint8Array(await (await exportarCancion(id)).arrayBuffer()));
    const textos = Object.entries(zip)
      .filter(([n]) => n.endsWith('.osu'))
      .map(([, bytes]) => new TextDecoder().decode(bytes));
    expect(textos).toHaveLength(2);
    for (const t of textos) expect(t).toContain('0,0,"uno.jpg",0,0');
    expect(Object.keys(zip)).toContain('uno.jpg');
    expect(Object.keys(zip)).not.toContain('dos.jpg');
  });

  it('rechaza con un mensaje claro si la cancion no existe', async () => {
    await expect(exportarCancion('no-existe')).rejects.toThrow(/no está en la biblioteca/);
  });
});

describe('almacenamiento persistente y cuota', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pedirAlmacenamientoPersistente devuelve lo que responde persist()', async () => {
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.resolve(true) } });
    expect(await pedirAlmacenamientoPersistente()).toBe(true);
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.resolve(false) } });
    expect(await pedirAlmacenamientoPersistente()).toBe(false);
  });

  it('devuelve false (y no lanza) si la API no existe', async () => {
    vi.stubGlobal('navigator', {});
    expect(await pedirAlmacenamientoPersistente()).toBe(false);
    vi.stubGlobal('navigator', undefined);
    expect(await pedirAlmacenamientoPersistente()).toBe(false);
  });

  it('devuelve false (y no lanza) si persist() lanza o rechaza', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persist: () => {
          throw new Error('sincrono');
        },
      },
    });
    expect(await pedirAlmacenamientoPersistente()).toBe(false);
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.reject(new Error('async')) } });
    expect(await pedirAlmacenamientoPersistente()).toBe(false);
  });

  it('estimarAlmacenamiento traduce usage y quota a usado y cuota', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: () => Promise.resolve({ usage: 1500, quota: 1_000_000 }) },
    });
    expect(await estimarAlmacenamiento()).toEqual({ usado: 1500, cuota: 1_000_000 });
  });

  it('estimarAlmacenamiento devuelve undefined si no hay API, faltan datos o falla', async () => {
    vi.stubGlobal('navigator', {});
    expect(await estimarAlmacenamiento()).toBeUndefined();
    vi.stubGlobal('navigator', { storage: { estimate: () => Promise.resolve({ usage: 5 }) } });
    expect(await estimarAlmacenamiento()).toBeUndefined();
    vi.stubGlobal('navigator', { storage: { estimate: () => Promise.reject(new Error('x')) } });
    expect(await estimarAlmacenamiento()).toBeUndefined();
  });
});
