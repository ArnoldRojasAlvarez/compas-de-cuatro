// T-004: pantalla de resultados. DOM plano, sin Pixi (ver T-004, "Pantalla
// de resultados"): esto se dibuja una sola vez, cuando el juego ya termino,
// no hace falta el rendimiento de un renderer de juego para esto.
//
// T-021: pasada grafica. Rango en grande, precision como dato estrella,
// conteos con barra proporcional y grafico de desviacion con los tokens de
// docs/DISENO.md. La logica pura vive en resultados-logica.ts.

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
import { colorConAlpha, fraccionesDeJuicio, rangoDePrecision } from './resultados-logica.js';

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

const ANCHO_MAXIMO_GRAFICO = 760;
const ANCHO_MINIMO_GRAFICO = 240;
const ALTO_GRAFICO = 220;

/** Margenes internos del grafico, en px logicos (no del canvas escalado por DPR). */
const MARGEN_IZQUIERDO = 60;
const MARGEN_DERECHO = 12;
const MARGEN_SUPERIOR = 12;
/** Franja inferior reservada para las marcas de miss. */
const ALTO_FRANJA_MISS = 26;

const FUENTE_ETIQUETAS = "11px 'JetBrains Mono', monospace";

/** Colores del grafico, leidos una vez de tokens.css (con fallback hex por si falta el token). */
interface ColoresGrafico {
  superficie: string;
  linea: string;
  acento: string;
  tinta3: string;
  juicio: Record<Judgement, string>;
}

const FALLBACK_COLORES: ColoresGrafico = {
  superficie: '#131a1f',
  linea: '#263139',
  acento: '#3fd8c2',
  tinta3: '#5f6e77',
  juicio: {
    max: '#3fd8c2',
    perfect: '#e8b84a',
    great: '#5fc46a',
    good: '#4f93d8',
    bad: '#9a78d8',
    miss: '#d8544e',
  },
};

/** Token CSS de cada juicio (docs/DISENO.md, "Paleta"). */
const TOKEN_JUICIO: Record<Judgement, string> = {
  max: '--j-max',
  perfect: '--j-300',
  great: '--j-200',
  good: '--j-100',
  bad: '--j-50',
  miss: '--j-miss',
};

function leerColoresGrafico(): ColoresGrafico {
  const estilo = getComputedStyle(document.documentElement);
  const leer = (token: string, fallback: string): string => {
    const valor = estilo.getPropertyValue(token).trim();
    return valor === '' ? fallback : valor;
  };

  const juicio = {} as Record<Judgement, string>;
  for (const j of JUDGEMENTS) {
    juicio[j] = leer(TOKEN_JUICIO[j], FALLBACK_COLORES.juicio[j]);
  }
  return {
    superficie: leer('--superficie', FALLBACK_COLORES.superficie),
    linea: leer('--linea', FALLBACK_COLORES.linea),
    acento: leer('--acento', FALLBACK_COLORES.acento),
    tinta3: leer('--tinta-3', FALLBACK_COLORES.tinta3),
    juicio,
  };
}

/** Paso "redondo" de rejilla (en ms) para que haya como mucho 3 lineas por lado. */
function pasoDeRejilla(cota: number): number {
  const pasos = [5, 10, 20, 25, 50, 100, 200, 500, 1000];
  for (const paso of pasos) {
    if (cota / paso <= 3) return paso;
  }
  return 1000;
}

/**
 * Dibuja el grafico de desviacion en un canvas 2D plano: cada golpe es un
 * punto del color de su juicio, X es el tiempo de la nota en la pista, Y es
 * el error en ms (arriba tarde, abajo temprano). Sirve para ver de un
 * vistazo si el offset esta centrado en cero o si hay un sesgo constante.
 *
 * Los miss no tienen un error que dibujar (su `error` es el tiempo que
 * tardo en darse la nota por perdida, ver estadisticas.ts), asi que van como
 * una x en una franja propia al pie del grafico, y no cuentan para la escala
 * vertical.
 *
 * Nitidez: el canvas interno se escala por `devicePixelRatio` y se dibuja
 * en coordenadas logicas (`ancho` x `ALTO_GRAFICO`), con el tamano CSS fijado
 * a esas mismas medidas.
 */
