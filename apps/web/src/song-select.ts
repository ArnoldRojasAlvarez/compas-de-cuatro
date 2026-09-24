// T-011: song select, el corazon de este ticket (ver el ticket, "Parte B").
// Reemplaza al cargador de desarrollo (cargador.ts, T-006, ya borrado):
// biblioteca de canciones con sus dificultades, buscar/ordenar/aleatorio,
// preview de audio al enfocar, y la zona de soltar .osz (que antes vivia
// suelta en el cargador). Offset/velocidad/skin se leen aca (para resolver
// la skin y arrancar la partida) pero se EDITAN en ajustes.ts: esta
// pantalla no tiene controles para cambiarlos, solo los aplica.
//
// Router (ver router.ts): la unica salida de esta pantalla es "Menu". Al
// terminar o abortar una partida se vuelve a esta misma pantalla (no al
// menu, ver el ticket, "Cuidado con lo que ya funciona"), reconstruida
// entera con `mostrarSongSelect` de nuevo.

import type { Chart, Ms } from '@tetra/core';
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
  densidadNotasPorSegundo,
  elegirIndiceAleatorio,
  filtrarCanciones,
  formatearDuracion,
  ordenarCanciones,
  type CriterioDeOrden,
} from './song-select-logica.js';

/**
 * Resuelve la skin activa (ver skin.ts) a las Texture que pide
 * `createPlayfield` (ver @tetra/engine, `cargarTexturasDeSkin`). Se llama
 * una vez por partida, justo antes de `runGame` (ver `jugar` mas abajo):
 * ni una vez por nota ni una vez por frame (ver T-009, "Rendimiento").
 * Devuelve `undefined` sin lanzar cuando no hay skin activa, o cuando la
 * guardada ya no existe en la base: la skin es aditiva, nunca un
 * requisito, asi que esto nunca debe ser motivo para no poder jugar. Movida
 * aca desde cargador.ts (T-011): es la unica pantalla que arranca partidas.
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
  // (mismo razonamiento que tenia cargador.ts).
  function raizApp(): HTMLElement {
    return document.getElementById('app') ?? contenedor;
  }

  const estado: EstadoSongSelect = {
    todas: [],
    consulta: '',
    orden: 'titulo',
    cancionEnfocadaId: null,
    dificultadEnfocadaIndice: 0,
  };

  const reproductor = crearReproductorDePreview();

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
  selectOrden.append(opcionOrdenTitulo, opcionOrdenBpm);
  herramientas.appendChild(selectOrden);

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

  const zonaImportar = document.createElement('div');
  zonaImportar.className = 'tetra-song-select-zona';
  zonaImportar.textContent = 'Solta aca un archivo .osz de mania 4K';
  columnaLista.appendChild(zonaImportar);

  const entradaArchivo = document.createElement('input');
  entradaArchivo.type = 'file';
  entradaArchivo.accept = '.osz';
  entradaArchivo.className = 'tetra-song-select-input-archivo';
  columnaLista.appendChild(entradaArchivo);

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
    return ordenarCanciones(filtrarCanciones(estado.todas, estado.consulta), estado.orden);
  }

  function enfocarCancion(id: SongId): void {
    const cancion = estado.todas.find((candidata) => candidata.id === id);
    if (!cancion) return;
    const yaEnfocada = estado.cancionEnfocadaId === id;
    estado.cancionEnfocadaId = id;
    estado.dificultadEnfocadaIndice = 0;
    renderizar();
    if (yaEnfocada) return; // no reinicia el preview si ya era esta misma cancion
    const primeraDificultad = cancion.dificultades[0];
    void reproductor.reproducir(cancion, primeraDificultad ? primeraDificultad.metadata.previewTime : 0);
  }

  function enfocarDificultad(indice: number): void {
    estado.dificultadEnfocadaIndice = indice;
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

  async function cargarCanciones(idAEnfocar?: SongId): Promise<void> {
    estado.todas = await listarCanciones();
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

    const tituloCancion = document.createElement('h2');
    tituloCancion.className = 'tetra-song-select-detalle-titulo';
    tituloCancion.textContent = cancion.titulo;
    detalleEl.appendChild(tituloCancion);

    const artista = document.createElement('p');
    artista.className = 'tetra-song-select-detalle-artista';
    artista.textContent = cancion.artista;
    detalleEl.appendChild(artista);

    const info = calcularInfoDeDificultad(chart);

    const nombreDificultad = document.createElement('p');
    nombreDificultad.className = 'tetra-song-select-detalle-dificultad';
    nombreDificultad.textContent = `${info.nombre} · mapeado por ${info.creador}`;
    detalleEl.appendChild(nombreDificultad);

    const datos = document.createElement('dl');
    datos.className = 'tetra-song-select-datos';

    function fila(etiqueta: string, valor: string): void {
      const dt = document.createElement('dt');
      dt.textContent = etiqueta;
      const dd = document.createElement('dd');
      dd.textContent = valor;
      datos.append(dt, dd);
    }

    fila('BPM', String(Math.round(info.bpm)));
    fila('Duracion', formatearDuracion(info.duracionMs));
    fila('Key count', '4K');
    fila('Notas', String(info.notas));
    fila('Notas largas', String(info.notasLargas));
    fila('OD', info.overallDifficulty.toFixed(1));
    fila('HP', info.hpDrain.toFixed(1));
    detalleEl.appendChild(datos);

    // Densidad provisional (T-011: NO es un star rating, ver el ticket "El
    // star rating queda para la fase 4"): notas por segundo, marcada como
    // provisional a proposito para no insinuar un numero de estrellas que
    // todavia no existe.
    const densidad = document.createElement('p');
    densidad.className = 'tetra-song-select-densidad';
    densidad.textContent = `Densidad (provisional): ${densidadNotasPorSegundo(chart).toFixed(2)} notas/s`;
    detalleEl.appendChild(densidad);

    const botonJugar = document.createElement('button');
    botonJugar.type = 'button';
    botonJugar.className = 'tetra-song-select-jugar';
    botonJugar.textContent = `Jugar ${info.nombre}`;
    botonJugar.addEventListener('click', () => void jugarDificultadEnfocada());
    detalleEl.appendChild(botonJugar);
  }

  function renderizarLista(): void {
    listaEl.innerHTML = '';
    const visibles = listaVisible();

    if (visibles.length === 0) {
      const li = document.createElement('li');
      li.className = 'tetra-song-select-lista-vacia';
      li.textContent =
        estado.todas.length === 0 ? 'Todavia no hay canciones cargadas.' : 'Sin resultados.';
      listaEl.appendChild(li);
      return;
    }

    for (const cancion of visibles) {
      const enfocada = cancion.id === estado.cancionEnfocadaId;

      const item = document.createElement('li');
      item.className = enfocada ? 'tetra-song-item tetra-song-item-enfocada' : 'tetra-song-item';
      item.dataset.songId = cancion.id;

      const cabecera = document.createElement('button');
      cabecera.type = 'button';
      cabecera.className = 'tetra-song-item-cabecera';
      cabecera.addEventListener('click', () => enfocarCancion(cancion.id));

      const tituloItem = document.createElement('span');
      tituloItem.className = 'tetra-song-item-titulo';
      tituloItem.textContent = cancion.titulo;
      cabecera.appendChild(tituloItem);

      const artistaItem = document.createElement('span');
      artistaItem.className = 'tetra-song-item-artista';
      artistaItem.textContent = cancion.artista;
      cabecera.appendChild(artistaItem);

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
          botonDificultad.textContent = dificultad.metadata.difficultyName;
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
    // menu con `alEmpezarPartida` (ver menu.ts).
    reproductor.destruir();
    const resultado = await runGame(chart, audio, skin);
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
    estado.orden = selectOrden.value === 'bpm' ? 'bpm' : 'titulo';
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
