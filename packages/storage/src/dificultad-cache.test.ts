// Tests de T-014 para la cache de dificultad (cachearDificultad /
// leerDificultadDeCache, ver index.ts y db.ts) y para la migracion no
// destructiva que agrega la tienda 'dificultades' (VERSION_BASE 3 -> 4).
//
// vitest corre en entorno node (ver vitest.config.ts): se usa
// fake-indexeddb, mismo patron que index.test.ts.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DifficultyResult } from '@tetra/core';
import { cachearDificultad, leerDificultadDeCache, importarOsz, listarCanciones } from './index.js';
import { zipSync } from 'fflate';

beforeEach(async () => {
  const bases = await indexedDB.databases();
  for (const base of bases) {
    if (base.name !== undefined) {
      indexedDB.deleteDatabase(base.name);
    }
  }
});

function resultado(overall: number): DifficultyResult {
  return {
    overall,
    vector: {
      stream: overall,
      jumpstream: 0,
      handstream: 0,
      stamina: 0,
      jackspeed: 0,
      chordjack: 0,
      technical: 0,
    },
  };
}

describe('cachearDificultad / leerDificultadDeCache', () => {
  it('guarda y lee de vuelta el mismo resultado bajo la misma clave', async () => {
    await cachearDificultad('hash123:1', resultado(4.2));
    const leido = await leerDificultadDeCache('hash123:1');
    // Una implementacion que guardara solo `overall` (no el vector
    // completo) fallaria esta comparacion profunda.
    expect(leido).toEqual(resultado(4.2));
  });

  it('una clave nunca guardada da undefined, no lanza ni devuelve un objeto vacio', async () => {
    const leido = await leerDificultadDeCache('nunca-guardada:1');
    // Una implementacion que devolviera {} en vez de undefined rompería la
    // distincion "esta en cache" vs "no esta", que es de lo que depende
    // dificultad-logica.ts (apps/web) para decidir si recalcula.
    expect(leido).toBeUndefined();
  });

  it('guardar de nuevo bajo la misma clave reemplaza el valor anterior', async () => {
    await cachearDificultad('hash123:1', resultado(3.0));
    await cachearDificultad('hash123:1', resultado(3.0));
    await cachearDificultad('hash123:1', resultado(5.5));
    const leido = await leerDificultadDeCache('hash123:1');
    expect(leido?.overall).toBe(5.5);
  });

  it('cambiar la version en la clave hace que la entrada vieja no se encuentre: asi es como se invalida la cache (T-014, "la trampa que hay que evitar")', async () => {
    // El mapa es el mismo (mismo hash), pero la clave de cache incluye
    // VERSION_MODELO_DIFICULTAD (ver dificultad-logica.ts en apps/web):
    // simulamos ese esquema de clave `${hash}:${version}` aca directo,
    // sin pasar por @tetra/core, porque lo que se prueba es el
    // comportamiento de la cache ante una clave distinta, no el hash en
    // si (eso ya esta en packages/core/src/difficulty/hash.test.ts).
    const mismoHash = 'hash-de-un-mapa';
    const claveVersion1 = `${mismoHash}:1`;
    const claveVersion2 = `${mismoHash}:2`;

    await cachearDificultad(claveVersion1, resultado(4.2));

    // Con la clave vieja, el resultado sigue ahi (no se borro nada: la
    // migracion/invalidacion de T-014 es "dejar de leerla", no un borrado).
    expect(await leerDificultadDeCache(claveVersion1)).toEqual(resultado(4.2));

    // Con la clave de la version nueva, tiene que dar un miss: una
    // implementacion que ignorara la version al armar o comparar la clave
    // (por ejemplo, cacheara solo por hash) devolveria el 4.2 viejo aca, que
    // es exactamente el bug que el ticket pide evitar ("el song select
    // mostraria estrellas viejas sin que nadie lo note").
    expect(await leerDificultadDeCache(claveVersion2)).toBeUndefined();
  });
});

describe('migracion no destructiva a VERSION_BASE 4 (tienda "dificultades")', () => {
  const NOMBRE_BASE = 'tetra-mapas';

  it('una base existente en version 3 (con canciones guardadas) conserva sus datos al abrirse con la version 4 y gana la tienda nueva', async () => {
    // Paso 1: se arma a mano una base en version 3, como la dejaria una
    // sesion vieja de T-011 (antes de este ticket), con datos adentro.
    await new Promise<void>((resolve, reject) => {
      const peticion = indexedDB.open(NOMBRE_BASE, 3);
      peticion.onupgradeneeded = () => {
        const db = peticion.result;
        db.createObjectStore('mapas', { keyPath: 'id' });
        db.createObjectStore('skins', { keyPath: 'id' });
        db.createObjectStore('canciones', { keyPath: 'id' });
      };
      peticion.onsuccess = () => {
        const db = peticion.result;
        const tx = db.transaction('canciones', 'readwrite');
        tx.objectStore('canciones').put({
          id: 'cancion-vieja',
          titulo: 'Cancion de una sesion anterior',
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

    // Paso 2: el codigo de T-014 (db.ts, VERSION_BASE = 4) abre esa misma
    // base. Si la migracion no fuera no-destructiva (por ejemplo, si
    // alguien borrara y recreara 'canciones' en vez de usar el guard
    // `if (!contains(...))`), la cancion vieja desaparecerian aca.
    const canciones = await listarCanciones();
    expect(canciones).toHaveLength(1);
    expect(canciones[0]!.id).toBe('cancion-vieja');
    expect(canciones[0]!.titulo).toBe('Cancion de una sesion anterior');

    // La tienda nueva ('dificultades') tiene que existir y funcionar,
    // aunque la base venga de una version anterior a T-014.
    await cachearDificultad('nueva:1', resultado(2.5));
    expect(await leerDificultadDeCache('nueva:1')).toEqual(resultado(2.5));
  });

  it('importar una cancion nueva despues de la migracion no toca la cache de dificultad, y viceversa', async () => {
    await cachearDificultad('clave-x:1', resultado(6.1));

    const osu = `osu file format v14

[General]
AudioFilename: audio.wav
Mode: 3

[Metadata]
Title:Otra cancion
Artist:Otro artista
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
`;
    const osz = new Blob([
      zipSync({
        'mapa.osu': new TextEncoder().encode(osu),
        'audio.wav': new Uint8Array([1]),
      }),
    ]);
    await importarOsz(osz);

    expect(await listarCanciones()).toHaveLength(1);
    expect(await leerDificultadDeCache('clave-x:1')).toEqual(resultado(6.1));
  });
});
