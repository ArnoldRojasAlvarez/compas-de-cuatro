// Tests de T-020 para la aritmetica pura de efectos (efectos.ts): decay del
// flash por columna, animacion del juicio y color de nota del fallback.

import { describe, expect, it } from 'vitest';
import {
  COLOR_NOTA_EXTERIOR,
  COLOR_NOTA_INTERIOR,
  DECAY_FLASH_MS,
  ESCALA_POP_JUICIO,
  POP_JUICIO_MS,
  alphaFlash,
  alphaJuicio,
  animacionJuicio,
  colorDeNota,
  escalaJuicio,
} from './efectos.js';

const DURACION = 450;

describe('alphaFlash', () => {
  it('vale 1 mientras la columna esta pulsada, sin importar el tiempo', () => {
    expect(alphaFlash(true, 0)).toBe(1);
    expect(alphaFlash(true, 500)).toBe(1);
    expect(alphaFlash(true, -10)).toBe(1);
  });

  it('vale 1 justo al soltar (0 ms)', () => {
    expect(alphaFlash(false, 0)).toBe(1);
  });

  it('con msDesdeSoltar negativo vale 1', () => {
    expect(alphaFlash(false, -1)).toBe(1);
  });

  it('decae linealmente: a la mitad vale 0.5', () => {
    expect(alphaFlash(false, DECAY_FLASH_MS / 2)).toBeCloseTo(0.5, 10);
    expect(alphaFlash(false, DECAY_FLASH_MS / 4)).toBeCloseTo(0.75, 10);
  });

  it('llega a 0 exacto en DECAY_FLASH_MS y se queda en 0 despues', () => {
    expect(alphaFlash(false, DECAY_FLASH_MS)).toBe(0);
    expect(alphaFlash(false, DECAY_FLASH_MS + 1)).toBe(0);
    expect(alphaFlash(false, 10_000)).toBe(0);
  });

  it('el decay dura 120 ms', () => {
    expect(DECAY_FLASH_MS).toBe(120);
  });
});

describe('escalaJuicio', () => {
  it('en 0 ms vale la escala del pop (1.15)', () => {
    expect(escalaJuicio(0, DURACION)).toBeCloseTo(ESCALA_POP_JUICIO, 10);
    expect(ESCALA_POP_JUICIO).toBeCloseTo(1.15, 10);
  });

  it('durante el pop baja linealmente: a mitad vale el promedio entre 1.15 y 1', () => {
    expect(escalaJuicio(POP_JUICIO_MS / 2, DURACION)).toBeCloseTo(1.075, 10);
  });

  it('al terminar el pop vale 1 y se queda en 1 a mitad de la duracion', () => {
    expect(escalaJuicio(POP_JUICIO_MS, DURACION)).toBe(1);
    expect(escalaJuicio(DURACION / 2, DURACION)).toBe(1);
  });

  it('fuera de [0, duracion) vale 1', () => {
    expect(escalaJuicio(-5, DURACION)).toBe(1);
    expect(escalaJuicio(DURACION, DURACION)).toBe(1);
    expect(escalaJuicio(DURACION + 100, DURACION)).toBe(1);
  });
});

describe('alphaJuicio', () => {
  it('vale 1 en 0 ms, durante el pop y mientras se sostiene', () => {
    expect(alphaJuicio(0, DURACION)).toBe(1);
    expect(alphaJuicio(POP_JUICIO_MS, DURACION)).toBe(1);
    expect(alphaJuicio(DURACION * 0.5, DURACION)).toBe(1);
  });

  it('se desvanece linealmente en la segunda mitad', () => {
    expect(alphaJuicio(DURACION * 0.75, DURACION)).toBeCloseTo(0.5, 10);
    expect(alphaJuicio(DURACION * 0.9, DURACION)).toBeCloseTo(0.2, 10);
  });

  it('tiende a 0 al final, justo antes de la duracion', () => {
    const casiFinal = alphaJuicio(DURACION - 0.001, DURACION);
    expect(casiFinal).toBeGreaterThan(0);
    expect(casiFinal).toBeLessThan(0.001);
  });

  it('fuera de [0, duracion) vale 0', () => {
    expect(alphaJuicio(-1, DURACION)).toBe(0);
    expect(alphaJuicio(DURACION, DURACION)).toBe(0);
    expect(alphaJuicio(DURACION * 2, DURACION)).toBe(0);
  });
});

describe('animacionJuicio', () => {
  it('combina escala y alpha igual que las funciones sueltas', () => {
    for (const ms of [-10, 0, 40, 80, 200, 300, 449, 450, 900]) {
      const a = animacionJuicio(ms, DURACION);
      expect(a.escala).toBe(escalaJuicio(ms, DURACION));
      expect(a.alpha).toBe(alphaJuicio(ms, DURACION));
    }
  });

  it('en 0 ms es { 1.15, 1 }; a mitad { 1, 1 }; fuera de rango alpha 0', () => {
    expect(animacionJuicio(0, DURACION)).toEqual({ escala: ESCALA_POP_JUICIO, alpha: 1 });
    expect(animacionJuicio(DURACION / 2, DURACION)).toEqual({ escala: 1, alpha: 1 });
    expect(animacionJuicio(DURACION, DURACION).alpha).toBe(0);
    expect(animacionJuicio(-1, DURACION).alpha).toBe(0);
  });
});

describe('colorDeNota', () => {
  it('las columnas exteriores (0 y 3) van en tinta', () => {
    expect(colorDeNota(0)).toBe(0xe7eef0);
    expect(colorDeNota(3)).toBe(0xe7eef0);
    expect(COLOR_NOTA_EXTERIOR).toBe(0xe7eef0);
  });

  it('las columnas interiores (1 y 2) van en acento', () => {
    expect(colorDeNota(1)).toBe(0x3fd8c2);
    expect(colorDeNota(2)).toBe(0x3fd8c2);
    expect(COLOR_NOTA_INTERIOR).toBe(0x3fd8c2);
  });

  it('simetria: 0 y 3 iguales, 1 y 2 iguales, y los dos grupos distintos', () => {
    expect(colorDeNota(0)).toBe(colorDeNota(3));
    expect(colorDeNota(1)).toBe(colorDeNota(2));
    expect(colorDeNota(0)).not.toBe(colorDeNota(1));
  });
});
