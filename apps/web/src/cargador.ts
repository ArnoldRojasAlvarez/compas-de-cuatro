// T-006: cargador de desarrollo. PROVISIONAL a proposito (ver
// docs/tickets/T-006-cargador-dev.md, "Contexto"): existe solo para poder
// jugar un .osz importado dentro del navegador mientras no hay song select.
// Cuando llegue el song select de la fase 3 este archivo se reemplaza
// entero, no se hace crecer: nada de busqueda, biblioteca persistente en
// pantalla ni multiples dificultades (ver el ticket, "Fuera de alcance").

import type { Chart } from '@tetra/core';
import { importarOsz, listarMapas } from '@tetra/storage';
import { runGame } from './game.js';
import { decodificarBlobDeAudio, mensajeDeErrorDeCarga } from './cargador-logica.js';
import { guardarOffset, leerOffset } from './offset.js';

const RUTA_MAPA_CLICK = '/fixtures/click-120.json';
const RUTA_AUDIO_CLICK = '/fixtures/click-120.wav';

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

/**
 * Muestra la pantalla del cargador dentro de `contenedor`, reemplazando lo
 * que hubiera. Se puede volver a llamar despues de una partida para volver
 * a esta pantalla (ver mostrarBotonVolver mas abajo).
 */
export function mostrarCargador(contenedor: HTMLElement): void {
  contenedor.innerHTML = '';

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

  const mensajeError = document.createElement('p');
  mensajeError.className = 'tetra-cargador-error';
  panel.appendChild(mensajeError);

  contenedor.appendChild(panel);

  function mostrarError(mensaje: string): void {
    mensajeError.textContent = mensaje;
  }

  function limpiarError(): void {
    mensajeError.textContent = '';
  }

  // Deja los resultados de la partida en pantalla (los pinta runGame al
  // terminar, ver game.ts) y agrega un boton para volver al cargador, en
  // vez de reemplazarlos al toque: la "prueba de feel" del ticket depende
  // de poder mirar el grafico de desviacion antes de volver.
  function mostrarBotonVolver(): void {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'tetra-cargador-volver';
    boton.textContent = 'Volver al cargador';
    boton.addEventListener('click', () => mostrarCargador(contenedor));
    contenedor.appendChild(boton);
  }

  async function jugar(chart: Chart, audio: AudioBuffer): Promise<void> {
    await runGame(chart, audio);
    mostrarBotonVolver();
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
