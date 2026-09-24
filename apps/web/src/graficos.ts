// T-012 "Parte C": opcion de mostrar u ocultar el contador de FPS/ms del
// HUD. Mismo patron de persistencia que offset.ts y velocidad.ts:
// localStorage inyectable, default a `localStorage`, testeable sin
// navegador real (ver vitest.config.ts, entorno node).
//
// A proposito NO hay ninguna opcion de "multithreading" aca (ver el
// ticket, "Parte C"): el render del navegador corre en un solo hilo, y el
// futuro Web Worker del calculo de dificultad (T-014) no es algo que el
// usuario prenda o apague, es un detalle de implementacion interno. Un
// interruptor que no cambia nada de verdad es peor que no tenerlo.

const CLAVE_MOSTRAR_FPS = 'tetra:mostrar-fps';

/**
 * Si hay que mostrar el contador de FPS/ms en el HUD. `true` (encendido)
 * si no hay nada guardado: es el comportamiento de siempre, antes de este
 * ticket (ver el ticket, "Por defecto encendido (como hoy)").
 */
export function leerMostrarFps(storage: Storage = localStorage): boolean {
  const crudo = storage.getItem(CLAVE_MOSTRAR_FPS);
  if (crudo === null) return true;
  return crudo === 'true';
}

/** Guarda si hay que mostrar el contador de FPS/ms, para que sobreviva recargar la pagina. */
export function guardarMostrarFps(valor: boolean, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_MOSTRAR_FPS, String(valor));
}
