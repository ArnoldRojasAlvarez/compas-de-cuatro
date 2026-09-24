// T-012 "Parte B": remapeo de teclas.
//
// Persistencia con el mismo patron que apps/web/src/offset.ts y
// apps/web/src/velocidad.ts: localStorage inyectable, default a
// `localStorage`, para poder testear sin navegador real (ver
// vitest.config.ts, entorno node).
//
// Se guardan CODIGOS (`e.code`, por ejemplo 'KeyD'), no teclas (`e.key`):
// mismo contrato que `InputSource.setKeyMap` desde el cambio de T-012
// "Parte A" (ver packages/engine/src/input.ts).

import { CODIGOS_TECLAS_POR_DEFECTO } from '@tetra/engine';

const CLAVE_KEYMAP = 'tetra:keymap-usuario';

/** El mapeo de teclas del jugador: un codigo fisico por columna (D, F, J, K). */
export type KeyMap = readonly [string, string, string, string];

/**
 * `Escape` esta prohibido en cualquier columna: es la tecla de salir de la
 * partida (ver apps/web/src/game.ts, `manejarEscape`). Asignarla a una
 * columna dejaria sin forma de abortar una partida con esa columna
 * sostenida, y ademas cada pulsacion de esa columna abortaria la partida.
 */
const CODIGO_PROHIBIDO = 'Escape';

/**
 * Valida un `KeyMap` completo: cuatro codigos, ninguno repetido, ninguno
 * `Escape`. Funcion pura, sin acceso a storage ni DOM: es lo que hace
 * testeable la validacion sin tener que simular clics ni eventos de
 * teclado (ver el ticket, "la validacion, como funcion pura testeable").
 */
export function keyMapEsValido(valor: readonly string[]): valor is KeyMap {
  if (valor.length !== 4) return false;
  if (valor.some((codigo) => typeof codigo !== 'string' || codigo.length === 0)) return false;
  if (valor.includes(CODIGO_PROHIBIDO)) return false;
  return new Set(valor).size === 4; // sin duplicados
}

/** Por que no se pudo asignar un codigo a una columna (ver `intentarAsignarCodigo`). */
export type MotivoRechazoAsignacion = 'escape-prohibido' | 'codigo-duplicado';

export type ResultadoAsignacion =
  | { readonly permitido: true; readonly mapaNuevo: KeyMap }
  | { readonly permitido: false; readonly motivo: MotivoRechazoAsignacion };

/**
 * Intenta asignar `codigo` a `columna` dentro de `mapaActual`. Funcion pura
 * testeable (ver el ticket, "Parte B"): no toca storage ni DOM, solo decide
 * si la asignacion es valida y, si lo es, devuelve el mapa resultante.
 *
 * Decision (documentada, ver el ticket: "a tu criterio, pero documentalo"):
 * un codigo duplicado se RECHAZA, no se intercambia con la otra columna.
 * Intercambiar es una sorpresa mayor para el jugador (cambia DOS columnas
 * de una asignacion pensada para una sola) que simplemente avisar y dejar
 * la asignacion vieja: el jugador puede resolver el conflicto el mismo,
 * remapeando la otra columna primero si de verdad quiere intercambiar.
 *
 * Asignar el mismo codigo que ya tenia esa columna es un caso valido (no
 * cuenta como "duplicado con otra columna"): es un no-op que reafirma el
 * mismo valor.
 */
export function intentarAsignarCodigo(
  mapaActual: KeyMap,
  columna: number,
  codigo: string,
): ResultadoAsignacion {
  if (codigo === CODIGO_PROHIBIDO) {
    return { permitido: false, motivo: 'escape-prohibido' };
  }
  const indiceExistente = mapaActual.indexOf(codigo);
  if (indiceExistente !== -1 && indiceExistente !== columna) {
    return { permitido: false, motivo: 'codigo-duplicado' };
  }
  const mapaNuevo = mapaActual.slice() as [string, string, string, string];
  mapaNuevo[columna] = codigo;
  return { permitido: true, mapaNuevo };
}

/**
 * Lee el keymap guardado por el usuario. `CODIGOS_TECLAS_POR_DEFECTO` (ver
 * @tetra/engine, packages/engine/src/input.ts) si no hay nada guardado o si
 * el valor guardado no pasa `keyMapEsValido` (JSON corrupto, de una version
 * incompatible, o editado a mano con un duplicado o un Escape colado):
 * mismo criterio que `leerOffset`/`leerVelocidad`, un valor corrupto no
 * rompe la partida, solo vuelve al mapeo de arranque.
 */
export function leerKeyMap(storage: Storage = localStorage): KeyMap {
  const crudo = storage.getItem(CLAVE_KEYMAP);
  if (crudo === null) return CODIGOS_TECLAS_POR_DEFECTO;
  try {
    const parseado: unknown = JSON.parse(crudo);
    if (Array.isArray(parseado) && keyMapEsValido(parseado)) {
      return parseado;
    }
  } catch {
    // JSON invalido: cae al default, igual que cualquier otro valor corrupto.
  }
  return CODIGOS_TECLAS_POR_DEFECTO;
}

/** Guarda el keymap del usuario, para que sobreviva recargar la pagina. */
export function guardarKeyMap(mapa: KeyMap, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_KEYMAP, JSON.stringify(mapa));
}
