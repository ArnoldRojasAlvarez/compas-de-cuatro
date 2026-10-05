// T-051: los mapas de la cancion demo, derivados de la partitura. Funcion pura.
//
// Regla de oro: cada nota de cada mapa cae sobre el `tiempo` de un evento de
// la composicion (redondeado a ms entero). No se inventa ningun golpe: lo que
// el jugador pulsa es lo que se oye.
//
// Cada nivel elige que eventos juegan (reglas de seleccion, mas abajo) y un
// asignador comun los reparte en columnas:
//
//   Facil    bombo y caja en negras, una nota a la vez (mas el bombo
//            sincopado y el redoble de caja de los fills, a corcheas).
//   Normal   corcheas del groove (bombo, caja y hats que rellenan), la melodia
//            en las partes con melodia y dobles en los acentos (el primer
//            tiempo y, en el climax, los cuatro tiempos).
//   Dificil  hats a semicorcheas en las partes llenas con el bajo debajo (un
//            jumpstream natural), acordes como jumps y hands, el arpegio del
//            climax y LN en las notas largas de la melodia y del pad.
//
// El asignador reparte asi: la melodia por altura (grave a la izquierda), el
// bombo en la mano izquierda y la caja en la derecha alternando de columna, los
// hats en un ciclo que no repite columna, los acordes en formas de jump. Una
// columna con una LN en curso no recibe notas hasta 60 ms despues del final.

import type { Chart, Column, Note } from '@tetra/core';
import { COLUMN_COUNT } from '@tetra/core';
import type { Composicion, EventoMusical } from './composicion.js';
import { ARCHIVO_AUDIO, ARCHIVO_FONDO, TITULO_DEMO } from './constantes.js';

export type NivelDemo = 'Facil' | 'Normal' | 'Dificil';

export const NIVELES_DEMO: readonly NivelDemo[] = ['Facil', 'Normal', 'Dificil'];

/** Margen despues del final de una LN antes de que su columna reciba otra nota. */
const MARGEN_LN_MS = 60;
/** Dos notas en la misma columna a menos de esto cuentan como jack (se evitan). */
const VENTANA_JACK_MS = 300;

// ---------------------------------------------------------------------------
// Analisis de la partitura
// ---------------------------------------------------------------------------

interface EventoPosicionado {
  evento: EventoMusical;
  /** Tiempo en ms enteros: el que lleva la nota. */
  t: number;
  compas: number;
  /** Semicorchea dentro del compas, de 0 a 15. */
  slot: number;
  /** Duracion en semicorcheas (0 para percusion). */
  slotsDuracion: number;
}

interface RasgosDeCompas {
  /** Notas de arpegio (acordes de una semicorchea): solo suenan en el climax. */
  arpegios: number;
  cajas: number;
  hats: number;
  melodias: number;
  bombos: number;
}

function posicionar(composicion: Composicion): {
  eventos: EventoPosicionado[];
  compases: Map<number, RasgosDeCompas>;
} {
  const pulso = 60000 / composicion.bpm;
  const slotMs = pulso / 4;
  const compasMs = pulso * 4;
  const eventos: EventoPosicionado[] = [];
  const compases = new Map<number, RasgosDeCompas>();
  for (const evento of composicion.eventos) {
    // El epsilon evita que 1874.9999 caiga en el compas anterior por redondeo.
    const compas = Math.floor(evento.tiempo / compasMs + 1e-9);
    const slot = Math.round((evento.tiempo - compas * compasMs) / slotMs);
    eventos.push({
      evento,
      t: Math.round(evento.tiempo),
      compas,
      slot,
      slotsDuracion: evento.duracion / slotMs,
    });
    const rasgos = compases.get(compas) ?? { arpegios: 0, cajas: 0, hats: 0, melodias: 0, bombos: 0 };
    if (evento.voz === 'acorde' && evento.duracion <= slotMs * 1.5) rasgos.arpegios += 1;
    if (evento.voz === 'caja') rasgos.cajas += 1;
    if (evento.voz === 'hat') rasgos.hats += 1;
    if (evento.voz === 'melodia') rasgos.melodias += 1;
    if (evento.voz === 'bombo') rasgos.bombos += 1;
    compases.set(compas, rasgos);
  }
  return { eventos, compases };
}

