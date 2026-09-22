// T-006: cargador de desarrollo. PROVISIONAL a proposito (ver
// docs/tickets/T-006-cargador-dev.md, "Contexto"): existe solo para poder
// jugar un .osz importado dentro del navegador mientras no hay song select.
// Cuando llegue el song select de la fase 3 este archivo se reemplaza
// entero, no se hace crecer: nada de busqueda, biblioteca persistente en
// pantalla ni multiples dificultades (ver el ticket, "Fuera de alcance").

import type { Chart } from '@tetra/core';
import { importarOsz, importarOsk, listarMapas, listarSkins, type SkinGuardada } from '@tetra/storage';
import { cargarTexturasDeSkin, type TexturasDeSkin } from '@tetra/engine';
import { runGame } from './game.js';
import { decodificarBlobDeAudio, mensajeDeErrorDeCarga } from './cargador-logica.js';
import { guardarOffset, leerOffset } from './offset.js';
import { guardarSkinActiva, leerSkinActiva } from './skin.js';
import {
  VELOCIDAD_MAX,
  VELOCIDAD_MIN,
  clampVelocidad,
  guardarVelocidad,
  leerVelocidad,
  velocidadAScrollDuration,
} from './velocidad.js';

const RUTA_MAPA_CLICK = '/fixtures/click-120.json';
// Exportada: T-010 la reusa en logo.ts para la musica del menu (el mismo
// click track, en bucle, solo como senal para el visualizador). Es el
// mismo archivo, una sola constante: evita que las dos rutas se puedan ir
// desincronizando con el tiempo.
export const RUTA_AUDIO_CLICK = '/fixtures/click-120.wav';

async function cargarChartDelClickTrack(): Promise<Chart> {
  const respuesta = await fetch(RUTA_MAPA_CLICK);
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar el mapa (${respuesta.status}): ${RUTA_MAPA_CLICK}`);
  }
  return (await respuesta.json()) as Chart;
}

async function cargarAudioDelClickTrack(): Promise<AudioBuffer> {
  const respuesta = await fetch(RUTA_AUDIO_CLICK);
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar el audio (${respuesta.status}): ${RUTA_AUDIO_CLICK}`);
  }
  const arrayBuffer = await respuesta.arrayBuffer();

  // Contexto de audio usado unicamente para decodificar, igual que para un
  // .osz importado (ver manejarOsz mas abajo): runGame arma su propio
  // AudioContext para la reproduccion y el reloj de juego (ver
  // apps/web/src/game.ts), asi que este se cierra apenas termina.
  const ctxDeDecodificacion = new AudioContext();
  try {
    return await ctxDeDecodificacion.decodeAudioData(arrayBuffer);
  } finally {
    await ctxDeDecodificacion.close();
  }
}

const PASO_OFFSET_MS = 1;

/**
 * Control de calibracion de offset (T-007, "Parte B"): numero editable en
 * ms mas botones de +-1ms. Se lee de localStorage al armar el control y se
 * guarda ahi mismo en cada cambio (ver apps/web/src/offset.ts); game.ts lo
 * vuelve a leer al arrancar la proxima partida y se lo pasa al reloj como
 * `ClockOptions.userOffset`.
 *
 * El signo lo define el reloj (packages/audio/src/clock.ts) y el motor de
 * juicio: subir el offset mueve los golpes hacia temprano (puntos mas abajo en
 * el grafico de resultados), bajarlo hacia tarde. Entonces, para centrarse: si
 * pegas temprano, baja el offset; si pegas tarde, subilo. Lo mas comodo es el
 * boton "corregir segun esta partida" de la pantalla de resultados, que hace
 * justo eso a partir de la media medida.
 */
