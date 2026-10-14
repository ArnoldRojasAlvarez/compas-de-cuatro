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
import { instalarPresentacion } from './presentacion.js';
import { asegurarCancionDemo } from './demo/index.js';
import { limpiarMuestrasHuerfanas, purgarReplaysRecientes } from '@tetra/storage';
import { fusionarDuplicadosYMigrar } from './fusionar-duplicados.js';

const contenedor = document.getElementById('app');
if (!contenedor) {
  throw new Error('No se encontró el elemento #app en el documento.');
}

montarHeader();
instalarPresentacion();

iniciarRouter(contenedor);
// T-051: siembra la cancion demo la primera vez (no bloquea el arranque).
void asegurarCancionDemo();
// T-065: al abrir la app se borran los replays recientes de mas de 7 dias (y los que pasen de 200).
// Las fijadas y el replay de la mejor partida no se tocan. Un fallo no estorba el arranque.
void purgarReplaysRecientes().catch(() => undefined);
// T-066: las canciones duplicadas (el mismo .osz importado mas de una vez) se
// fusionan en una, con sus records, replays, recientes y offset por cancion.
void fusionarDuplicadosYMigrar();
// T-066 (paso 3): red de seguridad de las canciones con audio virtual. Borrar una
// cancion ya borra sus muestras; esto limpia las que hayan quedado sin dueno. Un
// fallo no estorba el arranque.
void limpiarMuestrasHuerfanas().catch(() => undefined);
