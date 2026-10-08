// Tests de T-057 para apps/web/src/velocidad-aviso-logica.ts.

import { describe, expect, it } from 'vitest';
import {
  DURACION_AVISO_VELOCIDAD_MS,
  MS_AVISO_VELOCIDAD_ENTERO,
  PASOS_DE_ALPHA_AVISO,
  alphaDeAvisoDeVelocidad,
  moverVelocidad,
  pasoDeAlphaDeAvisoDeVelocidad,
  textoDeAvisoDeVelocidad,
} from './velocidad-aviso-logica.js';
import { VELOCIDAD_MAX, VELOCIDAD_MIN } from './velocidad.js';

describe('moverVelocidad', () => {
  it('sube y baja de a uno', () => {
    expect(moverVelocidad(5, 1)).toBe(6);
    expect(moverVelocidad(5, -1)).toBe(4);
  });

  it('no sale del rango 1 a 12', () => {
    expect(moverVelocidad(VELOCIDAD_MAX, 1)).toBe(VELOCIDAD_MAX);
    expect(moverVelocidad(VELOCIDAD_MIN, -1)).toBe(VELOCIDAD_MIN);
    expect(VELOCIDAD_MIN).toBe(1);
    expect(VELOCIDAD_MAX).toBe(12);
  });
});

describe('textoDeAvisoDeVelocidad', () => {
  it('muestra la velocidad y los ms de caida', () => {
    expect(textoDeAvisoDeVelocidad(7)).toBe('Velocidad 7 · 514 ms');
    expect(textoDeAvisoDeVelocidad(3)).toBe('Velocidad 3 · 1200 ms');
    expect(textoDeAvisoDeVelocidad(12)).toBe('Velocidad 12 · 300 ms');
    expect(textoDeAvisoDeVelocidad(1)).toBe('Velocidad 1 · 3600 ms');
  });
});

describe('alphaDeAvisoDeVelocidad', () => {
  it('se ve entero al aparecer y durante el tramo inicial', () => {
    expect(alphaDeAvisoDeVelocidad(0)).toBe(1);
    expect(alphaDeAvisoDeVelocidad(MS_AVISO_VELOCIDAD_ENTERO)).toBe(1);
  });

  it('despues baja linealmente hasta 0 al cumplirse la duracion', () => {
    const mitad = (MS_AVISO_VELOCIDAD_ENTERO + DURACION_AVISO_VELOCIDAD_MS) / 2;
    expect(alphaDeAvisoDeVelocidad(mitad)).toBeCloseTo(0.5, 10);
    expect(alphaDeAvisoDeVelocidad(DURACION_AVISO_VELOCIDAD_MS)).toBe(0);
    expect(alphaDeAvisoDeVelocidad(DURACION_AVISO_VELOCIDAD_MS * 5)).toBe(0);
  });

  it('dura alrededor de un segundo', () => {
    expect(DURACION_AVISO_VELOCIDAD_MS).toBe(1000);
  });

  it('una edad negativa cuenta como recien nacida y una no valida como apagada', () => {
    expect(alphaDeAvisoDeVelocidad(-50)).toBe(1);
    expect(alphaDeAvisoDeVelocidad(Number.NaN)).toBe(0);
  });

  it('nunca sube con la edad', () => {
    let previo = 1;
    for (let edad = 0; edad <= 1200; edad += 25) {
      const alpha = alphaDeAvisoDeVelocidad(edad);
      expect(alpha).toBeLessThanOrEqual(previo);
      previo = alpha;
    }
  });
});

describe('pasoDeAlphaDeAvisoDeVelocidad', () => {
  it('va de PASOS_DE_ALPHA_AVISO a 0', () => {
    expect(pasoDeAlphaDeAvisoDeVelocidad(0)).toBe(PASOS_DE_ALPHA_AVISO);
    expect(pasoDeAlphaDeAvisoDeVelocidad(DURACION_AVISO_VELOCIDAD_MS)).toBe(0);
  });
});
