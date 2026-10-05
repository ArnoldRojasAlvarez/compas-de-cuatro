// Tests de T-052 para la logica pura de la musica del menu.

import { describe, expect, it } from 'vitest';
import {
  EVENTO_BIBLIOTECA_CAMBIO,
  elegirSiguienteId,
  inicioDePreviewSegundos,
  textoDeLoQueSuena,
} from './musica-menu-logica.js';

describe('elegirSiguienteId', () => {
  const ids = ['a', 'b', 'c'];

  it('nunca repite la cancion actual si hay otras, con cualquier sorteo', () => {
    // Una implementacion que sorteara entre todas (sin excluir la actual)
    // repetiria 'b' para algun valor de `aleatorio`.
    for (let i = 0; i <= 20; i++) {
      expect(elegirSiguienteId(ids, 'b', () => i / 20)).not.toBe('b');
    }
  });

  it('alcanza a todas las demas (no se queda siempre en la primera)', () => {
    const vistos = new Set<string | null>();
    for (let i = 0; i < 6; i++) vistos.add(elegirSiguienteId(ids, 'a', () => i / 6));
    expect([...vistos].sort()).toEqual(['b', 'c']);
  });

  it('con una sola cancion, repite esa (no hay alternativa)', () => {
    expect(elegirSiguienteId(['solo'], 'solo')).toBe('solo');
  });

  it('sin canciones da null (el menu cae al click track)', () => {
    expect(elegirSiguienteId([], null)).toBeNull();
    expect(elegirSiguienteId([], 'a')).toBeNull();
  });

  it('sin actual (click track sonando) puede elegir cualquiera, y aleatorio 0 da la primera', () => {
    expect(elegirSiguienteId(ids, null, () => 0)).toBe('a');
    expect(elegirSiguienteId(ids, null, () => 0.99)).toBe('c');
  });

  it('una actual que ya no esta en la lista (borrada) no excluye nada', () => {
    expect(elegirSiguienteId(ids, 'borrada', () => 0)).toBe('a');
  });

  it('aleatorio() = 1 exacto no se va de rango', () => {
    expect(elegirSiguienteId(ids, 'a', () => 1)).toBe('c');
  });
});

describe('inicioDePreviewSegundos', () => {
  it('convierte el previewTime de ms a segundos', () => {
    expect(inicioDePreviewSegundos(45_000, 180)).toBe(45);
  });

  it('un previewTime -1 (sin preview) o negativo arranca de 0', () => {
    expect(inicioDePreviewSegundos(-1, 180)).toBe(0);
    expect(inicioDePreviewSegundos(-5000, 180)).toBe(0);
  });

  it('un previewTime casi al final del audio arranca de 0 (no sonaria nada)', () => {
    // Una implementacion que solo recortara a la duracion arrancaria a 178 s de 180.
    expect(inicioDePreviewSegundos(178_000, 180)).toBe(0);
    expect(inicioDePreviewSegundos(120_000, 180)).toBe(120);
  });

  it('valores no numericos arrancan de 0', () => {
    expect(inicioDePreviewSegundos(Number.NaN, 180)).toBe(0);
    expect(inicioDePreviewSegundos(1000, Number.NaN)).toBe(0);
  });
});

describe('textoDeLoQueSuena', () => {
  it('une titulo y artista con un punto medio', () => {
    expect(textoDeLoQueSuena('Primer Compas', 'Tetra')).toBe('Primer Compas · Tetra');
  });

  it('sin artista queda solo el titulo, sin separador colgado', () => {
    expect(textoDeLoQueSuena('Primer Compas', '  ')).toBe('Primer Compas');
  });
});

describe('EVENTO_BIBLIOTECA_CAMBIO', () => {
  it('es el nombre que dispara la cancion demo (T-051)', () => {
    expect(EVENTO_BIBLIOTECA_CAMBIO).toBe('tetra:biblioteca-cambio');
  });
});
