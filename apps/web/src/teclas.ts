// T-012 "Parte B": nombre legible de un codigo de tecla (`e.code`), para
// mostrar en los casilleros de remapeo de ajustes.ts. Tabla simple de
// codigo a nombre (ver el ticket: "lo que el navegador reporte en e.key al
// momento de capturarla, guardado junto al codigo; o una tabla simple de
// codigo a nombre"): se eligio la tabla en vez de guardar el `e.key`
// capturado porque persistir un solo campo (el codigo) es mas simple que
// persistir dos campos que podrian desincronizarse entre si (por ejemplo,
// si algun dia se resetea al default sin pasar por una captura real, no
// habria un `key` que guardar), y porque una tabla fija no depende de la
// distribucion de teclado del jugador que hizo la captura, que es
// justamente lo que T-012 "Parte A" dejo de usar para el matching.
//
// Funcion pura, sin DOM: testeable sin navegador (ver keymap.test.ts para
// el resto del remapeo, que sigue el mismo criterio).

const NOMBRES_ESPECIALES: Record<string, string> = {
  Space: 'Espacio',
  Semicolon: ';',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Tab: 'Tab',
  CapsLock: 'Bloq Mayus',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Escape: 'Escape',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Shift izq.',
  ShiftRight: 'Shift der.',
  ControlLeft: 'Ctrl izq.',
  ControlRight: 'Ctrl der.',
  AltLeft: 'Alt izq.',
  AltRight: 'Alt der.',
};

const PATRON_LETRA = /^Key([A-Z])$/;
const PATRON_DIGITO = /^Digit([0-9])$/;

/**
 * Nombre legible de un codigo de tecla (`e.code`). Las letras (`KeyD` ->
 * `D`) y los digitos (`Digit3` -> `3`) se derivan por patron; el resto sale
 * de una tabla chica de casos especiales. Un codigo no reconocido (por
 * ejemplo alguno de un teclado con layout exotico) se devuelve tal cual: es
 * mejor mostrar el codigo crudo que nada.
 */
export function nombreLegibleDeCodigo(codigo: string): string {
  const letra = PATRON_LETRA.exec(codigo);
  if (letra) return letra[1]!;

  const digito = PATRON_DIGITO.exec(codigo);
  if (digito) return digito[1]!;

  return NOMBRES_ESPECIALES[codigo] ?? codigo;
}
