// Tests de T-042: copia de seguridad (exportar, leer, restaurar). fake-indexeddb
// para la base y un localStorage falso (vitest corre en node, que no trae uno).

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { hashMapa } from '@tetra/core';
import type { Judgement, PartidaJugada, RecordDeMapa } from '@tetra/core';
import {
  ErrorDeRespaldo,
  crearRespaldo,
  exportarRespaldo,
  guardarPartida,
  importarOsk,
  importarOsz,
  leerRecords,
  leerRespaldo,
  listarCanciones,
  listarSkins,
  mezclarRecords,
  restaurarRespaldo,
  reunirContenidoActual,
} from './index.js';

class AlmacenFalso {
  private datos = new Map<string, string>();
  get length(): number {
    return this.datos.size;
  }
  key(i: number): string | null {
    return [...this.datos.keys()][i] ?? null;
  }
  getItem(clave: string): string | null {
    return this.datos.get(clave) ?? null;
  }
  setItem(clave: string, valor: string): void {
    this.datos.set(clave, valor);
  }
  removeItem(clave: string): void {
    this.datos.delete(clave);
  }
  clear(): void {
    this.datos.clear();
  }
}

let almacen: AlmacenFalso;

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
  await vaciarBase();
  almacen = new AlmacenFalso();
  vi.stubGlobal('localStorage', almacen);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

/** Bytes que no son todos iguales ni cortos: una copia que pierda o reordene bytes se nota. */
function bytesDe(semilla: number, largo = 300): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(largo);
  for (let i = 0; i < largo; i++) bytes[i] = (i * 7 + semilla) % 256;
  return bytes;
}

const AUDIO = bytesDe(1);
const FONDO = bytesDe(2);
const VIDEO = bytesDe(3);
const IMAGEN_SKIN = bytesDe(4, 80);

function osu(titulo: string, version: string, extraEventos: string[], notas: string[]): string {
  return `osu file format v14

[General]
AudioFilename: audio.wav
Mode: 3

[Metadata]
Title:${titulo}
Artist:Artista
Creator:Arnold
Version:${version}

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:6

[Events]
${extraEventos.join('\n')}

[TimingPoints]
0,500,4,2,1,50,1,0

[HitObjects]
${notas.join('\n')}
`;
}

const NOTAS = ['64,192,0,1,0,0:0:0:0:', '192,192,500,1,0,0:0:0:0:', '320,192,1000,128,0,1500:0:0:0:0:'];

/** Importa una cancion de verdad (el mismo camino que usa la app) y devuelve su id. */
async function importarCancion(titulo: string, conMultimedia: boolean): Promise<string> {
  const entradas: Record<string, Uint8Array> = {
    'audio.wav': AUDIO,
    'Normal.osu': strToU8(
      osu(titulo, 'Normal', conMultimedia ? ['0,0,"bg.jpg",0,0', 'Video,-120,"vid.mp4"'] : [], NOTAS),
    ),
    'Dificil.osu': strToU8(osu(titulo, 'Dificil', [], [...NOTAS, '448,192,1500,1,0,0:0:0:0:'])),
  };
  if (conMultimedia) {
    entradas['bg.jpg'] = FONDO;
    entradas['vid.mp4'] = VIDEO;
  }
  return importarOsz(new Blob([new Uint8Array(zipSync(entradas))]));
}

async function importarSkin(): Promise<string> {
  const osk = zipSync({ 'mania-note1.png': IMAGEN_SKIN, 'mania-key1.PNG': IMAGEN_SKIN });
  return importarOsk(new File([new Uint8Array(osk)], 'Mi skin.osk'));
}

function conteos(valores: Partial<Record<Judgement, number>> = {}): Record<Judgement, number> {
  return { max: 0, perfect: 0, great: 0, good: 0, bad: 0, miss: 0, ...valores };
}

function partida(score: number, fecha: string, extra: Partial<PartidaJugada> = {}): PartidaJugada {
  return {
    score,
    accuracy: score / 1_000_000,
    maxCombo: 5,
    counts: conteos({ max: 3, miss: 1 }),
    rango: 'B',
    fecha,
    ...extra,
  };
}

async function bytesDeBlob(blob: Blob | undefined): Promise<number[]> {
  expect(blob).toBeInstanceOf(Blob);
  return Array.from(new Uint8Array(await blob!.arrayBuffer()));
}

