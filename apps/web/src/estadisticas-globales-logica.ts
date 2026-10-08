// T-045: lo que la pantalla de estadisticas globales calcula antes de
// dibujar, sin DOM: los periodos, los textos de los numeros grandes y la
// geometria de los graficos (escala del eje Y, posicion de cada dia en X,
// altura de las barras). Aislado de estadisticas-globales.ts para testearlo
// sin navegador, con el mismo criterio que records-logica.ts.

import type { Ms } from '@tetra/core';
import { formatearDesviacion, formatearPrecision } from './records-logica.js';
import { formatearTiempoJugado } from './tiempo-jugado.js';

export type IdPeriodo = '7' | '30' | 'todo';

export interface Periodo {
  id: IdPeriodo;
  etiqueta: string;
  /** Cuantos dias hacia atras; `null` es todo el historial. */
  dias: number | null;
}

/** Los tres filtros del segmentado, en el orden en que se muestran. */
export const PERIODOS: readonly Periodo[] = [
  { id: '7', etiqueta: '7 dias', dias: 7 },
  { id: '30', etiqueta: '30 dias', dias: 30 },
  { id: 'todo', etiqueta: 'Todo', dias: null },
];

/** El periodo con el que abre la pantalla. */
export const PERIODO_INICIAL: IdPeriodo = 'todo';

const MESES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

const MS_POR_DIA = 86_400_000;

