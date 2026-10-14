// Tests de T-066 (paso 1) contra IndexedDB (fake-indexeddb): importar dos veces
// no duplica (D3) y fusionarDuplicados (D4) deja una cancion sin perder
// records, replays ni recientes.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { hashMapa } from '@tetra/core';
import type { Judgement, PartidaJugada, Replay } from '@tetra/core';
import {
  ErrorDeImportacion,
  fusionarDuplicados,
  guardarDificultad,
  guardarPartida,
  importarArchivoOsz,
  leerCancion,
  leerRecords,
  leerReplayGuardado,
  listarCanciones,
  listarPartidasRecientes,
} from './index.js';
import { guardarCancion } from './db.js';

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

function osu(version: string, notas: string[], extra = ''): string {
  return `osu file format v14

[General]
AudioFilename: audio.wav
Mode: 3

[Metadata]
Title:Cancion de dedupe
Artist:Artista
Creator:Arnold
Version:${version}
${extra}
[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:6

[Events]
${extra.includes('fondo') ? '0,0,"fondo.jpg",0,0' : ''}

[TimingPoints]
0,500,4,2,1,50,1,0

[HitObjects]
${notas.join('\n')}
`;
}

const NOTAS_A = ['64,192,0,1,0,0:0:0:0:', '192,192,500,1,0,0:0:0:0:'];
const NOTAS_B = ['64,192,0,1,0,0:0:0:0:', '320,192,500,1,0,0:0:0:0:', '448,192,1000,1,0,0:0:0:0:'];
const NOTAS_C = ['448,192,0,1,0,0:0:0:0:', '320,192,250,1,0,0:0:0:0:'];

function oszDe(
  dificultades: Record<string, { notas: string[]; extra?: string }>,
  adicionales: Record<string, Uint8Array> = {},
): Blob {
  const entradas: Record<string, Uint8Array> = {
    'audio.wav': new Uint8Array([1]),
    ...adicionales,
  };
  for (const [version, { notas, extra }] of Object.entries(dificultades)) {
    entradas[`${version}.osu`] = new TextEncoder().encode(osu(version, notas, extra));
  }
  return new Blob([new Uint8Array(zipSync(entradas))]);
}

const nombres = (c: { dificultades: { metadata: { difficultyName: string } }[] }): string[] =>
  c.dificultades.map((d) => d.metadata.difficultyName);