function dibujarGraficoDesviacion(
  canvas: HTMLCanvasElement,
  desviaciones: readonly Desviacion[],
  ancho: number,
  colores: ColoresGrafico,
): void {
  const contexto = canvas.getContext('2d');
  if (!contexto) return;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(ancho * dpr);
  canvas.height = Math.round(ALTO_GRAFICO * dpr);
  canvas.style.width = `${ancho}px`;
  canvas.style.aspectRatio = `${ancho} / ${ALTO_GRAFICO}`;
  contexto.setTransform(dpr, 0, 0, dpr, 0, 0);

  contexto.fillStyle = colores.superficie;
  contexto.fillRect(0, 0, ancho, ALTO_GRAFICO);

  contexto.font = FUENTE_ETIQUETAS;
  contexto.textBaseline = 'middle';

  if (desviaciones.length === 0) {
    contexto.fillStyle = colores.tinta3;
    contexto.textAlign = 'center';
    contexto.fillText('Sin golpes registrados', ancho / 2, ALTO_GRAFICO / 2);
    return;
  }

  const izquierda = MARGEN_IZQUIERDO;
  const derecha = ancho - MARGEN_DERECHO;
  const arriba = MARGEN_SUPERIOR;
  const abajo = ALTO_GRAFICO - ALTO_FRANJA_MISS;
  const centro = (arriba + abajo) / 2;
  const mitadAlto = (abajo - arriba) / 2;

  const juzgados = desviaciones.filter((d) => d.judgement !== 'miss');
  // Cota simetrica alrededor de 0: si todos los errores fueran diminutos,
  // igual se deja un margen minimo para que el grafico no quede en blanco.
  const cotaError = Math.max(20, ...juzgados.map((d) => Math.abs(d.error))) * 1.1;

  const tiempos = desviaciones.map((d) => d.time);
  const tiempoMinimo = Math.min(...tiempos);
  const tiempoMaximo = Math.max(...tiempos);
  const rangoTiempo = Math.max(1, tiempoMaximo - tiempoMinimo);

  const yDeError = (error: number): number => centro - (error / cotaError) * mitadAlto;
  const xDeTiempo = (time: number): number =>
    izquierda + 8 + ((time - tiempoMinimo) / rangoTiempo) * (derecha - izquierda - 16);

  // Rejilla horizontal tenue, con su valor en ms en el margen izquierdo.
  const paso = pasoDeRejilla(cotaError);
  contexto.lineWidth = 1;
  contexto.textAlign = 'right';
  for (let k = -Math.floor(cotaError / paso); k <= Math.floor(cotaError / paso); k++) {
    const valor = k * paso;
    const y = Math.round(yDeError(valor)) + 0.5;
    if (valor === 0) continue;
    contexto.strokeStyle = colorConAlpha(colores.linea, 0.8);
    contexto.beginPath();
    contexto.moveTo(izquierda, y);
    contexto.lineTo(derecha, y);
    contexto.stroke();
    contexto.fillStyle = colores.tinta3;
    contexto.fillText(`${valor > 0 ? '+' : ''}${valor} ms`, izquierda - 8, y);
  }

  // Linea de cero: el offset esta bien calibrado si los puntos se reparten
  // parejo arriba y abajo de esta linea, no desplazados en bloque.
  const yCero = Math.round(yDeError(0)) + 0.5;
  contexto.strokeStyle = colorConAlpha(colores.acento, 0.55);
  contexto.beginPath();
  contexto.moveTo(izquierda, yCero);
  contexto.lineTo(derecha, yCero);
  contexto.stroke();
  contexto.fillStyle = colores.tinta3;
  contexto.fillText('0', izquierda - 8, yCero);

  // Sentido del eje: que significa arriba y abajo, sin depender de los signos.
  contexto.textAlign = 'right';
  contexto.fillText('tarde', derecha - 4, arriba + 6);
  contexto.fillText('temprano', derecha - 4, abajo - 6);

  // Franja de miss: separador tenue y una x por cada nota perdida.
  const yMiss = ALTO_GRAFICO - ALTO_FRANJA_MISS / 2;
  contexto.strokeStyle = colorConAlpha(colores.linea, 0.8);
  contexto.beginPath();
  contexto.moveTo(izquierda, abajo + 0.5);
  contexto.lineTo(derecha, abajo + 0.5);
  contexto.stroke();
  contexto.fillStyle = colores.tinta3;
  contexto.fillText('miss', izquierda - 8, yMiss);

  // Puntos de cada golpe, coloreados por juicio. Un poco de alpha para que
  // las zonas densas se lean como mancha y no como un solo punto.
  for (const desviacion of desviaciones) {
    const x = xDeTiempo(desviacion.time);
    const color = colores.juicio[desviacion.judgement];
    if (desviacion.judgement === 'miss') {
      const radio = 3.5;
      contexto.strokeStyle = color;
      contexto.lineWidth = 1.5;
      contexto.beginPath();
      contexto.moveTo(x - radio, yMiss - radio);
      contexto.lineTo(x + radio, yMiss + radio);
      contexto.moveTo(x + radio, yMiss - radio);
      contexto.lineTo(x - radio, yMiss + radio);
      contexto.stroke();
      contexto.lineWidth = 1;
      continue;
    }
    const y = yDeError(Math.max(-cotaError, Math.min(cotaError, desviacion.error)));
    contexto.fillStyle = colorConAlpha(color, 0.85);
    contexto.beginPath();
    contexto.arc(x, y, 2.5, 0, Math.PI * 2);
    contexto.fill();
  }
}

