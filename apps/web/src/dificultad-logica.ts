// T-014: la parte de "estrellas en el song select" que no depende del DOM
// ni de un Worker de verdad, para poder testearla sin navegador (mismo
// criterio que song-select-logica.ts y cargador-logica.ts).
//
// Tres piezas, cada una probada por separado:
//
//  - `claveDeDificultad`: arma la clave de cache (hash del mapa + version
//    del modelo). Pura.
//  - `ColaConPrioridad`: el orden en que se despachan los calculos al
//    worker, con la dificultad en foco adelantandose a las demas (ver el
//    ticket, "Parte A"). Pura, sin Worker real: solo maneja un arreglo.
//  - `obtenerDificultad`: la cache-o-calcula de verdad, con las
//    dependencias (leer/guardar cache, calcular) inyectadas (mismo patron
//    que `elegirIndiceAleatorio` con `aleatorio` inyectable en
//    song-select-logica.ts), asi el test puede demostrar la invalidacion
//    por version sin IndexedDB ni Worker reales.
//
// El wiring real (el Worker de verdad con `new Worker(new URL(...))`, y
// las llamadas a @tetra/storage) vive en dificultad-worker-cliente.ts, que
// no se testea directo por la misma razon que db.ts de @tetra/storage no
// se testea sin fake-indexeddb: no hay un "fake Worker" equivalente barato,
// y ese archivo se mantiene chico a proposito (solo conecta las piezas de
// aca).

import type { Chart, DifficultyResult } from '@tetra/core';
import { hashMapa, VERSION_MODELO_DIFICULTAD } from '@tetra/core';

// ---------------------------------------------------------------------------
// Clave de cache
// ---------------------------------------------------------------------------

/**
 * Clave de cache para el resultado de dificultad de `chart`: el hash de su
 * contenido (ver `hashMapa` en @tetra/core) mas la version del modelo. El
 * parametro `version` tiene default en la version real del modelo
 * (`VERSION_MODELO_DIFICULTAD`), pero queda inyectable para que los tests
 * puedan demostrar la invalidacion por version sin depender de que ese
 * numero cambie de verdad en el codigo (ver el test "cambiar la version
 * invalida lo cacheado").
 */
export function claveDeDificultad(chart: Chart, version: number = VERSION_MODELO_DIFICULTAD): string {
  return `${hashMapa(chart)}:${version}`;
}

// ---------------------------------------------------------------------------
// Cola con prioridad
// ---------------------------------------------------------------------------

/**
 * Cola FIFO con una excepcion: un item agregado como prioritario se va al
 * frente, adelante de todo lo que ya esperaba (pero no de otro item
 * prioritario agregado antes que el: entre prioritarios tambien es FIFO).
 * Usada por dificultad-worker-cliente.ts para que la dificultad en foco
 * (ver el ticket, "la dificultad en foco tiene prioridad sobre las demas")
 * no espere a que el worker termine con el resto de la biblioteca.
 */
export class ColaConPrioridad<T> {
  private prioritarios: T[] = [];
  private normales: T[] = [];

  agregar(item: T, prioritaria: boolean): void {
    if (prioritaria) {
      this.prioritarios.push(item);
    } else {
      this.normales.push(item);
    }
  }

  /** Saca y devuelve el siguiente item a procesar, o undefined si la cola esta vacia. */
  siguiente(): T | undefined {
    if (this.prioritarios.length > 0) return this.prioritarios.shift();
    return this.normales.shift();
  }

  get tamano(): number {
    return this.prioritarios.length + this.normales.length;
  }
}

// ---------------------------------------------------------------------------
// Cache-o-calcula
// ---------------------------------------------------------------------------

/** Dependencias inyectables de `obtenerDificultad`, para poder testear sin IndexedDB ni Worker reales. */
export interface DependenciasDeDificultad {
  leerCache(clave: string): Promise<DifficultyResult | undefined>;
  guardarCache(clave: string, resultado: DifficultyResult): Promise<void>;
  calcular(chart: Chart): Promise<DifficultyResult>;
}

/**
 * Devuelve el resultado de dificultad de `chart`: de la cache si ya estaba
 * (bajo la clave de `claveDeDificultad`), o calculandolo (y guardandolo)
 * si no. `version` tiene el mismo rol inyectable que en `claveDeDificultad`
 * (default la version real, pero los tests pueden pasar otra para probar
 * la invalidacion).
 */
export async function obtenerDificultad(
  chart: Chart,
  deps: DependenciasDeDificultad,
  version: number = VERSION_MODELO_DIFICULTAD,
): Promise<DifficultyResult> {
  const clave = claveDeDificultad(chart, version);
  const cacheado = await deps.leerCache(clave);
  if (cacheado !== undefined) return cacheado;
  const resultado = await deps.calcular(chart);
  await deps.guardarCache(clave, resultado);
  return resultado;
}

// ---------------------------------------------------------------------------
// Color de estrella (ver docs/DISENO.md: "derivada de la paleta de juicio,
// no un arcoiris nuevo")
// ---------------------------------------------------------------------------

/**
 * Los cinco tokens de juicio que no son el acento (`--j-max` esta reservado
 * para la unica cosa que brilla por pantalla, ver docs/DISENO.md, "una
 * sola cosa brilla por pantalla": la cancion en foco, no una estrella de
 * lista). En orden de "calmo" a "exigente": azul, verde, violeta, ambar,
 * rojo. Reusa el mismo significado emocional que ya tienen en la pista
 * (de un golpe casi perfecto a un miss) para una dificultad creciente.
 */
export type ColorDeEstrella = '--j-100' | '--j-200' | '--j-50' | '--j-300' | '--j-miss';

const CORTES_COLOR_ESTRELLA: ReadonlyArray<{ menorA: number; color: ColorDeEstrella }> = [
  { menorA: 2, color: '--j-100' },
  { menorA: 4, color: '--j-200' },
  { menorA: 6, color: '--j-50' },
  { menorA: 8, color: '--j-300' },
  { menorA: Infinity, color: '--j-miss' },
];

/** El token de color (una custom property CSS) que le corresponde a una estrella global `overall`. */
export function colorDeEstrella(overall: number): ColorDeEstrella {
  for (const corte of CORTES_COLOR_ESTRELLA) {
    if (overall < corte.menorA) return corte.color;
  }
  // Inalcanzable: el ultimo corte es Infinity, siempre hace match antes.
  return '--j-miss';
}
