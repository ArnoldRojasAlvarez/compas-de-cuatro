// Tests de T-026: maquina de estados de la pausa y numero de la cuenta
// regresiva. Funciones puras, sin DOM ni audio.

import { describe, expect, it } from 'vitest';
import {
  PASOS_DE_CUENTA,
  numeroDeCuenta,
  transicionPausa,
  type AccionPausa,
  type FasePausa,
} from './pausa-logica.js';

describe('transicionPausa', () => {
  it('el ciclo completo: jugando, pausado, cuenta, jugando', () => {
    let fase: FasePausa = 'jugando';
    for (const [accion, esperada] of [
      ['pausar', 'pausado'],
      ['continuar', 'cuenta'],
      ['cuentaTerminada', 'jugando'],
    ] as const) {
      const siguiente = transicionPausa(fase, accion);
      expect(siguiente).toBe(esperada);
      fase = siguiente!;
    }
  });

  it('Escape durante la cuenta vuelve a la pausa', () => {
    expect(transicionPausa('cuenta', 'volver')).toBe('pausado');
  });

  it.each<[FasePausa, AccionPausa]>([
    ['jugando', 'continuar'],
    ['jugando', 'volver'],
    ['jugando', 'cuentaTerminada'],
    ['pausado', 'pausar'],
    ['pausado', 'volver'],
    ['pausado', 'cuentaTerminada'],
    ['cuenta', 'pausar'],
    ['cuenta', 'continuar'],
  ])('%s con %s no es una transicion valida', (fase, accion) => {
    expect(transicionPausa(fase, accion)).toBeNull();
  });

  it('no se puede reanudar sin pasar por la cuenta regresiva', () => {
    // Una implementacion que saltara de pausado a jugando haria fallar esto.
    expect(transicionPausa('pausado', 'cuentaTerminada')).toBeNull();
  });
});

describe('numeroDeCuenta', () => {
  it.each([
    [0, 3],
    [0.99, 3],
    [1, 2],
    [1.5, 2],
    [2, 1],
    [2.999, 1],
    [3, 0],
    [10, 0],
  ])('a los %d s muestra %d', (transcurrido, numero) => {
    expect(numeroDeCuenta(transcurrido)).toBe(numero);
  });

  it('un tiempo negativo o NaN cuenta como recien empezada', () => {
    expect(numeroDeCuenta(-5)).toBe(PASOS_DE_CUENTA);
    expect(numeroDeCuenta(Number.NaN)).toBe(PASOS_DE_CUENTA);
  });

  it('respeta una cantidad de pasos distinta', () => {
    expect(numeroDeCuenta(0, 5)).toBe(5);
    expect(numeroDeCuenta(4.2, 5)).toBe(1);
  });
});
