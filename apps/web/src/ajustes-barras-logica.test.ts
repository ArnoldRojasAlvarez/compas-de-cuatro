import { describe, expect, it } from 'vitest';
import {
  OFFSET_BARRA_MAX,
  OFFSET_BARRA_MIN,
  deltaDeOffset,
  formatearOffset,
  formatearVelocidad,
  offsetABarra,
  pasoDeOffset,
} from './ajustes-barras-logica.js';

describe('formatearVelocidad', () => {
  it('muestra el nivel y los ms que tarda una nota en cruzar la pista', () => {
    expect(formatearVelocidad(7)).toBe('7 · 514 ms');
    expect(formatearVelocidad(3)).toBe('3 · 1200 ms');
    expect(formatearVelocidad(1)).toBe('1 · 3600 ms');
    expect(formatearVelocidad(12)).toBe('12 · 300 ms');
  });

  it('recorta lo que se sale de 1 a 12 en el nivel y en los ms a la vez', () => {
    expect(formatearVelocidad(40)).toBe('12 · 300 ms');
    expect(formatearVelocidad(0)).toBe('1 · 3600 ms');
  });
});

describe('formatearOffset', () => {
  it('lleva signo explicito salvo en el cero', () => {
    expect(formatearOffset(12)).toBe('+12 ms');
    expect(formatearOffset(-8)).toBe('-8 ms');
    expect(formatearOffset(0)).toBe('0 ms');
  });

  it('no escribe -0 ni +0', () => {
    expect(formatearOffset(-0)).toBe('0 ms');
    expect(formatearOffset(-0.4)).toBe('0 ms');
    expect(formatearOffset(0.4)).toBe('0 ms');
  });

  it('muestra el valor real aunque pase de la barra', () => {
    expect(formatearOffset(240)).toBe('+240 ms');
    expect(formatearOffset(-310)).toBe('-310 ms');
  });
});

describe('offsetABarra', () => {
  it('deja igual lo que cabe en la barra', () => {
    expect(offsetABarra(12)).toBe(12);
    expect(offsetABarra(-150)).toBe(-150);
    expect(offsetABarra(150)).toBe(150);
  });

  it('recorta a los extremos lo que se pasa', () => {
    expect(offsetABarra(240)).toBe(OFFSET_BARRA_MAX);
    expect(offsetABarra(-1000)).toBe(OFFSET_BARRA_MIN);
  });

  it('redondea al ms y no devuelve -0', () => {
    expect(offsetABarra(12.6)).toBe(13);
    expect(Object.is(offsetABarra(-0.2), 0)).toBe(true);
  });
});

describe('pasoDeOffset', () => {
  it('suma y resta el delta dentro de la barra', () => {
    expect(pasoDeOffset(0, 1)).toBe(1);
    expect(pasoDeOffset(0, -1)).toBe(-1);
    expect(pasoDeOffset(10, 5)).toBe(15);
  });

  it('se frena en los extremos de la barra', () => {
    expect(pasoDeOffset(148, 5)).toBe(150);
    expect(pasoDeOffset(150, 1)).toBe(150);
    expect(pasoDeOffset(-149, -5)).toBe(-150);
  });

  it('parte del valor real: fuera de la barra se puede volver pero no alejarse mas', () => {
    expect(pasoDeOffset(400, 1)).toBe(400);
    expect(pasoDeOffset(400, -1)).toBe(399);
    expect(pasoDeOffset(-400, -5)).toBe(-400);
    expect(pasoDeOffset(-400, 5)).toBe(-395);
  });
});

describe('deltaDeOffset', () => {
  it('1 ms sin Shift y 5 ms con Shift, con el signo pedido', () => {
    expect(deltaDeOffset(1, false)).toBe(1);
    expect(deltaDeOffset(-1, false)).toBe(-1);
    expect(deltaDeOffset(1, true)).toBe(5);
    expect(deltaDeOffset(-1, true)).toBe(-5);
  });
});
