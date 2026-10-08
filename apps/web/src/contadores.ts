// T-056: contadores del HUD de la partida, en DOM plano y con el mismo patron
// que el HUD de game.ts (T-019): los elementos se crean UNA vez al armar la
// partida y despues solo se escribe lo que cambio. Nada de querySelector, de
// nodos nuevos ni de arrays nuevos por frame ni por golpe.
//
//   - Cajitas de teclas bajo cada carril: tecla asignada y pulsaciones.
//   - Contador de juicios al costado de la pista: seis numeros en mono.
//   - Barra de error de timing bajo la linea de juicio.
//
// La barra de error es DOM y no Pixi: el HUD ya es DOM, asi el playfield de
// @tetra/engine (T-039, sin allocaciones) no cambia, y cada marca es un
// elemento de un pool fijo cuya posicion se escribe una vez por golpe y cuya
// opacidad solo cambia de paso (16 pasos en 2 s), sin layout por frame.
//
// Los tiempos que llegan (`t`) son siempre de reloj de juego (`clock.now()`):
// ninguna funcion de aca lee performance.now() ni usa timers.

import type { HitWindows, Judgement, Ms } from '@tetra/core';
import {
  MARCAS_EN_BARRA,
  PASOS_DE_ALPHA,
  crearMediaMovil,
  pasoDeAlphaDeMarca,
  posicionEnBarra,
  tramosDeBarra,
} from './contadores-logica.js';
import './contadores.css';

/** Orden fijo de los seis numeros del contador de juicios: del mejor al peor. */
const ORDEN_JUICIOS: readonly Judgement[] = [
  'max',
  'perfect',
  'great',
  'good',
  'bad',
  'miss',
];

/** Nombre al estilo osu!mania que lleva cada juicio en la pista (solo para `title`). */
const NOMBRE_DE_JUICIO: Record<Judgement, string> = {
  max: 'MAX',
  perfect: '300',
  great: '200',
  good: '100',
  bad: '50',
  miss: 'MISS',
};

/** Token de color de cada juicio, de adentro hacia afuera en las franjas de la barra. */
const TOKEN_DE_FRANJA: readonly string[] = [
  '--j-max',
  '--j-300',
  '--j-200',
  '--j-100',
  '--j-50',
];

export interface OpcionesDeContadores {
  /** Cajitas de teclas (ajuste "Teclas"). */
  teclas: boolean;
  /** Contador de juicios (ajuste "Juicios"). */
  juicios: boolean;
  /** Barra de error (ajuste "Barra de error"). */
  barraDeError: boolean;
  /** Nombre de la tecla de cada columna ("D", "F"...), ya legible. */
  etiquetasDeTeclas: readonly string[];
  /** Ventanas de juicio del OD del mapa: definen las franjas y el ancho de la barra. */
  ventanas: HitWindows;
}

export interface Contadores {
  /** Una pulsacion real (keydown, no repeticion): ilumina la cajita y escribe el total. */
  teclaAbajo(columna: number, total: number): void;
  /** La tecla se solto: apaga la cajita. */
  teclaArriba(columna: number): void;
  /** Suelta todas las cajitas (al reanudar la pausa). */
  soltarTeclas(): void;
  /** Un golpe con su desviacion (ms, positivo tarde). Los miss no tienen una desviacion que mostrar: se ignoran. */
  golpe(error: Ms, juicio: Judgement, t: Ms): void;
  /** Una vez por frame: contadores de juicio y desvanecido de las marcas. */
  actualizar(t: Ms, conteos: Readonly<Record<Judgement, number>>): void;
}

