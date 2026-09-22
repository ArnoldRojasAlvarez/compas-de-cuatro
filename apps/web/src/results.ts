// T-004: pantalla de resultados. DOM plano, sin Pixi (ver T-004, "Pantalla
// de resultados"): esto se dibuja una sola vez, cuando el juego ya termino,
// no hace falta el rendimiento de un renderer de juego para esto.

import type { Judgement, Ms, ScoreState } from '@tetra/core';
import { JUDGEMENTS } from '@tetra/core';

export interface Desviacion {
  /** Tiempo de la nota en la pista (no el momento de la pulsacion). */
  time: Ms;
  /** Desviacion respecto al momento correcto: positivo tarde, negativo temprano. */
  error: Ms;
}

const NOMBRE_JUICIO: Record<Judgement, string> = {
  max: 'Max',
  perfect: 'Perfect',
  great: 'Great',
  good: 'Good',
  bad: 'Bad',
  miss: 'Miss',
};

const ANCHO_GRAFICO = 640;
const ALTO_GRAFICO = 220;

/**
 * Dibuja el grafico de desviacion en un canvas 2D plano: cada golpe es un
 * punto, X es el tiempo de la nota en la pista, Y es el error en ms
 * (arriba temprano, abajo tarde, ver T-004 "Prueba de feel"). Sirve para
 * que Arnold vea de un vistazo si el offset esta centrado en cero o si hay
 * un sesgo constante.
 */
function dibujarGraficoDesviacion(canvas: HTMLCanvasElement, desviaciones: readonly Desviacion[]): void {
  const contexto = canvas.getContext('2d');
  if (!contexto) return;

  canvas.width = ANCHO_GRAFICO;
  canvas.height = ALTO_GRAFICO;

  contexto.fillStyle = '#14141c';
  contexto.fillRect(0, 0, ANCHO_GRAFICO, ALTO_GRAFICO);

  if (desviaciones.length === 0) {
    contexto.fillStyle = '#888';
    contexto.font = '14px sans-serif';
    contexto.fillText('Sin golpes registrados', 12, ALTO_GRAFICO / 2);
    return;
  }

  const erroresAbsolutos = desviaciones.map((d) => Math.abs(d.error));
  // Cota simetrica alrededor de 0: si todos los errores fueran diminutos,
  // igual se deja un margen minimo para que el grafico no quede en blanco.
  const cotaError = Math.max(20, ...erroresAbsolutos) * 1.1;

  const tiempoMinimo = Math.min(...desviaciones.map((d) => d.time));
  const tiempoMaximo = Math.max(...desviaciones.map((d) => d.time));
  const rangoTiempo = Math.max(1, tiempoMaximo - tiempoMinimo);

  const yDeError = (error: number): number => ALTO_GRAFICO / 2 - (error / cotaError) * (ALTO_GRAFICO / 2 - 10);
  const xDeTiempo = (time: number): number =>
    10 + ((time - tiempoMinimo) / rangoTiempo) * (ANCHO_GRAFICO - 20);

  // Linea de cero: el offset esta bien calibrado si los puntos se
  // reparten parejo arriba y abajo de esta linea, no desplazados en bloque.
  contexto.strokeStyle = '#444';
  contexto.beginPath();
  contexto.moveTo(0, yDeError(0));
  contexto.lineTo(ANCHO_GRAFICO, yDeError(0));
  contexto.stroke();

  contexto.fillStyle = '#6ee7b7';
  for (const desviacion of desviaciones) {
    const x = xDeTiempo(desviacion.time);
    const y = yDeError(Math.max(-cotaError, Math.min(cotaError, desviacion.error)));
    contexto.beginPath();
    contexto.arc(x, y, 2.5, 0, Math.PI * 2);
    contexto.fill();
  }
}

function crearFilaConteo(juicio: Judgement, cantidad: number): HTMLElement {
  const fila = document.createElement('div');
  fila.className = 'tetra-resultados-fila';
  fila.textContent = `${NOMBRE_JUICIO[juicio]}: ${cantidad}`;
  return fila;
}

/**
 * Renderiza la pantalla de resultados dentro de `contenedor`, reemplazando
 * lo que hubiera. DOM plano: nada de Pixi ni de React (ver CLAUDE.md,
 * regla 4, y T-004, "Pantalla de resultados").
 */
export function mostrarResultados(
  contenedor: HTMLElement,
  estado: ScoreState,
  desviaciones: readonly Desviacion[],
): void {
  contenedor.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'tetra-resultados';

  const titulo = document.createElement('h1');
  titulo.textContent = 'Resultados';
  panel.appendChild(titulo);

  const resumen = document.createElement('div');
  resumen.className = 'tetra-resultados-resumen';
  resumen.innerHTML = `
    <div>Score: ${estado.score}</div>
    <div>Precision: ${(estado.accuracy * 100).toFixed(2)}%</div>
    <div>Combo maximo: ${estado.maxCombo}</div>
  `;
  panel.appendChild(resumen);

  const conteos = document.createElement('div');
  conteos.className = 'tetra-resultados-conteos';
  for (const juicio of JUDGEMENTS) {
    conteos.appendChild(crearFilaConteo(juicio, estado.counts[juicio]));
  }
  panel.appendChild(conteos);

  const subtituloGrafico = document.createElement('h2');
  subtituloGrafico.textContent = 'Desviacion de cada golpe en el tiempo';
  panel.appendChild(subtituloGrafico);

  const canvas = document.createElement('canvas');
  canvas.className = 'tetra-resultados-grafico';
  panel.appendChild(canvas);
  dibujarGraficoDesviacion(canvas, desviaciones);

  contenedor.appendChild(panel);
}
