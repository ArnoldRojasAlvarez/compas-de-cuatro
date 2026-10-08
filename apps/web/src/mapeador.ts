// Mapeador: editor de mapas 4K, manual y automatico. Pantalla propia del
// router (ver router.ts, "mapeador"). La logica que se puede probar sin
// navegador vive en mapeador-logica.ts y en @tetra/core (onsets, tempo,
// grilla, automapa, escritor de .osu); este archivo es DOM, canvas y audio.
//
// Reloj: la posicion del cabezal sale de `AudioContext.currentTime` mientras
// suena (misma regla que el juego, ver CLAUDE.md), y los clicks de nota y
// metronomo se programan por adelantado con `source.start(when)`, no con
// temporizadores. El bucle de dibujo usa rAF solo para dibujar.

import './mapeador.css';
import type {
  AnalisisOnsets,
  Column,
  EstimacionTempo,
  Grilla,
  NivelAuto,
  Note,
  SpeedPoint,
  TimingPoint,
} from '@tetra/core';
import {
  DIVISORES,
  PRESETS_AUTO,
  duracionPulso,
  escribirOsu,
  estimarTempo,
  generarNotas,
  lineasDeGrilla,
  replayPerfecto,
  slotMasCercano,
} from '@tetra/core';
import { construirOsz, guardarCancionCreada, guardarDificultad, leerCancion } from '@tetra/storage';
import { runGame, type OpcionesPartida } from './game.js';
import { analizarAudio } from './mapeador-worker-cliente.js';
import { leerKeyMap } from './keymap.js';
import { leerOffset } from './offset.js';
import { compensarLatencia, filtrarNotasDesde } from './partida-logica.js';
import {
  agregarTap,
  alternarTap,
  borrarBorrador,
  calcularPicos,
  colocarLarga,
  claveNota,
  columnaDeX,
  construirChart,
  copiarNotas,
  crearHistorial,
  cuantizadas,
  cuantizarNotas,
  desplazarNotas,
  elegidasVigentes,
  espejar,
  guardarBorrador,
  huecosSinNotas,
  leerBorrador,
  leerNumero,
  limitarZoom,
  marcasDeCompas,
  mezclarMono,
  moverNotas,
  notasEnSeleccion,
  pasaDelFinal,
  pegarNotas,
  quitarNota,
  quitarNotas,
  resumirNotas,
  resumirParaMinimapa,
  slotDeY,
  tiempoDeSlotEntero,
  tiempoDeXMinimapa,
  tiempoDeY,
  xDeTiempoMinimapa,
  yDeTiempo,
  type AjustesMapa,
  type Historial,
  type MetadatosMapa,
  type Portapapeles,
  type Seleccion,
  type Vista,
} from './mapeador-logica.js';

/** Ganchos de navegacion que le pasa el router. */
export interface OpcionesMapeador {
  aMenu: () => void;
  /** Ir al song select (despues de guardar en la biblioteca). */
  aSongSelect: () => void;
  /** Si viene, el editor arranca cargado con esa dificultad de esa cancion de la biblioteca. */
  abrir?: { songId: string; difficultyName: string };
}

/** Lo que sobrevive a probar el mapa (runGame reemplaza la pantalla) y a salir al menu. */
interface Sesion {
  /** Nombre del archivo de audio (el que va en AudioFilename del .osu y dentro del .osz). */
  nombreAudio: string;
  /**
   * Si se esta editando una cancion de la biblioteca (porque se abrio de ahi o
   * porque ya se guardo una vez): guardar reemplaza o agrega una dificultad en
   * esa cancion en vez de crear otra. Guarda tambien los puntos de tempo y de
   * velocidad originales, que el editor todavia no edita y no debe perder.
   */
  base: { songId: string; timingPoints: readonly TimingPoint[]; speedPoints: readonly SpeedPoint[] } | null;
  bytes: ArrayBuffer | null;
  buffer: AudioBuffer | null;
  picos: Float32Array | null;
  analisis: AnalisisOnsets | null;
  meta: MetadatosMapa;
  grilla: Grilla;
  ajustes: AjustesMapa;
  historial: Historial<Note[]>;
  tiempo: number;
  pxPorMs: number;
  auto: { nivel: NivelAuto; densidad: number; largas: boolean; semilla: number };
}

let sesionGuardada: Sesion | null = null;

/**
 * Portapapeles del editor (T-034). Vive en memoria mientras la pestana este
 * abierta, no en la sesion: sobrevive a probar el mapa, a salir al menu y a
 * abrir otra dificultad, asi se puede copiar un patron de un mapa a otro. No
 * usa el portapapeles del sistema.
 */
let portapapeles: Portapapeles | null = null;

/**
 * Notas elegidas. `origen` y `duracion` salen del rectangulo con que se
 * eligieron (su borde de arriba en el tiempo y su largo en slots): al copiar,
 * el compas se pega alineado aunque su primera nota no caiga en el borde. Con
 * Ctrl+A no hay rectangulo y valen `null` (se usa la primera nota).
 */
interface Eleccion {
  notas: readonly Note[];
  origen: number | null;
  duracion: number | null;
}

/** Las mismas opciones sin `abrir`: reabrir de la biblioteca pisaria una sesion en curso. */
function sinAbrir(o: OpcionesMapeador): OpcionesMapeador {
  return { aMenu: o.aMenu, aSongSelect: o.aSongSelect };
}

const MS_POR_CUBETA = 5;
const ANCHO_COLUMNA_MAX = 96;
const COLOR_ACENTO = '#3fd8c2';
const COLOR_AMBAR = '#e8b84a';
const COLOR_TINTA = '#e7eef0';

function sesionNueva(usarBorrador = true): Sesion {
  // Al abrir una cancion de la biblioteca no se mezcla el borrador de otra cosa.
  const borrador = usarBorrador ? leerBorrador() : null;
  return {
    nombreAudio: '',
    base: null,
    bytes: null,
    buffer: null,
    picos: null,
    analisis: null,
    meta: borrador?.meta ?? {
      titulo: '',
      artista: '',
      creador: 'Arnold Alvarez',
      dificultad: 'Normal',
      audioArchivo: '',
    },
    grilla: borrador?.grilla ?? { bpm: 120, offsetMs: 0, divisor: 4 },
    ajustes: borrador?.ajustes ?? { overallDifficulty: 7, hpDrain: 5 },
    historial: crearHistorial<Note[]>(borrador?.notas ?? []),
    tiempo: 0,
    pxPorMs: 0.3,
    auto: { nivel: 'normal', densidad: 1, largas: false, semilla: 1 },
  };
}

// ---------------------------------------------------------------------------
// Utilidades de DOM
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  clase?: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

function boton(texto: string, clase = ''): HTMLButtonElement {
  const b = el('button', clase, texto);
  b.type = 'button';
  return b;
}

function campo(etiqueta: string, control: HTMLElement, ayuda?: string): HTMLLabelElement {
  const l = el('label', 'tetra-mp-campo');
  l.appendChild(el('span', 'tetra-mp-etiqueta', etiqueta));
  l.appendChild(control);
  if (ayuda) l.title = ayuda;
  return l;
}

function entradaTexto(valor: string, marcador = ''): HTMLInputElement {
  const i = el('input');
  i.type = 'text';
  i.value = valor;
  i.placeholder = marcador;
  i.spellcheck = false;
  return i;
}

function entradaNumero(valor: number, min: number, max: number, paso: number): HTMLInputElement {
  const i = el('input');
  i.type = 'number';
  i.min = String(min);
  i.max = String(max);
  i.step = String(paso);
  i.value = String(valor);
  return i;
}

function seleccion(opciones: readonly [string, string][], actual: string): HTMLSelectElement {
  const s = el('select');
  for (const [valor, texto] of opciones) {
    const o = el('option', undefined, texto);
    o.value = valor;
    s.appendChild(o);
  }
  s.value = actual;
  return s;
}

function tarjeta(titulo: string, ...hijos: HTMLElement[]): HTMLElement {
  const t = el('section', 'tetra-mp-tarjeta');
  t.appendChild(el('h2', 'tetra-mp-tarjeta-titulo', titulo));
  for (const h of hijos) t.appendChild(h);
  return t;
}