describe('importarArchivoOsz: no duplica (D3)', () => {
  it('importar dos veces el mismo .osz deja una sola cancion: nueva y despues ya-estaba, con el mismo id', async () => {
    const osz = oszDe({ Normal: { notas: NOTAS_A } });
    const primera = await importarArchivoOsz(osz);
    const segunda = await importarArchivoOsz(osz);

    expect(primera.canciones).toHaveLength(1);
    expect(primera.canciones[0]).toMatchObject({
      estado: 'nueva',
      titulo: 'Cancion de dedupe',
      dificultadesAgregadas: 0,
      dificultadesActualizadas: 0,
      archivosCompletados: false,
    });
    expect(segunda.canciones[0]!.estado).toBe('ya-estaba');
    expect(segunda.canciones[0]!.id).toBe(primera.canciones[0]!.id);
    expect(await listarCanciones()).toHaveLength(1);
  });

  it('reimportar con una dificultad mas la agrega: actualizada, mismo id', async () => {
    const primera = await importarArchivoOsz(oszDe({ Normal: { notas: NOTAS_A } }));
    const segunda = await importarArchivoOsz(
      oszDe({ Normal: { notas: NOTAS_A }, Hard: { notas: NOTAS_B } }),
    );
    expect(segunda.canciones[0]).toMatchObject({
      estado: 'actualizada',
      dificultadesAgregadas: 1,
      dificultadesActualizadas: 0,
      id: primera.canciones[0]!.id,
    });
    const cancion = (await listarCanciones())[0]!;
    expect(nombres(cancion)).toEqual(['Normal', 'Hard']);
    expect(await listarCanciones()).toHaveLength(1);
  });

  it('el mismo BeatmapID con notas distintas reemplaza en su posicion y el record viejo sigue en la base', async () => {
    const id = 'BeatmapID:555';
    const primera = await importarArchivoOsz(
      oszDe({ Easy: { notas: NOTAS_C }, Normal: { notas: NOTAS_A, extra: id } }),
    );
    const cancion1 = (await listarCanciones())[0]!;
    const hashViejo = String(hashMapa(cancion1.dificultades[1]!));
    await guardarPartida(hashViejo, partida(900_000));

    const segunda = await importarArchivoOsz(
      oszDe({ Easy: { notas: NOTAS_C }, Normal: { notas: NOTAS_B, extra: id } }),
    );
    expect(segunda.canciones[0]).toMatchObject({
      estado: 'actualizada',
      dificultadesAgregadas: 0,
      dificultadesActualizadas: 1,
      id: primera.canciones[0]!.id,
    });
    const cancion = (await listarCanciones())[0]!;
    expect(nombres(cancion)).toEqual(['Easy', 'Normal']);
    expect(cancion.dificultades[1]!.notes).toHaveLength(3);
    expect((await leerRecords([hashViejo])).size).toBe(1);
  });

  it('reimportar sobre una cancion sin fondo la completa', async () => {
    await importarArchivoOsz(oszDe({ Normal: { notas: NOTAS_A } }));
    expect((await listarCanciones())[0]!.background).toBeUndefined();

    const r = await importarArchivoOsz(
      oszDe(
        { Normal: { notas: NOTAS_A, extra: 'Tags:fondo' } },
        { 'fondo.jpg': new Uint8Array([7, 7, 7]) },
      ),
    );
    expect(r.canciones[0]).toMatchObject({ estado: 'actualizada', archivosCompletados: true });
    const cancion = (await listarCanciones())[0]!;
    expect(await listarCanciones()).toHaveLength(1);
    expect(cancion.background?.size).toBe(3);
  });

  it('una dificultad agregada desde el mapeador sobrevive a la reimportacion', async () => {
    const osz = oszDe({ Normal: { notas: NOTAS_A } });
    const { canciones } = await importarArchivoOsz(osz);
    const id = canciones[0]!.id;
    const base = (await leerCancion(id))!.dificultades[0]!;
    await guardarDificultad(id, {
      ...base,
      metadata: { ...base.metadata, difficultyName: 'Del mapeador' },
      notes: [{ kind: 'tap', time: 9000, column: 3 }],
    });

    const r = await importarArchivoOsz(osz);
    expect(r.canciones[0]!.estado).toBe('ya-estaba');
    expect(nombres((await leerCancion(id))!)).toEqual(['Normal', 'Del mapeador']);
  });

  it('conserva el id, los records y los replays al reimportar', async () => {
    const osz = oszDe({ Normal: { notas: NOTAS_A } });
    const { canciones } = await importarArchivoOsz(osz);
    const hash = String(hashMapa((await listarCanciones())[0]!.dificultades[0]!));
    await guardarPartida(hash, partida(800_000), replayDe(hash));

    const r = await importarArchivoOsz(osz);
    expect(r.canciones[0]!.id).toBe(canciones[0]!.id);
    expect((await leerRecords([hash])).size).toBe(1);
    expect(await leerReplayGuardado(hash)).toBeDefined();
  });

  it('devuelve los avisos y lo omitido, y los errores son ErrorDeImportacion', async () => {
    const r = await importarArchivoOsz(oszConSiete());
    expect(r.omitidas.otrasTeclas).toEqual({ 7: 1 });
    expect(r.avisos).toEqual(['Se omitió 1 dificultad de otras teclas: 7K (1).']);

    await expect(importarArchivoOsz(new Blob([new Uint8Array([1, 2, 3])]))).rejects.toBeInstanceOf(
      ErrorDeImportacion,
    );
    expect(await listarCanciones()).toHaveLength(1);
  });
});

function oszConSiete(): Blob {
  return new Blob([
    new Uint8Array(
      zipSync({
        'audio.wav': new Uint8Array([1]),
        'normal.osu': new TextEncoder().encode(osu('Normal', NOTAS_A)),
        'siete.osu': new TextEncoder().encode(
          osu('Siete', NOTAS_A).replace('CircleSize:4', 'CircleSize:7'),
        ),
      }),
    ),
  ]);
}

function conteos(valores: Partial<Record<Judgement, number>> = {}): Record<Judgement, number> {
  return { max: 0, perfect: 0, great: 0, good: 0, bad: 0, miss: 0, ...valores };
}

