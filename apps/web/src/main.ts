// T-004: punto de entrada de la app. Carga el fixture de prueba (ver
// fixtures/README.md, "click-120") y arranca el bucle de juego. Sin menus:
// eso es fase 3 (ver T-004, "Contexto"). Se sirve desde apps/web/public
// para poder pedirlo por fetch como cualquier asset estatico.

import type { Chart } from '@tetra/core';
import './style.css';
import { runGame } from './game.js';

const RUTA_MAPA = '/fixtures/click-120.json';
const RUTA_AUDIO = '/fixtures/click-120.wav';

function mostrarError(mensaje: string): void {
  const contenedor = document.getElementById('app');
  if (!contenedor) return;
  contenedor.textContent = `Error: ${mensaje}`;
}

async function cargarChart(): Promise<Chart> {
  const respuesta = await fetch(RUTA_MAPA);
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar el mapa (${respuesta.status}): ${RUTA_MAPA}`);
  }
  return (await respuesta.json()) as Chart;
}

async function cargarAudio(): Promise<AudioBuffer> {
  const respuesta = await fetch(RUTA_AUDIO);
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar el audio (${respuesta.status}): ${RUTA_AUDIO}`);
  }
  const arrayBuffer = await respuesta.arrayBuffer();

  // Contexto de audio usado unicamente para decodificar: runGame arma su
  // propio AudioContext para la reproduccion y el reloj de juego (ver
  // apps/web/src/game.ts). Se cierra apenas termina de decodificar.
  const ctxDeDecodificacion = new AudioContext();
  try {
    return await ctxDeDecodificacion.decodeAudioData(arrayBuffer);
  } finally {
    await ctxDeDecodificacion.close();
  }
}

async function iniciar(): Promise<void> {
  const [chart, audio] = await Promise.all([cargarChart(), cargarAudio()]);
  await runGame(chart, audio);
}

iniciar().catch((error: unknown) => {
  const mensaje = error instanceof Error ? error.message : String(error);
  console.error('Error al iniciar Tetra:', error);
  mostrarError(mensaje);
});
