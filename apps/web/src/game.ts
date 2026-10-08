// T-004: bucle de juego. Ensambla el reloj (packages/audio), el motor de
// juicio (packages/core) y el render + entrada (packages/engine). Es la
// unica pieza de todo el repo que puede tocar el navegador sin
// restricciones (ver CLAUDE.md, reglas 2 y 3): packages/core no puede
// importar nada de esto, y packages/audio y packages/engine no conocen la
// existencia del DOM salvo lo que reciben inyectado.

import { Application } from 'pixi.js';
import type { Chart, HitResult, Ms, ScoreState } from '@tetra/core';
import { createJudgeEngine, windowsForOD } from '@tetra/core';
import { createAudioClock } from '@tetra/audio';
import {
  createKeyboardInput,
  createPlayfield,
  type PlayfieldOptions,
  type TexturasDeSkin,
} from '@tetra/engine';
import { mostrarResultados, type CorreccionDeOffset, type Desviacion } from './results.js';
import { guardarOffset, leerOffset } from './offset.js';
import { guardarOffsetLocal } from './offset-local.js';
import { guardarVelocidad, leerVelocidad, velocidadAScrollDuration } from './velocidad.js';
import {
  moverVelocidad,
  pasoDeAlphaDeAvisoDeVelocidad,
  textoDeAvisoDeVelocidad,
} from './velocidad-aviso-logica.js';
import { leerKeyMap } from './keymap.js';
import { nombreLegibleDeCodigo } from './teclas.js';
import { leerMostrarFps } from './graficos.js';
import {
  leerAtenuacion,
  leerMostrarBarraDeError,
  leerMostrarJuicios,
  leerMostrarTeclas,
  leerVideoDeFondo,
  opacidadDePistaSegunAtenuacion,
} from './apariencia.js';
import { gananciaDeVolumen, leerVolumen } from './volumen.js';
import { liberarTexturasDeSkin, resolverSkinDePartida } from './skin-activa.js';
import { crearFondoDePartida, crearIntroDePartida } from './escena.js';
import { medidasDePista, type EscenaPartida } from './escena-logica.js';
import { CLASE_EN_JUEGO, EVENTO_TIEMPO_JUGADO } from './header.js';
import { sumarTiempoJugado } from './tiempo-jugado.js';
import { crearMenuPausa, type MenuPausa } from './pausa.js';
import { crearContadores } from './contadores.js';
import { crearAvisosDeAtajos } from './atajos.js';
import {
  destinoDelSalto,
  progresoDeReintento,
  reintentoCompleto,
  saltoDisponible,
} from './contadores-logica.js';
import { filtrarNotasDesde, inicioDeLaCancion } from './partida-logica.js';
import { numeroDeCuenta, transicionPausa, type FasePausa } from './pausa-logica.js';
import {
  escalaPulsoCombo,
  formatearPrecision,
  formatearScore,
  fraccionProgreso,
  nivelDeVida,
  type NivelDeVida,
} from './hud-logica.js';

// scrollDuration no es fijo desde T-008: sale de la velocidad guardada por
// el jugador (ver apps/web/src/velocidad.ts) y se calcula una sola vez al
// arrancar la partida, igual que el offset. Desde T-053 el tamano de la pista
// tampoco es fijo: ocupa el alto de la ventana y el ancho del carril escala
// con el (ver `medidasDePista` en escena-logica.ts); se recalcula al
// redimensionar la ventana.

const LEAD_IN_MS: Ms = 1500;

/**
 * T-008: que devuelve `runGame` cuando la partida termina sola versus cuando
 * el jugador la abandona con Escape. Antes de este ticket `runGame` siempre
 * resolvia con un `ScoreState`, pero una partida abandonada no tiene un
 * resultado que valga la pena mostrar (ver el ticket, "Parte B"): de las dos
 * opciones que planteaba ("distinguir termino/abandono en la misma promesa"
 * o "una senal de aborto aparte"), se elige la primera, para no sumar un
 * segundo canal de comunicacion (callback o EventTarget) a algo que ya es
 * una promesa. Quien llama (song-select.ts, ver su funcion `jugar`)
 * discrimina por `estado`.
 */
export type ResultadoPartida =
  | {
      readonly estado: 'completado';
      readonly score: ScoreState;
      /** T-056: pulsaciones (keydown) por columna en toda la partida, 4 numeros. */
      readonly pulsaciones: readonly number[];
      /** T-056: las mismas desviaciones que recibe la pantalla de resultados (tiempo, error, juicio). */
      readonly desviaciones: readonly Desviacion[];
    }
  | { readonly estado: 'abortado' }
  | { readonly estado: 'reintentar' };

/**
 * Gancho de depuracion para el e2e de Playwright (ver
 * apps/web/e2e/sincronia.spec.ts): expone el reloj de juego y el
 * AudioContext de reproduccion para poder comparar `clock.now()` contra
 * `audioContext.currentTime` desde afuera de la pagina, que es la prueba de
 * deriva que T-004 le debe a T-001 (ver docs/tickets/T-004-pista-y-entrada.md,
 * seccion "Tests"). No participa del gameplay: nadie adentro del juego lee
 * de aca, solo el test lo consulta desde `page.evaluate`.
 */
interface GanchoDeDepuracion {
  clock: import('@tetra/audio').AudioClock;
  ctx: AudioContext;
  /** T-053: la ganancia de volumen por la que pasa la musica (el e2e comprueba que ajustes la afecta). */
  volumen: GainNode;
}

declare global {
  interface Window {
    __tetraDebug?: GanchoDeDepuracion;
  }
}

