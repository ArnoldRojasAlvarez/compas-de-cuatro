// Logica pura del mapeador (sin DOM ni audio): operaciones sobre las notas,
// historial de deshacer, geometria de la vista, borrador y armado del Chart.
// La pantalla (mapeador.ts) solo dibuja y reenvia eventos a estas funciones,
// y por eso se puede probar casi todo en vitest sin navegador.

import type { Chart, Column, Grilla, HoldNote, Ms, Note, SpeedPoint, TimingPoint } from '@tetra/core';
import { duracionPulso, slotMasCercano, tiempoDeSlot } from '@tetra/core';

// ---------------------------------------------------------------------------
// Notas
// ---------------------------------------------------------------------------

/** Tiempo de una nota en ms enteros: lo que se escribe en el .osu y lo que se juega. */
export function redondear(time: Ms): Ms {
  return Math.round(time);
}

/** Tiempo del slot, ya redondeado a ms entero. */
export function tiempoDeSlotEntero(grilla: Grilla, slot: number): Ms {
  return redondear(tiempoDeSlot(grilla, slot));
}

function finDe(nota: Note): Ms {
  return nota.kind === 'hold' ? nota.endTime : nota.time;
}

function ordenar(notas: readonly Note[]): Note[] {
  return [...notas].sort((a, b) => a.time - b.time || a.column - b.column);
}

/** Nota de `columna` que ocupa el instante `time` (el tap exacto o una larga que lo contiene). */
export function notaEn(notas: readonly Note[], columna: Column, time: Ms, tolerancia = 0.5): Note | undefined {
  return notas.find(
    (n) => n.column === columna && time >= n.time - tolerancia && time <= finDe(n) + tolerancia,
  );
}

/**
 * Pone un tap en (`columna`, `time`). Si ya habia una nota que ocupa ese
 * lugar, la quita (alternar). Devuelve el arreglo nuevo, el original no se toca.
 */
export function alternarTap(notas: readonly Note[], columna: Column, time: Ms): Note[] {
  const t = redondear(time);
  const existente = notaEn(notas, columna, t);
  if (existente) return notas.filter((n) => n !== existente);
  return ordenar([...notas, { kind: 'tap', time: t, column: columna }]);
}

/** Como alternarTap pero nunca quita: lo usa la grabacion en vivo (tocar D F J K mientras suena). */
export function agregarTap(notas: readonly Note[], columna: Column, time: Ms): Note[] {
  const t = redondear(time);
  if (notaEn(notas, columna, t)) return [...notas];
  return ordenar([...notas, { kind: 'tap', time: t, column: columna }]);
}

/**
 * Pone una nota larga entre `inicio` y `fin` (en cualquier orden). Borra lo
 * que hubiera en esa columna dentro del intervalo, para no dejar notas
 * solapadas. Si el intervalo queda vacio se pone un tap.
 */
export function colocarLarga(notas: readonly Note[], columna: Column, inicio: Ms, fin: Ms): Note[] {
  const a = redondear(Math.min(inicio, fin));
  const b = redondear(Math.max(inicio, fin));
  if (b <= a) return alternarTap(notas, columna, a);
  const resto = notas.filter((n) => !(n.column === columna && n.time <= b && finDe(n) >= a));
  const larga: HoldNote = { kind: 'hold', time: a, endTime: b, column: columna };
  return ordenar([...resto, larga]);
}

/** Quita la nota que ocupa (`columna`, `time`), si hay. */
export function quitarNota(notas: readonly Note[], columna: Column, time: Ms): Note[] {
  const existente = notaEn(notas, columna, redondear(time));
  return existente ? notas.filter((n) => n !== existente) : [...notas];
}

/** Quita todas las notas entre `desde` y `hasta` (inclusive). */
export function quitarRango(notas: readonly Note[], desde: Ms, hasta: Ms): Note[] {
  return notas.filter((n) => !(n.time <= hasta && finDe(n) >= desde));
}

/**
 * Espeja las columnas (0<->3, 1<->2): util para variar un patron o para que
 * el automatico no cargue siempre la misma mano.
 */
export function espejar(notas: readonly Note[]): Note[] {
  return notas.map((n) => ({ ...n, column: (3 - n.column) as Column }));
}

