// punto de entrada del paquete

export type { InputEvent, InputSource } from './input.js';
export { CODIGOS_TECLAS_POR_DEFECTO, createKeyboardInput } from './input.js';

export type { OpcionesVisualesPista, Playfield, PlayfieldOptions } from './playfield.js';
export { createPlayfield } from './playfield.js';

export type { ClaveImagenSkin, ParteDeSkin, TexturasDeSkin } from './skin.js';
export { imagenDeSkin, cargarTexturasDeSkin } from './skin.js';

export type {
  ColoresDeSkin,
  IdSkinPropia,
  InfoDeSkinPropia,
  MedidasDeSkinPropia,
  SkinPropia,
} from './skins-propias.js';
export {
  COLORES_SKIN_PROPIA,
  MEDIDAS_SKIN_PROPIA,
  SKINS_PROPIAS,
  SKIN_PROPIA_POR_DEFECTO,
  dibujarMiniaturaDeSkin,
  dibujarSkinPropia,
  infoDeSkinPropia,
  texturasDeSkinPropia,
} from './skins-propias.js';

export type { GeometriaPista, PosicionNota, VentanaNotas } from './position.js';
export {
  PROGRESO_MAX_VISIBLE,
  PROGRESO_MIN_VISIBLE,
  avanzarVentanaEnSitio,
  calcularPosicionNota,
  calcularProgreso,
  maximoVisibleEnColumna,
  progresoAY,
  progresoEsVisible,
  receptorY,
  tramoVisible,
  ventanaVacia,
} from './position.js';
