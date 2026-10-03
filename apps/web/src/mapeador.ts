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
import type { AnalisisOnsets, Column, Grilla, NivelAuto, Note } from '@tetra/core';
import {
  DIVISORES,
  PRESETS_AUTO,
  analizarOnsets,
  duracionPulso,
  escribirOsu,
  estimarTempo,
  generarNotas,
  lineasDeGrilla,
  slotMasCercano,
} from '@tetra/core';
import { construirOsz, guardarCancionCreada } from '@tetra/storage';
import { runGame } from './game.js';
import { leerKeyMap } from './keymap.js';
import {
  agregarTap,
  alternarTap,
  borrarBorrador,
  calcularPicos,
  colocarLarga,
  columnaDeX,
  construirChart,
  crearHistorial,
  espejar,
  guardarBorrador,
  leerBorrador,
  leerNumero,
  limitarZoom,
  mezclarMono,
  quitarNota,
  resumirNotas,
  slotDeY,
  tiempoDeSlotEntero,
  tiempoDeY,
  yDeTiempo,
  type AjustesMapa,
  type Historial,
  type MetadatosMapa,
  type Vista,
} from './mapeador-logica.js';

/** Ganchos de navegacion que le pasa el router. */
export interface OpcionesMapeador {
  aMenu: () => void;
  /** Ir al song select (despues de guardar en la biblioteca). */
  aSongSelect: () => void;
}