function crear(etiqueta: string, clase: string, texto?: string): HTMLElement {
  const el = document.createElement(etiqueta);
  el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

/**
 * Gradiente simetrico con las franjas de las ventanas como bandas tenues
 * (bad en los bordes, max en el centro). Se arma una sola vez por partida.
 */
function gradienteDeFranjas(ventanas: HitWindows): string {
  const paradas = tramosDeBarra(ventanas).map((tramo) => {
    const color = `color-mix(in srgb, var(${TOKEN_DE_FRANJA[tramo.nivel]!}) 38%, transparent)`;
    return `${color} ${tramo.desde.toFixed(2)}% ${tramo.hasta.toFixed(2)}%`;
  });
  return `linear-gradient(to right, ${paradas.join(', ')})`;
}

/**
 * Crea los contadores como hijos de `hud` (la capa `.tetra-hud` de game.ts).
 * Lo que un ajuste apaga no se crea: no queda en el DOM ni se actualiza. Con
 * los tres apagados el HUD queda exactamente como antes de este ticket.
 */
export function crearContadores(
  hud: HTMLElement,
  opciones: OpcionesDeContadores,
): Contadores {
  // -- Cajitas de teclas --
  const cajas: HTMLElement[] = [];
  const cuentas: HTMLElement[] = [];
  const abajo: boolean[] = [false, false, false, false];
  if (opciones.teclas) {
    const raiz = crear('div', 'tetra-teclas');
    for (let columna = 0; columna < 4; columna++) {
      const caja = crear('div', 'tetra-tecla');
      const nombre = crear(
        'span',
        'tetra-tecla-nombre',
        opciones.etiquetasDeTeclas[columna] ?? '',
      );
      const cuenta = crear('span', 'tetra-tecla-cuenta', '0');
      caja.append(nombre, cuenta);
      raiz.appendChild(caja);
      cajas.push(caja);
      cuentas.push(cuenta);
    }
    hud.appendChild(raiz);
  }

  // -- Contador de juicios --
  const numeros: HTMLElement[] = [];
  // Ultimo valor escrito de cada uno (los textos arrancan en "0").
  const escritos = new Int32Array(ORDEN_JUICIOS.length);
  if (opciones.juicios) {
    const raiz = crear('div', 'tetra-juicios');
    for (const juicio of ORDEN_JUICIOS) {
      const numero = crear('span', `tetra-juicio tetra-juicio--${juicio}`, '0');
      numero.title = NOMBRE_DE_JUICIO[juicio];
      raiz.appendChild(numero);
      numeros.push(numero);
    }
    hud.appendChild(raiz);
  }

  // -- Barra de error --
  const marcas: HTMLElement[] = [];
  const tNacimiento = new Float64Array(MARCAS_EN_BARRA);
  // Paso de opacidad de cada marca; 0 es apagada (oculta por CSS).
  const pasos = new Uint8Array(MARCAS_EN_BARRA);
  // Cadenas de opacidad precalculadas: escribir un paso no arma un string nuevo cada vez.
  const opacidades: string[] = [];
  for (let paso = 0; paso <= PASOS_DE_ALPHA; paso++)
    opacidades.push(String(paso / PASOS_DE_ALPHA));
  let siguienteMarca = 0;
  const media = crearMediaMovil();
  let flecha: HTMLElement | null = null;
  const ventanaMax = opciones.ventanas.bad;
  if (opciones.barraDeError) {
    const raiz = crear('div', 'tetra-error');
    const franjas = crear('div', 'tetra-error-franjas');
    franjas.style.background = gradienteDeFranjas(opciones.ventanas);
    raiz.appendChild(franjas);
    raiz.appendChild(crear('div', 'tetra-error-centro'));
    for (let i = 0; i < MARCAS_EN_BARRA; i++) {
      const marca = crear('div', 'tetra-error-marca');
      raiz.appendChild(marca);
      marcas.push(marca);
    }
    flecha = crear('div', 'tetra-error-media');
    raiz.appendChild(flecha);
    hud.appendChild(raiz);
  }

  return {
    teclaAbajo(columna: number, total: number): void {
      const cuenta = cuentas[columna];
      if (cuenta === undefined) return;
      cuenta.textContent = String(total);
      if (!abajo[columna]) {
        abajo[columna] = true;
        cajas[columna]!.classList.add('tetra-tecla--abajo');
      }
    },

    teclaArriba(columna: number): void {
      if (abajo[columna] !== true) return;
      abajo[columna] = false;
      cajas[columna]!.classList.remove('tetra-tecla--abajo');
    },

    soltarTeclas(): void {
      for (let columna = 0; columna < cajas.length; columna++) {
        if (!abajo[columna]) continue;
        abajo[columna] = false;
        cajas[columna]!.classList.remove('tetra-tecla--abajo');
      }
    },

    golpe(error: Ms, juicio: Judgement, t: Ms): void {
      if (flecha === null || juicio === 'miss') return;
      const posicion = posicionEnBarra(error, ventanaMax);
      const marca = marcas[siguienteMarca]!;
      const indice = siguienteMarca;
      siguienteMarca = (siguienteMarca + 1) % MARCAS_EN_BARRA;
      tNacimiento[indice] = t;
      pasos[indice] = PASOS_DE_ALPHA;
      marca.style.left = `${(50 + 50 * posicion).toFixed(2)}%`;
      marca.dataset.juicio = juicio;
      marca.style.opacity = opacidades[PASOS_DE_ALPHA]!;
      // La flechita sigue la media movil de los ultimos golpes.
      media.agregar(error);
      // Desplazamiento desde el centro, en % del ancho de la barra (ver .tetra-error-media en contadores.css).
      flecha.style.transform = `translateX(${(50 * posicionEnBarra(media.valor(), ventanaMax)).toFixed(2)}%)`;
      flecha.style.opacity = '1';
    },

    actualizar(t: Ms, conteos: Readonly<Record<Judgement, number>>): void {
      for (let i = 0; i < numeros.length; i++) {
        const cantidad = conteos[ORDEN_JUICIOS[i]!];
        if (cantidad !== escritos[i]) {
          escritos[i] = cantidad;
          numeros[i]!.textContent = String(cantidad);
        }
      }
      for (let i = 0; i < marcas.length; i++) {
        const actual = pasos[i]!;
        if (actual === 0) continue;
        const nuevo = pasoDeAlphaDeMarca(t - tNacimiento[i]!);
        if (nuevo === actual) continue;
        pasos[i] = nuevo;
        marcas[i]!.style.opacity = opacidades[nuevo]!;
      }
    },
  };
}