function dos(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * El dia (AAAA-MM-DD) de un instante ISO en la hora LOCAL del jugador: jugar a
 * las 11 de la noche cuenta como ese dia y no como el siguiente en UTC. Fecha
 * ilegible: cadena vacia (el grafico la deja afuera).
 */
export function diaLocal(fecha: string): string {
  const ms = Date.parse(fecha);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Dias enteros desde 1970 de un 'AAAA-MM-DD' (sin zona horaria: dos dias seguidos difieren en 1 siempre, tambien en el cambio de hora). */
export function numeroDeDia(dia: string): number {
  const [anio, mes, diaDelMes] = dia.split('-').map(Number);
  if (anio === undefined || mes === undefined || diaDelMes === undefined)
    return Number.NaN;
  return Math.round(Date.UTC(anio, mes - 1, diaDelMes) / MS_POR_DIA);
}

/** "7 oct". Un dia ilegible vuelve tal cual. */
export function etiquetaDeDia(dia: string): string {
  const [, mes, diaDelMes] = dia.split('-').map(Number);
  if (mes === undefined || diaDelMes === undefined || MESES[mes - 1] === undefined)
    return dia;
  return `${diaDelMes} ${MESES[mes - 1]}`;
}

/**
 * Posicion horizontal (0 a 1) de cada dia de una serie ya ordenada: proporcional
 * a los dias que pasaron, asi un hueco de una semana se ve como un hueco y no
 * como dos puntos pegados. Un solo dia queda al centro; nunca NaN.
 */
export function fraccionesEnX(dias: readonly string[]): number[] {
  if (dias.length === 0) return [];
  if (dias.length === 1) return [0.5];
  const numeros = dias.map(numeroDeDia);
  const primero = numeros[0]!;
  const ultimo = numeros[numeros.length - 1]!;
  const ancho = ultimo - primero;
  if (!Number.isFinite(ancho) || ancho <= 0)
    return dias.map((_, i) => i / (dias.length - 1));
  return numeros.map((n) => (n - primero) / ancho);
}

export interface EscalaY {
  min: number;
  max: number;
  /** Valores donde dibujar una linea de guia con su etiqueta, de menor a mayor, todos dentro de [min, max]. */
  marcas: number[];
}

/** Paso "redondo" (1, 2 o 5 por una potencia de 10) para que entren a lo sumo `maxMarcas` marcas. */
function pasoRedondo(rango: number, maxMarcas: number): number {
  const crudo = rango / maxMarcas;
  const potencia = 10 ** Math.floor(Math.log10(crudo));
  for (const multiplo of [1, 2, 5, 10]) {
    if (multiplo * potencia >= crudo) return multiplo * potencia;
  }
  return 10 * potencia;
}

/**
 * Escala del eje Y para una lista de valores: el minimo y el maximo del dibujo
 * y las marcas en numeros redondos. Con `conCero` el cero siempre queda dentro
 * (la desviacion con signo se lee contra su cero); `maximo` recorta por arriba
 * (la precision no pasa de 100). Una lista vacia o de un solo valor da una
 * escala valida, nunca de ancho 0.
 */
export function escalaDeValores(
  valores: readonly number[],
  opciones: { conCero?: boolean; maximo?: number } = {},
): EscalaY {
  const finitos = valores.filter(Number.isFinite);
  let bajo = finitos.length > 0 ? Math.min(...finitos) : 0;
  let alto = finitos.length > 0 ? Math.max(...finitos) : 1;
  if (opciones.conCero === true) {
    bajo = Math.min(bajo, 0);
    alto = Math.max(alto, 0);
  }
  if (alto - bajo <= 0) {
    // Un solo valor (o todos iguales): se abre un margen para que el punto no quede pegado al borde.
    const holgura = Math.max(1, Math.abs(alto) * 0.05);
    bajo -= holgura;
    alto += holgura;
  }
  const paso = pasoRedondo(alto - bajo, 4);
  let min = Math.floor(bajo / paso) * paso;
  let max = Math.ceil(alto / paso) * paso;
  if (opciones.maximo !== undefined && max > opciones.maximo) {
    max = opciones.maximo;
    if (min >= max) min = max - paso;
  }
  const marcas: number[] = [];
  // Multiplos del paso dentro del rango; el redondeo evita 0.30000000000000004.
  for (let k = Math.ceil(min / paso); k * paso <= max + paso * 1e-9; k++) {
    marcas.push(Math.round(k * paso * 1e9) / 1e9);
  }
  return { min, max, marcas };
}

/** Alto (0 a 1) de cada barra de fallos, relativo a la que mas tiene. Todo en cero: todas en 0, nunca NaN. */
export function alturasDeBarras(valores: readonly number[]): number[] {
  const mayor = Math.max(0, ...valores.filter(Number.isFinite));
  return valores.map((v) => (mayor > 0 && Number.isFinite(v) && v > 0 ? v / mayor : 0));
}

/**
 * Los dos lados de la barra partida temprano/tarde como porcentajes enteros que
 * suman 100. `null` si no hubo ni una ni otra. El lado tarde es el resto, asi
 * 33,3 y 66,7 no dan 33 + 67 = 100 por casualidad sino por construccion.
 */
export function partesTempranoTarde(
  proporcionTemprana: number | null,
): { temprano: number; tarde: number } | null {
  if (proporcionTemprana === null || !Number.isFinite(proporcionTemprana)) return null;
  const temprano = Math.round(Math.min(1, Math.max(0, proporcionTemprana)) * 100);
  return { temprano, tarde: 100 - temprano };
}

/** "45 s" bajo el minuto; despues "12 min", "1 h 05 min". Distinto del header: aca una partida corta tiene que contar. */
export function formatearDuracion(ms: Ms): string {
  const segundos = Math.floor(Math.max(0, ms) / 1000);
  if (segundos < 60) return `${segundos} s`;
  return formatearTiempoJugado(ms);
}

/** "98.43%" o "-" si todavia no hay precision que mostrar. */
export function textoDePrecisionMedia(accuracy: number | null): string {
  return accuracy === null ? '-' : formatearPrecision(accuracy);
}

/** "+4 ms", "-3 ms", "0 ms" o "-" sin golpes. */
export function textoDeDesviacionMedia(ms: number | null): string {
  return ms === null ? '-' : formatearDesviacion(ms);
}
