// T-010: menu principal. Primera pantalla con identidad visual propia (ver
// docs/DISENO.md, el contrato de diseno completo): agrupa el logo que
// respira (logo.ts) con el cargador de desarrollo que ya existia
// (cargador.ts, T-006), que sigue siendo el camino a jugar hasta que
// exista el song select (T-011, ver el ticket, "Fuera de alcance").

import { mostrarCargador } from './cargador.js';
import { crearLogo, type Logo } from './logo.js';

/**
 * Muestra el menu principal dentro de `contenedor`, reemplazando lo que
 * hubiera. Es el nuevo punto de entrada de la app (ver main.ts): antes
 * arrancaba directo en el cargador (T-006), ahora el cargador vive adentro
 * del menu, en su propio panel.
 */
export function mostrarMenu(contenedor: HTMLElement): void {
  contenedor.innerHTML = '';

  const menu = document.createElement('div');
  menu.className = 'tetra-menu';

  const encabezado = document.createElement('div');
  encabezado.className = 'tetra-menu-encabezado';

  const zonaLogo = document.createElement('div');
  zonaLogo.className = 'tetra-menu-logo';
  encabezado.appendChild(zonaLogo);

  const titulo = document.createElement('h1');
  titulo.className = 'tetra-menu-titulo';
  titulo.textContent = 'Tetra';
  encabezado.appendChild(titulo);

  const lema = document.createElement('p');
  lema.className = 'tetra-menu-lema';
  lema.textContent = 'Instrumento de precision. Media tu timing al milisegundo.';
  encabezado.appendChild(lema);

  menu.appendChild(encabezado);

  const zonaCargador = document.createElement('div');
  zonaCargador.className = 'tetra-menu-cargador';
  menu.appendChild(zonaCargador);

  contenedor.appendChild(menu);

  // El logo se crea recien con zonaLogo ya en el documento (crearLogo le
  // agrega un <canvas> adentro). Si fallara por lo que sea (por ejemplo un
  // navegador sin CanvasRenderingContext2D), no debe tumbar el menu
  // entero: el ticket pide un menu usable, el logo es la pieza de
  // identidad, no una dependencia dura de "se puede jugar".
  let logo: Logo | null = null;
  try {
    logo = crearLogo(zonaLogo);
  } catch {
    // sin logo: el menu sigue siendo usable, el hueco visual queda vacio.
  }

  // El cargador (T-006) sigue siendo el camino a jugar (ver el ticket,
  // "Parte B"): se embebe entero en su propio panel, no se reescribe. Dos
  // ganchos lo conectan con el logo (ver cargador.ts, OpcionesCargador):
  //
  // - alEmpezarPartida: se llama justo antes de runGame, para apagar el
  //   loop del logo y su audio aparte antes de que el juego tome el foco
  //   (ver el ticket, "Ojo con el reloj" y "Rendimiento": nada de dos
  //   audios sonando ni un rAF colgado).
  // - alVolver: al volver de una partida (completada o abortada con
  //   Escape), en vez de redibujar solo el panel del cargador (el default
  //   de mostrarCargador), se reconstruye el menu entero para que el logo
  //   vuelva a respirar con una instancia nueva.
  mostrarCargador(zonaCargador, {
    alEmpezarPartida: () => logo?.detener(),
    alVolver: () => mostrarMenu(contenedor),
  });
}