function crearControlDeOffset(): HTMLElement {
  const seccion = document.createElement('div');
  seccion.className = 'tetra-cargador-offset';

  const etiqueta = document.createElement('label');
  etiqueta.textContent = 'Offset (ms):';
  etiqueta.htmlFor = 'tetra-offset-valor';
  seccion.appendChild(etiqueta);

  const botonMenos = document.createElement('button');
  botonMenos.type = 'button';
  botonMenos.textContent = `-${PASO_OFFSET_MS} ms`;
  seccion.appendChild(botonMenos);

  const entrada = document.createElement('input');
  entrada.type = 'number';
  entrada.id = 'tetra-offset-valor';
  entrada.step = String(PASO_OFFSET_MS);
  entrada.value = String(leerOffset());
  seccion.appendChild(entrada);

  const botonMas = document.createElement('button');
  botonMas.type = 'button';
  botonMas.textContent = `+${PASO_OFFSET_MS} ms`;
  seccion.appendChild(botonMas);

  const ayuda = document.createElement('p');
  ayuda.className = 'tetra-cargador-offset-ayuda';
  ayuda.textContent =
    'Si en los resultados pegas temprano (puntos abajo), baja el offset; si pegas tarde (arriba), subilo.';

  function fijarOffset(valor: number): void {
    entrada.value = String(valor);
    guardarOffset(valor);
  }

  botonMenos.addEventListener('click', () => {
    fijarOffset((Number(entrada.value) || 0) - PASO_OFFSET_MS);
  });
  botonMas.addEventListener('click', () => {
    fijarOffset((Number(entrada.value) || 0) + PASO_OFFSET_MS);
  });
  entrada.addEventListener('change', () => {
    const valor = Number(entrada.value);
    fijarOffset(Number.isFinite(valor) ? valor : 0);
  });

  const envoltorio = document.createElement('div');
  envoltorio.appendChild(seccion);
  envoltorio.appendChild(ayuda);
  return envoltorio;
}

const PASO_VELOCIDAD = 1;

/**
 * Control de velocidad de caida (T-008, "Parte A"): numero entero con
 * botones de mas y menos, igual de forma que el control de offset de arriba.
 * Muestra el concepto natural del jugador (mas numero = mas rapido = menos
 * notas en pantalla a la vez), no los ms de `scrollDuration`: ese numero se
 * guarda tal cual en localStorage (ver apps/web/src/velocidad.ts) y game.ts
 * lo convierte a ms recien al arrancar la partida, con
 * `velocidadAScrollDuration`. Aca solo se muestra el ms resultante como dato
 * informativo, en la ayuda, para quien quiera calibrar con el numero
 * "real" de la pista.
 */
function crearControlDeVelocidad(): HTMLElement {
  const seccion = document.createElement('div');
  seccion.className = 'tetra-cargador-velocidad';

  const etiqueta = document.createElement('label');
  etiqueta.textContent = 'Velocidad:';
  etiqueta.htmlFor = 'tetra-velocidad-valor';
  seccion.appendChild(etiqueta);

  const botonMenos = document.createElement('button');
  botonMenos.type = 'button';
  botonMenos.textContent = `-${PASO_VELOCIDAD}`;
  seccion.appendChild(botonMenos);

  const entrada = document.createElement('input');
  entrada.type = 'number';
  entrada.id = 'tetra-velocidad-valor';
  entrada.step = String(PASO_VELOCIDAD);
  entrada.min = String(VELOCIDAD_MIN);
  entrada.max = String(VELOCIDAD_MAX);
  entrada.value = String(leerVelocidad());
  seccion.appendChild(entrada);

  const botonMas = document.createElement('button');
  botonMas.type = 'button';
  botonMas.textContent = `+${PASO_VELOCIDAD}`;
  seccion.appendChild(botonMas);

  const ayuda = document.createElement('p');
  ayuda.className = 'tetra-cargador-velocidad-ayuda';

  function actualizarAyuda(velocidad: number): void {
    ayuda.textContent =
      `Mas alto, las notas caen mas rapido y hay menos en pantalla a la vez ` +
      `(rango ${VELOCIDAD_MIN} a ${VELOCIDAD_MAX}; ahora mismo: ${velocidadAScrollDuration(velocidad)}ms por nota).`;
  }
  actualizarAyuda(leerVelocidad());

  function fijarVelocidad(valor: number): void {
    const recortado = clampVelocidad(valor);
    entrada.value = String(recortado);
    guardarVelocidad(recortado);
    actualizarAyuda(recortado);
  }

  botonMenos.addEventListener('click', () => {
    fijarVelocidad((Number(entrada.value) || VELOCIDAD_MIN) - PASO_VELOCIDAD);
  });
  botonMas.addEventListener('click', () => {
    fijarVelocidad((Number(entrada.value) || VELOCIDAD_MIN) + PASO_VELOCIDAD);
  });
  entrada.addEventListener('change', () => {
    const valor = Number(entrada.value);
    fijarVelocidad(Number.isFinite(valor) ? valor : VELOCIDAD_MIN);
  });

  const envoltorio = document.createElement('div');
  envoltorio.appendChild(seccion);
  envoltorio.appendChild(ayuda);
  return envoltorio;
}