/**
 * T-019: combo minimo para que el combo se vea. Con 0 o 1 no hay racha que
 * mostrar.
 */
const COMBO_MINIMO_VISIBLE = 2;

/** Clase del destello al cortarse el combo (ver hud.css). */
const CLASE_COMBO_ROTO = 'tetra-combo--roto';

/**
 * Ultimo valor escrito en el DOM para cada dato del HUD. `actualizarHud` lo
 * consulta antes de tocar `textContent` o `style`: un valor que no cambio no
 * se vuelve a escribir (el HUD corre dentro del loop de juego, una vez por
 * frame). Los valores iniciales coinciden con lo que `crearHud` deja armado
 * en el DOM, asi el primer frame tampoco escribe de mas.
 */
interface CacheHud {
  /** Ultimo combo visto en el estado (para detectar subida y corte). */
  comboVisto: number;
  /** Ultimo combo escrito en el texto (no se reescribe al volver a 0: ver actualizarHud). */
  comboEscrito: number;
  comboVisible: boolean;
  /** `t` de reloj de juego del ultimo aumento del combo. */
  tSubida: number;
  escalaCombo: number;
  score: number;
  precision: number;
  hp: number;
  nivelVida: NivelDeVida;
  progreso: number;
  fps: number;
  decimasMs: number;
}

interface HudPartida {
  /** La capa `.tetra-hud`: de ella cuelgan tambien los contadores y los avisos de atajos (T-056). */
  raiz: HTMLElement;
  comboRaiz: HTMLElement;
  comboValor: HTMLElement;
  score: HTMLElement;
  precision: HTMLElement;
  vida: HTMLElement;
  vidaRelleno: HTMLElement;
  progresoRelleno: HTMLElement;
  fpsMs: HTMLElement | null;
  /** Se lee una sola vez al armar el HUD (prefers-reduced-motion). */
  reducirMovimiento: boolean;
  cache: CacheHud;
}

