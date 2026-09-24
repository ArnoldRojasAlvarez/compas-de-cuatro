// T-006 creo el click track como parte del cargador de desarrollo
// (cargador.ts, ver su cabecera historica). T-011 reemplaza ese cargador
// por el song select y saca esta parte a su propio archivo: el click track
// sigue siendo el fixture que prueba sincronia (ver
// apps/web/e2e/sincronia.spec.ts) y sigue alimentando el audio del logo del
// menu (logo.ts), asi que necesita vivir en un lugar que ninguno de los
// dos "posea": ni el menu ni el song select son mas dueños del click track
// que el otro.

import type { Chart } from '@tetra/core';

const RUTA_MAPA_CLICK = '/fixtures/click-120.json';
// Tambien la usa logo.ts para la musica del menu (el mismo click track, en
// bucle, solo como senal para el visualizador). Es el mismo archivo, una
// sola constante: evita que las dos rutas se puedan ir desincronizando con
// el tiempo.
export const RUTA_AUDIO_CLICK = '/fixtures/click-120.wav';

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