// ---------------------------------------------------------------------------
// Intenciones: que se quiere jugar en cada instante
// ---------------------------------------------------------------------------

interface Intencion {
  t: number;
  voz: EventoMusical['voz'];
  /** Nota MIDI (para repartir la melodia por altura). */
  nota: number;
  /** Cuantas notas del mapa pone esta intencion (1 nota, o 2 y 3 para jumps y hands). */
  n: number;
  /** Si es una LN, el tiempo de suelta. */
  fin?: number;
  /** Menor es mas importante: cuando no caben todas en la fila, caen las ultimas. */
  prioridad: number;
}

const PRIORIDAD: Record<EventoMusical['voz'], number> = {
  melodia: 1,
  caja: 2,
  bombo: 3,
  acorde: 4,
  hat: 5,
  bajo: 6,
};

function intencion(p: EventoPosicionado, n = 1, fin?: number): Intencion {
  const base: Intencion = {
    t: p.t,
    voz: p.evento.voz,
    nota: p.evento.nota,
    n,
    prioridad: PRIORIDAD[p.evento.voz],
  };
  return fin === undefined ? base : { ...base, fin };
}

/** Notas fantasma de la caja: se oyen pero no se juegan. */
const INTENSIDAD_MINIMA_CAJA = 0.4;
/** Un compas con tantas cajas o mas es un fill (redoble). */
const CAJAS_DE_RELLENO = 4;

function intencionesFacil(
  eventos: readonly EventoPosicionado[],
  compases: ReadonlyMap<number, RasgosDeCompas>,
): Intencion[] {
  // Una nota por negra: si caen bombo y caja juntos gana la caja (el backbeat).
  // Solo en los fills (compases con redoble) la caja se adelanta a las corcheas.
  const porTiempo = new Map<number, Intencion>();
  for (const p of eventos) {
    const v = p.evento.voz;
    if (v !== 'bombo' && v !== 'caja') continue;
    const relleno = (compases.get(p.compas)?.cajas ?? 0) >= CAJAS_DE_RELLENO;
    const rejilla = relleno && v === 'caja' ? 2 : 4;
    const sincopa = v === 'bombo' && (p.slot === 6 || p.slot === 14);
    if (p.slot % rejilla !== 0 && !sincopa) continue;
    if (v === 'caja' && p.evento.intensidad < INTENSIDAD_MINIMA_CAJA) continue;
    const previa = porTiempo.get(p.t);
    if (previa === undefined || v === 'caja') porTiempo.set(p.t, intencion(p));
  }
  return [...porTiempo.values()];
}

