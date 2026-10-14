// T-056: los dos avisos de los atajos de la partida, en DOM plano y creados una
// sola vez (mismo patron que el HUD de game.ts):
//
//   - El aro del reintento mantenido (esquina superior izquierda): se llena
//     mientras se mantiene la tecla y solo existe a la vista mientras se mantiene.
//   - "Espacio para saltar" (abajo a la derecha): visible mientras el salto de
//     intro este disponible.
//   - T-057: "Velocidad 7 · 514 ms" (arriba al centro): aparece al cambiar la
//     velocidad con F3/F4 y se desvanece solo.
//   - T-060: "Offset de la canción +12 ms" (justo debajo): aparece al ajustar el
//     offset con - y = y se desvanece solo.
//
// Aca no se mide tiempo: game.ts le pasa el progreso (de `clock.now()` y del
// `event.timeStamp` del keydown) y si el salto esta disponible.

import './atajos.css';
import { PASOS_DE_ALPHA_AVISO } from './velocidad-aviso-logica.js';

const NS_SVG = 'http://www.w3.org/2000/svg';

/** Pasos del trazo del aro: no se reescribe si el progreso no cambia de paso. */
const PASOS_ARO = 32;

/** Radio del aro y su circunferencia (unidades del viewBox de 24). */
const RADIO_ARO = 9;
const CIRCUNFERENCIA = 2 * Math.PI * RADIO_ARO;

export interface AvisosDeAtajos {
  /** Progreso del reintento de 0 a 1. 0 oculta el aro. Solo escribe cuando cambia de paso. */
  mostrarReintento(progreso: number): void;
  /** Muestra u oculta "Espacio para saltar". Solo escribe cuando cambia. */
  mostrarSalto(visible: boolean): void;
  /**
   * T-057: el aviso de velocidad con su opacidad en pasos de 0 a
   * `PASOS_DE_ALPHA_AVISO` (0 lo oculta). Solo escribe lo que cambia.
   */
  mostrarVelocidad(texto: string, paso: number): void;
  /** T-060: el aviso del offset ("Offset de la canción +12 ms"), con la misma escala de opacidad que el de velocidad. */
  mostrarOffset(texto: string, paso: number): void;
}

/** Crea los dos avisos como hijos de `hud` (la capa `.tetra-hud`). */
export function crearAvisosDeAtajos(hud: HTMLElement): AvisosDeAtajos {
  // -- Aro del reintento --
  const reintento = document.createElement('div');
  reintento.className = 'tetra-reintento';
  reintento.hidden = true;
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'tetra-reintento-aro');
  const fondo = document.createElementNS(NS_SVG, 'circle');
  fondo.setAttribute('class', 'tetra-reintento-fondo');
  const relleno = document.createElementNS(NS_SVG, 'circle');
  relleno.setAttribute('class', 'tetra-reintento-relleno');
  for (const circulo of [fondo, relleno]) {
    circulo.setAttribute('cx', '12');
    circulo.setAttribute('cy', '12');
    circulo.setAttribute('r', String(RADIO_ARO));
  }
  relleno.setAttribute('stroke-dasharray', String(CIRCUNFERENCIA));
  relleno.setAttribute('stroke-dashoffset', String(CIRCUNFERENCIA));
  svg.append(fondo, relleno);
  const texto = document.createElement('span');
  texto.className = 'tetra-reintento-texto';
  texto.textContent = 'Reintentar';
  reintento.append(svg, texto);

  // -- Aviso de saltar intro --
  const salto = document.createElement('div');
  salto.className = 'tetra-saltar';
  salto.hidden = true;
  salto.textContent = 'Espacio para saltar';

  // -- Aviso de velocidad --
  const velocidad = document.createElement('div');
  velocidad.className = 'tetra-velocidad-aviso';
  velocidad.hidden = true;
  velocidad.setAttribute('role', 'status');

  // -- Aviso de offset (T-060) --
  const offset = document.createElement('div');
  offset.className = 'tetra-offset-aviso';
  offset.hidden = true;
  offset.setAttribute('role', 'status');

  hud.append(reintento, salto, velocidad, offset);

  // Paso del aro (0 a PASOS_ARO).
  let paso = 0;
  let saltoVisible = false;
  let textoVelocidad = '';
  let pasoVelocidad = 0;
  let textoOffset = '';
  let pasoOffset = 0;

  return {
    mostrarReintento(progreso: number): void {
      const nuevo = Math.round(Math.min(1, Math.max(0, progreso)) * PASOS_ARO);
      if (nuevo === paso) return;
      const aparece = paso === 0;
      paso = nuevo;
      if (nuevo === 0) {
        reintento.hidden = true;
        return;
      }
      if (aparece) reintento.hidden = false;
      relleno.setAttribute(
        'stroke-dashoffset',
        (CIRCUNFERENCIA * (1 - nuevo / PASOS_ARO)).toFixed(2),
      );
    },

    mostrarSalto(visible: boolean): void {
      if (visible === saltoVisible) return;
      saltoVisible = visible;
      salto.hidden = !visible;
    },

    mostrarVelocidad(texto: string, paso: number): void {
      const nuevo = Math.min(PASOS_DE_ALPHA_AVISO, Math.max(0, Math.round(paso)));
      if (texto !== textoVelocidad) {
        textoVelocidad = texto;
        velocidad.textContent = texto;
      }
      if (nuevo === pasoVelocidad) return;
      pasoVelocidad = nuevo;
      velocidad.hidden = nuevo === 0;
      velocidad.style.opacity = String(nuevo / PASOS_DE_ALPHA_AVISO);
    },

    mostrarOffset(texto: string, paso: number): void {
      const nuevo = Math.min(PASOS_DE_ALPHA_AVISO, Math.max(0, Math.round(paso)));
      if (texto !== textoOffset) {
        textoOffset = texto;
        offset.textContent = texto;
      }
      if (nuevo === pasoOffset) return;
      pasoOffset = nuevo;
      offset.hidden = nuevo === 0;
      offset.style.opacity = String(nuevo / PASOS_DE_ALPHA_AVISO);
    },
  };
}
