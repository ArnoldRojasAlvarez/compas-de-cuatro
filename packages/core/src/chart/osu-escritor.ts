// Escritor de mapas .osu de osu!mania 4K: la operacion inversa de parseOsu
// (osu.ts). Funcion pura: entra un Chart, sale el texto del archivo. Lo usa
// el mapeador para exportar y para guardar en la biblioteca (que pasa por
// un .osz, ver @tetra/storage).
//
// Solo escribe lo que parseOsu lee y lo que osu! necesita para abrir el
// mapa: [General], [Metadata], [Difficulty], [Events] (solo fondo y video,
// si el chart los declara), [TimingPoints] y [HitObjects]. Un parse del
// resultado devuelve un Chart equivalente (mismas notas, mismos tiempos,
// mismos puntos de tiempo, mismo fondo, video, Source y Tags).

import type { Chart, Note, SpeedPoint, TimingPoint } from '../types.js';
import { COLUMN_COUNT } from '../types.js';

/** Centro de la columna en el eje x de osu! (512 de ancho dividido en 4). */
function xDeColumna(columna: number): number {
  return Math.floor(((columna + 0.5) * 512) / COLUMN_COUNT);
}

/** Limpia un campo de texto de metadata: sin saltos de linea (romperian el formato). */
function limpiar(texto: string): string {
  return texto.replace(/[\r\n]+/g, ' ').trim();
}

function numero(valor: number): string {
  // Hasta 3 decimales y sin ceros sobrantes: 120, 128.5, 62.5.
  return String(Number(valor.toFixed(3)));
}

function lineaTiming(punto: TimingPoint): string {
  const beatLength = 60000 / punto.bpm;
  return `${Math.round(punto.time)},${numero(beatLength)},${punto.meter},1,0,100,1,0`;
}

function lineaVelocidad(punto: SpeedPoint): string {
  const beatLength = -100 / punto.multiplier;
  return `${Math.round(punto.time)},${numero(beatLength)},4,1,0,100,0,0`;
}

function lineaNota(nota: Note): string {
  const x = xDeColumna(nota.column);
  const time = Math.round(nota.time);
  if (nota.kind === 'hold') {
    return `${x},192,${time},128,0,${Math.round(nota.endTime)}:0:0:0:0:`;
  }
  return `${x},192,${time},1,0,0:0:0:0:`;
}

/** Nombre de archivo apto para ir entre comillas en [Events]: sin comillas ni saltos de linea. */
function rutaEvento(ruta: string): string {
  return limpiar(ruta).replace(/"/g, '');
}

/** Lineas de [Events]: fondo y video (los que el chart declara) y, si el audio es virtual, todos los sonidos de la receta (T-066). */
function lineasEventos(chart: Chart): string[] {
  const m = chart.metadata;
  const lineas: string[] = [];
  if (m.backgroundFile !== undefined && rutaEvento(m.backgroundFile) !== '') {
    lineas.push(`0,0,"${rutaEvento(m.backgroundFile)}",0,0`);
  }
  if (m.videoFile !== undefined && rutaEvento(m.videoFile) !== '') {
    lineas.push(`Video,${Math.round(m.videoOffset ?? 0)},"${rutaEvento(m.videoFile)}"`);
  }
  // T-066 (D11): el audio virtual se exporta como lineas Sample con el volumen
  // ya resuelto; las notas van sin keysound (ver lineaNota), asi que suena igual.
  if (chart.audioVirtual !== undefined && chart.audioVirtual.eventos.length > 0) {
    lineas.push('//Storyboard Sound Samples');
    for (const e of chart.audioVirtual.eventos) {
      lineas.push(`Sample,${Math.round(e.tiempo)},0,"${rutaEvento(e.archivo)}",${Math.round(e.volumen)}`);
    }
  }
  return lineas;
}

/** Texto completo de un .osu (mania, 4 columnas) para `chart`. */
export function escribirOsu(chart: Chart): string {
  const m = chart.metadata;
  const titulo = limpiar(m.title);
  const artista = limpiar(m.artist);

  // Los puntos rojos y verdes van mezclados por tiempo; a igual tiempo el
  // rojo primero (osu! lo exige para que el SV aplique al BPM nuevo).
  const puntos: { time: number; orden: number; linea: string }[] = [
    ...chart.timingPoints.map((p) => ({ time: p.time, orden: 0, linea: lineaTiming(p) })),
    ...chart.speedPoints.map((p) => ({ time: p.time, orden: 1, linea: lineaVelocidad(p) })),
  ];
  puntos.sort((a, b) => a.time - b.time || a.orden - b.orden);

  const notas = [...chart.notes].sort((a, b) => a.time - b.time);

  const lineas = [
    'osu file format v14',
    '',
    '[General]',
    `AudioFilename: ${limpiar(m.audioFile)}`,
    'AudioLeadIn: 0',
    `PreviewTime: ${Math.round(m.previewTime)}`,
    'Countdown: 0',
    'SampleSet: Soft',
    'StackLeniency: 0.7',
    'Mode: 3',
    'LetterboxInBreaks: 0',
    'SpecialStyle: 0',
    'WidescreenStoryboard: 0',
    '',
    '[Metadata]',
    `Title:${titulo}`,
    `TitleUnicode:${titulo}`,
    `Artist:${artista}`,
    `ArtistUnicode:${artista}`,
    `Creator:${limpiar(m.creator)}`,
    `Version:${limpiar(m.difficultyName)}`,
    `Source:${limpiar(m.source ?? '')}`,
    `Tags:${limpiar(m.tags ?? '') === '' ? 'tetra' : limpiar(m.tags ?? '')}`,
    ...(m.beatmapId !== undefined ? [`BeatmapID:${m.beatmapId}`] : []),
    ...(m.beatmapSetId !== undefined ? [`BeatmapSetID:${m.beatmapSetId}`] : []),
    '',
    '[Difficulty]',
    `HPDrainRate:${numero(chart.hpDrain)}`,
    `CircleSize:${COLUMN_COUNT}`,
    `OverallDifficulty:${numero(chart.overallDifficulty)}`,
    'ApproachRate:5',
    'SliderMultiplier:1.4',
    'SliderTickRate:1',
    '',
    '[Events]',
    '//Background and Video events',
    ...lineasEventos(chart),
    '',
    '[TimingPoints]',
    ...puntos.map((p) => p.linea),
    '',
    '[HitObjects]',
    ...notas.map(lineaNota),
    '',
  ];
  return lineas.join('\n');
}