export interface ResumenNotas {
  total: number;
  taps: number;
  largas: number;
  /** Notas por segundo promedio, 0 si no hay duracion. */
  nps: number;
  /** Tiempo de la ultima nota, 0 si no hay. */
  finMs: Ms;
}

export function resumirNotas(notas: readonly Note[]): ResumenNotas {
  let largas = 0;
  let finMs = 0;
  let inicio = Infinity;
  for (const n of notas) {
    if (n.kind === 'hold') largas++;
    finMs = Math.max(finMs, finDe(n));
    inicio = Math.min(inicio, n.time);
  }
  const duracion = notas.length === 0 ? 0 : (finMs - inicio) / 1000;
  return {
    total: notas.length,
    taps: notas.length - largas,
    largas,
    nps: duracion > 0 ? notas.length / duracion : 0,
    finMs,
  };
}

// ---------------------------------------------------------------------------
// Seleccion, copiar, pegar y mover (T-034)
// ---------------------------------------------------------------------------
//
// Todo es puro e inmutable: recibe el arreglo de notas y devuelve otro. Cada
// operacion devuelve el resultado completo, asi la pantalla la registra con un
// solo `historial.registrar` y un Ctrl+Z la deshace entera.
//
// Las notas elegidas se identifican por VALOR (`claveNota`), no por identidad
// de objeto: una copia, o la nota de antes de un deshacer, sigue siendo "la
// misma". Dos notas no pueden coincidir en tipo, columna y tiempos, asi que la
// clave es unica dentro de un mapa valido.

/** Rectangulo de seleccion: un rango de tiempo (ambos extremos incluidos) por un conjunto de columnas. */
export interface Seleccion {
  readonly desde: Ms;
  readonly hasta: Ms;
  readonly columnas: readonly Column[];
}

/** Tolerancia al comparar tiempos con los bordes de la seleccion (los tiempos son ms enteros). */
const TOLERANCIA_SELECCION_MS = 0.5;

/** Identidad por valor de una nota. */
export function claveNota(nota: Note): string {
  return nota.kind === 'hold'
    ? `h${nota.column}:${nota.time}:${nota.endTime}`
    : `t${nota.column}:${nota.time}`;
}

/**
 * Notas dentro del rectangulo. Un tap entra si su instante esta en el rango;
 * una larga entra ENTERA si cualquier parte suya toca el rango (una larga que
 * cruza el borde se elige completa: si no, moverla la partiria en dos).
 */
export function notasEnSeleccion(notas: readonly Note[], s: Seleccion): Note[] {
  const desde = Math.min(s.desde, s.hasta) - TOLERANCIA_SELECCION_MS;
  const hasta = Math.max(s.desde, s.hasta) + TOLERANCIA_SELECCION_MS;
  return ordenar(notas.filter((n) => s.columnas.includes(n.column) && n.time <= hasta && finDe(n) >= desde));
}

/** Las notas de `elegidas` que todavia existen en `notas` (tras deshacer, borrar o pegar encima). */
export function elegidasVigentes(notas: readonly Note[], elegidas: readonly Note[]): Note[] {
  const claves = new Set(elegidas.map(claveNota));
  return notas.filter((n) => claves.has(claveNota(n)));
}

/** Quita las notas elegidas. */
export function quitarNotas(notas: readonly Note[], elegidas: readonly Note[]): Note[] {
  const claves = new Set(elegidas.map(claveNota));
  return notas.filter((n) => !claves.has(claveNota(n)));
}

/**
 * Corre `notas` `deltaMs` en el tiempo y `deltaColumnas` de carril. Una larga
 * mueve su inicio y su fin juntos. `null` si alguna nota quedaria fuera de las
 * columnas 0 a 3 o antes del instante 0: se rechaza el movimiento ENTERO (no
 * se recorta) porque recortar apilaria notas en una columna y deformaria el
 * patron sin avisar.
 */
export function desplazarNotas(notas: readonly Note[], deltaMs: Ms, deltaColumnas = 0): Note[] | null {
  const dt = redondear(deltaMs);
  const dc = Math.round(deltaColumnas);
  const salida: Note[] = [];
  for (const n of notas) {
    const columna = n.column + dc;
    const time = n.time + dt;
    if (columna < 0 || columna > 3 || time < 0) return null;
    const column = columna as Column;
    salida.push(n.kind === 'hold' ? { ...n, column, time, endTime: n.endTime + dt } : { ...n, column, time });
  }
  return salida;
}

