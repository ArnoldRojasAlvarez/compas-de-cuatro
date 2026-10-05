// Tests de T-052 para la logica nueva del song select (song-select-logica.ts):
// linea de datos, barra de progreso del preview, foco tras borrar y movimiento
// por teclado. Cada caso nombra la implementacion incorrecta que lo haria fallar.

import { describe, expect, it } from 'vitest';
import type { Chart } from '@tetra/core';
import {
  formatearBpm,
  formatearLineaDeDatos,
  fraccionDeClic,
  fraccionDePosicion,
  idTrasBorrar,
  moverIndice,
  posicionDePreviewSegundos,
  rangoBpm,
} from './song-select-logica.js';

function chart(parcial: Partial<Chart> = {}, creador = 'Tetra'): Chart {
  return {
    metadata: {
      title: 'Titulo',
      artist: 'Artista',
      creator: creador,
      difficultyName: 'Normal',
      audioFile: 'audio.mp3',
      previewTime: 0,
    },
    overallDifficulty: 6,
    hpDrain: 5,
    timingPoints: [{ time: 0, bpm: 128, meter: 4 }],
    speedPoints: [],
    notes: [],
    ...parcial,
  };
}

describe('formatearBpm y rangoBpm', () => {
  it('un solo tempo se muestra como un numero, sin rango', () => {
    // Una implementacion que siempre mostrara "min-max" daria "128-128".
    expect(formatearBpm(chart())).toBe('128');
  });

  it('con tempo variable muestra el rango de menor a mayor, sin importar el orden', () => {
    const c = chart({
      timingPoints: [
        { time: 0, bpm: 180, meter: 4 },
        { time: 5000, bpm: 120, meter: 4 },
        { time: 9000, bpm: 150, meter: 4 },
      ],
    });
    // Mirar solo el primer y el ultimo punto daria "180-150".
    expect(formatearBpm(c)).toBe('120-180');
    expect(rangoBpm(c)).toEqual({ minimo: 120, maximo: 180 });
  });

  it('redondea antes de decidir si hay rango (119.8 y 120.2 son el mismo 120)', () => {
    const c = chart({
      timingPoints: [
        { time: 0, bpm: 119.8, meter: 4 },
        { time: 4000, bpm: 120.2, meter: 4 },
      ],
    });
    // Comparar sin redondear mostraria "120-120".
    expect(formatearBpm(c)).toBe('120');
  });

  it('sin timing points no revienta: 0', () => {
    expect(formatearBpm(chart({ timingPoints: [] }))).toBe('0');
  });
});

describe('formatearLineaDeDatos', () => {
  it('arma creador, BPM, duracion mm:ss y notas', () => {
    const c = chart({
      notes: [
        { kind: 'tap', time: 1000, column: 0 },
        { kind: 'hold', time: 2000, endTime: 80_000, column: 1 },
      ],
    });
    // Duracion = fin de la hold (80 s = 1:20), no el time de su inicio.
    expect(formatearLineaDeDatos(c)).toBe('Tetra · 128 BPM · 1:20 · 2 notas');
  });

  it('muestra el rango de BPM cuando varia', () => {
    const c = chart({
      timingPoints: [
        { time: 0, bpm: 100, meter: 4 },
        { time: 1000, bpm: 140, meter: 4 },
      ],
    });
    expect(formatearLineaDeDatos(c)).toContain('100-140 BPM');
  });

  it('sin creador no deja un separador colgado al principio', () => {
    // Una implementacion que uniera siempre las cuatro partes daria " · 128 BPM ...".
    expect(formatearLineaDeDatos(chart({}, '  ')).startsWith('128 BPM')).toBe(true);
  });
});

