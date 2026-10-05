// T-011: router de pantallas, una maquina de estados simple (ver el
// ticket, "La estructura de navegacion": "no una libreria de routing").
// No hay historial ni URL: cada pantalla se monta sobre `#app` y se
// desmonta reemplazandola por la siguiente, mismo patron que ya usaban
// mostrarMenu/mostrarCargador antes de este ticket.
//
//   menu  ->  song-select  ->  juego  ->  resultados  ->  song-select
//     |
//     +----> ajustes  ->  menu
//     +----> mapeador ->  menu | song-select
//
// "juego" y "resultados" no son pantallas de este router: song-select.ts
// arranca el juego llamando a runGame directo (game.ts) y vuelve a
// mostrarSongSelect() el mismo al terminar (ver ese archivo, "Jugar"): son
// parte del ciclo de vida de song-select, no un estado propio que el menu o
// ajustes necesiten conocer.
//
// Sin tipo Router ni import circular a proposito: cada pantalla declara su
// propia interfaz chica de opciones (OpcionesMenu, OpcionesSongSelect,
// OpcionesAjustes), y este archivo es el unico que conoce a las tres e
// importa las tres funciones mostrarX. Mismo patron que ya usaba
// OpcionesCargador antes de T-011 (la pantalla del cargador de desarrollo,
// ya eliminada), solo que centralizado aca en vez de repartido entre
// menu.ts y esa pantalla.

import { mostrarMenu } from './menu.js';
import { mostrarSongSelect } from './song-select.js';
import { mostrarAjustes } from './ajustes.js';
import { mostrarCalibracion } from './calibracion.js';
import { mostrarMapeador } from './mapeador.js';
import type { SongId } from '@tetra/storage';

/** Arranca el router sobre `contenedor` (siempre `#app`) y muestra el menu, la pantalla raiz. */
export function iniciarRouter(contenedor: HTMLElement): void {
  function aMenu(): void {
    mostrarMenu(contenedor, { aJugar: (id) => aSongSelect(id), aAjustes, aMapeador });
  }
  // T-052: desde el menu se llega con la cancion que sonaba ya enfocada.
  function aSongSelect(cancionInicial?: SongId): void {
    mostrarSongSelect(contenedor, {
      aMenu,
      ...(cancionInicial !== undefined && { cancionInicial }),
      // T-032: editar una dificultad de la biblioteca en el mapeador.
      aMapeador: (songId, difficultyName) =>
        mostrarMapeador(contenedor, { aMenu, aSongSelect: () => aSongSelect(), abrir: { songId, difficultyName } }),
    });
  }
  function aAjustes(): void {
    mostrarAjustes(contenedor, { aMenu });
  }
  function aMapeador(): void {
    mostrarMapeador(contenedor, { aMenu, aSongSelect: () => aSongSelect() });
  }

  // T-015: `#calibracion` es una herramienta de desarrollo, fuera de la
  // navegacion normal (ningun boton lleva ahi). Se entra escribiendo el hash
  // en la URL, ya sea al cargar o con la app abierta.
  //
  // Cambiar el hash con otra pantalla montada (song select con audio y
  // worker vivos, por ejemplo) no se puede desmontar limpio desde aca: esas
  // pantallas se limpian solas solo por sus propios botones. Por eso, si el
  // hash cambia de un lado al otro de #calibracion, se recarga la pagina
  // (barato, es una herramienta de dev) en vez de montar encima. Salir de la
  // herramienta usa replaceState para limpiar el hash sin disparar
  // `hashchange`, asi el boton "Volver" no recarga.
  const HASH_CALIBRACION = '#calibracion';
  const enCalibracion = window.location.hash === HASH_CALIBRACION;
  window.addEventListener('hashchange', () => {
    if ((window.location.hash === HASH_CALIBRACION) !== enCalibracion) {
      window.location.reload();
    }
  });

  if (enCalibracion) {
    mostrarCalibracion(contenedor, {
      aMenu: () => {
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search,
        );
        aMenu();
      },
    });
  } else {
    aMenu();
  }
}
