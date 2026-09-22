// Tests de T-010 para apps/web/src/logo-logica.ts. Todo esto es logica pura
// (sin Canvas, sin AudioContext, sin rAF), asi que corre en el entorno node
// de vitest sin ningun doble de prueba, mismo patron que offset.test.ts.

import { describe, expect, it } from 'vitest';
import {
  ESTADO_PULSO_INICIAL,
  anguloDeRotacion,
  avanzarPulso,
  calcularAlturasDeBarras,
  calcularEnergia,
  escalaDeReposo,
  escalaTotal,
} from './logo-logica.js';

describe('calcularEnergia', () => {
  it('un arreglo vacio no rompe y da 0', () => {
    expect(calcularEnergia([])).toBe(0);
  });

  it('silencio total (todo en 0) da energia 0', () => {
    expect(calcularEnergia(new Uint8Array(32))).toBe(0);
  });

  it('todo al maximo (255) da energia 1', () => {
    expect(calcularEnergia(new Uint8Array(16).fill(255))).toBe(1);
  });

  it('promedia valores mixtos', () => {
    expect(calcularEnergia([0, 255])).toBeCloseTo(0.5, 5);
  });
});

describe('calcularAlturasDeBarras', () => {
  it('numBarras 0 o negativo devuelve un arreglo vacio', () => {
    expect(calcularAlturasDeBarras([1, 2, 3], 0)).toEqual([]);
    expect(calcularAlturasDeBarras([1, 2, 3], -1)).toEqual([]);
  });

  it('datos vacios devuelve numBarras ceros (el logo en reposo, sin audio)', () => {
    expect(calcularAlturasDeBarras([], 4)).toEqual([0, 0, 0, 0]);
  });

  it('reparte los datos en baldes del tamano esperado y promedia cada uno', () => {
    // 8 valores, 4 barras: 2 valores por balde.
    const datos = [0, 0, 255, 255, 0, 255, 255, 255];
    const alturas = calcularAlturasDeBarras(datos, 4);
    expect(alturas).toHaveLength(4);
    expect(alturas[0]).toBeCloseTo(0, 5);
    expect(alturas[1]).toBeCloseTo(1, 5);
    expect(alturas[2]).toBeCloseTo(0.5, 5);
    expect(alturas[3]).toBeCloseTo(1, 5);
  });

  it('cada altura queda siempre en el rango 0..1', () => {
    const datos = new Uint8Array(64).map((_, i) => (i * 7) % 256);
    for (const altura of calcularAlturasDeBarras(datos, 10)) {
      expect(altura).toBeGreaterThanOrEqual(0);
      expect(altura).toBeLessThanOrEqual(1);
    }
  });
});

describe('avanzarPulso', () => {
  it('en silencio sostenido nunca dispara un pulso', () => {
    let estado = ESTADO_PULSO_INICIAL;
    for (let i = 0; i < 60; i++) {
      estado = avanzarPulso(estado, 0);
    }
    expect(estado.escalaPulso).toBe(0);
  });

  it('un salto claro de energia por encima del promedio dispara un pulso', () => {
    let estado = ESTADO_PULSO_INICIAL;
    // Unos cuantos cuadros de energia baja y estable para que el promedio
    // movil se asiente antes del golpe.
    for (let i = 0; i < 20; i++) {
      estado = avanzarPulso(estado, 0.1);
    }
    const estadoTrasGolpe = avanzarPulso(estado, 0.9);
    expect(estadoTrasGolpe.escalaPulso).toBeGreaterThan(0);
    expect(estadoTrasGolpe.cuadrosDesdeUltimoPulso).toBe(0);
  });

  it('el pulso decae con los cuadros siguientes en vez de cortar seco', () => {
    let estado = ESTADO_PULSO_INICIAL;
    for (let i = 0; i < 20; i++) estado = avanzarPulso(estado, 0.1);
    estado = avanzarPulso(estado, 0.9); // dispara
    const escalaInicial = estado.escalaPulso;
    estado = avanzarPulso(estado, 0.1); // sin golpe nuevo: decae
    expect(estado.escalaPulso).toBeLessThan(escalaInicial);
    expect(estado.escalaPulso).toBeGreaterThan(0);
  });

  it('respeta el enfriamiento: dos golpes pegados no disparan dos pulsos', () => {
    let estado = ESTADO_PULSO_INICIAL;
    for (let i = 0; i < 20; i++) estado = avanzarPulso(estado, 0.1);
    estado = avanzarPulso(estado, 0.9); // dispara el primero
    const escalaTrasPrimero = estado.escalaPulso;
    estado = avanzarPulso(estado, 0.9); // "golpe" inmediatamente despues: en enfriamiento
    // Sin un segundo disparo, la escala solo puede decaer respecto del primero.
    expect(estado.escalaPulso).toBeLessThanOrEqual(escalaTrasPrimero);
  });
});

describe('escalaDeReposo', () => {
  it('nunca es exactamente 0 en un tick generico (nunca "quieto muerto")', () => {
    expect(escalaDeReposo(1)).not.toBe(0);
  });

  it('en tick 0 arranca en 0 pero se mueve enseguida', () => {
    expect(escalaDeReposo(0)).toBe(0);
    expect(escalaDeReposo(1)).not.toBe(0);
  });

  it('se mantiene siempre en un rango chico (respiracion sutil, no un salto)', () => {
    for (let tick = 0; tick < 500; tick++) {
      expect(Math.abs(escalaDeReposo(tick))).toBeLessThanOrEqual(0.015);
    }
  });
});

describe('escalaTotal', () => {
  it('sin pulso, es 1 mas la respiracion de reposo', () => {
    expect(escalaTotal(10, 0)).toBeCloseTo(1 + escalaDeReposo(10), 10);
  });

  it('con pulso, se suma por encima de la respiracion de reposo', () => {
    expect(escalaTotal(10, 0.07)).toBeCloseTo(1 + escalaDeReposo(10) + 0.07, 10);
  });
});

describe('anguloDeRotacion', () => {
  it('arranca en 0', () => {
    expect(anguloDeRotacion(0)).toBe(0);
  });

  it('crece con el tiempo (sentido horario, nunca retrocede)', () => {
    expect(anguloDeRotacion(100)).toBeGreaterThan(anguloDeRotacion(10));
  });
});
