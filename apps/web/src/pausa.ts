// T-026: superposicion de pausa (menu y cuenta regresiva). DOM plano, nada de
// React dentro de la partida (CLAUDE.md, regla 4). No sabe nada del juego ni
// del audio: recibe tres acciones y expone dos vistas (menu y cuenta). Quien
// decide cuando pausar y cuando reanudar es game.ts.

import './pausa.css';

export interface AccionesPausa {
  continuar: () => void;
  reintentar: () => void;
  salir: () => void;
}

/**
 * T-060: el boton "Ajustar offset (+61 ms)" del menu. `aplicar` hace el ajuste y
 * devuelve el texto con el que el boton queda (ya apagado), por ejemplo
 * `Offset de la canción +61 ms`.
 */
export interface AjusteDeOffsetEnPausa {
  etiqueta: string;
  aplicar: () => string;
}

export interface MenuPausa {
  /**
   * Muestra el menu (Continuar, Reintentar, Salir). Con `ajuste` suma, entre
   * Reintentar y Salir, el boton de ajustar el offset segun lo jugado hasta ahi.
   */
  mostrarMenu(ajuste?: AjusteDeOffsetEnPausa | null): void;
  /** Muestra el numero grande de la cuenta regresiva en lugar del menu. */
  mostrarCuenta(numero: number): void;
  /** Quita la superposicion del documento. */
  destruir(): void;
}

function boton(texto: string, clase: string, alHacerClic: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = clase;
  b.textContent = texto;
  b.addEventListener('click', alHacerClic);
  return b;
}

/** Crea la superposicion dentro de `contenedor` (el envoltorio relativo de la partida). */
export function crearMenuPausa(contenedor: HTMLElement, acciones: AccionesPausa): MenuPausa {
  const velo = document.createElement('div');
  velo.className = 'tetra-pausa';
  velo.setAttribute('role', 'dialog');
  velo.setAttribute('aria-label', 'Partida en pausa');

  const panel = document.createElement('div');
  panel.className = 'tetra-pausa-panel';
  const titulo = document.createElement('h2');
  titulo.className = 'tetra-pausa-titulo';
  titulo.textContent = 'Pausa';
  const continuar = boton('Continuar', 'tetra-pausa-boton tetra-boton-primario', acciones.continuar);
  const reintentar = boton('Reintentar', 'tetra-pausa-boton', acciones.reintentar);
  const salir = boton('Salir al song select', 'tetra-pausa-boton', acciones.salir);
  // T-060: existe solo cuando hay golpes suficientes; mostrarMenu() lo pone o lo quita.
  let ajusteVigente: AjusteDeOffsetEnPausa | null = null;
  const ajustar = boton('', 'tetra-pausa-boton tetra-pausa-ajuste', () => {
    if (ajusteVigente === null || ajustar.disabled) return;
    ajustar.textContent = ajusteVigente.aplicar();
    ajustar.disabled = true;
    continuar.focus();
  });
  ajustar.hidden = true;
  const pista = document.createElement('p');
  pista.className = 'tetra-pausa-pista';
  pista.textContent = 'Esc para continuar';
  panel.append(titulo, continuar, reintentar, ajustar, salir, pista);

  const cuenta = document.createElement('div');
  cuenta.className = 'tetra-pausa-cuenta';
  cuenta.setAttribute('aria-live', 'polite');
  cuenta.hidden = true;

  velo.append(panel, cuenta);
  contenedor.appendChild(velo);

  let ultimoNumero = -1;

  return {
    mostrarMenu(ajuste?: AjusteDeOffsetEnPausa | null): void {
      ajusteVigente = ajuste ?? null;
      ajustar.hidden = ajusteVigente === null;
      ajustar.disabled = false;
      if (ajusteVigente !== null) ajustar.textContent = ajusteVigente.etiqueta;
      cuenta.hidden = true;
      panel.hidden = false;
      ultimoNumero = -1;
      continuar.focus();
    },
    mostrarCuenta(numero: number): void {
      panel.hidden = true;
      cuenta.hidden = false;
      // Se reescribe solo al cambiar de numero (una vez por segundo).
      if (numero !== ultimoNumero) {
        ultimoNumero = numero;
        cuenta.textContent = String(numero);
        // Reinicia la animacion de entrada del numero.
        cuenta.classList.remove('tetra-pausa-cuenta--pulso');
        void cuenta.offsetWidth;
        cuenta.classList.add('tetra-pausa-cuenta--pulso');
      }
    },
    destruir(): void {
      velo.remove();
    },
  };
}
