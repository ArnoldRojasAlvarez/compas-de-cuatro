// T-011: song select, el corazon de este ticket (ver el ticket, "Parte B").
// Reemplaza a la pantalla del cargador de desarrollo (T-006, eliminada en
// este mismo ticket): biblioteca de canciones con sus dificultades,
// buscar/ordenar/aleatorio, preview de audio al enfocar, y la zona de
// soltar .osz (que antes vivia suelta en el cargador). Offset/velocidad/
// skin/teclas se leen aca (para resolver la skin y arrancar la partida)
// pero se EDITAN en ajustes.ts: esta pantalla no tiene controles para
// cambiarlos, solo los aplica.
//
// Router (ver router.ts): la unica salida de esta pantalla es "Menu". Al
// terminar o abortar una partida se vuelve a esta misma pantalla (no al
// menu, ver el ticket, "Cuidado con lo que ya funciona"), reconstruida
// entera con `mostrarSongSelect` de nuevo.

import type { Chart, DifficultyResult, Ms } from '@tetra/core';
import { MODELO_CALIBRADO, SKILLSETS } from '@tetra/core';
import {
  importarOsz,
  listarCanciones,
  listarSkins,
  type CancionGuardada,
  type SongId,
} from '@tetra/storage';
import { cargarTexturasDeSkin, type TexturasDeSkin } from '@tetra/engine';
import { runGame } from './game.js';
import { decodificarBlobDeAudio, mensajeDeErrorDeCarga } from './cargador-logica.js';
import { leerSkinActiva } from './skin.js';
import { cargarAudioDelClickTrack, cargarChartDelClickTrack } from './click-track.js';
import {
  calcularInfoDeDificultad,
  elegirIndiceAleatorio,
  estrellasDeCancion,
  filtrarCanciones,
  filtrarPorRangoDeEstrellas,
  formatearDuracion,
  nivelDeEstrellas,
  ordenarCanciones,
  type CriterioDeOrden,
} from './song-select-logica.js';
import { crearClienteDificultad } from './dificultad-worker-cliente.js';

/**
 * Resuelve la skin activa (ver skin.ts) a las Texture que pide
 * `createPlayfield` (ver @tetra/engine, `cargarTexturasDeSkin`). Se llama
 * una vez por partida, justo antes de `runGame` (ver `jugar` mas abajo):
 * ni una vez por nota ni una vez por frame (ver T-009, "Rendimiento").
 * Devuelve `undefined` sin lanzar cuando no hay skin activa, o cuando la
 * guardada ya no existe en la base: la skin es aditiva, nunca un
 * requisito, asi que esto nunca debe ser motivo para no poder jugar. Movida
 * aca desde la pantalla del cargador de desarrollo (T-011, ya eliminada):
 * es la unica pantalla que arranca partidas.
 */
async function resolverTexturasDeSkinActiva(): Promise<TexturasDeSkin | undefined> {
  const id = leerSkinActiva();
  if (id === null) return undefined;
  const skins = await listarSkins();
  const skin = skins.find((candidata) => candidata.id === id);
  if (!skin) return undefined;
  return cargarTexturasDeSkin(skin.imagenes);
}

/**
 * Reproductor del preview de audio del song select: APARTE del
 * `AudioClock` del juego (ver CLAUDE.md, "El reloj es el audio", y el
 * ticket, "Cuidado con lo que ya funciona"), igual que el audio del logo
 * del menu (ver logo.ts). No mide tiempo de nada, solo suena: un
 * `AudioBufferSourceNode` en loop arrancado en el `previewTime` de la
 * dificultad enfocada.
 *
 * `decodificar` cachea por cancion (Map): asi re-enfocar una cancion ya
 * escuchada no vuelve a decodificar su audio (ver el ticket,
 * "Rendimiento": "el preview de audio se carga al enfocar, no todas las
 * canciones a la vez", que esta cache respeta sin cargar de mas).
 */