/** Valor de `<option>` para "sin skin, rectangulos" (el default): no puede ser un SkinId real (crypto.randomUUID() nunca da string vacio). */
const OPCION_SIN_SKIN = '';

/**
 * Control de skins (T-009): soltar/elegir un `.osk` y un `<select>` para
 * elegir entre "sin skin (rectangulos)" y las skins ya importadas. La skin
 * elegida se persiste con apps/web/src/skin.ts (ver ese archivo: "se
 * recuerda al recargar" es uno de los criterios de aceptacion del
 * ticket). Reporta errores de importacion con `onError`, igual que
 * manejarOsz hace con el .osz mas abajo.
 */
function crearControlDeSkin(onError: (mensaje: string) => void): HTMLElement {
  const seccion = document.createElement('div');
  seccion.className = 'tetra-cargador-skin';

  const etiqueta = document.createElement('label');
  etiqueta.textContent = 'Skin:';
  etiqueta.htmlFor = 'tetra-skin-select';
  seccion.appendChild(etiqueta);

  const select = document.createElement('select');
  select.id = 'tetra-skin-select';
  seccion.appendChild(select);

  const entradaArchivo = document.createElement('input');
  entradaArchivo.type = 'file';
  entradaArchivo.accept = '.osk';
  entradaArchivo.className = 'tetra-cargador-skin-input';
  seccion.appendChild(entradaArchivo);

  const ayuda = document.createElement('p');
  ayuda.className = 'tetra-cargador-skin-ayuda';
  ayuda.textContent =
    'Opcional: soltar un archivo .osk de skin de osu!mania. Sin skin (o si le ' +
    'falta alguna imagen), se ven los rectangulos de siempre.';

  // Repuebla el <select> con "sin skin" + las skins guardadas, y deja
  // seleccionada la que esta activa (ver skin.ts). Se llama al armar el
  // control y de nuevo cada vez que se importa una skin nueva: es la unica
  // forma de que el <select> refleje lo que hay en IndexedDB, que no tiene
  // notificaciones de cambio.
  async function refrescarLista(): Promise<void> {
    const skins: SkinGuardada[] = await listarSkins();
    const activa = leerSkinActiva();

    select.innerHTML = '';
    const opcionSinSkin = document.createElement('option');
    opcionSinSkin.value = OPCION_SIN_SKIN;
    opcionSinSkin.textContent = 'Sin skin (rectangulos)';
    select.appendChild(opcionSinSkin);

    for (const skin of skins) {
      const opcion = document.createElement('option');
      opcion.value = skin.id;
      opcion.textContent = skin.nombre;
      select.appendChild(opcion);
    }

    // Si la skin activa guardada ya no aparece entre las opciones (por
    // ejemplo, se borro la base de IndexedDB a mano entre una carga y la
    // otra), el <select> cae solo a la primera opcion ("sin skin"): no
    // hace falta un caso aparte para eso.
    select.value = activa ?? OPCION_SIN_SKIN;
  }
  void refrescarLista();

  select.addEventListener('change', () => {
    guardarSkinActiva(select.value === OPCION_SIN_SKIN ? null : select.value);
  });

  entradaArchivo.addEventListener('change', () => {
    const archivo = entradaArchivo.files?.[0];
    entradaArchivo.value = '';
    if (!archivo) return;
    void (async () => {
      try {
        const id = await importarOsk(archivo);
        await refrescarLista();
        select.value = id;
        guardarSkinActiva(id);
      } catch (error) {
        onError(mensajeDeErrorDeCarga(error));
      }
    })();
  });

  const envoltorio = document.createElement('div');
  envoltorio.appendChild(seccion);
  envoltorio.appendChild(ayuda);
  return envoltorio;
}