function intencionesNormal(
  eventos: readonly EventoPosicionado[],
  compases: ReadonlyMap<number, RasgosDeCompas>,
): Intencion[] {
  const salida: Intencion[] = [];
  const ocupados = new Set<number>();
  const conMelodiaEn = new Set<number>();
  for (const p of eventos) {
    if (p.slot % 2 !== 0) continue; // solo la rejilla de corcheas
    const v = p.evento.voz;
    const conMelodia = (compases.get(p.compas)?.melodias ?? 0) > 0;
    if (v === 'melodia') {
      salida.push(intencion(p));
      ocupados.add(p.t);
      conMelodiaEn.add(p.t);
    } else if (v === 'caja') {
      if (p.evento.intensidad >= INTENSIDAD_MINIMA_CAJA) {
        salida.push(intencion(p));
        ocupados.add(p.t);
      }
    } else if (v === 'bombo') {
      // Donde suena la melodia el bombo solo marca los tiempos fuertes (0 y 8):
      // ahi coincide con la melodia y sale el doble del acento. En el climax
      // (el compas con arpegio) marca los cuatro tiempos.
      const climax = (compases.get(p.compas)?.arpegios ?? 0) > 0;
      if (!conMelodia || p.slot % 8 === 0 || (climax && p.slot % 4 === 0)) {
        salida.push(intencion(p));
        ocupados.add(p.t);
      }
    }
  }
  // En las partes llenas los hats rellenan las corcheas que quedan libres:
  // asi la parte B es un flujo parejo de corcheas con dobles en los acentos.
  for (const p of eventos) {
    if (p.evento.voz !== 'hat' || p.slot % 2 !== 0) continue;
    // Un hat que cae con una nota de melodia en el contratiempo hace un doble.
    if (ocupados.has(p.t) && !(conMelodiaEn.has(p.t) && p.slot % 4 === 2)) continue;
    const rasgos = compases.get(p.compas);
    if ((rasgos?.bombos ?? 0) > 0) salida.push(intencion(p));
  }
  return salida;
}

/** Cuantas semicorcheas minimo dura una nota para jugarse como LN (una negra). */
const SLOTS_MINIMOS_LN = 4;
/** Un compas con tantos hats o mas es una parte "llena" (hats a semicorcheas). */
const HATS_DE_PARTE_LLENA = 12;

