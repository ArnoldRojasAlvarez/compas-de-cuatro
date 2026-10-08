// T-011: song select. Biblioteca de canciones con sus dificultades,
// buscar/ordenar/filtrar, preview de audio al enfocar y soltar .osz.
// Offset/velocidad/skin/teclas se leen aca (para resolver la skin y arrancar la
// partida) pero se EDITAN en ajustes.ts: esta pantalla solo los aplica.
//
// T-052 le cambia la cara, sin tocar el comportamiento de fondo: el fondo de la
// escena es la portada de la cancion enfocada (fondo-escena.ts), a la izquierda
// esta la cancion enfocada como protagonista, el preview se ve y se controla
// (pausa, barra de progreso con salto), las acciones secundarias son iconos y
// la lista queda a la derecha, compacta. Un .osz se importa soltandolo en
// cualquier parte de la ventana. Poco texto: lo que necesita explicacion va en
// `title`.
//
// Router (ver router.ts): la unica salida de esta pantalla es "Menu". Al
// terminar o abortar una partida se vuelve a esta misma pantalla (no al
// menu), reconstruida entera con `mostrarSongSelect` de nuevo.

import type { Chart, DifficultyResult, Rango, RecordDeMapa, Replay, ScoreState } from '@tetra/core';
import { MODELO_CALIBRADO, SKILLSETS, replayPerfecto } from '@tetra/core';
import {
  borrarCancion,
  exportarCancion,
  guardarEnHistorial,
  guardarPartida,
  hashesConReplay,
  importarOsz,
  leerRecords,
  leerReplayGuardado,
  listarCanciones,
  nombreSeguro,
  type CancionGuardada,
  type SongId,
} from '@tetra/storage';
import { runGame, type EscenaPartida, type OpcionesPartida } from './game.js';
import { registroDePartida, type GolpeConColumna } from './historial-logica.js';
import {
  MENSAJE_MAPA_SIN_NOTAS,
  MENSAJE_REPLAY_ILEGIBLE,
  MENSAJE_SIN_REPLAY,
  motivoDeRechazoDelReplay,
} from './replay-logica.js';
import { decodificarBlobDeAudio, mensajeDeErrorDeCarga } from './cargador-logica.js';
import { cargarAudioDelClickTrack, cargarChartDelClickTrack } from './click-track.js';
import { fondoEscena } from './fondo-escena.js';
import { leerKeyMap } from './keymap.js';
import { nombreLegibleDeCodigo } from './teclas.js';
import { formatearOffsetLocal, guardarOffsetLocal, leerOffsetLocal } from './offset-local.js';
import { cambiarBotonIcono, crearBotonIcono, crearIcono } from './iconos.js';
import { EVENTO_BIBLIOTECA_CAMBIO } from './musica-menu-logica.js';
import { crearReproductorDePreview } from './preview.js';
import {
  calcularInfoDeDificultad,
  conDificultadesOrdenadas,
  elegirIndiceAleatorio,
  estrellasDeCancion,
  filtrarCanciones,
  filtrarPorRangoDeEstrellas,
  formatearLineaDeDatos,
  fraccionDeClic,
  idTrasBorrar,
  moverIndice,
  nivelDeEstrellas,
  nombreVisibleDeDificultad,
  ordenarCanciones,
  textoDeImportacionFallida,
  type CriterioDeOrden,
} from './song-select-logica.js';
import { crearClienteDificultad } from './dificultad-worker-cliente.js';
import {
  avisoDeRecord,
  claseDeRango,
  claveDeRecord,
  desviacionEsAlta,
  detalleDeUltima,
  formatearDesviacion,
  formatearMiles,
  formatearPrecision,
  mejorRangoDeCancion,
  parejasDeConteos,
  partidaDesdeScore,
  type MedidoEnLaPartida,
  textoDeIntentos,
  tituloDeDesviacion,
} from './records-logica.js';

/** Fondo de la escena en el song select: la portada se nota, pero desenfocada para que el texto mande. */
const FONDO_DEL_SONG_SELECT = { desenfoque: 12, oscuridad: 0.65 };

/** ms que el boton de borrar espera la segunda confirmacion antes de volver a su estado normal. */
const MS_CONFIRMAR_BORRADO = 3000;

/** Segundos que saltan las flechas sobre la barra de progreso del preview. */
const SALTO_TECLADO_S = 5;

/**
 * Lo que la partida necesita de la cancion para su escena (T-053): fondo,
 * video y la linea de la intro. La skin no se resuelve aca: `runGame` la
 * resuelve sola (propia u .osk, ver skin-activa.ts) con el ancho de carril
 * real, y libera sus texturas al terminar.
 */
function escenaDeCancion(cancion: CancionGuardada, chart: Chart): EscenaPartida {
  return {
    ...(cancion.background !== undefined && { fondo: cancion.background }),
    ...(cancion.video !== undefined && { video: cancion.video }),
    ...(cancion.videoOffset !== undefined && { videoOffset: cancion.videoOffset }),
    titulo: cancion.titulo,
    artista: cancion.artista,
    dificultad: nombreVisibleDeDificultad(chart.metadata.difficultyName),
  };
}

/** Gancho de navegacion que le pasa el router (ver router.ts). */
export interface OpcionesSongSelect {
  /** Volver al menu. Es la unica salida de esta pantalla (ver el ticket, "Cada pantalla tiene como volver"). */
  aMenu: () => void;
  /** Abre una dificultad de la biblioteca en el mapeador (T-032). Sin este gancho no se muestra el boton. */
  aMapeador?: (songId: string, difficultyName: string) => void;
  /** Cancion que abre enfocada (la que sonaba en el menu, o la que se acaba de jugar). Si ya no esta, se enfoca la primera. */
  cancionInicial?: SongId;
}

interface EstadoSongSelect {
  todas: CancionGuardada[];
  consulta: string;
  orden: CriterioDeOrden;
  cancionEnfocadaId: SongId | null;
  dificultadEnfocadaIndice: number;
  /** T-014: filtro por rango de estrellas. null de cada lado quiere decir "sin cota" (ver filtrarPorRangoDeEstrellas). */
  filtroEstrellasMin: number | null;
  filtroEstrellasMax: number | null;
  /** T-055: records por clave de dificultad (ver claveDeRecord). Se vuelven a leer en cada carga de la biblioteca. */
  records: ReadonlyMap<string, RecordDeMapa>;
  /** T-044: claves de las dificultades con replay de la mejor partida guardado. */
  conReplay: ReadonlySet<string>;
}

/**
 * Muestra el song select dentro de `contenedor`, reemplazando lo que
 * hubiera.
 */