/**
 * Resuelve la skin activa (ver skin.ts) a las Texture que pide
 * `createPlayfield` (ver @tetra/engine, `cargarTexturasDeSkin`). Se llama
 * una vez por partida, justo antes de `runGame` (ver `jugar` mas abajo):
 * ni una vez por nota ni una vez por frame (ver T-009, "Rendimiento").
 * Devuelve `undefined` sin lanzar cuando no hay skin activa, o cuando la
 * guardada ya no existe en la base (mismo criterio que `refrescarLista`
 * arriba): la skin es aditiva, nunca un requisito, asi que esto nunca debe
 * ser motivo para no poder jugar.
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
 * T-010: ganchos opcionales para quien embebe el cargador (el menu, ver
 * menu.ts) en vez de mostrarlo solo como pantalla de arranque completa
 * (que era el unico uso hasta T-009). Los dos son opcionales y sin ellos
 * el comportamiento es identico al de antes de T-010.
 */
export interface OpcionesCargador {
  /**
   * Se llama justo antes de arrancar `runGame`, es decir, justo antes de
   * que la partida tome el foco de audio y de pantalla. El menu la usa
   * para apagar ahi el loop del logo que respira y su audio aparte: sin
   * este gancho quedarian corriendo un `requestAnimationFrame` colgado y
   * un segundo audio sonando en paralelo al del juego (ver
   * docs/tickets/T-010-menu-y-logo.md, "Ojo con el reloj" y
   * "Rendimiento").
   */
  alEmpezarPartida?: () => void;
  /**
   * Que mostrar al volver de una partida: por el boton "volver" tras
   * completarla, o el regreso automatico tras abortarla con Escape. Por
   * defecto vuelve a mostrar este mismo cargador (el comportamiento de
   * siempre). El menu la usa para reconstruir el menu entero, logo
   * incluido, en vez de quedar solo con el panel del cargador.
   */
  alVolver?: () => void;
}

/**
 * Muestra la pantalla del cargador dentro de `contenedor`, reemplazando lo
 * que hubiera. Se puede volver a llamar despues de una partida para volver
 * a esta pantalla (ver mostrarBotonVolver mas abajo), y tambien es a donde
 * vuelve una partida abandonada con Escape (T-008, "Parte B": ver `jugar`
 * mas abajo). Ver `OpcionesCargador` para como el menu (T-010) se conecta
 * con esta pantalla sin que este archivo sepa nada de logos ni de Canvas.
 */
