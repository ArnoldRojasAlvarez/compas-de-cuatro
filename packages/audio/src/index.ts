// punto de entrada del paquete

export type { AudioClock, ClockOptions } from './clock.js';
export { createAudioClock } from './clock.js';

export type { FuenteDeTiempo, MapaDeTiempo, MuestraDeAncla, OpcionesDeMapa } from './mapa-de-tiempo.js';
export { crearMapaDeTiempo, crearMapaDeTiempoDesde } from './mapa-de-tiempo.js';

export type { TipoHitsound } from './hitsound.js';
export { TIPOS_HITSOUND, crearHitsound, reproducirHitsound } from './hitsound.js';

// T-066 (paso 3): audio virtual.
export type { EntradaRenderVirtual, ResultadoRenderVirtual } from './audio-virtual.js';
export { renderizarAudioVirtual } from './audio-virtual.js';
