// T-054: la musica del menu elige la cancion ANTES de decodificarla, para que
// el menu muestre su fondo y su titulo (atenuado) mientras tanto, y toma el
// previewTime de la dificultad mas facil. Se prueba con un AudioContext falso
// en node: lo que importa es el orden de los avisos, no el sonido.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chart } from '@tetra/core';
import type { CancionGuardada } from '@tetra/storage';

const { listarCancionesFalso } = vi.hoisted(() => ({ listarCancionesFalso: vi.fn() }));
vi.mock('@tetra/storage', () => ({ listarCanciones: listarCancionesFalso }));

import { crearMusicaMenu } from './musica-menu.js';

type Columna = 0 | 1 | 2 | 3;

function chart(nombre: string, notas: number, previewTime: number, pasoMs = 100): Chart {
  return {
    metadata: {
      title: 'Titulo',
      artist: 'Artista',
      creator: 'Creador',
      difficultyName: nombre,
      audioFile: 'audio.mp3',
      previewTime,
    },
    overallDifficulty: 6,
    hpDrain: 5,
    timingPoints: [{ time: 0, bpm: 120, meter: 4 }],
    speedPoints: [],
    notes: Array.from({ length: notas }, (_, i) => ({
      kind: 'tap' as const,
      time: i * pasoMs,
      column: (i % 4) as Columna,
    })),
  };
}

function cancion(id: string, dificultades: Chart[]): CancionGuardada {
  return {
    id,
    titulo: `Cancion ${id}`,
    artista: 'Artista',
    audio: new Blob([new Uint8Array([1, 2, 3])]),
    importadaEn: 0,
    dificultades,
  };
}

/** Un AudioContext que solo cuenta lo que el test necesita: la decodificacion queda pendiente hasta que se la resuelve. */
interface Control {
  resolverDecodificacion: () => void;
  arranques: number[];
}

function instalarAudioContextFalso(): Control {
  let resolver: (b: unknown) => void = () => {};
  const control: Control = { resolverDecodificacion: () => resolver({ duration: 200 }), arranques: [] };
  const nodo = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } });
  class ContextoFalso {
    currentTime = 0;
    state = 'running';
    destination = {};
    createGain = nodo;
    createAnalyser = () => ({ ...nodo(), fftSize: 0 });
    createBufferSource = () => ({
      ...nodo(),
      buffer: null,
      loop: false,
      onended: null as null | (() => void),
      start: (_cuando: number, desde: number) => control.arranques.push(desde),
      stop: vi.fn(),
    });
    decodeAudioData(): Promise<unknown> {
      return new Promise((resolve) => {
        resolver = resolve;
      });
    }
    resume = vi.fn(async () => {});
    suspend = vi.fn(async () => {});
    close = vi.fn(async () => {});
  }
  vi.stubGlobal('AudioContext', ContextoFalso);
  return control;
}

/** Deja correr las promesas ya resueltas (lectura de la biblioteca, etc.). */
async function asentar(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('crearMusicaMenu (T-054)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    listarCancionesFalso.mockReset();
  });

  it('la cancion queda elegida y cargando antes de terminar de decodificar, y deja de cargar al arrancar', async () => {
    const control = instalarAudioContextFalso();
    const c = cancion('a', [chart('x', 10, 5000)]);
    listarCancionesFalso.mockResolvedValue([c]);

    const musica = crearMusicaMenu();
    const avisos: Array<{ eligida: string | undefined; cargando: boolean; suena: boolean }> = [];
    musica.alCambiar(() =>
      avisos.push({ eligida: musica.eligida?.id, cargando: musica.cargando, suena: musica.actual !== null }),
    );
    await asentar();

    // Todavia decodificando: una implementacion que eligiera recien al terminar daria eligida null.
    expect(musica.eligida?.id).toBe('a');
    expect(musica.cargando).toBe(true);
    expect(musica.actual).toBeNull();
    expect(avisos).toEqual([{ eligida: 'a', cargando: true, suena: false }]);

    control.resolverDecodificacion();
    await asentar();

    expect(musica.cargando).toBe(false);
    expect(musica.actual?.id).toBe('a');
    expect(musica.eligida?.id).toBe('a');
    expect(avisos.at(-1)).toEqual({ eligida: 'a', cargando: false, suena: true });
    musica.detener();
  });

  it('arranca desde el previewTime de la dificultad mas facil, no de la primera del zip', async () => {
    const control = instalarAudioContextFalso();
    // En el zip la dificil viene primero (previewTime 90 s); la facil (1 nota por segundo) tiene 20 s.
    const c = cancion('a', [chart('dificil', 500, 90_000, 100), chart('facil', 10, 20_000, 1000)]);
    listarCancionesFalso.mockResolvedValue([c]);

    const musica = crearMusicaMenu();
    await asentar();
    control.resolverDecodificacion();
    await asentar();

    expect(control.arranques).toEqual([20]);
    musica.detener();
  });
});