export function mostrarCargador(contenedor: HTMLElement, opciones: OpcionesCargador = {}): void {
  contenedor.innerHTML = '';

  // T-010: adonde reaparecer despues de una partida. runGame (game.ts)
  // siempre pinta los resultados o limpia la pantalla directo sobre #app,
  // sin importar que `contenedor` se le paso a este mostrarCargador (puede
  // ser un panel anidado dentro del menu, ver menu.ts): #app es lo unico
  // que esta garantizado que siga en el documento en ese momento (game.ts
  // vacia su innerHTML, pero nunca remueve el elemento en si).
  function raizApp(): HTMLElement {
    return document.getElementById('app') ?? contenedor;
  }

  // Sin alVolver explicito, el comportamiento es el de siempre: volver a
  // mostrar este mismo cargador (ahora sobre raizApp(), no sobre
  // `contenedor`, por la misma razon de arriba).
  const volver = opciones.alVolver ?? ((): void => mostrarCargador(raizApp(), opciones));

  const panel = document.createElement('div');
  panel.className = 'tetra-cargador';

  const titulo = document.createElement('h1');
  titulo.textContent = 'Tetra';
  panel.appendChild(titulo);

  const aviso = document.createElement('p');
  aviso.className = 'tetra-cargador-aviso';
  aviso.textContent =
    'Cargador de desarrollo, provisional: lo reemplaza el song select de la fase 3.';
  panel.appendChild(aviso);

  const zona = document.createElement('div');
  zona.className = 'tetra-cargador-zona';
  zona.textContent = 'Solta aca un archivo .osz de mania 4K';
  panel.appendChild(zona);

  const entrada = document.createElement('input');
  entrada.type = 'file';
  entrada.accept = '.osz';
  entrada.className = 'tetra-cargador-input';
  panel.appendChild(entrada);

  const botonClick = document.createElement('button');
  botonClick.type = 'button';
  botonClick.textContent = 'Jugar click track';
  panel.appendChild(botonClick);

  panel.appendChild(crearControlDeOffset());
  panel.appendChild(crearControlDeVelocidad());

  const mensajeError = document.createElement('p');
  mensajeError.className = 'tetra-cargador-error';

  function mostrarError(mensaje: string): void {
    mensajeError.textContent = mensaje;
  }

  function limpiarError(): void {
    mensajeError.textContent = '';
  }

  // T-009: control de skin. Va despues de offset/velocidad y antes del
  // mensaje de error (mismo lugar que ocuparia si se agregara a mano):
  // usa mostrarError ya declarado arriba para reportar un .osk invalido.
  panel.appendChild(crearControlDeSkin(mostrarError));

  panel.appendChild(mensajeError);

  contenedor.appendChild(panel);

  // Deja los resultados de la partida en pantalla (los pinta runGame al
  // terminar, ver game.ts) y agrega un boton para volver al cargador, en
  // vez de reemplazarlos al toque: la "prueba de feel" del ticket depende
  // de poder mirar el grafico de desviacion antes de volver.
  function mostrarBotonVolver(): void {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'tetra-cargador-volver';
    boton.textContent = 'Volver al cargador';
    boton.addEventListener('click', () => volver());
    // raizApp(), no `contenedor`: para cuando este cargador esta embebido
    // en el menu (ver OpcionesCargador arriba), `contenedor` es un panel
    // anidado que runGame ya desconecto del documento al pintar los
    // resultados sobre #app.
    raizApp().appendChild(boton);
  }

  // T-008: runGame ya no siempre termina en resultados. Si la partida se
  // abandono con Escape (ver game.ts, `abortar()`) game.ts ya limpio la
  // pantalla del juego pero no dibuja nada mas (no hay resultado que
  // mostrar): esta pantalla es la que decide que mostrar entonces, y vuelve
  // directo al cargador en vez de agregar el boton de "volver" sobre unos
  // resultados que no existen.
  //
  // T-009: se resuelve la skin activa aca, un solo lugar para los dos
  // caminos que llegan a jugar() (el .osz importado y el click track): asi
  // la skin se aplica igual sin importar de donde salio el Chart.
  async function jugar(chart: Chart, audio: AudioBuffer): Promise<void> {
    const skin = await resolverTexturasDeSkinActiva();
    // T-010: justo antes de que runGame tome el foco (su propio
    // AudioContext, el canvas de Pixi, el teclado). Es la ultima
    // oportunidad para que quien embebe el cargador apague lo que tenga
    // corriendo aparte (ver OpcionesCargador.alEmpezarPartida arriba).
    opciones.alEmpezarPartida?.();
    const resultado = await runGame(chart, audio, skin);
    if (resultado.estado === 'completado') {
      mostrarBotonVolver();
    } else {
      volver();
    }
  }

  async function manejarOsz(archivo: File): Promise<void> {
    limpiarError();
    try {
      const id = await importarOsz(archivo);
      const mapas = await listarMapas();
      const mapa = mapas.find((candidato) => candidato.id === id);
      if (!mapa) {
        throw new Error('El mapa se importo pero no se pudo volver a leer desde la base de datos.');
      }

      const ctxDeDecodificacion = new AudioContext();
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await decodificarBlobDeAudio(mapa.audio, ctxDeDecodificacion);
      } finally {
        await ctxDeDecodificacion.close();
      }

      await jugar(mapa.chart, audioBuffer);
    } catch (error) {
      mostrarError(mensajeDeErrorDeCarga(error));
    }
  }

  zona.addEventListener('dragover', (evento) => {
    evento.preventDefault();
    zona.classList.add('tetra-cargador-zona-activa');
  });
  zona.addEventListener('dragleave', () => {
    zona.classList.remove('tetra-cargador-zona-activa');
  });
  zona.addEventListener('drop', (evento) => {
    evento.preventDefault();
    zona.classList.remove('tetra-cargador-zona-activa');
    const archivo = evento.dataTransfer?.files[0];
    if (archivo) void manejarOsz(archivo);
  });

  entrada.addEventListener('change', () => {
    const archivo = entrada.files?.[0];
    entrada.value = '';
    if (archivo) void manejarOsz(archivo);
  });

  botonClick.addEventListener('click', () => {
    limpiarError();
    void (async () => {
      try {
        const [chart, audio] = await Promise.all([
          cargarChartDelClickTrack(),
          cargarAudioDelClickTrack(),
        ]);
        await jugar(chart, audio);
      } catch (error) {
        mostrarError(mensajeDeErrorDeCarga(error));
      }
    })();
  });
}