/** Fila de conteo: nombre, barra proporcional en el color del juicio y cantidad. */
function crearFilaConteo(juicio: Judgement, cantidad: number, fraccion: number): HTMLElement {
  const fila = document.createElement('div');
  fila.className = `tetra-resultados-fila tetra-resultados-juicio-${juicio}`;

  const nombre = document.createElement('span');
  nombre.className = 'tetra-resultados-fila-nombre';
  nombre.textContent = NOMBRE_JUICIO[juicio];

  const pista = document.createElement('span');
  pista.className = 'tetra-resultados-fila-pista';
  if (cantidad > 0) {
    const relleno = document.createElement('span');
    relleno.className = 'tetra-resultados-fila-relleno';
    relleno.style.width = `${(fraccion * 100).toFixed(2)}%`;
    pista.appendChild(relleno);
  }

  const total = document.createElement('span');
  total.className = 'tetra-resultados-fila-cantidad';
  total.textContent = String(cantidad);

  fila.append(nombre, pista, total);
  return fila;
}

/** "-24 ms (temprano)", "18 ms (tarde)" o "0 ms" si no hay ni una cosa ni la otra. */
function formatearMedia(valor: Ms): string {
  const etiqueta = etiquetaDeSigno(valor);
  const numero = Math.round(valor);
  return etiqueta === null ? `${numero} ms` : `${numero} ms (${etiqueta})`;
}

