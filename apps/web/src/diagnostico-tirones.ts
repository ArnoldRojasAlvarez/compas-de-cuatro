// T-061: diagnostico de tirones de la partida real. Mide, en el navegador de
// quien juega, cuantos frames se pasan de 50 ms, cuando, y (con
// long-animation-frame) que script los causo, para decidir con datos que
// arreglar. La logica pura (conteos, percentiles, atribucion, formato) esta en
// diagnostico-tirones-logica.ts; aca solo el borde con el navegador.
//
// Es solo diagnostico, nunca gameplay: el timestamp de rAF y las entradas de
// PerformanceObserver se usan para medir cuanto duro cada frame, no para saber
// en que momento de la cancion se esta. El juego sigue leyendo `clock.now()`
// (CLAUDE.md, "El reloj es el audio"). game.ts solo lo crea si "Mostrar FPS"
// esta encendido, asi que al jugador comun no le cuesta nada.

import type { Ms } from '@tetra/core';
import {
  leerAtenuacion,
  leerMostrarBarraDeError,
  leerMostrarJuicios,
  leerMostrarTeclas,
} from './apariencia.js';
import {
  crearRegistroDeFrames,
  detalleDeTirones,
  lineaDeTirones,
  type ContextoDiagnostico,
  type EntradaLoaf,
  type EntradaTareaLarga,
  type ResumenDiagnostico,
} from './diagnostico-tirones-logica.js';
import { leerBajaLatencia } from './graficos.js';
import { crearBotonIcono, cambiarBotonIcono } from './iconos.js';
import { leerSeleccionDeSkin } from './skin-activa.js';
import { serializarSeleccion } from './skin-activa-logica.js';

export interface Diagnostico {
  /** Engancha los observers (long-animation-frame y longtask, los que el navegador tenga) y los avisos de foco. */
  iniciar(): void;
  /** Lo llama el bucle en cada frame; sin allocaciones salvo al registrar un tiron. `tsRaf` es solo diagnostico. */
  frame(tJuego: Ms, tsRaf: number): void;
  /** El proximo frame no cuenta: el juego estuvo en pausa y rAF se detuvo a proposito. */
  descartarProximo(): void;
  /** Suelta los observers y devuelve el resumen. Se puede llamar mas de una vez (devuelve el mismo). */
  detener(): ResumenDiagnostico;
}

export interface OpcionesDiagnostico {
  ctx: AudioContext;
  mapa: { titulo: string; dificultad: string; notas: number };
  /** Si la partida muestra un video de fondo (hay video y el ajuste esta prendido). */
  video: boolean;
  /** Notas en pantalla en el instante de juego dado; se llama solo al registrar un tiron. */
  notasVisibles?: (tJuego: Ms) => number;
  /** Golpes juzgados desde el principio de la partida (suma de los contadores del motor); se lee en cada frame, sin allocar. */
  juzgados?: () => number;
}

// Las entradas de long-animation-frame no estan en lib.dom de TypeScript todavia.
interface EntradaLoafCruda extends PerformanceEntry {
  blockingDuration?: number;
  styleAndLayoutStart?: number;
  scripts?: readonly { sourceURL?: string; sourceFunctionName?: string; duration?: number }[];
}

function tiposSoportados(): readonly string[] {
  return typeof PerformanceObserver !== 'undefined'
    ? (PerformanceObserver.supportedEntryTypes ?? [])
    : [];
}

