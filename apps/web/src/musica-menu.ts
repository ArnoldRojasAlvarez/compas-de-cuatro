// T-052: la musica del menu. Antes sonaba el click track en bucle; ahora suena
// una cancion de la biblioteca desde su `previewTime`, con fundido de entrada,
// y al terminar pasa a otra (sin repetir la ultima si hay mas de una). Con la
// biblioteca vacia vuelve al click track de siempre.
//
// Reloj (CLAUDE.md, regla 1): esto es musica de fondo, no gameplay. Tiene su
// propio AudioContext, aparte del reloj de juego (game.ts arma el suyo), y
// nunca se usa para medir tiempo de nada. Se cierra entero en `detener()`: es
// el unico AudioContext de musica vivo mientras el menu esta en pantalla.

import { listarCanciones, type CancionGuardada } from '@tetra/storage';
import { RUTA_AUDIO_CLICK } from './click-track.js';
import {
  EVENTO_BIBLIOTECA_CAMBIO,
  elegirSiguienteId,
  inicioDePreviewSegundos,
} from './musica-menu-logica.js';
import { obtenerAudioDeDificultad } from './audio-de-cancion.js';
import { conDificultadesOrdenadas } from './song-select-logica.js';
import { gananciaDeVolumen, leerVolumen } from './volumen.js';

export interface MusicaMenu {
  readonly analizador: AnalyserNode | null;
  /** Cancion sonando (o null con el click track). */
  readonly actual: CancionGuardada | null;
  /**
   * T-054: la cancion ya elegida, aunque todavia se este decodificando y no
   * suene (decodificar una cancion entera tarda). Con `cargando` en true el
   * menu ya puede mostrar su fondo y su titulo, atenuado. Null con el click track.
   */
  readonly eligida: CancionGuardada | null;
  /** true entre que se elige una cancion y que arranca (o falla su decodificacion). */
  readonly cargando: boolean;
  siguiente(): Promise<void>;
  alternarPausa(): void;
  readonly pausada: boolean;
  /** Se llama cuando cambia `actual` o `pausada`. */
  alCambiar(cb: () => void): void;
  detener(): void;
}

/** Duracion del fundido de entrada de cada cancion, en segundos del reloj del contexto de audio. */
const FUNDIDO_ENTRADA_S = 1.5;

/** Cuantas canciones seguidas se prueban si alguna no decodifica, antes de caer al click track. */
const INTENTOS_MAXIMOS = 3;

function volumenGuardado(): number {
  try {
    return gananciaDeVolumen(leerVolumen());
  } catch {
    // localStorage bloqueado: el volumen por defecto.
    return gananciaDeVolumen(0.8);
  }
}

