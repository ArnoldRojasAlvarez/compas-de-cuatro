// Tests de T-050 para lo puro de las skins propias (skins-propias.ts): el
// catalogo, los colores, las medidas y la geometria. El dibujo con Canvas no
// se prueba en vitest (node, sin canvas): misma razon que playfield.ts.

import { describe, expect, it } from 'vitest';
import {
  COLORES_SKIN_PROPIA,
  DIAMETRO_CIRCULO_FACTOR,
  MEDIDAS_SKIN_PROPIA,
  SKINS_PROPIAS,
  SKIN_PROPIA_POR_DEFECTO,
  colorCss,
  diametroCirculo,
  infoDeSkinPropia,
  mezclarColor,
  puntosRombo,
  tamanoLienzo,
  type IdSkinPropia,
} from './skins-propias.js';

const IDS: readonly IdSkinPropia[] = ['tetra', 'barras', 'circulos', 'diamantes'];

/** Paleta de docs/DISENO.md: ninguna skin puede usar un color de afuera (ni rosa). */
const PALETA = new Set([
  0xe7eef0, // tinta
  0xf1f5f6, // blanco frio de Barras
  0x3fd8c2, // acento (teal)
  0xe8b84a, // ambar
  0x5fc46a, // verde
  0x4f93d8, // azul
  0x9a78d8, // violeta
  0xd8544e, // rojo (miss)
]);

describe('SKINS_PROPIAS', () => {
  it('tiene exactamente las cuatro skins, con ids unicos', () => {
    expect(SKINS_PROPIAS).toHaveLength(4);
    expect(SKINS_PROPIAS.map((s) => s.id).sort()).toEqual([...IDS].sort());
    expect(new Set(SKINS_PROPIAS.map((s) => s.id)).size).toBe(4);
  });

  it('el default esta en la lista y es tetra', () => {
    expect(SKIN_PROPIA_POR_DEFECTO).toBe('tetra');
    expect(SKINS_PROPIAS.some((s) => s.id === SKIN_PROPIA_POR_DEFECTO)).toBe(true);
  });

  it('cada skin tiene un nombre corto, no vacio y distinto de los demas', () => {
    for (const skin of SKINS_PROPIAS) {
      expect(skin.nombre.length).toBeGreaterThan(0);
      expect(skin.nombre.length).toBeLessThanOrEqual(12);
    }
    expect(new Set(SKINS_PROPIAS.map((s) => s.nombre)).size).toBe(4);
  });
});