/** Una biblioteca con dos canciones (una con fondo y video), una skin, un record y ajustes. */
async function armarBiblioteca(): Promise<{ hashes: string[] }> {
  await importarCancion('Con multimedia', true);
  await importarCancion('Solo audio', false);
  await importarSkin();
  const cancion = (await listarCanciones()).find((c) => c.titulo === 'Con multimedia')!;
  const hashes = cancion.dificultades.map((d) => String(hashMapa(d)));
  await guardarPartida(hashes[0]!, partida(900_000, '2026-10-01T10:00:00.000Z'));
  await guardarPartida(hashes[0]!, partida(800_000, '2026-10-02T10:00:00.000Z', { pulsaciones: [1, 2, 3, 4] }));
  almacen.setItem('tetra:velocidad-usuario', '24');
  almacen.setItem('tetra:offset-usuario', '-12');
  almacen.setItem('tetra:offset-local:abc', '5');
  return { hashes };
}

// ---------------------------------------------------------------------------
// Ida y vuelta
// ---------------------------------------------------------------------------

describe('respaldo: ida y vuelta', () => {
  it('el zip trae los Blob como archivos y el manifest no los contiene', async () => {
    await armarBiblioteca();
    const zip = await crearRespaldo();
    const archivos = unzipSync(new Uint8Array(await zip.arrayBuffer()));

    const nombres = Object.keys(archivos).sort();
    expect(nombres).toContain('manifest.json');
    const audios = nombres.filter((n) => /^canciones\/\d+\/audio\.wav$/.test(n));
    expect(audios).toHaveLength(2);
    // Los bytes del audio estan tal cual en el zip (un JSON.stringify de Blob da `{}` y no los traeria).
    for (const nombre of audios) expect(Array.from(archivos[nombre]!)).toEqual(Array.from(AUDIO));
    expect(nombres.filter((n) => /^canciones\/\d+\/fondo\.jpg$/.test(n))).toHaveLength(1);
    expect(nombres.filter((n) => /^canciones\/\d+\/video\.mp4$/.test(n))).toHaveLength(1);
    expect(nombres.some((n) => /^skins\/0\/note1\.png$/.test(n))).toBe(true);

    const manifest = JSON.parse(new TextDecoder().decode(archivos['manifest.json']!)) as {
      formato: string;
      version: number;
      canciones: { audio: { archivo: string; tipo: string } }[];
    };
    expect(manifest.formato).toBe('tetra-respaldo');
    expect(manifest.version).toBe(1);
    expect(manifest.canciones[0]!.audio.archivo).toMatch(/^canciones\/\d+\/audio\.wav$/);
    expect(manifest.canciones[0]!.audio.tipo).toBe('audio/wav');
  });

  it('exportar y restaurar en una base vacia reproduce canciones, skins, records y ajustes', async () => {
    await armarBiblioteca();
    const antes = await reunirContenidoActual();
    const zip = await crearRespaldo();

    await vaciarBase();
    almacen.clear();
    expect(await listarCanciones()).toHaveLength(0);

    const leido = await leerRespaldo(zip);
    const resumen = await restaurarRespaldo(leido, { sobrescribirAjustes: true });
    expect(resumen).toEqual({
      cancionesNuevas: 2,
      cancionesExistentes: 0,
      skinsNuevas: 1,
      skinsExistentes: 0,
      recordsNuevos: 1,
      recordsActualizados: 0,
      replaysNuevos: 0,
      ajustesRestaurados: 3,
    });

    const despues = await listarCanciones();
    expect(despues).toHaveLength(2);
    for (const original of antes.canciones) {
      const copia = despues.find((c) => c.id === original.id)!;
      expect(copia).toBeDefined();
      // Mismos ids, mismas notas (la dificultad entera), mismos metadatos.
      expect(copia.titulo).toBe(original.titulo);
      expect(copia.artista).toBe(original.artista);
      expect(copia.dificultades).toEqual(original.dificultades);
      expect(copia.importadaEn).toBe(original.importadaEn);
      expect(copia.videoOffset).toBe(original.videoOffset);
      // Mismo audio, byte por byte (y el mismo tipo MIME).
      expect(await bytesDeBlob(copia.audio)).toEqual(await bytesDeBlob(original.audio));
      expect(copia.audio.type).toBe('audio/wav');
      expect(copia.background === undefined).toBe(original.background === undefined);
      expect(copia.video === undefined).toBe(original.video === undefined);
    }
    const conMultimedia = despues.find((c) => c.titulo === 'Con multimedia')!;
    expect(await bytesDeBlob(conMultimedia.background)).toEqual(Array.from(FONDO));
    expect(await bytesDeBlob(conMultimedia.video)).toEqual(Array.from(VIDEO));
    expect(conMultimedia.video!.type).toBe('video/mp4');
    expect(conMultimedia.videoOffset).toBe(-120);
    const soloAudio = despues.find((c) => c.titulo === 'Solo audio')!;
    expect('background' in soloAudio).toBe(false);
    expect('video' in soloAudio).toBe(false);

    const skins = await listarSkins();
    expect(skins).toHaveLength(1);
    expect(skins[0]!.id).toBe(antes.skins[0]!.id);
    expect(skins[0]!.nombre).toBe('Mi skin.osk');
    expect(await bytesDeBlob(skins[0]!.imagenes.note1)).toEqual(Array.from(IMAGEN_SKIN));
    expect(await bytesDeBlob(skins[0]!.imagenes.key1)).toEqual(Array.from(IMAGEN_SKIN));
    expect(skins[0]!.imagenes.note2).toBeUndefined();

    const hash = antes.records[0]!.hash;
    expect((await leerRecords([hash])).get(hash)).toEqual(antes.records[0]);

    expect(almacen.getItem('tetra:velocidad-usuario')).toBe('24');
    expect(almacen.getItem('tetra:offset-usuario')).toBe('-12');
    expect(almacen.getItem('tetra:offset-local:abc')).toBe('5');
  });

  it('importar dos veces seguidas no duplica nada ni cambia los records', async () => {
    await armarBiblioteca();
    const zip = await crearRespaldo();
    const antes = await reunirContenidoActual();

    const primero = await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: true });
    const segundo = await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: true });

    expect(primero.cancionesNuevas).toBe(0);
    expect(primero.cancionesExistentes).toBe(2);
    expect(segundo).toEqual(primero);
    expect(segundo.recordsNuevos + segundo.recordsActualizados).toBe(0);
    expect(segundo.skinsNuevas).toBe(0);
    const despues = await reunirContenidoActual();
    expect(despues.canciones).toHaveLength(2);
    expect(despues.skins).toHaveLength(1);
    expect(despues.records).toEqual(antes.records);
  });

  it('una cancion con el mismo id no se pisa: queda la que ya estaba', async () => {
    await armarBiblioteca();
    const zip = await crearRespaldo();
    const [original] = await listarCanciones();
    // La cancion local cambia despues del respaldo (otro audio, otro titulo).
    const { guardarCancion } = await import('./db.js');
    const otroAudio = new Blob([new Uint8Array([9, 9, 9])], { type: 'audio/wav' });
    await guardarCancion({ ...original!, titulo: 'Editada despues', audio: otroAudio });

    const resumen = await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: false });
    expect(resumen.cancionesExistentes).toBe(2);
    expect(resumen.cancionesNuevas).toBe(0);
    const actual = (await listarCanciones()).find((c) => c.id === original!.id)!;
    expect(actual.titulo).toBe('Editada despues');
    expect(await bytesDeBlob(actual.audio)).toEqual([9, 9, 9]);
  });

  it('canciones repetidas dentro del mismo respaldo se cuentan una vez como nueva y la otra como existente', async () => {
    await importarCancion('Una', false);
    const contenido = await reunirContenidoActual();
    await vaciarBase();
    const resumen = await restaurarRespaldo(
      { ...contenido, canciones: [contenido.canciones[0]!, contenido.canciones[0]!] },
      { sobrescribirAjustes: false },
    );
    expect(resumen.cancionesNuevas).toBe(1);
    expect(resumen.cancionesExistentes).toBe(1);
    expect(await listarCanciones()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

describe('respaldo: ajustes', () => {
  it('sin sobrescribirAjustes no se toca ningun ajuste; con el, se escriben', async () => {
    almacen.setItem('tetra:velocidad-usuario', '24');
    const zip = await crearRespaldo();
    almacen.setItem('tetra:velocidad-usuario', '10');

    const sin = await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: false });
    expect(sin.ajustesRestaurados).toBe(0);
    expect(almacen.getItem('tetra:velocidad-usuario')).toBe('10');

    const con = await restaurarRespaldo(await leerRespaldo(zip), { sobrescribirAjustes: true });
    expect(con.ajustesRestaurados).toBe(1);
    expect(almacen.getItem('tetra:velocidad-usuario')).toBe('24');
  });

  it('solo viajan claves tetra:*; tetra:mudo y las ajenas se quedan afuera', async () => {
    almacen.setItem('tetra:volumen-musica', '0.5');
    almacen.setItem('tetra:mudo', '1');
    almacen.setItem('otra-app:cosa', 'x');
    const contenido = await reunirContenidoActual();
    expect(contenido.ajustes).toEqual({ 'tetra:volumen-musica': '0.5' });

    // Un respaldo armado a mano que trae claves ajenas: al leerlo se descartan.
    const zip = await exportarRespaldo({
      ...contenido,
      ajustes: { 'tetra:volumen-musica': '0.5', 'tetra:mudo': '1', 'otra-app:cosa': 'x' },
    });
    const leido = await leerRespaldo(zip);
    expect(leido.ajustes).toEqual({ 'tetra:volumen-musica': '0.5' });
  });
});

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

describe('mezclarRecords y records al restaurar', () => {
  function record(
    hash: string,
    mejor: PartidaJugada,
    ultima: PartidaJugada,
    intentos: number,
  ): RecordDeMapa {
    return { hash, mejor, ultima, intentos };
  }
  const p1 = partida(500_000, '2026-10-01T00:00:00.000Z');
  const p2 = partida(700_000, '2026-10-02T00:00:00.000Z');
  const p3 = partida(600_000, '2026-10-03T00:00:00.000Z');

  it('sin record previo gana el entrante', () => {
    const entrante = record('h', p2, p2, 2);
    expect(mezclarRecords(undefined, entrante)).toBe(entrante);
  });

  it('el mejor es el de mayor score, la ultima la mas reciente y los intentos el mayor', () => {
    const previo = record('h', p1, p3, 2);
    const entrante = record('h', p2, p2, 5);
    expect(mezclarRecords(previo, entrante)).toEqual({ hash: 'h', mejor: p2, ultima: p3, intentos: 5 });
  });

  it('si el previo ya lo cubre todo no hay nada que escribir', () => {
    const previo = record('h', p2, p3, 5);
    const entrante = record('h', { ...p1 }, { ...p2 }, 3);
    expect(mezclarRecords(previo, entrante)).toBeUndefined();
    // El mismo record que ya esta: idempotente.
    expect(mezclarRecords(previo, structuredClone(previo))).toBeUndefined();
  });

  it('al restaurar, un record local mejor no se pisa y uno del respaldo mejor lo mejora', async () => {
    const id = await importarCancion('Con records', false);
    const cancion = (await listarCanciones()).find((c) => c.id === id)!;
    const hash = String(hashMapa(cancion.dificultades[0]!));
    await guardarPartida(hash, partida(900_000, '2026-10-01T10:00:00.000Z'));
    const zipPeor = await crearRespaldo();

    // Local mejora despues del respaldo: restaurar el respaldo viejo no lo baja.
    await guardarPartida(hash, partida(950_000, '2026-10-05T10:00:00.000Z'));
    const peor = await restaurarRespaldo(await leerRespaldo(zipPeor), { sobrescribirAjustes: false });
    expect(peor.recordsActualizados + peor.recordsNuevos).toBe(0);
    expect((await leerRecords([hash])).get(hash)!.mejor.score).toBe(950_000);

    // Al reves: el respaldo trae un mejor que el local.
    const zipMejor = await crearRespaldo();
    await vaciarBase();
    await importarCancion('Con records', false);
    const nueva = (await listarCanciones())[0]!;
    await guardarPartida(String(hashMapa(nueva.dificultades[0]!)), partida(100_000, '2026-10-06T00:00:00.000Z'));
    const mejor = await restaurarRespaldo(await leerRespaldo(zipMejor), { sobrescribirAjustes: false });
    expect(mejor.recordsActualizados).toBe(1);
    const resultante = (await leerRecords([hash])).get(hash)!;
    expect(resultante.mejor.score).toBe(950_000);
    // La ultima local (2026-10-06) es mas reciente que la del respaldo (2026-10-05): se queda.
    expect(resultante.ultima.score).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// Respaldos que no sirven
// ---------------------------------------------------------------------------

describe('leerRespaldo: rechaza lo que no sirve sin tocar nada', () => {
  function zipConManifest(manifest: unknown, extra: Record<string, Uint8Array> = {}): Blob {
    return new Blob([
      new Uint8Array(zipSync({ ...extra, 'manifest.json': strToU8(JSON.stringify(manifest)) })),
    ]);
  }
  const base = { formato: 'tetra-respaldo', version: 1, canciones: [], skins: [], records: [], ajustes: {} };

  async function mensajeDe(zip: Blob): Promise<string> {
    const error = await leerRespaldo(zip).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ErrorDeRespaldo);
    return (error as Error).message;
  }

  it('un archivo que no es un zip', async () => {
    expect(await mensajeDe(new Blob([bytesDe(7, 100)]))).toContain('no es un zip');
    expect(await mensajeDe(new Blob([]))).toContain('no es un zip');
  });

  it('un zip sin manifest.json (por ejemplo un .osz)', async () => {
    const osz = new Blob([new Uint8Array(zipSync({ 'audio.wav': AUDIO }))]);
    expect(await mensajeDe(osz)).toContain('manifest.json');
  });

  it('un manifest que no es JSON o no es de Tetra', async () => {
    const roto = new Blob([new Uint8Array(zipSync({ 'manifest.json': strToU8('{no es json') }))]);
    expect(await mensajeDe(roto)).toContain('danado');
    expect(await mensajeDe(zipConManifest({ hola: 1 }))).toContain('no es un respaldo de Tetra');
    expect(await mensajeDe(zipConManifest([1, 2]))).toContain('no es un respaldo de Tetra');
  });

  it('una version futura o desconocida', async () => {
    expect(await mensajeDe(zipConManifest({ ...base, version: 2 }))).toContain('mas nueva');
    expect(await mensajeDe(zipConManifest({ ...base, version: 0 }))).toContain('version');
    expect(await mensajeDe(zipConManifest({ ...base, version: '1' }))).toContain('version');
  });

  it('un manifest al que le faltan secciones', async () => {
    // JSON.stringify descarta `records: undefined`, o sea que el manifest queda sin esa clave.
    expect(await mensajeDe(zipConManifest({ ...base, records: undefined }))).toContain('danado');
    expect(await mensajeDe(zipConManifest({ ...base, ajustes: [] }))).toContain('danado');
  });

  it('un blob que el manifest nombra y el zip no trae', async () => {
    await importarCancion('Rota', false);
    const zip = await crearRespaldo();
    const archivos = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const sinAudio = Object.fromEntries(Object.entries(archivos).filter(([n]) => !n.endsWith('audio.wav')));
    const incompleto = new Blob([new Uint8Array(zipSync(sinAudio))]);
    expect(await mensajeDe(incompleto)).toContain('incompleto');
  });

  it('una cancion sin dificultades o con una dificultad invalida', async () => {
    await importarCancion('Rota', false);
    const zip = await crearRespaldo();
    const archivos = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(archivos['manifest.json']!)) as {
      canciones: { dificultades: unknown[] }[];
    };

    const sinDificultades = structuredClone(manifest);
    sinDificultades.canciones[0]!.dificultades = [];
    expect(await mensajeDe(zipConManifest(sinDificultades, archivos))).toContain('dificultades');

    const invalida = structuredClone(manifest);
    invalida.canciones[0]!.dificultades = [{ metadata: {}, notes: 'no' }];
    expect(await mensajeDe(zipConManifest(invalida, archivos))).toContain('invalida');
  });

  it('un respaldo invalido no toca lo que ya hay', async () => {
    await armarBiblioteca();
    const antes = await reunirContenidoActual();
    await mensajeDe(zipConManifest({ ...base, version: 99 }));
    await mensajeDe(new Blob([bytesDe(1, 50)]));
    const despues = await reunirContenidoActual();
    expect(despues.canciones.map((c) => c.id).sort()).toEqual(antes.canciones.map((c) => c.id).sort());
    expect(despues.records).toEqual(antes.records);
    expect(despues.ajustes).toEqual(antes.ajustes);
  });

  it('los records mal formados se descartan y el resto del respaldo sigue sirviendo', async () => {
    const valido: RecordDeMapa = {
      hash: 'h1',
      mejor: partida(1, '2026-10-01T00:00:00.000Z'),
      ultima: partida(1, '2026-10-01T00:00:00.000Z'),
      intentos: 1,
    };
    const leido = await leerRespaldo(zipConManifest({ ...base, records: [valido, { hash: 'h2' }, 7, null] }));
    expect(leido.records).toEqual([valido]);
  });

  it('un respaldo vacio es valido y no restaura nada', async () => {
    const leido = await leerRespaldo(zipConManifest(base));
    const resumen = await restaurarRespaldo(leido, { sobrescribirAjustes: true });
    expect(resumen).toEqual({
      cancionesNuevas: 0,
      cancionesExistentes: 0,
      skinsNuevas: 0,
      skinsExistentes: 0,
      recordsNuevos: 0,
      recordsActualizados: 0,
      replaysNuevos: 0,
      ajustesRestaurados: 0,
    });
  });
});
