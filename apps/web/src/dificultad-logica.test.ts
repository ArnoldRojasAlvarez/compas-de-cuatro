// Tests de T-014 para dificultad-logica.ts. Convencion del proyecto: antes
// de cada aserche, que implementacion incorrecta la haria fallar (ver
// CLAUDE.md / docs/HANDOFF.md, "Lecciones").

import { describe, expect, it, vi } from 'vitest';
import type { Chart, DifficultyResult } from '@tetra/core';
import {
  ColaConPrioridad,
  claveDeDificultad,
  colorDeEstrella,
  obtenerDificultad,
} from './dificultad-logica.js';

function chart(parcial: Partial<Chart> = {}): Chart {
  return {
    metadata: {
      title: 'Titulo',
      artist: 'Artista',
      creator: 'Creador',
      difficultyName: 'Normal',
      audioFile: 'audio.mp3',
      previewTime: 0,
    },
    overallDifficulty: 6,
    hpDrain: 5,
    timingPoints: [],
    speedPoints: [],
    notes: [{ kind: 'tap', time: 0, column: 0 }],
    ...parcial,
  };
}

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

// ---------------------------------------------------------------------------
// claveDeDificultad
// ---------------------------------------------------------------------------

describe('claveDeDificultad', () => {
  it('el mismo mapa y la misma version dan la misma clave', () => {
    const c = chart();
    expect(claveDeDificultad(c, 1)).toBe(claveDeDificultad(c, 1));
  });

  it('la misma cancion con distinta version de modelo da claves distintas', () => {
    const c = chart();
    // Una implementacion que ignorara `version` (por ejemplo, devolviera
    // solo el hash) haria que esta prueba fallara: es exactamente el bug
    // que el ticket pide evitar (cache que no se entera de un cambio de
    // modelo).
    expect(claveDeDificultad(c, 1)).not.toBe(claveDeDificultad(c, 2));
  });

  it('dos mapas distintos con la misma version dan claves distintas', () => {
    const a = chart({ notes: [{ kind: 'tap', time: 0, column: 0 }] });
    const b = chart({ notes: [{ kind: 'tap', time: 0, column: 1 }] });
    expect(claveDeDificultad(a, 1)).not.toBe(claveDeDificultad(b, 1));
  });
});

// ---------------------------------------------------------------------------
// ColaConPrioridad
// ---------------------------------------------------------------------------

