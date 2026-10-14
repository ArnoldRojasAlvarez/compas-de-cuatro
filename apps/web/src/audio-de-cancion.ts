// T-066 (paso 3, D8 y D11): de donde sale el AudioBuffer de una dificultad.
//
// - Cancion normal: se decodifica `cancion.audio` (como siempre).
// - Cancion virtual (sin pista, con muestras): se renderiza la receta de la
//   dificultad con `renderizarAudioVirtual` (@tetra/audio). Renderizar cuesta de
//   0,5 a 4 s, asi que se guarda UNA entrada en memoria, con clave
//   `<songId>|<hashMapa>|<sampleRate>`: el preview la renderiza y "Jugar" la
//   reusa. Si dos pedidos llegan mientras se renderiza, comparten el mismo
//   trabajo; el trabajo solo se cancela cuando TODOS los que lo esperan se
//   cancelaron (por ejemplo, el preview al cambiar de cancion sin que nadie
//   haya pedido jugar).
//
// Reloj (CLAUDE.md, regla 1): esto no mide tiempo de juego. El AudioBuffer que
// sale se usa igual que uno decodificado; el reloj (T-063) no cambia.

import { renderizarAudioVirtual } from '@tetra/audio';
import { hashMapa, type Chart } from '@tetra/core';
import { esCancionVirtual, leerMuestras, type CancionGuardada } from '@tetra/storage';
import { decodificarBlobDeAudio } from './cargador-logica.js';

/** Cede el hilo al navegador con un MessageChannel (no `setTimeout`: encola despues de pintar y atender eventos, sin el minimo de 4 ms). */
export function cederAlNavegador(): Promise<void> {
  return new Promise<void>((resolve) => {
    const canal = new MessageChannel();
    canal.port1.onmessage = () => {
      canal.port1.close();
      resolve();
    };
    canal.port2.postMessage(null);
  });
}

export interface OpcionesDeAudio {
  /** Se consulta entre muestra y muestra: si devuelve true, el pedido ya no interesa. */
  cancelado?: () => boolean;
}

/** Lo que lanza el render cuando todos los interesados se cancelaron. */
export class RenderCancelado extends Error {
  constructor() {
    super('Se canceló la preparación del audio.');
    this.name = 'RenderCancelado';
  }
}

interface EntradaDeCache {
  clave: string;
  promesa: Promise<AudioBuffer>;
  /** Uno por cada pedido que espera este render; el render se corta cuando todos dicen true. */
  cancelaciones: Set<() => boolean>;
}

let cache: EntradaDeCache | null = null;

/** La clave de la cache (D8): `<songId>|<hashMapa>|<sampleRate>`. */
export function claveDeRender(cancion: CancionGuardada, chart: Chart, sampleRate: number): string {
  return `${cancion.id}|${hashMapa(chart)}|${sampleRate}`;
}

/** true si ya hay un render de esa dificultad (en curso o terminado) en la cache, o si la cancion no necesita render. */
export function audioListoSinRenderizar(
  cancion: CancionGuardada,
  chart: Chart,
  sampleRate: number,
): boolean {
  if (!esCancionVirtual(cancion)) return true;
  return cache !== null && cache.clave === claveDeRender(cancion, chart, sampleRate);
}

/** Vacia la cache (tests). */
export function olvidarAudioRenderizado(): void {
  cache = null;
}

async function renderizar(
  cancion: CancionGuardada,
  chart: Chart,
  ctx: BaseAudioContext,
  cancelado: () => boolean,
): Promise<AudioBuffer> {
  const keysounds = cancion.keysounds ?? {};
  const necesarias = new Set<string>();
  for (const evento of chart.audioVirtual?.eventos ?? []) {
    const hash = keysounds[evento.archivo];
    if (hash !== undefined) necesarias.add(hash);
  }
  const blobs = await leerMuestras([...necesarias]);
  if (cancelado()) throw new RenderCancelado();

  const { buffer, faltantes } = await renderizarAudioVirtual({
    chart,
    ctx,
    leerMuestra: async (archivo) => {
      const hash = keysounds[archivo];
      const blob = hash === undefined ? undefined : blobs.get(hash);
      return blob === undefined ? undefined : blob.arrayBuffer();
    },
    ceder: async () => {
      await cederAlNavegador();
      if (cancelado()) throw new RenderCancelado();
    },
  });
  if (faltantes.length > 0) {
    console.warn(`Faltan ${faltantes.length} muestras en el audio virtual de la dificultad.`, faltantes);
  }
  return buffer;
}

/**
 * El AudioBuffer de una dificultad: decodifica `cancion.audio` o, si la
 * cancion es virtual, renderiza (con la cache de una entrada, D8).
 */
export function obtenerAudioDeDificultad(
  cancion: CancionGuardada,
  chart: Chart,
  ctx: BaseAudioContext,
  opciones: OpcionesDeAudio = {},
): Promise<AudioBuffer> {
  if (!esCancionVirtual(cancion)) {
    if (cancion.audio === undefined) {
      return Promise.reject(new Error('La canción no tiene audio.'));
    }
    return decodificarBlobDeAudio(cancion.audio, ctx);
  }

  const clave = claveDeRender(cancion, chart, ctx.sampleRate);
  const miCancelacion = opciones.cancelado ?? (() => false);
  if (cache !== null && cache.clave === clave) {
    cache.cancelaciones.add(miCancelacion);
    return cache.promesa;
  }

  const cancelaciones = new Set<() => boolean>([miCancelacion]);
  const todosCancelaron = (): boolean => {
    for (const cancelado of cancelaciones) if (!cancelado()) return false;
    return true;
  };
  const entrada: EntradaDeCache = {
    clave,
    cancelaciones,
    promesa: renderizar(cancion, chart, ctx, todosCancelaron),
  };
  cache = entrada;
  // Un render que falla o se cancela no se queda en la cache; uno terminado
  // suelta los cancelados de quienes lo esperaban (ya no sirven).
  entrada.promesa.then(
    () => cancelaciones.clear(),
    () => {
      if (cache === entrada) cache = null;
    },
  );
  return entrada.promesa;
}