function partida(score: number, fecha = new Date().toISOString()): PartidaJugada {
  return {
    score,
    accuracy: score / 1_000_000,
    maxCombo: 5,
    counts: conteos({ max: 3, miss: 1 }),
    rango: 'B',
    fecha,
  };
}

function replayDe(hash: string): Replay {
  return {
    version: 1,
    hashMapa: hash,
    offsetUsuario: 0,
    eventos: [
      { time: 0.125, column: 0, tipo: 'down' },
      { time: 40.5, column: 0, tipo: 'up' },
    ],
  };
}

describe('fusionarDuplicados (D4)', () => {
  it('dos copias con record, replay de la mejor y recientes quedan en una sin perder nada', async () => {
    const { canciones } = await importarArchivoOsz(
      oszDe({ Normal: { notas: NOTAS_A }, Hard: { notas: NOTAS_B } }),
    );
    const original = (await leerCancion(canciones[0]!.id))!;
    // La copia como la dejaria un respaldo de otra computadora: otro id, mas nueva.
    await guardarCancion({ ...original, id: 'copia-b', importadaEn: (original.importadaEn ?? 0) + 5000 });

    const hashes = original.dificultades.map((d) => String(hashMapa(d)));
    const h = hashes[0]!;
    await guardarPartida(h, partida(900_000, '2026-10-01T10:00:00.000Z'), replayDe(h));
    await guardarPartida(h, partida(500_000, '2026-10-02T10:00:00.000Z'), replayDe(h));
    await guardarPartida(hashes[1]!, partida(700_000, '2026-10-03T10:00:00.000Z'), replayDe(hashes[1]!));

    const antes = {
      records: await leerRecords(hashes),
      replay: await leerReplayGuardado(h),
      recientes: await listarPartidasRecientes(h),
      recientes2: await listarPartidasRecientes(hashes[1]!),
    };
    expect(antes.recientes).toHaveLength(2);

    const fusiones = await fusionarDuplicados();
    expect(fusiones).toEqual([{ sobreviviente: original.id, absorbidas: ['copia-b'] }]);

    const lista = await listarCanciones();
    expect(lista.map((c) => c.id)).toEqual([original.id]);
    expect(nombres(lista[0]!)).toEqual(['Hard', 'Normal']);
    expect(await leerRecords(hashes)).toEqual(antes.records);
    expect(await leerReplayGuardado(h)).toEqual(antes.replay);
    expect(await listarPartidasRecientes(h)).toEqual(antes.recientes);
    expect(await listarPartidasRecientes(hashes[1]!)).toEqual(antes.recientes2);
  });

  it('es idempotente: la segunda corrida no hace nada', async () => {
    const { canciones } = await importarArchivoOsz(oszDe({ Normal: { notas: NOTAS_A } }));
    const original = (await leerCancion(canciones[0]!.id))!;
    await guardarCancion({ ...original, id: 'copia' });

    expect(await fusionarDuplicados()).toHaveLength(1);
    expect(await fusionarDuplicados()).toEqual([]);
    expect(await listarCanciones()).toHaveLength(1);
  });

  it('sin duplicados no toca la base', async () => {
    await importarArchivoOsz(oszDe({ Normal: { notas: NOTAS_A } }));
    expect(await fusionarDuplicados()).toEqual([]);
    expect(await listarCanciones()).toHaveLength(1);
  });

  it('la sobreviviente recibe las dificultades que solo tenia la copia', async () => {
    const { canciones } = await importarArchivoOsz(oszDe({ Normal: { notas: NOTAS_A } }));
    const original = (await leerCancion(canciones[0]!.id))!;
    const extra = {
      ...original.dificultades[0]!,
      metadata: { ...original.dificultades[0]!.metadata, difficultyName: 'Solo copia' },
      notes: [{ kind: 'tap' as const, time: 4000, column: 2 as const }],
    };
    await guardarCancion({
      ...original,
      id: 'copia',
      importadaEn: (original.importadaEn ?? 0) + 1,
      dificultades: [...original.dificultades, extra],
    });

    await fusionarDuplicados();
    const lista = await listarCanciones();
    expect(lista).toHaveLength(1);
    expect(nombres(lista[0]!)).toEqual(['Normal', 'Solo copia']);
  });
});
