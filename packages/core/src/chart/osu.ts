// T-005: parser de mapas .osu de osu!mania 4K.
//
// Funcion pura: entra el texto ya leido de un .osu, sale un Chart (ver
// types.ts) o un error. No toca el navegador, no lee archivos, no
// descomprime nada de eso es responsabilidad de la capa de importacion que
// vive fuera de core (ver docs/tickets/T-005-importador-osu.md, "La capa de
// navegador va aparte").
//
// El formato .osu es texto con secciones "[Nombre]" y, adentro, lineas
// "Clave: valor" (General, Metadata, Difficulty) o listas separadas por
// comas (TimingPoints, HitObjects). Solo se leen las cinco secciones que
// hacen falta para mania 4K, mas [Events] (solo para sacar el fondo y el
// video, T-049); el resto ([Colours], [Editor], etc.) se ignora sin fallar.

import type { Chart, Column, Note, SpeedPoint, TimingPoint } from '../types.js';
import { COLUMN_COUNT } from '../types.js';

export type ParseResult = { ok: true; chart: Chart } | { ok: false; error: string };

/** Nombres de seccion que el parser entiende. Cualquier otro corchete se ignora. */
type NombreSeccion =
  | 'General'
  | 'Metadata'
  | 'Difficulty'
  | 'Events'
  | 'TimingPoints'
  | 'HitObjects';

const NOMBRES_SECCION: ReadonlySet<string> = new Set<NombreSeccion>([
  'General',
  'Metadata',
  'Difficulty',
  'Events',
  'TimingPoints',
  'HitObjects',
]);

/** Resultado de separar el texto crudo en sus secciones, antes de validar nada. */
interface SeccionesCrudas {
  /** Que encabezados [Xxx] aparecieron en el archivo, sirve para detectar secciones faltantes. */
  vistas: ReadonlySet<string>;
  general: ReadonlyMap<string, string>;
  metadata: ReadonlyMap<string, string>;
  difficulty: ReadonlyMap<string, string>;
  /** Lineas crudas de [Events], sin parsear todavia. */
  eventLines: readonly string[];
  /** Lineas crudas de [TimingPoints], una por punto, sin parsear todavia. */
  timingLines: readonly string[];
  /** Lineas crudas de [HitObjects], una por nota, sin parsear todavia. */
  hitObjectLines: readonly string[];
}

function err(mensaje: string): ParseResult {
  return { ok: false, error: mensaje };
}

/**
 * Agrega una linea "Clave: valor" al mapa de la seccion actual.
 * Se separa por el primer ':' nada mas: el valor (por ejemplo el Artist de
 * una cancion) puede tener sus propios dos puntos.
 */
function agregarClaveValor(mapa: Map<string, string>, linea: string): void {
  const idx = linea.indexOf(':');
  if (idx === -1) return; // linea sin ':' dentro de una seccion clave/valor, no tiene sentido: se ignora
  const clave = linea.slice(0, idx).trim();
  const valor = linea.slice(idx + 1).trim();
  mapa.set(clave, valor);
}

/** Separa el texto del .osu en secciones, sin validar todavia contenido obligatorio. */
function dividirSecciones(text: string): SeccionesCrudas {
  const vistas = new Set<string>();
  const general = new Map<string, string>();
  const metadata = new Map<string, string>();
  const difficulty = new Map<string, string>();
  const eventLines: string[] = [];
  const timingLines: string[] = [];
  const hitObjectLines: string[] = [];

  let actual: NombreSeccion | null = null;

  for (const lineaCruda of text.split(/\r\n|\r|\n/)) {
    const linea = lineaCruda.trim();
    if (linea === '' || linea.startsWith('//')) continue; // linea vacia o comentario

    const matchSeccion = /^\[([A-Za-z]+)\]$/.exec(linea);
    if (matchSeccion) {
      const nombre = matchSeccion[1]!;
      vistas.add(nombre);
      actual = NOMBRES_SECCION.has(nombre) ? (nombre as NombreSeccion) : null;
      continue;
    }

    switch (actual) {
      case 'General':
        agregarClaveValor(general, linea);
        break;
      case 'Metadata':
        agregarClaveValor(metadata, linea);
        break;
      case 'Difficulty':
        agregarClaveValor(difficulty, linea);
        break;
      case 'Events':
        eventLines.push(linea);
        break;
      case 'TimingPoints':
        timingLines.push(linea);
        break;
      case 'HitObjects':
        hitObjectLines.push(linea);
        break;
      case null:
        // Antes de cualquier encabezado (la primera linea suele ser
        // "osu file format vXX") o dentro de una seccion que no se usa
        // ([Colours], [Editor]...): se ignora sin fallar.
        break;
    }
  }

  return { vistas, general, metadata, difficulty, eventLines, timingLines, hitObjectLines };
}