function crearElemento(etiqueta: string, clase: string, texto?: string): HTMLElement {
  const el = document.createElement(etiqueta);
  el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

/** Un dato del HUD, solo el valor (sin etiqueta: se entiende por su tamano y su lugar). */
function crearDato(
  modificador: string,
  inicial: string,
): { fila: HTMLElement; valor: HTMLElement } {
  const fila = crearElemento('div', `tetra-dato tetra-dato--${modificador}`);
  const valor = crearElemento('div', 'tetra-dato-valor', inicial);
  fila.appendChild(valor);
  return { fila, valor };
}

/**
 * Ensambla el HUD de la partida como DOM plano superpuesto a la pista (T-053):
 * combo centrado sobre la pista, precision arriba a la derecha de la pantalla
 * con el score chico debajo, vida fina pegada al borde derecho de la pista,
 * progreso como linea finisima arriba de todo, y FPS/ms opcional. El combo
 * maximo ya no se muestra aca: queda en los resultados. Nada de React aca (ver
 * CLAUDE.md, regla 4): un re-render de React a mitad de un stream es un frame
 * perdido, y este HUD se actualiza una vez por frame. Todos los elementos se
 * crean y se guardan aca, una sola vez: `actualizarHud` no hace
 * `querySelector` ni crea nodos.
 *
 * T-012 "Parte C": `mostrarFps` decide si el contador de FPS/ms se agrega
 * al DOM. Se lee una sola vez al armar el HUD (igual que el offset y la
 * velocidad mas abajo en runGame): no hay ajuste en caliente a mitad de
 * partida en el alcance de este ticket. Cuando esta apagado, `fpsMs` es
 * `null` y `actualizarHud` se lo salta entero, no solo lo oculta con CSS:
 * asi tampoco se paga el costo (minimo, pero real) de formatear el string
 * cada frame para un elemento que nadie va a ver.
 */
function crearHud(envoltorio: HTMLElement, mostrarFps: boolean): HudPartida {
  const hud = crearElemento('div', 'tetra-hud');

  // Progreso: linea finisima arriba de todo.
  const progreso = crearElemento('div', 'tetra-progreso');
  const progresoRelleno = crearElemento('div', 'tetra-progreso-relleno');
  progreso.appendChild(progresoRelleno);

  // Combo: oculto hasta COMBO_MINIMO_VISIBLE (opacity 0 por CSS).
  const comboRaiz = crearElemento('div', 'tetra-combo');
  const comboValor = crearElemento('span', 'tetra-combo-valor', '0');
  comboRaiz.append(comboValor);

  // Precision grande y score chico debajo, arriba a la derecha de la pantalla.
  const precision = crearDato('precision', formatearPrecision(0));
  const score = crearDato('score', formatearScore(0));
  const datos = crearElemento('div', 'tetra-hud-datos');
  datos.append(precision.fila, score.fila);

  // Vida: barra vertical pegada al borde derecho de la pista.
  const vida = crearElemento('div', 'tetra-vida');
  vida.dataset.nivel = 'ok';
  const vidaRelleno = crearElemento('div', 'tetra-vida-relleno');
  vida.appendChild(vidaRelleno);

  hud.append(progreso, comboRaiz, datos, vida);

  const fpsMs = mostrarFps ? crearElemento('div', 'tetra-fps') : null;
  if (fpsMs) hud.appendChild(fpsMs);
  envoltorio.appendChild(hud);

  // El destello del combo se limpia solo al terminar su animacion: un
  // listener fijo, no un temporizador.
  comboRaiz.addEventListener('animationend', () => {
    comboRaiz.classList.remove(CLASE_COMBO_ROTO);
  });

  return {
    raiz: hud,
    comboRaiz,
    comboValor,
    score: score.valor,
    precision: precision.valor,
    vida,
    vidaRelleno,
    progresoRelleno,
    fpsMs,
    reducirMovimiento: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    cache: {
      comboVisto: 0,
      comboEscrito: 0,
      comboVisible: false,
      tSubida: Number.NEGATIVE_INFINITY,
      escalaCombo: 1,
      score: 0,
      precision: 0,
      hp: 1,
      nivelVida: 'ok',
      progreso: 0,
      fps: -1,
      decimasMs: -1,
    },
  };
}

/**
 * Pasa el estado de la partida al DOM, escribiendo solo lo que cambio desde
 * el frame anterior (ver `CacheHud`). `t` es el tiempo de este frame, de
 * `clock.now()`: el pulso del combo y el progreso se miden con el, nunca con
 * `performance.now()` ni con el delta de rAF (ver CLAUDE.md, "El reloj es el
 * audio"). `duracion` es `clock.duration`.
 */
function actualizarHud(
  hud: HudPartida,
  estado: ScoreState,
  t: number,
  duracion: number,
  msPorFrame: number,
): void {
  const cache = hud.cache;

  // Combo: cambia pocas veces por segundo.
  const combo = estado.combo;
  if (combo !== cache.comboVisto) {
    if (combo > cache.comboVisto) {
      cache.tSubida = t;
    } else if (
      combo === 0 &&
      cache.comboVisto >= COMBO_MINIMO_VISIBLE &&
      !hud.reducirMovimiento
    ) {
      hud.comboRaiz.classList.add(CLASE_COMBO_ROTO);
    }
    cache.comboVisto = combo;
    // Al cortarse (combo 0) el texto se deja como estaba: el destello de
    // corte muestra el ultimo numero que se tenia, y el elemento ya esta
    // oculto por opacidad. Se reescribe en cuanto vuelve a subir.
    if (combo > 0 && combo !== cache.comboEscrito) {
      hud.comboValor.textContent = String(combo);
      cache.comboEscrito = combo;
    }
    const visible = combo >= COMBO_MINIMO_VISIBLE;
    if (visible !== cache.comboVisible) {
      cache.comboVisible = visible;
      hud.comboRaiz.style.opacity = visible ? '1' : '0';
    }
  }

  // Pulso del combo: la escala depende de t, asi que se evalua cada frame,
  // pero solo se escribe mientras cambia (120 ms por subida) y no en reposo.
  const escala = hud.reducirMovimiento ? 1 : escalaPulsoCombo(t - cache.tSubida);
  if (escala !== cache.escalaCombo) {
    cache.escalaCombo = escala;
    hud.comboValor.style.transform =
      escala === 1 ? 'none' : `scale(${escala.toFixed(3)})`;
  }

  if (estado.score !== cache.score) {
    cache.score = estado.score;
    hud.score.textContent = formatearScore(estado.score);
  }
  if (estado.accuracy !== cache.precision) {
    cache.precision = estado.accuracy;
    hud.precision.textContent = formatearPrecision(estado.accuracy);
  }

  // Vida: scaleY con origen abajo (no `height`, para no forzar layout). El
  // nivel de alerta solo se reescribe cuando cambia de nivel.
  const hp = Math.min(1, Math.max(0, estado.hp));
  if (hp !== cache.hp) {
    cache.hp = hp;
    hud.vidaRelleno.style.transform = `scaleY(${hp})`;
    const nivel = nivelDeVida(hp);
    if (nivel !== cache.nivelVida) {
      cache.nivelVida = nivel;
      hud.vida.dataset.nivel = nivel;
    }
  }

  // Progreso: se cuantiza a milesimas. A 180 s de cancion una milesima son
  // 180 ms, muy por debajo de un pixel de una barra de ~440 px, y evita
  // reescribir el style en cada frame.
  const progreso = Math.round(fraccionProgreso(t, duracion) * 1000) / 1000;
  if (progreso !== cache.progreso) {
    cache.progreso = progreso;
    hud.progresoRelleno.style.transform = `scaleX(${progreso})`;
  }

  if (!hud.fpsMs) return; // T-012 "Parte C": el interruptor de FPS esta apagado.
  // fps y ms salen de la diferencia entre el t de este frame y el anterior,
  // los dos leidos de clock.now(): ni performance.now() ni el delta de rAF
  // entran en este calculo (ver CLAUDE.md, "El reloj es el audio"). Es una
  // consecuencia practica de la misma regla: como el juego ya lee el reloj
  // de audio cada frame para todo lo demas, ese mismo valor sirve tambien
  // para el contador de fps, sin necesidad de otra fuente de tiempo. Se
  // comparan enteros (fps y decimas de ms) antes de armar el string.
  const fps = msPorFrame > 0 ? Math.round(1000 / msPorFrame) : 0;
  const decimasMs = Math.round(msPorFrame * 10);
  if (fps !== cache.fps || decimasMs !== cache.decimasMs) {
    cache.fps = fps;
    cache.decimasMs = decimasMs;
    hud.fpsMs.textContent = `${fps} fps / ${(decimasMs / 10).toFixed(1)} ms`;
  }
}

/**
 * T-035: opciones de una partida que no son el mapa ni el audio ni la skin.
 * Todas opcionales: quien no las pasa juega el mapa completo, como siempre.
 */
export interface OpcionesPartida {
  /** Empieza la partida en este instante (ms) de la cancion, con el aire de siempre antes de la primera nota. */
  inicioMs?: Ms;
  /** T-053: fondo, video e intro de la cancion (y el fondo de los resultados). Sin esto, la partida se ve como siempre. */
  escena?: EscenaPartida;
  /**
   * T-057: offset de esta cancion en ms, que se suma al global en el reloj. Con
   * `idCancion`, "Corregir offset" de los resultados ajusta este (aunque sea 0)
   * y no el global. Sin alguno de los dos, se corrige el global como siempre.
   */
  offsetLocal?: Ms;
  /** T-057: id de la cancion de la biblioteca, para guardar su offset local. */
  idCancion?: string;
}

export type { EscenaPartida };

/**
 * T-009: `skin` son texturas ya resueltas (ver @tetra/engine,
 * `cargarTexturasDeSkin`), no el .osk crudo ni los Blob que guarda
 * @tetra/storage. Quien las pasa es dueno de ellas y las libera.
 *
 * T-053: si `skin` es `undefined`, la partida resuelve la skin activa por su
 * cuenta (`resolverSkinDePartida`, ver skin-activa.ts) con el ancho de carril
 * real de la pista, y libera esas texturas al terminar (completada, abortada
 * o reintentada): el playfield no las destruye.
 */
export function runGame(
  chartCompleto: Chart,
  audio: AudioBuffer,
  skin?: TexturasDeSkin,
  opciones: OpcionesPartida = {},
): Promise<ResultadoPartida> {
  // T-035: arrancar a mitad del mapa. Solo cuentan (y se dibujan) las notas
  // desde `inicioMs`; las anteriores no generan miss.
  const inicioMs = opciones.inicioMs ?? 0;
  const chart = filtrarNotasDesde(chartCompleto, inicioMs);
  return new Promise((resolve, reject) => {
    const elementoApp = document.getElementById('app');
    if (!elementoApp) {
      reject(new Error('No se encontro el elemento #app en el documento.'));
      return;
    }
    // Se recorta a una constante nueva, tipada sin null: el guard de arriba
    // ya lo garantiza, pero TypeScript no propaga ese angostamiento dentro
    // de las funciones anidadas declaradas mas abajo (finalizar(), el
    // callback de app.init()), asi que se fija el tipo una sola vez aca.
    const contenedor: HTMLElement = elementoApp;
    contenedor.innerHTML = '';
    document.body.classList.add(CLASE_EN_JUEGO);

    // T-008: la velocidad se lee al arrancar. Desde T-057 F3/F4 la cambian en
    // caliente: mutan `opcionesPista.scrollDuration`, que el playfield lee por
    // referencia en cada render (ver manejarVelocidad mas abajo).
    let velocidadActual = leerVelocidad();
    const medidasIniciales = medidasDePista(window.innerHeight);
    const opcionesPista: PlayfieldOptions = {
      height: medidasIniciales.alto,
      columnWidth: medidasIniciales.anchoCarril,
      receptorOffset: medidasIniciales.receptorOffset,
      scrollDuration: velocidadAScrollDuration(velocidadActual),
    };
    const escena = opciones.escena;
    const atenuacion = leerAtenuacion();
    const usarVideo = leerVideoDeFondo();

    // T-019: envoltorio relativo que contiene el lienzo de Pixi y el HUD
    // superpuesto (ver hud.css, `.tetra-partida`).
    const partida = document.createElement('div');
    partida.className = 'tetra-partida';
    partida.style.setProperty('--ancho-carril', `${opcionesPista.columnWidth}px`);
    partida.style.setProperty('--receptor-offset', `${opcionesPista.receptorOffset}px`);
    const lienzo = document.createElement('div');
    lienzo.className = 'tetra-lienzo';
    partida.appendChild(lienzo);
    const hud = crearHud(partida, leerMostrarFps());
    // T-053: el fondo de la cancion va detras de todo (primer hijo); la intro, encima.
    const fondo = crearFondoDePartida(partida, escena, { atenuacion, usarVideo });
    const intro = crearIntroDePartida(
      partida,
      escena,
      inicioMs > 0 ? inicioDeLaCancion(inicioMs, LEAD_IN_MS) : 0,
    );
    // Con fondo propio la pista deja ver la imagen; sin el, el lienzo lleva su superficie de siempre.
    const hayFondoVisible = fondo !== null;
    partida.classList.toggle('tetra-partida--sin-fondo', !hayFondoVisible);
    contenedor.appendChild(partida);

    // Contexto de audio dedicado a la reproduccion y al reloj de juego. El
    // contexto usado para decodificar el archivo (en main.ts) es otro: son
    // dos AudioContext separados, uno de decodificacion y uno de
    // reproduccion (ver el reporte de T-004, "Decisiones no cubiertas por
    // el ticket").
    const ctx = new AudioContext();
    // T-007: el offset se calibra en ajustes.ts y se guarda con
    // apps/web/src/offset.ts; al arrancar una partida se lee y se pasa
    // como userOffset, para que el reloj arranque ya corregido en vez de
    // con el offset en 0 de siempre.
    // T-053: el volumen de la musica (ajustes) se aplica con una ganancia entre
    // el reloj y la salida; el reloj no sabe de volumen, su posicion no cambia.
    const volumen = ctx.createGain();
    volumen.gain.value = gananciaDeVolumen(leerVolumen());
    volumen.connect(ctx.destination);
    // T-057: el offset local de la cancion se suma al global.
    const offsetGlobal = leerOffset();
    const offsetLocal = opciones.offsetLocal;
    const idCancion = opciones.idCancion;
    const clock = createAudioClock(ctx, audio, {
      userOffset: offsetGlobal + (offsetLocal ?? 0),
      destino: volumen,
    });
    // Que corrige "Corregir offset" de los resultados: el local de la cancion
    // si la partida trajo uno (aunque sea 0), si no el global.
    const correccionDeOffset: CorreccionDeOffset =
      offsetLocal !== undefined && idCancion !== undefined
        ? { actual: offsetLocal, guardar: (ms) => guardarOffsetLocal(idCancion, ms), local: true }
        : {
            actual: offsetGlobal,
            guardar: (ms) => {
              guardarOffset(ms);
              return ms;
            },
            local: false,
          };
    const engine = createJudgeEngine(chart);
    window.__tetraDebug = { clock, ctx, volumen };

    // T-056: el remapeo se lee una vez, igual que el offset y la velocidad; lo
    // usan la entrada, las cajitas de teclas y los atajos (que no pisan una
    // tecla de columna).
    const keyMap = leerKeyMap();
    const contadores = crearContadores(hud.raiz, {
      teclas: leerMostrarTeclas(),
      juicios: leerMostrarJuicios(),
      barraDeError: leerMostrarBarraDeError(),
      etiquetasDeTeclas: keyMap.map(nombreLegibleDeCodigo),
      ventanas: windowsForOD(chart.overallDifficulty),
    });
    const avisos = crearAvisosDeAtajos(hud.raiz);
    // Pulsaciones reales (keydown, sin repeticion) por columna, para los resultados.
    const pulsaciones: number[] = [0, 0, 0, 0];
    // Primera nota que se juega: de ella salen el aviso y el destino del salto de intro.
    const primeraNota: Ms | undefined = chart.notes[0]?.time;
    let introSaltada = false;
    // Reintento mantenido: instante de juego del keydown de la tecla, o null si no se mantiene.
    let reintentoDesde: Ms | null = null;
    // T-057: instante de juego (clock.now()) del ultimo cambio de velocidad, o null sin aviso a la vista.
    let avisoVelocidadDesde: Ms | null = null;

    const desviaciones: Desviacion[] = [];
    function registrar(resultado: HitResult | null, t: Ms): void {
      if (resultado === null) return;
      desviaciones.push({
        time: resultado.note.time,
        error: resultado.error,
        judgement: resultado.judgement,
      });
      contadores.golpe(resultado.error, resultado.judgement, t);
    }

    // T-004, "El punto critico: el tiempo de la pulsacion":
    // toGameTime(ts) = clock.now() - (performance.now() - ts)
    // Es la unica lectura de performance.now() permitida en el proyecto:
    // mide cuanto hace que ocurrio el evento de teclado, no el paso del
    // tiempo de juego (eso sigue siendo responsabilidad exclusiva del
    // reloj de audio).
    const toGameTime = (eventTimeStamp: number): Ms => {
      // eslint-disable-next-line no-restricted-properties -- unica lectura permitida de performance.now() en todo el proyecto: T-004, "El punto critico: el tiempo de la pulsacion". Mide la antiguedad del evento de teclado (event.timeStamp), no el paso del tiempo de juego.
      const ahora = performance.now();
      return clock.now() - (ahora - eventTimeStamp);
    };

    const app = new Application();
    let detenido = false;
    let rafId = 0;

    let input: ReturnType<typeof createKeyboardInput> | null = null;
    // Se guarda aparte de la `const playfield` local de mas abajo (dentro de
    // app.init().then()): esta referencia es la que usan finalizar() y
    // abortar() para limpiar, declarada afuera porque las dos pueden correr
    // antes de que el `.then()` termine de armar la pista.
    let playfieldParaLimpieza: ReturnType<typeof createPlayfield> | null = null;
    // T-053: si quien llama no paso skin, las texturas las pedimos nosotros y las
    // liberamos al terminar. Se piden ya, en paralelo con app.init(), al ancho de
    // carril real de la pista.
    const skinPropiaPendiente: Promise<TexturasDeSkin> | null =
      skin === undefined ? resolverSkinDePartida(opcionesPista.columnWidth) : null;
    let skinPropiaLiberada = false;
    function liberarSkinPropia(): void {
      if (skinPropiaPendiente === null || skinPropiaLiberada) return;
      skinPropiaLiberada = true;
      // Despues de playfield.destroy(): asi ningun sprite las usa cuando se destruyen.
      void skinPropiaPendiente.then(liberarTexturasDeSkin);
    }

    let ultimoT = inicioMs > 0 ? inicioDeLaCancion(inicioMs, LEAD_IN_MS) : -LEAD_IN_MS;
    // true desde que app.init() resuelve: distingue, dentro de abortar(), si
    // ya hay que destruir la Application de Pixi (partida en curso) o si
    // todavia esta inicializando y el callback de mas abajo se va a
    // encargar solo (ver el `if (detenido)` dentro de app.init().then()).
    let appInicializada = false;

    function limpiar(): void {
      detenido = true;
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      // Tiempo de cancion que corrio de verdad (el lead-in da now() negativo
      // y sumarTiempoJugado lo ignora). Se lee antes de clock.stop(). Si el
      // almacenamiento falla no debe impedir cerrar la partida.
      try {
        // Desde un inicio a mitad de mapa solo cuenta lo que corrio desde ahi.
        const desdeMs = inicioMs > 0 ? inicioDeLaCancion(inicioMs, LEAD_IN_MS) : 0;
        sumarTiempoJugado(Math.min(clock.now(), clock.duration) - desdeMs);
        window.dispatchEvent(new Event(EVENTO_TIEMPO_JUGADO));
      } catch {
        // el header simplemente no se actualiza.
      }
      document.body.classList.remove(CLASE_EN_JUEGO);
      cerrarCuenta();
      menuPausa?.destruir();
      menuPausa = null;
      fondo?.destruir();
      intro?.destruir();
      clock.stop();
      input?.destroy();
      window.removeEventListener('keydown', manejarEscape);
      window.removeEventListener('keydown', manejarAtajoAbajo);
      window.removeEventListener('keyup', manejarAtajoArriba);
      window.removeEventListener('keydown', manejarVelocidad);
      window.removeEventListener('blur', cancelarReintento);
      window.removeEventListener('resize', ajustarAlVentana);
      volumen.disconnect();
      delete window.__tetraDebug;
      void ctx.close().catch(() => {
        // cerrar el contexto es best-effort: si el navegador ya lo cerro
        // (por ejemplo al navegar fuera de la pagina) no hay nada que hacer.
      });
    }

    function finalizar(): void {
      if (detenido) return;
      const estadoFinal = { ...engine.state, counts: { ...engine.state.counts } };
      limpiar();
      playfieldParaLimpieza?.destroy();
      liberarSkinPropia();
      app.destroy(true, { children: true });
      contenedor.innerHTML = '';
      mostrarResultados(
        contenedor,
        estadoFinal,
        desviaciones,
        correccionDeOffset,
        escena,
        pulsaciones,
      );
      resolve({
        estado: 'completado',
        score: estadoFinal,
        pulsaciones: pulsaciones.slice(),
        desviaciones,
      });
    }

    /**
     * T-008, "Parte B": Escape a mitad de partida. La limpieza es la misma
     * que hace finalizar() (reloj, input, contexto de audio), mas
     * `playfield.destroy()` y `app.destroy()`, pero SIN pintar resultados:
     * una partida abandonada no tiene un resultado que valga la pena
     * mostrar (ver el ticket). song-select.ts (su funcion `jugar`) es quien
     * decide volver al song select al ver `estado: 'abortado'`, no este
     * archivo: game.ts no importa song-select.ts (seria una dependencia
     * circular, ya que song-select.ts es quien importa de aca).
     */
    function abortar(): void {
      if (detenido) return;
      limpiar();
      if (appInicializada) {
        playfieldParaLimpieza?.destroy();
        app.destroy(true, { children: true });
      }
      liberarSkinPropia();
      // Si todavia no terminaba app.init(), el `.then()` de mas abajo ve
      // `detenido` en true apenas resuelve y destruye la app ahi: no hace
      // falta hacer nada mas con ella desde aca.
      contenedor.innerHTML = '';
      resolve({ estado: 'abortado' });
    }

    // T-026: pausa. Al pausar se suspende el AudioContext del juego, y su
    // currentTime (el reloj de juego) se congela solo: no se mide la pausa con
    // ningun temporizador. La cuenta regresiva se mide con el reloj de OTRO
    // AudioContext. Las pulsaciones hechas durante la pausa se descartan.
    let fase: FasePausa = 'jugando';
    let menuPausa: MenuPausa | null = null;
    let ctxCuenta: AudioContext | null = null;
    let cuentaRafId = 0;
    let cuentaInicio = 0;
    // Lo asigna app.init().then(): programa el siguiente frame del bucle de juego.
    let reanudarBucle: (() => void) | null = null;
    // Para poner en reposo las teclas visuales al reanudar; lo asigna app.init().then().
    let soltarTeclas: (() => void) | null = null;

    function cerrarCuenta(): void {
      if (cuentaRafId !== 0) {
        cancelAnimationFrame(cuentaRafId);
        cuentaRafId = 0;
      }
      if (ctxCuenta) {
        void ctxCuenta.close().catch(() => {
          // best-effort, igual que el contexto del juego.
        });
        ctxCuenta = null;
      }
    }

    function pausar(): void {
      if (detenido || !appInicializada) return;
      const siguiente = transicionPausa(fase, 'pausar');
      if (siguiente === null) return;
      fase = siguiente;
      cancelarReintento();
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      void ctx.suspend();
      fondo?.pausar();
      menuPausa = crearMenuPausa(partida, {
        continuar: () => iniciarCuenta(),
        reintentar: () => reintentar(),
        salir: () => abortar(),
      });
      menuPausa.mostrarMenu();
    }

    function iniciarCuenta(): void {
      const siguiente = transicionPausa(fase, 'continuar');
      if (siguiente === null || !menuPausa) return;
      fase = siguiente;
      ctxCuenta = new AudioContext();
      cuentaInicio = ctxCuenta.currentTime;
      menuPausa.mostrarCuenta(numeroDeCuenta(0));
      const pasoDeCuenta = (): void => {
        if (!ctxCuenta || !menuPausa || fase !== 'cuenta') return;
        const numero = numeroDeCuenta(ctxCuenta.currentTime - cuentaInicio);
        if (numero === 0) {
          reanudar();
          return;
        }
        menuPausa.mostrarCuenta(numero);
        // eslint-disable-next-line no-restricted-globals -- solo dibuja el numero de la cuenta; el tiempo sale del currentTime de un AudioContext (CLAUDE.md, "El reloj es el audio").
        cuentaRafId = requestAnimationFrame(pasoDeCuenta);
      };
      // eslint-disable-next-line no-restricted-globals -- ver comentario dentro de pasoDeCuenta().
      cuentaRafId = requestAnimationFrame(pasoDeCuenta);
    }

    function volverAPausa(): void {
      const siguiente = transicionPausa(fase, 'volver');
      if (siguiente === null) return;
      fase = siguiente;
      cerrarCuenta();
      menuPausa?.mostrarMenu();
    }

    function reanudar(): void {
      const siguiente = transicionPausa(fase, 'cuentaTerminada');
      if (siguiente === null) return;
      fase = siguiente;
      cerrarCuenta();
      menuPausa?.destruir();
      menuPausa = null;
      // Lo pulsado durante la pausa no cuenta: se vacia la entrada y se sueltan
      // las teclas dibujadas.
      input?.drain();
      soltarTeclas?.();
      void ctx.resume().then(() => {
        if (detenido) return;
        fondo?.reanudar();
        ultimoT = clock.now();
        reanudarBucle?.();
      });
    }

    /** T-026: Reintentar. Limpia como abortar() y avisa para que quien llamo vuelva a jugar. */
    function reintentar(): void {
      if (detenido) return;
      cerrarCuenta();
      limpiar();
      if (appInicializada) {
        playfieldParaLimpieza?.destroy();
        app.destroy(true, { children: true });
      }
      liberarSkinPropia();
      contenedor.innerHTML = '';
      resolve({ estado: 'reintentar' });
    }

    function manejarEscape(evento: KeyboardEvent): void {
      if (evento.key !== 'Escape') return;
      if (!appInicializada) {
        // Todavia cargando: no hay nada que pausar, se abandona como antes.
        abortar();
        return;
      }
      if (fase === 'jugando') pausar();
      else if (fase === 'pausado') iniciarCuenta();
      else if (fase === 'cuenta') volverAPausa();
    }
    // Escuchado desde ya, no solo despues de que arranque la partida: se
    // puede abortar incluso mientras app.init() todavia esta cargando.
    window.addEventListener('keydown', manejarEscape);

    // T-056: atajos. Mantener ` (Backquote) 0,5 s reintenta; Espacio salta la
    // intro. Nada de temporizadores: el keydown se fecha con `event.timeStamp`
    // (convertido al reloj de juego con toGameTime) y el bucle de juego mide
    // cuanto se lleva mantenida con `clock.now()`. Una tecla asignada a una
    // columna no dispara el atajo: la columna manda.
    function cancelarReintento(): void {
      reintentoDesde = null;
      avisos.mostrarReintento(0);
    }

    function manejarAtajoAbajo(evento: KeyboardEvent): void {
      if (evento.repeat || detenido || !appInicializada || fase !== 'jugando') return;
      if (keyMap.includes(evento.code)) return;
      if (evento.code === 'Backquote') {
        evento.preventDefault();
        reintentoDesde = toGameTime(evento.timeStamp);
      } else if (evento.code === 'Space') {
        evento.preventDefault();
        saltarIntro();
      }
    }

    function manejarAtajoArriba(evento: KeyboardEvent): void {
      if (evento.code === 'Backquote') cancelarReintento();
    }

    /** Pone el reloj 2 s antes de la primera nota. El video sigue al reloj solo (fondo.sincronizar). */
    function saltarIntro(): void {
      if (introSaltada || primeraNota === undefined) return;
      if (!saltoDisponible(clock.now(), primeraNota)) return;
      introSaltada = true;
      clock.seek(destinoDelSalto(primeraNota));
      // El frame siguiente no debe medir los segundos saltados como un frame lento.
      ultimoT = clock.now();
      avisos.mostrarSalto(false);
    }

    // T-057: F3 baja y F4 sube la velocidad de caida, con efecto inmediato. El
    // aviso se mide con clock.now() (el bucle de juego lo desvanece). Una tecla
    // asignada a una columna no dispara el atajo. F3/F4 hacen otras cosas en el
    // navegador (buscar, etc.): durante la partida se les quita.
    function manejarVelocidad(evento: KeyboardEvent): void {
      if (evento.code !== 'F3' && evento.code !== 'F4') return;
      if (detenido || keyMap.includes(evento.code)) return;
      evento.preventDefault();
      if (evento.repeat || !appInicializada || fase !== 'jugando') return;
      const nueva = moverVelocidad(velocidadActual, evento.code === 'F4' ? 1 : -1);
      if (nueva !== velocidadActual) {
        velocidadActual = nueva;
        opcionesPista.scrollDuration = velocidadAScrollDuration(nueva);
        try {
          guardarVelocidad(nueva);
        } catch {
          // Sin almacenamiento la velocidad vale solo para esta partida.
        }
      }
      // Aunque este en el tope se avisa: el jugador ve que ya no puede ir mas alla.
      avisoVelocidadDesde = clock.now();
      avisos.mostrarVelocidad(textoDeAvisoDeVelocidad(nueva), pasoDeAlphaDeAvisoDeVelocidad(0));
    }

    window.addEventListener('keydown', manejarAtajoAbajo);
    window.addEventListener('keydown', manejarVelocidad);
    window.addEventListener('keyup', manejarAtajoArriba);
    // Perder el foco con la tecla apretada: el keyup no llega, el aro no debe quedar colgado.
    window.addEventListener('blur', cancelarReintento);

    // T-053: la pista ocupa el alto de la ventana. Al redimensionar se recalculan
    // las medidas y se le avisa al renderer y al playfield. Los dibujos de la
    // skin se hicieron para el ancho de carril inicial: si la ventana cambia
    // mucho se escalan un poco, no se vuelven a dibujar en caliente.
    function ajustarAlVentana(): void {
      if (detenido || !appInicializada) return;
      const medidas = medidasDePista(window.innerHeight);
      opcionesPista.height = medidas.alto;
      opcionesPista.columnWidth = medidas.anchoCarril;
      opcionesPista.receptorOffset = medidas.receptorOffset;
      partida.style.setProperty('--ancho-carril', `${medidas.anchoCarril}px`);
      partida.style.setProperty('--receptor-offset', `${medidas.receptorOffset}px`);
      app.renderer.resize(medidas.anchoCarril * 4, medidas.alto);
      playfieldParaLimpieza?.resize(medidas.anchoCarril * 4, medidas.alto);
    }
    window.addEventListener('resize', ajustarAlVentana);

    Promise.all([
      app.init({
        width: opcionesPista.columnWidth * 4,
        height: opcionesPista.height,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      }),
      skinPropiaPendiente ?? Promise.resolve(skin),
    ])
      .then(([, texturasDeSkin]) => {
        appInicializada = true;
        if (detenido) {
          // Se pidio abortar mientras se inicializaba: abortar() no pudo
          // destruir la Application porque todavia no existia del todo (ver
          // appInicializada arriba), asi que se hace aca apenas esta lista.
          app.destroy(true, { children: true });
          return;
        }

        lienzo.appendChild(app.canvas);
        // Con fondo de cancion la pista se vuelve mas transparente cuanto mas se atenua.
        const playfield = createPlayfield(
          app,
          chart,
          opcionesPista,
          texturasDeSkin,
          hayFondoVisible ? { opacidadPista: opacidadDePistaSegunAtenuacion(atenuacion) } : undefined,
        );
        playfieldParaLimpieza = playfield;
        // La ventana pudo cambiar de tamano mientras cargaba.
        ajustarAlVentana();
        input = createKeyboardInput(window, toGameTime);
        // T-012 "Parte B": el remapeo de teclas se edita en ajustes.ts y se
        // persiste con apps/web/src/keymap.ts; se lee y se aplica aca, una
        // sola vez al arrancar la partida, mismo momento que el offset y la
        // velocidad de arriba.
        input.setKeyMap(keyMap);

        if (inicioMs > 0) {
          // T-035: arranca la cancion LEAD_IN_MS antes del inicio pedido (con la
          // musica sonando, en vez del silencio de siempre). start(0) y seek en
          // el mismo tick: el primer source se corta antes de sonar.
          clock.start(0);
          clock.seek(inicioDeLaCancion(inicioMs, LEAD_IN_MS));
        } else {
          clock.start(LEAD_IN_MS);
        }

        function frame(): void {
          if (detenido) return;

          // 1. El reloj.
          const t = clock.now();

          // El reintento mantenido se mide contra el reloj, desde el keydown.
          if (reintentoDesde !== null) {
            const mantenidoMs = t - reintentoDesde;
            if (reintentoCompleto(mantenidoMs)) {
              reintentar();
              return;
            }
            avisos.mostrarReintento(progresoDeReintento(mantenidoMs));
          }

          // El aviso de velocidad se desvanece solo, medido contra el reloj.
          if (avisoVelocidadDesde !== null) {
            const paso = pasoDeAlphaDeAvisoDeVelocidad(t - avisoVelocidadDesde);
            avisos.mostrarVelocidad(textoDeAvisoDeVelocidad(velocidadActual), paso);
            if (paso === 0) avisoVelocidadDesde = null;
          }

          // 2. La entrada, despachada con el tiempo de cada evento (no con t).
          for (const evento of input!.drain()) {
            if (evento.type === 'down') {
              const total = (pulsaciones[evento.column] ?? 0) + 1;
              pulsaciones[evento.column] = total;
              contadores.teclaAbajo(evento.column, total);
              playfield.setPressed(evento.column, true);
              const resultado = engine.press(evento.time, evento.column);
              if (resultado) playfield.showJudgement(evento.column, resultado.judgement);
              registrar(resultado, t);
            } else {
              contadores.teclaArriba(evento.column);
              playfield.setPressed(evento.column, false);
              const resultado = engine.release(evento.time, evento.column);
              if (resultado) playfield.showJudgement(evento.column, resultado.judgement);
              registrar(resultado, t);
            }
          }

          // 3. El juicio: misses por tiempo, una vez por frame.
          for (const resultado of engine.update(t)) {
            playfield.showJudgement(resultado.note.column, resultado.judgement);
            registrar(resultado, t);
          }

          // 4. El dibujo.
          playfield.render(t);
          // El video de fondo se pone en hora contra el reloj de audio (y la intro se desvanece con el).
          fondo?.sincronizar(t);
          intro?.actualizar(t);

          // 5. El HUD.
          actualizarHud(hud, engine.state, t, clock.duration, t - ultimoT);
          contadores.actualizar(t, engine.state.counts);
          avisos.mostrarSalto(!introSaltada && saltoDisponible(t, primeraNota));
          ultimoT = t;

          if (engine.finished || t >= clock.duration) {
            finalizar();
            return;
          }

          // rAF programa el PROXIMO frame de dibujo; no se lee su
          // timestamp ni se acumula su delta para nada de timing (eso
          // sigue siendo clock.now() en el paso 1). Ver CLAUDE.md, "rAF
          // sirve para dibujar, nunca para medir tiempo de juego".
          // eslint-disable-next-line no-restricted-globals -- se usa solo para programar el siguiente frame de dibujo, nunca para medir tiempo (ver CLAUDE.md, "El reloj es el audio").
          rafId = requestAnimationFrame(frame);
        }

        // T-026: lo que necesita la pausa para reanudar este mismo bucle.
        reanudarBucle = () => {
          // eslint-disable-next-line no-restricted-globals -- ver comentario dentro de frame().
          rafId = requestAnimationFrame(frame);
        };
        soltarTeclas = () => {
          for (const columna of [0, 1, 2, 3] as const) playfield.setPressed(columna, false);
          contadores.soltarTeclas();
        };

        // eslint-disable-next-line no-restricted-globals -- ver comentario dentro de frame().
        rafId = requestAnimationFrame(frame);
      })
      .catch((error: unknown) => {
        limpiar();
        liberarSkinPropia();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}
