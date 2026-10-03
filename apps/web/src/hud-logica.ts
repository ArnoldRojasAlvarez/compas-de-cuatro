// T-019: logica pura del HUD de la partida. Nada de DOM ni de reloj aca:
// todas las funciones reciben numeros y devuelven numeros o strings, asi se
// prueban sin navegador (ver hud-logica.test.ts). Quien las llama (game.ts)
// es el que lee el reloj de audio y toca el DOM.

/** Duracion del pulso del combo, en ms de reloj de juego. */
export const DURACION_PULSO_MS = 120;

/** Cuanto crece el combo en el primer instante del pulso (0.12 = 12 %). */
export const AMPLITUD_PULSO = 0.12;

/**
 * Escala del combo en un pulso: 1 en reposo; sube a `1 + AMPLITUD_PULSO`
 * justo al subir el combo y vuelve a 1 linealmente en `DURACION_PULSO_MS`.
 *
 * `msDesdeSubida` se mide con el reloj de juego (`t - tUltimaSubida`, los dos
 * de `clock.now()`), nunca con `performance.now()` ni con el delta de rAF.
 * Un valor negativo (el combo "subio en el futuro", p. ej. por un offset de
 * calibracion que mueve el reloj hacia atras) se trata como reposo, no como
 * un pulso mas grande de lo debido.
 */
export function escalaPulsoCombo(msDesdeSubida: number): number {
  if (!(msDesdeSubida >= 0) || msDesdeSubida >= DURACION_PULSO_MS) return 1;
  return 1 + AMPLITUD_PULSO * (1 - msDesdeSubida / DURACION_PULSO_MS);
}

/**
 * Fraccion 0 a 1 de cancion transcurrida. `t` negativo (lead-in) da 0, `t`
 * mayor que la duracion da 1, y una duracion no positiva (o no finita) da 0
 * en vez de dividir por cero.
 */
export function fraccionProgreso(t: number, duracion: number): number {
  if (!(duracion > 0) || !Number.isFinite(duracion)) return 0;
  if (!(t > 0)) return 0;
  if (t >= duracion) return 1;
  return t / duracion;
}

/**
 * Precision como porcentaje con dos decimales: 0.9853 da "98.53%".
 *
 * Se redondea con aritmetica entera sobre centesimas de porcentaje (mitad
 * hacia arriba), no con `toFixed`: `(0.98535 * 100).toFixed(2)` da "98.53"
 * porque 0.98535 no es representable en binario y queda apenas por debajo,
 * mientras que a quien mira el HUD le corresponde "98.54%". El epsilon de
 * 1e-7 absorbe ese error de representacion (es muy inferior a una
 * centesima de punto porcentual). `accuracy` fuera de 0..1 o no numerico se
 * recorta al rango.
 */
export function formatearPrecision(accuracy: number): string {
  const a = Number.isFinite(accuracy) ? Math.min(1, Math.max(0, accuracy)) : 0;
  const centesimas = Math.round(a * 10000 + 1e-7);
  const entero = Math.floor(centesimas / 100);
  const decimales = centesimas % 100;
  return `${entero}.${decimales < 10 ? '0' : ''}${decimales}%`;
}

/**
 * Separador de miles del score: espacio fino sin salto (U+202F). Es el que
 * recomienda el SI y el uso habitual en espanol de Latinoamerica (el punto
 * se confunde con el decimal en otros paises), ocupa poco en una fuente
 * monoespaciada y no se parte en dos lineas. Va fijo y no sale de
 * `toLocaleString`, para que el HUD se vea igual en cualquier navegador.
 */
export const SEPARADOR_MILES = ' ';

/**
 * Score entero con separador de miles: 1234567 da "1 234 567" (con
 * `SEPARADOR_MILES` entre grupos). Redondea a entero; negativos y valores no
 * finitos dan "0" (el score del motor nunca es negativo).
 */
export function formatearScore(score: number): string {
  const n = Number.isFinite(score) ? Math.max(0, Math.round(score)) : 0;
  const digitos = String(n);
  const resto = digitos.length % 3;
  let salida = digitos.slice(0, resto);
  for (let i = resto; i < digitos.length; i += 3) {
    if (salida.length > 0) salida += SEPARADOR_MILES;
    salida += digitos.slice(i, i + 3);
  }
  return salida;
}

export type NivelDeVida = 'ok' | 'baja' | 'critica';

/**
 * Nivel de alerta de la vida: 'ok' desde 0.5 inclusive, 'baja' desde 0.2
 * inclusive, 'critica' por debajo (y para valores no numericos).
 */
export function nivelDeVida(hp: number): NivelDeVida {
  if (hp >= 0.5) return 'ok';
  if (hp >= 0.2) return 'baja';
  return 'critica';
}
