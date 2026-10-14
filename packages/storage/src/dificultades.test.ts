// Tests de T-032: operaciones puras sobre las dificultades (dificultades.ts)
// y su uso real contra IndexedDB (fake-indexeddb) desde la API publica.

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Chart } from '@tetra/core';
import { escribirOsu } from '@tetra/core';
import { ponerDificultad, quitarDificultad } from './dificultades.js';
import {
  borrarDificultad,
  guardarCancionCreada,
  guardarDificultad,
  leerCancion,
  listarCanciones,
} from './index.js';

function chart(nombre: string, tiempoNota = 500, titulo = 'Cancion'): Chart {
  return {
    metadata: {
      title: titulo,
      artist: 'Arnold',
      creator: 'Arnold',
      difficultyName: nombre,
      audioFile: 'audio.mp3',
      previewTime: 0,
    },
    overallDifficulty: 7,
    hpDrain: 5,
    timingPoints: [{ time: 0, bpm: 120, meter: 4 }],
    speedPoints: [],
    notes: [{ kind: 'tap', time: tiempoNota, column: 0 }],
  };
}

describe('ponerDificultad y quitarDificultad (puras)', () => {
  it('agrega una dificultad nueva al final', () => {
    const r = ponerDificultad([chart('Facil')], chart('Dificil'));
    expect(r.map((d) => d.metadata.difficultyName)).toEqual(['Facil', 'Dificil']);
  });

  it('reemplaza la del mismo nombre en su misma posicion', () => {
    const lista = [chart('Facil', 100), chart('Dificil', 200)];
    const r = ponerDificultad(lista, chart('Facil', 999));
    expect(r.map((d) => d.metadata.difficultyName)).toEqual(['Facil', 'Dificil']);
    expect(r[0]!.notes[0]!.time).toBe(999);
  });

  it('no muta la lista original', () => {
    const lista = [chart('Facil')];
    ponerDificultad(lista, chart('Dificil'));
    quitarDificultad(lista, 'Facil');
    expect(lista).toHaveLength(1);
  });

  it('quitar un nombre inexistente deja la lista igual', () => {
    expect(quitarDificultad([chart('Facil')], 'Nada')).toHaveLength(1);
  });
});

// T-066: reimportar el mismo contenido ya no crea otra cancion, asi que cada
// cancion de estos tests lleva un titulo distinto.
let contadorDeCanciones = 0;

async function crearCancion(nombres: string[]): Promise<string> {
  const titulo = `Cancion ${++contadorDeCanciones}`;
  return guardarCancionCreada({
    titulo,
    artista: 'Arnold',
    creador: 'Arnold',
    audioNombre: 'audio.mp3',
    audio: new Uint8Array([1, 2, 3]),
    dificultades: nombres.map((n) => ({ version: n, texto: escribirOsu(chart(n, 500, titulo)) })),
  });
}

describe('guardarDificultad y borrarDificultad (IndexedDB)', () => {
  it('reemplazar una dificultad no cambia el id ni la cantidad de canciones', async () => {
    const id = await crearCancion(['Normal']);
    const antes = (await listarCanciones()).length;
    await guardarDificultad(id, chart('Normal', 1234));
    const despues = await listarCanciones();
    expect(despues).toHaveLength(antes);
    const cancion = await leerCancion(id);
    expect(cancion?.id).toBe(id);
    expect(cancion?.dificultades).toHaveLength(1);
    expect(cancion?.dificultades[0]!.notes[0]!.time).toBe(1234);
  });

  it('guardar con otro nombre agrega una dificultad a la misma cancion', async () => {
    const id = await crearCancion(['Normal']);
    await guardarDificultad(id, chart('Experto'));
    const cancion = await leerCancion(id);
    expect(cancion?.dificultades.map((d) => d.metadata.difficultyName)).toEqual(['Normal', 'Experto']);
  });

  it('conserva el audio al guardar una dificultad', async () => {
    const id = await crearCancion(['Normal']);
    await guardarDificultad(id, chart('Otra'));
    const cancion = await leerCancion(id);
    expect(new Uint8Array(await cancion!.audio.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('guardar en una cancion que no existe falla con un mensaje claro', async () => {
    await expect(guardarDificultad('no-existe', chart('Normal'))).rejects.toThrow(
      /ya no está en la biblioteca/,
    );
  });

  it('no toca otras canciones', async () => {
    const a = await crearCancion(['Normal']);
    const b = await crearCancion(['Normal']);
    await guardarDificultad(a, chart('Normal', 777));
    const cancionB = await leerCancion(b);
    expect(cancionB?.dificultades[0]!.notes[0]!.time).toBe(500);
  });

  it('borrar una dificultad deja las demas', async () => {
    const id = await crearCancion(['Facil', 'Dificil']);
    expect(await borrarDificultad(id, 'Facil')).toBe(false);
    const cancion = await leerCancion(id);
    expect(cancion?.dificultades.map((d) => d.metadata.difficultyName)).toEqual(['Dificil']);
  });

  it('borrar la ultima dificultad borra la cancion (nunca queda una cancion vacia)', async () => {
    const id = await crearCancion(['Unica']);
    expect(await borrarDificultad(id, 'Unica')).toBe(true);
    expect(await leerCancion(id)).toBeUndefined();
  });

  it('borrar una dificultad que no existe no cambia nada', async () => {
    const id = await crearCancion(['Normal']);
    expect(await borrarDificultad(id, 'Nada')).toBe(false);
    expect((await leerCancion(id))?.dificultades).toHaveLength(1);
  });
});