function formatoTiempo(ms: number): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const mm = Math.floor(total % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(mm).padStart(3, '0')}`;
}

function descargar(nombre: string, datos: BlobPart, tipo: string): void {
  const url = URL.createObjectURL(new Blob([datos], { type: tipo }));
  const a = el('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

function nombreDeArchivoBase(meta: MetadatosMapa): string {
  const base = `${meta.artista || 'Artista'} - ${meta.titulo || 'Cancion'} [${meta.dificultad || 'Normal'}]`;
  return base.replace(/[<>:"/\\|?*]/g, '').trim();
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export function mostrarMapeador(contenedor: HTMLElement, opciones: OpcionesMapeador): void {
  contenedor.innerHTML = '';
  // Abrir una cancion de la biblioteca siempre empieza una sesion limpia; al
  // volver de "Probar" se reusa la que ya habia (ver volverAlEditor).
  const sesion: Sesion = opciones.abrir ? sesionNueva(false) : (sesionGuardada ?? sesionNueva());
  sesionGuardada = sesion;
  const raiz = document.getElementById('app') ?? contenedor;

  let activo = true;
  let ctx: AudioContext | null = null;
  let fuente: AudioBufferSourceNode | null = null;
  let clickNota: AudioBuffer | null = null;
  let clickMetro: AudioBuffer | null = null;
  let reproduciendo = false;
  let baseMs = 0;
  let inicioCtx = 0;
  let velocidad = 1;
  let programadoNotasHasta = 0;
  let programadoMetroHasta = 0;
  let sonidoNotas = true;
  let metronomo = false;
  let hover: { col: Column; slot: number } | null = null;
  let arrastre: { col: Column; slotInicio: number; slotActual: number } | null = null;
  let arrastrandoBarra = false;
  let mostrarOnsets = true;
  let compensar = true;
  let taps: number[] = [];
  let eleccion: Eleccion | null = null;
  /**
   * Que seleccion tenia cada estado del historial al salir de el: deshacer o
   * rehacer devuelve tambien la seleccion de ese momento (deshacer un movimiento
   * deja elegidas las notas donde estaban, listas para probar de nuevo).
   */
  const eleccionPorEstado = new WeakMap<Note[], Eleccion | null>();
  /** Rectangulo de seleccion en curso (Mayus + arrastrar). Posiciones en px del canvas. */
  let caja: { slot0: number; col0: number; x0: number; y0: number; x: number; y: number } | null = null;

  const vista: Vista = { tiempo: sesion.tiempo, pxPorMs: sesion.pxPorMs, yCabezal: 400 };
  const notas = (): Note[] => sesion.historial.actual;
  const duracionMs = (): number => (sesion.buffer ? sesion.buffer.duration * 1000 : 0);

  // -- Armado del DOM ------------------------------------------------------

  const pantalla = el('div', 'tetra-mapeador');
  const panel = el('aside', 'tetra-mp-panel');
  const escena = el('section', 'tetra-mp-escena');
  pantalla.append(panel, escena);

  const estado = el('div', 'tetra-mp-estado');
  estado.setAttribute('role', 'status');
  function aviso(texto: string, tipo: 'info' | 'ok' | 'error' = 'info'): void {
    estado.textContent = texto;
    estado.dataset.tipo = tipo;
  }
  aviso('Carga un audio para empezar.');

  // Cabecera del panel.
  const cabecera = el('div', 'tetra-mp-cabecera');
  const volver = boton('← Menu', 'tetra-mp-volver');
  const nuevo = boton('Nuevo', 'tetra-mp-nuevo');
  nuevo.title = 'Empezar un mapa desde cero';
  cabecera.append(volver, el('h1', 'tetra-mp-titulo', 'Mapeador'), nuevo);

  // Cancion.
  const archivoEntrada = el('input');
  archivoEntrada.type = 'file';
  archivoEntrada.accept = 'audio/*,.mp3,.ogg,.wav,.flac,.m4a';
  archivoEntrada.className = 'tetra-mp-archivo';
  const archivoNombre = el('div', 'tetra-mp-archivo-nombre', 'Ningun audio cargado');
  const zonaAudio = el('div', 'tetra-mp-zona');
  zonaAudio.append(archivoNombre, archivoEntrada);
  const iTitulo = entradaTexto(sesion.meta.titulo, 'Titulo');
  const iArtista = entradaTexto(sesion.meta.artista, 'Artista');
  const iCreador = entradaTexto(sesion.meta.creador, 'Quien mapea');
  const iDificultad = entradaTexto(sesion.meta.dificultad, 'Normal');

  // Tempo y grilla.
  const iBpm = entradaNumero(sesion.grilla.bpm, 30, 400, 0.01);
  const iOffset = entradaNumero(Math.round(sesion.grilla.offsetMs), -5000, 600000, 1);
  const bDetectar = boton('Detectar BPM');
  const bFijarOffset = boton('Offset = cabezal');
  const bTap = boton('Tap tempo');
  const sDivisor = seleccion(
    DIVISORES.map((d) => [String(d), `1/${d}`] as [string, string]),
    String(sesion.grilla.divisor),
  );
  const filaBotonesTempo = el('div', 'tetra-mp-fila');
  filaBotonesTempo.append(bDetectar, bFijarOffset, bTap);

  // Automatico.
  const sNivel = seleccion(
    (Object.keys(PRESETS_AUTO) as NivelAuto[]).map((n) => [n, PRESETS_AUTO[n].nombre] as [string, string]),
    sesion.auto.nivel,
  );
  const iDensidad = el('input');
  iDensidad.type = 'range';
  iDensidad.min = '0.5';
  iDensidad.max = '1.5';
  iDensidad.step = '0.05';
  iDensidad.value = String(sesion.auto.densidad);
  const densidadValor = el('span', 'tetra-mp-valor', `${sesion.auto.densidad.toFixed(2)}x`);
  const cLargas = el('input');
  cLargas.type = 'checkbox';
  cLargas.checked = sesion.auto.largas;
  const iSemilla = entradaNumero(sesion.auto.semilla, 1, 99999, 1);
  const bGenerar = boton('Generar mapa automatico', 'tetra-boton-primario');
  const bAzar = boton('Otra variante');
  const bLimpiar = boton('Borrar todo');
  const bEspejar = boton('Espejar');
  const filaDensidad = el('div', 'tetra-mp-fila tetra-mp-fila-rango');
  filaDensidad.append(iDensidad, densidadValor);
  const filaAuto = el('div', 'tetra-mp-fila');
  filaAuto.append(bAzar, bEspejar, bLimpiar);

  // Dificultad del mapa.
  const iOd = entradaNumero(sesion.ajustes.overallDifficulty, 0, 10, 0.1);
  const iHp = entradaNumero(sesion.ajustes.hpDrain, 0, 10, 0.1);

  // Salida.
  const bProbar = boton('Probar el mapa', 'tetra-boton-primario');
  const bProbarAqui = boton('Probar desde el cabezal');
  // T-044: el bot perfecto juega el mapa en edicion (mismo camino que Probar). Si
  // no saca todo MAX, el problema esta en el mapa o en el motor.
  const bAuto = boton('Auto');
  bAuto.title = 'Un bot perfecto juega el mapa desde el inicio';
  const bAutoAqui = boton('Auto desde el cabezal');
  const filaAutoJuego = el('div', 'tetra-mp-fila');
  filaAutoJuego.append(bAuto, bAutoAqui);
  const bGuardar = boton('Guardar en la biblioteca');
  const bOsz = boton('Descargar .osz');
  const bOsu = boton('Descargar .osu');
  const filaDescargas = el('div', 'tetra-mp-fila');
  filaDescargas.append(bOsz, bOsu);

  panel.append(
    cabecera,
    tarjeta(
      'Cancion',
      zonaAudio,
      campo('Titulo', iTitulo),
      campo('Artista', iArtista),
      campo('Mapeador', iCreador),
      campo('Dificultad', iDificultad),
    ),
    tarjeta(
      'Tempo y rejilla',
      campo('BPM', iBpm),
      campo('Offset (ms)', iOffset, 'Instante del primer pulso'),
      filaBotonesTempo,
      campo('Rejilla', sDivisor, 'Atajos: [ y ]'),
    ),
    tarjeta(
      'Mapeo automatico',
      campo('Nivel', sNivel),
      campo('Densidad', filaDensidad),
      campo('Semilla', iSemilla, 'Misma semilla, mismo mapa'),
      (() => {
        const l = el('label', 'tetra-mp-casilla');
        l.append(cLargas, el('span', undefined, 'Incluir notas largas'));
        return l;
      })(),
      bGenerar,
      filaAuto,
    ),
    tarjeta('Dificultad del mapa', campo('OD', iOd), campo('HP', iHp)),
    tarjeta('Salida', bProbar, bProbarAqui, filaAutoJuego, bGuardar, filaDescargas),
    estado,
  );

  // Escena: barra de herramientas + canvas + barra de posicion.
  const barra = el('div', 'tetra-mp-barra');
  const bPlay = boton('Reproducir', 'tetra-mp-play');
  const sVelocidad = seleccion(
    [
      ['0.5', '0.5x'],
      ['0.75', '0.75x'],
      ['1', '1x'],
    ],
    '1',
  );
  const bDeshacer = boton('Deshacer');
  const bRehacer = boton('Rehacer');
  // T-034: seleccion. Todo tiene atajo; los botones son para quien prefiere el mouse.
  const grupoSeleccion = el('div', 'tetra-mp-seleccion-grupo');
  grupoSeleccion.setAttribute('role', 'group');
  grupoSeleccion.setAttribute('aria-label', 'Seleccion');
  grupoSeleccion.title =
    'Seleccion: Mayus + arrastrar sobre las pistas elige notas, Ctrl+A elige todo, Esc suelta. Alt + flechas mueve lo elegido un slot o una columna.';
  const bCopiar = boton('Copiar');
  bCopiar.title = 'Copiar lo elegido (Ctrl+C)';
  const bCortar = boton('Cortar');
  bCortar.title = 'Cortar lo elegido (Ctrl+X)';
  const bPegar = boton('Pegar');
  bPegar.title = 'Pegar en el cabezal, ajustado a la rejilla (Ctrl+V)';
  const bEliminar = boton('Eliminar');
  bEliminar.title = 'Eliminar lo elegido (Supr)';
  const bCuantizar = boton('Cuantizar');
  bCuantizar.title = 'Ajustar lo elegido a la rejilla actual (Q)';
  grupoSeleccion.append(bCopiar, bCortar, bPegar, bEliminar, bCuantizar);
  const cSonido = el('input');
  cSonido.type = 'checkbox';
  cSonido.checked = true;
  const lSonido = el('label', 'tetra-mp-casilla');
  lSonido.append(cSonido, el('span', undefined, 'Sonido de notas'));
  const cMetro = el('input');
  cMetro.type = 'checkbox';
  const lMetro = el('label', 'tetra-mp-casilla');
  lMetro.append(cMetro, el('span', undefined, 'Metronomo'));
  const cCompensar = el('input');
  cCompensar.type = 'checkbox';
  cCompensar.checked = true;
  const lCompensar = el('label', 'tetra-mp-casilla');
  lCompensar.title = 'Al grabar en vivo, resta el offset de calibracion y la latencia de salida del audio';
  lCompensar.append(cCompensar, el('span', undefined, 'Compensar latencia'));
  const cOnsets = el('input');
  cOnsets.type = 'checkbox';
  cOnsets.checked = true;
  const lOnsets = el('label', 'tetra-mp-casilla');
  lOnsets.append(cOnsets, el('span', undefined, 'Golpes detectados'));
  const iZoom = el('input');
  iZoom.type = 'range';
  iZoom.min = '0.08';
  iZoom.max = '1.2';
  iZoom.step = '0.01';
  iZoom.value = String(vista.pxPorMs);
  iZoom.className = 'tetra-mp-zoom';
  iZoom.setAttribute('aria-label', 'Zoom');
  const lectura = el('div', 'tetra-mp-lectura');
  const lecturaTiempo = el('span', 'tetra-mp-tiempo', '0:00.000');
  const lecturaNotas = el('span', 'tetra-mp-notas', '0 notas');
  const lecturaElegidas = el('span', 'tetra-mp-elegidas');
  lectura.append(lecturaTiempo, lecturaNotas, lecturaElegidas);
  barra.append(bPlay, sVelocidad, bDeshacer, bRehacer, grupoSeleccion, lSonido, lMetro, lCompensar, lOnsets, iZoom, lectura);

  const lienzoContenedor = el('div', 'tetra-mp-lienzo');
  const canvas = el('canvas', 'tetra-mp-canvas');
  lienzoContenedor.appendChild(canvas);
  const iPosicion = el('input');
  iPosicion.type = 'range';
  iPosicion.min = '0';
  iPosicion.max = '1';
  iPosicion.step = '1';
  iPosicion.value = '0';
  iPosicion.className = 'tetra-mp-posicion';
  iPosicion.setAttribute('aria-label', 'Posicion en la cancion');
  const ayuda = el(
    'div',
    'tetra-mp-ayuda',
    'Clic: poner o quitar nota. Arrastrar: nota larga. Clic derecho: quitar. Rueda: mover. Ctrl + rueda: zoom. Espacio: reproducir. D F J K: poner nota en el cabezal o grabar en vivo. Ctrl+Z / Ctrl+Y: deshacer y rehacer.',
  );
  // T-046: vista general. Dos lienzos apilados: el de fondo (onda, densidad de
  // notas, huecos, marcas) solo se redibuja cuando cambian las notas, el audio,
  // la grilla o el ancho; el de arriba (cabezal y zona visible) se dibuja por
  // frame y recibe el mouse.
  const minimapa = el('div', 'tetra-mp-minimapa');
  const lienzoMinFondo = el('canvas', 'tetra-mp-minimapa-fondo');
  const lienzoMinCabezal = el('canvas', 'tetra-mp-minimapa-cabezal');
  lienzoMinCabezal.setAttribute('aria-label', 'Minimapa de la cancion');
  lienzoMinCabezal.title =
    'Minimapa: clic o arrastre para saltar a ese instante. Barras blancas: notas. Onda: energia del audio. Ambar: mas de 8 compases sin notas.';
  minimapa.append(lienzoMinFondo, lienzoMinCabezal);
  escena.append(barra, lienzoContenedor, iPosicion, minimapa, ayuda);
  contenedor.appendChild(pantalla);

  // -- Estado derivado -----------------------------------------------------

  function sincronizarBotones(): void {
    bDeshacer.disabled = !sesion.historial.puedeDeshacer;
    bRehacer.disabled = !sesion.historial.puedeRehacer;
    const sinAudio = sesion.buffer === null;
    bPlay.disabled = sinAudio;
    bProbar.disabled = sinAudio || notas().length === 0;
    bProbarAqui.disabled = sinAudio || notas().length === 0;
    bAuto.disabled = sinAudio || notas().length === 0;
    bAutoAqui.disabled = sinAudio || notas().length === 0;
    bGuardar.disabled = sinAudio || notas().length === 0;
    bOsz.disabled = sinAudio || notas().length === 0;
    bOsu.disabled = notas().length === 0;
    bDetectar.disabled = sinAudio;
    bGenerar.disabled = sinAudio;
    bAzar.disabled = sinAudio;
    bPlay.textContent = reproduciendo ? 'Pausar' : 'Reproducir';
    const hayElegidas = elegidas().notas.length > 0;
    bCopiar.disabled = !hayElegidas;
    bCortar.disabled = !hayElegidas;
    bEliminar.disabled = !hayElegidas;
    bCuantizar.disabled = !hayElegidas;
    bPegar.disabled = portapapeles === null || portapapeles.notas.length === 0;
    lecturaElegidas.textContent = hayElegidas ? `${elegidas().notas.length} elegidas` : '';
    const r = resumirNotas(notas());
    lecturaNotas.textContent =
      r.total === 0
        ? '0 notas'
        : `${r.total} notas (${r.largas} largas), ${r.nps.toFixed(1)} por segundo`;
  }

  function guardarSesion(): void {
    sesion.tiempo = vista.tiempo;
    sesion.pxPorMs = vista.pxPorMs;
    // Una cancion que ya vive en la biblioteca no usa el borrador: ese borrador
    // reaparecería despues en una sesion nueva, sin audio y sin explicacion.
    if (sesion.base) return;
    guardarBorrador({
      version: 1,
      meta: sesion.meta,
      grilla: sesion.grilla,
      ajustes: sesion.ajustes,
      notas: notas(),
    });
  }

  /**
   * Las notas elegidas que siguen existiendo en el mapa (deshacer, borrar o
   * pegar encima pueden haber quitado algunas) y sus claves, para dibujar.
   * Se recalcula solo cuando cambia el arreglo de notas o la seleccion.
   */
  let cacheElegidas: { notas: Note[]; eleccion: Eleccion | null; lista: Note[]; claves: Set<string> } | null = null;
  function elegidas(): { notas: Note[]; claves: Set<string> } {
    if (!cacheElegidas || cacheElegidas.notas !== notas() || cacheElegidas.eleccion !== eleccion) {
      const lista = eleccion ? elegidasVigentes(notas(), eleccion.notas) : [];
      cacheElegidas = { notas: notas(), eleccion, lista, claves: new Set(lista.map(claveNota)) };
    }
    return { notas: cacheElegidas.lista, claves: cacheElegidas.claves };
  }

  function elegir(nueva: Eleccion | null): void {
    eleccion = nueva !== null && nueva.notas.length > 0 ? nueva : null;
    sincronizarBotones();
  }

  /**
   * Registra un estado nuevo del mapa: UN paso de historial, sea cual sea la
   * operacion, asi un Ctrl+Z la deshace entera. `nuevaEleccion` es la seleccion
   * que queda despues (por defecto la misma; las notas que ya no existan se
   * descartan solas).
   */
  function confirmarNotas(nuevas: Note[], nuevaEleccion: Eleccion | null = eleccion): void {
    eleccionPorEstado.set(notas(), eleccion);
    sesion.historial.registrar(nuevas);
    eleccion = nuevaEleccion;
    eleccionPorEstado.set(notas(), eleccion);
    guardarSesion();
    sincronizarBotones();
  }

  function leerMeta(): void {
    sesion.meta = {
      titulo: iTitulo.value,
      artista: iArtista.value,
      creador: iCreador.value,
      dificultad: iDificultad.value,
      audioArchivo: sesion.nombreAudio || sesion.meta.audioArchivo,
    };
    guardarSesion();
  }
  for (const i of [iTitulo, iArtista, iCreador, iDificultad]) i.addEventListener('input', leerMeta);

  function aplicarGrilla(cambios: Partial<Grilla>): void {
    sesion.grilla = { ...sesion.grilla, ...cambios };
    guardarSesion();
  }
  iBpm.addEventListener('change', () => {
    const v = leerNumero(iBpm.value);
    if (v !== null && v >= 30 && v <= 400) aplicarGrilla({ bpm: v });
    else iBpm.value = String(sesion.grilla.bpm);
  });
  iOffset.addEventListener('change', () => {
    const v = leerNumero(iOffset.value);
    if (v !== null) aplicarGrilla({ offsetMs: v });
    else iOffset.value = String(Math.round(sesion.grilla.offsetMs));
  });
  sDivisor.addEventListener('change', () => aplicarGrilla({ divisor: Number(sDivisor.value) }));
  iOd.addEventListener('change', () => {
    const v = leerNumero(iOd.value);
    if (v !== null) sesion.ajustes = { ...sesion.ajustes, overallDifficulty: Math.min(10, Math.max(0, v)) };
    guardarSesion();
  });
  iHp.addEventListener('change', () => {
    const v = leerNumero(iHp.value);
    if (v !== null) sesion.ajustes = { ...sesion.ajustes, hpDrain: Math.min(10, Math.max(0, v)) };
    guardarSesion();
  });

  function cambiarDivisor(paso: number): void {
    const i = DIVISORES.indexOf(sesion.grilla.divisor);
    const nuevo = DIVISORES[Math.min(DIVISORES.length - 1, Math.max(0, i + paso))];
    if (nuevo !== undefined) {
      aplicarGrilla({ divisor: nuevo });
      sDivisor.value = String(nuevo);
    }
  }

  // -- Audio ---------------------------------------------------------------

  function contexto(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
      clickNota = crearClick(ctx, 1500, 0.045);
      clickMetro = crearClick(ctx, 880, 0.06);
    }
    return ctx;
  }

  function crearClick(c: AudioContext, frecuencia: number, segundos: number): AudioBuffer {
    const largo = Math.round(c.sampleRate * segundos);
    const b = c.createBuffer(1, largo, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < largo; i++) {
      d[i] = Math.sin((2 * Math.PI * frecuencia * i) / c.sampleRate) * Math.exp((-i / largo) * 6) * 0.6;
    }
    return b;
  }

  /** Latencia de salida del audio en ms (0 si el navegador no la informa). */
  function latenciaSalidaMs(): number {
    return ctx && Number.isFinite(ctx.outputLatency) ? ctx.outputLatency * 1000 : 0;
  }

  function tiempoActual(): number {
    if (reproduciendo && ctx) {
      return baseMs + (ctx.currentTime - inicioCtx) * 1000 * velocidad;
    }
    return vista.tiempo;
  }

  function programarClick(buffer: AudioBuffer | null, cuando: number): void {
    if (!ctx || !buffer || cuando < ctx.currentTime) return;
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.connect(ctx.destination);
    s.start(cuando);
  }

  function arrancarFuente(desdeMs: number): void {
    const c = contexto();
    void c.resume();
    detenerFuente();
    if (!sesion.buffer) return;
    const f = c.createBufferSource();
    f.buffer = sesion.buffer;
    f.playbackRate.value = velocidad;
    f.connect(c.destination);
    baseMs = Math.max(0, desdeMs);
    inicioCtx = c.currentTime + 0.05;
    f.start(inicioCtx, baseMs / 1000);
    fuente = f;
    programadoNotasHasta = baseMs - 1;
    programadoMetroHasta = baseMs - 1;
  }

  function detenerFuente(): void {
    if (fuente) {
      try {
        fuente.stop();
      } catch {
        // ya estaba detenida.
      }
      fuente.disconnect();
      fuente = null;
    }
  }

  function reproducir(): void {
    if (!sesion.buffer || reproduciendo) return;
    if (vista.tiempo >= duracionMs() - 50) vista.tiempo = 0;
    arrancarFuente(vista.tiempo);
    reproduciendo = true;
    sincronizarBotones();
  }

  function pausar(): void {
    if (!reproduciendo) return;
    vista.tiempo = Math.min(tiempoActual(), duracionMs());
    reproduciendo = false;
    detenerFuente();
    sincronizarBotones();
    guardarSesion();
  }

  function alternarReproduccion(): void {
    if (reproduciendo) pausar();
    else reproducir();
  }

  function buscar(ms: number): void {
    const t = Math.min(Math.max(0, ms), duracionMs());
    vista.tiempo = t;
    if (reproduciendo) arrancarFuente(t);
  }

  function programarSonidos(): void {
    if (!reproduciendo || !ctx) return;
    const ahora = tiempoActual();
    const hasta = ahora + 300 * velocidad;
    const aMs = (ms: number): number => inicioCtx + (ms - baseMs) / (1000 * velocidad);
    if (sonidoNotas) {
      for (const n of notas()) {
        if (n.time > programadoNotasHasta && n.time <= hasta) programarClick(clickNota, aMs(n.time));
      }
    }
    programadoNotasHasta = hasta;
    if (metronomo) {
      const pulso = duracionPulso(sesion.grilla.bpm);
      const desde = Math.max(programadoMetroHasta, ahora - 1);
      const primero = Math.ceil((desde - sesion.grilla.offsetMs) / pulso);
      const ultimo = Math.floor((hasta - sesion.grilla.offsetMs) / pulso);
      for (let k = primero; k <= ultimo; k++) {
        const t = sesion.grilla.offsetMs + k * pulso;
        if (t > programadoMetroHasta) programarClick(clickMetro, aMs(t));
      }
    }
    programadoMetroHasta = hasta;
  }

  cSonido.addEventListener('change', () => {
    sonidoNotas = cSonido.checked;
  });
  cMetro.addEventListener('change', () => {
    metronomo = cMetro.checked;
  });
  cCompensar.addEventListener('change', () => {
    compensar = cCompensar.checked;
  });
  cOnsets.addEventListener('change', () => {
    mostrarOnsets = cOnsets.checked;
  });
  sVelocidad.addEventListener('change', () => {
    const v = Number(sVelocidad.value);
    const t = tiempoActual();
    velocidad = v;
    if (reproduciendo) arrancarFuente(t);
  });
  bPlay.addEventListener('click', alternarReproduccion);
  iZoom.addEventListener('input', () => {
    vista.pxPorMs = limitarZoom(Number(iZoom.value));
  });
  iPosicion.addEventListener('input', () => buscar(Number(iPosicion.value)));
  iPosicion.addEventListener('pointerdown', () => {
    arrastrandoBarra = true;
  });
  window.addEventListener('pointerup', () => {
    arrastrandoBarra = false;
  });

  // -- Cargar audio y analizar ---------------------------------------------

  async function cargarAudio(archivo: File): Promise<void> {
    try {
      await procesarAudio(await archivo.arrayBuffer(), archivo.name, { esNuevo: true });
    } catch (error) {
      aviso(`No se pudo leer el audio: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  /**
   * Decodifica, calcula la onda y analiza los golpes. `esNuevo` es true cuando
   * el usuario cargo un audio nuevo (se detecta el tempo y se propone el
   * titulo); es false al reabrir una cancion de la biblioteca, donde el BPM, el
   * offset y los datos del mapa ya vienen del chart y no se pisan.
   */
  async function procesarAudio(
    bytes: ArrayBuffer,
    nombre: string,
    opcionesProceso: { esNuevo: boolean },
  ): Promise<void> {
    pausar();
    aviso('Decodificando el audio...');
    const decodificador = new AudioContext();
    let buffer: AudioBuffer;
    try {
      buffer = await decodificador.decodeAudioData(bytes.slice(0));
    } finally {
      await decodificador.close();
    }
    sesion.nombreAudio = nombre;
    sesion.bytes = bytes;
    sesion.buffer = buffer;
    const canales: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) canales.push(buffer.getChannelData(c));
    const mono = mezclarMono(canales);
    sesion.picos = calcularPicos(mono, buffer.sampleRate, MS_POR_CUBETA);
    archivoNombre.textContent = `${nombre} (${formatoTiempo(buffer.duration * 1000)})`;
    iPosicion.max = String(Math.round(buffer.duration * 1000));
    if (opcionesProceso.esNuevo && iTitulo.value.trim() === '') {
      iTitulo.value = nombre.replace(/\.[^.]+$/, '');
    }
    leerMeta();
    vista.tiempo = 0;
    sincronizarBotones();
    aviso('Analizando los golpes del audio...');
    const { analisis, tempo } = await analizarAudio(mono, buffer.sampleRate);
    sesion.analisis = analisis;
    if (opcionesProceso.esNuevo) {
      aplicarTempo(tempo, false);
      aviso(
        `Listo. ${analisis.onsets.length} golpes detectados. Ajusta BPM y offset, y pulsa "Generar" o mapea a mano.`,
        'ok',
      );
    } else {
      aviso(`Audio listo. ${analisis.onsets.length} golpes detectados. Edita el mapa y guarda para reemplazar la dificultad.`, 'ok');
    }
    sincronizarBotones();
  }

  /** Reabre una dificultad de la biblioteca: carga el audio y el mapa tal cual estan guardados. */
  async function abrirDeLaBiblioteca(songId: string, nombreDificultad: string): Promise<void> {
    try {
      aviso('Abriendo la cancion de la biblioteca...');
      const cancion = await leerCancion(songId);
      const chart = cancion?.dificultades.find((d) => d.metadata.difficultyName === nombreDificultad);
      if (!cancion || !chart) {
        aviso('Esa dificultad ya no esta en la biblioteca.', 'error');
        return;
      }
      const primero = chart.timingPoints[0];
      sesion.base = {
        songId,
        timingPoints: chart.timingPoints,
        speedPoints: chart.speedPoints,
      };
      sesion.meta = {
        titulo: chart.metadata.title,
        artista: chart.metadata.artist,
        creador: chart.metadata.creator,
        dificultad: chart.metadata.difficultyName,
        audioArchivo: chart.metadata.audioFile,
      };
      sesion.grilla = {
        bpm: primero?.bpm ?? 120,
        offsetMs: primero?.time ?? 0,
        divisor: sesion.grilla.divisor,
      };
      sesion.ajustes = { overallDifficulty: chart.overallDifficulty, hpDrain: chart.hpDrain };
      sesion.historial = crearHistorial<Note[]>([...chart.notes]);
      iTitulo.value = sesion.meta.titulo;
      iArtista.value = sesion.meta.artista;
      iCreador.value = sesion.meta.creador;
      iDificultad.value = sesion.meta.dificultad;
      iBpm.value = String(sesion.grilla.bpm);
      iOffset.value = String(Math.round(sesion.grilla.offsetMs));
      iOd.value = String(sesion.ajustes.overallDifficulty);
      iHp.value = String(sesion.ajustes.hpDrain);
      sincronizarBotones();
      await procesarAudio(await cancion.audio.arrayBuffer(), chart.metadata.audioFile, { esNuevo: false });
      if (chart.timingPoints.length > 1 || chart.speedPoints.length > 0) {
        aviso(
          `Abierta. Esta dificultad tiene ${chart.timingPoints.length} puntos de tempo y ${chart.speedPoints.length} de velocidad: el editor usa el primer tempo y conserva los demas al guardar.`,
          'info',
        );
      }
    } catch (error) {
      aviso(`No se pudo abrir la cancion: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  function detectarTempo(avisar: boolean): void {
    if (!sesion.analisis) return;
    aplicarTempo(estimarTempo(sesion.analisis), avisar);
  }

  function aplicarTempo(t: EstimacionTempo | null, avisar: boolean): void {
    if (!t) {
      if (avisar) aviso('No se pudo estimar el tempo: pon el BPM a mano o usa "Tap tempo".', 'error');
      return;
    }
    aplicarGrilla({ bpm: t.bpmSugerido, offsetMs: Math.round(t.offsetMs) });
    iBpm.value = String(t.bpmSugerido);
    iOffset.value = String(Math.round(t.offsetMs));
    if (avisar) {
      aviso(
        `BPM ${t.bpmSugerido}, offset ${Math.round(t.offsetMs)} ms (confianza ${Math.round(t.confianza * 100)}%). Verifica de oido con el metronomo.`,
        t.confianza > 0.5 ? 'ok' : 'info',
      );
    }
  }

  archivoEntrada.addEventListener('change', () => {
    const f = archivoEntrada.files?.[0];
    if (f) void cargarAudio(f);
  });
  for (const zona of [zonaAudio, pantalla]) {
    zona.addEventListener('dragover', (e) => e.preventDefault());
  }
  pantalla.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f) void cargarAudio(f);
  });

  bDetectar.addEventListener('click', () => detectarTempo(true));
  bFijarOffset.addEventListener('click', () => {
    const t = Math.round(tiempoActual());
    aplicarGrilla({ offsetMs: t });
    iOffset.value = String(t);
    aviso(`Offset fijado en ${t} ms: el primer pulso cae donde esta el cabezal.`, 'ok');
  });
  bTap.addEventListener('click', (e) => {
    // event.timeStamp, no el momento en que corre el handler (CLAUDE.md, regla 1).
    const ahora = e.timeStamp;
    if (taps.length > 0 && ahora - taps[taps.length - 1]! > 2000) taps = [];
    taps.push(ahora);
    taps = taps.slice(-12);
    if (taps.length >= 3) {
      const intervalo = (taps[taps.length - 1]! - taps[0]!) / (taps.length - 1);
      const bpm = Math.round((60000 / intervalo) * 10) / 10;
      if (bpm >= 30 && bpm <= 400) {
        aplicarGrilla({ bpm });
        iBpm.value = String(bpm);
        aviso(`Tap tempo: ${bpm} BPM`, 'info');
      }
    } else {
      aviso('Sigue tocando el pulso...', 'info');
    }
  });

  // -- Generar, editar -----------------------------------------------------

  iDensidad.addEventListener('input', () => {
    sesion.auto.densidad = Number(iDensidad.value);
    densidadValor.textContent = `${sesion.auto.densidad.toFixed(2)}x`;
  });
  sNivel.addEventListener('change', () => {
    sesion.auto.nivel = sNivel.value as NivelAuto;
  });
  cLargas.addEventListener('change', () => {
    sesion.auto.largas = cLargas.checked;
  });
  iSemilla.addEventListener('change', () => {
    sesion.auto.semilla = Math.max(1, Math.round(leerNumero(iSemilla.value) ?? 1));
  });

  function generar(): void {
    if (!sesion.analisis) {
      aviso('Primero carga un audio.', 'error');
      return;
    }
    const generadas = generarNotas(sesion.analisis.onsets, sesion.grilla, {
      nivel: sesion.auto.nivel,
      densidad: sesion.auto.densidad,
      notasLargas: sesion.auto.largas,
      semilla: sesion.auto.semilla,
    });
    const preset = PRESETS_AUTO[sesion.auto.nivel];
    sesion.ajustes = { overallDifficulty: preset.overallDifficulty, hpDrain: preset.hpDrain };
    iOd.value = String(preset.overallDifficulty);
    iHp.value = String(preset.hpDrain);
    if (iDificultad.value.trim() === '' || Object.values(PRESETS_AUTO).some((p) => p.nombre === iDificultad.value)) {
      iDificultad.value = preset.nombre;
      leerMeta();
    }
    confirmarNotas(generadas);
    const r = resumirNotas(generadas);
    aviso(
      `${r.total} notas generadas (${r.nps.toFixed(1)} por segundo). Se puede deshacer con Ctrl+Z y retocar a mano.`,
      'ok',
    );
  }
  bGenerar.addEventListener('click', generar);
  bAzar.addEventListener('click', () => {
    sesion.auto.semilla = 1 + Math.floor(Math.random() * 99999);
    iSemilla.value = String(sesion.auto.semilla);
    generar();
  });
  bEspejar.addEventListener('click', () => {
    confirmarNotas(espejar(notas()));
    aviso('Columnas espejadas.', 'info');
  });
  bLimpiar.addEventListener('click', () => {
    if (notas().length === 0) return;
    confirmarNotas([]);
    aviso('Mapa vaciado. Se puede deshacer con Ctrl+Z.', 'info');
  });
  bDeshacer.addEventListener('click', () => deshacer());
  bRehacer.addEventListener('click', () => rehacer());

  function deshacer(): void {
    eleccionPorEstado.set(notas(), eleccion);
    sesion.historial.deshacer();
    eleccion = eleccionPorEstado.get(notas()) ?? null;
    guardarSesion();
    sincronizarBotones();
  }
  function rehacer(): void {
    eleccionPorEstado.set(notas(), eleccion);
    sesion.historial.rehacer();
    eleccion = eleccionPorEstado.get(notas()) ?? null;
    guardarSesion();
    sincronizarBotones();
  }

  // -- Seleccion, copiar, pegar y mover (T-034) -----------------------------

  /** Opciones de copiarNotas segun como se eligio (ver Eleccion). */
  function opcionesDeCopia(): { origen?: number; duracion?: number } {
    return {
      ...(eleccion !== null && eleccion.origen !== null && { origen: eleccion.origen }),
      ...(eleccion !== null && eleccion.duracion !== null && { duracion: eleccion.duracion }),
    };
  }

  function copiarSeleccion(): boolean {
    const lista = elegidas().notas;
    if (lista.length === 0) {
      aviso('No hay notas elegidas. Mayus + arrastrar sobre las pistas las elige, Ctrl+A elige todo.', 'info');
      return false;
    }
    portapapeles = copiarNotas(lista, opcionesDeCopia());
    sincronizarBotones();
    aviso(`${lista.length} notas copiadas. Ctrl+V las pega en el cabezal.`, 'ok');
    return true;
  }

  function cortarSeleccion(): void {
    const lista = elegidas().notas;
    if (!copiarSeleccion()) return;
    confirmarNotas(quitarNotas(notas(), lista), null);
    aviso(`${lista.length} notas cortadas. Ctrl+V las pega, Ctrl+Z las devuelve.`, 'ok');
  }

  function eliminarSeleccion(): void {
    const lista = elegidas().notas;
    if (lista.length === 0) return;
    confirmarNotas(quitarNotas(notas(), lista), null);
    aviso(`${lista.length} notas eliminadas. Se puede deshacer con Ctrl+Z.`, 'info');
  }

  function pegarEnCabezal(): void {
    if (!portapapeles || portapapeles.notas.length === 0) {
      aviso('No hay nada copiado.', 'info');
      return;
    }
    // El cabezal se ajusta al slot mas cercano: el origen de lo copiado cae en la rejilla.
    const enMs = tiempoDeSlotEntero(sesion.grilla, slotMasCercano(sesion.grilla, tiempoActual()));
    const colocadas = desplazarNotas(portapapeles.notas, enMs);
    if (!colocadas) {
      aviso('No se pega: alguna nota quedaria antes del inicio de la cancion.', 'error');
      return;
    }
    if (duracionMs() > 0 && pasaDelFinal(colocadas, duracionMs())) {
      aviso('No se pega: alguna nota quedaria despues del final de la cancion. Mueve el cabezal antes.', 'error');
      return;
    }
    confirmarNotas(pegarNotas(notas(), portapapeles, enMs), {
      notas: colocadas,
      origen: enMs,
      duracion: portapapeles.duracion,
    });
    aviso(`${colocadas.length} notas pegadas en ${formatoTiempo(enMs)}. Alt + flechas las mueve, Ctrl+Z las quita.`, 'ok');
  }

  /** Mueve lo elegido `slots` slots en el tiempo (positivo = mas tarde) y `columnas` carriles. */
  function moverSeleccion(slots: number, columnas: number): void {
    const lista = elegidas().notas;
    const primera = lista[0];
    if (!primera || !eleccion) return;
    // Un solo desplazamiento para todas (la frase no se deforma), calculado
    // desde la primera nota para que esta caiga exacta en un slot.
    const g = sesion.grilla;
    const slot = slotMasCercano(g, primera.time);
    const dMs = tiempoDeSlotEntero(g, slot + slots) - tiempoDeSlotEntero(g, slot);
    const movidas = desplazarNotas(lista, dMs, columnas);
    if (!movidas) {
      aviso(
        columnas !== 0 ? 'No se mueve: una nota saldria de las cuatro pistas.' : 'No se mueve: una nota quedaria antes del inicio.',
        'info',
      );
      return;
    }
    if (duracionMs() > 0 && pasaDelFinal(movidas, duracionMs())) {
      aviso('No se mueve: una nota quedaria despues del final de la cancion.', 'info');
      return;
    }
    confirmarNotas(moverNotas(notas(), lista, dMs, columnas), {
      notas: movidas,
      origen: eleccion.origen === null ? null : eleccion.origen + dMs,
      duracion: eleccion.duracion,
    });
  }

  function cuantizarSeleccion(): void {
    const lista = elegidas().notas;
    if (lista.length === 0) {
      aviso('No hay notas elegidas para cuantizar.', 'info');
      return;
    }
    const ajustadas = cuantizadas(lista, sesion.grilla);
    if (ajustadas.every((n, i) => claveNota(n) === claveNota(lista[i]!))) {
      aviso('Las notas elegidas ya estaban en la rejilla.', 'info');
      return;
    }
    confirmarNotas(cuantizarNotas(notas(), lista, sesion.grilla), {
      notas: ajustadas,
      origen: eleccion?.origen ?? null,
      duracion: eleccion?.duracion ?? null,
    });
    aviso(`${lista.length} notas ajustadas a la rejilla 1/${sesion.grilla.divisor}.`, 'ok');
  }

  function elegirTodo(): void {
    if (notas().length === 0) return;
    elegir({ notas: [...notas()], origen: null, duracion: null });
    aviso(`${notas().length} notas elegidas.`, 'info');
  }

  bCopiar.addEventListener('click', () => void copiarSeleccion());
  bCortar.addEventListener('click', cortarSeleccion);
  bPegar.addEventListener('click', pegarEnCabezal);
  bEliminar.addEventListener('click', eliminarSeleccion);
  bCuantizar.addEventListener('click', cuantizarSeleccion);

  // -- Salida --------------------------------------------------------------

  function chartActual(): ReturnType<typeof construirChart> {
    leerMeta();
    return construirChart(
      { ...sesion.meta, audioArchivo: sesion.nombreAudio || sesion.meta.audioArchivo || 'audio.mp3' },
      sesion.grilla,
      sesion.ajustes,
      notas(),
      Math.min(duracionMs() * 0.3, notas()[0]?.time ?? 0),
      sesion.base ?? undefined,
    );
  }

  function entradaOsz(): Parameters<typeof construirOsz>[0] | null {
    if (!sesion.bytes || !sesion.nombreAudio) return null;
    const chart = chartActual();
    return {
      titulo: chart.metadata.title,
      artista: chart.metadata.artist,
      creador: chart.metadata.creator,
      audioNombre: chart.metadata.audioFile,
      audio: new Uint8Array(sesion.bytes),
      dificultades: [{ version: chart.metadata.difficultyName, texto: escribirOsu(chart) }],
    };
  }

  bOsu.addEventListener('click', () => {
    const chart = chartActual();
    descargar(`${nombreDeArchivoBase(sesion.meta)}.osu`, escribirOsu(chart), 'text/plain');
    aviso('Descargado el .osu. Para abrirlo en osu! hace falta el audio en la misma carpeta.', 'ok');
  });
  bOsz.addEventListener('click', () => {
    const entrada = entradaOsz();
    if (!entrada) return;
    descargar(`${nombreDeArchivoBase(sesion.meta)}.osz`, new Uint8Array(construirOsz(entrada)), 'application/zip');
    aviso('Descargado el .osz con el audio incluido.', 'ok');
  });
  bGuardar.addEventListener('click', async () => {
    const entrada = entradaOsz();
    if (!entrada) return;
    bGuardar.disabled = true;
    try {
      const chart = chartActual();
      const nombre = chart.metadata.difficultyName;
      let mensaje: string;
      if (sesion.base) {
        // La cancion ya esta en la biblioteca: se reemplaza esa dificultad o se
        // agrega una nueva si se cambio el nombre. No se crea otra cancion.
        const previa = await leerCancion(sesion.base.songId);
        const existia = previa?.dificultades.some((d) => d.metadata.difficultyName === nombre) ?? false;
        await guardarDificultad(sesion.base.songId, chart);
        mensaje = existia
          ? `Dificultad "${nombre}" reemplazada en la biblioteca.`
          : `Dificultad "${nombre}" agregada a la cancion en la biblioteca.`;
      } else {
        const id = await guardarCancionCreada(entrada);
        sesion.base = { songId: id, timingPoints: chart.timingPoints, speedPoints: chart.speedPoints };
        mensaje =
          'Guardado en la biblioteca. Para otra dificultad de la misma cancion, cambia el nombre en "Dificultad" y vuelve a guardar.';
      }
      borrarBorrador();
      aviso(mensaje, 'ok');
      const ir = boton('Ir al song select', 'tetra-boton-primario');
      ir.addEventListener('click', () => salir(opciones.aSongSelect));
      estado.appendChild(document.createElement('br'));
      estado.appendChild(ir);
    } catch (error) {
      const texto = error instanceof Error ? error.message : String(error);
      if (sesion.base && texto.includes('ya no esta en la biblioteca')) {
        // Se borro la cancion desde otro lado: la proxima vez se crea de nuevo.
        sesion.base = null;
        aviso('La cancion se borro de la biblioteca. Pulsa "Guardar" otra vez para crearla de nuevo.', 'error');
      } else {
        aviso(`No se pudo guardar: ${texto}`, 'error');
      }
    } finally {
      sincronizarBotones();
    }
  });
  /**
   * Juega el mapa (entero o desde `inicioMs`) y vuelve al editor. T-044: con
   * `auto` lo juega el bot perfecto (`replayPerfecto`) en vez de la persona; el
   * replay se genera sobre las notas que se juegan (las del cabezal en adelante),
   * asi no hay eventos de notas que no existen en la partida.
   */
  async function probar(inicioMs: number, auto = false): Promise<void> {
    if (!sesion.buffer) return;
    pausar();
    const chart = chartActual();
    if (inicioMs > 0 && !chart.notes.some((n) => n.time >= inicioMs)) {
      aviso('No hay notas despues del cabezal: mueve el cabezal antes de la ultima nota.', 'error');
      return;
    }
    guardarSesion();
    limpiarEscena();
    const opcionesPartida: OpcionesPartida = {
      inicioMs,
      ...(auto && {
        reproducir: { replay: replayPerfecto(filtrarNotasDesde(chart, inicioMs)), modo: 'auto' as const },
      }),
    };
    let resultado = await runGame(chart, sesion.buffer, undefined, opcionesPartida);
    while (resultado.estado === 'reintentar') {
      resultado = await runGame(chart, sesion.buffer, undefined, opcionesPartida);
    }
    // Sin `abrir`: ya hay una sesion en curso y reabrir de la biblioteca la pisaria.
    const volverAlEditor = (): void => mostrarMapeador(raiz, sinAbrir(opciones));
    if (resultado.estado === 'completado') {
      const b = boton('Volver al mapeador', 'tetra-resultados-volver-song-select');
      b.addEventListener('click', volverAlEditor);
      raiz.appendChild(b);
    } else {
      volverAlEditor();
    }
  }
  bProbar.addEventListener('click', () => void probar(0));
  bProbarAqui.addEventListener('click', () => void probar(Math.round(tiempoActual())));
  bAuto.addEventListener('click', () => void probar(0, true));
  bAutoAqui.addEventListener('click', () => void probar(Math.round(tiempoActual()), true));

  // -- Dibujo ---------------------------------------------------------------

  const ctx2d = canvas.getContext('2d');
  let ancho = 0;
  let alto = 0;
  const observador = new ResizeObserver(() => {
    const caja = lienzoContenedor.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    ancho = Math.max(200, Math.floor(caja.width));
    alto = Math.max(200, Math.floor(caja.height));
    canvas.width = Math.floor(ancho * dpr);
    canvas.height = Math.floor(alto * dpr);
    canvas.style.width = `${ancho}px`;
    canvas.style.height = `${alto}px`;
    ctx2d?.setTransform(dpr, 0, 0, dpr, 0, 0);
    vista.yCabezal = Math.round(alto * 0.8);
  });
  observador.observe(lienzoContenedor);

  function geometria(): { izquierda: number; anchoCol: number } {
    const anchoCol = Math.min(ANCHO_COLUMNA_MAX, Math.floor(ancho / 6));
    return { izquierda: Math.floor((ancho - anchoCol * 4) / 2), anchoCol };
  }

  function dibujar(): void {
    if (!ctx2d) return;
    const g = ctx2d;
    const { izquierda, anchoCol } = geometria();
    const anchoPistas = anchoCol * 4;
    const t = tiempoActual();
    if (reproduciendo) {
      vista.tiempo = t;
      if (t >= duracionMs()) pausar();
    }
    // El futuro esta arriba: y = 0 es el instante MAS TARDIO visible.
    const tMin = tiempoDeY(vista, alto);
    const tMax = tiempoDeY(vista, 0);

    g.clearRect(0, 0, ancho, alto);
    g.fillStyle = '#0b0e11';
    g.fillRect(0, 0, ancho, alto);

    // Pistas.
    for (let c = 0; c < 4; c++) {
      g.fillStyle = c % 2 === 0 ? 'rgba(19,26,31,0.9)' : 'rgba(15,21,25,0.9)';
      g.fillRect(izquierda + c * anchoCol, 0, anchoCol, alto);
    }

    // Onda de audio detras de las pistas.
    if (sesion.picos) {
      g.fillStyle = 'rgba(63,216,194,0.16)';
      const centro = izquierda + anchoPistas / 2;
      for (let y = 0; y < alto; y += 2) {
        const idx = Math.floor(tiempoDeY(vista, y) / MS_POR_CUBETA);
        const a = sesion.picos[idx];
        if (a === undefined || idx < 0) continue;
        const media = Math.min(1, a * 1.3) * anchoPistas * 0.5;
        g.fillRect(centro - media, y, media * 2, 2);
      }
    }

    // Rejilla.
    const lineas = lineasDeGrilla(sesion.grilla, tMin, tMax);
    const demasiadas = lineas.length > 800;
    g.font = '11px "JetBrains Mono", monospace';
    g.textBaseline = 'middle';
    let compas = 0;
    for (const l of lineas) {
      if (l.tipo === 0 && demasiadas) continue;
      const y = Math.round(yDeTiempo(vista, l.time)) + 0.5;
      g.strokeStyle =
        l.tipo === 2 ? 'rgba(231,238,240,0.38)' : l.tipo === 1 ? 'rgba(231,238,240,0.18)' : 'rgba(231,238,240,0.07)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(izquierda, y);
      g.lineTo(izquierda + anchoPistas, y);
      g.stroke();
      if (l.tipo === 2) {
        compas++;
        g.fillStyle = 'rgba(157,170,178,0.9)';
        g.textAlign = 'right';
        g.fillText(formatoTiempo(l.time).slice(0, -2), izquierda - 10, y);
      }
    }
    void compas;

    // Divisiones de pista.
    g.strokeStyle = 'rgba(38,49,57,1)';
    for (let c = 0; c <= 4; c++) {
      const x = izquierda + c * anchoCol + 0.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, alto);
      g.stroke();
    }

    // Golpes detectados (ticks a la derecha de las pistas).
    if (mostrarOnsets && sesion.analisis) {
      for (const o of sesion.analisis.onsets) {
        if (o.time < tMin || o.time > tMax) continue;
        const y = yDeTiempo(vista, o.time);
        g.fillStyle = `rgba(232,184,74,${0.25 + o.fuerza * 0.6})`;
        const largo = 6 + o.fuerza * 22;
        g.fillRect(izquierda + anchoPistas + 8, y - 1, largo, 2);
      }
    }

    // Notas. Las elegidas (o las que caen dentro del rectangulo que se esta
    // arrastrando) van en ambar con un borde claro.
    const altoNota = 16;
    const cajaVista = caja ? rectanguloDeCaja(caja) : null;
    const marcadas = cajaVista
      ? new Set(notasEnSeleccion(notas(), cajaVista.seleccion).map(claveNota))
      : elegidas().claves;
    for (const n of notas()) {
      const fin = n.kind === 'hold' ? n.endTime : n.time;
      if (fin < tMin - 100 || n.time > tMax + 100) continue;
      const x = izquierda + n.column * anchoCol + 5;
      const w = anchoCol - 10;
      const yInicio = yDeTiempo(vista, n.time);
      const pasada = fin < t;
      const elegida = marcadas.size > 0 && marcadas.has(claveNota(n));
      const color = elegida ? COLOR_AMBAR : n.column === 0 || n.column === 3 ? COLOR_ACENTO : COLOR_TINTA;
      g.globalAlpha = pasada ? 0.35 : 1;
      if (n.kind === 'hold') {
        const yFin = yDeTiempo(vista, n.endTime);
        g.fillStyle = color;
        g.globalAlpha = (pasada ? 0.35 : 1) * 0.35;
        g.fillRect(x + 6, yFin, w - 12, yInicio - yFin);
        g.globalAlpha = pasada ? 0.35 : 1;
        g.fillRect(x, yFin - 4, w, 8);
      }
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x, yInicio - altoNota / 2, w, altoNota, 4);
      g.fill();
      if (elegida) {
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    // Rectangulo de seleccion en curso, alineado a los slots.
    if (cajaVista) {
      const x0 = izquierda + cajaVista.colA * anchoCol;
      const y0 = yDeTiempo(vista, tiempoDeSlotEntero(sesion.grilla, cajaVista.slotB)) - 8;
      const y1 = yDeTiempo(vista, tiempoDeSlotEntero(sesion.grilla, cajaVista.slotA)) + 8;
      g.fillStyle = 'rgba(232,184,74,0.12)';
      g.fillRect(x0, y0, (cajaVista.colB - cajaVista.colA + 1) * anchoCol, y1 - y0);
      g.strokeStyle = COLOR_AMBAR;
      g.lineWidth = 1;
      g.setLineDash([5, 4]);
      g.strokeRect(x0 + 0.5, y0 + 0.5, (cajaVista.colB - cajaVista.colA + 1) * anchoCol - 1, y1 - y0 - 1);
      g.setLineDash([]);
    }

    // Fantasma bajo el mouse y arrastre en curso.
    if (arrastre) {
      const a = Math.min(arrastre.slotInicio, arrastre.slotActual);
      const b = Math.max(arrastre.slotInicio, arrastre.slotActual);
      const yA = yDeTiempo(vista, tiempoDeSlotEntero(sesion.grilla, a));
      const yB = yDeTiempo(vista, tiempoDeSlotEntero(sesion.grilla, b));
      g.fillStyle = 'rgba(232,184,74,0.45)';
      g.fillRect(izquierda + arrastre.col * anchoCol + 5, yB - altoNota / 2, anchoCol - 10, yA - yB + altoNota);
    } else if (hover) {
      const y = yDeTiempo(vista, tiempoDeSlotEntero(sesion.grilla, hover.slot));
      g.fillStyle = 'rgba(232,184,74,0.35)';
      g.beginPath();
      g.roundRect(izquierda + hover.col * anchoCol + 5, y - altoNota / 2, anchoCol - 10, altoNota, 4);
      g.fill();
    }

    // Lo que ya paso, atenuado, y el cabezal.
    g.fillStyle = 'rgba(11,14,17,0.45)';
    g.fillRect(izquierda, vista.yCabezal, anchoPistas, alto - vista.yCabezal);
    g.strokeStyle = COLOR_ACENTO;
    g.lineWidth = 2;
    g.shadowColor = COLOR_ACENTO;
    g.shadowBlur = 10;
    g.beginPath();
    g.moveTo(izquierda - 18, vista.yCabezal);
    g.lineTo(izquierda + anchoPistas + 18, vista.yCabezal);
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = COLOR_AMBAR;
    g.beginPath();
    g.moveTo(izquierda - 18, vista.yCabezal - 6);
    g.lineTo(izquierda - 6, vista.yCabezal);
    g.lineTo(izquierda - 18, vista.yCabezal + 6);
    g.closePath();
    g.fill();

    // Lecturas.
    lecturaTiempo.textContent = `${formatoTiempo(t)} / ${formatoTiempo(duracionMs())}`;
    if (!arrastrandoBarra) iPosicion.value = String(Math.round(Math.min(t, duracionMs())));
    actualizarMinimapa(t, tMin, tMax);
  }

  // -- Minimapa (T-046) -----------------------------------------------------

  const ctxMinFondo = lienzoMinFondo.getContext('2d');
  const ctxMinCabezal = lienzoMinCabezal.getContext('2d');
  let minAncho = 0;
  let minAlto = 0;
  /** De que depende el lienzo de fondo: si nada cambio, no se redibuja. */
  let firmaMin: {
    notas: Note[];
    picos: Float32Array | null;
    ancho: number;
    alto: number;
    duracion: number;
    bpm: number;
    offset: number;
  } | null = null;
  /** Lo ultimo que se dibujo en el lienzo del cabezal (px), para no repintar igual. */
  let ultimoCabezalMin = { x: -1, a: -1, b: -1, ancho: -1, alto: -1 };

  const observadorMin = new ResizeObserver(() => {
    // clientWidth/clientHeight: el area de adentro del borde, donde caben los lienzos.
    const dpr = window.devicePixelRatio || 1;
    minAncho = Math.max(0, minimapa.clientWidth);
    minAlto = Math.max(0, minimapa.clientHeight);
    for (const [lienzo, c2d] of [
      [lienzoMinFondo, ctxMinFondo],
      [lienzoMinCabezal, ctxMinCabezal],
    ] as const) {
      lienzo.width = Math.floor(minAncho * dpr);
      lienzo.height = Math.floor(minAlto * dpr);
      lienzo.style.width = `${minAncho}px`;
      lienzo.style.height = `${minAlto}px`;
      c2d?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    // Cambiar el tamano de un lienzo lo borra: hay que dibujar los dos de nuevo.
    firmaMin = null;
    ultimoCabezalMin = { x: -1, a: -1, b: -1, ancho: -1, alto: -1 };
  });
  observadorMin.observe(minimapa);

  /** Una cubeta por pixel de ancho: onda al fondo, notas encima, huecos en ambar y marcas cada 8 compases. */
  function dibujarFondoMinimapa(): void {
    const g = ctxMinFondo;
    if (!g || minAncho <= 0 || minAlto <= 0) return;
    const w = minAncho;
    const h = minAlto;
    const dur = duracionMs();
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0b0e11';
    g.fillRect(0, 0, w, h);
    if (!(dur > 0)) return;

    const cubetas = resumirParaMinimapa(notas(), sesion.picos ?? new Float32Array(0), MS_POR_CUBETA, dur, w);
    let maxDensidad = 1;
    for (const c of cubetas) maxDensidad = Math.max(maxDensidad, c.densidadNotas);

    // Huecos grandes sin notas (mas de 8 compases): un velo y una linea arriba.
    const ocho = 8 * 4 * duracionPulso(sesion.grilla.bpm);
    for (const hueco of huecosSinNotas(notas(), dur, ocho)) {
      const x0 = Math.floor(xDeTiempoMinimapa(hueco.desde, w, dur));
      const x1 = Math.ceil(xDeTiempoMinimapa(hueco.hasta, w, dur));
      g.fillStyle = 'rgba(232,184,74,0.16)';
      g.fillRect(x0, 0, x1 - x0, h);
      g.fillStyle = 'rgba(232,184,74,0.95)';
      g.fillRect(x0, 0, x1 - x0, 3);
    }

    // Onda de energia, simetrica; la raiz hace visibles los pasajes suaves.
    g.fillStyle = 'rgba(63,216,194,0.38)';
    const medio = h / 2;
    for (let i = 0; i < cubetas.length; i++) {
      const mitad = Math.sqrt(cubetas[i]!.energia) * (medio - 2);
      if (mitad > 0) g.fillRect(i, medio - mitad, 1, mitad * 2);
    }

    // Densidad de notas desde abajo.
    g.fillStyle = 'rgba(231,238,240,0.9)';
    for (let i = 0; i < cubetas.length; i++) {
      const c = cubetas[i]!;
      if (!c.hayNotas) continue;
      const alturaBarra = Math.max(2, (c.densidadNotas / maxDensidad) * (h - 8));
      // 2 px de ancho: una nota suelta sigue viendose en una cancion larga.
      g.fillRect(i, h - alturaBarra, 2, alturaBarra);
    }

    // Marcas de compas cada 8 compases, con el numero si hay lugar.
    const separacion = xDeTiempoMinimapa(ocho, w, dur);
    g.font = '10px "JetBrains Mono", monospace';
    g.textBaseline = 'top';
    g.textAlign = 'left';
    for (const m of marcasDeCompas(sesion.grilla, dur)) {
      const x = Math.round(xDeTiempoMinimapa(m.time, w, dur)) + 0.5;
      g.strokeStyle = 'rgba(231,238,240,0.28)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      if (separacion >= 34) {
        g.fillStyle = 'rgba(157,170,178,0.95)';
        g.fillText(String(m.compas), x + 3, 5);
      }
    }
  }

  /** Zona visible del editor y cabezal sobre la franja, en su propio lienzo para repintar poco. */
  function dibujarCabezalMinimapa(t: number, tMin: number, tMax: number): void {
    const g = ctxMinCabezal;
    if (!g || minAncho <= 0 || minAlto <= 0) return;
    const dur = duracionMs();
    const x = Math.round(xDeTiempoMinimapa(t, minAncho, dur));
    const a = Math.round(xDeTiempoMinimapa(tMin, minAncho, dur));
    const b = Math.round(xDeTiempoMinimapa(tMax, minAncho, dur));
    const u = ultimoCabezalMin;
    if (u.x === x && u.a === a && u.b === b && u.ancho === minAncho && u.alto === minAlto) return;
    ultimoCabezalMin = { x, a, b, ancho: minAncho, alto: minAlto };
    g.clearRect(0, 0, minAncho, minAlto);
    if (!(dur > 0)) return;
    g.fillStyle = 'rgba(231,238,240,0.13)';
    g.fillRect(a, 0, Math.max(2, b - a), minAlto);
    g.strokeStyle = 'rgba(231,238,240,0.55)';
    g.lineWidth = 1;
    g.strokeRect(a + 0.5, 0.5, Math.max(2, b - a) - 1, minAlto - 1);
    g.fillStyle = COLOR_ACENTO;
    g.fillRect(Math.min(minAncho - 2, x), 0, 2, minAlto);
  }

  function actualizarMinimapa(t: number, tMin: number, tMax: number): void {
    const dur = duracionMs();
    const f = firmaMin;
    if (
      !f ||
      f.notas !== notas() ||
      f.picos !== sesion.picos ||
      f.ancho !== minAncho ||
      f.alto !== minAlto ||
      f.duracion !== dur ||
      f.bpm !== sesion.grilla.bpm ||
      f.offset !== sesion.grilla.offsetMs
    ) {
      firmaMin = {
        notas: notas(),
        picos: sesion.picos,
        ancho: minAncho,
        alto: minAlto,
        duracion: dur,
        bpm: sesion.grilla.bpm,
        offset: sesion.grilla.offsetMs,
      };
      dibujarFondoMinimapa();
    }
    dibujarCabezalMinimapa(t, tMin, tMax);
  }

  // Clic o arrastre en la franja salta a ese instante (la misma buscar() de la barra de posicion).
  let arrastrandoMinimapa = false;
  function saltarDesdeMinimapa(e: PointerEvent): void {
    if (!sesion.buffer) return;
    const caja = lienzoMinCabezal.getBoundingClientRect();
    buscar(tiempoDeXMinimapa(e.clientX - caja.left, caja.width, duracionMs()));
  }
  lienzoMinCabezal.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !sesion.buffer) return;
    e.preventDefault();
    arrastrandoMinimapa = true;
    lienzoMinCabezal.setPointerCapture(e.pointerId);
    saltarDesdeMinimapa(e);
  });
  lienzoMinCabezal.addEventListener('pointermove', (e) => {
    if (arrastrandoMinimapa) saltarDesdeMinimapa(e);
  });
  for (const tipo of ['pointerup', 'pointercancel'] as const) {
    lienzoMinCabezal.addEventListener(tipo, () => {
      arrastrandoMinimapa = false;
    });
  }

  function bucle(): void {
    if (!activo) return;
    programarSonidos();
    dibujar();
    // eslint-disable-next-line no-restricted-globals -- solo dibuja el editor; la posicion sale de ctx.currentTime (CLAUDE.md, "El reloj es el audio").
    requestAnimationFrame(bucle);
  }

  // -- Entrada: mouse y teclado --------------------------------------------

  function posicionEnCanvas(e: MouseEvent): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('mousemove', (e) => {
    const { x, y } = posicionEnCanvas(e);
    const { izquierda, anchoCol } = geometria();
    const col = columnaDeX(x, izquierda, anchoCol);
    if (col === null) {
      hover = null;
      return;
    }
    const slot = slotDeY(vista, sesion.grilla, y);
    hover = { col, slot };
    if (arrastre) arrastre.slotActual = slot;
  });
  canvas.addEventListener('mouseleave', () => {
    hover = null;
  });
  /** Columna mas cercana a `x`, aunque el mouse este fuera de las pistas (el rectangulo no se corta al salir). */
  function columnaCercana(x: number): number {
    const { izquierda, anchoCol } = geometria();
    return Math.min(3, Math.max(0, Math.floor((x - izquierda) / anchoCol)));
  }

  /** El rectangulo de seleccion de `c` en slots y columnas, y como Seleccion para notasEnSeleccion. */
  function rectanguloDeCaja(c: NonNullable<typeof caja>): {
    slotA: number;
    slotB: number;
    colA: number;
    colB: number;
    seleccion: Seleccion;
  } {
    const slot1 = slotDeY(vista, sesion.grilla, c.y);
    const col1 = columnaCercana(c.x);
    const slotA = Math.min(c.slot0, slot1);
    const slotB = Math.max(c.slot0, slot1);
    const colA = Math.min(c.col0, col1);
    const colB = Math.max(c.col0, col1);
    const columnas: Column[] = [];
    for (let k = colA; k <= colB; k++) columnas.push(k as Column);
    return {
      slotA,
      slotB,
      colA,
      colB,
      seleccion: {
        desde: tiempoDeSlotEntero(sesion.grilla, slotA),
        hasta: tiempoDeSlotEntero(sesion.grilla, slotB),
        columnas,
      },
    };
  }

  /** Suelta el rectangulo: elige lo que quedo adentro. Un clic sin arrastrar suelta la seleccion. */
  function terminarCaja(): void {
    const c = caja;
    caja = null;
    if (!c) return;
    if (Math.abs(c.x - c.x0) < 4 && Math.abs(c.y - c.y0) < 4) {
      elegir(null);
      return;
    }
    const r = rectanguloDeCaja(c);
    const dentro = notasEnSeleccion(notas(), r.seleccion);
    if (dentro.length === 0) {
      elegir(null);
      aviso('No hay notas en esa zona.', 'info');
      return;
    }
    elegir({
      notas: dentro,
      origen: r.seleccion.desde,
      // El largo cuenta los slots que cubre el rectangulo (el ultimo incluido),
      // asi pegar varias veces seguidas encadena sin huecos ni solapes.
      duracion: tiempoDeSlotEntero(sesion.grilla, r.slotB + 1) - r.seleccion.desde,
    });
    aviso(`${dentro.length} notas elegidas. Ctrl+C copia, Supr borra, Alt + flechas mueve.`, 'info');
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const { x, y } = posicionEnCanvas(e);
    if (e.shiftKey) {
      // Mayus + arrastrar: rectangulo de seleccion (no pone ni quita notas).
      e.preventDefault();
      caja = { slot0: slotDeY(vista, sesion.grilla, y), col0: columnaCercana(x), x0: x, y0: y, x, y };
      return;
    }
    const { izquierda, anchoCol } = geometria();
    const col = columnaDeX(x, izquierda, anchoCol);
    if (col === null) return;
    // Un clic normal suelta la seleccion: editar a mano y seguir con una
    // seleccion vieja en pantalla confunde (Supr borraria lo que no se ve).
    if (eleccion) elegir(null);
    const slot = slotDeY(vista, sesion.grilla, y);
    arrastre = { col, slotInicio: slot, slotActual: slot };
  });
  function alMoverLaCaja(e: MouseEvent): void {
    if (!caja) return;
    const p = posicionEnCanvas(e);
    caja.x = p.x;
    caja.y = p.y;
  }
  window.addEventListener('mousemove', alMoverLaCaja);
  function alSoltar(): void {
    if (caja) {
      terminarCaja();
      return;
    }
    if (!arrastre) return;
    const { col, slotInicio, slotActual } = arrastre;
    arrastre = null;
    const t1 = tiempoDeSlotEntero(sesion.grilla, slotInicio);
    const t2 = tiempoDeSlotEntero(sesion.grilla, slotActual);
    confirmarNotas(slotInicio === slotActual ? alternarTap(notas(), col, t1) : colocarLarga(notas(), col, t1, t2));
  }
  window.addEventListener('mouseup', alSoltar);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const { x, y } = posicionEnCanvas(e);
    const { izquierda, anchoCol } = geometria();
    const col = columnaDeX(x, izquierda, anchoCol);
    if (col === null) return;
    const t = tiempoDeSlotEntero(sesion.grilla, slotDeY(vista, sesion.grilla, y));
    confirmarNotas(quitarNota(notas(), col, t));
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        vista.pxPorMs = limitarZoom(vista.pxPorMs * Math.exp(-e.deltaY * 0.0015));
        iZoom.value = String(vista.pxPorMs);
      } else {
        buscar(tiempoActual() + (e.deltaY / vista.pxPorMs) * 0.6);
      }
    },
    { passive: false },
  );

  const codigosDeCarril = leerKeyMap();
  function alTeclear(e: KeyboardEvent): void {
    const objetivo = e.target as HTMLElement | null;
    const escribiendo =
      objetivo !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(objetivo.tagName) && objetivo.getAttribute('type') !== 'range' && objetivo.getAttribute('type') !== 'checkbox';
    if (escribiendo) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) rehacer();
        else deshacer();
      } else if (e.code === 'KeyY') {
        e.preventDefault();
        rehacer();
      } else if (e.code === 'KeyC') {
        e.preventDefault();
        copiarSeleccion();
      } else if (e.code === 'KeyX') {
        e.preventDefault();
        cortarSeleccion();
      } else if (e.code === 'KeyV') {
        e.preventDefault();
        pegarEnCabezal();
      } else if (e.code === 'KeyA') {
        e.preventDefault();
        elegirTodo();
      }
      return;
    }
    // Alt + flechas: mueve lo elegido. Arriba = mas tarde (el futuro esta
    // arriba), como ArrowUp mueve el cabezal. preventDefault tambien sin
    // seleccion: Alt + izquierda/derecha seria "atras/adelante" del navegador.
    if (e.altKey && e.code.startsWith('Arrow')) {
      e.preventDefault();
      if (e.code === 'ArrowUp') moverSeleccion(1, 0);
      else if (e.code === 'ArrowDown') moverSeleccion(-1, 0);
      else if (e.code === 'ArrowLeft') moverSeleccion(0, -1);
      else moverSeleccion(0, 1);
      return;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault();
      eliminarSeleccion();
      return;
    }
    if (e.code === 'Escape' && eleccion) {
      e.preventDefault();
      elegir(null);
      return;
    }
    const carril = codigosDeCarril.indexOf(e.code);
    if (carril !== -1) {
      e.preventDefault();
      if (e.repeat || !sesion.buffer) return;
      const col = carril as Column;
      // En vivo se graba el instante que el jugador OYO (T-035), igual que
      // clock.now() en el juego; en pausa el cabezal ya es exacto.
      const instante = reproduciendo && compensar ? compensarLatencia(tiempoActual(), leerOffset(), latenciaSalidaMs()) : tiempoActual();
      const slot = slotMasCercano(sesion.grilla, instante);
      const t = tiempoDeSlotEntero(sesion.grilla, slot);
      confirmarNotas(reproduciendo ? agregarTap(notas(), col, t) : alternarTap(notas(), col, t));
      return;
    }
    const pulso = duracionPulso(sesion.grilla.bpm);
    const slotMs = pulso / sesion.grilla.divisor;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        alternarReproduccion();
        break;
      case 'ArrowUp':
        e.preventDefault();
        buscar(tiempoActual() + slotMs);
        break;
      case 'ArrowDown':
        e.preventDefault();
        buscar(tiempoActual() - slotMs);
        break;
      case 'PageUp':
        e.preventDefault();
        buscar(tiempoActual() + pulso * 4);
        break;
      case 'PageDown':
        e.preventDefault();
        buscar(tiempoActual() - pulso * 4);
        break;
      case 'Home':
        e.preventDefault();
        buscar(0);
        break;
      case 'End':
        e.preventDefault();
        buscar(duracionMs());
        break;
      case 'BracketLeft':
        cambiarDivisor(-1);
        break;
      case 'BracketRight':
        cambiarDivisor(1);
        break;
      case 'KeyQ':
        cuantizarSeleccion();
        break;
      default:
        break;
    }
  }
  window.addEventListener('keydown', alTeclear);

  // -- Salir ---------------------------------------------------------------

  function limpiarEscena(): void {
    activo = false;
    observador.disconnect();
    observadorMin.disconnect();
    window.removeEventListener('keydown', alTeclear);
    window.removeEventListener('mouseup', alSoltar);
    window.removeEventListener('mousemove', alMoverLaCaja);
    detenerFuente();
    reproduciendo = false;
    if (ctx) {
      void ctx.close().catch(() => {
        // best-effort, igual que en game.ts.
      });
      ctx = null;
    }
  }

  function salir(destino: () => void): void {
    pausar();
    guardarSesion();
    limpiarEscena();
    destino();
  }
  volver.addEventListener('click', () => salir(opciones.aMenu));
  nuevo.addEventListener('click', () => {
    const hayTrabajo = notas().length > 0 || sesion.buffer !== null;
    if (hayTrabajo && !window.confirm('Se descarta lo que hay en el editor y se empieza un mapa nuevo. ¿Seguir?')) {
      return;
    }
    pausar();
    limpiarEscena();
    borrarBorrador();
    sesionGuardada = null;
    mostrarMapeador(raiz, sinAbrir(opciones));
  });

  // Arranque.
  if (opciones.abrir) {
    void abrirDeLaBiblioteca(opciones.abrir.songId, opciones.abrir.difficultyName);
  } else if (sesion.buffer) {
    archivoNombre.textContent = `${sesion.nombreAudio || 'audio'} (${formatoTiempo(duracionMs())})`;
    iPosicion.max = String(Math.round(duracionMs()));
    aviso('Sesion recuperada.', 'info');
  } else if (notas().length > 0) {
    aviso(`Borrador recuperado (${notas().length} notas). Carga el mismo audio para seguir.`, 'info');
  }
  sincronizarBotones();
  // eslint-disable-next-line no-restricted-globals -- solo dibuja el editor (ver bucle()).
  requestAnimationFrame(bucle);
}