/** Lo que sobrevive a probar el mapa (runGame reemplaza la pantalla) y a salir al menu. */
interface Sesion {
  archivo: File | null;
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

const MS_POR_CUBETA = 5;
const ANCHO_COLUMNA_MAX = 96;
const COLOR_ACENTO = '#3fd8c2';
const COLOR_AMBAR = '#e8b84a';
const COLOR_TINTA = '#e7eef0';

function sesionNueva(): Sesion {
  const borrador = leerBorrador();
  return {
    archivo: null,
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

function cederHilo(): Promise<void> {
  // Deja que el navegador pinte el aviso "analizando" antes de un calculo largo. Un
  // temporizador y no rAF: rAF no corre con la pestana oculta y el analisis quedaria
  // esperando. No mide tiempo de juego.
  // eslint-disable-next-line no-restricted-globals -- solo cede el hilo, no mide tiempo (CLAUDE.md, "El reloj es el audio").
  return new Promise((resolver) => setTimeout(resolver, 30));
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
  const sesion: Sesion = sesionGuardada ?? sesionNueva();
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
  let taps: number[] = [];

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
  cabecera.append(volver, el('h1', 'tetra-mp-titulo', 'Mapeador'));

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
    tarjeta('Salida', bProbar, bGuardar, filaDescargas),
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
  const cSonido = el('input');
  cSonido.type = 'checkbox';
  cSonido.checked = true;
  const lSonido = el('label', 'tetra-mp-casilla');
  lSonido.append(cSonido, el('span', undefined, 'Sonido de notas'));
  const cMetro = el('input');
  cMetro.type = 'checkbox';
  const lMetro = el('label', 'tetra-mp-casilla');
  lMetro.append(cMetro, el('span', undefined, 'Metronomo'));
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
  lectura.append(lecturaTiempo, lecturaNotas);
  barra.append(bPlay, sVelocidad, bDeshacer, bRehacer, lSonido, lMetro, lOnsets, iZoom, lectura);

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
  escena.append(barra, lienzoContenedor, iPosicion, ayuda);
  contenedor.appendChild(pantalla);

  // -- Estado derivado -----------------------------------------------------

  function sincronizarBotones(): void {
    bDeshacer.disabled = !sesion.historial.puedeDeshacer;
    bRehacer.disabled = !sesion.historial.puedeRehacer;
    const sinAudio = sesion.buffer === null;
    bPlay.disabled = sinAudio;
    bProbar.disabled = sinAudio || notas().length === 0;
    bGuardar.disabled = sinAudio || notas().length === 0;
    bOsz.disabled = sinAudio || notas().length === 0;
    bOsu.disabled = notas().length === 0;
    bDetectar.disabled = sinAudio;
    bGenerar.disabled = sinAudio;
    bAzar.disabled = sinAudio;
    bPlay.textContent = reproduciendo ? 'Pausar' : 'Reproducir';
    const r = resumirNotas(notas());
    lecturaNotas.textContent =
      r.total === 0
        ? '0 notas'
        : `${r.total} notas (${r.largas} largas), ${r.nps.toFixed(1)} por segundo`;
  }

  function guardarSesion(): void {
    sesion.tiempo = vista.tiempo;
    sesion.pxPorMs = vista.pxPorMs;
    guardarBorrador({
      version: 1,
      meta: sesion.meta,
      grilla: sesion.grilla,
      ajustes: sesion.ajustes,
      notas: notas(),
    });
  }

  function confirmarNotas(nuevas: Note[]): void {
    sesion.historial.registrar(nuevas);
    guardarSesion();
    sincronizarBotones();
  }

  function leerMeta(): void {
    sesion.meta = {
      titulo: iTitulo.value,
      artista: iArtista.value,
      creador: iCreador.value,
      dificultad: iDificultad.value,
      audioArchivo: sesion.archivo?.name ?? sesion.meta.audioArchivo,
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
    pausar();
    aviso('Decodificando el audio...');
    try {
      const bytes = await archivo.arrayBuffer();
      const decodificador = new AudioContext();
      let buffer: AudioBuffer;
      try {
        buffer = await decodificador.decodeAudioData(bytes.slice(0));
      } finally {
        await decodificador.close();
      }
      sesion.archivo = archivo;
      sesion.bytes = bytes;
      sesion.buffer = buffer;
      const canales: Float32Array[] = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) canales.push(buffer.getChannelData(c));
      const mono = mezclarMono(canales);
      sesion.picos = calcularPicos(mono, buffer.sampleRate, MS_POR_CUBETA);
      archivoNombre.textContent = `${archivo.name} (${formatoTiempo(buffer.duration * 1000)})`;
      iPosicion.max = String(Math.round(buffer.duration * 1000));
      if (iTitulo.value.trim() === '') {
        iTitulo.value = archivo.name.replace(/\.[^.]+$/, '');
      }
      leerMeta();
      vista.tiempo = 0;
      aviso('Analizando los golpes del audio...');
      await cederHilo();
      sesion.analisis = analizarOnsets(mono, buffer.sampleRate);
      detectarTempo(false);
      sincronizarBotones();
      aviso(
        `Listo. ${sesion.analisis.onsets.length} golpes detectados. Ajusta BPM y offset, y pulsa "Generar" o mapea a mano.`,
        'ok',
      );
    } catch (error) {
      aviso(`No se pudo leer el audio: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  function detectarTempo(avisar: boolean): void {
    if (!sesion.analisis) return;
    const t = estimarTempo(sesion.analisis);
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
    sesion.historial.deshacer();
    guardarSesion();
    sincronizarBotones();
  }
  function rehacer(): void {
    sesion.historial.rehacer();
    guardarSesion();
    sincronizarBotones();
  }

  // -- Salida --------------------------------------------------------------

  function chartActual(): ReturnType<typeof construirChart> {
    leerMeta();
    return construirChart(
      { ...sesion.meta, audioArchivo: sesion.archivo?.name ?? 'audio.mp3' },
      sesion.grilla,
      sesion.ajustes,
      notas(),
      Math.min(duracionMs() * 0.3, notas()[0]?.time ?? 0),
    );
  }

  function entradaOsz(): Parameters<typeof construirOsz>[0] | null {
    if (!sesion.bytes || !sesion.archivo) return null;
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
      await guardarCancionCreada(entrada);
      borrarBorrador();
      aviso('Guardado en la biblioteca. Ya aparece en el song select.', 'ok');
      const ir = boton('Ir al song select', 'tetra-boton-primario');
      ir.addEventListener('click', () => salir(opciones.aSongSelect));
      estado.appendChild(document.createElement('br'));
      estado.appendChild(ir);
    } catch (error) {
      aviso(`No se pudo guardar: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      sincronizarBotones();
    }
  });
  bProbar.addEventListener('click', async () => {
    if (!sesion.buffer) return;
    pausar();
    const chart = chartActual();
    guardarSesion();
    limpiarEscena();
    const resultado = await runGame(chart, sesion.buffer);
    const volverAlEditor = (): void => mostrarMapeador(raiz, opciones);
    if (resultado.estado === 'completado') {
      const b = boton('Volver al mapeador', 'tetra-resultados-volver-song-select');
      b.addEventListener('click', volverAlEditor);
      raiz.appendChild(b);
    } else {
      volverAlEditor();
    }
  });

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

    // Notas.
    const altoNota = 16;
    for (const n of notas()) {
      const fin = n.kind === 'hold' ? n.endTime : n.time;
      if (fin < tMin - 100 || n.time > tMax + 100) continue;
      const x = izquierda + n.column * anchoCol + 5;
      const w = anchoCol - 10;
      const yInicio = yDeTiempo(vista, n.time);
      const pasada = fin < t;
      const color = n.column === 0 || n.column === 3 ? COLOR_ACENTO : COLOR_TINTA;
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
      g.globalAlpha = 1;
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
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const { x, y } = posicionEnCanvas(e);
    const { izquierda, anchoCol } = geometria();
    const col = columnaDeX(x, izquierda, anchoCol);
    if (col === null) return;
    const slot = slotDeY(vista, sesion.grilla, y);
    arrastre = { col, slotInicio: slot, slotActual: slot };
  });
  window.addEventListener('mouseup', () => {
    if (!arrastre) return;
    const { col, slotInicio, slotActual } = arrastre;
    arrastre = null;
    const t1 = tiempoDeSlotEntero(sesion.grilla, slotInicio);
    const t2 = tiempoDeSlotEntero(sesion.grilla, slotActual);
    confirmarNotas(slotInicio === slotActual ? alternarTap(notas(), col, t1) : colocarLarga(notas(), col, t1, t2));
  });
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
      }
      return;
    }
    const carril = codigosDeCarril.indexOf(e.code);
    if (carril !== -1) {
      e.preventDefault();
      if (e.repeat || !sesion.buffer) return;
      const col = carril as Column;
      const slot = slotMasCercano(sesion.grilla, tiempoActual());
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
      default:
        break;
    }
  }
  window.addEventListener('keydown', alTeclear);

  // -- Salir ---------------------------------------------------------------

  function limpiarEscena(): void {
    activo = false;
    observador.disconnect();
    window.removeEventListener('keydown', alTeclear);
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

  // Arranque.
  if (sesion.buffer) {
    archivoNombre.textContent = `${sesion.archivo?.name ?? 'audio'} (${formatoTiempo(duracionMs())})`;
    iPosicion.max = String(Math.round(duracionMs()));
    aviso('Sesion recuperada.', 'info');
  } else if (notas().length > 0) {
    aviso(`Borrador recuperado (${notas().length} notas). Carga el mismo audio para seguir.`, 'info');
  }
  sincronizarBotones();
  // eslint-disable-next-line no-restricted-globals -- solo dibuja el editor (ver bucle()).
  requestAnimationFrame(bucle);
}