/** Celda de dato: etiqueta chica en mayusculas y valor en mono. */
function crearCelda(etiqueta: string, valor: string, nota?: string): HTMLElement {
  const celda = document.createElement('div');
  celda.className = 'tetra-resultados-celda';

  const etiquetaEl = document.createElement('span');
  etiquetaEl.className = 'tetra-resultados-etiqueta';
  etiquetaEl.textContent = etiqueta;

  const valorEl = document.createElement('span');
  valorEl.className = 'tetra-resultados-valor';
  valorEl.textContent = valor;

  celda.append(etiquetaEl, valorEl);
  if (nota !== undefined) {
    const notaEl = document.createElement('span');
    notaEl.className = 'tetra-resultados-nota';
    notaEl.textContent = nota;
    celda.appendChild(notaEl);
  }
  return celda;
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
  const sesgo = etiquetaDeSigno(mediaError);

  const bloque = document.createElement('div');
  bloque.className = 'tetra-resultados-estadisticas';
  bloque.append(
    crearCelda('Media', `${Math.round(mediaError)} ms`, sesgo ?? undefined),
    crearCelda('Desv. estandar', `${Math.round(desviacion)} ms`),
    crearCelda('Temprano', String(conteo.temprano)),
    crearCelda('Tarde', String(conteo.tarde)),
  );
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

/** Bloque principal: letra de rango a la izquierda, precision, score y combo a la derecha. */
function crearBloquePrincipal(estado: ScoreState): HTMLElement {
  const rango = rangoDePrecision(estado.accuracy);

  const principal = document.createElement('section');
  principal.className = 'tetra-resultados-principal';

  const letra = document.createElement('div');
  letra.className = `tetra-resultados-rango tetra-resultados-rango-${rango}`;
  letra.textContent = rango;
  letra.setAttribute('role', 'img');
  letra.setAttribute('aria-label', `Rango ${rango}`);

  const datos = document.createElement('div');
  datos.className = 'tetra-resultados-datos';

  const precision = document.createElement('div');
  precision.className = 'tetra-resultados-celda tetra-resultados-celda-precision';
  const precisionEtiqueta = document.createElement('span');
  precisionEtiqueta.className = 'tetra-resultados-etiqueta';
  precisionEtiqueta.textContent = 'Precision';
  const precisionValor = document.createElement('span');
  precisionValor.className = 'tetra-resultados-precision';
  precisionValor.textContent = `${(estado.accuracy * 100).toFixed(2)}%`;
  precision.append(precisionEtiqueta, precisionValor);

  const secundarios = document.createElement('div');
  secundarios.className = 'tetra-resultados-secundarios';
  secundarios.append(
    crearCelda('Score', String(estado.score)),
    crearCelda('Combo maximo', String(estado.maxCombo)),
  );

  datos.append(precision, secundarios);
  principal.append(letra, datos);
  return principal;
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
  titulo.className = 'tetra-resultados-titulo';
  titulo.textContent = 'Resultados';
  panel.appendChild(titulo);

  panel.appendChild(crearBloquePrincipal(estado));

  // Conteos y estadisticas lado a lado en ancho (una columna en angosto).
  const detalle = document.createElement('section');
  detalle.className = 'tetra-resultados-detalle';

  const conteos = document.createElement('div');
  conteos.className = 'tetra-resultados-conteos';
  const fracciones = fraccionesDeJuicio(estado.counts);
  for (const juicio of JUDGEMENTS) {
    conteos.appendChild(crearFilaConteo(juicio, estado.counts[juicio], fracciones[juicio]));
  }
  detalle.append(conteos, crearBloqueEstadisticas(desviaciones));
  panel.appendChild(detalle);

  const seccionGrafico = document.createElement('section');
  seccionGrafico.className = 'tetra-resultados-seccion-grafico';

  const subtituloGrafico = document.createElement('h2');
  subtituloGrafico.className = 'tetra-resultados-subtitulo';
  subtituloGrafico.textContent = 'Desviacion de cada golpe en el tiempo';
  seccionGrafico.appendChild(subtituloGrafico);

  const cajaGrafico = document.createElement('div');
  cajaGrafico.className = 'tetra-resultados-grafico-caja';
  const canvas = document.createElement('canvas');
  canvas.className = 'tetra-resultados-grafico';
  cajaGrafico.appendChild(canvas);
  seccionGrafico.appendChild(cajaGrafico);
  panel.appendChild(seccionGrafico);

  const botonCorregir = crearBotonCorregirOffset(desviaciones, offsetActual);
  if (botonCorregir) {
    panel.appendChild(botonCorregir);
  }

  // Indice de cada bloque para la aparicion escalonada (ver resultados.css).
  Array.from(panel.children).forEach((hijo, indice) => {
    if (hijo instanceof HTMLElement) hijo.style.setProperty('--orden', String(indice));
  });

  contenedor.appendChild(panel);

  // El grafico se dibuja una vez, ya con el panel en el documento: asi se
  // mide el ancho real disponible y las etiquetas no se encogen en pantallas
  // angostas (el canvas se dibuja del ancho que entra, no se escala).
  const colores = leerColoresGrafico();
  const anchoDisponible = cajaGrafico.clientWidth > 0 ? cajaGrafico.clientWidth : ANCHO_MAXIMO_GRAFICO;
  const ancho = Math.round(Math.min(ANCHO_MAXIMO_GRAFICO, Math.max(ANCHO_MINIMO_GRAFICO, anchoDisponible)));
  dibujarGraficoDesviacion(canvas, desviaciones, ancho, colores);

  // La tipografia mono puede no haber llegado todavia al primer dibujo:
  // si es asi, se repite el mismo dibujo una vez cuando carga.
  if (typeof document.fonts !== 'undefined' && !document.fonts.check(FUENTE_ETIQUETAS)) {
    void document.fonts
      .load(FUENTE_ETIQUETAS)
      .then(() => {
        if (canvas.isConnected) dibujarGraficoDesviacion(canvas, desviaciones, ancho, colores);
      })
      .catch(() => undefined);
  }
}
