// Header persistente: barra fina arriba con la hora y el tiempo jugado
// acumulado (ver docs/ESTADO.md, "Header persistente"). Vive FUERA de `#app`
// a proposito: el router reemplaza el contenido de `#app` en cada pantalla y
// el header tiene que sobrevivir a esos cambios sin que cada pantalla lo
// monte por su cuenta.
//
// Durante una partida se oculta (game.ts pone la clase `tetra-en-juego` en
// <body>): la pista no tiene que competir con nada.

import { msHastaProximoMinuto } from './header-logica.js';
import { formatearHora, formatearTiempoJugado, leerTiempoJugado } from './tiempo-jugado.js';

/** Clase que game.ts pone en <body> mientras hay una partida en curso. */
export const CLASE_EN_JUEGO = 'tetra-en-juego';

/** Evento que game.ts dispara sobre `window` cuando suma tiempo jugado. */
export const EVENTO_TIEMPO_JUGADO = 'tetra:tiempo-jugado';

/**
 * T-045: evento que el header dispara sobre `window` al hacer clic en el bloque
 * "Jugado". El router lo atiende y lleva a las estadisticas globales.
 */
export const EVENTO_ABRIR_ESTADISTICAS = 'tetra:abrir-estadisticas';

/** El boton "Jugado" y si hoy se puede usar (lo decide el router segun la pantalla, ver permitirAbrirEstadisticas). */
let botonJugado: HTMLButtonElement | null = null;
let aperturaPermitida = false;

/**
 * T-045: habilita o deshabilita el bloque "Jugado" del header como acceso a las
 * estadisticas. Solo se puede desde pantallas que se cierran sin dejar nada
 * vivo detras (menu, ajustes): el song select tiene audio y un worker, y el
 * mapeador trabajo sin guardar. El router lo llama en cada cambio de pantalla.
 */
export function permitirAbrirEstadisticas(permitido: boolean): void {
  aperturaPermitida = permitido;
  if (botonJugado !== null) botonJugado.disabled = !permitido;
}

/**
 * Monta el header al principio de <body>. Se llama una sola vez al arrancar
 * (main.ts). La hora se refresca con rAF, que aca solo dibuja: no es tiempo
 * de juego y el header esta oculto cuando hay partida. Un temporizador
 * despierta una vez por minuto (sin trabajo por frame, T-024).
 */
export function montarHeader(): void {
  const header = document.createElement('header');
  header.className = 'tetra-header';

  const marca = document.createElement('span');
  marca.className = 'tetra-header-marca';
  // Detalle de cuatro barras chicas (el hilo conductor del diseno es el
  // cuatro); las alturas y el color salen de header.css.
  const barras = document.createElement('span');
  barras.className = 'tetra-header-barras';
  barras.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 4; i++) barras.appendChild(document.createElement('span'));
  const marcaTexto = document.createElement('span');
  marcaTexto.textContent = 'Tetra';
  marca.append(barras, marcaTexto);

  // T-045: el bloque es un boton que lleva a las estadisticas globales.
  const jugado = document.createElement('button');
  jugado.type = 'button';
  jugado.className = 'tetra-header-dato tetra-header-boton';
  jugado.title = 'Ver estadisticas';
  jugado.disabled = !aperturaPermitida;
  jugado.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_ESTADISTICAS));
  });
  botonJugado = jugado;
  const jugadoEtiqueta = document.createElement('span');
  jugadoEtiqueta.className = 'tetra-header-etiqueta';
  jugadoEtiqueta.textContent = 'Jugado';
  const jugadoValor = document.createElement('span');
  jugadoValor.className = 'tetra-header-valor';
  jugado.append(jugadoEtiqueta, jugadoValor);

  const hora = document.createElement('span');
  hora.className = 'tetra-header-dato';
  const horaValor = document.createElement('span');
  horaValor.className = 'tetra-header-valor';
  hora.append(horaValor);

  const datos = document.createElement('div');
  datos.className = 'tetra-header-datos';
  datos.append(jugado, hora);

  header.append(marca, datos);
  document.body.prepend(header);

  function pintarJugado(): void {
    let texto: string;
    try {
      texto = formatearTiempoJugado(leerTiempoJugado());
    } catch {
      // localStorage bloqueado (modo privado, politica del navegador): el
      // header sigue siendo util con la hora sola.
      texto = '-';
    }
    if (jugadoValor.textContent !== texto) jugadoValor.textContent = texto;
  }

  function pintarHora(): void {
    const texto = formatearHora(new Date());
    if (horaValor.textContent !== texto) horaValor.textContent = texto;
  }

  pintarJugado();
  pintarHora();
  window.addEventListener(EVENTO_TIEMPO_JUGADO, pintarJugado);

  // T-024: la hora se repinta con un solo temporizador que despierta justo
  // cuando cambia el minuto, no con un rAF por frame. Antes el ciclo de rAF
  // alocaba un Date y strings en cada frame, tambien durante la partida. Ahora
  // el costo es una vez por minuto, y en partida ni eso (el header esta
  // oculto). El temporizador solo dibuja la hora del header: no mide tiempo de
  // juego, asi que la regla del reloj de audio no aplica.
  function programarProximoMinuto(): void {
    // eslint-disable-next-line no-restricted-globals -- solo repinta la hora del header una vez por minuto, nunca mide tiempo de juego (ver CLAUDE.md, "El reloj es el audio").
    setTimeout(() => {
      if (!document.body.classList.contains(CLASE_EN_JUEGO)) pintarHora();
      programarProximoMinuto();
    }, msHastaProximoMinuto(new Date()));
  }
  programarProximoMinuto();

  // Al salir de la partida la hora puede haber quedado vieja (el temporizador
  // no pinto mientras el header estaba oculto): se repinta en cuanto vuelve
  // a mostrarse. Observa solo el atributo `class` de <body>, no el arbol.
  let estabaEnJuego = document.body.classList.contains(CLASE_EN_JUEGO);
  new MutationObserver(() => {
    const enJuego = document.body.classList.contains(CLASE_EN_JUEGO);
    if (estabaEnJuego && !enJuego) {
      pintarHora();
      pintarJugado();
    }
    estabaEnJuego = enJuego;
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
