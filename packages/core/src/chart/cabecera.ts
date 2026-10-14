// T-066: lo minimo de un .osu para clasificarlo (modo, teclas, audio,
// identidad) sin parsearlo entero. Funcion pura y que nunca lanza: sirve para
// explicar por que un .osz no se puede importar (por ejemplo "solo trae 7K")
// aunque parseOsu lo rechace.

/** Lo minimo de un .osu para clasificarlo sin parsearlo entero. Nunca lanza. */
export interface CabeceraOsu {
  /** `Mode` de [General]; undefined si falta o no es un entero. */
  modo?: number;
  /** `CircleSize` de [Difficulty] (en mania, las teclas); undefined si falta o no es numero. */
  teclas?: number;
  /** `AudioFilename` recortado; undefined si falta. */
  audio?: string;
  /** true si `audio` es "virtual" (sin distinguir mayusculas). */
  audioVirtual: boolean;
  titulo?: string;
  artista?: string;
  version?: string;
  beatmapId?: number;
  beatmapSetId?: number;
}

type SeccionLeida = 'General' | 'Metadata' | 'Difficulty';

function clave(linea: string): { clave: string; valor: string } | null {
  const idx = linea.indexOf(':');
  if (idx === -1) return null;
  return { clave: linea.slice(0, idx).trim(), valor: linea.slice(idx + 1).trim() };
}

function entero(crudo: string | undefined): number | undefined {
  if (crudo === undefined || !/^-?\d+$/.test(crudo)) return undefined;
  return Number(crudo);
}

function enteroPositivo(crudo: string | undefined): number | undefined {
  const n = entero(crudo);
  return n !== undefined && n > 0 && Number.isSafeInteger(n) ? n : undefined;
}

/** Lee la cabecera de un .osu. Nunca lanza: un texto sin secciones da `{ audioVirtual: false }`. */
export function leerCabeceraOsu(texto: string): CabeceraOsu {
  const general = new Map<string, string>();
  const metadata = new Map<string, string>();
  const difficulty = new Map<string, string>();
  let actual: SeccionLeida | null = null;

  for (const cruda of texto.split(/\r\n|\r|\n/)) {
    const linea = cruda.trim();
    if (linea === '' || linea.startsWith('//')) continue;
    const seccion = /^\[([A-Za-z]+)\]$/.exec(linea);
    if (seccion) {
      const nombre = seccion[1]!;
      actual = nombre === 'General' || nombre === 'Metadata' || nombre === 'Difficulty' ? nombre : null;
      continue;
    }
    if (actual === null) continue;
    const par = clave(linea);
    if (par === null) continue;
    (actual === 'General' ? general : actual === 'Metadata' ? metadata : difficulty).set(
      par.clave,
      par.valor,
    );
  }

  const audioCrudo = general.get('AudioFilename');
  const audio = audioCrudo === undefined || audioCrudo === '' ? undefined : audioCrudo;
  const teclasCrudas = difficulty.get('CircleSize');
  const teclasNum = teclasCrudas === undefined || teclasCrudas === '' ? NaN : Number(teclasCrudas);

  const cabecera: CabeceraOsu = {
    audioVirtual: audio !== undefined && audio.toLowerCase() === 'virtual',
  };
  const modo = entero(general.get('Mode'));
  if (modo !== undefined) cabecera.modo = modo;
  if (Number.isFinite(teclasNum)) cabecera.teclas = teclasNum;
  if (audio !== undefined) cabecera.audio = audio;
  const titulo = metadata.get('Title');
  if (titulo !== undefined) cabecera.titulo = titulo;
  const artista = metadata.get('Artist');
  if (artista !== undefined) cabecera.artista = artista;
  const version = metadata.get('Version');
  if (version !== undefined) cabecera.version = version;
  const beatmapId = enteroPositivo(metadata.get('BeatmapID'));
  if (beatmapId !== undefined) cabecera.beatmapId = beatmapId;
  const beatmapSetId = enteroPositivo(metadata.get('BeatmapSetID'));
  if (beatmapSetId !== undefined) cabecera.beatmapSetId = beatmapSetId;
  return cabecera;
}
