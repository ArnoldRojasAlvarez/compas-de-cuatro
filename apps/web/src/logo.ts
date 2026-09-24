// T-010: el logo que respira (docs/DISENO.md, "El logotipo"; ticket en
// docs/tickets/T-010-menu-y-logo.md, "Parte C"). Un anillo con la marca al
// centro y el espectro de audio alrededor de toda la circunferencia,
// partido en cuatro cuadrantes espejados que giran en sentido horario. Se
// dibuja en Canvas 2D porque es generativo (cambia cada cuadro): la logica
// pura (deteccion de pulso, alturas de barra, angulos) vive en
// logo-logica.ts, testeable sin navegador; este archivo es todo lo que si
// necesita DOM, Canvas y AudioContext.
//
// Musica del menu: reproduccion APARTE del AudioClock del juego (ver
// CLAUDE.md, "El reloj es el audio", y el ticket, "Ojo con el reloj"). El
// AudioContext de aca solo alimenta el AnalyserNode del visualizador,
// nunca mide tiempo de gameplay ni comparte instancia con game.ts (que
// arma el suyo propio en runGame). Se cierra entero al llamar a detener().

import { RUTA_AUDIO_CLICK } from './click-track.js';
import {
  ESTADO_PULSO_INICIAL,
  anguloDeRotacion,
  avanzarPulso,
  calcularAlturasDeBarras,
  calcularEnergia,
  escalaTotal,
  type EstadoPulso,
} from './logo-logica.js';

const TAMANO_CSS = 168; // px, lado del cuadrado del canvas en pantalla: chico a proposito, para que el menu entre sin scroll (ver el ticket, criterios de aceptacion)
const NUM_BARRAS_POR_CUADRANTE = 10;
const FRACCION_RADIO_ANILLO = 0.62; // fraccion del radio del canvas
const FRACCION_LARGO_BARRA_MAX = 0.3; // fraccion del radio del canvas
const GROSOR_ANILLO = 3;
const OPACIDAD_BARRA_MINIMA = 0.35; // las barras nunca desaparecen del todo, ni en silencio

export interface Logo {
  /**
   * Detiene el bucle de dibujo y libera el audio del menu: desconecta el
   * AnalyserNode, para la fuente y cierra el AudioContext dedicado. Hay
   * que llamarla SIEMPRE antes de arrancar una partida (ver cargador.ts,
   * `OpcionesCargador.alEmpezarPartida`, y menu.ts) para no dejar dos
   * audios sonando en paralelo ni un rAF colgado (ver el ticket,
   * "Rendimiento"). Es seguro llamarla mas de una vez.
   */
  detener(): void;
}

/** Lee un token de CSS ya resuelto por el navegador. Canvas 2D no entiende
 * `var(--token)` directo, asi que hace falta pedirle el valor calculado al
 * DOM; se hace una vez por cuadro (no es costoso: es una lectura, no un
 * reflow) para que si alguna vez el tema cambiara en caliente el logo lo
 * siga. */