describe('ColaConPrioridad', () => {
  it('sin prioridades, es FIFO', () => {
    const cola = new ColaConPrioridad<string>();
    cola.agregar('a', false);
    cola.agregar('b', false);
    cola.agregar('c', false);
    // Una cola LIFO (o desordenada) fallaria este orden.
    expect(cola.siguiente()).toBe('a');
    expect(cola.siguiente()).toBe('b');
    expect(cola.siguiente()).toBe('c');
  });

  it('un item prioritario se adelanta a los que ya estaban esperando', () => {
    const cola = new ColaConPrioridad<string>();
    cola.agregar('normal-1', false);
    cola.agregar('normal-2', false);
    cola.agregar('foco', true);
    // Una implementacion que solo hiciera push (ignorando `prioritaria`)
    // devolveria 'normal-1' primero, no 'foco'. Esto es lo que garantiza
    // "la dificultad en foco tiene prioridad sobre las demas" del ticket.
    expect(cola.siguiente()).toBe('foco');
    expect(cola.siguiente()).toBe('normal-1');
    expect(cola.siguiente()).toBe('normal-2');
  });

  it('dos items prioritarios respetan su propio orden de llegada entre ellos', () => {
    const cola = new ColaConPrioridad<string>();
    cola.agregar('normal', false);
    cola.agregar('foco-1', true);
    cola.agregar('foco-2', true);
    expect(cola.siguiente()).toBe('foco-1');
    expect(cola.siguiente()).toBe('foco-2');
    expect(cola.siguiente()).toBe('normal');
  });

  it('vacia devuelve undefined, y tamano refleja lo que queda', () => {
    const cola = new ColaConPrioridad<string>();
    expect(cola.siguiente()).toBeUndefined();
    cola.agregar('x', false);
    expect(cola.tamano).toBe(1);
    cola.siguiente();
    expect(cola.tamano).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// obtenerDificultad: cache-o-calcula, y la invalidacion por version
// ---------------------------------------------------------------------------

describe('obtenerDificultad', () => {
  function cacheEnMemoria() {
    const mapa = new Map<string, DifficultyResult>();
    return {
      leerCache: vi.fn((clave: string) => Promise.resolve(mapa.get(clave))),
      guardarCache: vi.fn((clave: string, r: DifficultyResult) => {
        mapa.set(clave, r);
        return Promise.resolve();
      }),
    };
  }

  it('la primera vez, calcula (no hay nada en cache) y guarda el resultado', async () => {
    const c = chart();
    const cache = cacheEnMemoria();
    const calcular = vi.fn(() => Promise.resolve(resultado(4.2)));

    const r = await obtenerDificultad(c, { ...cache, calcular }, 1);

    expect(r).toEqual(resultado(4.2));
    expect(calcular).toHaveBeenCalledTimes(1);
    expect(cache.guardarCache).toHaveBeenCalledWith(claveDeDificultad(c, 1), resultado(4.2));
  });

  it('la segunda vez, con la misma version, usa la cache y no vuelve a calcular', async () => {
    const c = chart();
    const cache = cacheEnMemoria();
    const calcular = vi.fn(() => Promise.resolve(resultado(4.2)));

    await obtenerDificultad(c, { ...cache, calcular }, 1);
    await obtenerDificultad(c, { ...cache, calcular }, 1);

    // Una implementacion que no revisara la cache antes de calcular (o que
    // armara mal la clave) llamaria a `calcular` dos veces.
    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it('cambiar la version del modelo invalida lo cacheado: vuelve a calcular', async () => {
    const c = chart();
    const cache = cacheEnMemoria();
    const calcular = vi.fn(() => Promise.resolve(resultado(4.2)));

    await obtenerDificultad(c, { ...cache, calcular }, 1); // version 1: calcula y cachea
    await obtenerDificultad(c, { ...cache, calcular }, 1); // version 1 de nuevo: cache
    await obtenerDificultad(c, { ...cache, calcular }, 2); // version 2: bug si NO recalcula

    // Este es el test que el ticket pide explicitamente ("Test que
    // demuestre que cambiar la version invalida lo cacheado"): si
    // `claveDeDificultad` no incluyera la version, o si `obtenerDificultad`
    // comparara mal la clave, la tercera llamada encontraria (por error) la
    // entrada de la version 1 y `calcular` se quedaria en 1 llamada. Con la
    // implementacion correcta, son 2: una por cada version distinta.
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('subir la version otra vez, y volver a la version vieja, tambien recalcula (no hay confusion de claves)', async () => {
    const c = chart();
    const cache = cacheEnMemoria();
    const calcular = vi.fn(() => Promise.resolve(resultado(4.2)));

    await obtenerDificultad(c, { ...cache, calcular }, 1);
    await obtenerDificultad(c, { ...cache, calcular }, 2);
    await obtenerDificultad(c, { ...cache, calcular }, 1); // vuelve a la version 1: SIGUE en cache de la primera llamada

    // La entrada de la version 1 nunca se borro (la cache no destruye
    // datos viejos, ver db.ts): volver a esa version tiene que pegarle de
    // nuevo a la cache, no recalcular otra vez.
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('mapas distintos no comparten cache entre si', async () => {
    const a = chart({ notes: [{ kind: 'tap', time: 0, column: 0 }] });
    const b = chart({ notes: [{ kind: 'tap', time: 0, column: 1 }] });
    const cache = cacheEnMemoria();
    const calcular = vi.fn(() => Promise.resolve(resultado(4.2)));

    await obtenerDificultad(a, { ...cache, calcular }, 1);
    await obtenerDificultad(b, { ...cache, calcular }, 1);

    expect(calcular).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// colorDeEstrella
// ---------------------------------------------------------------------------

describe('colorDeEstrella', () => {
  it('estrellas bajas dan el azul (--j-100)', () => {
    expect(colorDeEstrella(0)).toBe('--j-100');
    expect(colorDeEstrella(1.99)).toBe('--j-100');
  });

  it('el corte es en el limite exacto (2 ya es el siguiente color, no el anterior)', () => {
    // Una implementacion con `<=` en vez de `<` (o los cortes en el orden
    // equivocado) devolveria '--j-100' aca en vez de '--j-200'.
    expect(colorDeEstrella(2)).toBe('--j-200');
  });

  it('estrellas medias dan verde y violeta segun el rango', () => {
    expect(colorDeEstrella(3.5)).toBe('--j-200');
    expect(colorDeEstrella(5)).toBe('--j-50');
  });

  it('estrellas altas dan ambar, y las mas altas rojo', () => {
    expect(colorDeEstrella(7)).toBe('--j-300');
    expect(colorDeEstrella(9)).toBe('--j-miss');
    expect(colorDeEstrella(100)).toBe('--j-miss');
  });

  it('nunca devuelve el acento (--j-max): esta reservado para lo unico que brilla por pantalla', () => {
    const colores = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 20].map(colorDeEstrella);
    expect(colores).not.toContain('--j-max');
  });
});
