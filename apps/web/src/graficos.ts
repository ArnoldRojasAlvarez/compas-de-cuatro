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

const CLAVE_BAJA_LATENCIA = 'tetra:dibujo-baja-latencia';

/**
 * T-059: dibujo de baja latencia (`desynchronized: true` en el contexto WebGL de
 * la pista). El lienzo se presenta sin esperar al compositor de la pagina. En la
 * medicion de T-059 (docs/rendimiento/T-059-medicion.md) quita un tiron de la GPU
 * de 0,1 a 1,7 s que aparece en el Dificil de la demo, y en una pantalla real
 * puede, segun el navegador y la tarjeta, mostrar cortes en la imagen (tearing),
 * cosa que desde el arnes de pruebas no se puede ver. Por eso nace APAGADO y,
 * por ahora, SIN casilla en Ajustes (una septima fila en la tarjeta Apariencia
 * hace que Ajustes ya no entre en 1280x800): se prende con
 * `localStorage.setItem('tetra:dibujo-baja-latencia', 'true')`, se prueba en la
 * pantalla de quien juega y, si no hay cortes, se decide el lugar de la casilla.
 */
export function leerBajaLatencia(storage: Storage = localStorage): boolean {
  return storage.getItem(CLAVE_BAJA_LATENCIA) === 'true';
}

/** Guarda si el dibujo de baja latencia esta prendido. */
export function guardarBajaLatencia(valor: boolean, storage: Storage = localStorage): void {
  storage.setItem(CLAVE_BAJA_LATENCIA, String(valor));
}
