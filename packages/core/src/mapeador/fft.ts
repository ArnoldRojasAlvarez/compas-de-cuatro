// FFT radix-2 iterativa en sitio. Pura: solo arreglos tipados. La usa el
// detector de onsets (onsets.ts) para el flujo espectral.

/** Menor potencia de dos mayor o igual a `n`. */
export function potenciaDeDosMinima(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export interface PlanFft {
  readonly n: number;
  readonly cos: Float64Array;
  readonly sin: Float64Array;
  readonly inversion: Uint32Array;
}

/** Precalcula twiddles y la permutacion de bits para un tamano `n` (potencia de dos). */
export function crearPlanFft(n: number): PlanFft {
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`El tamaño de la FFT debe ser una potencia de dos, llegó ${n}.`);
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.log2(n);
  const inversion = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    inversion[i] = r;
  }
  return { n, cos, sin, inversion };
}

/** Transformada directa en sitio sobre (re, im), ambos de largo `plan.n`. */
export function fft(plan: PlanFft, re: Float64Array, im: Float64Array): void {
  const { n, cos, sin, inversion } = plan;
  for (let i = 0; i < n; i++) {
    const j = inversion[i]!;
    if (j > i) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let tam = 2; tam <= n; tam *= 2) {
    const mitad = tam / 2;
    const paso = n / tam;
    for (let inicio = 0; inicio < n; inicio += tam) {
      for (let k = 0; k < mitad; k++) {
        const c = cos[k * paso]!;
        const s = sin[k * paso]!;
        const a = inicio + k;
        const b = a + mitad;
        const tr = re[b]! * c - im[b]! * s;
        const ti = re[b]! * s + im[b]! * c;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}
