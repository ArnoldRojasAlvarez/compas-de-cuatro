// T-060: "Calibrar offset", la pantalla que mide el offset global sin necesitar
// una cancion. Se llega desde el boton "Calibrar" de Ajustes. Suena un metronomo
// sintetizado a 120 BPM; la persona pulsa una tecla de columna al compas durante
// 32 pulsos (los 4 primeros son para entrar en tiempo y no cuentan); cada golpe
// aparece en una barra como la de error de la partida y la media va en grande;
// al terminar, "Usar +N ms" guarda el offset global.
//
// DOM plano, nada de React ni de Pixi. El reloj es el del AudioContext de ESTA
// pantalla (CLAUDE.md, "El reloj es el audio"): los clicks se programan en su
// tiempo, y cada pulsacion se fecha con `event.timeStamp` convertido a ese
// reloj, igual que `toGameTime` en game.ts. requestAnimationFrame solo
// refresca el texto y detecta el cierre; no mide nada. Ninguna cuenta usa
// Date.now() ni temporizadores. Las cuentas viven en calibrar-offset-logica.ts.

import './calibrar-offset.css';
import { leerKeyMap } from './keymap.js';
import { crearMapaDeTiempo, type MapaDeTiempo } from '@tetra/audio';
import { guardarOffset, leerOffset } from './offset.js';
import { formatearOffset } from './ajustes-barras-logica.js';
import { gananciaDeVolumen, leerVolumen } from './volumen.js';
import {
  AIRE_ANTES_DEL_PRIMER_PULSO_MS,
  GOLPES_MINIMOS_PARA_USAR,
  INTERVALO_DE_PULSO_MS,
  PULSOS_TOTALES,
  crearCalibracion,
  instanteDeCierre,
  offsetCalibrado,
  posicionEnBarraDeCalibracion,
  textoDeProgreso,
  textoDeUsar,
  type Calibracion,
} from './calibrar-offset-logica.js';

export interface OpcionesCalibrarOffset {
  /** Volver a Ajustes (el router vuelve a montarlos con el offset ya guardado). */
  aAjustes: () => void;
}

/**
 * Gancho de depuracion para el e2e (calibrar-offset.spec.ts), igual que
 * `__tetraDebug` en game.ts: el reloj de esta pantalla y el instante de su primer
 * pulso, para que el test pulse en tiempos exactos. Nadie lo lee adentro.
 */
interface GanchoDeCalibracion {
  ctx: AudioContext;
  /** `ctx.currentTime` (segundos) en el que suena el pulso 0. */
  t0: number;
  /** Latencia de salida que el calculo descuenta, en ms. */
  latenciaMs: number;
}

declare global {
  interface Window {
    __tetraCalibrarOffset?: GanchoDeCalibracion;
  }
}

function crear<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  clase: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const nodo = document.createElement(etiqueta);
  nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

/** Un click corto (30 ms, envolvente exponencial), mas agudo y fuerte el del primer tiempo de cada compas. */
function crearClick(ctx: AudioContext, acentuado: boolean): AudioBuffer {
  const frecuencia = acentuado ? 1500 : 1000;
  const amplitud = acentuado ? 0.8 : 0.5;
  const muestras = Math.round(ctx.sampleRate * 0.03);
  const buffer = ctx.createBuffer(1, muestras, ctx.sampleRate);
  const datos = buffer.getChannelData(0);
  for (let i = 0; i < muestras; i++) {
    const t = i / ctx.sampleRate;
    datos[i] = amplitud * Math.exp(-t / 0.006) * Math.sin(2 * Math.PI * frecuencia * t);
  }
  return buffer;
}

