// T-053: capas de la escena de la partida en DOM plano: el fondo de la
// cancion (imagen y video, con su velo) detras de la pista, y la intro con el
// titulo. No toca Pixi ni el audio: game.ts le pasa `t` (de `clock.now()`) una
// vez por frame y ella decide que mostrar, con la logica pura de
// escena-logica.ts. El video se sincroniza SIEMPRE contra ese `t`; el tiempo
// del video no se lee para nada de gameplay (CLAUDE.md, "El reloj es el audio").

import type { Ms } from '@tetra/core';
import {
  lineaDeAutoria,
  objetivoDeVideo,
  opacidadIntro,
  planDeVideo,
  type EscenaPartida,
} from './escena-logica.js';
import './escena.css';

export interface FondoDePartida {
  /** Pone el video en hora segun el reloj de juego. Una vez por frame. */
  sincronizar(t: Ms): void;
  /** Congela el video (la partida se pauso). */
  pausar(): void;
  /** Deja que el video vuelva a correr; el siguiente `sincronizar` lo pone en hora. */
  reanudar(): void;
  /** Quita las capas y suelta las URLs temporales de los Blob. */
  destruir(): void;
}

export interface OpcionesDeFondo {
  /** 0 a 1: opacidad del velo negro sobre la imagen y el video. */
  atenuacion: number;
  /** El interruptor de ajustes: si es false, el video no se reproduce aunque haya. */
  usarVideo: boolean;
}

/**
 * Crea la capa de fondo como primer hijo de `contenedor` (que tiene que ser
 * `position: relative` o fijo). Devuelve `null` si no hay nada que mostrar
 * (ni imagen ni un video permitido): la partida queda con el fondo de la app.
 */
export function crearFondoDePartida(
  contenedor: HTMLElement,
  escena: EscenaPartida | undefined,
  opciones: OpcionesDeFondo,
): FondoDePartida | null {
  const hayVideo = escena?.video !== undefined && opciones.usarVideo;
  if (escena?.fondo === undefined && !hayVideo) return null;

  const capa = document.createElement('div');
  capa.className = 'tetra-escena-fondo';
  capa.setAttribute('aria-hidden', 'true');

  const urls: string[] = [];

  if (escena?.fondo !== undefined) {
    const url = URL.createObjectURL(escena.fondo);
    urls.push(url);
    const imagen = document.createElement('img');
    imagen.className = 'tetra-escena-imagen';
    imagen.alt = '';
    imagen.decoding = 'async';
    imagen.src = url;
    capa.appendChild(imagen);
  }

  let video: HTMLVideoElement | null = null;
  if (hayVideo && escena?.video !== undefined) {
    const url = URL.createObjectURL(escena.video);
    urls.push(url);
    video = document.createElement('video');
    video.className = 'tetra-escena-video';
    video.muted = true;
    video.setAttribute('muted', '');
    video.playsInline = true;
    video.preload = 'auto';
    video.disablePictureInPicture = true;
    video.src = url;
    const elVideo = video;
    // Si no carga (formato que el navegador no decodifica), se quita y queda la imagen.
    video.addEventListener('error', () => {
      elVideo.remove();
      video = null;
    });
    capa.appendChild(video);
  }

  const velo = document.createElement('div');
  velo.className = 'tetra-escena-velo';
  velo.style.background = `rgb(0 0 0 / ${Math.min(1, Math.max(0, opciones.atenuacion))})`;
  capa.appendChild(velo);

  contenedor.insertBefore(capa, contenedor.firstChild);

  const videoOffset = escena?.videoOffset ?? 0;
  let enPausa = false;

  return {
    sincronizar(t: Ms): void {
      if (video === null || enPausa) return;
      const plan = planDeVideo(objetivoDeVideo(t, videoOffset), video.currentTime, video.duration);
      if (plan.modo === 'esperar') {
        // Quieto en el primer cuadro hasta que el reloj llegue al inicio del video.
        if (!video.paused) video.pause();
        if (video.currentTime > 0 && !video.seeking) video.currentTime = 0;
        return;
      }
      if (plan.modo === 'terminado') {
        if (!video.paused) video.pause();
        return;
      }
      if (plan.saltarA !== null && !video.seeking) video.currentTime = plan.saltarA;
      if (video.paused && !video.ended) {
        void video.play().catch(() => {
          // el navegador no lo dejo arrancar: queda el cuadro fijo, la partida sigue igual.
        });
      }
    },
    pausar(): void {
      enPausa = true;
      video?.pause();
    },
    reanudar(): void {
      enPausa = false;
    },
    destruir(): void {
      if (video !== null) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video = null;
      }
      capa.remove();
      for (const url of urls) URL.revokeObjectURL(url);
    },
  };
}

/**
 * Pone una imagen (Blob) de fondo en `capa` sin dejar la URL temporal
 * colgando: se suelta apenas la imagen carga (o falla). Para pantallas que no
 * tienen un gancho de limpieza, como los resultados.
 */
export function agregarImagenDeFondo(capa: HTMLElement, blob: Blob, clase: string): HTMLImageElement {
  const url = URL.createObjectURL(blob);
  const imagen = document.createElement('img');
  imagen.className = clase;
  imagen.alt = '';
  const soltar = (): void => URL.revokeObjectURL(url);
  imagen.addEventListener('load', soltar, { once: true });
  imagen.addEventListener('error', soltar, { once: true });
  imagen.src = url;
  capa.appendChild(imagen);
  return imagen;
}

export interface IntroDePartida {
  /** Ajusta la opacidad segun el reloj de juego; se retira sola cuando se desvanece. */
  actualizar(t: Ms): void;
  destruir(): void;
}

/** Cuantos pasos tiene la opacidad: no se reescribe el estilo si no cambia el paso. */
const PASOS_OPACIDAD_INTRO = 50;

/**
 * Titulo y "Artista · Dificultad" abajo a la izquierda. Devuelve `null` sin
 * titulo. `tReferencia` es el t de reloj desde el que cuenta el tiempo de la
 * intro (0 al empezar la cancion de cero).
 */
export function crearIntroDePartida(
  contenedor: HTMLElement,
  escena: EscenaPartida | undefined,
  tReferencia: Ms,
): IntroDePartida | null {
  const titulo = escena?.titulo?.trim();
  if (escena === undefined || titulo === undefined || titulo === '') return null;

  const raiz = document.createElement('div');
  raiz.className = 'tetra-intro';
  const tituloEl = document.createElement('div');
  tituloEl.className = 'tetra-intro-titulo';
  tituloEl.textContent = titulo;
  raiz.appendChild(tituloEl);
  const linea = lineaDeAutoria(escena);
  if (linea !== '') {
    const lineaEl = document.createElement('div');
    lineaEl.className = 'tetra-intro-linea';
    lineaEl.textContent = linea;
    raiz.appendChild(lineaEl);
  }
  contenedor.appendChild(raiz);

  let paso = PASOS_OPACIDAD_INTRO;
  let terminada = false;

  return {
    actualizar(t: Ms): void {
      if (terminada) return;
      const nuevo = Math.round(opacidadIntro(t - tReferencia) * PASOS_OPACIDAD_INTRO);
      if (nuevo === paso) return;
      paso = nuevo;
      if (nuevo <= 0) {
        terminada = true;
        raiz.remove();
        return;
      }
      raiz.style.opacity = String(nuevo / PASOS_OPACIDAD_INTRO);
    },
    destruir(): void {
      terminada = true;
      raiz.remove();
    },
  };
}
