// T-039: render() no crea objetos de Pixi por frame, ni siquiera con un mapa
// denso, y el pool de sprites no crece durante la partida. `pixi.js` se
// reemplaza por clases falsas que cuentan cada constructor: si render()
// (o showJudgement / setPressed) llamara a un `new` de Pixi en el camino
// caliente, el contador lo ve. Los objetos planos ({ inicio, fin }) no pasan
// por un constructor: de esos se encarga position-en-sitio.test.ts.

import { describe, expect, it, vi } from 'vitest';
import type { Chart, HoldNote, Note, TapNote } from '@tetra/core';

const registro = vi.hoisted(() => ({
  /** Cuantos objetos de Pixi se construyeron desde el ultimo `reiniciar()`. */
  creados: 0,
  /** Todos los Sprite que existen, para contar cuantos estan visibles. */
  sprites: [] as { visible: boolean }[],
}));

vi.mock('pixi.js', () => {
  class Punto {
    x = 0;
    y = 0;
    set(x: number, y?: number): void {
      this.x = x;
      this.y = y ?? x;
    }
  }
  class Contenedor {
    x = 0;
    y = 0;
    alpha = 1;
    visible = true;
    hijos: unknown[] = [];
    scale = new Punto();
    constructor() {
      registro.creados++;
    }
    addChild(...hijos: unknown[]): void {
      this.hijos.push(...hijos);
    }
    destroy(): void {}
  }
  class Sprite extends Contenedor {
    width = 0;
    height = 0;
    tint = 0xffffff;
    blendMode = 'normal';
    anchor = new Punto();
    constructor(public texture: unknown) {
      super();
      registro.sprites.push(this);
    }
  }
  class Text extends Contenedor {
    anchor = new Punto();
    // El estilo del texto no importa para contar construcciones.
    constructor() {
      super();
    }
  }
  class Texture {
    static WHITE = new Texture();
    width = 64;
    height = 64;
    constructor() {
      registro.creados++;
    }
    static from(): Texture {
      return new Texture();
    }
    destroy(): void {}
  }
  class Graphics {
    constructor() {
      registro.creados++;
    }
    rect(): this {
      return this;
    }
    fill(): this {
      return this;
    }
    destroy(): void {}
  }
  class FillGradient {
    constructor() {
      registro.creados++;
    }
  }
  class Rectangle {
    constructor() {
      registro.creados++;
    }
  }
  return { Container: Contenedor, Sprite, Text, Texture, Graphics, FillGradient, Rectangle };
});

vi.mock('./lienzo.js', () => ({
  crearLienzo: () => {
    const degradado = { addColorStop: () => undefined };
    return {
      canvas: {},
      ctx: {
        createLinearGradient: () => degradado,
        createRadialGradient: () => degradado,
        fillRect: () => undefined,
        fillStyle: '',
        globalCompositeOperation: '',
      },
      ancho: 64,
      alto: 64,
    };
  },
}));

// Importar despues de declarar los mocks (vi.mock se iza solo, pero asi se lee en orden).
const { createPlayfield } = await import('./playfield.js');

function tap(time: number, column: 0 | 1 | 2 | 3): TapNote {
  return { kind: 'tap', time, column };
}

function hold(time: number, endTime: number, column: 0 | 1 | 2 | 3): HoldNote {
  return { kind: 'hold', time, endTime, column };
}

function chartCon(notes: Note[]): Chart {
  return {
    metadata: {
      title: 'prueba',
      artist: 'prueba',
      creator: 'prueba',
      difficultyName: 'prueba',
      audioFile: 'audio.wav',
      previewTime: 0,
    },
    overallDifficulty: 8,
    hpDrain: 5,
    timingPoints: [],
    speedPoints: [],
    notes: notes.sort((a, b) => a.time - b.time),
  };
}

/** Mapa denso: 12 notas por segundo repartidas en las cuatro columnas, con largas, durante 40 s. */
function mapaDenso(): Chart {
  const notas: Note[] = [];
  const columnas = [0, 2, 1, 3, 2, 0, 3, 1] as const;
  for (let i = 0; i < 480; i++) {
    const t = 1000 + i * 83;
    const c = columnas[i % columnas.length]!;
    // Cada 9 notas, una larga de ~400 ms en esa columna (la siguiente de la columna llega despues: i + 4 columnas rotan).
    if (i % 9 === 0) notas.push(hold(t, t + 250, c));
    else notas.push(tap(t, c));
  }
  return chartCon(notas);
}