function pieza(column: Column, inicio: Ms, fin: Ms): Note {
  return fin > inicio ? { kind: 'hold', time: inicio, endTime: fin, column } : { kind: 'tap', time: inicio, column };
}

/**
 * Pone `nuevas` encima de `base`. Donde una nueva ocupa tiempo en una columna,
 * lo que habia ahi se reemplaza SOLO en ese intervalo: un tap desaparece, una
 * larga se recorta (o queda partida en dos si la nueva cae en el medio). Las
 * notas de otras columnas o de otros instantes no se tocan, y nunca queda un
 * solapamiento. Entre las propias `nuevas` gana la primera en el tiempo.
 */
function colocarEncima(base: readonly Note[], nuevas: readonly Note[]): Note[] {
  const porColumna: Note[][] = [[], [], [], []];
  const aceptadas: Note[] = [];
  for (const n of ordenar(nuevas)) {
    const lista = porColumna[n.column]!;
    const ultima = lista[lista.length - 1];
    if (ultima && finDe(ultima) >= n.time) continue;
    lista.push(n);
    aceptadas.push(n);
  }
  const salida: Note[] = [...aceptadas];
  for (const n of base) {
    const lista = porColumna[n.column]!;
    const fin = finDe(n);
    // Primera nueva cuyo fin llega al inicio de `n`: sin solapes entre las
    // nuevas, ordenadas por inicio tambien lo estan por fin (busqueda binaria).
    let a = 0;
    let b = lista.length;
    while (a < b) {
      const medio = (a + b) >> 1;
      if (finDe(lista[medio]!) >= n.time) b = medio;
      else a = medio + 1;
    }
    if (a >= lista.length || lista[a]!.time > fin) {
      salida.push(n);
      continue;
    }
    let cursor = n.time;
    for (let j = a; j < lista.length && lista[j]!.time <= fin; j++) {
      const m = lista[j]!;
      if (m.time - 1 >= cursor) salida.push(pieza(n.column, cursor, m.time - 1));
      cursor = Math.max(cursor, finDe(m) + 1);
    }
    if (cursor <= fin) salida.push(pieza(n.column, cursor, fin));
  }
  return ordenar(salida);
}

/**
 * Mueve las notas elegidas `deltaMs` en el tiempo y `deltaColumnas` de carril.
 * Si caen sobre notas que no estaban elegidas, las reemplazan en el intervalo
 * que ocupan. Si algo quedaria fuera de las pistas o antes del instante 0 no
 * se mueve nada y se devuelve una copia igual (ver `desplazarNotas`).
 */
export function moverNotas(
  notas: readonly Note[],
  elegidas: readonly Note[],
  deltaMs: Ms,
  deltaColumnas = 0,
): Note[] {
  const vigentes = elegidasVigentes(notas, elegidas);
  const movidas = desplazarNotas(vigentes, deltaMs, deltaColumnas);
  if (!movidas || movidas.length === 0) return [...notas];
  return colocarEncima(quitarNotas(notas, vigentes), movidas);
}

export interface Portapapeles {
  /** Notas con el tiempo relativo al origen de la copia (0 = el origen). */
  readonly notas: readonly Note[];
  /** Largo de lo copiado: hasta donde llega la ultima nota o la seleccion. */
  readonly duracion: Ms;
}

/**
 * Copia con tiempos relativos. El origen es `opciones.origen` (el borde
 * izquierdo de la seleccion, para que un compas copiado con silencio al
 * principio se pegue alineado) o, si no se da, la primera nota. `duracion` es
 * `opciones.duracion` o, si no se da, hasta el fin de la ultima nota.
 */
export function copiarNotas(
  elegidas: readonly Note[],
  opciones: { readonly origen?: Ms; readonly duracion?: Ms } = {},
): Portapapeles {
  if (elegidas.length === 0) return { notas: [], duracion: opciones.duracion ?? 0 };
  let primero = Infinity;
  for (const n of elegidas) primero = Math.min(primero, n.time);
  const origen = opciones.origen ?? primero;
  const notas = ordenar(
    elegidas.map((n) =>
      n.kind === 'hold' ? { ...n, time: n.time - origen, endTime: n.endTime - origen } : { ...n, time: n.time - origen },
    ),
  );
  let fin = 0;
  for (const n of notas) fin = Math.max(fin, finDe(n));
  return { notas, duracion: opciones.duracion ?? fin };
}

