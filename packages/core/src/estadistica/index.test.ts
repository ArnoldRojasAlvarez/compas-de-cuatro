import { describe, expect, it } from 'vitest';
import { ajustarLeyDePotencia, rangos, spearman } from './index.js';

describe('rangos', () => {
  it('los empates reciben el rango promedio', () => {
    // Ordenados: 10 (pos 1), 20 y 20 (pos 2 y 3, promedio 2.5), 30 (pos 4).
    expect(rangos([20, 10, 30, 20])).toEqual([2.5, 1, 4, 2.5]);
  });
});

describe('spearman', () => {
  it('sin empates: orden identico da 1 aunque la relacion no sea lineal', () => {
    // Rangos de x: 1 2 3 4 5. Rangos de y: 1 2 3 4 5 (100 sigue siendo el
    // mayor). Spearman = 1 exacto. Pearson sobre los valores crudos daria
    // ~0.73 (el 100 arrastra la recta), asi que este caso falla si alguien
    // usa Pearson en vez de Spearman.
    expect(spearman([1, 2, 3, 4, 5], [1, 2, 3, 4, 100])).toBeCloseTo(1, 12);
  });

  it('con empates: rango promedio, calculado a mano', () => {
    // x = [1, 2, 2, 4]  -> rangos [1, 2.5, 2.5, 4]
    // y = [1, 3, 2, 4]  -> rangos [1, 3, 2, 4]
    // Ambas medias de rangos = 2.5.
    // dx = [-1.5, 0, 0, 1.5]; dy = [-1.5, 0.5, -0.5, 1.5]
    // suma dx*dy = 2.25 + 0 + 0 + 2.25 = 4.5
    // suma dx^2 = 4.5; suma dy^2 = 2.25 + 0.25 + 0.25 + 2.25 = 5
    // rho = 4.5 / sqrt(4.5 * 5) = 4.5 / sqrt(22.5) = 0.948683...
    // Distinguibles: Pearson crudo da 4.5/sqrt(4.75*5) = 0.9234, y la
    // formula corta sin correccion de empates (1 - 6*0.5/60) da 0.95.
    const rho = spearman([1, 2, 2, 4], [1, 3, 2, 4]);
    expect(rho).toBeCloseTo(4.5 / Math.sqrt(22.5), 12);
    expect(Math.abs((rho as number) - 0.9234)).toBeGreaterThan(0.02);
    expect(Math.abs((rho as number) - 0.95)).toBeGreaterThan(0.001);
  });

  it('orden invertido da -1', () => {
    expect(spearman([1, 2, 3], [9, 5, 1])).toBeCloseTo(-1, 12);
  });

  it('devuelve null si una serie es constante, si hay menos de 2 pares o si los largos difieren', () => {
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(spearman([1], [2])).toBeNull();
    expect(spearman([1, 2], [1])).toBeNull();
  });
});

describe('ajustarLeyDePotencia', () => {
  it('recupera a y p conocidos a partir de datos generados', () => {
    const a = 1.7;
    const p = 0.62;
    const x = [0.5, 1, 2, 3.5, 6, 9, 14, 20];
    const y = x.map((v) => a * Math.pow(v, p));
    const ajuste = ajustarLeyDePotencia(x, y);
    expect(ajuste).not.toBeNull();
    expect(ajuste!.a).toBeCloseTo(a, 9);
    expect(ajuste!.p).toBeCloseTo(p, 9);
    expect(ajuste!.usados).toBe(x.length);
    expect(ajuste!.descartados).toBe(0);
    expect(ajuste!.r2).toBeCloseTo(1, 9);
  });

  it('con datos sublineales devuelve p < 1: un factor solo no alcanza', () => {
    const x = [1, 4, 9, 16];
    const y = x.map((v) => Math.sqrt(v)); // a = 1, p = 0.5
    expect(ajustarLeyDePotencia(x, y)!.p).toBeCloseTo(0.5, 9);
  });

  it('ignora los pares con valores no positivos o no finitos y los cuenta', () => {
    const a = 2;
    const p = 0.8;
    const x = [1, 2, 4, 0, -3, 8, 5, Number.NaN];
    const y = x.map((v) => a * Math.pow(v, p));
    y[6] = 0; // y no positivo con x valido
    const ajuste = ajustarLeyDePotencia(x, y);
    expect(ajuste!.usados).toBe(4);
    expect(ajuste!.descartados).toBe(4);
    expect(ajuste!.a).toBeCloseTo(a, 9);
    expect(ajuste!.p).toBeCloseTo(p, 9);
  });

  it('devuelve null si quedan menos de 2 pares validos o todos los x son iguales', () => {
    expect(ajustarLeyDePotencia([1, 0], [1, 1])).toBeNull();
    expect(ajustarLeyDePotencia([3, 3, 3], [1, 2, 3])).toBeNull();
    expect(ajustarLeyDePotencia([], [])).toBeNull();
    expect(ajustarLeyDePotencia([1, 2], [1])).toBeNull();
  });
});
