// Tests de apps/web/src/header-logica.ts.

import { describe, expect, it } from 'vitest';
import { msHastaProximoMinuto } from './header-logica.js';

describe('msHastaProximoMinuto', () => {
  it('al inicio exacto del minuto espera casi un minuto entero', () => {
    const fecha = new Date(2026, 0, 1, 10, 30, 0, 0);
    expect(msHastaProximoMinuto(fecha)).toBe(60_020);
  });

  it('a mitad de minuto espera lo que falta, con margen', () => {
    const fecha = new Date(2026, 0, 1, 10, 30, 30, 0);
    expect(msHastaProximoMinuto(fecha)).toBe(30_020);
  });

  it('a un milisegundo del cambio espera solo el margen mas ese milisegundo', () => {
    const fecha = new Date(2026, 0, 1, 10, 30, 59, 999);
    expect(msHastaProximoMinuto(fecha)).toBe(21);
  });

  it('nunca devuelve menos de cero ni mas de un minuto con margen', () => {
    for (let s = 0; s < 60; s++) {
      for (const ms of [0, 1, 500, 999]) {
        const espera = msHastaProximoMinuto(new Date(2026, 5, 15, 23, 59, s, ms));
        expect(espera).toBeGreaterThan(0);
        expect(espera).toBeLessThanOrEqual(60_020);
      }
    }
  });
});