/**
 * Pega el portapapeles con su origen en `enMs`. Reemplaza lo que haya en la
 * misma columna solo en el intervalo ocupado. Si alguna nota caeria antes del
 * instante 0 no pega nada y devuelve una copia igual.
 */
export function pegarNotas(
  notas: readonly Note[],
  portapapeles: { readonly notas: readonly Note[] },
  enMs: Ms,
): Note[] {
  const colocadas = desplazarNotas(portapapeles.notas, enMs);
  if (!colocadas || colocadas.length === 0) return [...notas];
  return colocarEncima(notas, colocadas);
}

/**
 * Las notas elegidas ajustadas al slot mas cercano de la grilla. El inicio y
 * el fin de una larga se ajustan por separado; si la larga se queda sin largo
 * pasa a ser un tap.
 */
export function cuantizadas(elegidas: readonly Note[], g: Grilla): Note[] {
  return elegidas.map((n): Note => {
    const time = tiempoDeSlotEntero(g, slotMasCercano(g, n.time));
    if (n.kind === 'tap') return { ...n, time };
    const endTime = tiempoDeSlotEntero(g, slotMasCercano(g, n.endTime));
    return endTime > time ? { ...n, time, endTime } : { kind: 'tap', time, column: n.column };
  });
}

/**
 * Ajusta las notas elegidas a la grilla actual. Si dos quedan en el mismo
 * lugar de una columna, se queda la primera en el tiempo.
 */
export function cuantizarNotas(notas: readonly Note[], elegidas: readonly Note[], g: Grilla): Note[] {
  const vigentes = elegidasVigentes(notas, elegidas);
  if (vigentes.length === 0) return [...notas];
  return colocarEncima(quitarNotas(notas, vigentes), cuantizadas(vigentes, g));
}

/** True si alguna nota termina despues de `maxMs` (el final de la cancion). */
export function pasaDelFinal(notas: readonly Note[], maxMs: Ms): boolean {
  return notas.some((n) => finDe(n) > maxMs);
}

// ---------------------------------------------------------------------------
// Historial (deshacer / rehacer)
// ---------------------------------------------------------------------------

export interface Historial<T> {
  readonly actual: T;
  readonly puedeDeshacer: boolean;
  readonly puedeRehacer: boolean;
  /** Registra un estado nuevo. Si es identico (===) al actual no hace nada. */
  registrar(estado: T): void;
  deshacer(): T;
  rehacer(): T;
}

/** Historial acotado: guarda como mucho `limite` estados hacia atras. */
export function crearHistorial<T>(inicial: T, limite = 200): Historial<T> {
  const pasado: T[] = [];
  let futuro: T[] = [];
  let actual = inicial;
  return {
    get actual() {
      return actual;
    },
    get puedeDeshacer() {
      return pasado.length > 0;
    },
    get puedeRehacer() {
      return futuro.length > 0;
    },
    registrar(estado) {
      if (estado === actual) return;
      pasado.push(actual);
      if (pasado.length > limite) pasado.shift();
      futuro = [];
      actual = estado;
    },
    deshacer() {
      const previo = pasado.pop();
      if (previo !== undefined) {
        futuro.push(actual);
        actual = previo;
      }
      return actual;
    },
    rehacer() {
      const siguiente = futuro.pop();
      if (siguiente !== undefined) {
        pasado.push(actual);
        actual = siguiente;
      }
      return actual;
    },
  };
}

// ---------------------------------------------------------------------------
// Vista: tiempo <-> pixel
// ---------------------------------------------------------------------------

export interface Vista {
  /** Tiempo (ms) que esta justo sobre la linea del cabezal. */
  tiempo: Ms;
  /** Pixeles por ms: el zoom. */
  pxPorMs: number;
  /** Y (px) de la linea del cabezal. El futuro queda arriba, como en la partida. */
  yCabezal: number;
}

export const ZOOM_MIN = 0.08;
export const ZOOM_MAX = 1.2;

export function limitarZoom(pxPorMs: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pxPorMs));
}

