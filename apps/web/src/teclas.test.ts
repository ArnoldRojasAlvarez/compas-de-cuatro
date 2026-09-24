// Tests de T-012 "Parte B" para apps/web/src/teclas.ts.

import { describe, expect, it } from 'vitest';
import { nombreLegibleDeCodigo } from './teclas.js';

describe('nombreLegibleDeCodigo', () => {
  it('una letra (KeyD) muestra solo la letra', () => {
    expect(nombreLegibleDeCodigo('KeyD')).toBe('D');
    expect(nombreLegibleDeCodigo('KeyF')).toBe('F');
    expect(nombreLegibleDeCodigo('KeyZ')).toBe('Z');
  });

  it('un digito (Digit3) muestra solo el numero', () => {
    expect(nombreLegibleDeCodigo('Digit3')).toBe('3');
    expect(nombreLegibleDeCodigo('Digit0')).toBe('0');
  });

  it('casos especiales conocidos salen de la tabla', () => {
    expect(nombreLegibleDeCodigo('Space')).toBe('Espacio');
    expect(nombreLegibleDeCodigo('Semicolon')).toBe(';');
    expect(nombreLegibleDeCodigo('ArrowUp')).toBe('↑');
    expect(nombreLegibleDeCodigo('Escape')).toBe('Escape');
  });

  it('un codigo desconocido se devuelve tal cual, no rompe', () => {
    expect(nombreLegibleDeCodigo('IntlBackslash')).toBe('IntlBackslash');
  });
});
