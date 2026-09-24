// T-011: router de pantallas, una maquina de estados simple (ver el
// ticket, "La estructura de navegacion": "no una libreria de routing").
// No hay historial ni URL: cada pantalla se monta sobre `#app` y se
// desmonta reemplazandola por la siguiente, mismo patron que ya usaban
// mostrarMenu/mostrarCargador antes de este ticket.
//
//   menu  ->  song-select  ->  juego  ->  resultados  ->  song-select
//     |
//     +----> ajustes  ->  menu
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
// OpcionesCargador antes de T-011, solo que centralizado aca en vez de
// repartido entre menu.ts y cargador.ts.

import { mostrarMenu } from './menu.js';
import { mostrarSongSelect } from './song-select.js';
import { mostrarAjustes } from './ajustes.js';

/** Arranca el router sobre `contenedor` (siempre `#app`) y muestra el menu, la pantalla raiz. */
export function iniciarRouter(contenedor: HTMLElement): void {
  function aMenu(): void {
    mostrarMenu(contenedor, { aJugar: aSongSelect, aAjustes });
  }
  function aSongSelect(): void {
    mostrarSongSelect(contenedor, { aMenu });
  }
  function aAjustes(): void {
    mostrarAjustes(contenedor, { aMenu });
  }

  aMenu();
}
