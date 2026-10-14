// T-066 (D3 y D4): reglas puras para no duplicar canciones. Sin IndexedDB:
// trabajan sobre datos ya leidos, asi se prueban sin fake-indexeddb.
//
// - `combinarConExistente`: como queda una cancion de la biblioteca al
//   reimportar un .osz que ya estaba (D3).
// - `planearFusiones`: como se fusionan las canciones que ya estan duplicadas
//   en la biblioteca (D4).
// - `coincidenciaEnBiblioteca`: a cual cancion existente corresponde una
//   candidata (D3).
//
// La identidad de una dificultad sale de `clavesDeIdentidad` (core, D2): dos
// canciones son la misma si alguna dificultad de una comparte alguna clave
// con alguna de la otra (clausura por union y busqueda).

import { clavesDeIdentidad } from '@tetra/core';
import type { Chart } from '@tetra/core';
import type { CancionGuardada, SongId } from './db.js';

/** Que paso con una cancion existente al combinarla con un .osz entrante. */
export interface ResumenDeCombinacion {
  estado: 'ya-estaba' | 'actualizada';
  /** Dificultades agregadas a una cancion que ya estaba. */
  dificultadesAgregadas: number;
  /** Dificultades reemplazadas por una version nueva del mismo BeatmapID. */
  dificultadesActualizadas: number;
  /** true si se completo un fondo o un video que la cancion existente no tenia. */
  archivosCompletados: boolean;
}

export interface PlanDeFusion {
  /** La sobreviviente ya fusionada, lista para `put`. */
  resultado: CancionGuardada;
  /** De la importacion mas nueva a la mas vieja. */
  absorbidas: SongId[];
}

/** Claves de identidad de un chart; un chart tan roto que no se puede hashear no aporta ninguna. */
function clavesSeguras(chart: Chart): string[] {
  try {
    return clavesDeIdentidad(chart);
  } catch {
    return [];
  }
}

function esDeContenido(clave: string): boolean {
  return clave.startsWith('contenido:');
}

function clavesDeCancion(dificultades: readonly Chart[]): Set<string> {
  const claves = new Set<string>();
  for (const chart of dificultades) {
    for (const clave of clavesSeguras(chart)) claves.add(clave);
  }
  return claves;
}

/**
 * Si `nombre` ya existe entre `usados`, le agrega ` (2)`, ` (3)`... hasta que
 * no choque (los nombres son la clave de `ponerDificultad`, T-032).
 */
function nombreLibre(nombre: string, usados: ReadonlySet<string>): string {
  if (!usados.has(nombre)) return nombre;
  for (let n = 2; ; n++) {
    const candidato = `${nombre} (${n})`;
    if (!usados.has(candidato)) return candidato;
  }
}

/**
 * T-066 (paso 3): une los `keysounds` (nombre -> hash) de dos canciones. Si un
 * nombre choca gana el de `prioritario` (la sobreviviente o la existente).
 */
function unirKeysounds(
  prioritario: Record<string, string> | undefined,
  otro: Record<string, string>,
): Record<string, string> {
  return { ...otro, ...prioritario };
}

function conNombre(chart: Chart, nombre: string): Chart {
  if (chart.metadata.difficultyName === nombre) return chart;
  return { ...chart, metadata: { ...chart.metadata, difficultyName: nombre } };
}