/** Muestra la pantalla dentro de `contenedor`, reemplazando lo que hubiera. */
export function mostrarCalibrarOffset(
  contenedor: HTMLElement,
  opciones: OpcionesCalibrarOffset,
): void {
  contenedor.innerHTML = '';
  const keyMap = leerKeyMap();

  const raiz = crear('div', 'tetra-calibrar-offset');

  const encabezado = crear('div', 'tetra-calibrar-offset-encabezado');
  encabezado.appendChild(crear('h1', '', 'Calibrar offset'));
  const volver = crear('button', 'tetra-boton-volver', '← Ajustes');
  volver.type = 'button';
  encabezado.appendChild(volver);

  const ayuda = crear(
    'p',
    'tetra-calibrar-offset-ayuda',
    'Pulsa una tecla de columna al compás del click.',
  );
  const progreso = crear('p', 'tetra-calibrar-offset-progreso');
  progreso.setAttribute('role', 'status');

  const barra = crear('div', 'tetra-calibrar-offset-barra');
  barra.appendChild(crear('div', 'tetra-calibrar-offset-centro'));

  const media = crear('div', 'tetra-calibrar-offset-media', '0 ms');
  media.hidden = true;
  media.title = 'Media de tus golpes: positivo es tarde, negativo es temprano.';
  const detalle = crear('p', 'tetra-calibrar-offset-detalle');

  const acciones = crear('div', 'tetra-calibrar-offset-acciones');
  const empezar = crear('button', 'tetra-calibrar-offset-empezar tetra-boton-primario', 'Empezar');
  empezar.type = 'button';
  const usar = crear('button', 'tetra-calibrar-offset-usar tetra-boton-primario');
  usar.type = 'button';
  usar.hidden = true;
  const repetir = crear('button', 'tetra-calibrar-offset-repetir', 'Repetir');
  repetir.type = 'button';
  repetir.hidden = true;
  acciones.append(empezar, usar, repetir);

  raiz.append(encabezado, ayuda, progreso, barra, media, detalle, acciones);
  contenedor.appendChild(raiz);

  // -- Estado de la sesion en curso (null mientras no suena) --
  let ctx: AudioContext | null = null;
  /** T-063: mapa de tiempo del contexto de esta pantalla (vive y muere con `ctx`). */
  let mapa: MapaDeTiempo | null = null;
  /** Latencia de salida (ms) que `crearCalibracion` descuenta de cada golpe. */
  let latenciaDescontadaMs = 0;
  let t0 = 0;
  let calibracion: Calibracion | null = null;
  let offsetActual = 0;
  let rafId = 0;
  let destruida = false;

  /** Milisegundos desde el pulso 0, leidos del reloj de audio de esta pantalla. */
  function instanteDeAhora(): number {
    return (ctx!.currentTime - t0) * 1000;
  }

  /**
   * El mismo fechado que `clock.desdeTimeStamp` en la partida (T-063): el
   * `timeStamp` del evento pasa por el mapa de tiempo, que da la posicion que
   * se OIA en ese instante (sin el error de un bloque de audio). Se le vuelve a
   * sumar la latencia de salida porque `errorDeGolpe` la resta despues, igual
   * que lo hace el reloj de juego.
   */
  function instanteDelEvento(timeStamp: number): number {
    return (mapa!.aContexto(timeStamp) - t0) * 1000 + latenciaDescontadaMs;
  }

  function limpiarBarra(): void {
    for (const marca of Array.from(barra.querySelectorAll('.tetra-calibrar-offset-marca'))) {
      marca.remove();
    }
  }

  function mostrarMedia(valor: number): void {
    media.hidden = false;
    media.textContent = formatearOffset(valor);
  }

  function cerrarAudio(): void {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    delete window.__tetraCalibrarOffset;
    if (ctx !== null) {
      void ctx.close().catch(() => {
        // best-effort, igual que los demas contextos de la app.
      });
      ctx = null;
      mapa = null;
    }
  }

  function salir(): void {
    if (destruida) return;
    destruida = true;
    window.removeEventListener('keydown', alTecla);
    cerrarAudio();
    opciones.aAjustes();
  }

  function terminar(): void {
    const cal = calibracion!;
    cerrarAudio();
    progreso.textContent = '';
    empezar.hidden = true;
    repetir.hidden = false;
    if (cal.cantidad() < GOLPES_MINIMOS_PARA_USAR) {
      detalle.textContent = `Faltaron golpes (${cal.cantidad()} de ${GOLPES_MINIMOS_PARA_USAR} como mínimo)`;
      return;
    }
    const nuevo = offsetCalibrado(offsetActual, cal.media());
    mostrarMedia(cal.media());
    detalle.textContent = `Offset actual ${formatearOffset(offsetActual)}`;
    usar.textContent = textoDeUsar(nuevo);
    usar.hidden = false;
    usar.disabled = false;
    usar.onclick = () => {
      guardarOffset(nuevo);
      usar.disabled = true;
      detalle.textContent = `Offset guardado ${formatearOffset(nuevo)}`;
      offsetActual = nuevo;
    };
    usar.focus();
  }

  function cuadro(): void {
    rafId = 0;
    if (ctx === null || destruida) return;
    const instante = instanteDeAhora();
    if (instante >= instanteDeCierre()) {
      terminar();
      return;
    }
    const texto = textoDeProgreso(instante);
    if (texto !== null && texto !== progreso.textContent) progreso.textContent = texto;
    // eslint-disable-next-line no-restricted-globals -- solo refresca el texto y detecta el cierre; el tiempo sale del currentTime del AudioContext (CLAUDE.md, "El reloj es el audio").
    rafId = requestAnimationFrame(cuadro);
  }

  function alTecla(evento: KeyboardEvent): void {
    if (evento.code === 'Escape') {
      salir();
      return;
    }
    if (evento.repeat || ctx === null || calibracion === null || !keyMap.includes(evento.code)) {
      return;
    }
    evento.preventDefault();
    const golpe = calibracion.agregar(instanteDelEvento(evento.timeStamp));
    if (golpe === null) return;
    const marca = crear('div', 'tetra-calibrar-offset-marca');
    marca.style.left = `${posicionEnBarraDeCalibracion(golpe.error).toFixed(2)}%`;
    if (!golpe.cuenta) marca.classList.add('tetra-calibrar-offset-marca--entrada');
    barra.appendChild(marca);
    if (golpe.cuenta) mostrarMedia(calibracion.media());
  }

  function empezarSesion(): void {
    if (destruida) return;
    cerrarAudio();
    limpiarBarra();
    media.hidden = true;
    detalle.textContent = '';
    usar.hidden = true;
    repetir.hidden = true;
    empezar.hidden = true;
    empezar.blur();

    const contexto = new AudioContext();
    ctx = contexto;
    // El pulso 0 suena un poco despues de empezar; los demas, cada INTERVALO_DE_PULSO_MS.
    t0 = contexto.currentTime + AIRE_ANTES_DEL_PRIMER_PULSO_MS / 1000;
    const volumen = contexto.createGain();
    volumen.gain.value = gananciaDeVolumen(leerVolumen());
    volumen.connect(contexto.destination);
    const normal = crearClick(contexto, false);
    const acentuado = crearClick(contexto, true);
    for (let k = 0; k < PULSOS_TOTALES; k++) {
      const fuente = contexto.createBufferSource();
      fuente.buffer = k % 4 === 0 ? acentuado : normal;
      fuente.connect(volumen);
      fuente.start(t0 + (k * INTERVALO_DE_PULSO_MS) / 1000);
    }

    // El error se mide como en la partida: con el offset del usuario y la latencia de
    // salida que el reloj de juego tambien descuenta (clock.ts).
    offsetActual = leerOffset();
    const latenciaMs = (contexto.outputLatency || 0) * 1000;
    latenciaDescontadaMs = latenciaMs;
    mapa = crearMapaDeTiempo(contexto, { latenciaSalida: latenciaMs / 1000 });
    calibracion = crearCalibracion(offsetActual, latenciaMs);
    window.__tetraCalibrarOffset = { ctx: contexto, t0, latenciaMs };
    // eslint-disable-next-line no-restricted-globals -- ver cuadro().
    rafId = requestAnimationFrame(cuadro);
  }

  empezar.addEventListener('click', empezarSesion);
  repetir.addEventListener('click', empezarSesion);
  volver.addEventListener('click', salir);
  // Escape sale en cualquier momento; las teclas de columna solo cuentan mientras suena.
  window.addEventListener('keydown', alTecla);
}