export function mostrarSongSelect(contenedor: HTMLElement, opciones: OpcionesSongSelect): void {
  contenedor.innerHTML = '';

  // Adonde reaparecer despues de una partida. runGame (game.ts) siempre
  // pinta los resultados o limpia la pantalla directo sobre #app, sin
  // importar que `contenedor` se le paso a este mostrarSongSelect: #app es
  // lo unico que esta garantizado que siga en el documento en ese momento.
  function raizApp(): HTMLElement {
    return document.getElementById('app') ?? contenedor;
  }

  const estado: EstadoSongSelect = {
    todas: [],
    consulta: '',
    orden: 'titulo',
    cancionEnfocadaId: null,
    dificultadEnfocadaIndice: 0,
    filtroEstrellasMin: null,
    filtroEstrellasMax: null,
    records: new Map(),
    conReplay: new Set(),
  };

  /** true despues de `desmontar`: todo lo asincrono que llegue tarde (lecturas de la base, resultados del worker) se descarta. */
  let desmontado = false;

  const reproductor = crearReproductorDePreview();

  // -- T-014: dificultad (estrellas) por Chart. El resultado se calcula
  // aparte (worker + cache, ver dificultad-worker-cliente.ts) y se guarda
  // aca por identidad de objeto (WeakMap/WeakSet): los Chart de
  // `estado.todas` no cambian de referencia entre renders, solo cuando se
  // vuelve a llamar cargarCanciones(). --
  const clienteDificultad = crearClienteDificultad();
  const resultadosDificultad = new WeakMap<Chart, DifficultyResult>();
  const calculandoDificultad = new WeakSet<Chart>();

  function obtenerEstrellas(chart: Chart): number | undefined {
    return resultadosDificultad.get(chart)?.overall;
  }

  // -- T-055: records. La clave (hash del contenido) se calcula una vez por
  // Chart (recorre todas las notas) y no en cada render. --
  const clavesDeRecord = new WeakMap<Chart, string>();

  function claveDe(chart: Chart): string {
    let clave = clavesDeRecord.get(chart);
    if (clave === undefined) {
      clave = claveDeRecord(chart);
      clavesDeRecord.set(chart, clave);
    }
    return clave;
  }

  function recordDe(chart: Chart): RecordDeMapa | undefined {
    return estado.records.get(claveDe(chart));
  }

  /** Lee los records de todas las dificultades de la biblioteca. Un fallo de la base (o un registro roto, que `leerRecords` ya ignora) deja el song select sin records, nunca roto. */
  async function leerRecordsDeLaBiblioteca(canciones: readonly CancionGuardada[]): Promise<void> {
    const claves = canciones.flatMap((cancion) => cancion.dificultades.map(claveDe));
    try {
      estado.records = await leerRecords(claves);
    } catch {
      estado.records = new Map();
    }
    // T-044: que dificultades tienen un replay para "Ver mejor partida" (solo las claves).
    try {
      estado.conReplay = await hashesConReplay();
    } catch {
      estado.conReplay = new Set();
    }
  }

  /**
   * Pide el resultado de dificultad de `chart` si todavia no lo tenemos ni
   * lo estamos calculando. `prioritaria` (la dificultad en foco) se vuelve
   * a pedir aunque ya este en cola, para que se adelante en el worker (ver
   * ColaConPrioridad en dificultad-logica.ts); el resultado es idempotente,
   * asi que un pedido duplicado no rompe nada, solo hace un calculo de mas
   * en el peor caso.
   */
  function solicitarDificultad(chart: Chart, prioritaria: boolean): void {
    if (resultadosDificultad.has(chart)) return;
    if (calculandoDificultad.has(chart) && !prioritaria) return;
    calculandoDificultad.add(chart);
    void clienteDificultad
      .pedir(chart, prioritaria)
      .then((resultado) => {
        calculandoDificultad.delete(chart);
        resultadosDificultad.set(chart, resultado);
        if (!desmontado) renderizar();
      })
      .catch(() => {
        // Un chart que no calcula (no deberia pasar) se queda sin estrella:
        // no debe romper el song select.
        calculandoDificultad.delete(chart);
      });
  }

  // -- T-022: portadas. `URL.createObjectURL` UNA vez por cancion (cache por
  // SongId), nunca por render: renderizar() corre en cada tecla del buscador
  // y en cada estrella que llega del worker, y crear un URL por render
  // dejaria cientos de Blob URLs vivos. Se revocan todas al salir de la
  // pantalla (ver `desmontar`) y antes de recargar la biblioteca (ver
  // `cargarCanciones`). Las usan las miniaturas de la lista; el fondo grande
  // lo maneja fondo-escena.ts con sus propios URLs. --
  const urlsDePortada = new Map<SongId, string>();

  /** URL de la portada de `cancion` (creada la primera vez que se pide), o undefined si el .osz no traia fondo. */
  function urlDePortada(cancion: CancionGuardada): string | undefined {
    if (!cancion.background) return undefined;
    let url = urlsDePortada.get(cancion.id);
    if (url === undefined) {
      url = URL.createObjectURL(cancion.background);
      urlsDePortada.set(cancion.id, url);
    }
    return url;
  }

  function revocarPortadas(): void {
    for (const url of urlsDePortada.values()) URL.revokeObjectURL(url);
    urlsDePortada.clear();
  }

  // -- Fondo de la escena: se cambia solo cuando cambia la cancion enfocada
  // (no en cada render ni al recargar la biblioteca: los Blob de una lectura
  // nueva son otros objetos aunque la imagen sea la misma, y eso haria un
  // fundido de una imagen a si misma). --
  let fondoDe: SongId | null | undefined;
  function actualizarFondo(cancion: CancionGuardada | undefined): void {
    const id = cancion?.id ?? null;
    if (id === fondoDe) return;
    fondoDe = id;
    fondoEscena().poner(cancion?.background, FONDO_DEL_SONG_SELECT);
  }

  // -- Cascara de la pantalla: se crea UNA vez. renderizar() solo toca el
  // contenido de `listaEl` y `detalleEl`, nunca esto: si se reconstruyera todo
  // en cada tecla del buscador, el <input> perderia el foco en cada letra. --

  const panel = document.createElement('div');
  panel.className = 'tetra-song-select';

  // Barra superior: volver y el titulo de la pantalla (chico, es un h1 accesible).
  const barra = document.createElement('div');
  barra.className = 'tetra-ss-barra';

  const botonVolver = crearBotonIcono('volver', 'Volver al menú', 'tetra-boton-volver');
  botonVolver.addEventListener('click', () => {
    desmontar();
    fondoEscena().limpiar();
    opciones.aMenu();
  });
  barra.appendChild(botonVolver);

  const titulo = document.createElement('h1');
  titulo.className = 'tetra-ss-titulo';
  titulo.textContent = 'Elegir canción';
  barra.appendChild(titulo);
  panel.appendChild(barra);

  const cuerpo = document.createElement('div');
  cuerpo.className = 'tetra-song-select-cuerpo';

  const detalleEl = document.createElement('section');
  detalleEl.className = 'tetra-song-select-detalle';
  cuerpo.appendChild(detalleEl);

  const columnaLista = document.createElement('div');
  columnaLista.className = 'tetra-song-select-columna-lista';

  // Buscar, filtros e importar, en una sola fila.
  const filaBusqueda = document.createElement('div');
  filaBusqueda.className = 'tetra-ss-fila-busqueda';

  const entradaBuscar = document.createElement('input');
  entradaBuscar.type = 'search';
  entradaBuscar.placeholder = 'Buscar';
  entradaBuscar.className = 'tetra-song-select-buscar';
  entradaBuscar.setAttribute('aria-label', 'Buscar canción');
  filaBusqueda.appendChild(entradaBuscar);

  const botonFiltros = crearBotonIcono('filtros', 'Orden y filtros');
  botonFiltros.setAttribute('aria-expanded', 'false');
  filaBusqueda.appendChild(botonFiltros);

  const botonImportar = crearBotonIcono('mas', 'Importar .osz');
  filaBusqueda.appendChild(botonImportar);
  columnaLista.appendChild(filaBusqueda);

  // Orden y filtro de estrellas: detras del boton de filtros, cerrados por defecto.
  const filtros = document.createElement('div');
  filtros.className = 'tetra-ss-filtros';

  const selectOrden = document.createElement('select');
  selectOrden.setAttribute('aria-label', 'Ordenar canciones');
  for (const [valor, texto] of [
    ['titulo', 'Título'],
    ['bpm', 'BPM'],
    ['estrellas', 'Estrellas'],
  ] as const) {
    const opcion = document.createElement('option');
    opcion.value = valor;
    opcion.textContent = texto;
    selectOrden.appendChild(opcion);
  }
  filtros.appendChild(selectOrden);

  // T-014: filtro por rango de estrellas. Vacio de cualquier lado = sin cota
  // (ver filtrarPorRangoDeEstrellas); son <input type=number>, no un slider.
  const filtroEstrellas = document.createElement('div');
  filtroEstrellas.className = 'tetra-song-select-filtro-estrellas';

  const etiquetaFiltroEstrellas = document.createElement('span');
  etiquetaFiltroEstrellas.className = 'tetra-song-select-filtro-estrellas-etiqueta';
  etiquetaFiltroEstrellas.textContent = '★';
  filtroEstrellas.appendChild(etiquetaFiltroEstrellas);

  const entradaEstrellasMin = document.createElement('input');
  entradaEstrellasMin.type = 'number';
  entradaEstrellasMin.min = '0';
  entradaEstrellasMin.step = '0.1';
  entradaEstrellasMin.placeholder = 'min';
  entradaEstrellasMin.className = 'tetra-song-select-filtro-estrellas-input';
  entradaEstrellasMin.setAttribute('aria-label', 'Estrellas mínimas');
  filtroEstrellas.appendChild(entradaEstrellasMin);

  const separadorFiltroEstrellas = document.createElement('span');
  separadorFiltroEstrellas.textContent = '-';
  filtroEstrellas.appendChild(separadorFiltroEstrellas);

  const entradaEstrellasMax = document.createElement('input');
  entradaEstrellasMax.type = 'number';
  entradaEstrellasMax.min = '0';
  entradaEstrellasMax.step = '0.1';
  entradaEstrellasMax.placeholder = 'max';
  entradaEstrellasMax.className = 'tetra-song-select-filtro-estrellas-input';
  entradaEstrellasMax.setAttribute('aria-label', 'Estrellas máximas');
  filtroEstrellas.appendChild(entradaEstrellasMax);
  filtros.appendChild(filtroEstrellas);

  const botonAleatorio = crearBotonIcono('azar', 'Canción al azar');
  filtros.appendChild(botonAleatorio);
  columnaLista.appendChild(filtros);

  botonFiltros.addEventListener('click', () => {
    const abierto = filtros.classList.toggle('tetra-ss-filtros-abiertos');
    botonFiltros.setAttribute('aria-expanded', String(abierto));
  });

  // El <input type=file> nativo queda oculto (ver style.css,
  // `.tetra-input-archivo-oculto`) y se dispara desde el boton de importar.
  const entradaArchivo = document.createElement('input');
  entradaArchivo.type = 'file';
  entradaArchivo.accept = '.osz';
  entradaArchivo.id = 'tetra-song-select-archivo';
  entradaArchivo.className = 'tetra-input-archivo-oculto';
  entradaArchivo.tabIndex = -1;
  columnaLista.appendChild(entradaArchivo);
  botonImportar.addEventListener('click', () => entradaArchivo.click());

  const listaEl = document.createElement('ul');
  listaEl.className = 'tetra-song-select-lista';
  columnaLista.appendChild(listaEl);

  // Estado vacio: una linea y el boton de importar. Siempre en el DOM, se
  // muestra solo con la biblioteca vacia (clase en el panel, ver el CSS).
  const vacio = document.createElement('div');
  vacio.className = 'tetra-ss-vacio';
  const iconoVacio = document.createElement('span');
  iconoVacio.className = 'tetra-song-select-vacio-icono';
  iconoVacio.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 4; i++) iconoVacio.appendChild(document.createElement('span'));
  const lineaVacio = document.createElement('p');
  lineaVacio.className = 'tetra-song-select-vacio-titulo';
  lineaVacio.textContent = 'Tu biblioteca está vacía';
  const botonImportarVacio = document.createElement('button');
  botonImportarVacio.type = 'button';
  botonImportarVacio.className = 'tetra-ss-importar-vacio';
  botonImportarVacio.setAttribute('aria-label', 'Importar .osz');
  botonImportarVacio.title = 'Importar .osz';
  botonImportarVacio.append(crearIcono('mas'), 'Importar .osz');
  botonImportarVacio.addEventListener('click', () => entradaArchivo.click());
  vacio.append(iconoVacio, lineaVacio, botonImportarVacio);
  columnaLista.appendChild(vacio);

  // Pie: el click track, chico y secundario, y el mensaje de error.
  const pie = document.createElement('div');
  pie.className = 'tetra-ss-pie';

  const botonClickTrack = document.createElement('button');
  botonClickTrack.type = 'button';
  botonClickTrack.className = 'tetra-song-select-click-track';
  botonClickTrack.textContent = 'Jugar click track';
  pie.appendChild(botonClickTrack);

  // Mensaje de error: una linea corta, el detalle tecnico en `title`, y un
  // boton para cerrarlo. Oculto mientras no hay nada que decir.
  const errorEl = document.createElement('div');
  errorEl.className = 'tetra-song-select-error';
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;
  const mensajeError = document.createElement('span');
  mensajeError.className = 'tetra-song-select-error-texto';
  const botonCerrarError = crearBotonIcono('cerrar', 'Cerrar el mensaje', 'tetra-song-select-error-cerrar');
  botonCerrarError.addEventListener('click', () => ocultarError());
  errorEl.append(mensajeError, botonCerrarError);
  pie.appendChild(errorEl);
  columnaLista.appendChild(pie);

  cuerpo.appendChild(columnaLista);
  panel.appendChild(cuerpo);

  // Velo al arrastrar un .osz sobre la ventana. Va como hijo directo de
  // `contenedor`, no del panel: el panel anima su entrada y un `position:
  // fixed` dentro de un elemento animado se acomoda al elemento, no a la
  // ventana.
  const velo = document.createElement('div');
  velo.className = 'tetra-ss-velo';
  velo.setAttribute('aria-hidden', 'true');
  const textoVelo = document.createElement('p');
  textoVelo.textContent = 'Soltar para importar';
  velo.appendChild(textoVelo);

  // -- Reproductor del preview: boton de pausa y barra de progreso. Se crea
  // una vez y se vuelve a insertar en el detalle en cada render (mover un
  // nodo no lo recrea), asi la barra no parpadea cuando llegan las estrellas. --
  const reproductorEl = document.createElement('div');
  reproductorEl.className = 'tetra-ss-reproductor';

  const botonPreview = crearBotonIcono('pausa', 'Pausar el preview');
  botonPreview.dataset.foco = 'preview';
  reproductorEl.appendChild(botonPreview);

  const barraProgreso = document.createElement('div');
  barraProgreso.className = 'tetra-ss-progreso';
  barraProgreso.tabIndex = 0;
  barraProgreso.dataset.foco = 'barra';
  barraProgreso.setAttribute('role', 'slider');
  barraProgreso.setAttribute('aria-label', 'Posición del preview');
  barraProgreso.setAttribute('aria-valuemin', '0');
  barraProgreso.setAttribute('aria-valuemax', '100');
  barraProgreso.setAttribute('aria-valuenow', '0');
  const rellenoProgreso = document.createElement('span');
  rellenoProgreso.className = 'tetra-ss-progreso-relleno';
  barraProgreso.appendChild(rellenoProgreso);
  reproductorEl.appendChild(barraProgreso);

  botonPreview.addEventListener('click', () => reproductor.alternarPausa());

  barraProgreso.addEventListener('click', (evento) => {
    if (!reproductor.activo) return;
    const caja = barraProgreso.getBoundingClientRect();
    const fraccion = fraccionDeClic(evento.clientX, caja.left, caja.width);
    reproductor.saltarA(fraccion);
    pintarProgreso(fraccion); // sin esperar al proximo cuadro
  });

  barraProgreso.addEventListener('keydown', (evento) => {
    const actual = reproductor.fraccion();
    const duracion = reproductor.duracionS;
    if (actual === null || duracion <= 0) return;
    let destino: number | null = null;
    if (evento.key === 'ArrowRight') destino = actual + SALTO_TECLADO_S / duracion;
    else if (evento.key === 'ArrowLeft') destino = actual - SALTO_TECLADO_S / duracion;
    else if (evento.key === 'Home') destino = 0;
    else if (evento.key === 'End') destino = 1;
    if (destino === null) return;
    evento.preventDefault();
    evento.stopPropagation(); // las flechas no cambian ademas de dificultad
    reproductor.saltarA(destino);
  });

  let ultimoPorcentaje = -1;
  /** Pone la barra en `fraccion` (0 a 1) con un transform (barato, sin layout). */
  function pintarProgreso(fraccion: number): void {
    rellenoProgreso.style.transform = `scaleX(${fraccion.toFixed(4)})`;
    const porcentaje = Math.round(fraccion * 100);
    if (porcentaje !== ultimoPorcentaje) {
      ultimoPorcentaje = porcentaje;
      barraProgreso.setAttribute('aria-valuenow', String(porcentaje));
    }
  }

  function pintarReproductor(): void {
    if (reproductor.pausado) cambiarBotonIcono(botonPreview, 'reproducir', 'Reproducir el preview');
    else cambiarBotonIcono(botonPreview, 'pausa', 'Pausar el preview');
    reproductorEl.classList.toggle('tetra-ss-reproductor-inactivo', !reproductor.activo);
    if (!reproductor.activo) pintarProgreso(0);
  }
  reproductor.alCambiar(pintarReproductor);
  pintarReproductor();

  // La barra avanza con el currentTime del contexto del PREVIEW (no con
  // performance.now): el rAF solo dibuja, y se detiene en `desmontar`.
  let rafProgreso = 0;
  function cuadroProgreso(): void {
    if (desmontado) return;
    const fraccion = reproductor.fraccion();
    if (fraccion !== null) pintarProgreso(fraccion);
    // eslint-disable-next-line no-restricted-globals -- dibuja la barra del preview con el reloj de SU AudioContext; no mide tiempo de juego (ver CLAUDE.md, "rAF sirve para dibujar").
    rafProgreso = requestAnimationFrame(cuadroProgreso);
  }
  // eslint-disable-next-line no-restricted-globals -- primer cuadro de la barra del preview (ver cuadroProgreso).
  rafProgreso = requestAnimationFrame(cuadroProgreso);

  contenedor.appendChild(panel);
  contenedor.appendChild(velo);

  /** Muestra un error hasta que se cierre, se importe algo con exito o se cambie de pantalla (T-054). `detalle` (el texto tecnico, por defecto el mismo mensaje) va en el tooltip. */
  function mostrarError(mensaje: string, detalle?: string): void {
    mensajeError.textContent = mensaje;
    errorEl.title = detalle ?? mensaje;
    errorEl.hidden = false;
  }
  function ocultarError(): void {
    mensajeError.textContent = '';
    errorEl.title = '';
    errorEl.hidden = true;
  }

  // -- Salida: todo lo que esta pantalla deja corriendo se apaga aca. --

  let temporizadorBorrado: ReturnType<typeof setTimeout> | undefined;
  let confirmandoBorradoId: SongId | null = null;

  /** Apaga el preview, el worker, el rAF, los oyentes de la ventana y las portadas. NO toca el fondo de la escena: quien sale decide (al jugar queda como esta, ver `jugar`). */
  function desmontar(): void {
    if (desmontado) return;
    desmontado = true;
    cancelAnimationFrame(rafProgreso);
    clearTimeout(temporizadorBorrado);
    window.removeEventListener('keydown', alTeclear);
    window.removeEventListener(EVENTO_BIBLIOTECA_CAMBIO, alCambiarLaBiblioteca);
    window.removeEventListener('dragenter', alEntrarArrastre);
    window.removeEventListener('dragover', alArrastrarSobre);
    window.removeEventListener('dragleave', alSalirArrastre);
    window.removeEventListener('drop', alSoltar);
    reproductor.destruir();
    clienteDificultad.destruir();
    revocarPortadas();
  }

  // -- Datos derivados y foco --

  function listaVisible(): CancionGuardada[] {
    const filtradaPorTexto = filtrarCanciones(estado.todas, estado.consulta);
    const filtradaPorEstrellas = filtrarPorRangoDeEstrellas(
      filtradaPorTexto,
      estado.filtroEstrellasMin,
      estado.filtroEstrellasMax,
      obtenerEstrellas,
    );
    return ordenarCanciones(filtradaPorEstrellas, estado.orden, obtenerEstrellas);
  }

  function cancionEnfocada(): CancionGuardada | undefined {
    return estado.todas.find((candidata) => candidata.id === estado.cancionEnfocadaId);
  }

  function enfocarCancion(id: SongId): void {
    if (desmontado) return;
    const cancion = estado.todas.find((candidata) => candidata.id === id);
    if (!cancion) return;
    const yaEnfocada = estado.cancionEnfocadaId === id;
    estado.cancionEnfocadaId = id;
    // Misma cancion (por ejemplo, la lista se recargo): se conserva la
    // dificultad elegida mientras siga existiendo.
    estado.dificultadEnfocadaIndice = yaEnfocada
      ? Math.min(estado.dificultadEnfocadaIndice, cancion.dificultades.length - 1)
      : 0;
    // La dificultad que va a quedar en foco pasa a ser prioritaria en el
    // worker (la dificultad en foco tiene prioridad sobre las demas).
    const enFoco = cancion.dificultades[estado.dificultadEnfocadaIndice];
    if (enFoco) solicitarDificultad(enFoco, true);
    if (!yaEnfocada) cancelarConfirmacionDeBorrado();
    actualizarFondo(cancion);
    renderizar();
    if (yaEnfocada) return; // no reinicia el preview si ya era esta misma cancion
    const primeraDificultad = cancion.dificultades[0];
    void reproductor.reproducir(cancion, primeraDificultad ? primeraDificultad.metadata.previewTime : 0);
  }

  function enfocarDificultad(indice: number): void {
    estado.dificultadEnfocadaIndice = indice;
    const chart = cancionEnfocada()?.dificultades[indice];
    if (chart) solicitarDificultad(chart, true);
    renderizar(); // misma cancion, mismo audio: no hace falta tocar el preview
  }

  /** Sin cancion enfocada (lista vacia o sin resultados): preview parado y fondo por defecto. */
  function sinFoco(): void {
    estado.cancionEnfocadaId = null;
    cancelarConfirmacionDeBorrado();
    reproductor.detener();
    actualizarFondo(undefined);
    renderizar();
  }

  /** Se llama despues de cambiar `consulta`/`orden`/`todas`: mantiene el foco si sigue visible, si no re-enfoca. */
  function sincronizarFocoConListaVisible(): void {
    const visibles = listaVisible();
    if (estado.cancionEnfocadaId !== null && visibles.some((c) => c.id === estado.cancionEnfocadaId)) {
      renderizar();
      return;
    }
    if (visibles.length > 0) enfocarCancion(visibles[0]!.id);
    else sinFoco();
  }

  /**
   * Encola (sin prioridad) TODAS las dificultades de TODAS las canciones
   * cargadas: es lo que hace que abrir el song select con una biblioteca
   * grande no traba la interfaz, calculan en el worker de a una mientras el
   * jugador ya puede navegar la lista.
   */
  function solicitarDificultadesDeTodas(): void {
    for (const cancion of estado.todas) {
      for (const dificultad of cancion.dificultades) {
        solicitarDificultad(dificultad, false);
      }
    }
  }

  async function cargarCanciones(idAEnfocar?: SongId): Promise<void> {
    const leidas = await listarCanciones();
    if (desmontado) return;
    // T-054: de la mas facil a la mas dificil; el indice de la dificultad enfocada se refiere a esta lista.
    const ordenadas = leidas.map(conDificultadesOrdenadas);
    await leerRecordsDeLaBiblioteca(ordenadas);
    if (desmontado) return;
    estado.todas = ordenadas;
    // Los Blob de portada de la lectura anterior ya no se usan (esta lectura
    // trae objetos nuevos): se revocan sus URLs antes del proximo render,
    // que crea las nuevas bajo demanda.
    revocarPortadas();
    solicitarDificultadesDeTodas();
    const visibles = listaVisible();
    const idElegido = idAEnfocar ?? estado.cancionEnfocadaId;
    if (idElegido !== null && visibles.some((c) => c.id === idElegido)) {
      enfocarCancion(idElegido);
    } else if (visibles[0] !== undefined) {
      // La pedida o la enfocada ya no esta (la borraron, o la busqueda la
      // esconde): pasa a la primera visible.
      enfocarCancion(visibles[0].id);
    } else {
      sinFoco();
    }
  }

  // -- Render: solo toca listaEl y detalleEl, ver el comentario de arriba. --

  // T-014: el modelo todavia no esta calibrado (ver MODELO_CALIBRADO en
  // @tetra/core): mientras sea false, toda estrella que se muestra lleva esta
  // marca discreta (en el `title`, sin parrafo visible).
  const TITULO_ESTRELLA_PROVISIONAL =
    'Calibración parcial: ajustada con 54 mapas de osu! de chordjack, jumpstream y stream. En otros estilos puede desviarse.';

  /** Vuelca `overall` (si ya esta calculado) o un placeholder de "calculando" en `badge`, con la clase de nivel (color) y la marca de provisional. Ancho fijo por CSS (ver .tetra-estrella): no salta el layout al pasar de un estado al otro. */
  function aplicarEstrellaABadge(badge: HTMLElement, overall: number | undefined): void {
    if (overall === undefined) {
      badge.textContent = '···';
      badge.classList.add('tetra-estrella-calculando');
      badge.removeAttribute('title');
      return;
    }
    badge.textContent = `${overall.toFixed(1)}★`;
    badge.classList.remove('tetra-estrella-calculando');
    // T-022: el color lo pone el CSS por clase (tetra-estrella-<nivel>).
    badge.classList.add(`tetra-estrella-${nivelDeEstrellas(overall)}`);
    if (!MODELO_CALIBRADO) {
      badge.classList.add('tetra-estrella-provisional');
      badge.title = TITULO_ESTRELLA_PROVISIONAL;
    }
  }

  /** Badge de estrella de UNA dificultad puntual. */
  function crearBadgeEstrellaDeDificultad(chart: Chart): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'tetra-estrella tetra-dificultad-item-estrella';
    aplicarEstrellaABadge(badge, resultadosDificultad.get(chart)?.overall);
    return badge;
  }

  /** Badge de estrella "de la cancion" (el maximo de sus dificultades ya calculadas), para el vistazo rapido en la lista. */
  function crearBadgeEstrellaDeCancion(cancion: CancionGuardada): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'tetra-estrella tetra-song-item-estrella';
    const algunaCalculada = cancion.dificultades.some((d) => resultadosDificultad.has(d));
    aplicarEstrellaABadge(badge, algunaCalculada ? estrellasDeCancion(cancion, obtenerEstrellas) : undefined);
    return badge;
  }

  /** La letra de un rango, con su color por clase (song-select.css). `extra` es la clase de tamano/lugar. */
  function crearLetraDeRango(rango: Rango, extra: string): HTMLElement {
    const letra = document.createElement('span');
    letra.className = `${extra} ${claseDeRango(rango)}`;
    letra.textContent = rango;
    return letra;
  }

  /**
   * El record de la dificultad enfocada: rango grande, precision y score en
   * mono, la linea de conteos con el color de cada juicio y los intentos en
   * tenue (con el detalle de la ultima partida en el `title`). Sin caja.
   */
  function crearBloqueDeRecord(record: RecordDeMapa): HTMLElement {
    const bloque = document.createElement('div');
    bloque.className = 'tetra-ss-record';
    bloque.setAttribute('aria-label', 'Récord');

    const resumen = document.createElement('div');
    resumen.className = 'tetra-ss-record-resumen';
    const mejor = record.mejor;
    const precision = document.createElement('span');
    precision.className = 'tetra-ss-record-precision';
    precision.textContent = formatearPrecision(mejor.accuracy);
    const score = document.createElement('span');
    score.className = 'tetra-ss-record-score';
    score.textContent = formatearMiles(mejor.score);
    const intentos = document.createElement('span');
    intentos.className = 'tetra-ss-record-intentos';
    intentos.textContent = textoDeIntentos(record.intentos);
    // T-057: las pulsaciones por tecla de la ultima partida, con las etiquetas del remapeo actual.
    intentos.title = detalleDeUltima(record, leerKeyMap().map(nombreLegibleDeCodigo));
    resumen.append(crearLetraDeRango(mejor.rango, 'tetra-ss-record-rango'), precision, score, intentos);
    // T-057: desviacion media de la mejor partida; pasados +-8 ms se pinta en acento 2.
    if (mejor.desviacionMedia !== undefined) {
      const desviacion = document.createElement('span');
      desviacion.className = desviacionEsAlta(mejor.desviacionMedia)
        ? 'tetra-ss-record-desviacion tetra-ss-record-desviacion-alta'
        : 'tetra-ss-record-desviacion';
      desviacion.textContent = formatearDesviacion(mejor.desviacionMedia);
      desviacion.title = tituloDeDesviacion(mejor.desviacionMedia);
      resumen.appendChild(desviacion);
    }

    const conteos = document.createElement('p');
    conteos.className = 'tetra-ss-record-conteos';
    for (const { juicio, etiqueta, cantidad } of parejasDeConteos(mejor.counts)) {
      const par = document.createElement('span');
      par.className = `tetra-ss-record-conteo tetra-ss-record-conteo-${juicio}`;
      const nombre = document.createElement('span');
      nombre.className = 'tetra-ss-record-etiqueta';
      nombre.textContent = etiqueta;
      const numero = document.createElement('span');
      numero.className = 'tetra-ss-record-numero';
      numero.textContent = String(cantidad);
      par.append(nombre, ' ', numero);
      conteos.appendChild(par);
    }

    bloque.append(resumen, conteos);
    return bloque;
  }

  /** Perfil de skillsets de la dificultad en foco: barras finas, sin titulo ni parrafos. */
  function crearPerfil(chart: Chart): HTMLElement {
    const resultado = resultadosDificultad.get(chart);
    if (!resultado) {
      const calculando = document.createElement('p');
      calculando.className = 'tetra-song-select-perfil-calculando';
      calculando.textContent = '···';
      calculando.title = 'Calculando';
      return calculando;
    }
    const vector = resultado.vector;
    const maximoValor = Math.max(...SKILLSETS.map((k) => vector[k]));
    const perfil = document.createElement('ul');
    perfil.className = 'tetra-song-select-perfil';
    perfil.setAttribute('aria-label', 'Perfil de skillsets');
    for (const skillset of SKILLSETS) {
      const valor = vector[skillset];
      const esMaximo = valor === maximoValor && maximoValor > 0;

      const fila = document.createElement('li');
      fila.className = esMaximo ? 'tetra-perfil-fila tetra-perfil-fila-maxima' : 'tetra-perfil-fila';

      const nombre = document.createElement('span');
      nombre.className = 'tetra-perfil-fila-nombre';
      nombre.textContent = skillset;
      fila.appendChild(nombre);

      const pista = document.createElement('span');
      pista.className = 'tetra-perfil-fila-pista';
      const barraSkill = document.createElement('span');
      barraSkill.className = 'tetra-perfil-fila-barra';
      const proporcion = maximoValor > 0 ? valor / maximoValor : 0;
      barraSkill.style.width = `${(proporcion * 100).toFixed(1)}%`;
      pista.appendChild(barraSkill);
      fila.appendChild(pista);

      const valorEl = document.createElement('span');
      valorEl.className = 'tetra-perfil-fila-valor';
      valorEl.textContent = valor.toFixed(2);
      fila.appendChild(valorEl);

      perfil.appendChild(fila);
    }
    return perfil;
  }

  // -- T-057: offset de la cancion enfocada. El control vive en la fila de
  // acciones: el reloj siempre, y `- +3 ms +` cuando hay offset (o al pasar el
  // mouse / enfocar). Las teclas - y = lo ajustan de a 1 ms. --

  /** El control de offset de la cancion enfocada que esta en pantalla (renderizarDetalle lo recrea), para actualizarlo en el lugar. */
  let controlOffset: { raiz: HTMLElement; valor: HTMLElement } | null = null;

  /** Suma `delta` ms al offset local de la cancion enfocada, lo guarda y refresca el control sin reconstruir el detalle. */
  function ajustarOffsetLocal(delta: number): void {
    const cancion = cancionEnfocada();
    if (!cancion || controlOffset === null) return;
    const nuevo = guardarOffsetLocal(cancion.id, leerOffsetLocal(cancion.id) + delta);
    pintarControlOffset(controlOffset, nuevo);
  }

  function pintarControlOffset(control: { raiz: HTMLElement; valor: HTMLElement }, ms: number): void {
    control.valor.textContent = formatearOffsetLocal(ms);
    control.raiz.classList.toggle('tetra-ss-offset--activo', ms !== 0);
  }

  /**
   * `sugerido`: la desviacion media del record es alta (T-057), asi que el
   * control queda a la vista aunque el offset sea 0.
   */
  function crearControlDeOffset(songId: SongId, sugerido: boolean): HTMLElement {
    const raiz = document.createElement('div');
    raiz.className = sugerido ? 'tetra-ss-offset tetra-ss-offset--sugerido' : 'tetra-ss-offset';
    raiz.title = 'Offset de esta canción, se suma al global. Shift + clic: 5 ms. Teclas - y =: 1 ms';

    // El reloj es el unico siempre visible: enfocarlo (o pasar el mouse) abre el ajuste.
    const reloj = crearBotonIcono('reloj', 'Offset de esta canción', 'tetra-ss-offset-reloj');
    reloj.dataset.foco = 'offset';
    const ajuste = document.createElement('span');
    ajuste.className = 'tetra-ss-offset-ajuste';

    const menos = crearBotonIcono('menos', 'Offset de esta canción, 1 ms antes', 'tetra-ss-offset-paso');
    const valor = document.createElement('span');
    valor.className = 'tetra-ss-offset-valor';
    const mas = crearBotonIcono('mas', 'Offset de esta canción, 1 ms después', 'tetra-ss-offset-paso');
    menos.dataset.foco = 'offset-menos';
    mas.dataset.foco = 'offset-mas';
    menos.addEventListener('click', (e) => ajustarOffsetLocal(e.shiftKey ? -5 : -1));
    mas.addEventListener('click', (e) => ajustarOffsetLocal(e.shiftKey ? 5 : 1));
    ajuste.append(menos, valor, mas);

    raiz.append(reloj, ajuste);
    controlOffset = { raiz, valor };
    pintarControlOffset(controlOffset, leerOffsetLocal(songId));
    return raiz;
  }

  // -- Acciones secundarias de la cancion enfocada (botones-icono) --

  function pintarBotonBorrar(boton: HTMLButtonElement, confirmando: boolean): void {
    boton.classList.toggle('tetra-ss-borrar-confirmando', confirmando);
    if (confirmando) cambiarBotonIcono(boton, 'confirmar', 'Confirmar: borrar la canción');
    else cambiarBotonIcono(boton, 'borrar', 'Borrar la canción');
  }

  function cancelarConfirmacionDeBorrado(): void {
    clearTimeout(temporizadorBorrado);
    confirmandoBorradoId = null;
  }

  async function exportarEnfocada(boton: HTMLButtonElement): Promise<void> {
    const cancion = cancionEnfocada();
    if (!cancion) return;
    boton.disabled = true;
    try {
      const blob = await exportarCancion(cancion.id);
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = `${nombreSeguro(`${cancion.artista} - ${cancion.titulo}`)}.osz`;
      enlace.click();
      // El navegador ya tomo el blob al hacer clic; se revoca un poco despues
      // por si alguno todavia lo esta leyendo.
      // eslint-disable-next-line no-restricted-globals -- limpieza de un object URL de descarga, no mide tiempo de juego.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      mostrarError(mensajeDeErrorDeCarga(error));
    } finally {
      boton.disabled = false;
    }
  }

  /** Borra la cancion y mueve el foco a la siguiente de la lista (o a la anterior si era la ultima). */
  async function borrarEnfocada(id: SongId): Promise<void> {
    const siguiente = idTrasBorrar(
      listaVisible().map((c) => c.id),
      id,
    );
    try {
      await borrarCancion(id);
    } catch (error) {
      mostrarError(mensajeDeErrorDeCarga(error));
      return;
    }
    if (desmontado) return;
    // La enfocada se suelta antes de recargar: asi enfocar la siguiente
    // reinicia el preview y el fondo (con la misma cancion enfocada no lo haria).
    estado.cancionEnfocadaId = null;
    await cargarCanciones(siguiente ?? undefined);
  }

  /** Clave (`data-foco`) del elemento de `raiz` que tiene el foco, para devolverselo despues de reconstruir. */
  function claveDeFoco(raiz: HTMLElement): string | undefined {
    const activo = document.activeElement;
    return activo instanceof HTMLElement && raiz.contains(activo) ? activo.dataset.foco : undefined;
  }

  /** Devuelve el foco al elemento con esa clave: renderizar() reconstruye los botones (por ejemplo cuando llegan las estrellas) y sin esto el teclado perderia el lugar. */
  function restaurarFoco(raiz: HTMLElement, clave: string | undefined): void {
    if (clave === undefined) return;
    for (const candidato of raiz.querySelectorAll<HTMLElement>('[data-foco]')) {
      if (candidato.dataset.foco === clave) {
        candidato.focus();
        return;
      }
    }
  }

  function renderizarDetalle(): void {
    const focoPrevio = claveDeFoco(detalleEl);
    detalleEl.replaceChildren();

    const cancion = cancionEnfocada();
    const chart = cancion?.dificultades[estado.dificultadEnfocadaIndice];
    if (!cancion || !chart) return;

    const info = calcularInfoDeDificultad(chart);

    // -- La cancion: titulo grande, artista y una linea mono de datos. --
    const cabecera = document.createElement('div');
    cabecera.className = 'tetra-ss-cabecera';

    const tituloCancion = document.createElement('h2');
    tituloCancion.className = 'tetra-song-select-detalle-titulo';
    tituloCancion.textContent = cancion.titulo;
    cabecera.appendChild(tituloCancion);

    const artista = document.createElement('p');
    artista.className = 'tetra-song-select-detalle-artista';
    artista.textContent = cancion.artista;
    cabecera.appendChild(artista);

    const datos = document.createElement('p');
    datos.className = 'tetra-ss-datos';
    datos.textContent = formatearLineaDeDatos(chart);
    cabecera.appendChild(datos);

    // T-055: sin record, nada (ni un "sin jugar").
    const recordEnfocado = recordDe(chart);
    if (recordEnfocado !== undefined) cabecera.appendChild(crearBloqueDeRecord(recordEnfocado));

    const fuente = chart.metadata.source;
    if (fuente !== undefined && fuente !== '') {
      const fuenteEl = document.createElement('p');
      fuenteEl.className = 'tetra-ss-fuente';
      fuenteEl.textContent = fuente;
      cabecera.appendChild(fuenteEl);
    }
    detalleEl.appendChild(cabecera);

    // -- Dificultades como chips con la estrella coloreada. --
    const chips = document.createElement('ul');
    chips.className = 'tetra-ss-dificultades';
    cancion.dificultades.forEach((dificultad, indice) => {
      const li = document.createElement('li');
      const boton = document.createElement('button');
      boton.type = 'button';
      const elegida = indice === estado.dificultadEnfocadaIndice;
      boton.className = elegida
        ? 'tetra-dificultad-item tetra-dificultad-item-enfocada'
        : 'tetra-dificultad-item';
      boton.setAttribute('aria-pressed', String(elegida));
      boton.dataset.foco = `dificultad-${indice}`;
      const nombre = document.createElement('span');
      nombre.textContent = nombreVisibleDeDificultad(dificultad.metadata.difficultyName);
      boton.appendChild(nombre);
      boton.appendChild(crearBadgeEstrellaDeDificultad(dificultad));
      const recordDeChip = recordDe(dificultad);
      if (recordDeChip !== undefined) {
        const letra = crearLetraDeRango(recordDeChip.mejor.rango, 'tetra-dificultad-item-rango');
        letra.title = `Mejor rango: ${recordDeChip.mejor.rango}`;
        boton.appendChild(letra);
      }
      boton.addEventListener('click', () => enfocarDificultad(indice));
      li.appendChild(boton);
      chips.appendChild(li);
    });
    detalleEl.appendChild(chips);

    detalleEl.appendChild(crearPerfil(chart));
    detalleEl.appendChild(reproductorEl);

    // -- Jugar y las acciones secundarias. --
    const acciones = document.createElement('div');
    acciones.className = 'tetra-ss-acciones';

    const botonJugar = document.createElement('button');
    botonJugar.type = 'button';
    botonJugar.className = 'tetra-song-select-jugar tetra-boton-primario';
    botonJugar.textContent = 'Jugar';
    botonJugar.title = `Jugar ${nombreVisibleDeDificultad(info.nombre)}`;
    botonJugar.dataset.foco = 'jugar';
    botonJugar.addEventListener('click', () => void jugarDificultadEnfocada());
    acciones.appendChild(botonJugar);

    // T-044: ver el mapa jugado por el bot (Ctrl+Enter) y, si hay, la mejor partida.
    const botonAuto = crearBotonIcono('auto', 'Ver auto', 'tetra-song-select-auto');
    botonAuto.title = 'Ver auto (Ctrl+Enter)';
    botonAuto.dataset.foco = 'auto';
    botonAuto.addEventListener('click', () => void verAutoDificultadEnfocada());
    acciones.appendChild(botonAuto);
    if (estado.conReplay.has(claveDe(chart))) {
      const botonReplay = crearBotonIcono('replay', 'Ver mejor partida', 'tetra-song-select-replay');
      botonReplay.dataset.foco = 'replay';
      botonReplay.addEventListener('click', () => void verMejorPartida());
      acciones.appendChild(botonReplay);
    }

    const desviacionAlta =
      recordEnfocado?.mejor.desviacionMedia !== undefined &&
      desviacionEsAlta(recordEnfocado.mejor.desviacionMedia);
    acciones.appendChild(crearControlDeOffset(cancion.id, desviacionAlta));

    const abrirEnMapeador = opciones.aMapeador;
    if (abrirEnMapeador) {
      const songId = cancion.id;
      const nombreDificultad = info.nombre;
      const botonEditar = crearBotonIcono('editar', 'Editar en el mapeador', 'tetra-song-select-editar');
      botonEditar.dataset.foco = 'editar';
      botonEditar.addEventListener('click', () => {
        desmontar();
        fondoEscena().limpiar();
        abrirEnMapeador(songId, nombreDificultad);
      });
      acciones.appendChild(botonEditar);
    }

    const botonExportar = crearBotonIcono('exportar', 'Exportar .osz');
    botonExportar.dataset.foco = 'exportar';
    botonExportar.addEventListener('click', () => void exportarEnfocada(botonExportar));
    acciones.appendChild(botonExportar);

    // Borrar pide confirmar sobre el mismo boton: el primer clic cambia el
    // icono y su nombre, y vuelve solo a los 3 s si no se confirma.
    const botonBorrar = crearBotonIcono('borrar', 'Borrar la canción', 'tetra-ss-borrar');
    botonBorrar.dataset.foco = 'borrar';
    pintarBotonBorrar(botonBorrar, confirmandoBorradoId === cancion.id);
    botonBorrar.addEventListener('click', () => {
      if (confirmandoBorradoId !== cancion.id) {
        cancelarConfirmacionDeBorrado();
        confirmandoBorradoId = cancion.id;
        pintarBotonBorrar(botonBorrar, true);
        // eslint-disable-next-line no-restricted-globals -- ventana de confirmacion de un boton de la interfaz, no mide tiempo de juego.
        temporizadorBorrado = setTimeout(() => {
          confirmandoBorradoId = null;
          pintarBotonBorrar(botonBorrar, false);
        }, MS_CONFIRMAR_BORRADO);
        return;
      }
      cancelarConfirmacionDeBorrado();
      void borrarEnfocada(cancion.id);
    });
    acciones.appendChild(botonBorrar);

    detalleEl.appendChild(acciones);
    restaurarFoco(detalleEl, focoPrevio);
  }

  /** Id de la cancion a la que se desplazo la lista por ultima vez: asi un render por estrellas no pelea con el scroll del usuario. */
  let ultimoIdDesplazado: SongId | null = null;

  function renderizarLista(): void {
    const focoPrevio = claveDeFoco(listaEl);
    listaEl.replaceChildren();
    const visibles = listaVisible();

    // Biblioteca vacia: el panel cambia a una sola columna con el estado vacio.
    panel.classList.toggle('tetra-ss-esta-vacio', estado.todas.length === 0);

    if (visibles.length === 0) {
      if (estado.todas.length > 0) {
        const li = document.createElement('li');
        li.className = 'tetra-song-select-lista-vacia';
        li.textContent = 'Sin resultados';
        listaEl.appendChild(li);
      }
      return;
    }

    let itemEnfocado: HTMLElement | null = null;
    for (const cancion of visibles) {
      const enfocada = cancion.id === estado.cancionEnfocadaId;

      const item = document.createElement('li');
      item.className = enfocada ? 'tetra-song-item tetra-song-item-enfocada' : 'tetra-song-item';
      item.dataset.songId = cancion.id;

      const cabecera = document.createElement('button');
      cabecera.type = 'button';
      cabecera.className = 'tetra-song-item-cabecera';
      cabecera.dataset.foco = cancion.id;
      if (enfocada) cabecera.setAttribute('aria-current', 'true');
      cabecera.addEventListener('click', () => enfocarCancion(cancion.id));

      // Miniatura: la portada si hay (variable CSS que pinta el CSS), o un
      // bloque liso si el .osz no traia fondo.
      const miniatura = document.createElement('span');
      miniatura.className = 'tetra-song-item-portada';
      const url = urlDePortada(cancion);
      if (url === undefined) miniatura.classList.add('tetra-song-item-portada-vacia');
      else miniatura.style.setProperty('--portada', `url("${url}")`);
      cabecera.appendChild(miniatura);

      const textoItem = document.createElement('span');
      textoItem.className = 'tetra-song-item-texto';

      const tituloItem = document.createElement('span');
      tituloItem.className = 'tetra-song-item-titulo';
      tituloItem.textContent = cancion.titulo;
      textoItem.appendChild(tituloItem);

      const artistaItem = document.createElement('span');
      artistaItem.className = 'tetra-song-item-artista';
      artistaItem.textContent = cancion.artista;
      textoItem.appendChild(artistaItem);

      cabecera.appendChild(textoItem);
      // T-014: estrella "de la cancion" (el maximo de sus dificultades ya
      // calculadas), para ubicar de un vistazo las mas dificiles.
      cabecera.appendChild(crearBadgeEstrellaDeCancion(cancion));
      // T-055: el mejor rango entre las dificultades de la cancion, si hay.
      const mejorDeLaCancion = mejorRangoDeCancion(cancion.dificultades.map(claveDe), estado.records);
      if (mejorDeLaCancion !== undefined) {
        const letra = crearLetraDeRango(mejorDeLaCancion, 'tetra-song-item-rango');
        letra.title = `Mejor rango: ${mejorDeLaCancion}`;
        cabecera.appendChild(letra);
      }

      item.appendChild(cabecera);
      listaEl.appendChild(item);
      if (enfocada) itemEnfocado = item;
    }

    restaurarFoco(listaEl, focoPrevio);

    // Si el foco cambio (teclado, azar, cancion inicial) la tarjeta tiene que
    // quedar a la vista.
    if (itemEnfocado !== null && estado.cancionEnfocadaId !== ultimoIdDesplazado) {
      ultimoIdDesplazado = estado.cancionEnfocadaId;
      itemEnfocado.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderizar(): void {
    renderizarDetalle();
    renderizarLista();
  }

  // -- Jugar --

  function mostrarBotonVolverDesdeResultados(): void {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'tetra-resultados-volver-song-select';
    boton.textContent = 'Volver al song select';
    boton.addEventListener('click', () => volverAlSongSelect());
    // raizApp(), no `contenedor`: runGame ya pinto los resultados sobre
    // #app (ver el comentario de raizApp() mas arriba).
    raizApp().appendChild(boton);
  }

  /**
   * T-055: guarda la partida terminada y, si mejoro (o es la primera), agrega
   * el aviso arriba de la pantalla de resultados. Un fallo al guardar no
   * estorba: el jugador ve igual sus resultados, solo que sin record. Solo se
   * llama con partidas completadas (una abandonada o reintentada no cuenta).
   */
  async function registrarPartida(
    chart: Chart,
    score: ScoreState,
    medido: MedidoEnLaPartida,
    replay: Replay,
  ): Promise<void> {
    try {
      const partida = partidaDesdeScore(score, new Date().toISOString(), medido);
      // T-044: el replay de esta partida reemplaza al guardado solo si es la nueva mejor.
      const guardada = await guardarPartida(claveDe(chart), partida, replay);
      const aviso = avisoDeRecord(guardada.esMejor, guardada.anterior, partida);
      const panel = raizApp().querySelector('.tetra-resultados');
      if (aviso === undefined || panel === null) return;
      const el = document.createElement('p');
      el.className = 'tetra-record-aviso';
      el.setAttribute('role', 'status');
      const texto = document.createElement('span');
      texto.textContent = aviso.texto;
      el.appendChild(texto);
      if (aviso.diferencia !== undefined) {
        const diferencia = document.createElement('span');
        diferencia.className = 'tetra-record-aviso-diferencia';
        diferencia.textContent = aviso.diferencia;
        el.appendChild(diferencia);
      }
      panel.prepend(el);
    } catch {
      // Sin record esta vez: la partida ya termino y sus resultados estan en pantalla.
    }
  }

  /**
   * T-045: guarda el resumen de la partida en el historial (las estadisticas
   * globales). Misma regla que el record: solo partidas completadas de la
   * biblioteca, nunca auto ni replay (quien llama ya filtro). Un fallo no
   * estorba: el jugador ve igual sus resultados.
   */
  async function registrarEnHistorial(
    chart: Chart,
    score: ScoreState,
    golpes: readonly GolpeConColumna[],
  ): Promise<void> {
    try {
      await guardarEnHistorial(registroDePartida(chart, score, golpes, new Date().toISOString()));
    } catch {
      // Sin historial esta vez: la partida ya termino y sus resultados estan en pantalla.
    }
  }

  /** Id que estaba enfocado al empezar a jugar: al volver, el song select reabre en esa cancion. */
  let idAlJugar: SongId | null = null;

  function volverAlSongSelect(): void {
    mostrarSongSelect(raizApp(), {
      ...opciones,
      ...(idAlJugar !== null && { cancionInicial: idAlJugar }),
    });
  }

  async function jugar(
    chart: Chart,
    audio: AudioBuffer,
    escena?: EscenaPartida,
    cancionId?: SongId,
    reproducir?: NonNullable<OpcionesPartida['reproducir']>,
  ): Promise<void> {
    // T-057: una cancion de la biblioteca suma su offset local al global (y "Corregir offset" lo ajusta a el).
    // T-044: con `reproducir` la partida es el auto o un replay: no guarda record.
    const opcionesPartida: OpcionesPartida = {
      ...(escena !== undefined && { escena }),
      ...(cancionId !== undefined && { offsetLocal: leerOffsetLocal(cancionId), idCancion: cancionId }),
      ...(reproducir !== undefined && { reproducir }),
    };
    // Sin fondo propio la partida deja ver la escena: que no quede la portada
    // de otra cancion (por ejemplo al jugar el click track) detras de la pista.
    if (escena?.fondo === undefined) fondoEscena().limpiar();
    idAlJugar = estado.cancionEnfocadaId;
    // Apagar el preview (y cerrar su AudioContext) justo antes de que runGame
    // tome el foco de audio, y el worker de dificultad: nadie lo necesita
    // mientras se juega, y `mostrarSongSelect` crea uno nuevo al volver. El
    // fondo de la escena NO se limpia: la partida pone el suyo (T-053) y asi
    // no parpadea.
    desmontar();
    let resultado = await runGame(chart, audio, undefined, opcionesPartida);
    // T-026: "Reintentar" en el menu de pausa vuelve a jugar el mismo mapa sin
    // pasar por el song select ni volver a decodificar el audio.
    while (resultado.estado === 'reintentar') {
      resultado = await runGame(chart, audio, undefined, opcionesPartida);
    }
    if (resultado.estado === 'completado') {
      // Solo las canciones de la biblioteca llevan record: el click track (sin
      // escena) es un diagnostico, no un mapa que se vaya a ver en la lista.
      // T-044: tampoco las reproducciones (auto o replay): no hay record ni historial.
      if (escena !== undefined && reproducir === undefined) {
        await registrarPartida(
          chart,
          resultado.score,
          { pulsaciones: resultado.pulsaciones, desviaciones: resultado.desviaciones },
          resultado.replay,
        );
        await registrarEnHistorial(chart, resultado.score, resultado.desviaciones);
      }
      mostrarBotonVolverDesdeResultados();
    } else {
      volverAlSongSelect();
    }
  }

  /** Hay una partida arrancando (decodificando el audio): un segundo Enter o clic no arranca otra. */
  let iniciandoPartida = false;

  /**
   * Juega la dificultad enfocada. T-044: con `reproducir` la mira en vez de
   * jugarla (el bot perfecto o la mejor partida guardada). La validacion del
   * replay ya la hizo quien llama, antes de apagar nada de esta pantalla.
   */
  async function jugarDificultadEnfocada(
    reproducir?: NonNullable<OpcionesPartida['reproducir']>,
  ): Promise<void> {
    const cancion = cancionEnfocada();
    const chart = cancion?.dificultades[estado.dificultadEnfocadaIndice];
    if (!cancion || !chart || iniciandoPartida) return;

    iniciandoPartida = true;
    try {
      const ctxDeDecodificacion = new AudioContext();
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await decodificarBlobDeAudio(cancion.audio, ctxDeDecodificacion);
      } finally {
        await ctxDeDecodificacion.close();
      }
      await jugar(chart, audioBuffer, escenaDeCancion(cancion, chart), cancion.id, reproducir);
    } catch (error) {
      mostrarError(mensajeDeErrorDeCarga(error));
    } finally {
      iniciandoPartida = false;
    }
  }

  /** T-044: "Ver auto" (Ctrl+Enter): el bot perfecto juega la dificultad enfocada. Sin record. */
  async function verAutoDificultadEnfocada(): Promise<void> {
    const chart = cancionEnfocada()?.dificultades[estado.dificultadEnfocadaIndice];
    if (!chart || iniciandoPartida) return;
    if (chart.notes.length === 0) {
      mostrarError(MENSAJE_MAPA_SIN_NOTAS);
      return;
    }
    ocultarError();
    await jugarDificultadEnfocada({ replay: replayPerfecto(chart), modo: 'auto' });
  }

  /** T-044: "Ver mejor partida": reproduce el replay guardado de la dificultad enfocada. Sin record. */
  async function verMejorPartida(): Promise<void> {
    const chart = cancionEnfocada()?.dificultades[estado.dificultadEnfocadaIndice];
    if (!chart || iniciandoPartida) return;
    const clave = claveDe(chart);
    let guardado: Awaited<ReturnType<typeof leerReplayGuardado>>;
    try {
      guardado = await leerReplayGuardado(clave);
    } catch (error) {
      mostrarError(mensajeDeErrorDeCarga(error));
      return;
    }
    if (desmontado) return;
    // Hay una fila pero no se puede leer: no es lo mismo que no tener replay.
    const sinLeer = guardado === undefined && estado.conReplay.has(clave);
    const motivo = sinLeer
      ? MENSAJE_REPLAY_ILEGIBLE
      : motivoDeRechazoDelReplay(guardado?.replay ?? undefined, chart);
    if (motivo !== null || guardado === undefined) {
      mostrarError(motivo ?? MENSAJE_SIN_REPLAY);
      return;
    }
    ocultarError();
    await jugarDificultadEnfocada({ replay: guardado.replay, modo: 'replay', fecha: guardado.fecha });
  }

  // -- Importar .osz: boton "+" o soltar en cualquier parte de la ventana --

  async function manejarOsz(archivo: File): Promise<void> {
    try {
      const id = await importarOsz(archivo);
      // Un error de una importacion anterior ya no tiene sentido (T-054).
      ocultarError();
      await cargarCanciones(id);
    } catch (error) {
      mostrarError(textoDeImportacionFallida(archivo.name), mensajeDeErrorDeCarga(error));
    }
  }

  /** Solo se reacciona a arrastres de archivos (no a seleccion de texto ni a imagenes de la pagina). */
  function arrastraArchivos(evento: DragEvent): boolean {
    return evento.dataTransfer?.types.includes('Files') ?? false;
  }

  // dragenter y dragleave se disparan en cada elemento que se cruza: se
  // cuenta la profundidad para que el velo no parpadee al pasar por encima de
  // los hijos.
  let profundidadArrastre = 0;
  function mostrarVelo(visible: boolean): void {
    velo.classList.toggle('tetra-ss-velo-visible', visible);
  }
  function alEntrarArrastre(evento: DragEvent): void {
    if (!arrastraArchivos(evento)) return;
    evento.preventDefault();
    profundidadArrastre++;
    mostrarVelo(true);
  }
  function alArrastrarSobre(evento: DragEvent): void {
    if (!arrastraArchivos(evento)) return;
    // Sin esto el navegador no permite soltar (y abriria el archivo en la pestana).
    evento.preventDefault();
  }
  function alSalirArrastre(evento: DragEvent): void {
    if (!arrastraArchivos(evento)) return;
    profundidadArrastre = Math.max(0, profundidadArrastre - 1);
    if (profundidadArrastre === 0) mostrarVelo(false);
  }
  function alSoltar(evento: DragEvent): void {
    if (!arrastraArchivos(evento)) return;
    evento.preventDefault();
    profundidadArrastre = 0;
    mostrarVelo(false);
    const archivo = evento.dataTransfer?.files[0];
    if (archivo) void manejarOsz(archivo);
  }
  window.addEventListener('dragenter', alEntrarArrastre);
  window.addEventListener('dragover', alArrastrarSobre);
  window.addEventListener('dragleave', alSalirArrastre);
  window.addEventListener('drop', alSoltar);

  entradaArchivo.addEventListener('change', () => {
    const archivo = entradaArchivo.files?.[0];
    entradaArchivo.value = '';
    if (archivo) void manejarOsz(archivo);
  });

  // -- La biblioteca cambio desde afuera (la demo se siembra, T-051): se
  // recarga la lista conservando el foco. --
  function alCambiarLaBiblioteca(): void {
    void cargarCanciones();
  }
  window.addEventListener(EVENTO_BIBLIOTECA_CAMBIO, alCambiarLaBiblioteca);

  // -- Click track --

  botonClickTrack.addEventListener('click', () => {
    if (iniciandoPartida) return;
    iniciandoPartida = true;
    void (async () => {
      try {
        const [chart, audio] = await Promise.all([
          cargarChartDelClickTrack(),
          cargarAudioDelClickTrack(),
        ]);
        await jugar(chart, audio);
      } catch (error) {
        mostrarError(mensajeDeErrorDeCarga(error));
      } finally {
        iniciandoPartida = false;
      }
    })();
  });

  // -- Buscar / ordenar / aleatorio --

  entradaBuscar.addEventListener('input', () => {
    estado.consulta = entradaBuscar.value;
    sincronizarFocoConListaVisible();
  });

  selectOrden.addEventListener('change', () => {
    estado.orden =
      selectOrden.value === 'bpm' ? 'bpm' : selectOrden.value === 'estrellas' ? 'estrellas' : 'titulo';
    sincronizarFocoConListaVisible();
  });

  /** Parsea el valor de un <input type=number> a numero o null (vacio/invalido = sin cota, ver EstadoSongSelect). */
  function leerNumeroONull(valor: string): number | null {
    if (valor.trim() === '') return null;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }

  entradaEstrellasMin.addEventListener('input', () => {
    estado.filtroEstrellasMin = leerNumeroONull(entradaEstrellasMin.value);
    sincronizarFocoConListaVisible();
  });

  entradaEstrellasMax.addEventListener('input', () => {
    estado.filtroEstrellasMax = leerNumeroONull(entradaEstrellasMax.value);
    sincronizarFocoConListaVisible();
  });

  botonAleatorio.addEventListener('click', () => {
    const visibles = listaVisible();
    const indiceActual = visibles.findIndex((c) => c.id === estado.cancionEnfocadaId);
    const elegido = elegirIndiceAleatorio(visibles.length, indiceActual === -1 ? null : indiceActual);
    if (elegido === null) return;
    enfocarCancion(visibles[elegido]!.id);
  });

  // -- Teclado: flechas arriba y abajo cambian de cancion, izquierda y derecha
  // de dificultad, Enter juega. Se ignora cuando se esta escribiendo o con
  // modificadores. La barra de progreso, con el foco, se queda con izquierda y
  // derecha (saltar) y corta su propagacion: no llegan hasta aca. --
  function alTeclear(evento: KeyboardEvent): void {
    const objetivo = evento.target;
    // T-044: Ctrl+Enter ve el auto de la dificultad enfocada (no mientras se escribe).
    if (
      evento.key === 'Enter' &&
      evento.ctrlKey &&
      !evento.altKey &&
      !evento.metaKey &&
      !evento.shiftKey
    ) {
      if (objetivo instanceof Element && objetivo.closest('input, select, textarea')) return;
      evento.preventDefault();
      if (!evento.repeat) void verAutoDificultadEnfocada();
      return;
    }
    if (evento.ctrlKey || evento.altKey || evento.metaKey) return;
    if (objetivo instanceof Element && objetivo.closest('input, select, textarea')) return;

    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      const visibles = listaVisible();
      const actual = visibles.findIndex((c) => c.id === estado.cancionEnfocadaId);
      const destino = moverIndice(actual, visibles.length, evento.key === 'ArrowDown' ? 1 : -1);
      const cancion = visibles[destino];
      if (cancion === undefined) return;
      evento.preventDefault();
      if (cancion.id !== estado.cancionEnfocadaId) enfocarCancion(cancion.id);
    } else if (evento.key === 'ArrowLeft' || evento.key === 'ArrowRight') {
      const cancion = cancionEnfocada();
      if (!cancion) return;
      const destino = moverIndice(
        estado.dificultadEnfocadaIndice,
        cancion.dificultades.length,
        evento.key === 'ArrowRight' ? 1 : -1,
      );
      evento.preventDefault();
      if (destino >= 0 && destino !== estado.dificultadEnfocadaIndice) enfocarDificultad(destino);
    } else if (evento.key === '-' || evento.key === '_' || evento.key === '=' || evento.key === '+') {
      // T-057: offset de la cancion enfocada, de a 1 ms.
      if (cancionEnfocada() === undefined) return;
      evento.preventDefault();
      ajustarOffsetLocal(evento.key === '-' || evento.key === '_' ? -1 : 1);
    } else if (evento.key === 'Enter') {
      // Con un boton enfocado, Enter ya es su clic: no se juega ademas.
      if (objetivo instanceof Element && objetivo.closest('button, a, summary')) return;
      void jugarDificultadEnfocada();
    }
  }
  window.addEventListener('keydown', alTeclear);

  // -- Carga inicial --
  void cargarCanciones(opciones.cancionInicial);
}