export function crearMusicaMenu(): MusicaMenu {
  let ctx: AudioContext | null = null;
  let analizador: AnalyserNode | null = null;
  let maestro: GainNode | null = null;
  try {
    ctx = new AudioContext();
    maestro = ctx.createGain();
    maestro.gain.value = volumenGuardado();
    // fftSize chico: 64 bins alcanzan de sobra para las barras del logo y es
    // barato de leer cada cuadro (ver logo.ts).
    analizador = ctx.createAnalyser();
    analizador.fftSize = 128;
    analizador.connect(maestro);
    maestro.connect(ctx.destination);
  } catch {
    // Sin AudioContext (entorno raro): el menu funciona sin musica.
    ctx = null;
    analizador = null;
    maestro = null;
  }

  let actual: CancionGuardada | null = null;
  let eligida: CancionGuardada | null = null;
  let cargando = false;
  let pausada = false;
  let detenido = false;
  /** Cada pedido de reproduccion toma un numero: uno viejo que termina de decodificar tarde se descarta. */
  let token = 0;
  let fuente: AudioBufferSourceNode | null = null;
  let cancionesEnCache: CancionGuardada[] | null = null;
  const oyentes: Array<() => void> = [];

  function avisar(): void {
    for (const cb of oyentes) cb();
  }

  async function canciones(): Promise<CancionGuardada[]> {
    if (cancionesEnCache === null) {
      try {
        // T-054: las dificultades de mas facil a mas dificil; el previewTime sale de la primera.
        cancionesEnCache = (await listarCanciones()).map(conDificultadesOrdenadas);
      } catch {
        return [];
      }
    }
    return cancionesEnCache;
  }

  function pararFuente(): void {
    if (fuente === null) return;
    // El onended de una fuente que se para a mano no debe encadenar la siguiente.
    fuente.onended = null;
    try {
      fuente.stop();
    } catch {
      // ya estaba parada o nunca arranco: nada mas que hacer.
    }
    fuente.disconnect();
    fuente = null;
  }

  /** Conecta y arranca `buffer` con su fundido de entrada. `repetir` es para el click track (una cancion termina y pasa a otra). */
  function arrancar(buffer: AudioBuffer, desdeS: number, repetir: boolean, alTerminar: () => void): void {
    if (ctx === null || analizador === null) return;
    pararFuente();
    const nueva = ctx.createBufferSource();
    nueva.buffer = buffer;
    nueva.loop = repetir;
    const ganancia = ctx.createGain();
    // Fundido de entrada con el reloj del propio contexto (programacion de
    // audio, no tiempo de juego).
    ganancia.gain.setValueAtTime(0, ctx.currentTime);
    ganancia.gain.linearRampToValueAtTime(1, ctx.currentTime + FUNDIDO_ENTRADA_S);
    nueva.connect(ganancia);
    ganancia.connect(analizador);
    if (!repetir) nueva.onended = alTerminar;
    nueva.start(0, desdeS);
    fuente = nueva;
  }

  async function decodificar(bytes: ArrayBuffer): Promise<AudioBuffer> {
    if (ctx === null) throw new Error('Sin AudioContext.');
    return ctx.decodeAudioData(bytes);
  }

  async function tocarClickTrack(miToken: number): Promise<void> {
    try {
      const respuesta = await fetch(RUTA_AUDIO_CLICK);
      if (!respuesta.ok || detenido || miToken !== token) return;
      const buffer = await decodificar(await respuesta.arrayBuffer());
      if (detenido || miToken !== token) return;
      arrancar(buffer, 0, true, () => {});
      actual = null;
      avisar();
    } catch {
      // Sin audio: el logo se queda en su respiracion de reposo.
    }
  }

  async function tocarCancion(cancion: CancionGuardada, miToken: number): Promise<boolean> {
    try {
      // T-066: la primera dificultad (la mas facil, la lista ya viene ordenada) da el sonido
      // de una cancion de audio virtual; en las demas es solo la pista.
      const primera = cancion.dificultades[0];
      if (ctx === null || primera === undefined) return false;
      const buffer = await obtenerAudioDeDificultad(cancion, primera, ctx, {
        cancelado: () => detenido || miToken !== token,
      });
      if (detenido || miToken !== token) return true; // otro pedido tomo el lugar: no es un fallo
      const previewMs = primera.metadata.previewTime;
      arrancar(buffer, inicioDePreviewSegundos(previewMs, buffer.duration), false, () => {
        if (!detenido && miToken === token) void avanzar(Math.random);
      });
      actual = cancion;
      eligida = cancion;
      cargando = false;
      avisar();
      return true;
    } catch {
      return false;
    }
  }

  /** Pasa a la proxima cancion (sorteada con `aleatorio`) o, sin biblioteca, al click track. */
  async function avanzar(aleatorio: () => number): Promise<void> {
    if (ctx === null || detenido) return;
    const miToken = ++token;
    const lista = await canciones();
    if (detenido || miToken !== token) return;

    let excluida = actual?.id ?? null;
    for (let intento = 0; intento < INTENTOS_MAXIMOS; intento++) {
      const id = elegirSiguienteId(
        lista.map((c) => c.id),
        excluida,
        aleatorio,
      );
      const cancion = id === null ? undefined : lista.find((c) => c.id === id);
      if (cancion === undefined) break;
      // Elegida: el menu ya muestra su fondo y su titulo (atenuado) mientras
      // se decodifica, que en una maquina lenta tarda segundos.
      eligida = cancion;
      cargando = true;
      avisar();
      if (await tocarCancion(cancion, miToken)) return;
      excluida = cancion.id; // no decodifico: se prueba con otra
    }
    if (detenido || miToken !== token) return;
    eligida = null;
    cargando = false;
    await tocarClickTrack(miToken);
  }

  // -- Autoplay: si el contexto arranca suspendido (sin gesto del usuario) se
  // reanuda con el primer clic o tecla. En el e2e Chromium corre con
  // --autoplay-policy=no-user-gesture-required y arranca directo. Una pausa
  // del usuario no se deshace con esto. --
  function reanudarConGesto(): void {
    if (ctx !== null && !pausada && ctx.state === 'suspended') void ctx.resume();
  }
  window.addEventListener('pointerdown', reanudarConGesto);
  window.addEventListener('keydown', reanudarConGesto);

  // La demo (T-051) o una importacion llega con la biblioteca ya abierta: la
  // lista en cache queda vieja, y si sonaba el click track pasa a la primera
  // cancion (asi la demo entra sola).
  function alCambiarLaBiblioteca(): void {
    cancionesEnCache = null;
    if (actual === null && !detenido) void avanzar(() => 0);
  }
  window.addEventListener(EVENTO_BIBLIOTECA_CAMBIO, alCambiarLaBiblioteca);

  void avanzar(Math.random);

  return {
    get analizador() {
      return analizador;
    },
    get actual() {
      return actual;
    },
    get eligida() {
      return eligida;
    },
    get cargando() {
      return cargando;
    },
    get pausada() {
      return pausada;
    },
    siguiente() {
      // Pedir la siguiente estando en pausa la reanuda: nadie quiere una
      // cancion nueva muda.
      if (pausada && ctx !== null && !detenido) {
        pausada = false;
        void ctx.resume();
        avisar();
      }
      return avanzar(Math.random);
    },
    alternarPausa() {
      if (ctx === null || detenido) return;
      pausada = !pausada;
      if (pausada) void ctx.suspend();
      else void ctx.resume();
      avisar();
    },
    alCambiar(cb) {
      oyentes.push(cb);
    },
    detener() {
      if (detenido) return;
      detenido = true;
      token++;
      window.removeEventListener('pointerdown', reanudarConGesto);
      window.removeEventListener('keydown', reanudarConGesto);
      window.removeEventListener(EVENTO_BIBLIOTECA_CAMBIO, alCambiarLaBiblioteca);
      pararFuente();
      analizador?.disconnect();
      maestro?.disconnect();
      if (ctx !== null) {
        void ctx.close().catch(() => {
          // cerrar el contexto es best-effort, igual que en game.ts y song-select.ts.
        });
      }
      oyentes.length = 0;
    },
  };
}