export function yDeTiempo(vista: Vista, time: Ms): number {
  return vista.yCabezal - (time - vista.tiempo) * vista.pxPorMs;
}

export function tiempoDeY(vista: Vista, y: number): Ms {
  return vista.tiempo + (vista.yCabezal - y) / vista.pxPorMs;
}

/** Columna bajo la coordenada x, o `null` si cae fuera de las cuatro pistas. */
export function columnaDeX(x: number, izquierda: number, anchoColumna: number): Column | null {
  const indice = Math.floor((x - izquierda) / anchoColumna);
  return indice >= 0 && indice < 4 ? (indice as Column) : null;
}

/** Slot al que apunta el mouse en `y`, ajustado a la grilla. */
export function slotDeY(vista: Vista, grilla: Grilla, y: number): number {
  return slotMasCercano(grilla, tiempoDeY(vista, y));
}

// ---------------------------------------------------------------------------
// Onda de audio
// ---------------------------------------------------------------------------

/**
 * Picos de amplitud por cubeta de `msPorCubeta`: lo que se dibuja como onda
 * detras de las pistas. Una cubeta guarda el maximo de |muestra| (0 a 1).
 */
export function calcularPicos(muestras: Float32Array, sampleRate: number, msPorCubeta: Ms): Float32Array {
  const porCubeta = Math.max(1, Math.round((sampleRate * msPorCubeta) / 1000));
  const cubetas = Math.ceil(muestras.length / porCubeta);
  const picos = new Float32Array(cubetas);
  for (let c = 0; c < cubetas; c++) {
    let max = 0;
    const fin = Math.min(muestras.length, (c + 1) * porCubeta);
    for (let i = c * porCubeta; i < fin; i++) {
      const v = Math.abs(muestras[i]!);
      if (v > max) max = v;
    }
    picos[c] = max;
  }
  return picos;
}

/** Mezcla un audio de varios canales a mono (promedio). */
export function mezclarMono(canales: readonly Float32Array[]): Float32Array {
  const primero = canales[0];
  if (!primero) return new Float32Array(0);
  if (canales.length === 1) return primero;
  const mono = new Float32Array(primero.length);
  for (const canal of canales) {
    for (let i = 0; i < mono.length; i++) mono[i]! += canal[i]! / canales.length;
  }
  return mono;
}

// ---------------------------------------------------------------------------
// Minimapa (T-046)
// ---------------------------------------------------------------------------

/** Una cubeta de la franja del minimapa: un tramo de la cancion de `duracion / ancho` ms. */
export interface CubetaVista {
  /** Notas que EMPIEZAN dentro de la cubeta (cuenta cruda; la pantalla la normaliza al dibujar). */
  densidadNotas: number;
  /** Energia del audio en la cubeta, de 0 a 1 respecto de la cubeta mas fuerte de la cancion. */
  energia: number;
  hayNotas: boolean;
}

/**
 * Resume la cancion en `ancho` cubetas iguales. Las notas se asignan a su
 * cubeta POR TIEMPO (no por posicion en la lista). La energia es el promedio
 * de los picos de audio que caen en la cubeta (el promedio sigue los pasajes
 * fuertes y suaves; el maximo dejaria toda la franja al tope), normalizado por
 * la cubeta mas fuerte. Si no hay audio, o `ancho` es mayor que la cantidad de
 * picos, las cubetas de energia que no tengan dato valen 0, nunca NaN.
 * Sin duracion (o con `ancho` 0) no hay nada que repartir: `ancho` cubetas
 * vacias, o `[]` si `ancho` no es positivo.
 */
