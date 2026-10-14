// T-037: modo presentacion. Para ejecutar el proyecto en vivo ante publico
// sobra todo lo que no es el juego: el header con la hora, el cursor, los
// textos de ayuda. Este modulo activa y desactiva eso, y lo mantiene entre
// recargas. Nada de esto toca el reloj de juego.

import './presentacion.css';

/** Clase en <body> mientras el modo esta activo. */
export const CLASE_PRESENTACION = 'tetra-presentacion';

/** Clase en <body> cuando el cursor se oculta por inactividad. */
export const CLASE_SIN_CURSOR = 'tetra-sin-cursor';

/** Ms sin mover el mouse antes de ocultar el cursor. */
export const MS_HASTA_OCULTAR_CURSOR = 2000;

const CLAVE_PRESENTACION = 'tetra:presentacion';
const CLAVE_CHECKLIST = 'tetra:checklist-presentacion';

export interface EstadoPresentacion {
  activo: boolean;
}

export function leerPresentacion(storage: Storage = localStorage): EstadoPresentacion {
  try {
    return { activo: storage.getItem(CLAVE_PRESENTACION) === '1' };
  } catch {
    return { activo: false };
  }
}

export function guardarPresentacion(estado: EstadoPresentacion, storage: Storage = localStorage): void {
  try {
    storage.setItem(CLAVE_PRESENTACION, estado.activo ? '1' : '0');
  } catch {
    // sin almacenamiento el modo funciona igual, solo no sobrevive a recargar.
  }
}

/** Pasos de la lista "Antes de presentar". Solo recuerdan: no bloquean nada. */
export const PASOS_PREVIOS = [
  { id: 'offset', texto: 'Calibrar el offset de audio' },
  { id: 'cancion', texto: 'Probar la canción completa' },
  { id: 'volumen', texto: 'Comprobar el volumen' },
] as const;

export type PasoPrevio = (typeof PASOS_PREVIOS)[number]['id'];
export type ChecklistPresentacion = Readonly<Record<PasoPrevio, boolean>>;

const CHECKLIST_VACIA: ChecklistPresentacion = { offset: false, cancion: false, volumen: false };

/** Lee la lista. Un valor corrupto, o un paso que falta, cuenta como sin marcar. */
export function leerChecklist(storage: Storage = localStorage): ChecklistPresentacion {
  try {
    const crudo = storage.getItem(CLAVE_CHECKLIST);
    if (crudo === null) return CHECKLIST_VACIA;
    const v = JSON.parse(crudo) as Record<string, unknown> | null;
    if (typeof v !== 'object' || v === null) return CHECKLIST_VACIA;
    return {
      offset: v.offset === true,
      cancion: v.cancion === true,
      volumen: v.volumen === true,
    };
  } catch {
    return CHECKLIST_VACIA;
  }
}

export function guardarChecklist(lista: ChecklistPresentacion, storage: Storage = localStorage): void {
  try {
    storage.setItem(CLAVE_CHECKLIST, JSON.stringify(lista));
  } catch {
    // ver guardarPresentacion.
  }
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

let temporizadorCursor: ReturnType<typeof setTimeout> | null = null;
/** true si fuimos nosotros quienes pedimos la pantalla completa (para saber si salir de ella apaga el modo). */
let pedimosPantallaCompleta = false;

function programarOcultarCursor(): void {
  document.body.classList.remove(CLASE_SIN_CURSOR);
  if (temporizadorCursor !== null) clearTimeout(temporizadorCursor);
  temporizadorCursor = null;
  if (!document.body.classList.contains(CLASE_PRESENTACION)) return;
  // Temporizador solo de interfaz (ocultar el cursor): no mide tiempo de juego.
  // eslint-disable-next-line no-restricted-globals -- ver arriba, nunca toca el reloj de audio (CLAUDE.md, "El reloj es el audio").
  temporizadorCursor = setTimeout(() => {
    document.body.classList.add(CLASE_SIN_CURSOR);
  }, MS_HASTA_OCULTAR_CURSOR);
}

/** Pone o quita la clase del modo y guarda la eleccion. No toca la pantalla completa. */
export function aplicarPresentacion(activo: boolean): void {
  document.body.classList.toggle(CLASE_PRESENTACION, activo);
  guardarPresentacion({ activo });
  programarOcultarCursor();
}

export function presentacionActiva(): boolean {
  return document.body.classList.contains(CLASE_PRESENTACION);
}

/**
 * Entra o sale del modo. Al entrar pide pantalla completa (hace falta un
 * gesto del usuario: si el navegador la rechaza, el modo se activa igual).
 */
export async function alternarPresentacion(): Promise<void> {
  if (presentacionActiva()) {
    aplicarPresentacion(false);
    if (document.fullscreenElement) {
      pedimosPantallaCompleta = false;
      await document.exitFullscreen().catch(() => undefined);
    }
    return;
  }
  aplicarPresentacion(true);
  try {
    await document.documentElement.requestFullscreen();
    pedimosPantallaCompleta = true;
  } catch {
    pedimosPantallaCompleta = false;
  }
}

/** Atajo F: solo fuera de partida y de pantallas donde F es otra cosa (carril del mapeador, remapeo de teclas, calibrar offset). */
function atajoValido(e: KeyboardEvent): boolean {
  if (e.code !== 'KeyF' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
  const objetivo = e.target as HTMLElement | null;
  if (objetivo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(objetivo.tagName)) return false;
  if (document.body.classList.contains('tetra-en-juego')) return false;
  if (document.querySelector('.tetra-mapeador, .tetra-ajustes, .tetra-calibrar-offset')) return false;
  return true;
}

/** Se llama una sola vez al arrancar (main.ts): restaura el estado y engancha atajo, cursor y salida de pantalla completa. */
export function instalarPresentacion(): void {
  if (leerPresentacion().activo) aplicarPresentacion(true);

  window.addEventListener('keydown', (e) => {
    if (!atajoValido(e)) return;
    e.preventDefault();
    void alternarPresentacion();
  });
  window.addEventListener('mousemove', () => {
    if (presentacionActiva()) programarOcultarCursor();
  });
  document.addEventListener('fullscreenchange', () => {
    // Salir de pantalla completa con Esc del navegador apaga el modo.
    if (!document.fullscreenElement && pedimosPantallaCompleta && presentacionActiva()) {
      pedimosPantallaCompleta = false;
      aplicarPresentacion(false);
    }
  });
}
