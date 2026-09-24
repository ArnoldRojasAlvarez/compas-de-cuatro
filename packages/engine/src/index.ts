// punto de entrada del paquete

export type { InputEvent, InputSource } from './input.js';
export { CODIGOS_TECLAS_POR_DEFECTO, createKeyboardInput } from './input.js';

export type { Playfield, PlayfieldOptions } from './playfield.js';
export { createPlayfield } from './playfield.js';

export type { ClaveImagenSkin, ParteDeSkin, TexturasDeSkin } from './skin.js';
export { imagenDeSkin, cargarTexturasDeSkin } from './skin.js';

export type { GeometriaPista, PosicionNota, VentanaNotas } from './position.js';
export {
  PROGRESO_MAX_VISIBLE,
  PROGRESO_MIN_VISIBLE,
  avanzarVentana,
  calcularPosicionNota,
  calcularProgreso,
  progresoAY,
  progresoEsVisible,
  receptorY,
  ventanaVacia,
} from './position.js';