function crearReproductorDePreview(): {
  reproducir(cancion: CancionGuardada, previewTime: Ms): Promise<void>;
  detener(): void;
  destruir(): void;
} {
  let ctx: AudioContext | null = null;
  let fuente: AudioBufferSourceNode | null = null;
  const cache = new Map<SongId, AudioBuffer>();
  let token = 0;

  function obtenerContexto(): AudioContext {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  }

  function detener(): void {
    if (!fuente) return;
    try {
      fuente.stop();
    } catch {
      // ya estaba detenida, o nunca llego a arrancar de verdad: nada mas que hacer.
    }
    fuente.disconnect();
    fuente = null;
  }

  async function reproducir(cancion: CancionGuardada, previewTime: Ms): Promise<void> {
    detener();
    const miToken = ++token;
    try {
      const contexto = obtenerContexto();
      let buffer = cache.get(cancion.id);
      if (!buffer) {
        buffer = await decodificarBlobDeAudio(cancion.audio, contexto);
        cache.set(cancion.id, buffer);
      }
      // El foco pudo haber cambiado de nuevo mientras esto decodificaba
      // (por ejemplo, el usuario tipeo varias letras seguidas en buscar):
      // si ya no somos el ultimo pedido, no arrancamos un audio que nadie
      // pidio, para no terminar con dos previews sonando a la vez.
      if (miToken !== token) return;

      const nueva = contexto.createBufferSource();
      nueva.buffer = buffer;
      nueva.loop = true;
      nueva.connect(contexto.destination);
      const inicioSegundos = Math.max(0, Math.min(previewTime / 1000, buffer.duration));
      nueva.start(0, inicioSegundos);
      fuente = nueva;
    } catch {
      // Preview best-effort (audio corrupto, AudioContext no disponible):
      // no debe romper el song select por un audio que no decodifica.
    }
  }

  function destruir(): void {
    detener();
    if (ctx) {
      void ctx.close().catch(() => {
        // cerrar el contexto es best-effort, igual que en game.ts y logo.ts.
      });
      ctx = null;
    }
  }

  return { reproducir, detener, destruir };
}

/** Gancho de navegacion que le pasa el router (ver router.ts). */
export interface OpcionesSongSelect {
  /** Volver al menu. Es la unica salida de esta pantalla (ver el ticket, "Cada pantalla tiene como volver"). */
  aMenu: () => void;
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
}

/**
 * Muestra el song select dentro de `contenedor`, reemplazando lo que
 * hubiera. Es la pantalla mas grande de este ticket: ver el ticket, "Parte
 * B" para el detalle de cada pieza.
 */
