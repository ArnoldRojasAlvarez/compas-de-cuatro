// Tests de T-064 para apps/web/src/bloqueo-atajos-logica.ts.

import { describe, expect, it } from 'vitest';
import {
  codigosParaBloquear,
  debeBloquearTecla,
  debeCapturarElTeclado,
  debeConfirmarLaSalida,
  type ContextoDeBloqueo,
  type TeclaEntrante,
} from './bloqueo-atajos-logica.js';

const CARRILES = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'] as const;
const JUGANDO: ContextoDeBloqueo = { carriles: CARRILES, enPausa: false };
const PAUSA: ContextoDeBloqueo = { carriles: CARRILES, enPausa: true };

function tecla(code: string, extra: Partial<TeclaEntrante> = {}): TeclaEntrante {
  return {
    code,
    key: code,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...extra,
  };
}

describe('debeBloquearTecla: lo que el juego usa', () => {
  it('los carriles se bloquean (no cortan la entrada, y evitan la búsqueda rápida de Firefox)', () => {
    for (const c of CARRILES) expect(debeBloquearTecla(tecla(c), JUGANDO)).toBe(true);
  });

  it('Escape, F3, F4, `, Espacio, - y = pasan (el juego los maneja)', () => {
    for (const c of ['Escape', 'F3', 'F4', 'Backquote', 'Space', 'Minus', 'Equal']) {
      expect(debeBloquearTecla(tecla(c), JUGANDO)).toBe(false);
    }
  });

  it('el + y el - del teclado numérico pasan, y el + de otra distribución también', () => {
    expect(debeBloquearTecla(tecla('NumpadAdd', { key: '+' }), JUGANDO)).toBe(false);
    expect(debeBloquearTecla(tecla('NumpadSubtract', { key: '-' }), JUGANDO)).toBe(false);
    expect(debeBloquearTecla(tecla('BracketRight', { key: '+' }), JUGANDO)).toBe(false);
    expect(debeBloquearTecla(tecla('Slash', { key: '-' }), JUGANDO)).toBe(false);
  });

  it('F11 siempre pasa: es la pantalla completa', () => {
    expect(debeBloquearTecla(tecla('F11'), JUGANDO)).toBe(false);
    expect(debeBloquearTecla(tecla('F11'), PAUSA)).toBe(false);
  });

  it('un carril remapeado manda sobre la lista fija', () => {
    const ctx: ContextoDeBloqueo = { carriles: ['KeyA', 'KeyS', 'Semicolon', 'Quote'], enPausa: false };
    expect(debeBloquearTecla(tecla('KeyA'), ctx)).toBe(true);
    expect(debeBloquearTecla(tecla('Semicolon'), ctx)).toBe(true);
  });
});

