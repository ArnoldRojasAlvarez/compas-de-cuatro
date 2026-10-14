/**
 * Tipos base del dominio de Tetra.
 *
 * Este archivo es el contrato del que dependen todos los demas paquetes.
 * Cambiarlo requiere un ticket de arquitectura, no un PR de implementacion.
 *
 * REGLA DEL PAQUETE `core`: cero dependencias de navegador.
 * Nada de `window`, `document`, `AudioContext`, `performance`, Pixi ni React.
 * Solo funciones y tipos puros. Esto es lo que permitiria portar la logica
 * a C# / osu!framework sin reescribirla.
 */

/** Milisegundos desde el inicio del audio. Siempre absoluto, nunca un delta. */
export type Ms = number;

/** Carril de juego. El proyecto es 4K fijo. */
export type Column = 0 | 1 | 2 | 3;

export const COLUMN_COUNT = 4;

/** Las dos manos. Columnas 0 y 1 izquierda, 2 y 3 derecha. */
export type Hand = 'left' | 'right';

export function handOf(column: Column): Hand {
  return column < 2 ? 'left' : 'right';
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Cambio de tempo. El primero define el offset del primer tiempo. */
export interface TimingPoint {
  time: Ms;
  bpm: number;
  /** Numerador del compas. 4 en un 4/4. */
  meter: number;
}

/**
 * Cambio de velocidad de scroll (lo que osu! llama SV).
 * No altera el momento en que la nota debe pulsarse, solo su posicion visual.
 */
export interface SpeedPoint {
  time: Ms;
  /** Multiplicador. 1.0 es la velocidad base del jugador. */
  multiplier: number;
}

// ---------------------------------------------------------------------------
// Notas y mapa
// ---------------------------------------------------------------------------

/** Nota simple: una sola pulsacion. */
export interface TapNote {
  kind: 'tap';
  time: Ms;
  column: Column;
}

/** Nota larga (LN): se mantiene pulsada. `endTime` siempre mayor que `time`. */
export interface HoldNote {
  kind: 'hold';
  time: Ms;
  endTime: Ms;
  column: Column;
}

export type Note = TapNote | HoldNote;

export function isHold(note: Note): note is HoldNote {
  return note.kind === 'hold';
}

export interface ChartMetadata {
  title: string;
  artist: string;
  /** Quien mapeo. Para la pieza propia del proyecto: Arnold Alvarez. */
  creator: string;
  /** Nombre de la dificultad, por ejemplo "Normal" o "Insane". */
  difficultyName: string;
  audioFile: string;
  /** Desde donde arranca el preview en el song select. */
  previewTime: Ms;
  backgroundFile?: string;
  /** Video de fondo declarado en [Events] (ruta dentro del .osz, con '/'). */
  videoFile?: string;
  /** Desfase del video respecto del audio, en ms (campo 2 de la linea de video). */
  videoOffset?: Ms;
  /** [Metadata] Source y Tags, tal cual (recortados). Ausentes si vienen vacios. */
  source?: string;
  tags?: string;
  /** [Metadata] BeatmapID, solo si es mayor que 0 (T-066). */
  beatmapId?: number;
  /** [Metadata] BeatmapSetID, solo si es mayor que 0 (T-066). */
  beatmapSetId?: number;
}

/**
 * Un sonido de la pista virtual (T-066, D7): una muestra que empieza en
 * `tiempo`. Sale de un keysound de nota o de una linea `Sample` de [Events].
 */
export interface EventoDeMuestra {
  /** ms desde el inicio de la pista virtual. Nunca negativo. */
  tiempo: Ms;
  /** Nombre normalizado (minusculas, '/', sin './'). */
  archivo: string;
  /** 1 a 100, ya resuelto (D7). */
  volumen: number;
}

/** Receta del audio de una dificultad con `AudioFilename:virtual` (T-066). */
export interface AudioVirtual {
  /** Ordenados por tiempo y despues por archivo. */
  eventos: EventoDeMuestra[];
}

export interface Chart {
  metadata: ChartMetadata;
  /**
   * Overall Difficulty. Define el ancho de las ventanas de juicio.
   * Rango util 0 a 10. Ver `judge/windows.ts`.
   */
  overallDifficulty: number;
  /** Velocidad a la que baja la barra de vida. Rango 0 a 10. */
  hpDrain: number;
  timingPoints: TimingPoint[];
  speedPoints: SpeedPoint[];
  /**
   * INVARIANTE: ordenadas por `time` ascendente.
   * El parser es responsable de garantizarlo; el resto del codigo lo asume.
   */
  notes: Note[];
  /** Solo si AudioFilename es "virtual" (T-066, D7). No entra en `hashMapa`. */
  audioVirtual?: AudioVirtual;
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

/**
 * Una fila agrupa todas las notas que caen en el mismo instante.
 * Es la unidad sobre la que trabaja el analisis de dificultad: los patrones
 * (jacks, jumpstream, chordjack) se definen entre filas consecutivas, no
 * entre notas sueltas.
 */
export interface Row {
  time: Ms;
  /** Mascara de bits: el bit N esta encendido si la columna N tiene nota. */
  mask: number;
  /** Cantidad de notas en la fila, de 1 a 4. Redundante con `mask`, por velocidad. */
  size: number;
}

// ---------------------------------------------------------------------------
// Juicio
// ---------------------------------------------------------------------------

/**
 * Nombres semanticos de los juicios. La equivalencia con osu!mania es:
 * max = 320, perfect = 300, great = 200, good = 100, bad = 50, miss = 0.
 */
export type Judgement = 'max' | 'perfect' | 'great' | 'good' | 'bad' | 'miss';

export const JUDGEMENTS: readonly Judgement[] = [
  'max',
  'perfect',
  'great',
  'good',
  'bad',
  'miss',
] as const;

/** Semiancho de cada ventana en ms. Se calcula a partir del OD del mapa. */
export interface HitWindows {
  max: Ms;
  perfect: Ms;
  great: Ms;
  good: Ms;
  bad: Ms;
  miss: Ms;
}

export interface HitResult {
  note: Note;
  judgement: Judgement;
  /** Desviacion respecto al momento correcto. Positivo tarde, negativo temprano. */
  error: Ms;
}

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  /** De 0 a 1. */
  accuracy: number;
  /** De 0 a 1. Llegar a 0 es fallar. */
  hp: number;
  counts: Record<Judgement, number>;
}

// ---------------------------------------------------------------------------
// Dificultad
// ---------------------------------------------------------------------------

/**
 * Las siete habilidades del modelo. La estrella global es el maximo del vector,
 * pero la UI muestra el perfil completo: es lo que explica por que un 5.29 de
 * patron limpio se siente mas facil que un 4.8 lleno de chordjacks.
 */
export type Skillset =
  | 'stream'
  | 'jumpstream'
  | 'handstream'
  | 'stamina'
  | 'jackspeed'
  | 'chordjack'
  | 'technical';

export const SKILLSETS: readonly Skillset[] = [
  'stream',
  'jumpstream',
  'handstream',
  'stamina',
  'jackspeed',
  'chordjack',
  'technical',
] as const;

export type SkillVector = Record<Skillset, number>;

export interface DifficultyResult {
  vector: SkillVector;
  /** Maximo del vector. Es el numero que se muestra como estrellas. */
  overall: number;
}