export function resumirParaMinimapa(
  notas: readonly Note[],
  picos: Float32Array,
  msPorCubetaPicos: Ms,
  duracionMs: Ms,
  ancho: number,
): CubetaVista[] {
  const n = Math.floor(ancho);
  if (!(n > 0)) return [];
  const cubetas: CubetaVista[] = Array.from({ length: n }, () => ({
    densidadNotas: 0,
    energia: 0,
    hayNotas: false,
  }));
  if (!(duracionMs > 0)) return cubetas;
  const msPorCubeta = duracionMs / n;

  for (const nota of notas) {
    if (!Number.isFinite(nota.time)) continue;
    const i = Math.min(n - 1, Math.max(0, Math.floor(nota.time / msPorCubeta)));
    const c = cubetas[i]!;
    c.densidadNotas++;
    c.hayNotas = true;
  }

  if (picos.length > 0 && msPorCubetaPicos > 0) {
    let maximo = 0;
    for (let i = 0; i < n; i++) {
      const primero = Math.floor((i * msPorCubeta) / msPorCubetaPicos);
      if (primero >= picos.length) continue;
      const ultimo = Math.min(
        picos.length - 1,
        Math.max(primero, Math.ceil(((i + 1) * msPorCubeta) / msPorCubetaPicos) - 1),
      );
      let suma = 0;
      for (let k = primero; k <= ultimo; k++) suma += picos[k]!;
      const promedio = suma / (ultimo - primero + 1);
      cubetas[i]!.energia = promedio;
      if (promedio > maximo) maximo = promedio;
    }
    if (maximo > 0) for (const c of cubetas) c.energia /= maximo;
    else for (const c of cubetas) c.energia = 0;
  }
  return cubetas;
}

/**
 * Tramos de la cancion sin ninguna nota (ni larga sostenida) que duran MAS de
 * `minimoMs`, incluidos el principio y el final. Sin notas no se marca nada:
 * un mapa vacio no tiene "huecos", tiene todo por mapear.
 */
export function huecosSinNotas(
  notas: readonly Note[],
  duracionMs: Ms,
  minimoMs: Ms,
): { desde: Ms; hasta: Ms }[] {
  if (notas.length === 0 || !(duracionMs > 0)) return [];
  const huecos: { desde: Ms; hasta: Ms }[] = [];
  let cursor = 0;
  for (const n of ordenar(notas)) {
    if (n.time - cursor > minimoMs) huecos.push({ desde: cursor, hasta: n.time });
    cursor = Math.max(cursor, finDe(n));
  }
  if (duracionMs - cursor > minimoMs) huecos.push({ desde: cursor, hasta: duracionMs });
  return huecos;
}

/**
 * Marcas de compas del minimapa: una cada `cadaCompases` compases a partir del
 * offset de la grilla (el compas 1), con su numero de compas. Vacio si el BPM no es valido.
 */
export function marcasDeCompas(
  grilla: Grilla,
  duracionMs: Ms,
  cadaCompases = 8,
  pulsosPorCompas = 4,
): { time: Ms; compas: number }[] {
  const paso = cadaCompases * pulsosPorCompas * duracionPulso(grilla.bpm);
  if (!(paso > 0) || !Number.isFinite(paso) || !Number.isFinite(grilla.offsetMs) || !(duracionMs > 0)) return [];
  const marcas: { time: Ms; compas: number }[] = [];
  for (let k = Math.ceil(-grilla.offsetMs / paso); ; k++) {
    const time = grilla.offsetMs + k * paso;
    if (time > duracionMs) break;
    marcas.push({ time, compas: k * cadaCompases + 1 });
  }
  return marcas;
}

/** Instante al que apunta la posicion `x` (px) de una franja de `ancho` px que muestra toda la cancion. */
export function tiempoDeXMinimapa(x: number, ancho: number, duracionMs: Ms): Ms {
  if (!(ancho > 0) || !(duracionMs > 0)) return 0;
  return Math.min(1, Math.max(0, x / ancho)) * duracionMs;
}

/** Posicion (px) de un instante en la franja; se recorta a los bordes. */
export function xDeTiempoMinimapa(time: Ms, ancho: number, duracionMs: Ms): number {
  if (!(ancho > 0) || !(duracionMs > 0)) return 0;
  return Math.min(1, Math.max(0, time / duracionMs)) * ancho;
}

// ---------------------------------------------------------------------------
// Chart y borrador
// ---------------------------------------------------------------------------

export interface MetadatosMapa {
  titulo: string;
  artista: string;
  creador: string;
  dificultad: string;
  audioArchivo: string;
}

export interface AjustesMapa {
  overallDifficulty: number;
  hpDrain: number;
}

/** Puntos de tempo y de velocidad de una dificultad que se esta editando (el editor todavia no los edita). */
export interface PuntosOriginales {
  timingPoints: readonly TimingPoint[];
  speedPoints: readonly SpeedPoint[];
}