describe('debeBloquearTecla: lo que se bloquea', () => {
  it('Alt + numpad (el caso de Opera) y cualquier otro numpad', () => {
    expect(debeBloquearTecla(tecla('Numpad7', { key: '7', altKey: true }), JUGANDO)).toBe(true);
    expect(debeBloquearTecla(tecla('Numpad7', { key: '7' }), JUGANDO)).toBe(true);
    expect(debeBloquearTecla(tecla('NumpadEnter', { key: 'Enter' }), JUGANDO)).toBe(true);
  });

  it('Alt, Ctrl y Meta con cualquier tecla, también las del juego', () => {
    for (const mod of ['ctrlKey', 'altKey', 'metaKey'] as const) {
      for (const c of ['KeyD', 'Minus', 'Equal', 'F4', 'Escape', 'Space']) {
        expect(debeBloquearTecla(tecla(c, { [mod]: true }), JUGANDO)).toBe(true);
      }
    }
  });

  it('los atajos clásicos: Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab, Ctrl+P, Ctrl+R, Ctrl+Shift+I', () => {
    for (const c of ['KeyW', 'KeyT', 'KeyN', 'Tab', 'KeyP', 'KeyR']) {
      expect(debeBloquearTecla(tecla(c, { ctrlKey: true }), JUGANDO)).toBe(true);
    }
    expect(debeBloquearTecla(tecla('KeyI', { ctrlKey: true, shiftKey: true }), JUGANDO)).toBe(true);
  });

  it('Alt solo: el keydown y, sobre todo, el keyup (que abre la barra de menú)', () => {
    expect(debeBloquearTecla(tecla('AltLeft', { key: 'Alt', altKey: true }), JUGANDO)).toBe(true);
    // En el keyup de Alt, altKey ya es false.
    expect(debeBloquearTecla(tecla('AltLeft', { key: 'Alt' }), JUGANDO)).toBe(true);
    expect(debeBloquearTecla(tecla('AltRight', { key: 'Alt' }), JUGANDO)).toBe(true);
    expect(debeBloquearTecla(tecla('MetaLeft', { key: 'Meta' }), JUGANDO)).toBe(true);
  });

  it('teclas de función y de navegación que el juego no usa', () => {
    for (const c of ['F1', 'F2', 'F5', 'F6', 'F7', 'F10', 'F12', 'Tab', 'Enter', 'ContextMenu', 'Backspace']) {
      expect(debeBloquearTecla(tecla(c), JUGANDO)).toBe(true);
    }
  });

  it('Shift+Escape (administrador de tareas de Chrome) se bloquea; Escape solo no', () => {
    expect(debeBloquearTecla(tecla('Escape', { shiftKey: true }), JUGANDO)).toBe(true);
    expect(debeBloquearTecla(tecla('Escape'), JUGANDO)).toBe(false);
  });

  it('Shift con un carril sigue siendo carril (se bloquea)', () => {
    expect(debeBloquearTecla(tecla('KeyD', { shiftKey: true }), JUGANDO)).toBe(true);
  });
});

describe('debeBloquearTecla: la pausa', () => {
  it('deja Tab, Enter, Espacio y flechas para manejar los botones del menú', () => {
    for (const c of ['Tab', 'Enter', 'NumpadEnter', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(debeBloquearTecla(tecla(c), PAUSA)).toBe(false);
    }
    expect(debeBloquearTecla(tecla('Tab', { shiftKey: true }), PAUSA)).toBe(false);
  });

  it('jugando, Tab, Enter y las flechas sí se bloquean', () => {
    for (const c of ['Tab', 'Enter', 'ArrowUp', 'ArrowLeft']) {
      expect(debeBloquearTecla(tecla(c), JUGANDO)).toBe(true);
    }
  });

  it('en la pausa también se bloquean los atajos con Ctrl, Alt y Meta, y lo demás', () => {
    expect(debeBloquearTecla(tecla('Tab', { ctrlKey: true }), PAUSA)).toBe(true);
    expect(debeBloquearTecla(tecla('Enter', { altKey: true }), PAUSA)).toBe(true);
    expect(debeBloquearTecla(tecla('F5'), PAUSA)).toBe(true);
    expect(debeBloquearTecla(tecla('AltLeft', { key: 'Alt' }), PAUSA)).toBe(true);
    expect(debeBloquearTecla(tecla('Numpad7'), PAUSA)).toBe(true);
  });
});

describe('Keyboard Lock', () => {
  it('captura solo con soporte, en partida y en pantalla completa', () => {
    const base = { soportado: true, enPartida: true, pantallaCompleta: true };
    expect(debeCapturarElTeclado(base)).toBe(true);
    expect(debeCapturarElTeclado({ ...base, soportado: false })).toBe(false);
    expect(debeCapturarElTeclado({ ...base, enPartida: false })).toBe(false);
    expect(debeCapturarElTeclado({ ...base, pantallaCompleta: false })).toBe(false);
  });

  it('pide casi todo el teclado, pero no F11', () => {
    const codigos = codigosParaBloquear();
    for (const c of ['KeyW', 'KeyT', 'KeyN', 'Tab', 'Escape', 'F4', 'F5', 'Numpad7', 'AltLeft', 'MetaLeft']) {
      expect(codigos).toContain(c);
    }
    expect(codigos).not.toContain('F11');
    expect(new Set(codigos).size).toBe(codigos.length);
  });
});

describe('beforeunload', () => {
  it('confirma solo con partida en curso', () => {
    expect(debeConfirmarLaSalida(true)).toBe(true);
    expect(debeConfirmarLaSalida(false)).toBe(false);
  });
});
