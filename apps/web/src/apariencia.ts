// T-053: preferencias de apariencia de la partida: cuanto se atenua el fondo
// de la cancion y si se reproduce su video. Mismo patron que velocidad.ts:
// localStorage inyectable (default `localStorage`) para probar en node.
// T-056: tres interruptores mas, para los contadores del HUD (teclas, juicios
// y barra de error), todos encendidos por defecto.

const CLAVE_ATENUACION = 'tetra:atenuacion-fondo';
const CLAVE_VIDEO = 'tetra:video-de-fondo';
const CLAVE_TECLAS = 'tetra:mostrar-teclas';
const CLAVE_JUICIOS = 'tetra:mostrar-juicios';
const CLAVE_BARRA_ERROR = 'tetra:mostrar-barra-error';

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

/** Lee un interruptor guardado como 'true' / 'false'; sin nada guardado vale `porDefecto`. */
function leerInterruptor(clave: string, porDefecto: boolean, storage: Storage): boolean {
  const crudo = storage.getItem(clave);
  if (crudo === null) return porDefecto;
  return crudo === 'true';
}

/** T-056: cajitas con las pulsaciones por tecla bajo la pista. Encendido por defecto. */
export function leerMostrarTeclas(storage: Storage = localStorage): boolean {
  return leerInterruptor(CLAVE_TECLAS, true, storage);
}

export function guardarMostrarTeclas(valor: boolean, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_TECLAS, String(valor));
}

/** T-056: contador de notas por juicio al costado de la pista. Encendido por defecto. */
export function leerMostrarJuicios(storage: Storage = localStorage): boolean {
  return leerInterruptor(CLAVE_JUICIOS, true, storage);
}

export function guardarMostrarJuicios(valor: boolean, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_JUICIOS, String(valor));
}

/** T-056: barra de error de timing bajo la linea de juicio. Encendido por defecto. */
export function leerMostrarBarraDeError(storage: Storage = localStorage): boolean {
  return leerInterruptor(CLAVE_BARRA_ERROR, true, storage);
}

export function guardarMostrarBarraDeError(valor: boolean, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_BARRA_ERROR, String(valor));
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