function intencionesDificil(
  eventos: readonly EventoPosicionado[],
  compases: ReadonlyMap<number, RasgosDeCompas>,
): Intencion[] {
  const salida: Intencion[] = [];
  // Para no repetir el mismo acorde: se juega un solo evento por instante.
  const acordeYaTomado = new Set<number>();
  // El pad sostenido solo se toma como LN en compases alternos, para dejar respirar.
  const padTomadoEnCompas = new Set<number>();

  // El pad largo se toma por su nota mas aguda: se busca antes.
  const masAgudaDelPad = new Map<number, EventoPosicionado>();
  for (const p of eventos) {
    if (p.evento.voz !== 'acorde' || p.slotsDuracion < 12) continue;
    const actual = masAgudaDelPad.get(p.compas);
    if (actual === undefined || p.evento.nota > actual.evento.nota) masAgudaDelPad.set(p.compas, p);
  }

  for (const p of eventos) {
    const rasgos = compases.get(p.compas) ?? { arpegios: 0, cajas: 0, hats: 0, melodias: 0, bombos: 0 };
    const llena = rasgos.hats >= HATS_DE_PARTE_LLENA;
    const v = p.evento.voz;

    if (v === 'bombo') {
      salida.push(intencion(p));
    } else if (v === 'caja') {
      if (p.evento.intensidad >= INTENSIDAD_MINIMA_CAJA) salida.push(intencion(p));
    } else if (v === 'hat') {
      // Parte llena: todas las semicorcheas. Parte rala (la intro, A): corcheas.
      if (llena || p.slot % 2 === 0) salida.push(intencion(p));
    } else if (v === 'bajo') {
      // El bajo en corcheas bajo los hats a semicorcheas hace un jumpstream natural.
      if (rasgos.bombos > 0) salida.push(intencion(p));
    } else if (v === 'melodia') {
      const fin =
        p.slotsDuracion >= SLOTS_MINIMOS_LN ? Math.round(p.evento.tiempo + p.evento.duracion) : undefined;
      salida.push(intencion(p, 1, fin));
    } else if (v === 'acorde') {
      if (p.slotsDuracion <= 1.5) {
        // Arpegio de semicorcheas del climax: una de cada cuatro, y todas las
        // impares en los compases impares, para que el final pegue mas fuerte.
        if (p.slot % 4 === 3 || (p.compas % 2 === 1 && p.slot % 2 === 1)) salida.push(intencion(p));
      } else if (p.slotsDuracion >= 12) {
        // Pad sostenido: LN en la nota mas aguda, un compas si y uno no, y solo
        // donde no suena la melodia (ahi la LN es la de la melodia).
        if (
          rasgos.melodias === 0 &&
          masAgudaDelPad.get(p.compas) === p &&
          p.compas % 2 === 0 &&
          !padTomadoEnCompas.has(p.compas)
        ) {
          padTomadoEnCompas.add(p.compas);
          const fin = Math.round(p.evento.tiempo + p.evento.duracion);
          salida.push(intencion(p, 1, fin));
        }
      } else if (p.slot === 0 || p.slot === 6 || p.slot === 10) {
        // Golpes de acorde sincopados: un jump.
        if (!acordeYaTomado.has(p.t)) {
          acordeYaTomado.add(p.t);
          salida.push(intencion(p, 2));
        }
      }
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Reparto en columnas
// ---------------------------------------------------------------------------

/** Ciclo de columnas de los hats: ninguna columna se repite en dos pasos seguidos. */
const CICLO_HATS: readonly Column[] = [0, 2, 1, 3, 2, 0, 3, 1];
const JUMPS: readonly (readonly Column[])[] = [
  [0, 3],
  [1, 2],
  [0, 2],
  [1, 3],
];
const MANOS: readonly (readonly Column[])[] = [
  [0, 1, 2],
  [1, 2, 3],
  [0, 2, 3],
  [0, 1, 3],
];

/** Percentiles de altura de la melodia: [p25, p50, p75] para repartir en cuatro columnas. */
function umbralesDeAltura(eventos: readonly EventoPosicionado[]): [number, number, number] {
  const alturas = eventos
    .filter((p) => p.evento.voz === 'melodia')
    .map((p) => p.evento.nota)
    .sort((a, b) => a - b);
  if (alturas.length === 0) return [0, 0, 0];
  const en = (q: number): number => alturas[Math.min(alturas.length - 1, Math.floor(q * alturas.length))] ?? 0;
  return [en(0.25), en(0.5), en(0.75)];
}

export function columnaDeAltura(nota: number, umbrales: readonly number[]): Column {
  let c = 0;
  for (const u of umbrales) if (nota >= u) c++;
  // Con umbrales repetidos `c` puede pasar de 3: se acota.
  return Math.min(c, COLUMN_COUNT - 1) as Column;
}

function porCercania(objetivo: number): Column[] {
  return ([0, 1, 2, 3] as const).slice().sort((a, b) => Math.abs(a - objetivo) - Math.abs(b - objetivo) || a - b);
}

function asignarColumnas(intenciones: readonly Intencion[], topePorFila: number, umbrales: readonly number[]): Note[] {
  const grupos = new Map<number, Intencion[]>();
  for (const it of intenciones) {
    const lista = grupos.get(it.t);
    if (lista) lista.push(it);
    else grupos.set(it.t, [it]);
  }
  const tiempos = [...grupos.keys()].sort((a, b) => a - b);

  const libreDesde: number[] = [-Infinity, -Infinity, -Infinity, -Infinity];
  let ultimaFila: Column[] = [];
  let ultimoT = -Infinity;
  const turno = { bombo: 0, bajo: 0, caja: 0, hat: 0, acorde: 0, mano: 0 };
  const notas: Note[] = [];

  for (const t of tiempos) {
    const lista = (grupos.get(t) ?? []).slice().sort((a, b) => a.prioridad - b.prioridad);
    const usadas = new Set<Column>();
    const filaActual: Column[] = [];
    // Si la fila anterior esta cerca en el tiempo, esta solo puede usar las
    // columnas que aquella dejo libres: asi no hay jacks (una fila de tres
    // notas deja una sola columna para la siguiente).
    const cercana = t - ultimoT <= VENTANA_JACK_MS;
    let presupuesto = cercana ? Math.min(topePorFila, COLUMN_COUNT - ultimaFila.length) : topePorFila;

    for (const it of lista) {
      if (presupuesto <= 0) break;
      const n = Math.min(it.n, presupuesto);

      // Orden de preferencia segun la voz.
      let preferidas: readonly Column[];
      switch (it.voz) {
        case 'melodia':
          preferidas = porCercania(columnaDeAltura(it.nota, umbrales));
          break;
        case 'bombo':
          preferidas = turno.bombo % 2 === 0 ? [0, 1, 2, 3] : [1, 0, 3, 2];
          break;
        case 'bajo':
          preferidas = turno.bajo % 2 === 0 ? [1, 0, 2, 3] : [0, 1, 3, 2];
          break;
        case 'caja':
          preferidas = turno.caja % 2 === 0 ? [3, 2, 1, 0] : [2, 3, 0, 1];
          break;
        case 'hat': {
          const c = CICLO_HATS[turno.hat % CICLO_HATS.length] ?? 0;
          preferidas = porCercania(c);
          break;
        }
        case 'acorde': {
          if (n >= 3) {
            preferidas = [...(MANOS[turno.mano % MANOS.length] ?? []), 0, 1, 2, 3];
          } else if (n === 2) {
            preferidas = [...(JUMPS[turno.acorde % JUMPS.length] ?? []), 0, 1, 2, 3];
          } else {
            preferidas = porCercania(1 + (turno.acorde % 2));
          }
          break;
        }
        default:
          preferidas = [0, 1, 2, 3];
      }

      const candidatas = preferidas
        .filter(
          (c, k) =>
            preferidas.indexOf(c) === k &&
            !usadas.has(c) &&
            (libreDesde[c] ?? -Infinity) <= t &&
            !(cercana && ultimaFila.includes(c)),
        )
        .slice(0, n);

      const elegidas = candidatas;
      if (elegidas.length === 0) continue;

      for (const c of elegidas) {
        usadas.add(c);
        filaActual.push(c);
        if (it.fin !== undefined && it.fin > t) {
          notas.push({ kind: 'hold', time: t, endTime: it.fin, column: c });
          libreDesde[c] = it.fin + MARGEN_LN_MS;
        } else {
          notas.push({ kind: 'tap', time: t, column: c });
          libreDesde[c] = t;
        }
      }
      presupuesto -= elegidas.length;

      if (it.voz === 'bombo') turno.bombo++;
      else if (it.voz === 'bajo') turno.bajo++;
      else if (it.voz === 'caja') turno.caja++;
      else if (it.voz === 'hat') turno.hat++;
      else if (it.voz === 'acorde') {
        if (n >= 3) turno.mano++;
        else turno.acorde++;
      }
    }

    if (filaActual.length > 0) {
      ultimaFila = filaActual;
      ultimoT = t;
    }
  }

  notas.sort((a, b) => a.time - b.time || a.column - b.column);
  return notas;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export function mapearDemo(composicion: Composicion, nivel: NivelDemo): Chart {
  const { eventos, compases } = posicionar(composicion);
  const umbrales = umbralesDeAltura(eventos);

  let notas: Note[];
  switch (nivel) {
    case 'Facil':
      notas = asignarColumnas(intencionesFacil(eventos, compases), 1, umbrales);
      break;
    case 'Normal':
      notas = asignarColumnas(intencionesNormal(eventos, compases), 2, umbrales);
      break;
    case 'Dificil':
      notas = asignarColumnas(intencionesDificil(eventos, compases), 3, umbrales);
      break;
  }

  return {
    metadata: {
      title: TITULO_DEMO,
      artist: 'Tetra',
      creator: 'Tetra',
      difficultyName: nivel,
      audioFile: ARCHIVO_AUDIO,
      previewTime: composicion.preview,
      backgroundFile: ARCHIVO_FONDO,
      tags: 'tetra demo',
    },
    overallDifficulty: 7,
    hpDrain: 7,
    timingPoints: [{ time: 0, bpm: composicion.bpm, meter: 4 }],
    speedPoints: [],
    notes: notas,
  };
}
