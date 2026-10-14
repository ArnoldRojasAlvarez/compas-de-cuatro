// T-066 (paso 3, D8): renderiza el audio virtual de una dificultad. Crea el
// AudioBuffer de salida (2 canales, al sampleRate del contexto que lo va a
// reproducir, asi no se remuestrea al tocar) y suma encima, de a una muestra
// por vez: decodificar, sumar todos sus eventos, soltarla. La memoria pico es
// la salida mas una muestra decodificada, no todas a la vez como pasaria con
// un OfflineAudioContext. La suma en si es una funcion pura de core
// (`mezclarMuestra`), testeable sin navegador.
//
// No toca el reloj del juego: el AudioBuffer resultante se usa igual que el
// de una pista decodificada (T-063 no cambia).

import type { Chart } from '@tetra/core';
import {
  duracionDeAudioVirtual,
  indiceDeMuestra,
  mezclarMuestra,
  normalizarPico,
} from '@tetra/core';

export interface EntradaRenderVirtual {
  /** Con `audioVirtual`. */
  chart: Chart;
  /** Bytes frescos de una muestra (`decodeAudioData` los desprende); `undefined` si falta. */
  leerMuestra: (archivo: string) => Promise<ArrayBuffer | undefined>;
  ctx: BaseAudioContext;
  /** Cede el hilo entre muestras (en la web, con MessageChannel). Por defecto no cede. */
  ceder?: () => Promise<void>;
}

export interface ResultadoRenderVirtual {
  buffer: AudioBuffer;
  /** Muestras que faltaban o no decodificaron, ordenadas. */
  faltantes: string[];
  /** Factor de `normalizarPico` (1 si no toco nada). */
  ganancia: number;
}

/** Eventos de una misma muestra, en paralelo: inicio (en muestras de audio) y ganancia lineal. */
interface UsosDeMuestra {
  inicios: number[];
  ganancias: number[];
}

/**
 * Cuanto se mezcla de corrido antes de ceder el hilo, en sumas (una por
 * canal y por muestra de audio). Unos 4 millones son del orden de 10 ms: el
 * spinner y la interfaz siguen vivos aunque una muestra tenga cientos de
 * eventos.
 */
const SUMAS_ENTRE_CESIONES = 4_000_000;

/** Cuantas muestras se leen y decodifican por adelantado mientras se mezcla la actual. */
const MUESTRAS_POR_ADELANTADO = 2;

/**
 * Por debajo de este valor absoluto (unos -70 dBFS) la cola de una muestra se
 * descarta: es inaudible y la mezcla se queda sin recorrer ceros casi mudos
 * (en un piano, la cola larga y casi muda de cada nota es la mitad del trabajo).
 */
const UMBRAL_DE_COLA = 3e-4;

/** Largo hasta el ultimo valor que pasa de `UMBRAL_DE_COLA` en algun canal. */
function largoUtil(canales: readonly Float32Array[]): number {
  let largo = canales[0]?.length ?? 0;
  while (largo > 0) {
    for (const canal of canales) {
      if (Math.abs(canal[largo - 1]!) > UMBRAL_DE_COLA) return largo;
    }
    largo--;
  }
  return 0;
}

/** Lee y decodifica una muestra. `undefined` si falta o no decodifica; nunca rechaza. */
async function leerYDecodificar(
  archivo: string,
  leerMuestra: EntradaRenderVirtual['leerMuestra'],
  ctx: BaseAudioContext,
): Promise<Float32Array[] | undefined> {
  try {
    const bytes = await leerMuestra(archivo);
    if (bytes === undefined) return undefined;
    const decodificada = await ctx.decodeAudioData(bytes);
    const canales: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, decodificada.numberOfChannels); c++) {
      canales.push(decodificada.getChannelData(c));
    }
    return canales.length === 0 ? undefined : canales;
  } catch {
    return undefined;
  }
}

export async function renderizarAudioVirtual(
  entrada: EntradaRenderVirtual,
): Promise<ResultadoRenderVirtual> {
  const { chart, leerMuestra, ctx, ceder } = entrada;
  const eventos = chart.audioVirtual?.eventos ?? [];
  const sampleRate = ctx.sampleRate;

  const largo = Math.max(1, Math.ceil((duracionDeAudioVirtual(chart) * sampleRate) / 1000));
  const buffer = ctx.createBuffer(2, largo, sampleRate);
  const salida = [buffer.getChannelData(0), buffer.getChannelData(1)];

  const porArchivo = new Map<string, UsosDeMuestra>();
  for (const evento of eventos) {
    let usos = porArchivo.get(evento.archivo);
    if (usos === undefined) {
      usos = { inicios: [], ganancias: [] };
      porArchivo.set(evento.archivo, usos);
    }
    usos.inicios.push(indiceDeMuestra(evento.tiempo, sampleRate));
    usos.ganancias.push(evento.volumen / 100);
  }

  // Se recorren las muestras de a una (memoria pico: la salida mas unas pocas
  // muestras decodificadas), pero la lectura y la decodificacion de las
  // proximas corren en paralelo con la mezcla de la actual: decodeAudioData
  // trabaja fuera del hilo principal.
  const archivos = [...porArchivo.keys()];
  const enCurso = new Map<number, Promise<Float32Array[] | undefined>>();
  const adelantar = (i: number): void => {
    if (i < archivos.length && !enCurso.has(i)) {
      enCurso.set(i, leerYDecodificar(archivos[i]!, leerMuestra, ctx));
    }
  };
  for (let i = 0; i <= MUESTRAS_POR_ADELANTADO; i++) adelantar(i);

  const faltantes: string[] = [];
  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i]!;
    const usos = porArchivo.get(archivo)!;
    const canales = await enCurso.get(i)!;
    enCurso.delete(i);
    adelantar(i + MUESTRAS_POR_ADELANTADO + 1);

    if (canales === undefined) {
      faltantes.push(archivo);
    } else {
      const util = largoUtil(canales);
      if (util > 0) {
        const recortada = canales.map((canal) => canal.subarray(0, util));
        // Los eventos van en tandas para ceder el hilo cada tanto, tambien
        // dentro de una muestra con muchos eventos.
        const porTanda = Math.max(1, Math.floor(SUMAS_ENTRE_CESIONES / (util * salida.length)));
        for (let desde = 0; desde < usos.inicios.length; desde += porTanda) {
          mezclarMuestra(
            salida,
            recortada,
            usos.inicios.slice(desde, desde + porTanda),
            usos.ganancias.slice(desde, desde + porTanda),
          );
          const ultima = desde + porTanda >= usos.inicios.length;
          if (!ultima && ceder !== undefined) await ceder();
        }
      }
    }
    if (ceder !== undefined) await ceder();
  }

  faltantes.sort();
  const ganancia = normalizarPico(salida);
  return { buffer, faltantes, ganancia };
}