function tokenCss(nombre: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

/**
 * Crea el logo dentro de `contenedor` (le agrega un `<canvas>`) y arranca
 * su bucle de dibujo y su audio de fondo. Ver `Logo.detener` para la
 * limpieza.
 */
export function crearLogo(contenedor: HTMLElement): Logo {
  const canvas = document.createElement('canvas');
  canvas.className = 'tetra-logo';
  const dpr = window.devicePixelRatio || 1;
  canvas.width = TAMANO_CSS * dpr;
  canvas.height = TAMANO_CSS * dpr;
  canvas.style.width = `${TAMANO_CSS}px`;
  canvas.style.height = `${TAMANO_CSS}px`;
  contenedor.appendChild(canvas);

  const contextoCrudo = canvas.getContext('2d');
  if (!contextoCrudo) {
    throw new Error('El navegador no soporta CanvasRenderingContext2D: no se puede dibujar el logo.');
  }
  // Se recorta a una constante nueva, tipada sin null: el guard de arriba ya
  // lo garantiza, pero TypeScript no propaga ese angostamiento dentro de las
  // funciones anidadas declaradas mas abajo (dibujar(), cuadro()), mismo
  // caso que `contenedor` en game.ts (ver el comentario de ahi, `runGame`).
  const ctx2d: CanvasRenderingContext2D = contextoCrudo;
  ctx2d.scale(dpr, dpr);

  // prefers-reduced-motion (ticket, criterio de aceptacion): sin giro ni
  // pulso. Se lee una sola vez al crear el logo, no en cada cuadro: cambiar
  // la preferencia del sistema operativo a mitad de sesion es un caso tan
  // raro que no vale la pena complicar el bucle por el.
  const prefiereMovimientoReducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let detenido = false;
  let rafId = 0;
  let tick = 0;
  let estadoPulso: EstadoPulso = ESTADO_PULSO_INICIAL;

  // -- Audio del menu (ver el comentario de arriba de todo el archivo) --
  let audioCtx: AudioContext | null = null;
  let nodoFuente: AudioBufferSourceNode | null = null;
  let analizador: AnalyserNode | null = null;
  let datosFrecuencia = new Uint8Array(0);

  async function iniciarAudio(): Promise<void> {
    try {
      const respuesta = await fetch(RUTA_AUDIO_CLICK);
      if (!respuesta.ok || detenido) return;
      const arrayBuffer = await respuesta.arrayBuffer();
      if (detenido) return;

      const ctx = new AudioContext();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      if (detenido) {
        void ctx.close().catch(() => {});
        return;
      }

      const fuente = ctx.createBufferSource();
      fuente.buffer = buffer;
      fuente.loop = true; // en bucle: es solo senal para el visualizador, no una cancion elegida (eso es de un ticket posterior)

      const nodoAnalizador = ctx.createAnalyser();
      // fftSize chico: 64 bins alcanzan de sobra para 10 barras por
      // cuadrante (NUM_BARRAS_POR_CUADRANTE) y es barato de leer cada
      // cuadro. No hace falta resolucion de frecuencia fina para un
      // visualizador decorativo.
      nodoAnalizador.fftSize = 128;

      fuente.connect(nodoAnalizador);
      nodoAnalizador.connect(ctx.destination);
      fuente.start();

      // Autoplay: si el navegador arranca el contexto en 'suspended' (sin
      // gesto del usuario), se reintenta en el primer click o tecla que
      // llegue a la pagina. En el e2e (apps/web/playwright.config.ts)
      // Chromium corre con --autoplay-policy=no-user-gesture-required,
      // asi que ahi arranca directo sin necesitar esto.
      if (ctx.state === 'suspended') {
        const reintentar = (): void => {
          void ctx.resume();
        };
        window.addEventListener('pointerdown', reintentar, { once: true });
        window.addEventListener('keydown', reintentar, { once: true });
      }

      audioCtx = ctx;
      nodoFuente = fuente;
      analizador = nodoAnalizador;
      datosFrecuencia = new Uint8Array(nodoAnalizador.frequencyBinCount);
    } catch {
      // Sin audio (fetch fallido, decodeAudioData fallido, AudioContext no
      // disponible en este entorno): el logo se queda en su respiracion de
      // reposo, sin espectro. No es un error que valga la pena mostrarle a
      // quien esta en el menu: es solo el visualizador, no bloquea jugar.
    }
  }
  void iniciarAudio();

  function dibujar(angulo: number, escala: number, alturas: number[]): void {
    const mitad = TAMANO_CSS / 2;
    ctx2d.clearRect(0, 0, TAMANO_CSS, TAMANO_CSS);
    ctx2d.save();
    ctx2d.translate(mitad, mitad);
    ctx2d.scale(escala, escala);

    const acento = tokenCss('--acento');
    ctx2d.strokeStyle = acento;
    ctx2d.fillStyle = acento;

    // El anillo.
    ctx2d.globalAlpha = 1;
    ctx2d.lineWidth = GROSOR_ANILLO;
    const radioAnillo = mitad * FRACCION_RADIO_ANILLO;
    ctx2d.beginPath();
    ctx2d.arc(0, 0, radioAnillo, 0, Math.PI * 2);
    ctx2d.stroke();

    // El espectro: cuatro cuadrantes espejados (docs/DISENO.md, "El
    // logotipo"). Los cuadrantes impares recorren las mismas barras en
    // orden inverso, asi cada par de cuadrantes vecinos es un espejo del
    // otro en su borde compartido; los cuatro giran juntos segun `angulo`,
    // asi que la figura completa siempre es simetrica de a cuatro, en
    // cualquier cuadro.
    const radioMax = mitad * (FRACCION_RADIO_ANILLO + FRACCION_LARGO_BARRA_MAX);
    for (let cuadrante = 0; cuadrante < 4; cuadrante++) {
      const invertido = cuadrante % 2 === 1;
      for (let i = 0; i < alturas.length; i++) {
        const indice = invertido ? alturas.length - 1 - i : i;
        // El indice siempre cae dentro de 0..alturas.length-1 (ver como se
        // calcula arriba): el `?? 0` es solo para noUncheckedIndexedAccess,
        // no un caso real de arreglo mas corto que numBarras.
        const amplitud = alturas[indice] ?? 0;
        const t = alturas.length > 1 ? i / (alturas.length - 1) : 0;
        const anguloBarra = angulo + (cuadrante * Math.PI) / 2 + t * (Math.PI / 2);
        const radioBarra = radioAnillo + amplitud * (radioMax - radioAnillo);

        ctx2d.globalAlpha = OPACIDAD_BARRA_MINIMA + amplitud * (1 - OPACIDAD_BARRA_MINIMA);
        ctx2d.beginPath();
        ctx2d.moveTo(Math.cos(anguloBarra) * radioAnillo, Math.sin(anguloBarra) * radioAnillo);
        ctx2d.lineTo(Math.cos(anguloBarra) * radioBarra, Math.sin(anguloBarra) * radioBarra);
        ctx2d.stroke();
      }
    }

    // La marca al centro, en la face Display (docs/DISENO.md).
    ctx2d.globalAlpha = 1;
    ctx2d.font = `600 22px ${tokenCss('--fuente-display')}`;
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText('TETRA', 0, 1);

    ctx2d.restore();
  }

  function cuadro(): void {
    if (detenido) return;
    tick++;

    let alturas: number[];
    if (analizador) {
      analizador.getByteFrequencyData(datosFrecuencia);
      const energia = calcularEnergia(datosFrecuencia);
      estadoPulso = avanzarPulso(estadoPulso, energia);
      alturas = calcularAlturasDeBarras(datosFrecuencia, NUM_BARRAS_POR_CUADRANTE);
    } else {
      // Sin audio todavia (o nunca): sigue respirando en reposo, con el
      // espectro en su piso minimo (ver OPACIDAD_BARRA_MINIMA arriba).
      alturas = calcularAlturasDeBarras([], NUM_BARRAS_POR_CUADRANTE);
    }

    dibujar(anguloDeRotacion(tick), escalaTotal(tick, estadoPulso.escalaPulso), alturas);

    // eslint-disable-next-line no-restricted-globals -- dibujo del logo del menu, no mide tiempo de juego: el menu no juzga nada (ver CLAUDE.md, "rAF sirve para dibujar, nunca para medir tiempo de juego", y docs/tickets/T-010-menu-y-logo.md, "Sobre rAF").
    rafId = requestAnimationFrame(cuadro);
  }

  if (prefiereMovimientoReducido) {
    // Un solo cuadro estatico, sin girar ni pulsar, y sin programar mas
    // cuadros: es la lectura mas simple y segura de "no gira ni pulsa"
    // (ver el ticket, criterios de aceptacion).
    dibujar(0, 1, calcularAlturasDeBarras([], NUM_BARRAS_POR_CUADRANTE));
  } else {
    // eslint-disable-next-line no-restricted-globals -- primer cuadro del logo del menu (ver el comentario dentro de cuadro(), mas abajo en este mismo archivo).
    rafId = requestAnimationFrame(cuadro);
  }

  function detener(): void {
    if (detenido) return;
    detenido = true;
    if (rafId !== 0) cancelAnimationFrame(rafId);
    try {
      nodoFuente?.stop();
    } catch {
      // ya estaba detenida o nunca llego a arrancar (por ejemplo, se llamo
      // a detener() mientras iniciarAudio() todavia estaba cargando): no
      // hay nada mas que hacer.
    }
    nodoFuente?.disconnect();
    analizador?.disconnect();
    if (audioCtx) {
      void audioCtx.close().catch(() => {
        // cerrar el contexto es best-effort, igual que en cargador.ts y
        // game.ts: si el navegador ya lo cerro por su cuenta no hay nada
        // que hacer.
      });
    }
  }

  return { detener };
}
