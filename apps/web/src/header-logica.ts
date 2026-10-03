// Logica pura del header persistente (header.ts): cuanto falta para que
// cambie el minuto que muestra el reloj. Aislada para poder testearla sin
// DOM ni timers reales.

/** Margen sobre el cambio de minuto, para no despertar un instante antes y leer el minuto viejo. */
const MARGEN_MS = 20;

/**
 * Milisegundos hasta el proximo cambio de minuto de la hora local de `fecha`,
 * mas un margen chico. Siempre entre `MARGEN_MS` y 60000 + `MARGEN_MS`.
 *
 * El header solo muestra "HH:MM", asi que alcanza con repintar una vez por
 * minuto: no hace falta un ciclo por frame que aloque un Date y strings.
 */
export function msHastaProximoMinuto(fecha: Date): number {
  const msDelMinuto = fecha.getSeconds() * 1000 + fecha.getMilliseconds();
  return 60_000 - msDelMinuto + MARGEN_MS;
}
