// T-006: punto de entrada de la app. Antes (T-004) esto cargaba directo el
// fixture click-120 y arrancaba el juego. T-010 lo cambia de nuevo: ahora
// arranca en el menu principal (ver menu.ts), que es la primera pantalla
// con identidad visual propia y que a su vez embebe el cargador de
// desarrollo (cargador.ts, todavia provisional, ver ese archivo) como el
// camino a jugar. Se sirve desde apps/web/public para poder pedir sus
// assets por fetch como cualquier otro asset estatico.

import './style.css';
import { mostrarMenu } from './menu.js';

const contenedor = document.getElementById('app');
if (!contenedor) {
  throw new Error('No se encontro el elemento #app en el documento.');
}

mostrarMenu(contenedor);