export function mostrarSongSelect(contenedor: HTMLElement, opciones: OpcionesSongSelect): void {
  contenedor.innerHTML = '';

  // Adonde reaparecer despues de una partida. runGame (game.ts) siempre
  // pinta los resultados o limpia la pantalla directo sobre #app, sin
  // importar que `contenedor` se le paso a este mostrarSongSelect: #app es
  // lo unico que esta garantizado que siga en el documento en ese momento
  // (mismo razonamiento que tenia la pantalla del cargador de desarrollo,
  // ya eliminada).
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
  };

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
        renderizar();
      })
      .catch(() => {
        // Un chart que no calcula (no deberia pasar) se queda sin estrella:
        // no debe romper el song select (mismo criterio que el resto de
        // esta pantalla con errores no criticos, ver mostrarErrorImportacion).
        calculandoDificultad.delete(chart);
      });
  }

  // -- T-022: portadas. `URL.createObjectURL` UNA vez por cancion (cache por
  // SongId), nunca por render: renderizar() corre en cada tecla del buscador
  // y en cada estrella que llega del worker, y crear un URL por render
  // dejaria cientos de Blob URLs vivos. Se revocan todas al salir de la
  // pantalla (volver al menu, jugar: ver `revocarPortadas()` en esos dos
  // puntos de salida) y antes de recargar la biblioteca (ver
  // `cargarCanciones`, donde los Blob de `estado.todas` se reemplazan por
  // los recien leidos de IndexedDB). El resto de la pantalla (reproductor,
  // worker) ya se apaga en esos mismos puntos, asi que ahi mismo vive la
  // limpieza de las portadas. --
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

  /** Marca `elemento` con la portada de `cancion` (variable CSS `--portada`, que el CSS pinta bajo el velo) o con la clase de "sin portada". */
  function aplicarPortada(elemento: HTMLElement, cancion: CancionGuardada, claseSinPortada: string): void {
    const url = urlDePortada(cancion);
    if (url === undefined) {
      elemento.classList.add(claseSinPortada);
    } else {
      elemento.style.setProperty('--portada', `url("${url}")`);
    }
  }

  // -- Cascara de la pantalla: se crea UNA vez. render() de mas abajo solo
  // toca el contenido de `listaEl` y `detalleEl`, nunca esto: si se
  // reconstruyera todo en cada tecla del buscador, el <input> perderia el
  // foco en cada letra tipeada. --

  const panel = document.createElement('div');
  panel.className = 'tetra-song-select';

  const encabezado = document.createElement('div');
  encabezado.className = 'tetra-song-select-encabezado';

  const botonVolver = document.createElement('button');
  botonVolver.type = 'button';
  botonVolver.className = 'tetra-boton-volver';
  botonVolver.textContent = '← Menu';
  botonVolver.addEventListener('click', () => {
    reproductor.destruir();
    clienteDificultad.destruir();
    revocarPortadas();
    opciones.aMenu();
  });
  encabezado.appendChild(botonVolver);

  const titulo = document.createElement('h1');
  titulo.textContent = 'Elegir cancion';
  encabezado.appendChild(titulo);

  const herramientas = document.createElement('div');
  herramientas.className = 'tetra-song-select-herramientas';

  const entradaBuscar = document.createElement('input');
  entradaBuscar.type = 'search';
  entradaBuscar.placeholder = 'Buscar por titulo o artista...';
  entradaBuscar.className = 'tetra-song-select-buscar';
  entradaBuscar.setAttribute('aria-label', 'Buscar cancion');
  herramientas.appendChild(entradaBuscar);

  const selectOrden = document.createElement('select');
  selectOrden.setAttribute('aria-label', 'Ordenar canciones');
  const opcionOrdenTitulo = document.createElement('option');
  opcionOrdenTitulo.value = 'titulo';
  opcionOrdenTitulo.textContent = 'Ordenar: titulo';
  const opcionOrdenBpm = document.createElement('option');
  opcionOrdenBpm.value = 'bpm';
  opcionOrdenBpm.textContent = 'Ordenar: BPM';
  const opcionOrdenEstrellas = document.createElement('option');
  opcionOrdenEstrellas.value = 'estrellas';
  opcionOrdenEstrellas.textContent = 'Ordenar: estrellas';
  selectOrden.append(opcionOrdenTitulo, opcionOrdenBpm, opcionOrdenEstrellas);
  herramientas.appendChild(selectOrden);

  // T-014: filtro por rango de estrellas (ver el ticket, "filtrar por
  // rango de estrellas"). Vacio de cualquier lado = sin cota (ver
  // filtrarPorRangoDeEstrellas); son <input type=number>, no un slider, para
  // no meter una dependencia nueva solo para esto.
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
  entradaEstrellasMin.setAttribute('aria-label', 'Estrellas minimas');
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
  entradaEstrellasMax.setAttribute('aria-label', 'Estrellas maximas');
  filtroEstrellas.appendChild(entradaEstrellasMax);

  herramientas.appendChild(filtroEstrellas);

  const botonAleatorio = document.createElement('button');
  botonAleatorio.type = 'button';
  botonAleatorio.textContent = 'Aleatorio';
  herramientas.appendChild(botonAleatorio);

  encabezado.appendChild(herramientas);
  panel.appendChild(encabezado);

  const cuerpo = document.createElement('div');
  cuerpo.className = 'tetra-song-select-cuerpo';

  const detalleEl = document.createElement('aside');
  detalleEl.className = 'tetra-song-select-detalle';
  cuerpo.appendChild(detalleEl);

  const columnaLista = document.createElement('div');
  columnaLista.className = 'tetra-song-select-columna-lista';

  // T-012 "Parte D": el <input type=file> nativo queda oculto (ver
  // style.css, `.tetra-input-archivo-oculto`) y se dispara con
  // `entradaArchivo.click()` desde un boton restilado adentro de la misma
  // zona de soltar: el "Choose File" gris del navegador era justo lo que
  // Arnold señalo que desentonaba (ver el ticket, "Contexto").
  const zonaImportar = document.createElement('div');
  zonaImportar.className = 'tetra-song-select-zona';

  const textoZona = document.createElement('p');
  textoZona.className = 'tetra-song-select-zona-texto';
  textoZona.textContent = 'Solta aca un archivo .osz de mania 4K';
  zonaImportar.appendChild(textoZona);

  const entradaArchivo = document.createElement('input');
  entradaArchivo.type = 'file';
  entradaArchivo.accept = '.osz';
  entradaArchivo.id = 'tetra-song-select-archivo';
  entradaArchivo.className = 'tetra-input-archivo-oculto';
  zonaImportar.appendChild(entradaArchivo);

  const botonElegirArchivo = document.createElement('button');
  botonElegirArchivo.type = 'button';
  botonElegirArchivo.className = 'tetra-song-select-zona-boton';
  botonElegirArchivo.textContent = 'o elegir archivo...';
  botonElegirArchivo.addEventListener('click', () => entradaArchivo.click());
  zonaImportar.appendChild(botonElegirArchivo);

  columnaLista.appendChild(zonaImportar);

  const botonClickTrack = document.createElement('button');
  botonClickTrack.type = 'button';
  botonClickTrack.className = 'tetra-song-select-click-track';
  botonClickTrack.textContent = 'Jugar click track';
  columnaLista.appendChild(botonClickTrack);

  const mensajeError = document.createElement('p');
  mensajeError.className = 'tetra-song-select-error';
  columnaLista.appendChild(mensajeError);

  const listaEl = document.createElement('ul');
  listaEl.className = 'tetra-song-select-lista';
  columnaLista.appendChild(listaEl);

  cuerpo.appendChild(columnaLista);
  panel.appendChild(cuerpo);

  contenedor.appendChild(panel);

  function mostrarErrorImportacion(mensaje: string): void {
    mensajeError.textContent = mensaje;
  }
  function limpiarErrorImportacion(): void {
    mensajeError.textContent = '';
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

  function enfocarCancion(id: SongId): void {
    const cancion = estado.todas.find((candidata) => candidata.id === id);
    if (!cancion) return;
    const yaEnfocada = estado.cancionEnfocadaId === id;
    estado.cancionEnfocadaId = id;
    estado.dificultadEnfocadaIndice = 0;
    // La dificultad que va a quedar en foco (indice 0) pasa a ser
    // prioritaria en el worker (ver el ticket, "la dificultad en foco
    // tiene prioridad sobre las demas").
    const primeraDificultad = cancion.dificultades[0];
    if (primeraDificultad) solicitarDificultad(primeraDificultad, true);
    renderizar();
    if (yaEnfocada) return; // no reinicia el preview si ya era esta misma cancion
    void reproductor.reproducir(cancion, primeraDificultad ? primeraDificultad.metadata.previewTime : 0);
  }

  function enfocarDificultad(indice: number): void {
    estado.dificultadEnfocadaIndice = indice;
    const cancion = estado.todas.find((candidata) => candidata.id === estado.cancionEnfocadaId);
    const chart = cancion?.dificultades[indice];
    if (chart) solicitarDificultad(chart, true);
    renderizar(); // misma cancion, mismo audio: no hace falta tocar el preview
  }

  /** Se llama despues de cambiar `consulta`/`orden`/`todas`: mantiene el foco si sigue visible, si no re-enfoca. */
  function sincronizarFocoConListaVisible(): void {
    const visibles = listaVisible();
    if (estado.cancionEnfocadaId !== null && visibles.some((c) => c.id === estado.cancionEnfocadaId)) {
      renderizar();
      return;
    }
    if (visibles.length > 0) {
      enfocarCancion(visibles[0]!.id);
    } else {
      estado.cancionEnfocadaId = null;
      reproductor.detener();
      renderizar();
    }
  }

  /**
   * Encola (sin prioridad) TODAS las dificultades de TODAS las canciones
   * cargadas: es lo que hace que abrir el song select con una biblioteca
   * grande no traba la interfaz (ver el ticket, "Parte A"), calculan en el
   * worker de a una mientras el jugador ya puede navegar la lista.
   * `enfocarCancion`/`enfocarDificultad` adelantan la que este en foco por
   * encima de esta cola de fondo.
   */
  function solicitarDificultadesDeTodas(): void {
    for (const cancion of estado.todas) {
      for (const dificultad of cancion.dificultades) {
        solicitarDificultad(dificultad, false);
      }
    }
  }

  async function cargarCanciones(idAEnfocar?: SongId): Promise<void> {
    estado.todas = await listarCanciones();
    // Los Blob de portada de la lectura anterior ya no se usan (esta lectura
    // trae objetos nuevos): se revocan sus URLs antes del proximo render,
    // que crea las nuevas bajo demanda.
    revocarPortadas();
    solicitarDificultadesDeTodas();
    const visibles = listaVisible();
    const idElegido = idAEnfocar ?? estado.cancionEnfocadaId ?? visibles[0]?.id ?? null;
    if (idElegido !== null && visibles.some((c) => c.id === idElegido)) {
      enfocarCancion(idElegido);
    } else {
      estado.cancionEnfocadaId = null;
      renderizar();
    }
  }

  // -- Render: solo toca listaEl y detalleEl, ver el comentario de arriba de todo. --

  // T-014: el modelo todavia no esta calibrado (ver MODELO_CALIBRADO en
  // @tetra/core y el JSDoc de PARAMETROS_DIFICULTAD, "SESGO CONOCIDO"):
  // mientras sea false, toda estrella que se muestra lleva esta marca
  // discreta (no un numero como si fuera definitivo, ver el ticket).
  const TITULO_ESTRELLA_PROVISIONAL =
    'Calibracion parcial: ajustada con 54 mapas de osu! de chordjack, jumpstream y stream. En otros estilos puede desviarse.';

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
    // T-022: el color lo pone el CSS por clase (tetra-estrella-<nivel>), ya
    // no un style inline por elemento.
    badge.classList.add(`tetra-estrella-${nivelDeEstrellas(overall)}`);
    if (!MODELO_CALIBRADO) {
      badge.classList.add('tetra-estrella-provisional');
      badge.title = TITULO_ESTRELLA_PROVISIONAL;
    }
  }

  /** Badge de estrella de UNA dificultad puntual (ver el ticket, "cada dificultad muestra su estrella global"). */
  function crearBadgeEstrellaDeDificultad(chart: Chart): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'tetra-estrella tetra-dificultad-item-estrella';
    aplicarEstrellaABadge(badge, resultadosDificultad.get(chart)?.overall);
    return badge;
  }

  /** Badge de estrella "de la cancion" (el maximo de sus dificultades ya calculadas), para el vistazo rapido en la cabecera de la lista. */
  function crearBadgeEstrellaDeCancion(cancion: CancionGuardada): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'tetra-estrella tetra-song-item-estrella';
    const algunaCalculada = cancion.dificultades.some((d) => resultadosDificultad.has(d));
    aplicarEstrellaABadge(badge, algunaCalculada ? estrellasDeCancion(cancion, obtenerEstrellas) : undefined);
    return badge;
  }

  function renderizarDetalle(): void {
    detalleEl.innerHTML = '';

    if (estado.cancionEnfocadaId === null) {
      const vacio = document.createElement('p');
      vacio.className = 'tetra-song-select-detalle-vacio';
      vacio.textContent =
        estado.todas.length === 0
          ? 'Sin canciones cargadas todavia. Solta un .osz o jugá el click track.'
          : 'Sin resultados para la busqueda actual.';
      detalleEl.appendChild(vacio);
      return;
    }

    const cancion = estado.todas.find((c) => c.id === estado.cancionEnfocadaId);
    const chart = cancion?.dificultades[estado.dificultadEnfocadaIndice];
    if (!cancion || !chart) return;

    // T-022: portada grande arriba (con el mismo velo que las tarjetas) y
    // titulo y artista superpuestos abajo a la izquierda; el resto del
    // detalle va en `contenido`, con su propio padding.
    const portada = document.createElement('div');
    portada.className = 'tetra-song-select-detalle-portada';
    aplicarPortada(portada, cancion, 'tetra-song-select-detalle-portada-vacia');

    const tituloCancion = document.createElement('h2');
    tituloCancion.className = 'tetra-song-select-detalle-titulo';
    tituloCancion.textContent = cancion.titulo;
    portada.appendChild(tituloCancion);

    const artista = document.createElement('p');
    artista.className = 'tetra-song-select-detalle-artista';
    artista.textContent = cancion.artista;
    portada.appendChild(artista);
    detalleEl.appendChild(portada);

    const contenido = document.createElement('div');
    contenido.className = 'tetra-song-select-detalle-contenido';
    detalleEl.appendChild(contenido);

    const info = calcularInfoDeDificultad(chart);

    const filaDificultad = document.createElement('div');
    filaDificultad.className = 'tetra-song-select-detalle-dificultad-fila';

    const nombreDificultad = document.createElement('p');
    nombreDificultad.className = 'tetra-song-select-detalle-dificultad';
    nombreDificultad.textContent = `${info.nombre} · mapeado por ${info.creador}`;
    filaDificultad.appendChild(nombreDificultad);
    filaDificultad.appendChild(crearBadgeEstrellaDeDificultad(chart));
    contenido.appendChild(filaDificultad);

    if (!MODELO_CALIBRADO) {
      const avisoProvisional = document.createElement('p');
      avisoProvisional.className = 'tetra-song-select-detalle-provisional';
      avisoProvisional.textContent = TITULO_ESTRELLA_PROVISIONAL;
      contenido.appendChild(avisoProvisional);
    }

    const datos = document.createElement('dl');
    datos.className = 'tetra-song-select-datos';

    function fila(etiqueta: string, valor: string): void {
      // T-022: cada dato es una celda (un <div> dentro del <dl> es HTML
      // valido y agrupa su dt/dd para la grilla del CSS).
      const celda = document.createElement('div');
      celda.className = 'tetra-song-select-dato';
      const dt = document.createElement('dt');
      dt.textContent = etiqueta;
      const dd = document.createElement('dd');
      dd.textContent = valor;
      celda.append(dt, dd);
      datos.appendChild(celda);
    }

    fila('BPM', String(Math.round(info.bpm)));
    fila('Duracion', formatearDuracion(info.duracionMs));
    fila('Key count', '4K');
    fila('Notas', String(info.notas));
    fila('Notas largas', String(info.notasLargas));
    fila('OD', info.overallDifficulty.toFixed(1));
    fila('HP', info.hpDrain.toFixed(1));
    contenido.appendChild(datos);

    // T-014, Parte C: el perfil de siete skillsets de la dificultad en
    // foco (ver el ticket, "en el panel de detalle"). Barras, no radar
    // (se leen y se comparan mejor en una sola escala, ver docs/DISENO.md).
    const tituloPerfil = document.createElement('h3');
    tituloPerfil.className = 'tetra-song-select-perfil-titulo';
    tituloPerfil.textContent = 'Perfil de skillsets';
    contenido.appendChild(tituloPerfil);

    const resultadoDificultad = resultadosDificultad.get(chart);
    if (!resultadoDificultad) {
      const calculandoPerfil = document.createElement('p');
      calculandoPerfil.className = 'tetra-song-select-perfil-calculando';
      calculandoPerfil.textContent = 'Calculando...';
      contenido.appendChild(calculandoPerfil);
    } else {
      const vector = resultadoDificultad.vector;
      const maximoValor = Math.max(...SKILLSETS.map((k) => vector[k]));
      const perfil = document.createElement('ul');
      perfil.className = 'tetra-song-select-perfil';
      for (const skillset of SKILLSETS) {
        const valor = vector[skillset];
        const esMaximo = valor === maximoValor && maximoValor > 0;

        const filaSkillset = document.createElement('li');
        filaSkillset.className = esMaximo
          ? 'tetra-perfil-fila tetra-perfil-fila-maxima'
          : 'tetra-perfil-fila';

        const nombre = document.createElement('span');
        nombre.className = 'tetra-perfil-fila-nombre';
        nombre.textContent = skillset;
        filaSkillset.appendChild(nombre);

        const pista = document.createElement('span');
        pista.className = 'tetra-perfil-fila-pista';
        const barra = document.createElement('span');
        barra.className = 'tetra-perfil-fila-barra';
        const proporcion = maximoValor > 0 ? valor / maximoValor : 0;
        barra.style.width = `${(proporcion * 100).toFixed(1)}%`;
        pista.appendChild(barra);
        filaSkillset.appendChild(pista);

        const valorEl = document.createElement('span');
        valorEl.className = 'tetra-perfil-fila-valor';
        valorEl.textContent = valor.toFixed(2);
        filaSkillset.appendChild(valorEl);

        perfil.appendChild(filaSkillset);
      }
      contenido.appendChild(perfil);
    }

    const botonJugar = document.createElement('button');
    botonJugar.type = 'button';
    botonJugar.className = 'tetra-song-select-jugar tetra-boton-primario';
    botonJugar.textContent = `Jugar ${info.nombre}`;
    botonJugar.addEventListener('click', () => void jugarDificultadEnfocada());
    contenido.appendChild(botonJugar);
  }

  function renderizarLista(): void {
    listaEl.innerHTML = '';
    const visibles = listaVisible();

    // T-022: con la biblioteca vacia la zona de soltar se resalta (es lo
    // que el jugador tiene que usar), no solo el bloque de la lista.
    zonaImportar.classList.toggle('tetra-song-select-zona-resaltada', estado.todas.length === 0);

    if (visibles.length === 0) {
      const li = document.createElement('li');
      if (estado.todas.length === 0) {
        li.className = 'tetra-song-select-lista-vacia tetra-song-select-vacio';

        // Icono hecho con CSS: cuatro barras verticales, el cuatro de la marca.
        const icono = document.createElement('span');
        icono.className = 'tetra-song-select-vacio-icono';
        icono.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 4; i++) icono.appendChild(document.createElement('span'));
        li.appendChild(icono);

        const tituloVacio = document.createElement('p');
        tituloVacio.className = 'tetra-song-select-vacio-titulo';
        tituloVacio.textContent = 'Tu biblioteca esta vacia';
        li.appendChild(tituloVacio);

        const ayudaVacio = document.createElement('p');
        ayudaVacio.className = 'tetra-song-select-vacio-ayuda';
        ayudaVacio.textContent = 'Solta un .osz de mania 4K en la zona de arriba o proba el click track.';
        li.appendChild(ayudaVacio);
      } else {
        li.className = 'tetra-song-select-lista-vacia';
        li.textContent = 'Sin resultados.';
      }
      listaEl.appendChild(li);
      return;
    }

    for (const cancion of visibles) {
      const enfocada = cancion.id === estado.cancionEnfocadaId;

      const item = document.createElement('li');
      item.className = enfocada ? 'tetra-song-item tetra-song-item-enfocada' : 'tetra-song-item';
      item.dataset.songId = cancion.id;
      // T-022: portada de fondo (bajo el velo del CSS) o franja sin portada.
      aplicarPortada(item, cancion, 'tetra-song-item-sin-portada');

      const cabecera = document.createElement('button');
      cabecera.type = 'button';
      cabecera.className = 'tetra-song-item-cabecera';
      cabecera.addEventListener('click', () => enfocarCancion(cancion.id));

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
      // calculadas), para ubicar de un vistazo las mas dificiles sin tener
      // que expandir cada fila (ver el ticket, "ordenar por estrellas").
      cabecera.appendChild(crearBadgeEstrellaDeCancion(cancion));

      item.appendChild(cabecera);

      // Solo la cancion en foco se expande a sus dificultades (ver el
      // ticket, "la cancion en foco se resalta y se expande... las demas
      // quedan colapsadas"): la transicion visual es CSS (max-height, ver
      // style.css), no JS, para no meter timers en apps/web/src (ver
      // eslint.config.js: setTimeout/rAF estan prohibidos aca salvo para
      // dibujar, y esto no dibuja nada de gameplay).
      if (enfocada) {
        const listaDificultades = document.createElement('ul');
        listaDificultades.className = 'tetra-song-item-dificultades';
        cancion.dificultades.forEach((dificultad, indice) => {
          const liDificultad = document.createElement('li');
          const botonDificultad = document.createElement('button');
          botonDificultad.type = 'button';
          botonDificultad.className =
            indice === estado.dificultadEnfocadaIndice
              ? 'tetra-dificultad-item tetra-dificultad-item-enfocada'
              : 'tetra-dificultad-item';
          const nombreDificultadItem = document.createElement('span');
          nombreDificultadItem.textContent = dificultad.metadata.difficultyName;
          botonDificultad.appendChild(nombreDificultadItem);
          // T-014: la estrella de ESTA dificultad puntual (ver el ticket,
          // "cada dificultad muestra su estrella global").
          botonDificultad.appendChild(crearBadgeEstrellaDeDificultad(dificultad));
          botonDificultad.addEventListener('click', (evento) => {
            evento.stopPropagation();
            enfocarDificultad(indice);
          });
          liDificultad.appendChild(botonDificultad);
          listaDificultades.appendChild(liDificultad);
        });
        item.appendChild(listaDificultades);
      }

      listaEl.appendChild(item);
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

  function volverAlSongSelect(): void {
    mostrarSongSelect(raizApp(), opciones);
  }

  async function jugar(chart: Chart, audio: AudioBuffer): Promise<void> {
    const skin = await resolverTexturasDeSkinActiva();
    // Apagar el preview (y cerrar su AudioContext) justo antes de que
    // runGame tome el foco de audio: ver el ticket, "el preview... se
    // detiene al entrar a una partida", mismo criterio que el logo del
    // menu con `alEmpezarPartida` (ver menu.ts). El worker de dificultad
    // tambien se apaga aca: nadie lo necesita mientras se juega, y
    // `mostrarSongSelect` crea uno nuevo al volver.
    reproductor.destruir();
    clienteDificultad.destruir();
    revocarPortadas();
    let resultado = await runGame(chart, audio, skin);
    // T-026: "Reintentar" en el menu de pausa vuelve a jugar el mismo mapa sin
    // pasar por el song select ni volver a decodificar el audio.
    while (resultado.estado === 'reintentar') {
      resultado = await runGame(chart, audio, skin);
    }
    if (resultado.estado === 'completado') {
      mostrarBotonVolverDesdeResultados();
    } else {
      volverAlSongSelect();
    }
  }

  async function jugarDificultadEnfocada(): Promise<void> {
    if (estado.cancionEnfocadaId === null) return;
    const cancion = estado.todas.find((c) => c.id === estado.cancionEnfocadaId);
    const chart = cancion?.dificultades[estado.dificultadEnfocadaIndice];
    if (!cancion || !chart) return;

    limpiarErrorImportacion();
    try {
      const ctxDeDecodificacion = new AudioContext();
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await decodificarBlobDeAudio(cancion.audio, ctxDeDecodificacion);
      } finally {
        await ctxDeDecodificacion.close();
      }
      await jugar(chart, audioBuffer);
    } catch (error) {
      mostrarErrorImportacion(mensajeDeErrorDeCarga(error));
    }
  }

  // -- Importar .osz --

  async function manejarOsz(archivo: File): Promise<void> {
    limpiarErrorImportacion();
    try {
      const id = await importarOsz(archivo);
      await cargarCanciones(id);
    } catch (error) {
      mostrarErrorImportacion(mensajeDeErrorDeCarga(error));
    }
  }

  zonaImportar.addEventListener('dragover', (evento) => {
    evento.preventDefault();
    zonaImportar.classList.add('tetra-song-select-zona-activa');
  });
  zonaImportar.addEventListener('dragleave', () => {
    zonaImportar.classList.remove('tetra-song-select-zona-activa');
  });
  zonaImportar.addEventListener('drop', (evento) => {
    evento.preventDefault();
    zonaImportar.classList.remove('tetra-song-select-zona-activa');
    const archivo = evento.dataTransfer?.files[0];
    if (archivo) void manejarOsz(archivo);
  });

  entradaArchivo.addEventListener('change', () => {
    const archivo = entradaArchivo.files?.[0];
    entradaArchivo.value = '';
    if (archivo) void manejarOsz(archivo);
  });

  // -- Click track --

  botonClickTrack.addEventListener('click', () => {
    limpiarErrorImportacion();
    void (async () => {
      try {
        const [chart, audio] = await Promise.all([
          cargarChartDelClickTrack(),
          cargarAudioDelClickTrack(),
        ]);
        await jugar(chart, audio);
      } catch (error) {
        mostrarErrorImportacion(mensajeDeErrorDeCarga(error));
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
    const cancion = visibles[elegido]!;
    enfocarCancion(cancion.id);
    const elementoItem = [...listaEl.children].find(
      (hijo): hijo is HTMLLIElement => hijo instanceof HTMLLIElement && hijo.dataset.songId === cancion.id,
    );
    elementoItem?.scrollIntoView({ block: 'nearest' });
  });

  // -- Carga inicial --
  void cargarCanciones();
}