const OPCIONES = { scrollDuration: 1200, height: 800, columnWidth: 100, receptorOffset: 100 };

function crearApp(): Parameters<typeof createPlayfield>[0] {
  // Solo lo que usa createPlayfield: el escenario y generateTexture. Sin Pixi real no hay mas.
  const escenario = new (class {
    hijos: unknown[] = [];
    addChild(...h: unknown[]): void {
      this.hijos.push(...h);
    }
  })();
  return {
    stage: escenario,
    renderer: { generateTexture: () => ({ width: 64, height: 64, destroy: () => undefined }) },
  } as unknown as Parameters<typeof createPlayfield>[0];
}

function visibles(): number {
  return registro.sprites.filter((s) => s.visible).length;
}

describe('playfield: render() no crea objetos de Pixi (T-039)', () => {
  it('10 000 frames de un mapa denso, con golpes y teclas, no construyen ni un objeto despues del calentamiento', () => {
    const playfield = createPlayfield(crearApp(), mapaDenso(), { ...OPCIONES });
    // Calentamiento: los primeros frames dejan todo en su sitio.
    for (let t = 0; t < 600; t += 16) playfield.render(t);

    registro.creados = 0;
    let maximoVisible = 0;
    const columnas = [0, 1, 2, 3] as const;
    for (let i = 0; i < 10_000; i++) {
      const t = 600 + i * 4; // 40 s de partida a 250 fps: el mapa entero
      if (i % 7 === 0) playfield.setPressed(columnas[i % 4]!, true);
      if (i % 7 === 3) playfield.setPressed(columnas[(i - 3) % 4]!, false);
      if (i % 5 === 0) playfield.showJudgement(columnas[i % 4]!, i % 10 === 0 ? 'miss' : 'max');
      playfield.render(t);
      if (i % 50 === 0) maximoVisible = Math.max(maximoVisible, visibles());
    }
    expect(registro.creados).toBe(0);
    // No es una prueba vacia: se dibujaron notas de verdad.
    expect(maximoVisible).toBeGreaterThan(10);
  });

  it('40 notas visibles a la vez en una columna: el pool ya las tiene y no crece durante la partida', () => {
    // 40 notas en la columna 0 separadas 30 ms: caben todas en una ventana de 1440 ms.
    const densa = chartCon(Array.from({ length: 40 }, (_, i) => tap(1000 + i * 30, 0)));
    registro.sprites.length = 0;
    const playfield = createPlayfield(crearApp(), densa, { ...OPCIONES });
    const alCrear = registro.sprites.length;
    registro.creados = 0;
    let maximoVisible = 0;
    for (let t = 0; t < 4000; t += 8) {
      playfield.render(t);
      maximoVisible = Math.max(maximoVisible, visibles());
    }
    expect(registro.creados).toBe(0);
    expect(registro.sprites.length).toBe(alCrear);
    // Las 40 se dibujan a la vez (mas las lineas, receptores y demas sprites fijos, siempre visibles).
    expect(maximoVisible).toBeGreaterThanOrEqual(40);
  });

  it('con la velocidad bajando en caliente (F3) el pool sigue sin crecer si se declaro el scrollDuration mas lento', () => {
    const chart = mapaDenso();
    const opciones = { ...OPCIONES, scrollDurationMaximo: 3600 };
    const playfield = createPlayfield(crearApp(), chart, opciones);
    for (let t = 0; t < 600; t += 16) playfield.render(t);
    registro.creados = 0;
    opciones.scrollDuration = 3600; // velocidad 1: lo mas lento
    for (let t = 600; t < 20_000; t += 8) playfield.render(t);
    expect(registro.creados).toBe(0);
  });

  it('control: sin declarar el mas lento, cambiar a una velocidad mucho menor SI hace crecer el pool (el contador lo ve)', () => {
    const chart = mapaDenso();
    const opciones = { ...OPCIONES };
    const playfield = createPlayfield(crearApp(), chart, opciones);
    for (let t = 0; t < 600; t += 16) playfield.render(t);
    registro.creados = 0;
    opciones.scrollDuration = 3600;
    for (let t = 600; t < 20_000; t += 8) playfield.render(t);
    expect(registro.creados).toBeGreaterThan(0);
  });
});
