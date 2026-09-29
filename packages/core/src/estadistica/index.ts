// T-015: estadistica pura para la herramienta de calibracion. Vive aparte de
// `difficulty/` a proposito: no es parte del modelo, es la regla con la que se
// lo mide contra osu!. Sin dependencias ni DOM (ver CLAUDE.md, regla 2).

/**
 * Rangos de `valores` (1 = el menor). Los empates reciben el rango promedio
 * de las posiciones que ocupan: [10, 20, 20, 30] da [1, 2.5, 2.5, 4].
 */
export function rangos(valores: readonly number[]): number[] {
  const orden = valores
    .map((valor, indice) => ({ valor, indice }))
    .sort((a, b) => a.valor - b.valor);
  const resultado = new Array<number>(valores.length);
  let i = 0;
  while (i < orden.length) {
    let j = i;
    while (j + 1 < orden.length && orden[j + 1]!.valor === orden[i]!.valor) j += 1;
    // Posiciones i..j (base 0) son un empate: rango promedio en base 1.
    const promedio = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) resultado[orden[k]!.indice] = promedio;
    i = j + 1;
  }
  return resultado;
}

/** Correlacion de Pearson, o null si hay menos de 2 puntos o alguna serie es constante (varianza 0). */
function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i += 1) {
    mx += x[i]!;
    my += y[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Correlacion de Spearman: Pearson sobre los rangos, con rango promedio en los
 * empates (por eso NO se usa la formula corta 1 - 6*suma(d^2)/(n(n^2-1)), que
 * solo vale sin empates). Mide si el orden coincide, no la escala.
 *
 * Devuelve null (no NaN) si `x` e `y` tienen distinto largo, hay menos de 2
 * pares, o una de las series es constante (todos empatados: no hay orden que
 * correlacionar).
 */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length) return null;
  return pearson(rangos(x), rangos(y));
}

export interface AjusteLogLog {
  /** Coeficiente de `estrella = a * valor^p`. */
  a: number;
  /** Exponente. Menor a 1 significa que la dificultad percibida crece mas lento que el valor de Tetra. */
  p: number;
  /** Cuantos pares entraron al ajuste. */
  usados: number;
  /** Cuantos pares se descartaron por tener algun valor no positivo o no finito. */
  descartados: number;
  /** R cuadrado del ajuste lineal en escala log-log. */
  r2: number;
}

/**
 * Ajusta `y = a * x^p` por minimos cuadrados sobre (ln x, ln y): regresion
 * lineal ln y = ln a + p ln x.
 *
 * Valores no positivos: el logaritmo no esta definido para x <= 0 ni y <= 0
 * (ni para NaN o infinitos), asi que esos pares se IGNORAN y se cuentan en
 * `descartados`; no se rechaza todo el ajuste por uno solo (un mapa sin nota
 * de osu! todavia es el caso normal). Devuelve null si tras descartar quedan
 * menos de 2 pares o todos los `x` valen lo mismo (la pendiente no se puede
 * determinar). Tambien null si los largos difieren.
 */
export function ajustarLeyDePotencia(
  x: readonly number[],
  y: readonly number[],
): AjusteLogLog | null {
  if (x.length !== y.length) return null;
  const lx: number[] = [];
  const ly: number[] = [];
  for (let i = 0; i < x.length; i += 1) {
    const xi = x[i]!;
    const yi = y[i]!;
    if (Number.isFinite(xi) && Number.isFinite(yi) && xi > 0 && yi > 0) {
      lx.push(Math.log(xi));
      ly.push(Math.log(yi));
    }
  }
  const descartados = x.length - lx.length;
  const n = lx.length;
  if (n < 2) return null;
  const mx = lx.reduce((s, v) => s + v, 0) / n;
  const my = ly.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = lx[i]! - mx;
    const dy = ly[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const p = sxy / sxx;
  const a = Math.exp(my - p * mx);
  // Si todos los y son iguales, el ajuste es exacto (p = 0) y r2 vale 1.
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { a, p, usados: n, descartados, r2 };
}
