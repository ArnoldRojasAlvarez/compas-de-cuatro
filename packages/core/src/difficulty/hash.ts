// T-014: hash de contenido de un mapa, para la clave de cache de estrellas
// (ver apps/web/src/dificultad-logica.ts y el ticket, "Parte B").
//
// Funcion pura, sin navegador (misma regla que el resto de core, ver
// CLAUDE.md): FNV-1a de 32 bits sobre lo unico de lo que depende
// `calcularDificultad` (ver difficulty/index.ts, `construirFilas`):
// el tiempo y la columna de cada nota, en el orden en que vienen en
// `chart.notes`, mas el Overall Difficulty (que define las ventanas de
// juicio, no la dificultad de patron, pero es parte del mapa y en teoria
// podria entrar a un modelo futuro). A proposito NO entra `endTime` de las
// holds ni `chart.metadata`: dos mapas que solo difieren en eso dan el
// mismo resultado en `calcularDificultad`, asi que tienen que compartir
// cache (ver el JSDoc de `construirFilas`: "la cabeza de una nota larga
// cuenta como nota de su fila, igual que una nota simple").

import type { Chart } from '../types.js';

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Un paso de FNV-1a sobre un texto, encadenable (recibe el hash acumulado
 * de lo anterior). `Math.imul` para que la multiplicacion se quede en
 * aritmetica de 32 bits sin pasar por floats de doble precision, que
 * perderian los bits altos.
 */
function fnv1aTexto(texto: string, hashAcumulado: number): number {
  let hash = hashAcumulado >>> 0;
  for (let i = 0; i < texto.length; i++) {
    hash ^= texto.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

/**
 * Hash de 32 bits (sin signo) del contenido de un mapa relevante para la
 * dificultad. Determinista: dos `Chart` con las mismas notas (tiempo y
 * columna, en el mismo orden) y el mismo OD dan siempre el mismo numero.
 * Un separador ('|') entre campos evita que, por ejemplo, la nota en
 * tiempo 1 columna 23 se confunda por texto con la nota en tiempo 12
 * columna 3 (sin separador, ambas concatenarian a "123").
 */
export function hashMapa(chart: Chart): number {
  let hash = FNV_OFFSET_BASIS;
  for (const nota of chart.notes) {
    hash = fnv1aTexto(`${nota.time}|${nota.column}|`, hash);
  }
  hash = fnv1aTexto(`OD${chart.overallDifficulty}`, hash);
  return hash >>> 0;
}
