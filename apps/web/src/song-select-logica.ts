// T-011: la parte del song select que no depende del DOM, para poder
// testearla sin navegador (mismo criterio que cargador-logica.ts: la
// pantalla en si es UI, esto es logica pura que si vale la pena testear).
//
// Dos familias de funciones:
//
//  - Sobre un Chart individual (una dificultad): BPM, duracion, densidad
//    provisional. El ticket es explicito en que el star rating NO se
//    calcula aca (fase 4): `densidadNotasPorSegundo` es un numero
//    provisional (notas por segundo), no un reemplazo de estrellas.
//  - Sobre una lista de CancionGuardada: filtrar (buscar), ordenar y
//    elegir un indice al azar. Todas puras (reciben datos, devuelven
//    datos) para poder testearlas sin @tetra/storage ni IndexedDB.

import type { CancionGuardada } from '@tetra/storage';
import type { Chart, Ms } from '@tetra/core';
import { isHold } from '@tetra/core';

// ---------------------------------------------------------------------------
// Datos de una dificultad (Chart individual)
// ---------------------------------------------------------------------------

/**
 * Ultimo instante que la dificultad ocupa: el final de la ultima nota (el
 * `endTime` si es hold, si no su `time`), o el ultimo timing point si por
 * algun motivo cae mas tarde (mapa sin notas, por ejemplo). No asume que
 * `chart.notes` venga ordenado por `time` descendente en ningun sentido
 * util para esto (el invariante de Chart es ascendente, ver types.ts), asi
 * que recorre todo el arreglo en vez de mirar solo el ultimo elemento.
 */
export function duracionMs(chart: Chart): Ms {
  let fin = 0;
  for (const nota of chart.notes) {
    const finDeNota = isHold(nota) ? nota.endTime : nota.time;
    if (finDeNota > fin) fin = finDeNota;
  }
  for (const punto of chart.timingPoints) {
    if (punto.time > fin) fin = punto.time;
  }
  return fin;
}

/**
 * El BPM "principal" de la dificultad, para mostrar un solo numero en el
 * detalle (el ticket pide "BPM" a secas, no el historial completo de
 * cambios de tempo). Con un solo TimingPoint no hay ambiguedad. Con varios,
 * se elige el que estuvo vigente mas tiempo (duracion de cada tramo
 * ponderada), no el primero ni un promedio simple: un mapa con un tramo
 * corto a 300 BPM y el resto a 120 BPM "es" un mapa de 120, no de 300 ni de
 * 210 de promedio.
 */
export function bpmPrincipal(chart: Chart): number {
  const puntos = [...chart.timingPoints].sort((a, b) => a.time - b.time);
  if (puntos.length === 0) return 0;
  if (puntos.length === 1) return puntos[0]!.bpm;

  const fin = duracionMs(chart);
  const duracionPorBpm = new Map<number, number>();
  for (let i = 0; i < puntos.length; i++) {
    const actual = puntos[i]!;
    const siguiente = puntos[i + 1];
    const finDelTramo = siguiente ? siguiente.time : Math.max(fin, actual.time);
    const duracionDelTramo = Math.max(0, finDelTramo - actual.time);
    duracionPorBpm.set(actual.bpm, (duracionPorBpm.get(actual.bpm) ?? 0) + duracionDelTramo);
  }

  let mejorBpm = puntos[0]!.bpm;
  let mejorDuracion = -1;
  for (const [bpm, duracion] of duracionPorBpm) {
    if (duracion > mejorDuracion) {
      mejorDuracion = duracion;
      mejorBpm = bpm;
    }
  }
  return mejorBpm;
}

/** Cantidad de notas largas (hold) de la dificultad. */
export function contarNotasLargas(chart: Chart): number {
  return chart.notes.filter(isHold).length;
}

/**
 * Densidad provisional: notas por segundo, para dar una nocion de
 * dificultad relativa MIENTRAS no exista el motor de siete skillsets (fase
 * 4, fuera de alcance de este ticket: ver el ticket, "El star rating queda
 * para la fase 4"). Quien la muestra tiene que marcarla como provisional;
 * esta funcion solo calcula el numero.
 */
