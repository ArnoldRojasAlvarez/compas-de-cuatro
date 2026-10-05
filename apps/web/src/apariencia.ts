// T-053: preferencias de apariencia de la partida: cuanto se atenua el fondo
// de la cancion y si se reproduce su video. Mismo patron que velocidad.ts:
// localStorage inyectable (default `localStorage`) para probar en node.

const CLAVE_ATENUACION = 'tetra:atenuacion-fondo';
const CLAVE_VIDEO = 'tetra:video-de-fondo';

/** Atenuacion por defecto: el fondo se ve, pero la pista manda. */
export const ATENUACION_DEFAULT = 0.8;

/** Recorta a [0, 1]. Un valor no numerico vuelve al default. */
export function clampAtenuacion(valor: number): number {
  if (!Number.isFinite(valor)) return ATENUACION_DEFAULT;
  return Math.min(1, Math.max(0, valor));
}

/** Atenuacion guardada (0 = fondo a plena luz, 1 = negro). */
export function leerAtenuacion(storage: Storage = localStorage): number {
  const crudo = storage.getItem(CLAVE_ATENUACION);
  if (crudo === null) return ATENUACION_DEFAULT;
  return clampAtenuacion(Number(crudo));
}

export function guardarAtenuacion(valor: number, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_ATENUACION, String(clampAtenuacion(valor)));
}

/** Si hay que reproducir el video de fondo de la cancion. Encendido por defecto. */
export function leerVideoDeFondo(storage: Storage = localStorage): boolean {
  const crudo = storage.getItem(CLAVE_VIDEO);
  if (crudo === null) return true;
  return crudo === 'true';
}

export function guardarVideoDeFondo(valor: boolean, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_VIDEO, String(valor));
}

/**
 * Opacidad del fondo de la pista (los carriles) a partir de la atenuacion del
 * fondo de la cancion. Con el fondo muy oscuro la pista puede ser mas
 * transparente (se lee igual); con el fondo a plena luz tiene que ser mas
 * opaca para no perderse. Lineal: 0.9 sin atenuar, 0.5 con atenuacion total.
 */
export function opacidadDePistaSegunAtenuacion(atenuacion: number): number {
  return 0.9 - 0.4 * clampAtenuacion(atenuacion);
}

/** "80%" para mostrar una fraccion 0 a 1 como porcentaje entero. */
export function formatearPorcentaje(fraccion: number): string {
  return `${Math.round(clampAtenuacion(fraccion) * 100)}%`;
}
