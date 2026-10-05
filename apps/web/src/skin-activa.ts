// T-053: resuelve la skin activa a texturas de Pixi para una partida. La
// logica pura de que esta guardado vive en skin-activa-logica.ts (testeable en
// node); esto toca @tetra/engine (Canvas, Pixi) y @tetra/storage (IndexedDB).

import {
  SKINS_PROPIAS,
  SKIN_PROPIA_POR_DEFECTO,
  cargarTexturasDeSkin,
  texturasDeSkinPropia,
  type TexturasDeSkin,
} from '@tetra/engine';
import { listarSkins } from '@tetra/storage';
import {
  guardarSeleccion as guardarSeleccionEn,
  leerSeleccion as leerSeleccionDe,
  type CatalogoDePropias,
  type SeleccionDeSkin,
} from './skin-activa-logica.js';

/** Las skins propias que conoce el motor. */
export const CATALOGO_PROPIAS: CatalogoDePropias = {
  ids: SKINS_PROPIAS.map((skin) => skin.id),
  porDefecto: SKIN_PROPIA_POR_DEFECTO,
};

export type { SeleccionDeSkin };

/** Skin activa guardada (la propia por defecto si no hay nada). */
export function leerSeleccionDeSkin(): SeleccionDeSkin {
  return leerSeleccionDe(CATALOGO_PROPIAS);
}

export function guardarSeleccionDeSkin(seleccion: SeleccionDeSkin): void {
  guardarSeleccionEn(seleccion);
}

/**
 * Texturas de la skin activa para una pista de carriles de `anchoColumna` px.
 * Una propia se dibuja a ese ancho; una `.osk` se decodifica desde la base y,
 * si ya no esta (o falla), cae a la propia por defecto. Nunca lanza: la skin
 * nunca debe ser motivo para no poder jugar.
 *
 * Las texturas que devuelve las libera quien las pidio (`destroy(true)` en
 * cada una): el playfield no las destruye.
 */
export async function resolverSkinDePartida(anchoColumna: number): Promise<TexturasDeSkin> {
  const seleccion = leerSeleccionDeSkin();
  try {
    if (seleccion.tipo === 'osk') {
      const skins = await listarSkins();
      const guardada = skins.find((candidata) => candidata.id === seleccion.id);
      if (guardada) return await cargarTexturasDeSkin(guardada.imagenes);
      // Ya no existe en la base: cae a la propia por defecto, de abajo.
    } else {
      return texturasDeSkinPropia(seleccion.id, anchoColumna);
    }
  } catch {
    // Una `.osk` ilegible o una base que no abre: se juega con la propia por defecto.
  }
  try {
    return texturasDeSkinPropia(SKIN_PROPIA_POR_DEFECTO, anchoColumna);
  } catch {
    // Ni el Canvas respondio: createPlayfield dibuja rectangulos sin skin.
    return {};
  }
}

/** Libera las texturas de una skin que se pidio con `resolverSkinDePartida`. */
export function liberarTexturasDeSkin(texturas: TexturasDeSkin): void {
  for (const textura of Object.values(texturas)) textura?.destroy(true);
}
