// T-045: pantalla de estadisticas globales. Minimalista, sobre la escena (el
// fondo por defecto, sin portada): cuatro numeros grandes en mono, dos
// graficos de linea por dia (desviacion y precision), barras de fallos por
// columna con la tecla de cada una y una barra partida temprano/tarde. Sin
// parrafos. El filtro (7 dias, 30 dias, todo) es un segmentado chico arriba.
//
// Lo que se calcula (promedios ponderados por notas, series por dia) vive en
// @tetra/core; la geometria y los textos, en estadisticas-globales-logica.ts.
// Aca solo se arma el DOM y se dibuja. Los graficos son canvas planos con DPR,
// con los colores de tokens.css, sin librerias (mismo criterio que results.ts).

import { filtrarPorVentana, resumirHistorial, serieDiaria } from '@tetra/core';
import type { RegistroPartida, ResumenHistorial } from '@tetra/core';
import { leerHistorial } from '@tetra/storage';
import { fondoEscena } from './fondo-escena.js';
import { crearBotonIcono } from './iconos.js';
import { leerKeyMap } from './keymap.js';
import { nombreLegibleDeCodigo } from './teclas.js';
import { colorConAlpha } from './resultados-logica.js';
import { tituloDeDesviacion } from './records-logica.js';
import {
  PERIODOS,
  PERIODO_INICIAL,
  alturasDeBarras,
  diaLocal,
  escalaDeValores,
  etiquetaDeDia,
  formatearDuracion,
  fraccionesEnX,
  partesTempranoTarde,
  textoDeDesviacionMedia,
  textoDePrecisionMedia,
  type EscalaY,
  type IdPeriodo,
} from './estadisticas-globales-logica.js';

/** Gancho de navegacion que le pasa el router (ver router.ts). */
export interface OpcionesEstadisticasGlobales {
  /** Volver al menu. */
  aMenu: () => void;
  /** Ir al song select, desde el estado vacio ("Jugar"). */
  aJugar: () => void;
}

const FUENTE_ETIQUETAS = "11px 'JetBrains Mono', monospace";
const FUENTE_VALORES = "12px 'JetBrains Mono', monospace";
const ALTO_LINEA = 172;
const ALTO_BARRAS = 148;
const ANCHO_POR_DEFECTO = 320;

/** Colores de los graficos, leidos una vez de tokens.css (con el hex de respaldo por si falta el token). */
interface Colores {
  linea: string;
  acento: string;
  tinta: string;
  tinta2: string;
  tinta3: string;
  fallo: string;
}

function leerColores(): Colores {
  const estilo = getComputedStyle(document.documentElement);
  const leer = (token: string, respaldo: string): string => {
    const valor = estilo.getPropertyValue(token).trim();
    return valor === '' ? respaldo : valor;
  };
  return {
    linea: leer('--linea', '#263139'),
    acento: leer('--acento', '#3fd8c2'),
    tinta: leer('--tinta', '#e7eef0'),
    tinta2: leer('--tinta-2', '#9daab2'),
    tinta3: leer('--tinta-3', '#5f6e77'),
    fallo: leer('--j-miss', '#d8544e'),
  };
}

/**
 * Deja el canvas listo para dibujar en coordenadas logicas: el bitmap se escala
 * por `devicePixelRatio` (nitidez) y el tamano CSS lo manda la hoja de estilos.
 * Devuelve el contexto y el ancho logico, o `null` si no hay contexto 2D.
 */
function prepararCanvas(
  canvas: HTMLCanvasElement,
  alto: number,
): { contexto: CanvasRenderingContext2D; ancho: number } | null {
  const contexto = canvas.getContext('2d');
  if (contexto === null) return null;
  const ancho = Math.round(
    canvas.clientWidth > 0 ? canvas.clientWidth : ANCHO_POR_DEFECTO,
  );
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(ancho * dpr);
  canvas.height = Math.round(alto * dpr);
  contexto.setTransform(dpr, 0, 0, dpr, 0, 0);
  contexto.clearRect(0, 0, ancho, alto);
  return { contexto, ancho };
}

function dibujarMensaje(
  contexto: CanvasRenderingContext2D,
  ancho: number,
  alto: number,
  texto: string,
  colores: Colores,
): void {
  contexto.font = FUENTE_ETIQUETAS;
  contexto.textAlign = 'center';
  contexto.textBaseline = 'middle';
  contexto.fillStyle = colores.tinta3;
  contexto.fillText(texto, ancho / 2, alto / 2);
}