describe('COLORES_SKIN_PROPIA', () => {
  it('Tetra: exteriores tinta e interiores teal (la convencion 4K, sin invertir)', () => {
    expect(COLORES_SKIN_PROPIA.tetra.exterior).toBe(0xe7eef0);
    expect(COLORES_SKIN_PROPIA.tetra.interior).toBe(0x3fd8c2);
  });

  it('Barras: exteriores blancos e interiores ambar', () => {
    expect(COLORES_SKIN_PROPIA.barras.interior).toBe(0xe8b84a);
    // "blanco": canales altos y casi iguales.
    const c = COLORES_SKIN_PROPIA.barras.exterior;
    expect(Math.min((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff)).toBeGreaterThan(0xe0);
  });

  it('Circulos: exteriores teal e interiores ambar', () => {
    expect(COLORES_SKIN_PROPIA.circulos.exterior).toBe(0x3fd8c2);
    expect(COLORES_SKIN_PROPIA.circulos.interior).toBe(0xe8b84a);
  });

  it('Diamantes: exteriores azul #4F93D8 e interiores violeta #9A78D8', () => {
    expect(COLORES_SKIN_PROPIA.diamantes.exterior).toBe(0x4f93d8);
    expect(COLORES_SKIN_PROPIA.diamantes.interior).toBe(0x9a78d8);
  });

  it('exterior e interior son distintos en cada skin', () => {
    for (const id of IDS) {
      expect(COLORES_SKIN_PROPIA[id].exterior).not.toBe(COLORES_SKIN_PROPIA[id].interior);
    }
  });

  it('todos los colores salen de la paleta (nada de rosa)', () => {
    for (const id of IDS) {
      expect(PALETA.has(COLORES_SKIN_PROPIA[id].exterior)).toBe(true);
      expect(PALETA.has(COLORES_SKIN_PROPIA[id].interior)).toBe(true);
    }
  });

  it('las cuatro skins se distinguen entre si por su par de colores', () => {
    const pares = IDS.map(
      (id) => `${COLORES_SKIN_PROPIA[id].exterior}/${COLORES_SKIN_PROPIA[id].interior}`,
    );
    expect(new Set(pares).size).toBe(4);
  });
});

describe('mezclarColor', () => {
  it('t = 0 da el primero y t = 1 el segundo', () => {
    expect(mezclarColor(0x102030, 0xf0e0d0, 0)).toBe(0x102030);
    expect(mezclarColor(0x102030, 0xf0e0d0, 1)).toBe(0xf0e0d0);
  });

  it('a la mitad mezcla canal por canal, sin que un canal se pise con otro', () => {
    expect(mezclarColor(0x000000, 0xff8040, 0.5)).toBe((0x80 << 16) | (0x40 << 8) | 0x20);
    expect(mezclarColor(0xff0000, 0x0000ff, 0.5)).toBe(0x800080);
  });

  it('recorta t fuera de [0, 1]', () => {
    expect(mezclarColor(0x112233, 0xffffff, -3)).toBe(0x112233);
    expect(mezclarColor(0x112233, 0xffffff, 9)).toBe(0xffffff);
  });
});

describe('colorCss', () => {
  it('descompone los canales y pone el alpha', () => {
    expect(colorCss(0x3fd8c2)).toBe('rgba(63, 216, 194, 1)');
    expect(colorCss(0xe8b84a, 0.5)).toBe('rgba(232, 184, 74, 0.5)');
  });
});

describe('geometria', () => {
  it('diametroCirculo es el 70 % del ancho del carril', () => {
    expect(DIAMETRO_CIRCULO_FACTOR).toBe(0.7);
    expect(diametroCirculo(100)).toBeCloseTo(70, 10);
    expect(diametroCirculo(64)).toBeCloseTo(44.8, 10);
    expect(diametroCirculo(0)).toBe(0);
  });

  it('puntosRombo da cuatro vertices: arriba, derecha, abajo, izquierda', () => {
    expect(puntosRombo(10, 20, 8, 12)).toEqual([10, 14, 14, 20, 10, 26, 6, 20]);
  });

  it('puntosRombo es simetrico respecto del centro, con las diagonales pedidas', () => {
    const p = puntosRombo(50, 30, 40, 20);
    expect(p).toHaveLength(8);
    // Ancho y alto son las diagonales completas.
    expect(p[2]! - p[6]!).toBe(40);
    expect(p[5]! - p[1]!).toBe(20);
    // Cada vertice tiene su opuesto espejado por el centro.
    expect(p[0]! + p[4]!).toBe(100);
    expect(p[1]! + p[5]!).toBe(60);
    expect(p[2]! + p[6]!).toBe(100);
    expect(p[3]! + p[7]!).toBe(60);
  });

  it('tamanoLienzo redondea hacia arriba y nunca baja de 1', () => {
    expect(tamanoLienzo(0.82, 64)).toBe(53);
    expect(tamanoLienzo(0.5, 64)).toBe(32);
    expect(tamanoLienzo(0, 64)).toBe(1);
    expect(tamanoLienzo(0.3, 0)).toBe(1);
  });
});

describe('MEDIDAS_SKIN_PROPIA', () => {
  it('toda pieza entra en el carril (fraccion entre 0 y 1)', () => {
    for (const id of IDS) {
      for (const valor of Object.values(MEDIDAS_SKIN_PROPIA[id])) {
        expect(valor).toBeGreaterThan(0);
        expect(valor).toBeLessThanOrEqual(1);
      }
    }
  });

  it('el cuerpo de la LN es mas angosto que la nota (se lee la cabeza)', () => {
    for (const id of IDS) {
      expect(MEDIDAS_SKIN_PROPIA[id].anchoCuerpo).toBeLessThan(MEDIDAS_SKIN_PROPIA[id].anchoNota);
    }
  });

  it('Circulos: nota y receptor cuadrados (si no, el circulo se achata)', () => {
    expect(MEDIDAS_SKIN_PROPIA.circulos.anchoNota).toBe(MEDIDAS_SKIN_PROPIA.circulos.altoNota);
    expect(MEDIDAS_SKIN_PROPIA.circulos.anchoReceptor).toBe(
      MEDIDAS_SKIN_PROPIA.circulos.altoReceptor,
    );
    // Y el lienzo de la nota alberga el circulo del 70 %.
    expect(MEDIDAS_SKIN_PROPIA.circulos.anchoNota).toBeGreaterThan(DIAMETRO_CIRCULO_FACTOR);
  });

  it('Barras ocupa casi todo el carril; Tetra deja margen', () => {
    expect(MEDIDAS_SKIN_PROPIA.barras.anchoNota).toBeGreaterThanOrEqual(0.95);
    expect(MEDIDAS_SKIN_PROPIA.tetra.anchoNota).toBeLessThan(0.9);
  });

  it('Diamantes es mas ancho que alto (rombo, no cuadrado girado)', () => {
    expect(MEDIDAS_SKIN_PROPIA.diamantes.anchoNota).toBeGreaterThan(
      MEDIDAS_SKIN_PROPIA.diamantes.altoNota,
    );
  });
});

describe('infoDeSkinPropia', () => {
  it('para undefined o unas texturas que no son de una skin propia (un .osk) devuelve undefined', () => {
    expect(infoDeSkinPropia(undefined)).toBeUndefined();
    expect(infoDeSkinPropia({})).toBeUndefined();
  });
});