/** Orden de importacion: la mas vieja primero (sin `importadaEn` cuenta como la mas vieja), desempate por id. */
function masVieja(a: CancionGuardada, b: CancionGuardada): number {
  const ta = a.importadaEn ?? Number.NEGATIVE_INFINITY;
  const tb = b.importadaEn ?? Number.NEGATIVE_INFINITY;
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * D3: a cual cancion de la biblioteca corresponde una candidata (por sus
 * dificultades). Si coincide con varias gana la de `importadaEn` menor.
 * `undefined` si no coincide con ninguna.
 */
export function coincidenciaEnBiblioteca(
  dificultades: readonly Chart[],
  biblioteca: readonly CancionGuardada[],
): CancionGuardada | undefined {
  const claves = clavesDeCancion(dificultades);
  return biblioteca
    .filter((c) => {
      for (const clave of clavesDeCancion(c.dificultades)) {
        if (claves.has(clave)) return true;
      }
      return false;
    })
    .sort(masVieja)[0];
}

/**
 * D3 sin tocar la base: como queda una cancion existente al reimportar.
 *
 * - Una dificultad entrante cuya identidad de contenido ya esta: no se toca.
 * - Con el mismo BeatmapID que una existente pero otro contenido (el mapa se
 *   actualizo en osu!): reemplaza a la existente, en su misma posicion.
 * - Sin coincidencia: se agrega al final (con ` (2)`, ` (3)` si el nombre choca).
 * - Las existentes que no vienen se conservan. El audio y el id tambien.
 * - Fondo y video se completan solo si la existente no los tenia.
 * - Audio virtual (T-066, paso 3): si cambia algo, los `keysounds` se unen (el
 *   nombre que ya estaba conserva su hash).
 */
export function combinarConExistente(
  existente: CancionGuardada,
  entrante: Pick<CancionGuardada, 'dificultades' | 'background' | 'video' | 'videoOffset'> &
    Partial<Pick<CancionGuardada, 'keysounds'>>,
): { cancion: CancionGuardada; resumen: ResumenDeCombinacion } {
  const dificultades = [...existente.dificultades];
  let agregadas = 0;
  let actualizadas = 0;

  for (const chart of entrante.dificultades) {
    const claves = clavesSeguras(chart);
    const contenido = claves.find(esDeContenido);
    const idDeMapa = claves.find((k) => !esDeContenido(k));

    const yaEsta =
      contenido !== undefined &&
      dificultades.some((d) => clavesSeguras(d).includes(contenido));
    if (yaEsta) continue;

    const indice =
      idDeMapa === undefined
        ? -1
        : dificultades.findIndex((d) => clavesSeguras(d).includes(idDeMapa));
    if (indice !== -1) {
      const otros = new Set(
        dificultades.filter((_, i) => i !== indice).map((d) => d.metadata.difficultyName),
      );
      dificultades[indice] = conNombre(chart, nombreLibre(chart.metadata.difficultyName, otros));
      actualizadas += 1;
      continue;
    }

    const usados = new Set(dificultades.map((d) => d.metadata.difficultyName));
    dificultades.push(conNombre(chart, nombreLibre(chart.metadata.difficultyName, usados)));
    agregadas += 1;
  }

  let cancion: CancionGuardada = { ...existente, dificultades };
  let completados = false;
  if (existente.background === undefined && entrante.background !== undefined) {
    cancion = { ...cancion, background: entrante.background };
    completados = true;
  }
  if (existente.video === undefined && entrante.video !== undefined) {
    cancion = { ...cancion, video: entrante.video, videoOffset: entrante.videoOffset ?? 0 };
    completados = true;
  }

  const huboCambios = agregadas > 0 || actualizadas > 0 || completados;
  if (huboCambios && entrante.keysounds !== undefined) {
    cancion = { ...cancion, keysounds: unirKeysounds(existente.keysounds, entrante.keysounds) };
  }
  return {
    cancion: huboCambios ? cancion : existente,
    resumen: {
      estado: huboCambios ? 'actualizada' : 'ya-estaba',
      dificultadesAgregadas: agregadas,
      dificultadesActualizadas: actualizadas,
      archivosCompletados: completados,
    },
  };
}

/** Union-find con compresion de caminos. */
function crearUnion(n: number): { buscar: (i: number) => number; unir: (a: number, b: number) => void } {
  const padre = Array.from({ length: n }, (_, i) => i);
  const buscar = (i: number): number => {
    let raiz = i;
    while (padre[raiz] !== raiz) raiz = padre[raiz]!;
    let actual = i;
    while (padre[actual] !== raiz) {
      const siguiente = padre[actual]!;
      padre[actual] = raiz;
      actual = siguiente;
    }
    return raiz;
  };
  const unir = (a: number, b: number): void => {
    const ra = buscar(a);
    const rb = buscar(b);
    if (ra !== rb) padre[rb] = ra;
  };
  return { buscar, unir };
}

/**
 * D4 sin tocar la base: agrupa las canciones por identidad (clausura
 * transitiva) y arma cada sobreviviente.
 *
 * - Sobreviviente: la de `importadaEn` menor (ausente cuenta como la mas
 *   vieja), desempate por `id` ascendente. Conserva id, titulo, artista,
 *   audio e `importadaEn`.
 * - Se le suman las dificultades de las absorbidas (de la mas vieja a la mas
 *   nueva) que no comparten identidad con las que ya tiene, con la regla de
 *   nombres de D3.
 * - Fondo, video (con su offset) y `conjunto` (T-066, paso 2): los de la
 *   sobreviviente; si no tiene, los de la primera absorbida que los tenga.
 *   `keysounds` (paso 3): se unen, gana la sobreviviente si un nombre choca.
 *
 * Idempotente: sobre el resultado, una segunda corrida no devuelve planes.
 */
export function planearFusiones(canciones: readonly CancionGuardada[]): PlanDeFusion[] {
  const { buscar, unir } = crearUnion(canciones.length);
  const primeraConClave = new Map<string, number>();
  canciones.forEach((cancion, i) => {
    for (const clave of clavesDeCancion(cancion.dificultades)) {
      const j = primeraConClave.get(clave);
      if (j === undefined) primeraConClave.set(clave, i);
      else unir(i, j);
    }
  });

  const grupos = new Map<number, CancionGuardada[]>();
  canciones.forEach((cancion, i) => {
    const raiz = buscar(i);
    const grupo = grupos.get(raiz);
    if (grupo === undefined) grupos.set(raiz, [cancion]);
    else grupo.push(cancion);
  });

  const planes: PlanDeFusion[] = [];
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const ordenadas = [...grupo].sort(masVieja);
    const sobreviviente = ordenadas[0]!;
    const absorbidas = ordenadas.slice(1);

    const dificultades = [...sobreviviente.dificultades];
    const claves = clavesDeCancion(dificultades);
    let resultado: CancionGuardada = sobreviviente;
    for (const absorbida of absorbidas) {
      for (const chart of absorbida.dificultades) {
        const suyas = clavesSeguras(chart);
        if (suyas.some((k) => claves.has(k))) continue;
        const usados = new Set(dificultades.map((d) => d.metadata.difficultyName));
        dificultades.push(conNombre(chart, nombreLibre(chart.metadata.difficultyName, usados)));
        for (const k of suyas) claves.add(k);
      }
      if (absorbida.keysounds !== undefined) {
        resultado = {
          ...resultado,
          keysounds: unirKeysounds(resultado.keysounds, absorbida.keysounds),
        };
      }
      if (resultado.conjunto === undefined && absorbida.conjunto !== undefined) {
        resultado = { ...resultado, conjunto: absorbida.conjunto };
      }
      if (resultado.background === undefined && absorbida.background !== undefined) {
        resultado = { ...resultado, background: absorbida.background };
      }
      if (resultado.video === undefined && absorbida.video !== undefined) {
        resultado = {
          ...resultado,
          video: absorbida.video,
          videoOffset: absorbida.videoOffset ?? 0,
        };
      }
    }

    planes.push({
      resultado: { ...resultado, dificultades },
      absorbidas: [...absorbidas].reverse().map((c) => c.id),
    });
  }
  return planes;
}