interface OpcionesLinea {
  serie: readonly { dia: string; valor: number }[];
  escala: EscalaY;
  /** El texto de una marca del eje Y ("+4 ms", "98%"). */
  formatoMarca: (valor: number) => string;
  /** Si hay una linea de cero que resaltar (la desviacion con signo). */
  conCero: boolean;
  color: string;
  vacio: string;
}

/**
 * Grafico de linea por dia: X proporcional a la fecha (un hueco se ve como
 * hueco), Y con marcas redondas en el margen izquierdo, las dos fechas de los
 * extremos abajo. Con un solo dia queda un punto al centro; sin dias, un
 * mensaje. Nunca dibuja un NaN.
 */
function dibujarLinea(
  canvas: HTMLCanvasElement,
  o: OpcionesLinea,
  colores: Colores,
): void {
  const preparado = prepararCanvas(canvas, ALTO_LINEA);
  if (preparado === null) return;
  const { contexto, ancho } = preparado;
  if (o.serie.length === 0) {
    dibujarMensaje(contexto, ancho, ALTO_LINEA, o.vacio, colores);
    return;
  }

  const izquierda = 56;
  const derecha = ancho - 14;
  const arriba = 10;
  const abajo = ALTO_LINEA - 24;
  const { min, max, marcas } = o.escala;
  const yDe = (valor: number): number =>
    abajo - ((valor - min) / (max - min)) * (abajo - arriba);

  contexto.font = FUENTE_ETIQUETAS;
  contexto.textBaseline = 'middle';
  contexto.textAlign = 'right';
  contexto.lineWidth = 1;
  for (const marca of marcas) {
    const y = Math.round(yDe(marca)) + 0.5;
    const esCero = o.conCero && marca === 0;
    contexto.strokeStyle = esCero
      ? colorConAlpha(colores.acento, 0.5)
      : colorConAlpha(colores.linea, 0.8);
    contexto.beginPath();
    contexto.moveTo(izquierda, y);
    contexto.lineTo(derecha, y);
    contexto.stroke();
    contexto.fillStyle = colores.tinta3;
    contexto.fillText(o.formatoMarca(marca), izquierda - 8, y);
  }

  const fracciones = fraccionesEnX(o.serie.map((p) => p.dia));
  const x0 = izquierda + 8;
  const x1 = derecha - 8;
  const puntos = o.serie.map((p, i) => ({
    x: x0 + fracciones[i]! * (x1 - x0),
    y: yDe(p.valor),
  }));

  if (puntos.length >= 2) {
    contexto.strokeStyle = o.color;
    contexto.lineWidth = 2;
    contexto.lineJoin = 'round';
    contexto.beginPath();
    puntos.forEach((p, i) => {
      if (i === 0) contexto.moveTo(p.x, p.y);
      else contexto.lineTo(p.x, p.y);
    });
    contexto.stroke();
  }
  contexto.fillStyle = o.color;
  for (const p of puntos) {
    contexto.beginPath();
    contexto.arc(p.x, p.y, 3, 0, Math.PI * 2);
    contexto.fill();
  }

  // Fechas de los extremos. Con un solo dia, una sola etiqueta al centro.
  contexto.fillStyle = colores.tinta3;
  contexto.textBaseline = 'alphabetic';
  const yEtiqueta = ALTO_LINEA - 6;
  const primero = o.serie[0]!.dia;
  const ultimo = o.serie[o.serie.length - 1]!.dia;
  if (o.serie.length === 1) {
    contexto.textAlign = 'center';
    contexto.fillText(etiquetaDeDia(primero), (izquierda + derecha) / 2, yEtiqueta);
  } else {
    contexto.textAlign = 'left';
    contexto.fillText(etiquetaDeDia(primero), izquierda, yEtiqueta);
    contexto.textAlign = 'right';
    contexto.fillText(etiquetaDeDia(ultimo), derecha, yEtiqueta);
  }
}

