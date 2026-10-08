// T-052/T-053: volumen de la musica, compartido por la partida, el preview del
// song select y la musica del menu. Mismo patron que velocidad.ts: localStorage
// inyectable para testear en node.
//
// Se guarda la posicion del control (0 a 1), no la ganancia: el oido es
// logaritmico, asi que la ganancia sale de una curva (cuadratica, suficiente y
// sin sorpresas) y la mitad del control suena como "la mitad".

const CLAVE_VOLUMEN = 'tetra:volumen-musica';

/** Posicion del control por defecto: un poco por debajo del maximo. */
export const VOLUMEN_DEFAULT = 0.8;

/** Recorta a [0, 1]. Un valor no numerico vuelve al default. */
export function clampVolumen(valor: number): number {
  if (!Number.isFinite(valor)) return VOLUMEN_DEFAULT;
  return Math.min(1, Math.max(0, valor));
}

/** Posicion guardada del control de volumen (0 a 1). */
export function leerVolumen(storage: Storage = localStorage): number {
  const crudo = storage.getItem(CLAVE_VOLUMEN);
  if (crudo === null) return VOLUMEN_DEFAULT;
  return clampVolumen(Number(crudo));
}

export function guardarVolumen(valor: number, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_VOLUMEN, String(clampVolumen(valor)));
}

/** Ganancia lineal para un GainNode a partir de la posicion del control. */
export function gananciaDeVolumen(valor: number): number {
  const v = clampVolumen(valor);
  return v * v;
}

// T-027: volumen de los efectos (hitsounds). Mismo control y misma curva que el
// de la musica (gananciaDeVolumen), con clave propia y su propio default: los
// golpes son clics secos y cortos, que se oyen mas que la musica a igual
// ganancia, asi que arrancan mas abajo.

const CLAVE_VOLUMEN_EFECTOS = 'tetra:volumen-efectos';

/** Posicion del control de efectos por defecto. */
export const VOLUMEN_EFECTOS_DEFAULT = 0.6;

/** Recorta a [0, 1]. Un valor no numerico vuelve al default de efectos. */
export function clampVolumenEfectos(valor: number): number {
  if (!Number.isFinite(valor)) return VOLUMEN_EFECTOS_DEFAULT;
  return Math.min(1, Math.max(0, valor));
}

/** Posicion guardada del control de efectos (0 a 1). */
export function leerVolumenEfectos(storage: Storage = localStorage): number {
  const crudo = storage.getItem(CLAVE_VOLUMEN_EFECTOS);
  // Number('') es 0: un valor vacio es basura, no un silencio pedido.
  if (crudo === null || crudo.trim() === '') return VOLUMEN_EFECTOS_DEFAULT;
  return clampVolumenEfectos(Number(crudo));
}

export function guardarVolumenEfectos(valor: number, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_VOLUMEN_EFECTOS, String(clampVolumenEfectos(valor)));
}
