export * from './types.js';

export { judge, windowsForOD } from './judge/windows.js';

export type { JudgeEngine } from './judge/engine.js';
export { createJudgeEngine, HP_DELTAS } from './judge/engine.js';

export type { ParseResult } from './chart/osu.js';
export { parseOsu } from './chart/osu.js';
export type { CabeceraOsu } from './chart/cabecera.js';
export { leerCabeceraOsu } from './chart/cabecera.js';
export { clavesDeIdentidad } from './chart/identidad.js';

export {
  construirFilas,
  calcularDificultad,
  PARAMETROS_DIFICULTAD,
  VERSION_MODELO_DIFICULTAD,
  MODELO_CALIBRADO,
} from './difficulty/index.js';
export { hashMapa } from './difficulty/hash.js';

export type { AjusteLogLog } from './estadistica/index.js';
export { rangos, spearman, ajustarLeyDePotencia } from './estadistica/index.js';

// T-045: historial de partidas (agregaciones puras).
export type { RegistroPartida, ResumenHistorial } from './estadistica/historial.js';
export {
  TOPE_HISTORIAL,
  diaUtc,
  filtrarPorVentana,
  golpesJuzgados,
  resumirHistorial,
  serieDiaria,
} from './estadistica/historial.js';

export { escribirOsu } from './chart/osu-escritor.js';

export type { Onset, AnalisisOnsets, OpcionesOnsets } from './mapeador/onsets.js';
export { analizarOnsets } from './mapeador/onsets.js';
export type { EstimacionTempo, OpcionesTempo } from './mapeador/tempo.js';
export { estimarTempo } from './mapeador/tempo.js';
export type { Grilla } from './mapeador/grilla.js';
export {
  DIVISORES,
  duracionPulso,
  duracionSlot,
  tiempoDeSlot,
  slotMasCercano,
  ajustarAGrilla,
  lineasDeGrilla,
} from './mapeador/grilla.js';
export type { NivelAuto, PresetAuto, OpcionesAutomapa } from './mapeador/automapa.js';
export { PRESETS_AUTO, generarNotas } from './mapeador/automapa.js';

export type { Rango, PartidaJugada, RecordDeMapa } from './records.js';
export { rangoDePrecision, mejorRango, combinarRecord } from './records.js';

export type { EventoReplay, GrabadorDeReplay, Replay, ReproductorDeReplay } from './replay.js';
export {
  MS_SOSTENER_NOTA_SIMPLE,
  hashDeReplay,
  replayEsDeEsteMapa,
  replayPerfecto,
  serializarReplay,
  leerReplay,
  crearReproductorDeReplay,
  crearGrabadorDeReplay,
  entregarEvento,
  MARGEN_DE_EXPIRACION_MS,
  expirarConMargen,
  expirarSinMargen,
} from './replay.js';
