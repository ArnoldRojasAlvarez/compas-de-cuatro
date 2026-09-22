// Tests de T-009 para el mapeo puro columna -> imagen de skin
// (packages/engine/src/skin.ts, `imagenDeSkin`). Es la pieza que la
// revision del ticket marca como "el bug facil" (ver
// docs/tickets/T-009-skins-osk.md, "Cuidado con la convencion de
// columnas"): si alguien invierte exterior/interior, estos tests fallan.

import { describe, expect, it } from 'vitest';
import type { Column } from '@tetra/core';
import { imagenDeSkin } from './skin.js';

const EXTERIORES: readonly Column[] = [0, 3];
const INTERIORES: readonly Column[] = [1, 2];

describe('imagenDeSkin: notas', () => {
  it('las columnas exteriores (0 y 3) usan note1', () => {
    for (const columna of EXTERIORES) {
      expect(imagenDeSkin(columna, 'nota')).toBe('note1');
    }
  });

  it('las columnas interiores (1 y 2) usan note2', () => {
    for (const columna of INTERIORES) {
      expect(imagenDeSkin(columna, 'nota')).toBe('note2');
    }
  });
});

describe('imagenDeSkin: cuerpo de LN', () => {
  it('exteriores usan note1H', () => {
    for (const columna of EXTERIORES) {
      expect(imagenDeSkin(columna, 'cuerpoLn')).toBe('note1H');
    }
  });

  it('interiores usan note2H', () => {
    for (const columna of INTERIORES) {
      expect(imagenDeSkin(columna, 'cuerpoLn')).toBe('note2H');
    }
  });
});

describe('imagenDeSkin: cola de LN', () => {
  it('exteriores usan note1L', () => {
    for (const columna of EXTERIORES) {
      expect(imagenDeSkin(columna, 'colaLn')).toBe('note1L');
    }
  });

  it('interiores usan note2L', () => {
    for (const columna of INTERIORES) {
      expect(imagenDeSkin(columna, 'colaLn')).toBe('note2L');
    }
  });
});

describe('imagenDeSkin: receptores', () => {
  it('exteriores usan key1 sin pulsar y key1D pulsado', () => {
    for (const columna of EXTERIORES) {
      expect(imagenDeSkin(columna, 'receptor')).toBe('key1');
      expect(imagenDeSkin(columna, 'receptorPulsado')).toBe('key1D');
    }
  });

  it('interiores usan key2 sin pulsar y key2D pulsado', () => {
    for (const columna of INTERIORES) {
      expect(imagenDeSkin(columna, 'receptor')).toBe('key2');
      expect(imagenDeSkin(columna, 'receptorPulsado')).toBe('key2D');
    }
  });
});

describe('imagenDeSkin: la tabla completa, columna por columna', () => {
  // Una implementacion que invierta exterior/interior (por ejemplo, que
  // use el modulo de la columna al reves, o que confunda "columna < 2"
  // -mano izquierda/derecha, ver core/types.ts handOf- con "columna
  // exterior/interior") pasaria los tests de arriba solo si tambien
  // invierte todos los grupos a la vez de forma consistente. Esta tabla
  // fija los 4 valores exactos, uno por columna, para que no quede duda.
  it.each([
    [0, 'note1'],
    [1, 'note2'],
    [2, 'note2'],
    [3, 'note1'],
  ] as const)('columna %i -> %s', (columna, esperado) => {
    expect(imagenDeSkin(columna, 'nota')).toBe(esperado);
  });

  it('columna 0 y columna 1 dan imagenes distintas (exterior != interior)', () => {
    expect(imagenDeSkin(0, 'nota')).not.toBe(imagenDeSkin(1, 'nota'));
  });

  it('columna 0 y columna 3 dan la misma imagen (las dos exteriores)', () => {
    expect(imagenDeSkin(0, 'nota')).toBe(imagenDeSkin(3, 'nota'));
  });

  it('columna 1 y columna 2 dan la misma imagen (las dos interiores)', () => {
    expect(imagenDeSkin(1, 'nota')).toBe(imagenDeSkin(2, 'nota'));
  });
});
