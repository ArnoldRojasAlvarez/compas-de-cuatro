// T-060: el cuerpo de una nota larga mas larga que la pista. Reporte de Arnold:
// "al presionar una LN desaparece y reaparece hasta el puro final de su
// recorrido". Con la cabeza ya debajo del receptor y la cola todavia arriba de
// la pantalla, ninguno de los dos extremos cae en el rango visible y el cuerpo
// dejaba de dibujarse justo mientras se mantiene. Con el arreglo, el cuerpo se
// dibuja si el tramo entero toca la pista, y se acorta desde la linea de juicio
// (su alto baja) a medida que la cola baja.
//
// Mismo doble de Pixi que playfield-sin-allocaciones.test.ts: cada Sprite se
// anota en `registro.sprites` con su `visible`, `height` e `y`.

import { describe, expect, it, vi } from 'vitest';
import type { Chart, HoldNote, Note } from '@tetra/core';

const registro = vi.hoisted(() => ({
  sprites: [] as { visible: boolean; height: number; width: number; y: number }[],
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
  }
  class Texture {
    static WHITE = new Texture();
    width = 64;
    height = 64;
    static from(): Texture {
      return new Texture();
    }
    destroy(): void {}
  }
  class Graphics {
    rect(): this {
      return this;
    }
    fill(): this {
      return this;
    }
    destroy(): void {}
  }
  class FillGradient {}
  class Rectangle {}
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

const { createPlayfield } = await import('./playfield.js');

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
    notes,
  };
}

const OPCIONES = { scrollDuration: 1200, height: 800, columnWidth: 100, receptorOffset: 100 };

function crearApp(): Parameters<typeof createPlayfield>[0] {
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

/**
 * El cuerpo de la LN: el sprite visible de medio carril de ancho
 * (ANCHO_CUERPO_FACTOR = 0,5 sin skin propia) y mas alto que una nota. Los
 * carriles y las lineas son de un carril o de la pista entera de ancho; los
 * marcadores de cabeza y cola, bajos.
 */
function cuerpoVisible(): { height: number; y: number } | null {
  // Los marcadores miden 0,82 carriles de ancho: el cuerpo es el unico de 0,5.
  const cuerpos = registro.sprites.filter(
    (s) => s.visible && s.width === OPCIONES.columnWidth / 2 && s.height > 0,
  );
  return cuerpos.length === 0 ? null : { height: cuerpos[0]!.height, y: cuerpos[0]!.y };
}

describe('playfield: cuerpo de una LN mas larga que la pista (T-060)', () => {
  it('mientras se mantiene, con la cabeza pasada del receptor y la cola arriba de la pantalla, el cuerpo sigue visible y se acorta', () => {
    // scrollDuration 1200: una LN de 3000 ms es mas larga que lo visible (1,2 x 1200).
    registro.sprites.length = 0;
    const playfield = createPlayfield(crearApp(), chartCon([hold(1000, 4000, 1)]), {
      ...OPCIONES,
    });
    for (let t = 0; t < 1000; t += 16) playfield.render(t);
    playfield.setPressed(1, true);

    // t = 2400: cabeza 1,17 de progreso (ya pasada del margen de 1,1), cola -0,33 (todavia
    // no entra). En main el cuerpo desaparecia aca.
    playfield.render(2400);
    const a = cuerpoVisible();
    expect(a, 'el cuerpo debe seguir dibujado con los dos extremos fuera de la pista').not.toBeNull();

    playfield.render(2700);
    const b = cuerpoVisible();
    expect(b).not.toBeNull();
    // Se acorta desde la linea de juicio: la cola baja (y crece) y el alto baja.
    expect(b!.y).toBeGreaterThan(a!.y);
    expect(b!.height).toBeLessThan(a!.height);

    // Cuando la cola entra en pantalla (t = 2800: cola en -0,0) sigue igual de visible.
    playfield.render(2900);
    expect(cuerpoVisible()).not.toBeNull();

    // Y en ningun frame del recorrido entero desaparece.
    for (let t = 1000; t < 4000; t += 16) {
      playfield.render(t);
      expect(cuerpoVisible(), `cuerpo ausente en t=${t}`).not.toBeNull();
    }
  });
});
