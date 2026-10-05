// T-054: la opcion `centro` del fondo de la escena (vineta inversa del menu).
// Solo la parte pura: el DOM se verifica en el navegador.

import { describe, expect, it } from 'vitest';
import { normalizarOpcionesFondo } from './fondo-escena.js';

describe('normalizarOpcionesFondo', () => {
  it('sin opciones el centro no se oscurece de mas (el song select no lo usa)', () => {
    // Un default distinto de 0 dejaria la vineta del menu puesta en el song select.
    expect(normalizarOpcionesFondo(undefined).centro).toBe(0);
    expect(normalizarOpcionesFondo({ oscuridad: 0.5 }).centro).toBe(0);
  });

  it('respeta el centro pedido y lo recorta a 0..1', () => {
    expect(normalizarOpcionesFondo({ centro: 0.4 }).centro).toBe(0.4);
    expect(normalizarOpcionesFondo({ centro: 3 }).centro).toBe(1);
    expect(normalizarOpcionesFondo({ centro: -1 }).centro).toBe(0);
  });

  it('un centro no numerico vuelve al default en vez de propagar NaN al CSS', () => {
    expect(normalizarOpcionesFondo({ centro: Number.NaN }).centro).toBe(0);
  });

  it('el centro no cambia la oscuridad ni el desenfoque', () => {
    const r = normalizarOpcionesFondo({ oscuridad: 0.5, desenfoque: 2, centro: 1 });
    expect(r).toEqual({ oscuridad: 0.5, desenfoque: 2, centro: 1 });
  });
});