/**
 * Puntos de tempo del chart. El editor edita un solo tempo (la grilla), que
 * pasa a ser el primer punto; si la dificultad original traia mas, se
 * conservan tal cual detras del primero (no se pierden al guardar).
 */
export function puntosDeTiempo(grilla: Grilla, original?: readonly TimingPoint[]): TimingPoint[] {
  const primero: TimingPoint = {
    time: redondear(grilla.offsetMs),
    bpm: grilla.bpm,
    meter: original?.[0]?.meter ?? 4,
  };
  return [primero, ...(original?.slice(1) ?? [])];
}

/**
 * Arma el Chart que se juega y se exporta. Los tiempos salen en ms enteros y
 * ordenados. `original` es lo que traia la dificultad si se abrio de la
 * biblioteca: sus puntos de velocidad y los tempos posteriores al primero se
 * conservan.
 */
export function construirChart(
  meta: MetadatosMapa,
  grilla: Grilla,
  ajustes: AjustesMapa,
  notas: readonly Note[],
  previewTime: Ms = 0,
  original?: PuntosOriginales,
): Chart {
  const enteras = ordenar(
    notas.map((n) =>
      n.kind === 'hold'
        ? { ...n, time: redondear(n.time), endTime: redondear(n.endTime) }
        : { ...n, time: redondear(n.time) },
    ),
  );
  return {
    metadata: {
      title: meta.titulo.trim() || 'Sin título',
      artist: meta.artista.trim() || 'Desconocido',
      creator: meta.creador.trim() || 'Anónimo',
      difficultyName: meta.dificultad.trim() || 'Normal',
      audioFile: meta.audioArchivo,
      previewTime: redondear(previewTime),
    },
    overallDifficulty: ajustes.overallDifficulty,
    hpDrain: ajustes.hpDrain,
    timingPoints: puntosDeTiempo(grilla, original?.timingPoints),
    speedPoints: [...(original?.speedPoints ?? [])],
    notes: enteras,
  };
}

export interface Borrador {
  version: 1;
  meta: MetadatosMapa;
  grilla: Grilla;
  ajustes: AjustesMapa;
  notas: Note[];
}

const CLAVE_BORRADOR = 'tetra:mapeador-borrador';

export function guardarBorrador(borrador: Borrador, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(CLAVE_BORRADOR, JSON.stringify(borrador));
    return true;
  } catch {
    return false;
  }
}

function esNota(valor: unknown): valor is Note {
  if (typeof valor !== 'object' || valor === null) return false;
  const n = valor as Record<string, unknown>;
  const columnaValida =
    typeof n.column === 'number' && Number.isInteger(n.column) && n.column >= 0 && n.column <= 3;
  if (!columnaValida || typeof n.time !== 'number' || !Number.isFinite(n.time)) return false;
  if (n.kind === 'tap') return true;
  return (
    n.kind === 'hold' &&
    typeof n.endTime === 'number' &&
    Number.isFinite(n.endTime) &&
    n.endTime > n.time
  );
}

/** Lee el borrador. `null` si no hay, si no es JSON o si no tiene la forma esperada. */
export function leerBorrador(storage: Storage = localStorage): Borrador | null {
  let crudo: string | null;
  try {
    crudo = storage.getItem(CLAVE_BORRADOR);
  } catch {
    return null;
  }
  if (crudo === null) return null;
  try {
    const v = JSON.parse(crudo) as Partial<Borrador> | null;
    if (!v || v.version !== 1 || !v.meta || !v.grilla || !v.ajustes || !Array.isArray(v.notas)) return null;
    const g = v.grilla;
    if (!Number.isFinite(g.bpm) || g.bpm <= 0 || !Number.isFinite(g.offsetMs) || !(g.divisor > 0)) return null;
    if (!v.notas.every(esNota)) return null;
    return v as Borrador;
  } catch {
    return null;
  }
}

export function borrarBorrador(storage: Storage = localStorage): void {
  try {
    storage.removeItem(CLAVE_BORRADOR);
  } catch {
    // sin almacenamiento no hay borrador que borrar.
  }
}

/** Convierte un numero escrito por el usuario; `null` si no es un numero finito. */
export function leerNumero(texto: string): number | null {
  const v = Number(texto.trim().replace(',', '.'));
  return texto.trim() !== '' && Number.isFinite(v) ? v : null;
}
