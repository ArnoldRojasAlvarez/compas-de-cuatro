// T-064: que teclas se le quitan al navegador mientras corre una partida.
//
// Todo aca es puro y sin DOM (se prueba en bloqueo-atajos-logica.test.ts); el
// que escucha el teclado y llama a la Keyboard Lock API es bloqueo-atajos.ts.
//
// La regla: en partida (y en su pausa) se hace preventDefault de TODO, menos
// de lo que el juego usa a proposito. Asi no se cuelan ni los atajos del
// navegador (Ctrl+P, F5, F1, Ctrl+rueda...) ni los accidentes (Alt+7 del
// teclado numerico en Opera, Alt solo que activa la barra de menu).

import { sentidoDeTeclaDeOffset } from './offset-vivo-logica.js';

/** Lo que importa de un `KeyboardEvent` para decidir. */
export interface TeclaEntrante {
  /** `e.code`, la tecla fisica ('KeyD', 'Numpad7', 'AltLeft'). */
  code: string;
  /** `e.key`, la tecla escrita ('d', '+', 'Alt'). */
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface ContextoDeBloqueo {
  /** Codigos de los cuatro carriles ('KeyD', ...), segun el remapeo del jugador. */
  carriles: readonly string[];
  /** true en el menu de pausa y en su cuenta regresiva: ahi hay botones que se manejan con el teclado. */
  enPausa: boolean;
}

/** Teclas que el juego usa a proposito y maneja por su cuenta (game.ts): pausa, velocidad, reintento, saltar intro. */
const TECLAS_DEL_JUEGO: ReadonlySet<string> = new Set(['Escape', 'F3', 'F4', 'Backquote', 'Space']);

/** Navegar y activar los botones del menu de pausa. */
const TECLAS_DEL_MENU_DE_PAUSA: ReadonlySet<string> = new Set([
  'Tab',
  'Enter',
  'NumpadEnter',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/**
 * true si hay que hacer `preventDefault` de esta tecla (en keydown y en keyup).
 * Lo que NO se bloquea:
 *
 * - F11: es la pantalla completa, y con ella el bloqueo es total.
 * - Escape sin modificadores (la pausa; con Keyboard Lock, mantenerla sigue
 *   saliendo de pantalla completa, y eso no depende de la pagina).
 * - En la pausa, las teclas del menu (Tab, Enter, Espacio, flechas).
 * - Las teclas del juego sin Ctrl, Alt ni Meta (F3/F4, `, Espacio, - y =, el
 *   + y - del teclado numerico): el juego hace su propio preventDefault.
 *
 * Los carriles si se bloquean (preventDefault no corta la entrada: los
 * listeners siguen recibiendo el evento): en Firefox, ' y / abren la busqueda
 * rapida. Cualquier combinacion con Ctrl, Alt o Meta se bloquea siempre, sea
 * una tecla del juego o no (Ctrl+- es el zoom, Alt+D la barra de direcciones).
 * El keyup de Alt, Meta o F10 tambien: soltar Alt solo abre la barra de menu.
 */
export function debeBloquearTecla(tecla: TeclaEntrante, contexto: ContextoDeBloqueo): boolean {
  if (tecla.code === 'F11') return false;

  if (tecla.ctrlKey || tecla.altKey || tecla.metaKey) return true;

  // Shift+Escape es el administrador de tareas de Chrome.
  if (tecla.code === 'Escape') return tecla.shiftKey;

  if (contexto.enPausa && TECLAS_DEL_MENU_DE_PAUSA.has(tecla.code)) return false;

  if (contexto.carriles.includes(tecla.code)) return true;

  if (TECLAS_DEL_JUEGO.has(tecla.code)) return false;
  if (sentidoDeTeclaDeOffset(tecla.code, tecla.key) !== 0) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Keyboard Lock API
// ---------------------------------------------------------------------------

/**
 * Los codigos que se piden a `navigator.keyboard.lock()`: todo el teclado
 * menos F11. Con la lista completa se captura Ctrl+W, Ctrl+T, Ctrl+N y
 * Ctrl+Tab (necesitan KeyW, KeyT, KeyN y Tab), y F11 queda para el navegador:
 * es la salida de la pantalla completa. Escape va incluido: una pulsacion
 * corta llega a la pagina (la pausa) y mantenerla sale de pantalla completa.
 */
export function codigosParaBloquear(): readonly string[] {
  const codigos: string[] = [];
  for (let c = 'A'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    codigos.push(`Key${String.fromCharCode(c)}`);
  }
  for (let d = 0; d <= 9; d++) codigos.push(`Digit${d}`, `Numpad${d}`);
  for (let f = 1; f <= 12; f++) {
    if (f !== 11) codigos.push(`F${f}`);
  }
  codigos.push(
    'Escape',
    'Tab',
    'Enter',
    'NumpadEnter',
    'Space',
    'Backspace',
    'Backquote',
    'Minus',
    'Equal',
    'BracketLeft',
    'BracketRight',
    'Backslash',
    'Semicolon',
    'Quote',
    'Comma',
    'Period',
    'Slash',
    'NumpadAdd',
    'NumpadSubtract',
    'NumpadMultiply',
    'NumpadDivide',
    'NumpadDecimal',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'Insert',
    'Delete',
    'ContextMenu',
    'ControlLeft',
    'ControlRight',
    'AltLeft',
    'AltRight',
    'MetaLeft',
    'MetaRight',
    'ShiftLeft',
    'ShiftRight',
  );
  return codigos;
}

export interface SituacionDelBloqueoTotal {
  /** El navegador tiene la Keyboard Lock API (solo Chromium). */
  soportado: boolean;
  /** Hay una partida en curso (o en pausa). */
  enPartida: boolean;
  /** La pagina esta en pantalla completa. */
  pantallaCompleta: boolean;
}

/** true si hay que tener el teclado capturado ahora: Chromium, en partida y en pantalla completa. */
export function debeCapturarElTeclado(s: SituacionDelBloqueoTotal): boolean {
  return s.soportado && s.enPartida && s.pantallaCompleta;
}

/** true si hay que pedir confirmacion antes de cerrar o recargar la pestana: solo con partida en curso. */
export function debeConfirmarLaSalida(enPartida: boolean): boolean {
  return enPartida;
}
