// Tests de T-060 para apps/web/src/offset-vivo-logica.ts.

import { describe, expect, it } from 'vitest';
import {
  GOLPES_MINIMOS_PARA_AJUSTAR,
  crearSesgoAcumulado,
  etiquetaDeAjusteEnPausa,
  sentidoDeTeclaDeOffset,
  textoDeAvisoDeOffset,
} from './offset-vivo-logica.js';

describe('sentidoDeTeclaDeOffset', () => {
  it('= y + suben el offset; - lo baja (el signo es el punto delicado)', () => {
    expect(sentidoDeTeclaDeOffset('Equal', '=')).toBe(1);
    expect(sentidoDeTeclaDeOffset('Equal', '+')).toBe(1);
    expect(sentidoDeTeclaDeOffset('NumpadAdd', '+')).toBe(1);
    expect(sentidoDeTeclaDeOffset('Minus', '-')).toBe(-1);
    expect(sentidoDeTeclaDeOffset('NumpadSubtract', '-')).toBe(-1);
  });

  it('en otra distribucion de teclado se reconoce por la tecla escrita', () => {
    // En un teclado espanol el + esta en BracketRight.
    expect(sentidoDeTeclaDeOffset('BracketRight', '+')).toBe(1);
    expect(sentidoDeTeclaDeOffset('Slash', '-')).toBe(-1);
  });

  it('cualquier otra tecla no ajusta', () => {
    expect(sentidoDeTeclaDeOffset('KeyD', 'd')).toBe(0);
    expect(sentidoDeTeclaDeOffset('F3', 'F3')).toBe(0);
    expect(sentidoDeTeclaDeOffset('Digit1', '1')).toBe(0);
  });
});

describe('textoDeAvisoDeOffset', () => {
  it('lleva el signo (T-060: lo que se ajusta en vivo es siempre el global)', () => {
    expect(textoDeAvisoDeOffset(12)).toBe('Offset +12 ms');
    expect(textoDeAvisoDeOffset(-8)).toBe('Offset -8 ms');
    expect(textoDeAvisoDeOffset(0)).toBe('Offset 0 ms');
    expect(textoDeAvisoDeOffset(5)).toBe('Offset +5 ms');
  });
});

describe('crearSesgoAcumulado', () => {
  it('sin golpes: media 0 y se queda con el respaldo', () => {
    const s = crearSesgoAcumulado();
    expect(s.cantidad()).toBe(0);
    expect(s.mediaDeError()).toBe(0);
    expect(s.offsetPromedio(7)).toBe(7);
    expect(s.offsetCorregido(7)).toBe(7);
  });

  it('con el offset fijo da lo mismo que calcularOffsetCorregido: se SUMA la media', () => {
    const s = crearSesgoAcumulado();
    // Pega tarde por 61 ms con el offset en 10: hay que subirlo a 71.
    for (let i = 0; i < 10; i++) s.agregar(61, 10);
    expect(s.mediaDeError()).toBe(61);
    expect(s.offsetCorregido(0)).toBe(71);
    // Si el signo estuviera invertido (restar) daria -51.
    expect(s.offsetCorregido(0)).not.toBe(10 - 61);
  });

  it('pega temprano: el offset baja', () => {
    const s = crearSesgoAcumulado();
    for (let i = 0; i < 10; i++) s.agregar(-24, 0);
    expect(s.offsetCorregido(0)).toBe(-24);
  });

  it('si el offset se movio en vivo, cada golpe cuenta con el offset de su momento', () => {
    const s = crearSesgoAcumulado();
    // Mismo desfase fisico de +60 ms: 10 golpes con offset 0 (error +60) y 10 con
    // offset +60 (error 0). El offset que deja la media en 0 sigue siendo 60.
    for (let i = 0; i < 10; i++) s.agregar(60, 0);
    for (let i = 0; i < 10; i++) s.agregar(0, 60);
    expect(s.offsetCorregido(0)).toBe(60);
    // Sin el offset de cada golpe (media de error 30 sobre un offset de 60 al final) daria 90.
    expect(s.mediaDeError()).toBe(30);
    expect(s.offsetPromedio(0)).toBe(30);
  });

  it('reiniciar lo vacia', () => {
    const s = crearSesgoAcumulado();
    s.agregar(20, 0);
    s.reiniciar();
    expect(s.cantidad()).toBe(0);
    expect(s.offsetCorregido(3)).toBe(3);
  });

  it('ignora valores no finitos', () => {
    const s = crearSesgoAcumulado();
    s.agregar(Number.NaN, 0);
    s.agregar(10, Number.POSITIVE_INFINITY);
    expect(s.cantidad()).toBe(0);
  });
});

describe('etiquetaDeAjusteEnPausa', () => {
  it('con menos de 20 golpes no hay boton', () => {
    expect(GOLPES_MINIMOS_PARA_AJUSTAR).toBe(20);
    expect(etiquetaDeAjusteEnPausa(19, 61)).toBeNull();
    expect(etiquetaDeAjusteEnPausa(20, 61)).toBe('Ajustar offset (+61 ms)');
  });

  it('muestra el cambio con signo', () => {
    expect(etiquetaDeAjusteEnPausa(50, -24.4)).toBe('Ajustar offset (-24 ms)');
  });

  it('si no cambiaria nada no hay boton', () => {
    expect(etiquetaDeAjusteEnPausa(50, 0)).toBeNull();
    expect(etiquetaDeAjusteEnPausa(50, 0.3)).toBeNull();
  });
});
