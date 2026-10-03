// Header persistente: barra fina arriba con la hora y el tiempo jugado
// acumulado (ver docs/ESTADO.md, "Header persistente"). Vive FUERA de `#app`
// a proposito: el router reemplaza el contenido de `#app` en cada pantalla y
// el header tiene que sobrevivir a esos cambios sin que cada pantalla lo
// monte por su cuenta.
//
// Durante una partida se oculta (game.ts pone la clase `tetra-en-juego` en
// <body>): la pista no tiene que competir con nada.

import { formatearHora, formatearTiempoJugado, leerTiempoJugado } from './tiempo-jugado.js';

/** Clase que game.ts pone en <body> mientras hay una partida en curso. */
export const CLASE_EN_JUEGO = 'tetra-en-juego';

/** Evento que game.ts dispara sobre `window` cuando suma tiempo jugado. */
export const EVENTO_TIEMPO_JUGADO = 'tetra:tiempo-jugado';

/**
 * Monta el header al principio de <body>. Se llama una sola vez al arrancar
 * (main.ts). La hora se refresca con rAF, que aca solo dibuja: no es tiempo
 * de juego y el header esta oculto cuando hay partida. Cada frame solo toca
 * el DOM si el texto cambio (una vez por minuto).
 */
export function montarHeader(): void {
  const header = document.createElement('header');
  header.className = 'tetra-header';

  const marca = document.createElement('span');
  marca.className = 'tetra-header-marca';
  marca.textContent = 'Tetra';

  const jugado = document.createElement('span');
  jugado.className = 'tetra-header-dato';
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

  function ciclo(): void {
    pintarHora();
    // eslint-disable-next-line no-restricted-globals -- solo dibuja la hora del header, nunca mide tiempo de juego (ver CLAUDE.md, "El reloj es el audio").
    requestAnimationFrame(ciclo);
  }
  // eslint-disable-next-line no-restricted-globals -- ver comentario dentro de ciclo().
  requestAnimationFrame(ciclo);
}
