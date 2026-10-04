// T-004: bucle de juego. Ensambla el reloj (packages/audio), el motor de
// juicio (packages/core) y el render + entrada (packages/engine). Es la
// unica pieza de todo el repo que puede tocar el navegador sin
// restricciones (ver CLAUDE.md, reglas 2 y 3): packages/core no puede
// importar nada de esto, y packages/audio y packages/engine no conocen la
// existencia del DOM salvo lo que reciben inyectado.

import { Application } from 'pixi.js';
import type { Chart, HitResult, Ms, ScoreState } from '@tetra/core';
import { createJudgeEngine } from '@tetra/core';
import { createAudioClock } from '@tetra/audio';
import {
  createKeyboardInput,
  createPlayfield,
  type PlayfieldOptions,
  type TexturasDeSkin,
} from '@tetra/engine';
import { mostrarResultados, type Desviacion } from './results.js';
import { leerOffset } from './offset.js';
import { leerVelocidad, velocidadAScrollDuration } from './velocidad.js';
import { leerKeyMap } from './keymap.js';
import { leerMostrarFps } from './graficos.js';
import { CLASE_EN_JUEGO, EVENTO_TIEMPO_JUGADO } from './header.js';
import { sumarTiempoJugado } from './tiempo-jugado.js';
import { crearMenuPausa, type MenuPausa } from './pausa.js';
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
// arrancar la partida, igual que el offset. El resto de PlayfieldOptions
// (tamano de pista, ancho de columna) si sigue fijo: no hay ticket que pida
// hacerlo configurable.
const OPCIONES_PISTA_BASE = {
  height: 600,
  columnWidth: 110,
  receptorOffset: 120,
} as const;

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
  | { readonly estado: 'completado'; readonly score: ScoreState }
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
  comboMax: number;
  hp: number;
  nivelVida: NivelDeVida;
  progreso: number;
  fps: number;
  decimasMs: number;
}

interface HudPartida {
  comboRaiz: HTMLElement;
  comboValor: HTMLElement;
  score: HTMLElement;
  precision: HTMLElement;
  comboMax: HTMLElement;
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

/** Un dato con etiqueta chica arriba y valor abajo; devuelve fila y valor. */
function crearDato(
  modificador: string,
  etiqueta: string,
  inicial: string,
): { fila: HTMLElement; valor: HTMLElement } {
  const fila = crearElemento('div', `tetra-dato tetra-dato--${modificador}`);
  const valor = crearElemento('div', 'tetra-dato-valor', inicial);
  fila.append(crearElemento('div', 'tetra-dato-etiqueta', etiqueta), valor);
  return { fila, valor };
}

/**
 * Ensambla el HUD de la partida como DOM plano superpuesto a la pista: combo
 * grande sobre la pista, precision / score / combo maximo y vida al costado,
 * progreso de la cancion arriba, y FPS/ms opcional. Nada de React aca (ver
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

  // Progreso: barra fina arriba de la pista.
  const progreso = crearElemento('div', 'tetra-progreso');
  const progresoRelleno = crearElemento('div', 'tetra-progreso-relleno');
  progreso.appendChild(progresoRelleno);

  // Combo: oculto hasta COMBO_MINIMO_VISIBLE (opacity 0 por CSS).
  const comboRaiz = crearElemento('div', 'tetra-combo');
  const comboValor = crearElemento('span', 'tetra-combo-valor', '0');
  comboRaiz.append(comboValor, crearElemento('span', 'tetra-combo-etiqueta', 'Combo'));

  // Precision, score y combo maximo: columna a la derecha de la pista.
  const precision = crearDato('precision', 'Precision', formatearPrecision(0));
  const score = crearDato('score', 'Score', formatearScore(0));
  const comboMax = crearDato('combo-max', 'Combo max', '0');
  const datos = crearElemento('div', 'tetra-hud-datos');
  datos.append(precision.fila, score.fila, comboMax.fila);

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
    comboRaiz,
    comboValor,
    score: score.valor,
    precision: precision.valor,
    comboMax: comboMax.valor,
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
      comboMax: 0,
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
  if (estado.maxCombo !== cache.comboMax) {
    cache.comboMax = estado.maxCombo;
    hud.comboMax.textContent = String(estado.maxCombo);
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
 * T-009: `skin` son texturas ya resueltas (ver @tetra/engine,
 * `cargarTexturasDeSkin`), no el .osk crudo ni los Blob que guarda
 * @tetra/storage: quien llama (song-select.ts, ver
 * `resolverTexturasDeSkinActiva`) es responsable de resolver la skin activa
 * antes de arrancar la partida, una sola vez (ver el ticket, "Rendimiento").
 * Si no hay skin activa, `skin` queda `undefined` y createPlayfield cae al
 * fallback de rectangulos (ver packages/engine/src/playfield.ts).
 */
export function runGame(
  chart: Chart,
  audio: AudioBuffer,
  skin?: TexturasDeSkin,
): Promise<ResultadoPartida> {
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

    // T-008: la velocidad se lee una sola vez al arrancar, igual que el
    // offset (ver el comentario de leerOffset() mas abajo): no hay pausa ni
    // ajuste en caliente en el alcance de este ticket, solo elegirla antes
    // de jugar.
    const opcionesPista: PlayfieldOptions = {
      ...OPCIONES_PISTA_BASE,
      scrollDuration: velocidadAScrollDuration(leerVelocidad()),
    };

    // T-019: envoltorio relativo que contiene el lienzo de Pixi y el HUD
    // superpuesto (ver hud.css, `.tetra-partida`).
    const partida = document.createElement('div');
    partida.className = 'tetra-partida';
    const lienzo = document.createElement('div');
    lienzo.className = 'tetra-lienzo';
    partida.appendChild(lienzo);
    const hud = crearHud(partida, leerMostrarFps());
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
    const clock = createAudioClock(ctx, audio, { userOffset: leerOffset() });
    const engine = createJudgeEngine(chart);
    window.__tetraDebug = { clock, ctx };

    const desviaciones: Desviacion[] = [];
    function registrar(resultado: HitResult | null): void {
      if (resultado === null) return;
      desviaciones.push({
        time: resultado.note.time,
        error: resultado.error,
        judgement: resultado.judgement,
      });
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
    let ultimoT = -LEAD_IN_MS;
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
        sumarTiempoJugado(Math.min(clock.now(), clock.duration));
        window.dispatchEvent(new Event(EVENTO_TIEMPO_JUGADO));
      } catch {
        // el header simplemente no se actualiza.
      }
      document.body.classList.remove(CLASE_EN_JUEGO);
      cerrarCuenta();
      menuPausa?.destruir();
      menuPausa = null;
      clock.stop();
      input?.destroy();
      window.removeEventListener('keydown', manejarEscape);
      delete window.__tetraDebug;
      void ctx.close().catch(() => {
        // cerrar el contexto es best-effort: si el navegador ya lo cerro
        // (por ejemplo al navegar fuera de la pagina) no hay nada que hacer.
      });
    }

