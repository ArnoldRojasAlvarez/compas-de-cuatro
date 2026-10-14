// T-052: reproductor del preview del song select. Antes vivia dentro de
// song-select.ts; ahora tambien tiene pausa, salto y posicion, para que se vea
// y se pueda controlar.
//
// Reloj (CLAUDE.md, regla 1): esto es el preview, no gameplay. Tiene su propio
// AudioContext, aparte del reloj del juego, y la posicion que expone sale del
// `currentTime` de ESE contexto (nunca de performance.now): si el contexto se
// suspende (pausa), la posicion se congela sola.
//
// El audio decodificado se cachea por cancion (Map): re-enfocar una cancion ya
// escuchada no vuelve a decodificar su audio. Las canciones de audio virtual
// (T-066) no entran en ese Map: cada dificultad tiene su propio sonido y pesan
// unos 95 MB renderizadas; su unica entrada de cache vive en audio-de-cancion.ts.

import { esCancionVirtual, type CancionGuardada, type SongId } from '@tetra/storage';
import type { Chart, Ms } from '@tetra/core';
import { obtenerAudioDeDificultad } from './audio-de-cancion.js';
import { inicioDePreviewSegundos } from './musica-menu-logica.js';
import { fraccionDePosicion, posicionDePreviewSegundos } from './song-select-logica.js';
import { gananciaDeVolumen, leerVolumen } from './volumen.js';

export interface ReproductorPreview {
  /**
   * Empieza el preview de `cancion` desde `inicioMs` (el previewTime). Si estaba en pausa, reanuda.
   * `chart` es la dificultad enfocada: en una cancion de audio virtual decide que sonido se arma
   * (T-066); en las demas no importa.
   */
  reproducir(cancion: CancionGuardada, inicioMs: Ms, chart?: Chart): Promise<void>;
  /** true mientras se renderiza el audio virtual del preview ("Preparando el audio..."). */
  readonly preparando: boolean;
  /** Corta el sonido (no cierra el contexto: se puede volver a `reproducir`). */
  detener(): void;
  alternarPausa(): void;
  /** Salta a `fraccion` (0 a 1) de la duracion total. No hace nada si no hay audio cargado. */
  saltarA(fraccion: number): void;
  readonly pausado: boolean;
  /** Hay un preview sonando (o en pausa) listo para mostrar una barra. */
  readonly activo: boolean;
  /** Posicion actual sobre la duracion (0 a 1), o null si no hay preview. Barato: se llama en cada cuadro. */
  fraccion(): number | null;
  /** Duracion total del audio en segundos (0 si no hay preview). */
  readonly duracionS: number;
  /** Se llama cuando cambia `pausado` o `activo`. */
  alCambiar(cb: () => void): void;
  /** Detiene y cierra el AudioContext. Es seguro llamarla mas de una vez. */
  destruir(): void;
}

