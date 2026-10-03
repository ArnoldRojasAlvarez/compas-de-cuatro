// T-010: menu principal. Primera pantalla con identidad visual propia (ver
// docs/DISENO.md, el contrato de diseno completo): el logo que respira
// (logo.ts) mas los dos accesos que pide T-011, "menu": Jugar (song select)
// y Ajustes.
//
// T-011 le saca el panel del cargador de desarrollo que tenia embebido
// (ver el ticket, "menu": "se le quita el panel del cargador... el cargador
// se reemplaza entero por el song select y ajustes"). El menu queda limpio:
// logo + titulo + lema + Jugar + Ajustes, nada mas.

import { crearLogo, type Logo } from './logo.js';

/** Gancho de navegacion que le pasa el router (ver router.ts). */
export interface OpcionesMenu {
  /** Ir al song select ("Jugar"). */
  aJugar: () => void;
  /** Ir a ajustes. */
  aAjustes: () => void;
  /** Ir al mapeador (editor de mapas, manual y automatico). */
  aMapeador: () => void;
}

/**
 * Muestra el menu principal dentro de `contenedor`, reemplazando lo que
 * hubiera. Es el nuevo punto de entrada de la app (ver router.ts).
 */
export function mostrarMenu(contenedor: HTMLElement, opciones: OpcionesMenu): void {
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

  // El logo se crea recien con zonaLogo ya en el documento (crearLogo le
  // agrega un <canvas> adentro). Si fallara por lo que sea (por ejemplo un
  // navegador sin CanvasRenderingContext2D), no debe tumbar el menu
  // entero: el menu tiene que seguir siendo usable, el logo es la pieza de
  // identidad, no una dependencia dura de "se puede jugar".
  let logo: Logo | null = null;
  try {
    logo = crearLogo(zonaLogo);
  } catch {
    // sin logo: el menu sigue siendo usable, el hueco visual queda vacio.
  }

  // Al salir del menu (a song-select o a ajustes) hay que apagar el logo:
  // su bucle de dibujo y su audio de fondo quedarian corriendo detras de la
  // pantalla nueva si no (ver logo.ts, `Logo.detener`, y el ticket,
  // "Cuidado con lo que ya funciona": "nada de audios colgados ni dos
  // loops"). No hace falta esperar a "empezar una partida" para esto como
  // antes de T-011: alcanza con dejar el menu.
  const accesos = document.createElement('div');
  accesos.className = 'tetra-menu-accesos';

  const botonJugar = document.createElement('button');
  botonJugar.type = 'button';
  botonJugar.className = 'tetra-menu-boton tetra-boton-primario';
  botonJugar.textContent = 'Jugar';
  botonJugar.addEventListener('click', () => {
    logo?.detener();
    opciones.aJugar();
  });
  accesos.appendChild(botonJugar);

  const botonAjustes = document.createElement('button');
  botonAjustes.type = 'button';
  botonAjustes.className = 'tetra-menu-boton';
  botonAjustes.textContent = 'Ajustes';
  botonAjustes.addEventListener('click', () => {
    logo?.detener();
    opciones.aAjustes();
  });
  accesos.appendChild(botonAjustes);

  const botonMapeador = document.createElement('button');
  botonMapeador.type = 'button';
  botonMapeador.className = 'tetra-menu-boton';
  botonMapeador.textContent = 'Mapeador';
  botonMapeador.addEventListener('click', () => {
    logo?.detener();
    opciones.aMapeador();
  });
  // Entre Jugar y Ajustes: crear es parte del juego, ajustar no.
  accesos.insertBefore(botonMapeador, botonAjustes);

  menu.appendChild(accesos);

  contenedor.appendChild(menu);
}
