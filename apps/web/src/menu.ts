// T-010: menu principal. Primera pantalla con identidad visual propia (ver
// docs/DISENO.md): el logo que respira (logo.ts) y los accesos a Jugar,
// Mapeador y Ajustes.
//
// T-052 lo deja minimo: sin titulo ni lema (el logo ya dice TETRA), el logo
// mas grande (un clic en el es Jugar), y abajo a la izquierda, discreto, lo
// que esta sonando (musica-menu.ts: una cancion de la biblioteca) con pausa y
// siguiente. El fondo de la escena es la imagen de la cancion que suena.

import type { SongId } from '@tetra/storage';
import { fondoEscena } from './fondo-escena.js';
import { crearBotonIcono, cambiarBotonIcono } from './iconos.js';
import { crearLogo, type Logo } from './logo.js';
import { textoDeLoQueSuena } from './musica-menu-logica.js';
import { crearMusicaMenu, type MusicaMenu } from './musica-menu.js';

/** Gancho de navegacion que le pasa el router (ver router.ts). */
export interface OpcionesMenu {
  /** Ir al song select ("Jugar"), con la cancion que sonaba en el menu enfocada (si sonaba una de la biblioteca). */
  aJugar: (cancionInicial?: SongId) => void;
  /** Ir a ajustes. */
  aAjustes: () => void;
  /** Ir al mapeador (editor de mapas, manual y automatico). */
  aMapeador: () => void;
}

/** Fondo del menu: los bordes dejan ver la imagen y el centro (logo y botones) va mas oscuro, para que se lea sobre una portada clara o muy cargada (T-054). */
const FONDO_DEL_MENU = { oscuridad: 0.5, desenfoque: 2, centro: 1 };

/**
 * Muestra el menu principal dentro de `contenedor`, reemplazando lo que
 * hubiera. Es el nuevo punto de entrada de la app (ver router.ts).
 */
export function mostrarMenu(contenedor: HTMLElement, opciones: OpcionesMenu): void {
  contenedor.innerHTML = '';

  const menu = document.createElement('div');
  menu.className = 'tetra-menu';

  // Titulo accesible, sin verse: la pantalla sigue teniendo un h1 para quien
  // navega con lector, pero la marca visible es el logo.
  const tituloOculto = document.createElement('h1');
  tituloOculto.className = 'tetra-solo-lector';
  tituloOculto.textContent = 'Tetra';
  menu.appendChild(tituloOculto);

  const zonaLogo = document.createElement('div');
  zonaLogo.className = 'tetra-menu-logo';
  menu.appendChild(zonaLogo);

  // La musica se crea antes que el logo: el logo lee su analizador. Si fallara
  // por lo que sea (un navegador sin AudioContext), el menu tiene que seguir
  // siendo usable: la musica y el logo son identidad, no una dependencia dura
  // de "se puede jugar".
  let musica: MusicaMenu | null = null;
  try {
    musica = crearMusicaMenu();
  } catch {
    // sin musica: el menu sigue.
  }

  // El logo se crea recien con zonaLogo ya en el documento (crearLogo le
  // agrega un <canvas> adentro).
  let logo: Logo | null = null;
  contenedor.appendChild(menu);
  try {
    logo = crearLogo(zonaLogo, musica?.analizador ?? null);
  } catch {
    // sin logo: el hueco visual queda vacio.
  }

  /** Apaga todo lo que corre detras del menu: el rAF del logo y el audio. Se llama al salir por cualquier camino. */
  function apagar(): void {
    logo?.detener();
    musica?.detener();
  }

  // Un clic en el logo es Jugar. Sin rol de boton a proposito: el boton
  // "Jugar" de abajo es el control accesible (con teclado y lector), esto es
  // solo comodidad para el mouse, y un segundo "Jugar" duplicaria el nombre.
  zonaLogo.classList.add('tetra-menu-logo-clicable');
  function jugar(): void {
    // La elegida, aunque todavia se este decodificando: es la que el jugador ve.
    const inicial = musica?.eligida?.id;
    apagar();
    // El song select pone su propio fondo: no se limpia aca para no parpadear.
    opciones.aJugar(inicial);
  }
  zonaLogo.addEventListener('click', jugar);

  const accesos = document.createElement('div');
  accesos.className = 'tetra-menu-accesos';

  const botonJugar = document.createElement('button');
  botonJugar.type = 'button';
  botonJugar.className = 'tetra-menu-boton tetra-boton-primario';
  botonJugar.textContent = 'Jugar';
  botonJugar.addEventListener('click', jugar);
  accesos.appendChild(botonJugar);

  // Entre Jugar y Ajustes: crear es parte del juego, ajustar no.
  const botonMapeador = document.createElement('button');
  botonMapeador.type = 'button';
  botonMapeador.className = 'tetra-menu-boton';
  botonMapeador.textContent = 'Mapeador';
  botonMapeador.addEventListener('click', () => {
    apagar();
    fondoEscena().limpiar();
    opciones.aMapeador();
  });
  accesos.appendChild(botonMapeador);

  const botonAjustes = document.createElement('button');
  botonAjustes.type = 'button';
  botonAjustes.className = 'tetra-menu-boton';
  botonAjustes.textContent = 'Ajustes';
  botonAjustes.addEventListener('click', () => {
    apagar();
    fondoEscena().limpiar();
    opciones.aAjustes();
  });
  accesos.appendChild(botonAjustes);

  menu.appendChild(accesos);

  // -- Lo que suena: una linea y dos botones-icono, abajo a la izquierda. --
  if (musica !== null) {
    // Contenedor fijo (hijo directo de #app, que anima su entrada) y una fila
    // adentro: el fundido de "ya suena algo" va en la fila, porque la animacion
    // de entrada de #app > * fijaria la opacidad del contenedor en 1.
    const sonando = document.createElement('div');
    sonando.className = 'tetra-menu-sonando';
    const fila = document.createElement('div');
    fila.className = 'tetra-menu-sonando-fila';
    sonando.appendChild(fila);

    const botonPausa = crearBotonIcono('pausa', 'Pausar la musica');
    const botonSiguiente = crearBotonIcono('siguiente', 'Siguiente cancion');
    const texto = document.createElement('span');
    texto.className = 'tetra-menu-sonando-texto';
    fila.append(botonPausa, botonSiguiente, texto);
    contenedor.appendChild(sonando);

    const m = musica;
    botonPausa.addEventListener('click', () => m.alternarPausa());
    botonSiguiente.addEventListener('click', () => void m.siguiente());

    function pintar(): void {
      // Hasta que suena algo (la biblioteca se lee y la cancion se decodifica)
      // no se muestra nada: evita un "Click track" fugaz antes del titulo real.
      fila.classList.add('tetra-menu-sonando-visible');
      // T-054: la elegida, no la que suena. Apenas se elige se ve su fondo y
      // su titulo, atenuado hasta que la decodificacion termina y arranca.
      const cancion = m.eligida;
      fila.classList.toggle('tetra-menu-sonando-cargando', m.cargando);
      // Sin cancion de la biblioteca suena el click track: se nombra tal cual.
      const t = cancion ? textoDeLoQueSuena(cancion.titulo, cancion.artista) : 'Click track';
      if (texto.textContent !== t) texto.textContent = t;
      texto.title = t;
      if (m.pausada) cambiarBotonIcono(botonPausa, 'reproducir', 'Reanudar la musica');
      else cambiarBotonIcono(botonPausa, 'pausa', 'Pausar la musica');
      fondoEscena().poner(cancion?.background, FONDO_DEL_MENU);
    }
    m.alCambiar(pintar);
  }
}