/** Cuatro barras de fallos con la tecla de cada columna abajo y el conteo arriba. La (o las) que mas falla va en rojo; el resto, tenue. */
function dibujarBarras(
  canvas: HTMLCanvasElement,
  fallos: readonly number[],
  teclas: readonly string[],
  colores: Colores,
): void {
  const preparado = prepararCanvas(canvas, ALTO_BARRAS);
  if (preparado === null) return;
  const { contexto, ancho } = preparado;
  const alturas = alturasDeBarras(fallos);
  const arriba = 22;
  const abajo = ALTO_BARRAS - 26;
  const hueco = ancho / 4;
  const anchoBarra = Math.min(36, hueco * 0.5);

  contexto.lineWidth = 1;
  contexto.strokeStyle = colorConAlpha(colores.linea, 0.9);
  contexto.beginPath();
  contexto.moveTo(0, abajo + 0.5);
  contexto.lineTo(ancho, abajo + 0.5);
  contexto.stroke();

  contexto.textAlign = 'center';
  fallos.forEach((cantidad, i) => {
    const centro = hueco * (i + 0.5);
    const alto = (abajo - arriba) * alturas[i]!;
    const esMayor = alturas[i] === 1 && cantidad > 0;
    contexto.fillStyle = esMayor ? colores.fallo : colorConAlpha(colores.tinta3, 0.55);
    // Una barra sin fallos igual deja una raya de 2 px: se lee "cero", no "falta el dato".
    const altoVisible = Math.max(2, alto);
    contexto.fillRect(
      centro - anchoBarra / 2,
      abajo - altoVisible,
      anchoBarra,
      altoVisible,
    );

    contexto.font = FUENTE_VALORES;
    contexto.textBaseline = 'alphabetic';
    contexto.fillStyle = esMayor ? colores.tinta : colores.tinta2;
    contexto.fillText(String(cantidad), centro, abajo - altoVisible - 6);

    contexto.font = FUENTE_ETIQUETAS;
    contexto.textBaseline = 'middle';
    contexto.fillStyle = colores.tinta3;
    contexto.fillText(teclas[i] ?? String(i + 1), centro, ALTO_BARRAS - 10);
  });
}

function crearEtiqueta(texto: string): HTMLElement {
  const h2 = document.createElement('h2');
  h2.className = 'tetra-estg-etiqueta';
  h2.textContent = texto;
  return h2;
}

function crearCifra(etiqueta: string, valor: string, titulo?: string): HTMLElement {
  const cifra = document.createElement('div');
  cifra.className = 'tetra-estg-cifra';
  const e = document.createElement('span');
  e.className = 'tetra-estg-cifra-etiqueta';
  e.textContent = etiqueta;
  const v = document.createElement('span');
  v.className = 'tetra-estg-cifra-valor';
  v.textContent = valor;
  cifra.append(e, v);
  if (titulo !== undefined) cifra.title = titulo;
  return cifra;
}

/** Un panel de grafico: etiqueta chica arriba y el canvas debajo. */
function crearPanelDeCanvas(
  etiqueta: string,
  descripcion: string,
): {
  panel: HTMLElement;
  canvas: HTMLCanvasElement;
} {
  const panel = document.createElement('section');
  panel.className = 'tetra-estg-panel';
  const canvas = document.createElement('canvas');
  canvas.className = 'tetra-estg-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', descripcion);
  panel.append(crearEtiqueta(etiqueta), canvas);
  return { panel, canvas };
}

/** El texto de un lector de pantalla para un grafico de linea: cuantos dias y de que valor a que valor. */
function describirSerie(
  nombre: string,
  serie: readonly { dia: string; valor: number }[],
  formato: (valor: number) => string,
): string {
  if (serie.length === 0) return `${nombre}: sin partidas`;
  const primero = serie[0]!;
  const ultimo = serie[serie.length - 1]!;
  const dias = serie.length === 1 ? '1 dia' : `${serie.length} dias`;
  return `${nombre}: ${dias}, de ${formato(primero.valor)} a ${formato(ultimo.valor)}`;
}

/** La barra partida temprano/tarde: dos tramos proporcionales y, debajo, los dos porcentajes. */
function crearBarraPartida(resumen: ResumenHistorial): HTMLElement {
  const partes = partesTempranoTarde(resumen.proporcionTemprana);
  const panel = document.createElement('section');
  panel.className = 'tetra-estg-panel tetra-estg-panel-partida';
  panel.appendChild(crearEtiqueta('Temprano y tarde'));

  const barra = document.createElement('div');
  barra.className = 'tetra-estg-partida';
  const pie = document.createElement('div');
  pie.className = 'tetra-estg-partida-pie';

  const lado = (
    clase: string,
    nombre: string,
    porcentaje: number | undefined,
  ): HTMLElement => {
    const el = document.createElement('span');
    el.className = `tetra-estg-partida-lado ${clase}`;
    const n = document.createElement('span');
    n.className = 'tetra-estg-partida-nombre';
    n.textContent = nombre;
    const v = document.createElement('span');
    v.className = 'tetra-estg-partida-valor';
    v.textContent = porcentaje === undefined ? '-' : `${porcentaje}%`;
    el.append(n, v);
    return el;
  };

  if (partes === null) {
    barra.classList.add('tetra-estg-partida-vacia');
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label', 'Sin golpes tempranos ni tardios');
  } else {
    const temprano = document.createElement('span');
    temprano.className = 'tetra-estg-partida-temprano';
    temprano.style.flexGrow = String(partes.temprano);
    const tarde = document.createElement('span');
    tarde.className = 'tetra-estg-partida-tarde';
    tarde.style.flexGrow = String(partes.tarde);
    barra.append(temprano, tarde);
    barra.setAttribute('role', 'img');
    barra.setAttribute(
      'aria-label',
      `${partes.temprano}% temprano, ${partes.tarde}% tarde`,
    );
  }
  pie.append(
    lado('tetra-estg-lado-temprano', 'Temprano', partes?.temprano),
    lado('tetra-estg-lado-tarde', 'Tarde', partes?.tarde),
  );
  panel.append(barra, pie);
  return panel;
}

