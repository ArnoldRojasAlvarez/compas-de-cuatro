// T-058: la barra de ajuste (riel, botones - y + opcionales, valor en vivo).
// T-060 la saca de ajustes.ts para que el song select use la misma barra para
// el offset de la cancion (version compacta). DOM plano, sin reloj ni estado:
// quien la crea cablea los eventos.

import './barra.css';

/** Dato vivo en mono, junto a un control ("1200 ms", "80%"). */
export function crearDatoVivo(texto: string): HTMLElement {
  const dato = document.createElement('span');
  dato.className = 'tetra-ajustes-valor tetra-ajustes-dato';
  dato.textContent = texto;
  return dato;
}

export interface OpcionesBarra {
  id: string;
  min: number;
  max: number;
  paso: number;
  /** Posicion inicial de la barra. */
  valor: number;
  /** Texto inicial del valor, a la derecha de la barra. */
  texto: string;
  /** Una rayita en el centro del riel (el cero del offset). */
  marcaCentro?: boolean;
  /** Botones a los costados de la barra (el offset). Sin ellos, el hueco queda vacio. */
  menos?: HTMLElement;
  mas?: HTMLElement;
  /** T-060: riel y valor mas angostos, para el panel del song select. */
  compacta?: boolean;
}

/**
 * Barra de ajuste (T-058): el mismo componente para offset, velocidad,
 * volumen, efectos y atenuacion. Cuatro columnas fijas (hueco del `-`, riel,
 * hueco del `+`, valor), asi que todas las barras tienen el mismo largo de riel
 * y el valor cae en la misma columna, lleven botones o no.
 */
export function crearBarra(opciones: OpcionesBarra): {
  entrada: HTMLInputElement;
  dato: HTMLElement;
  control: HTMLElement;
} {
  const entrada = document.createElement('input');
  entrada.type = 'range';
  entrada.id = opciones.id;
  entrada.className = 'tetra-ajustes-rango';
  entrada.min = String(opciones.min);
  entrada.max = String(opciones.max);
  entrada.step = String(opciones.paso);
  entrada.value = String(opciones.valor);

  const riel = document.createElement('div');
  riel.className = opciones.marcaCentro
    ? 'tetra-ajustes-riel tetra-ajustes-riel-centro'
    : 'tetra-ajustes-riel';
  riel.appendChild(entrada);

  const dato = crearDatoVivo(opciones.texto);

  const control = document.createElement('div');
  control.className = opciones.compacta
    ? 'tetra-ajustes-barra tetra-ajustes-barra--compacta'
    : 'tetra-ajustes-barra';
  if (opciones.menos) {
    opciones.menos.classList.add('tetra-ajustes-barra-menos');
    control.appendChild(opciones.menos);
  }
  control.appendChild(riel);
  if (opciones.mas) {
    opciones.mas.classList.add('tetra-ajustes-barra-mas');
    control.appendChild(opciones.mas);
  }
  control.appendChild(dato);
  return { entrada, dato, control };
}

/**
 * Sentido de una flecha del teclado sobre una barra: +1 derecha o arriba, -1
 * izquierda o abajo, null si no es una flecha.
 */
export function sentidoDeFlecha(key: string): -1 | 1 | null {
  if (key === 'ArrowRight' || key === 'ArrowUp') return 1;
  if (key === 'ArrowLeft' || key === 'ArrowDown') return -1;
  return null;
}

/** Sentido de la rueda del mouse sobre una barra: hacia arriba (o derecha) sube, hacia abajo baja; 0 si no se movio. */
export function sentidoDeRueda(deltaY: number, deltaX: number): -1 | 0 | 1 {
  const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? -deltaY : deltaX;
  if (delta > 0) return 1;
  if (delta < 0) return -1;
  return 0;
}
