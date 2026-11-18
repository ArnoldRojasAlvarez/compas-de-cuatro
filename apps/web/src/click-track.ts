// T-006 creo el click track como parte del cargador de desarrollo, una
// pantalla que T-011 elimino: la reemplazo por el song select, que le dio
// a esta parte su propio archivo. El click track sigue siendo el fixture
// que prueba sincronia (ver apps/web/e2e/sincronia.spec.ts) y sigue
// sonando en el menu con la biblioteca vacia (musica-menu.ts), asi que necesita vivir
// en un lugar que ninguno de los dos "posea": ni el menu ni el song select
// son mas dueños del click track que el otro.

import type { Chart } from '@tetra/core';

// Rutas relativas (sin barra inicial): asi resuelven contra la pagina y no contra
// la raiz del dominio, y el juego funciona tambien publicado en un subdirectorio
// (GitHub Pages: usuario.github.io/repositorio/).
const RUTA_MAPA_CLICK = 'fixtures/click-120.json';
// Tambien la usa musica-menu.ts cuando la biblioteca esta vacia (el mismo
// click track, en bucle, para que el logo tenga senal). Es el mismo archivo, una
// sola constante: evita que las dos rutas se puedan ir desincronizando con
// el tiempo.
export const RUTA_AUDIO_CLICK = 'fixtures/click-120.wav';

export async function cargarChartDelClickTrack(): Promise<Chart> {
  const respuesta = await fetch(RUTA_MAPA_CLICK);
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar el mapa (${respuesta.status}): ${RUTA_MAPA_CLICK}`);
  }
  return (await respuesta.json()) as Chart;
}

export async function cargarAudioDelClickTrack(): Promise<AudioBuffer> {
  const respuesta = await fetch(RUTA_AUDIO_CLICK);
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar el audio (${respuesta.status}): ${RUTA_AUDIO_CLICK}`);
  }
  const arrayBuffer = await respuesta.arrayBuffer();

  // Contexto de audio usado unicamente para decodificar, igual que para un
  // .osz importado (ver song-select.ts): runGame arma su propio
  // AudioContext para la reproduccion y el reloj de juego (ver
  // apps/web/src/game.ts), asi que este se cierra apenas termina.
  const ctxDeDecodificacion = new AudioContext();
  try {
    return await ctxDeDecodificacion.decodeAudioData(arrayBuffer);
  } finally {
    await ctxDeDecodificacion.close();
  }
}