export function densidadNotasPorSegundo(chart: Chart): number {
  const segundos = duracionMs(chart) / 1000;
  if (segundos <= 0) return 0;
  return chart.notes.length / segundos;
}

/** "3:41" a partir de milisegundos. Redondea al segundo, no trunca (3:40.9 se ve como 3:41, no 3:40). */
export function formatearDuracion(ms: Ms): string {
  const totalSegundos = Math.max(0, Math.round(ms / 1000));
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${minutos}:${String(segundos).padStart(2, '0')}`;
}

/** Todos los datos del detalle de una dificultad, ya calculados, listos para volcar en el panel. */
export interface InfoDeDificultad {
  nombre: string;
  creador: string;
  bpm: number;
  duracionMs: Ms;
  notas: number;
  notasLargas: number;
  overallDifficulty: number;
  hpDrain: number;
  densidadNotasPorSegundo: number;
}

export function calcularInfoDeDificultad(chart: Chart): InfoDeDificultad {
  return {
    nombre: chart.metadata.difficultyName,
    creador: chart.metadata.creator,
    bpm: bpmPrincipal(chart),
    duracionMs: duracionMs(chart),
    notas: chart.notes.length,
    notasLargas: contarNotasLargas(chart),
    overallDifficulty: chart.overallDifficulty,
    hpDrain: chart.hpDrain,
    densidadNotasPorSegundo: densidadNotasPorSegundo(chart),
  };
}

// ---------------------------------------------------------------------------
// Lista de canciones: buscar, ordenar, aleatorio
// ---------------------------------------------------------------------------

/** BPM "de la cancion" para ordenar por BPM: el de su primera dificultad (en el orden en que se guardaron). Sin dificultades (no deberia pasar, ver CancionGuardada) da 0. */
function bpmDeCancion(cancion: CancionGuardada): number {
  const primera = cancion.dificultades[0];
  return primera ? bpmPrincipal(primera) : 0;
}

// ---------------------------------------------------------------------------
// Estrellas (T-014): el resultado de calcularDificultad vive afuera de
// CancionGuardada (se calcula aparte, en un worker, y se cachea, ver
// dificultad-logica.ts y dificultad-worker-cliente.ts), asi que estas
// funciones reciben `obtenerEstrellas` inyectado en vez de leerlo de un
// campo del Chart. Mismo patron que `elegirIndiceAleatorio` con
// `aleatorio` inyectable: la logica de ordenar/filtrar queda pura y
// testeable sin worker ni IndexedDB.
// ---------------------------------------------------------------------------

/** Da la estrella global ya calculada de un Chart, o undefined si todavia no se calculo (ver dificultad-logica.ts, "calculando"). */
export type ObtenerEstrellas = (chart: Chart) => number | undefined;

/**
 * Estrella "de la cancion", para ordenar/filtrar la lista: el maximo entre
 * las estrellas YA calculadas de sus dificultades (las que faltan por
 * calcular no cuentan como 0 "de verdad", pero tampoco pueden ser
 * `undefined` para un `Math.max`, asi que se ignoran del maximo en vez de
 * tratarse como la dificultad mas facil). Sin ninguna dificultad calculada
 * todavia, da 0.
 */
export function estrellasDeCancion(cancion: CancionGuardada, obtenerEstrellas: ObtenerEstrellas): number {
  let maximo = 0;
  for (const dificultad of cancion.dificultades) {
    const estrellas = obtenerEstrellas(dificultad);
    if (estrellas !== undefined && estrellas > maximo) maximo = estrellas;
  }
  return maximo;
}

/** T-022: nivel de color de una estrella (en CSS, la clase `tetra-estrella-<nivel>`). */
export type NivelEstrellas = 'facil' | 'normal' | 'dificil' | 'insano' | 'experto' | 'extremo';

/**
 * T-022: nivel de color de una estrella global. Cortes: menos de 2 es
 * facil, menos de 3 normal, menos de 4 dificil, menos de 5 insano, menos de
 * 6.5 experto, el resto extremo. NaN o negativo caen en 'facil' (todas las
 * comparaciones con NaN dan false, asi que hay que mirarlo aparte, igual
 * que un valor negativo, que "no puede" ser mas dificil que facil).
 */
export function nivelDeEstrellas(estrellas: number): NivelEstrellas {
  if (!(estrellas >= 2)) return 'facil'; // incluye NaN y negativos
  if (estrellas < 3) return 'normal';
  if (estrellas < 4) return 'dificil';
  if (estrellas < 5) return 'insano';
  if (estrellas < 6.5) return 'experto';
  return 'extremo';
}

/**
 * Filtra por rango de estrellas (ver el ticket, "filtrar por rango de
 * estrellas"). `minimo`/`maximo` en `null` quiere decir "sin cota de ese
 * lado"; los dos en `null` (el estado inicial del filtro) devuelve la
 * lista completa sin filtrar, igual que `filtrarCanciones` con consulta
 * vacia. El rango es inclusivo en los dos extremos.
 */
export function filtrarPorRangoDeEstrellas(
  canciones: readonly CancionGuardada[],
  minimo: number | null,
  maximo: number | null,
  obtenerEstrellas: ObtenerEstrellas,
): CancionGuardada[] {
  if (minimo === null && maximo === null) return [...canciones];
  return canciones.filter((cancion) => {
    const estrellas = estrellasDeCancion(cancion, obtenerEstrellas);
    if (minimo !== null && estrellas < minimo) return false;
    if (maximo !== null && estrellas > maximo) return false;
    return true;
  });
}

/**
 * Filtra por titulo o artista, sin distinguir mayusculas/minusculas. La
 * consulta vacia (o solo espacios) devuelve la lista completa, sin filtrar:
 * es el estado inicial del buscador, no "ninguna coincidencia".
 */
export function filtrarCanciones(
  canciones: readonly CancionGuardada[],
  consulta: string,
): CancionGuardada[] {
  const normalizada = consulta.trim().toLowerCase();
  if (normalizada === '') return [...canciones];
  return canciones.filter(
    (cancion) =>
      cancion.titulo.toLowerCase().includes(normalizada) ||
      cancion.artista.toLowerCase().includes(normalizada),
  );
}

export type CriterioDeOrden = 'titulo' | 'bpm' | 'estrellas';

/**
 * Ordena SIN mutar la lista de entrada (devuelve una copia nueva).
 * `obtenerEstrellas` solo hace falta para el criterio 'estrellas' (ver
 * `estrellasDeCancion`); tiene default para no romper a quien ya llamaba
 * esta funcion con dos argumentos antes de T-014.
 */
export function ordenarCanciones(
  canciones: readonly CancionGuardada[],
  criterio: CriterioDeOrden,
  obtenerEstrellas: ObtenerEstrellas = () => undefined,
): CancionGuardada[] {
  const copia = [...canciones];
  if (criterio === 'titulo') {
    copia.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es', { sensitivity: 'base' }));
  } else if (criterio === 'bpm') {
    copia.sort((a, b) => bpmDeCancion(a) - bpmDeCancion(b));
  } else {
    copia.sort(
      (a, b) => estrellasDeCancion(a, obtenerEstrellas) - estrellasDeCancion(b, obtenerEstrellas),
    );
  }
  return copia;
}

/**
 * Indice al azar dentro de `[0, total)`, evitando `excluir` cuando sea
 * posible (para que el boton de aleatorio no vuelva a caer en la cancion ya
 * enfocada si hay otra para elegir). `aleatorio` es inyectable (default
 * `Math.random`) para poder testear con valores deterministicos, mismo
 * patron que `storage`/`localStorage` en offset.ts y velocidad.ts.
 *
 * Sin bucles ni reintentos: se sortea dentro de `total - 1` posiciones
 * (todas menos la excluida) y se "salta" el hueco de `excluir` corriendo
 * el indice una posicion si cae en o despues de el. Es deliberado: un
 * `do { } while (indice === excluir)` con un `aleatorio` de prueba mal
 * elegido podria no terminar nunca; esta forma siempre termina.
 */
export function elegirIndiceAleatorio(
  total: number,
  excluir: number | null = null,
  aleatorio: () => number = Math.random,
): number | null {
  if (total <= 0) return null;
  if (total === 1 || excluir === null) {
    return Math.min(total - 1, Math.max(0, Math.floor(aleatorio() * total)));
  }
  const disponibles = total - 1;
  let indice = Math.min(disponibles - 1, Math.max(0, Math.floor(aleatorio() * disponibles)));
  if (indice >= excluir) indice += 1;
  return indice;
}

// ---------------------------------------------------------------------------
// T-052: linea de datos, barra de progreso del preview, foco tras borrar
// ---------------------------------------------------------------------------

/** Menor y mayor BPM de la dificultad (redondeados). Sin timing points da 0 y 0. */
export function rangoBpm(chart: Chart): { minimo: number; maximo: number } {
  if (chart.timingPoints.length === 0) return { minimo: 0, maximo: 0 };
  let minimo = Number.POSITIVE_INFINITY;
  let maximo = Number.NEGATIVE_INFINITY;
  for (const punto of chart.timingPoints) {
    if (punto.bpm < minimo) minimo = punto.bpm;
    if (punto.bpm > maximo) maximo = punto.bpm;
  }
  return { minimo: Math.round(minimo), maximo: Math.round(maximo) };
}

/** "128" si el tempo no cambia, "120-180" si varia (con los valores ya redondeados: 120.2 y 119.8 dan "120"). */
export function formatearBpm(chart: Chart): string {
  const { minimo, maximo } = rangoBpm(chart);
  return minimo === maximo ? String(minimo) : `${minimo}-${maximo}`;
}

/** La linea de datos del detalle: "Creador · 128 BPM · 1:20 · 340 notas". */
export function formatearLineaDeDatos(chart: Chart): string {
  const partes = [
    chart.metadata.creator.trim(),
    `${formatearBpm(chart)} BPM`,
    formatearDuracion(duracionMs(chart)),
    `${chart.notes.length} notas`,
  ];
  return partes.filter((parte) => parte !== '').join(' · ');
}

/**
 * Que fraccion (0 a 1) de la barra de progreso cayo bajo un clic. `izquierda`
 * y `ancho` son las del rectangulo de la barra; fuera de la barra se recorta a
 * los extremos, y una barra sin ancho (aun sin layout) da 0 en vez de NaN.
 */
export function fraccionDeClic(clienteX: number, izquierda: number, ancho: number): number {
  if (!(ancho > 0)) return 0;
  return Math.min(1, Math.max(0, (clienteX - izquierda) / ancho));
}

/**
 * Posicion del preview (segundos dentro del audio) a partir del reloj de SU
 * propio AudioContext: arranco en `offsetS` cuando ese reloj marcaba
 * `inicioCtxS`, y el audio esta en bucle, asi que la posicion da la vuelta al
 * llegar a `duracionS`. No usa performance.now: si el contexto se suspende
 * (pausa), `ahoraCtxS` se congela y la posicion tambien.
 */
export function posicionDePreviewSegundos(
  offsetS: number,
  inicioCtxS: number,
  ahoraCtxS: number,
  duracionS: number,
): number {
  if (!(duracionS > 0)) return 0;
  const transcurrido = Math.max(0, ahoraCtxS - inicioCtxS);
  return (offsetS + transcurrido) % duracionS;
}

/** Posicion sobre duracion, recortada a 0..1 (duracion 0 da 0). */
export function fraccionDePosicion(posicionS: number, duracionS: number): number {
  if (!(duracionS > 0)) return 0;
  return Math.min(1, Math.max(0, posicionS / duracionS));
}

/**
 * A que cancion pasa el foco cuando se borra `borradoId` de la lista visible
 * `ids`: la que queda en su lugar (la siguiente), o la anterior si era la
 * ultima. `null` si no queda ninguna (o el id no estaba en la lista).
 */
export function idTrasBorrar(ids: readonly string[], borradoId: string): string | null {
  const indice = ids.indexOf(borradoId);
  if (indice === -1) return null;
  return ids[indice + 1] ?? ids[indice - 1] ?? null;
}

/**
 * Mueve un indice `delta` posiciones dentro de `[0, total)` sin dar la vuelta
 * (se detiene en los extremos). Sin elementos da -1. Con `actual` en -1 (nada
 * enfocado) un delta positivo cae en el primero y uno negativo en el ultimo.
 */
export function moverIndice(actual: number, total: number, delta: number): number {
  if (total <= 0) return -1;
  const base = actual < 0 ? (delta > 0 ? -1 : total) : actual;
  return Math.min(total - 1, Math.max(0, base + delta));
}