/**
 * Calcula la columna a partir de la coordenada x de un hit object de mania.
 * `columna = floor(x * columnCount / 512)`. Se acota a [0, 3] por si algun
 * mapa trae una x justo en el borde (512 exacto, o negativa).
 */
function columnaDesdeX(x: number): Column {
  const cruda = Math.floor((x * COLUMN_COUNT) / 512);
  const acotada = Math.min(COLUMN_COUNT - 1, Math.max(0, cruda));
  return acotada as Column;
}

/**
 * Separa una linea de [Events] por comas respetando las comillas: el nombre
 * de archivo puede traer comas adentro ("Artista, Titulo.jpg"). Las comillas
 * se conservan en el campo; `limpiarRuta` las quita despues.
 */
function separarCampos(linea: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let entreComillas = false;
  for (const c of linea) {
    if (c === '"') {
      entreComillas = !entreComillas;
      actual += c;
    } else if (c === ',' && !entreComillas) {
      campos.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos;
}

/** Quita comillas y espacios de un nombre de archivo y pasa `\` a `/`. Vacio si no queda nada. */
function limpiarRuta(crudo: string): string {
  return crudo.replace(/"/g, '').replace(/\\/g, '/').trim();
}

/** Fondo y video declarados en [Events]. Cada campo ausente si no hay linea valida. */
interface EventosLeidos {
  backgroundFile?: string;
  videoFile?: string;
  videoOffset?: number;
}

/**
 * Lee [Events]: solo la primera linea de fondo (`0,0,"f.jpg",x,y` o
 * `Background,...`) y la primera de video (`Video,offset,"f.mp4"` o
 * `1,offset,"f.mp4"`). Sprites, breaks y storyboard se ignoran, y una linea
 * rara nunca hace fallar el mapa: simplemente no aporta nada.
 */
function parseEventos(lineas: readonly string[]): EventosLeidos {
  const eventos: EventosLeidos = {};
  for (const linea of lineas) {
    const campos = separarCampos(linea);
    if (campos.length < 3) continue;
    const tipo = campos[0]!.trim().toLowerCase();
    const ruta = limpiarRuta(campos[2]!);
    if (ruta === '') continue;

    if (tipo === '0' || tipo === 'background') {
      if (eventos.backgroundFile === undefined) eventos.backgroundFile = ruta;
    } else if (tipo === '1' || tipo === 'video') {
      if (eventos.videoFile === undefined) {
        eventos.videoFile = ruta;
        const offset = Number(campos[1]!.trim());
        eventos.videoOffset = Number.isNaN(offset) ? 0 : offset;
      }
    }
  }
  return eventos;
}

/** Parsea [TimingPoints]. Devuelve error si no hay ningun punto rojo (BPM). */
function parseTimingPoints(
  lineas: readonly string[],
): { ok: true; timingPoints: TimingPoint[]; speedPoints: SpeedPoint[] } | { ok: false; error: string } {
  const timingPoints: TimingPoint[] = [];
  const speedPoints: SpeedPoint[] = [];

  for (const linea of lineas) {
    const campos = linea.split(',');
    if (campos.length < 2) continue; // linea incompleta, se ignora

    const time = Number(campos[0]);
    const beatLength = Number(campos[1]);
    if (Number.isNaN(time) || Number.isNaN(beatLength)) continue;

    // El meter (campo 3) es opcional en la practica: si falta o no es un
    // numero valido, se asume 4/4, que es el comun. No esta en el ticket
    // como caso de error, asi que se resuelve con un valor por defecto en
    // vez de descartar el punto entero.
    const meterCrudo = campos.length >= 3 ? Number(campos[2]) : NaN;
    const meter = Number.isNaN(meterCrudo) ? 4 : meterCrudo;

    if (beatLength > 0) {
      // Punto rojo: cambio de BPM.
      timingPoints.push({ time, bpm: 60000 / beatLength, meter });
    } else if (beatLength < 0) {
      // Punto verde: cambio de velocidad de scroll (SV), no afecta el BPM.
      speedPoints.push({ time, multiplier: 100 / -beatLength });
    }
    // beatLength === 0 es un caso degenerado que no ocurre en archivos .osu
    // reales (daria BPM infinito): se ignora en vez de abortar el mapa entero.
  }

  if (timingPoints.length === 0) {
    return {
      ok: false,
      error:
        'El mapa no tiene ningun punto de tiempo rojo (cambio de BPM) en [TimingPoints]: ' +
        'hace falta al menos uno para definir el offset y el tempo.',
    };
  }

  return { ok: true, timingPoints, speedPoints };
}

/** Parsea [HitObjects]. Las notas invalidas (LN con endTime <= time) se descartan, no abortan el mapa. */
function parseHitObjects(lineas: readonly string[]): Note[] {
  const notas: Note[] = [];

  for (const linea of lineas) {
    const campos = linea.split(',');
    if (campos.length < 5) continue; // linea incompleta: faltan x,y,time,type,hitSound

    const x = Number(campos[0]);
    const time = Number(campos[2]);
    const type = Number(campos[3]);
    if (Number.isNaN(x) || Number.isNaN(time) || Number.isNaN(type)) continue;

    const columna = columnaDesdeX(x);

    if ((type & 128) !== 0) {
      // Hold note (LN): el endTime es el primer campo de extras (indice 5),
      // antes del primer ':'. Ejemplo de extras: "48350:0:0:0:0:".
      const extras = campos[5];
      if (extras === undefined) continue; // hold sin extras: linea invalida, se descarta
      const endTime = Number(extras.split(':')[0]);
      if (Number.isNaN(endTime) || endTime <= time) continue; // LN invalida: se descarta y se sigue con el resto
      notas.push({ kind: 'hold', time, endTime, column: columna });
    } else if ((type & 1) !== 0) {
      notas.push({ kind: 'tap', time, column: columna });
    }
    // Otro tipo de hit object (por ejemplo un spinner, type & 8) no aplica
    // a mania 4K: se ignora la linea sin fallar el mapa entero.
  }

  // Invariante de Chart (ver types.ts): notes ordenadas por time ascendente.
  // No hay que confiar en que el archivo ya venga ordenado.
  notas.sort((a, b) => a.time - b.time);
  return notas;
}

/** Parsea el texto de un archivo .osu de modo mania con 4 columnas. */
export function parseOsu(text: string): ParseResult {
  const secciones = dividirSecciones(text);

  // --- [General] ---
  if (!secciones.vistas.has('General')) return err('Falta la seccion [General].');

  const mode = secciones.general.get('Mode');
  if (mode === undefined) return err('Falta el campo Mode en [General].');
  if (mode !== '3') {
    return err(`Mode invalido: se esperaba 3 (mania), el archivo tiene Mode:${mode}.`);
  }

  const audioFile = secciones.general.get('AudioFilename');
  if (audioFile === undefined) return err('Falta el campo AudioFilename en [General].');

  // PreviewTime no esta en la lista de campos que el ticket marca como
  // obligatorios: si falta, se asume 0 (arranca desde el inicio de la
  // pista) en vez de fallar todo el mapa.
  const previewTimeCrudo = secciones.general.get('PreviewTime');
  const previewTime = previewTimeCrudo === undefined ? 0 : Number(previewTimeCrudo);
  if (Number.isNaN(previewTime)) {
    return err(`PreviewTime invalido: '${previewTimeCrudo}'.`);
  }

  // --- [Metadata] ---
  if (!secciones.vistas.has('Metadata')) return err('Falta la seccion [Metadata].');

  const title = secciones.metadata.get('Title');
  if (title === undefined) return err('Falta el campo Title en [Metadata].');
  const artist = secciones.metadata.get('Artist');
  if (artist === undefined) return err('Falta el campo Artist en [Metadata].');
  const creator = secciones.metadata.get('Creator');
  if (creator === undefined) return err('Falta el campo Creator en [Metadata].');
  const version = secciones.metadata.get('Version');
  if (version === undefined) return err('Falta el campo Version en [Metadata].');

  // --- [Difficulty] ---
  if (!secciones.vistas.has('Difficulty')) return err('Falta la seccion [Difficulty].');

  const odCrudo = secciones.difficulty.get('OverallDifficulty');
  if (odCrudo === undefined) return err('Falta el campo OverallDifficulty en [Difficulty].');
  const overallDifficulty = Number(odCrudo);
  if (Number.isNaN(overallDifficulty)) {
    return err(`OverallDifficulty invalido: '${odCrudo}'.`);
  }

  const hpCrudo = secciones.difficulty.get('HPDrainRate');
  if (hpCrudo === undefined) return err('Falta el campo HPDrainRate en [Difficulty].');
  const hpDrain = Number(hpCrudo);
  if (Number.isNaN(hpDrain)) {
    return err(`HPDrainRate invalido: '${hpCrudo}'.`);
  }

  const csCrudo = secciones.difficulty.get('CircleSize');
  if (csCrudo === undefined) return err('Falta el campo CircleSize en [Difficulty].');
  const circleSize = Number(csCrudo);
  if (Number.isNaN(circleSize)) {
    return err(`CircleSize invalido: '${csCrudo}'.`);
  }
  if (circleSize !== 4) {
    return err(
      `CircleSize invalido: se esperaban 4 columnas (mania 4K), el archivo tiene CircleSize:${csCrudo}.`,
    );
  }

  // --- [TimingPoints] ---
  if (!secciones.vistas.has('TimingPoints')) {
    return err('Falta la seccion [TimingPoints].');
  }
  const puntos = parseTimingPoints(secciones.timingLines);
  if (!puntos.ok) return puntos;

  // --- [HitObjects] ---
  // Ausente o vacia no es un error: un mapa con cero notas no tiene sentido
  // para jugar, pero no viola ningun invariante de Chart, y el ticket no lo
  // marca como caso de fallo obligatorio.
  const notes = parseHitObjects(secciones.hitObjectLines);

  const eventos = parseEventos(secciones.eventLines);
  const source = secciones.metadata.get('Source');
  const tags = secciones.metadata.get('Tags');

  const chart: Chart = {
    metadata: {
      title,
      artist,
      creator,
      difficultyName: version,
      audioFile,
      previewTime,
      // Los opcionales se agregan solo si existen (nada de claves en undefined).
      ...(eventos.backgroundFile !== undefined && { backgroundFile: eventos.backgroundFile }),
      ...(eventos.videoFile !== undefined && {
        videoFile: eventos.videoFile,
        videoOffset: eventos.videoOffset ?? 0,
      }),
      ...(source !== undefined && source !== '' && { source }),
      ...(tags !== undefined && tags !== '' && { tags }),
    },
    overallDifficulty,
    hpDrain,
    timingPoints: puntos.timingPoints,
    speedPoints: puntos.speedPoints,
    notes,
  };

  return { ok: true, chart };
}
