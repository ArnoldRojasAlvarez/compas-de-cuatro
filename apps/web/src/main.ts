// T-006: punto de entrada de la app. Antes (T-004) esto cargaba directo el
// fixture click-120 y arrancaba el juego. T-010 lo cambio para arrancar en
// el menu. T-011 agrega el router de pantallas (ver router.ts) entre medio:
// el menu ya no es la unica pantalla ni conoce a las demas, el router es
// quien las conecta (menu, song-select, ajustes). Se sirve desde
// apps/web/public para poder pedir sus assets por fetch como cualquier otro
// asset estatico.

import './style.css';
import { iniciarRouter } from './router.js';
import { montarHeader } from './header.js';

const contenedor = document.getElementById('app');
if (!contenedor) {
  throw new Error('No se encontro el elemento #app en el documento.');
}

montarHeader();

iniciarRouter(contenedor);
