// T-004: pantalla de resultados. DOM plano, sin Pixi (ver T-004, "Pantalla
// de resultados"): esto se dibuja una sola vez, cuando el juego ya termino,
// no hace falta el rendimiento de un renderer de juego para esto.

import type { Judgement, Ms, ScoreState } from '@tetra/core';
import { JUDGEMENTS } from '@tetra/core';
import {
  calcularOffsetCorregido,
  contarTempranoTarde,
  desviacionEstandar,
  erroresJuzgados,
  etiquetaDeSigno,
  media,
} from './estadisticas.js';
import { guardarOffset } from './offset.js';

export interface Desviacion {
  /** Tiempo de la nota en la pista (no el momento de la pulsacion). */
  time: Ms;
  /** Desviacion respecto al momento correcto: positivo tarde, negativo temprano. */
  error: Ms;
  /** Juicio de este golpe. Los miss quedan afuera de media/desviacion estandar (T-007). */
  judgement: Judgement;
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
 * (arriba tarde, abajo temprano: ver `yDeError` mas abajo, que resta el
 * error a la mitad de la altura, asi que un error positivo da una Y mas
 * chica, o sea mas arriba en el canvas). Sirve para que Arnold vea de un
 * vistazo si el offset esta centrado en cero o si hay un sesgo constante.
 *
 * T-007: ademas de la nube de puntos, la linea de cero queda rotulada "0"
 * y arriba/abajo del grafico quedan rotulados los limites con su valor en
 * ms, para no depender solo del ojo (ver el ticket, "Parte A").
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

  // Etiquetas numericas (T-007): la linea de cero, y el limite de cada
  // extremo del grafico con su valor en ms. Sin esto el grafico solo decia
  // "hay un sesgo" pero no cuanto, y Arnold como jugador top de nivel
  // mundial prefiere el numero exacto.
  const limiteRedondeado = Math.round(cotaError);
  contexto.fillStyle = '#888';
  contexto.font = '11px sans-serif';
  contexto.fillText('0', 4, yDeError(0) - 4);
  contexto.fillText(`+${limiteRedondeado} ms tarde`, 4, 12);
  contexto.fillText(`-${limiteRedondeado} ms temprano`, 4, ALTO_GRAFICO - 6);

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

/** "-24 ms (temprano)", "18 ms (tarde)" o "0 ms" si no hay ni una cosa ni la otra. */
function formatearMedia(valor: Ms): string {
  const etiqueta = etiquetaDeSigno(valor);
  const numero = Math.round(valor);
  return etiqueta === null ? `${numero} ms` : `${numero} ms (${etiqueta})`;
}

/**
 * Construye el bloque de estadisticas cuantificadas de T-007 ("Parte A"):
 * media, desviacion estandar y conteo temprano/tarde, calculados solo sobre
 * los golpes que no fueron miss (ver `erroresJuzgados` en estadisticas.ts).
 */
function crearBloqueEstadisticas(desviaciones: readonly Desviacion[]): HTMLElement {
  const errores = erroresJuzgados(desviaciones);
  const mediaError = media(errores);
  const desviacion = desviacionEstandar(errores);
  const conteo = contarTempranoTarde(errores);

  const bloque = document.createElement('div');
  bloque.className = 'tetra-resultados-estadisticas';
  bloque.innerHTML = `
    <div>Media: ${formatearMedia(mediaError)}</div>
    <div>Desviacion estandar: ${Math.round(desviacion)} ms</div>
    <div>Temprano: ${conteo.temprano} / Tarde: ${conteo.tarde}</div>
  `;
  return bloque;
}

/**
 * Boton "corregir offset segun esta partida" (T-007, "Parte B"): aplica
 * `calcularOffsetCorregido` sobre la media de esta partida y guarda el
 * resultado con `guardarOffset`, para que la proxima partida arranque con
 * el offset corregido (ver game.ts, donde se lee al construir el reloj).
 *
 * No se muestra si no hubo golpes juzgados o si la media ya esta en 0:
 * no hay nada que corregir (T-007, criterios de aceptacion).
 */
function crearBotonCorregirOffset(
  desviaciones: readonly Desviacion[],
  offsetActual: Ms,
): HTMLElement | null {
  const errores = erroresJuzgados(desviaciones);
  const mediaError = media(errores);
  if (errores.length === 0 || mediaError === 0) {
    return null;
  }

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'tetra-resultados-corregir';
  boton.textContent = `Corregir offset segun esta partida (media ${formatearMedia(mediaError)})`;

  boton.addEventListener('click', () => {
    const offsetNuevo = Math.round(calcularOffsetCorregido(offsetActual, mediaError));
    guardarOffset(offsetNuevo);
    boton.disabled = true;
    boton.textContent = `Offset actualizado a ${offsetNuevo} ms. Se aplica en la proxima partida.`;
  });

  return boton;
}

/**
 * Renderiza la pantalla de resultados dentro de `contenedor`, reemplazando
 * lo que hubiera. DOM plano: nada de Pixi ni de React (ver CLAUDE.md,
 * regla 4, y T-004, "Pantalla de resultados").
 *
 * `offsetActual` es el `userOffset` con el que se jugo esta partida (ver
 * game.ts): hace falta para que el boton de "corregir offset" de T-007
 * sepa a partir de que valor calcular el offset nuevo.
 */
export function mostrarResultados(
  contenedor: HTMLElement,
  estado: ScoreState,
  desviaciones: readonly Desviacion[],
  offsetActual: Ms,
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

  panel.appendChild(crearBloqueEstadisticas(desviaciones));

  const subtituloGrafico = document.createElement('h2');
  subtituloGrafico.textContent = 'Desviacion de cada golpe en el tiempo';
  panel.appendChild(subtituloGrafico);

  const canvas = document.createElement('canvas');
  canvas.className = 'tetra-resultados-grafico';
  panel.appendChild(canvas);
  dibujarGraficoDesviacion(canvas, desviaciones);

  const botonCorregir = crearBotonCorregirOffset(desviaciones, offsetActual);
  if (botonCorregir) {
    panel.appendChild(botonCorregir);
  }

  contenedor.appendChild(panel);
}