function leerRenderer(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (gl === null) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(
      gl.getParameter(info !== null ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  } catch {
    return null;
  }
}

function numeroOnull(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

export function crearDiagnostico(opciones: OpcionesDiagnostico): Diagnostico {
  const registro = crearRegistroDeFrames(opciones);
  const observers: PerformanceObserver[] = [];
  let perdioElFoco = false;
  let pestanaOculta = false;
  let iniciado = false;
  let resumen: ResumenDiagnostico | null = null;
  const tipos = tiposSoportados();
  const conLoaf = tipos.includes('long-animation-frame');
  const conTareaLarga = tipos.includes('longtask');

  const alPerderFoco = (): void => {
    perdioElFoco = true;
  };
  const alCambiarVisibilidad = (): void => {
    if (document.visibilityState !== 'hidden') return;
    pestanaOculta = true;
    // Con la pestana oculta rAF se detiene: el frame que vuelve despues no es un tiron.
    registro.descartarProximo();
  };

  function observar(tipo: string, alEntrar: (entrada: PerformanceEntry) => void): void {
    try {
      const observer = new PerformanceObserver((lista) => {
        for (const entrada of lista.getEntries()) alEntrar(entrada);
      });
      observer.observe({ type: tipo });
      observers.push(observer);
    } catch {
      // El navegador anuncio el tipo pero no lo acepta: se sigue sin esa atribucion.
    }
  }

  function aEntradaLoaf(entrada: PerformanceEntry): EntradaLoaf {
    const cruda = entrada as EntradaLoafCruda;
    return {
      startTime: entrada.startTime,
      duration: entrada.duration,
      blockingDuration: cruda.blockingDuration ?? 0,
      styleAndLayoutStart: cruda.styleAndLayoutStart ?? 0,
      scripts: (cruda.scripts ?? []).map((s) => ({
        sourceURL: s.sourceURL ?? '',
        sourceFunctionName: s.sourceFunctionName ?? '',
        duration: s.duration ?? 0,
      })),
    };
  }

  function aTareaLarga(entrada: PerformanceEntry): EntradaTareaLarga {
    return { startTime: entrada.startTime, duration: entrada.duration };
  }

  function vaciarObservers(): void {
    // Lo que el navegador tenia pendiente de entregar se recoge antes de soltar el observer.
    for (const observer of observers) {
      for (const entrada of observer.takeRecords()) {
        if (entrada.entryType === 'long-animation-frame') registro.agregarLoaf(aEntradaLoaf(entrada));
        else registro.agregarTareaLarga(aTareaLarga(entrada));
      }
      observer.disconnect();
    }
    observers.length = 0;
  }

  return {
    iniciar() {
      if (iniciado) return;
      iniciado = true;
      if (conLoaf) observar('long-animation-frame', (e) => registro.agregarLoaf(aEntradaLoaf(e)));
      if (conTareaLarga) observar('longtask', (e) => registro.agregarTareaLarga(aTareaLarga(e)));
      window.addEventListener('blur', alPerderFoco);
      document.addEventListener('visibilitychange', alCambiarVisibilidad);
    },

    frame(tJuego, tsRaf) {
      registro.frame(tJuego, tsRaf);
    },

    descartarProximo() {
      registro.descartarProximo();
    },

    detener() {
      if (resumen !== null) return resumen;
      vaciarObservers();
      window.removeEventListener('blur', alPerderFoco);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      const parte = registro.resumir();
      const contexto: ContextoDiagnostico = {
        userAgent: navigator.userAgent,
        // Crear un contexto WebGL de mas solo vale la pena si hubo tirones que explicar.
        renderer: parte.tironesTotal > 0 ? leerRenderer() : null,
        devicePixelRatio: window.devicePixelRatio,
        ventana: { ancho: window.innerWidth, alto: window.innerHeight },
        baseLatency: numeroOnull(opciones.ctx.baseLatency),
        outputLatency: numeroOnull(opciones.ctx.outputLatency),
        skin: serializarSeleccion(leerSeleccionDeSkin()),
        atenuacion: leerAtenuacion(),
        video: opciones.video,
        contadores: {
          teclas: leerMostrarTeclas(),
          juicios: leerMostrarJuicios(),
          barraDeError: leerMostrarBarraDeError(),
        },
        bajaLatencia: leerBajaLatencia(),
        mapa: opciones.mapa,
        perdioElFoco,
        pestanaOculta,
        observadores: { longAnimationFrame: conLoaf, longTask: conTareaLarga },
      };
      resumen = { version: 1, contexto, ...parte };
      return resumen;
    },
  };
}

/** Copia texto al portapapeles; si el navegador lo niega, cae en un textarea temporal. */
async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let copiado = false;
    try {
      copiado = document.execCommand('copy');
    } catch {
      copiado = false;
    }
    area.remove();
    return copiado;
  }
}

/**
 * La linea de los resultados: "3 tirones · peor 133 ms a 38,0 s" (con los hasta
 * 10 primeros en el `title`) y un boton-icono que copia el JSON completo. `null`
 * si no hubo tirones: sin tirones, los resultados no muestran nada.
 */
export function crearLineaDeTirones(resumen: ResumenDiagnostico): HTMLElement | null {
  const texto = lineaDeTirones(resumen);
  if (texto === null) return null;

  const fila = document.createElement('div');
  fila.className = 'tetra-resultados-tirones';
  const linea = document.createElement('span');
  linea.className = 'tetra-resultados-tirones-texto';
  linea.textContent = texto;
  linea.title = detalleDeTirones(resumen);

  const boton = crearBotonIcono('copiar', 'Copiar diagnóstico', 'tetra-resultados-tirones-copiar');
  let temporizador = 0;
  boton.addEventListener('click', () => {
    void copiarAlPortapapeles(JSON.stringify(resumen, null, 2)).then((copiado) => {
      if (!copiado) return;
      cambiarBotonIcono(boton, 'confirmar', 'Diagnóstico copiado');
      window.clearTimeout(temporizador);
      temporizador = window.setTimeout(
        () => cambiarBotonIcono(boton, 'copiar', 'Copiar diagnóstico'),
        1600,
      );
    });
  });

  fila.append(linea, boton);
  return fila;
}
