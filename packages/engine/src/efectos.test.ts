// Tests de T-020 para la aritmetica pura de efectos (efectos.ts): decay del
// flash por columna, animacion del juicio y color de nota del fallback.

import { describe, expect, it } from 'vitest';
import {
  COLOR_NOTA_EXTERIOR,
  COLOR_NOTA_INTERIOR,
  DECAY_FLASH_MS,
  DESPLAZAMIENTO_JUICIO_MS,
  DESPLAZAMIENTO_POP_JUICIO,
  DURACION_DESTELLO_MS,
  ESCALA_FINAL_DESTELLO,
  ESCALA_INICIAL_DESTELLO,
  ESCALA_POP_JUICIO,
  OPACIDAD_PISTA_POR_DEFECTO,
  POP_JUICIO_MS,
  alphaDestello,
  alphaFlash,
  alphaJuicio,
  animacionJuicio,
  colorDeNota,
  desplazamientoJuicio,
  escalaDestello,
  escalaJuicio,
  normalizarOpacidadPista,
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

describe('alphaDestello (T-050)', () => {
  it('dura 160 ms', () => {
    expect(DURACION_DESTELLO_MS).toBe(160);
  });

  it('vale 1 justo en el golpe (0 ms)', () => {
    expect(alphaDestello(0)).toBe(1);
  });

  it('llega a 0 exacto en la duracion y se queda en 0 despues', () => {
    expect(alphaDestello(DURACION_DESTELLO_MS)).toBe(0);
    expect(alphaDestello(DURACION_DESTELLO_MS + 1)).toBe(0);
    expect(alphaDestello(60_000)).toBe(0);
  });

  it('con ms negativos esta apagado (todavia no hubo golpe)', () => {
    expect(alphaDestello(-1)).toBe(0);
    expect(alphaDestello(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('cae de forma cuadratica: a la mitad vale 0.25, no 0.5', () => {
    expect(alphaDestello(DURACION_DESTELLO_MS / 2)).toBeCloseTo(0.25, 10);
  });

  it('es monotono decreciente y queda dentro de [0, 1]', () => {
    let anterior = 1;
    for (let ms = 0; ms < DURACION_DESTELLO_MS; ms += 8) {
      const a = alphaDestello(ms);
      expect(a).toBeLessThanOrEqual(anterior);
      expect(a).toBeGreaterThanOrEqual(0);
      anterior = a;
    }
  });
});

describe('escalaDestello (T-050)', () => {
  it('nace en la escala inicial y termina en la final', () => {
    expect(escalaDestello(0)).toBeCloseTo(ESCALA_INICIAL_DESTELLO, 10);
    expect(escalaDestello(DURACION_DESTELLO_MS)).toBeCloseTo(ESCALA_FINAL_DESTELLO, 10);
  });

  it('con ms negativos vale la inicial y pasada la duracion la final', () => {
    expect(escalaDestello(-50)).toBe(ESCALA_INICIAL_DESTELLO);
    expect(escalaDestello(5000)).toBe(ESCALA_FINAL_DESTELLO);
  });

  it('se expande rapido y frena: a la mitad ya paso de la mitad del recorrido', () => {
    const mitad = escalaDestello(DURACION_DESTELLO_MS / 2);
    const puntoMedio = (ESCALA_INICIAL_DESTELLO + ESCALA_FINAL_DESTELLO) / 2;
    expect(mitad).toBeGreaterThan(puntoMedio);
    expect(mitad).toBeLessThan(ESCALA_FINAL_DESTELLO);
  });

  it('crece de forma monotona', () => {
    let anterior = 0;
    for (let ms = 0; ms <= DURACION_DESTELLO_MS; ms += 8) {
      const e = escalaDestello(ms);
      expect(e).toBeGreaterThanOrEqual(anterior);
      anterior = e;
    }
  });
});

describe('desplazamientoJuicio (T-050)', () => {
  it('arranca en +6 px al aparecer', () => {
    expect(DESPLAZAMIENTO_POP_JUICIO).toBe(6);
    expect(desplazamientoJuicio(0)).toBe(6);
  });

  it('llega a 0 en su duracion y se queda en 0', () => {
    expect(desplazamientoJuicio(DESPLAZAMIENTO_JUICIO_MS)).toBe(0);
    expect(desplazamientoJuicio(DESPLAZAMIENTO_JUICIO_MS + 500)).toBe(0);
  });

  it('con ms negativos vale 0 (no hay juicio en pantalla)', () => {
    expect(desplazamientoJuicio(-1)).toBe(0);
  });

  it('baja de forma monotona y nunca es negativo', () => {
    let anterior = Number.POSITIVE_INFINITY;
    for (let ms = 0; ms < DESPLAZAMIENTO_JUICIO_MS; ms += 6) {
      const d = desplazamientoJuicio(ms);
      expect(d).toBeLessThanOrEqual(anterior);
      expect(d).toBeGreaterThanOrEqual(0);
      anterior = d;
    }
  });
});

describe('normalizarOpacidadPista (T-050)', () => {
  it('sin valor da el default 0.85', () => {
    expect(OPACIDAD_PISTA_POR_DEFECTO).toBe(0.85);
    expect(normalizarOpacidadPista(undefined)).toBe(0.85);
  });

  it('respeta los valores validos, incluidos los extremos 0 y 1', () => {
    expect(normalizarOpacidadPista(0)).toBe(0);
    expect(normalizarOpacidadPista(0.4)).toBe(0.4);
    expect(normalizarOpacidadPista(1)).toBe(1);
  });

  it('recorta lo que se sale de [0, 1]', () => {
    expect(normalizarOpacidadPista(-0.2)).toBe(0);
    expect(normalizarOpacidadPista(7)).toBe(1);
  });

  it('un NaN o infinito cae al default en vez de propagarse', () => {
    expect(normalizarOpacidadPista(Number.NaN)).toBe(0.85);
    expect(normalizarOpacidadPista(Number.POSITIVE_INFINITY)).toBe(0.85);
  });
});
