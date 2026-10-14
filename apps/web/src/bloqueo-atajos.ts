// T-064: bloqueo de los atajos del navegador durante la partida.
//
// Tres capas, de la que siempre anda a la que depende del navegador:
//
// 1. preventDefault en keydown y keyup de todo lo que el juego no usa (la
//    decision esta en bloqueo-atajos-logica.ts). Corta Alt+numpad, Ctrl+P, F5,
//    F1 y que Alt solo active la barra de menu. No puede con los atajos que el
//    navegador reserva (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab).
// 2. Keyboard Lock API (solo Chromium, y solo en pantalla completa): captura
//    esos atajos reservados.
// 3. beforeunload: ultima red, si se cierra o recarga la pestana igual.
//
// Lo que ninguna pagina puede bloquear: Alt+Tab, la tecla Windows y Alt+F4
// (los toma el sistema), y fuera de pantalla completa tampoco Ctrl+W/T/N.
//
// No toca la entrada: el listener es de captura y solo llama a preventDefault,
// nunca a stopPropagation, asi que el keydown llega igual a la entrada con el
// mismo `event.timeStamp` y en el mismo orden relativo.

import {
  codigosParaBloquear,
  debeBloquearTecla,
  debeCapturarElTeclado,
  debeConfirmarLaSalida,
  type ContextoDeBloqueo,
} from './bloqueo-atajos-logica.js';

/** La parte de la Keyboard Lock API que usamos (lib.dom de TypeScript no la trae). */
interface TecladoConBloqueo {
  lock(codigos?: string[]): Promise<void>;
  unlock(): void;
}

function tecladoConBloqueo(): TecladoConBloqueo | null {
  const teclado = (navigator as unknown as { keyboard?: Partial<TecladoConBloqueo> }).keyboard;
  if (teclado === undefined || typeof teclado.lock !== 'function' || typeof teclado.unlock !== 'function') {
    return null;
  }
  return teclado as TecladoConBloqueo;
}

function enPantallaCompleta(): boolean {
  if (document.fullscreenElement !== null) return true;
  try {
    return window.matchMedia('(display-mode: fullscreen)').matches;
  } catch {
    return false;
  }
}

/**
 * Activa el bloqueo mientras dure la partida. `contexto` se lee en cada tecla
 * (el remapeo y la fase de pausa cambian). Devuelve la funcion que lo apaga:
 * quita los listeners, suelta el teclado y deja de pedir confirmacion.
 */
export function iniciarBloqueoDeAtajos(contexto: () => ContextoDeBloqueo): () => void {
  const alTeclear = (e: KeyboardEvent): void => {
    if (debeBloquearTecla(e, contexto())) e.preventDefault();
  };

  const alCerrar = (e: BeforeUnloadEvent): void => {
    if (!debeConfirmarLaSalida(true)) return;
    // Chromium y Firefox piden confirmacion con preventDefault; Safari y los
    // navegadores viejos, con returnValue.
    e.preventDefault();
    e.returnValue = '';
  };

  const teclado = tecladoConBloqueo();
  let capturado = false;
  const actualizarCaptura = (): void => {
    if (teclado === null) return;
    const deberia = debeCapturarElTeclado({
      soportado: true,
      enPartida: true,
      pantallaCompleta: enPantallaCompleta(),
    });
    if (deberia === capturado) return;
    capturado = deberia;
    if (deberia) {
      // Si el navegador lo rechaza (sin permiso, sin pantalla completa real) no pasa nada:
      // queda la capa 1.
      teclado.lock([...codigosParaBloquear()]).catch(() => {
        capturado = false;
      });
    } else {
      teclado.unlock();
    }
  };

  window.addEventListener('keydown', alTeclear, true);
  window.addEventListener('keyup', alTeclear, true);
  window.addEventListener('beforeunload', alCerrar);
  document.addEventListener('fullscreenchange', actualizarCaptura);
  let consulta: MediaQueryList | null = null;
  try {
    consulta = window.matchMedia('(display-mode: fullscreen)');
    consulta.addEventListener('change', actualizarCaptura);
  } catch {
    consulta = null;
  }
  actualizarCaptura();

  return () => {
    window.removeEventListener('keydown', alTeclear, true);
    window.removeEventListener('keyup', alTeclear, true);
    window.removeEventListener('beforeunload', alCerrar);
    document.removeEventListener('fullscreenchange', actualizarCaptura);
    consulta?.removeEventListener('change', actualizarCaptura);
    if (capturado && teclado !== null) {
      capturado = false;
      teclado.unlock();
    }
  };
}