/** El estado vacio: el mismo lenguaje que el song select sin canciones (el cuatro hecho de barras, una linea y un boton). */
function crearVacio(aJugar: () => void): HTMLElement {
  const vacio = document.createElement('div');
  vacio.className = 'tetra-estg-vacio';
  const icono = document.createElement('span');
  icono.className = 'tetra-song-select-vacio-icono';
  icono.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 4; i++) icono.appendChild(document.createElement('span'));
  const linea = document.createElement('p');
  linea.className = 'tetra-song-select-vacio-titulo';
  linea.textContent = 'Todavia no hay partidas';
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'tetra-boton-primario tetra-estg-jugar';
  boton.textContent = 'Jugar';
  boton.addEventListener('click', aJugar);
  vacio.append(icono, linea, boton);
  return vacio;
}

/**
 * Muestra las estadisticas dentro de `contenedor`, reemplazando lo que hubiera.
 * El historial se lee una vez al entrar; cambiar el filtro solo recalcula.
 */
export function mostrarEstadisticasGlobales(
  contenedor: HTMLElement,
  opciones: OpcionesEstadisticasGlobales,
): void {
  contenedor.innerHTML = '';
  fondoEscena().limpiar();

  const panel = document.createElement('div');
  panel.className = 'tetra-estg';

  // Barra superior: volver, el titulo (un h1 accesible, chico) y el filtro.
  const barra = document.createElement('div');
  barra.className = 'tetra-estg-barra';
  const volver = crearBotonIcono('volver', 'Volver al menu', 'tetra-boton-volver');
  volver.addEventListener('click', () => {
    observador.disconnect();
    opciones.aMenu();
  });
  const titulo = document.createElement('h1');
  titulo.className = 'tetra-estg-titulo';
  titulo.textContent = 'Estadisticas';

  const periodos = document.createElement('div');
  periodos.className = 'tetra-estg-periodos';
  periodos.setAttribute('role', 'group');
  periodos.setAttribute('aria-label', 'Periodo');
  const botonesDePeriodo = new Map<IdPeriodo, HTMLButtonElement>();
  for (const periodo of PERIODOS) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'tetra-estg-periodo';
    boton.textContent = periodo.etiqueta;
    boton.addEventListener('click', () => elegir(periodo.id));
    botonesDePeriodo.set(periodo.id, boton);
    periodos.appendChild(boton);
  }
  barra.append(volver, titulo, periodos);
  panel.appendChild(barra);

  const cuerpo = document.createElement('div');
  cuerpo.className = 'tetra-estg-cuerpo';
  panel.appendChild(cuerpo);
  contenedor.appendChild(panel);

  let historial: RegistroPartida[] | null = null;
  let periodoActual: IdPeriodo = PERIODO_INICIAL;
  /** Lo que hay que redibujar cuando cambia el ancho (cada grafico, con sus datos). */
  let dibujos: (() => void)[] = [];
  const colores = leerColores();

  // Los canvas toman su ancho del contenedor: si la ventana cambia, se redibujan.
  const observador = new ResizeObserver(() => {
    for (const dibujar of dibujos) dibujar();
  });
  observador.observe(cuerpo);

  function elegir(id: IdPeriodo): void {
    periodoActual = id;
    pintar();
  }

  function pintar(): void {
    cuerpo.replaceChildren();
    dibujos = [];
    for (const [id, boton] of botonesDePeriodo) {
      boton.setAttribute('aria-pressed', String(id === periodoActual));
    }
    if (historial === null) return;

    // Sin una sola partida guardada no hay nada que filtrar: estado vacio.
    panel.classList.toggle('tetra-estg-sin-datos', historial.length === 0);
    if (historial.length === 0) {
      cuerpo.appendChild(crearVacio(opciones.aJugar));
      return;
    }

    const dias = PERIODOS.find((p) => p.id === periodoActual)?.dias ?? null;
    const registros = filtrarPorVentana(historial, dias, new Date().getTime());
    const resumen = resumirHistorial(registros);

    // Cuatro numeros grandes.
    const cifras = document.createElement('div');
    cifras.className = 'tetra-estg-cifras';
    const detalleDesviacion =
      resumen.desviacionMedia === null
        ? undefined
        : `${tituloDeDesviacion(resumen.desviacionMedia)}${
            resumen.desviacionTipica === null
              ? ''
              : `. Dispersion: ${Math.round(resumen.desviacionTipica)} ms`
          }`;
    cifras.append(
      crearCifra('Partidas', String(resumen.partidas), `${resumen.notas} notas`),
      crearCifra('Tiempo', formatearDuracion(resumen.tiempoJugadoMs)),
      crearCifra(
        'Precision media',
        textoDePrecisionMedia(resumen.accuracyMedia),
        'Ponderada por notas: una partida larga pesa mas que una corta',
      ),
      crearCifra(
        'Desviacion media',
        textoDeDesviacionMedia(resumen.desviacionMedia),
        detalleDesviacion,
      ),
    );
    cuerpo.appendChild(cifras);

    // Dos graficos de linea por dia.
    const serieDesviacion = serieDiaria(registros, 'desviacionMedia', diaLocal);
    const seriePrecision = serieDiaria(registros, 'accuracy', diaLocal).map((p) => ({
      dia: p.dia,
      valor: p.valor * 100,
    }));
    const formatoMs = (v: number): string => `${v > 0 ? '+' : ''}${v} ms`;
    const formatoPorcentaje = (v: number): string => `${Math.round(v * 100) / 100}%`;

    const graficos = document.createElement('div');
    graficos.className = 'tetra-estg-graficos';
    const desviacion = crearPanelDeCanvas(
      'Desviacion por dia',
      describirSerie('Desviacion media por dia', serieDesviacion, formatoMs),
    );
    const precision = crearPanelDeCanvas(
      'Precision por dia',
      describirSerie('Precision media por dia', seriePrecision, formatoPorcentaje),
    );
    graficos.append(desviacion.panel, precision.panel);
    cuerpo.appendChild(graficos);

    const escalaDesviacion = escalaDeValores(
      serieDesviacion.map((p) => p.valor),
      { conCero: true },
    );
    const escalaPrecision = escalaDeValores(
      seriePrecision.map((p) => p.valor),
      { maximo: 100 },
    );
    dibujos.push(
      () =>
        dibujarLinea(
          desviacion.canvas,
          {
            serie: serieDesviacion,
            escala: escalaDesviacion,
            formatoMarca: formatoMs,
            conCero: true,
            color: colores.acento,
            vacio: 'Sin partidas en este periodo',
          },
          colores,
        ),
      () =>
        dibujarLinea(
          precision.canvas,
          {
            serie: seriePrecision,
            escala: escalaPrecision,
            formatoMarca: (v) => `${v}%`,
            conCero: false,
            color: colores.tinta2,
            vacio: 'Sin partidas en este periodo',
          },
          colores,
        ),
    );

    // Fallos por columna (con la tecla de cada una) y la barra partida.
    const fila = document.createElement('div');
    fila.className = 'tetra-estg-fila-final';
    const teclas = leerKeyMap().map(nombreLegibleDeCodigo);
    const fallos = crearPanelDeCanvas(
      'Fallos por columna',
      `Fallos por columna: ${resumen.fallosPorColumna
        .map((n, i) => `${teclas[i] ?? i + 1} ${n}`)
        .join(', ')}`,
    );
    fila.append(fallos.panel, crearBarraPartida(resumen));
    cuerpo.appendChild(fila);
    dibujos.push(() =>
      dibujarBarras(fallos.canvas, resumen.fallosPorColumna, teclas, colores),
    );

    for (const dibujar of dibujos) dibujar();
    // La tipografia mono puede no haber llegado al primer dibujo: se repite una vez cuando carga.
    if (
      typeof document.fonts !== 'undefined' &&
      !document.fonts.check(FUENTE_ETIQUETAS)
    ) {
      const actuales = dibujos;
      void document.fonts
        .load(FUENTE_ETIQUETAS)
        .then(() => {
          if (actuales === dibujos) for (const dibujar of actuales) dibujar();
        })
        .catch(() => undefined);
    }
  }

  pintar();
  void leerHistorial()
    .catch((): RegistroPartida[] => [])
    .then((registros) => {
      // Si el jugador ya salio de la pantalla, no hay nada que pintar.
      if (!panel.isConnected) return;
      historial = registros;
      pintar();
    });
}
