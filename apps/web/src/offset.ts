// T-007: persistencia del offset del usuario. Vive en apps/web, no en
// core ni en audio: localStorage es una API del navegador y
// packages/core no puede tocarla (ver CLAUDE.md, regla 2); packages/audio
// expone `userOffset` en el reloj, pero no sabe nada de donde vino ese
// numero (ver el JSDoc de `ClockOptions.userOffset` en
// packages/audio/src/clock.ts).
//
// `storage` se recibe como parametro con default a `localStorage`, igual
// que `DecodificadorDeAudio` en cargador-logica.ts: permite testear estas
// funciones con un doble en vitest (entorno node, sin `localStorage` real,
// ver vitest.config.ts) sin cambiar como se las llama desde el navegador.

import type { Ms } from '@tetra/core';

const CLAVE_OFFSET = 'tetra:offset-usuario';

/**
 * Lee el offset guardado por el usuario, en ms. 0 si no hay nada guardado
 * o si el valor guardado no es un numero valido (por ejemplo, localStorage
 * editado a mano o de una version anterior incompatible): 0 es el mismo
 * comportamiento que tenia el reloj antes de T-007, asi que un valor
 * corrupto no rompe la partida, solo deja de aplicar la calibracion.
 */
export function leerOffset(storage: Storage = localStorage): Ms {
  const crudo = storage.getItem(CLAVE_OFFSET);
  if (crudo === null) return 0;
  const valor = Number(crudo);
  return Number.isFinite(valor) ? valor : 0;
}

/** Guarda el offset del usuario, en ms, para que sobreviva recargar la pagina. */
export function guardarOffset(valor: Ms, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_OFFSET, String(valor));
}