describe('fraccionDeClic', () => {
  it('el centro de la barra es 0.5 y los extremos 0 y 1', () => {
    expect(fraccionDeClic(150, 100, 200)).toBe(0.25);
    expect(fraccionDeClic(100, 100, 200)).toBe(0);
    expect(fraccionDeClic(300, 100, 200)).toBe(1);
  });

  it('descuenta el borde izquierdo de la barra (no es clienteX / ancho)', () => {
    // Sin restar `izquierda`, 500 / 400 pasaria de 1 y daria 1 en vez de 0.25.
    expect(fraccionDeClic(500, 400, 400)).toBe(0.25);
  });

  it('un clic fuera de la barra se recorta a 0 o 1', () => {
    expect(fraccionDeClic(50, 100, 200)).toBe(0);
    expect(fraccionDeClic(900, 100, 200)).toBe(1);
  });

  it('una barra sin ancho da 0, no NaN ni Infinity', () => {
    expect(fraccionDeClic(10, 0, 0)).toBe(0);
  });
});

describe('posicionDePreviewSegundos', () => {
  it('avanza con el reloj del contexto desde el offset de arranque', () => {
    // Arranco en 30 s cuando el contexto marcaba 2 s; ahora marca 7 s.
    expect(posicionDePreviewSegundos(30, 2, 7, 100)).toBe(35);
  });

  it('da la vuelta al llegar al final del audio (esta en bucle)', () => {
    // Una implementacion sin el modulo daria 105 y la barra se saldria.
    expect(posicionDePreviewSegundos(95, 0, 10, 100)).toBe(5);
  });

  it('con el contexto suspendido (ahora no avanza) la posicion queda quieta', () => {
    const a = posicionDePreviewSegundos(10, 4, 6, 60);
    const b = posicionDePreviewSegundos(10, 4, 6, 60);
    expect(a).toBe(b);
    expect(a).toBe(12);
  });

  it('un reloj anterior al arranque (reinicio del contexto) no da posicion negativa', () => {
    expect(posicionDePreviewSegundos(10, 5, 3, 60)).toBe(10);
  });

  it('duracion 0 da 0 (no NaN por el modulo)', () => {
    expect(posicionDePreviewSegundos(0, 0, 5, 0)).toBe(0);
  });
});

describe('fraccionDePosicion', () => {
  it('es posicion sobre duracion, recortada a 0..1', () => {
    expect(fraccionDePosicion(15, 60)).toBe(0.25);
    expect(fraccionDePosicion(90, 60)).toBe(1);
    expect(fraccionDePosicion(-3, 60)).toBe(0);
    expect(fraccionDePosicion(5, 0)).toBe(0);
  });
});

describe('idTrasBorrar', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('el foco pasa a la que queda en su lugar (la siguiente)', () => {
    expect(idTrasBorrar(ids, 'b')).toBe('c');
    expect(idTrasBorrar(ids, 'a')).toBe('b');
  });

  it('si era la ultima, pasa a la anterior', () => {
    // Una implementacion que solo mirara la siguiente daria null aca.
    expect(idTrasBorrar(ids, 'd')).toBe('c');
  });

  it('si era la unica, no queda ninguna', () => {
    expect(idTrasBorrar(['a'], 'a')).toBeNull();
  });

  it('un id que no esta en la lista da null (no el primero por defecto)', () => {
    expect(idTrasBorrar(ids, 'z')).toBeNull();
  });
});

describe('moverIndice', () => {
  it('avanza y retrocede dentro de la lista', () => {
    expect(moverIndice(1, 5, 1)).toBe(2);
    expect(moverIndice(1, 5, -1)).toBe(0);
  });

  it('se detiene en los extremos, no da la vuelta', () => {
    expect(moverIndice(4, 5, 1)).toBe(4);
    expect(moverIndice(0, 5, -1)).toBe(0);
  });

  it('con nada enfocado, abajo cae en la primera y arriba en la ultima', () => {
    expect(moverIndice(-1, 5, 1)).toBe(0);
    expect(moverIndice(-1, 5, -1)).toBe(4);
  });

  it('lista vacia da -1', () => {
    expect(moverIndice(0, 0, 1)).toBe(-1);
  });
});
