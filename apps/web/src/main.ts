// T-006: punto de entrada de la app. Antes (T-004) esto cargaba directo el
// fixture click-120 y arrancaba el juego; ahora arma el cargador de
// desarrollo (ver cargador.ts, provisional) que deja elegir entre soltar un
// .osz importado o jugar ese mismo click track como referencia. Se sirve
// desde apps/web/public para poder pedir sus assets por fetch como
// cualquier otro asset estatico.

import './style.css';
import { mostrarCargador } from './cargador.js';

const contenedor = document.getElementById('app');
if (!contenedor) {
  throw new Error('No se encontro el elemento #app en el documento.');
}

mostrarCargador(contenedor);