    function finalizar(): void {
      if (detenido) return;
      const estadoFinal = { ...engine.state, counts: { ...engine.state.counts } };
      // Se lee clock.userOffset antes de limpiar(): es el offset con el que
      // se jugo esta partida, lo que necesita el boton de "corregir offset"
      // de la pantalla de resultados (T-007) para calcular el offset nuevo.
      const offsetDeEstaPartida = clock.userOffset;
      limpiar();
      playfieldParaLimpieza?.destroy();
      app.destroy(true, { children: true });
      contenedor.innerHTML = '';
      mostrarResultados(contenedor, estadoFinal, desviaciones, offsetDeEstaPartida);
      resolve({ estado: 'completado', score: estadoFinal });
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
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      void ctx.suspend();
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

    app
      .init({
        width: opcionesPista.columnWidth * 4,
        height: opcionesPista.height,
        backgroundAlpha: 0,
        antialias: true,
      })
      .then(() => {
        appInicializada = true;
        if (detenido) {
          // Se pidio abortar mientras se inicializaba: abortar() no pudo
          // destruir la Application porque todavia no existia del todo (ver
          // appInicializada arriba), asi que se hace aca apenas esta lista.
          app.destroy(true, { children: true });
          return;
        }

        lienzo.appendChild(app.canvas);
        const playfield = createPlayfield(app, chart, opcionesPista, skin);
        playfieldParaLimpieza = playfield;
        input = createKeyboardInput(window, toGameTime);
        // T-012 "Parte B": el remapeo de teclas se edita en ajustes.ts y se
        // persiste con apps/web/src/keymap.ts; se lee y se aplica aca, una
        // sola vez al arrancar la partida, mismo momento que el offset y la
        // velocidad de arriba.
        input.setKeyMap(leerKeyMap());

        clock.start(LEAD_IN_MS);

        function frame(): void {
          if (detenido) return;

          // 1. El reloj.
          const t = clock.now();

          // 2. La entrada, despachada con el tiempo de cada evento (no con t).
          for (const evento of input!.drain()) {
            if (evento.type === 'down') {
              playfield.setPressed(evento.column, true);
              const resultado = engine.press(evento.time, evento.column);
              if (resultado) playfield.showJudgement(evento.column, resultado.judgement);
              registrar(resultado);
            } else {
              playfield.setPressed(evento.column, false);
              const resultado = engine.release(evento.time, evento.column);
              if (resultado) playfield.showJudgement(evento.column, resultado.judgement);
              registrar(resultado);
            }
          }

          // 3. El juicio: misses por tiempo, una vez por frame.
          for (const resultado of engine.update(t)) {
            playfield.showJudgement(resultado.note.column, resultado.judgement);
            registrar(resultado);
          }

          // 4. El dibujo.
          playfield.render(t);

          // 5. El HUD.
          actualizarHud(hud, engine.state, t, clock.duration, t - ultimoT);
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
        };

        // eslint-disable-next-line no-restricted-globals -- ver comentario dentro de frame().
        rafId = requestAnimationFrame(frame);
      })
      .catch((error: unknown) => {
        limpiar();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}
