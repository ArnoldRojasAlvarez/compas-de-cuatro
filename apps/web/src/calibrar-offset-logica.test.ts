// Tests de T-060 para apps/web/src/calibrar-offset-logica.ts.

import { describe, expect, it } from 'vitest';
import {
  ESCALA_DE_BARRA_MS,
  GOLPES_MINIMOS_PARA_USAR,
  INTERVALO_DE_PULSO_MS,
  PULSOS_DE_ENTRADA,
  PULSOS_TOTALES,
  crearCalibracion,
  errorDeGolpe,
  instanteDeCierre,
  instanteDelPulso,
  offsetCalibrado,
  posicionEnBarraDeCalibracion,
  pulsoCuenta,
  pulsoMasCercano,
  textoDeProgreso,
  textoDeUsar,
} from './calibrar-offset-logica.js';

/** Pulsa todos los pulsos que cuentan con un desfase fisico fijo (ms) y devuelve la calibracion. */
function jugarConDesfase(desfase: number, offsetActual = 0, latencia = 0) {
  const c = crearCalibracion(offsetActual, latencia);
  for (let k = 0; k < PULSOS_TOTALES; k++) c.agregar(instanteDelPulso(k) + desfase);
  return c;
}

describe('pulsos', () => {
  it('es un metronomo a 120 BPM de 32 pulsos y los 4 primeros no cuentan', () => {
    expect(INTERVALO_DE_PULSO_MS).toBe(500);
    expect(PULSOS_TOTALES).toBe(32);
    expect(PULSOS_DE_ENTRADA).toBe(4);
    expect(pulsoCuenta(3)).toBe(false);
    expect(pulsoCuenta(4)).toBe(true);
    expect(pulsoCuenta(31)).toBe(true);
    expect(pulsoCuenta(32)).toBe(false);
    expect(instanteDelPulso(7)).toBe(3500);
  });

  it('una pulsacion va al pulso mas cercano, tarde o temprano', () => {
    expect(pulsoMasCercano(1040)).toBe(2);
    expect(pulsoMasCercano(960)).toBe(2);
    expect(pulsoMasCercano(1249)).toBe(2);
    expect(pulsoMasCercano(1251)).toBe(3);
  });
});

describe('errorDeGolpe', () => {
  it('positivo es tarde y el offset que rige se descuenta, como en la partida', () => {
    expect(errorDeGolpe(1040, 2, 0, 0)).toBe(40);
    expect(errorDeGolpe(960, 2, 0, 0)).toBe(-40);
    // Con un offset de +10 y 5 ms de latencia, el juego mediria 25 y no 40.
    expect(errorDeGolpe(1040, 2, 10, 5)).toBe(25);
  });
});

describe('crearCalibracion', () => {
  it('pulsando 40 ms tarde la media es +40', () => {
    const c = jugarConDesfase(40);
    expect(c.media()).toBeCloseTo(40, 10);
    expect(c.cantidad()).toBe(PULSOS_TOTALES - PULSOS_DE_ENTRADA);
    expect(c.cantidad()).toBeGreaterThanOrEqual(GOLPES_MINIMOS_PARA_USAR);
  });

  it('pulsando temprano la media es negativa', () => {
    expect(jugarConDesfase(-25).media()).toBeCloseTo(-25, 10);
  });

  it('los pulsos de entrada se asignan pero no entran en la media', () => {
    const c = crearCalibracion(0, 0);
    const entrada = c.agregar(instanteDelPulso(1) + 200);
    expect(entrada).toEqual({ pulso: 1, error: 200, cuenta: false });
    expect(c.cantidad()).toBe(0);
    expect(c.media()).toBe(0);
    c.agregar(instanteDelPulso(5) + 10);
    // Si el de entrada contara, la media seria 105.
    expect(c.media()).toBe(10);
  });

  it('cada pulso admite un solo golpe: el primero', () => {
    const c = crearCalibracion(0, 0);
    expect(c.agregar(instanteDelPulso(6) + 30)).not.toBeNull();
    expect(c.agregar(instanteDelPulso(6) + 90)).toBeNull();
    expect(c.cantidad()).toBe(1);
    expect(c.media()).toBe(30);
  });

  it('antes de empezar o despues del final no hay pulso', () => {
    const c = crearCalibracion(0, 0);
    expect(c.agregar(-600)).toBeNull();
    expect(c.agregar(instanteDelPulso(PULSOS_TOTALES) + 10)).toBeNull();
    expect(c.agregar(Number.NaN)).toBeNull();
  });
});

describe('offsetCalibrado: el signo', () => {
  it('pegando 40 ms tarde con offset 0, el offset nuevo es +40 (sube)', () => {
    const c = jugarConDesfase(40);
    expect(offsetCalibrado(0, c.media())).toBe(40);
    // Con el signo invertido (restar la media) daria -40: el offset se alejaria.
    expect(offsetCalibrado(0, c.media())).not.toBe(-40);
  });

  it('pegando temprano el offset baja', () => {
    expect(offsetCalibrado(0, jugarConDesfase(-24).media())).toBe(-24);
  });

  it('no depende del offset con el que se midio: el desfase fisico es el mismo', () => {
    for (const actual of [-30, 0, 15, 60]) {
      const c = jugarConDesfase(40, actual);
      expect(offsetCalibrado(actual, c.media())).toBe(40);
    }
  });

  it('con latencia de salida: el offset nuevo es el desfase menos esa latencia', () => {
    // El navegador ya descuenta 12 ms de latencia en el reloj; al offset del usuario le tocan 28.
    const c = jugarConDesfase(40, 0, 12);
    expect(c.media()).toBeCloseTo(28, 10);
    expect(offsetCalibrado(0, c.media())).toBe(28);
  });

  it('redondea a ms y nunca devuelve -0', () => {
    expect(offsetCalibrado(0, 40.6)).toBe(41);
    expect(Object.is(offsetCalibrado(0, -0.2), 0)).toBe(true);
  });
});

describe('barra de golpes', () => {
  it('error 0 va al centro, tarde a la derecha, temprano a la izquierda, y se recorta', () => {
    expect(posicionEnBarraDeCalibracion(0)).toBe(50);
    expect(posicionEnBarraDeCalibracion(ESCALA_DE_BARRA_MS / 2)).toBe(75);
    expect(posicionEnBarraDeCalibracion(-ESCALA_DE_BARRA_MS / 2)).toBe(25);
    expect(posicionEnBarraDeCalibracion(1000)).toBe(100);
    expect(posicionEnBarraDeCalibracion(-1000)).toBe(0);
  });
});

describe('textos', () => {
  it('el boton lleva el offset con signo', () => {
    expect(textoDeUsar(40)).toBe('Usar +40 ms');
    expect(textoDeUsar(-8)).toBe('Usar -8 ms');
    expect(textoDeUsar(0)).toBe('Usar 0 ms');
  });

  it('el progreso pasa de escucha a entrada a pulso, y se apaga al cierre', () => {
    expect(textoDeProgreso(-1200)).toBe('Escucha el click');
    expect(textoDeProgreso(0)).toBe('Entrando en tiempo 1/32');
    expect(textoDeProgreso(instanteDelPulso(3))).toBe('Entrando en tiempo 4/32');
    expect(textoDeProgreso(instanteDelPulso(4))).toBe('Pulso 5/32');
    expect(textoDeProgreso(instanteDelPulso(31))).toBe('Pulso 32/32');
    expect(textoDeProgreso(instanteDeCierre())).toBeNull();
  });
});