export function crearReproductorDePreview(): ReproductorPreview {
  let ctx: AudioContext | null = null;
  let ganancia: GainNode | null = null;
  let fuente: AudioBufferSourceNode | null = null;
  let bufferActual: AudioBuffer | null = null;
  // Posicion: arranco en `offsetS` del audio cuando el reloj del contexto marcaba `inicioCtxS`.
  let offsetS = 0;
  let inicioCtxS = 0;
  let pausado = false;
  let destruido = false;
  let preparando = false;
  let token = 0;
  const cache = new Map<SongId, AudioBuffer>();
  const oyentes: Array<() => void> = [];

  function avisar(): void {
    for (const cb of oyentes) cb();
  }

  function obtenerContexto(): { ctx: AudioContext; ganancia: GainNode } {
    if (ctx === null || ganancia === null) {
      ctx = new AudioContext();
      ganancia = ctx.createGain();
      ganancia.connect(ctx.destination);
    }
    // Se relee en cada preview: el volumen puede haber cambiado en ajustes.
    try {
      ganancia.gain.value = gananciaDeVolumen(leerVolumen());
    } catch {
      // localStorage bloqueado: queda la ganancia que ya tenia.
    }
    return { ctx, ganancia };
  }

  function pararFuente(): void {
    if (fuente === null) return;
    try {
      fuente.stop();
    } catch {
      // ya estaba detenida, o nunca llego a arrancar de verdad: nada mas que hacer.
    }
    fuente.disconnect();
    fuente = null;
  }

  function arrancarEn(buffer: AudioBuffer, desdeS: number): void {
    if (ctx === null || ganancia === null) return;
    pararFuente();
    const nueva = ctx.createBufferSource();
    nueva.buffer = buffer;
    nueva.loop = true;
    nueva.connect(ganancia);
    const inicio = Math.max(0, Math.min(desdeS, buffer.duration));
    nueva.start(0, inicio);
    fuente = nueva;
    bufferActual = buffer;
    offsetS = inicio;
    inicioCtxS = ctx.currentTime;
  }

  // Autoplay: si el contexto arranca suspendido (sin gesto del usuario) se
  // reanuda con el primer clic o tecla, salvo que el usuario lo haya pausado.
  function reanudarConGesto(): void {
    if (ctx !== null && !pausado && ctx.state === 'suspended') void ctx.resume();
  }
  window.addEventListener('pointerdown', reanudarConGesto);
  window.addEventListener('keydown', reanudarConGesto);

  async function reproducir(cancion: CancionGuardada, inicioMs: Ms, chart?: Chart): Promise<void> {
    if (destruido) return;
    pararFuente();
    bufferActual = null;
    const miToken = ++token;
    preparando = false;
    try {
      const { ctx: contexto } = obtenerContexto();
      if (pausado) {
        // Cambiar de cancion reanuda: nadie espera un preview nuevo mudo.
        pausado = false;
        void contexto.resume();
      }
      let buffer: AudioBuffer | undefined;
      if (esCancionVirtual(cancion)) {
        const dificultad = chart ?? cancion.dificultades[0];
        if (dificultad === undefined) return;
        preparando = true;
        avisar();
        buffer = await obtenerAudioDeDificultad(cancion, dificultad, contexto, {
          cancelado: () => miToken !== token || destruido,
        });
      } else {
        buffer = cache.get(cancion.id);
        if (!buffer) {
          const primera = chart ?? cancion.dificultades[0];
          if (primera === undefined) return;
          buffer = await obtenerAudioDeDificultad(cancion, primera, contexto);
          cache.set(cancion.id, buffer);
        }
      }
      // El foco pudo haber cambiado de nuevo mientras esto decodificaba (por
      // ejemplo, el usuario tipeo varias letras seguidas en buscar): si ya no
      // somos el ultimo pedido, no arrancamos un audio que nadie pidio, para
      // no terminar con dos previews sonando a la vez.
      if (miToken !== token || destruido) return;
      arrancarEn(buffer, inicioDePreviewSegundos(inicioMs, buffer.duration));
    } catch {
      // Preview best-effort (audio corrupto, AudioContext no disponible): no
      // debe romper el song select por un audio que no decodifica.
    }
    if (miToken === token) preparando = false;
    avisar();
  }

  function detener(): void {
    token++; // un reproducir() a medio decodificar no debe arrancar despues
    preparando = false;
    pararFuente();
    bufferActual = null;
    avisar();
  }

  function destruir(): void {
    if (destruido) return;
    destruido = true;
    token++;
    preparando = false;
    window.removeEventListener('pointerdown', reanudarConGesto);
    window.removeEventListener('keydown', reanudarConGesto);
    pararFuente();
    bufferActual = null;
    if (ctx !== null) {
      void ctx.close().catch(() => {
        // cerrar el contexto es best-effort, igual que en game.ts y musica-menu.ts.
      });
      ctx = null;
      ganancia = null;
    }
    oyentes.length = 0;
  }

  return {
    reproducir,
    detener,
    alternarPausa() {
      if (ctx === null || destruido) return;
      pausado = !pausado;
      if (pausado) void ctx.suspend();
      else void ctx.resume();
      avisar();
    },
    saltarA(fraccion) {
      if (bufferActual === null || ctx === null) return;
      arrancarEn(bufferActual, Math.min(1, Math.max(0, fraccion)) * bufferActual.duration);
    },
    get pausado() {
      return pausado;
    },
    get preparando() {
      return preparando;
    },
    get activo() {
      return bufferActual !== null && fuente !== null;
    },
    get duracionS() {
      return bufferActual?.duration ?? 0;
    },
    fraccion() {
      if (bufferActual === null || ctx === null || fuente === null) return null;
      const posicion = posicionDePreviewSegundos(
        offsetS,
        inicioCtxS,
        ctx.currentTime,
        bufferActual.duration,
      );
      return fraccionDePosicion(posicion, bufferActual.duration);
    },
    alCambiar(cb) {
      oyentes.push(cb);
    },
    destruir,
  };
}
