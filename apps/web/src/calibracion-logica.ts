// T-015: la logica de la pantalla de calibracion que no depende del DOM, para
// testearla sin navegador (mismo criterio que dificultad-logica.ts). La
// estadistica en si (Spearman, ajuste log-log) vive en @tetra/core; aca solo
// se arman las filas, el resumen, la persistencia y la exportacion.

import type { DifficultyResult } from '@tetra/core';
import { ajustarLeyDePotencia, rangos, spearman, type AjusteLogLog } from '@tetra/core';

// ---------------------------------------------------------------------------
// Anotaciones (SR de osu! y notas), persistidas en localStorage
// ---------------------------------------------------------------------------

export interface Anotacion {
  /** Star rating de osu!, o null si todavia no se anoto (o se borro). Siempre > 0 si no es null. */
  sr: number | null;
  notas: string;
}

/** Anotaciones por clave de mapa (el `hashMapa` del contenido, estable entre versiones del modelo). */
export type Anotaciones = Record<string, Anotacion>;

/** Lo minimo de `Storage` que se usa: inyectable para testear sin navegador. */
export interface AlmacenTexto {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
}

/** Clave de localStorage. Sube el sufijo si cambia el formato guardado. */
export const CLAVE_ALMACEN_CALIBRACION = 'tetra.calibracion.v1';

/**
 * Lee las anotaciones guardadas. Tolerante: si no hay nada, el JSON esta roto
 * o alguna entrada no tiene la forma esperada, devuelve lo que se pueda
 * rescatar (o vacio) en vez de romper la pantalla.
 */
export function cargarAnotaciones(almacen: AlmacenTexto): Anotaciones {
  let crudo: string | null = null;
  try {
    crudo = almacen.getItem(CLAVE_ALMACEN_CALIBRACION);
  } catch {
    return {};
  }
  if (crudo === null) return {};
  let datos: unknown;
  try {
    datos = JSON.parse(crudo);
  } catch {
    return {};
  }
  if (typeof datos !== 'object' || datos === null) return {};
  const resultado: Anotaciones = {};
  for (const [clave, valor] of Object.entries(datos)) {
    if (typeof valor !== 'object' || valor === null) continue;
    const { sr, notas } = valor as { sr?: unknown; notas?: unknown };
    resultado[clave] = {
      sr: typeof sr === 'number' && Number.isFinite(sr) && sr > 0 ? sr : null,
      notas: typeof notas === 'string' ? notas : '',
    };
  }
  return resultado;
}

/** Guarda todas las anotaciones. Si el almacenamiento falla (cuota, modo privado) no rompe: devuelve false. */
export function guardarAnotaciones(
  almacen: AlmacenTexto,
  anotaciones: Anotaciones,
): boolean {
  try {
    almacen.setItem(CLAVE_ALMACEN_CALIBRACION, JSON.stringify(anotaciones));
    return true;
  } catch {
    return false;
  }
}

/**
 * Convierte lo que se tipeo en el campo de SR. Acepta coma decimal ("5,32").
 * Vacio, no numerico o no positivo (cero o negativo: una estrella no puede
 * serlo y ademas el log del ajuste no lo admite) da null.
 */
export function parsearSr(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (limpio === '') return null;
  const valor = Number(limpio);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

// ---------------------------------------------------------------------------
// Filas y resumen
// ---------------------------------------------------------------------------

export interface FilaCalibracion {
  clave: string;
  cancionId: string;
  titulo: string;
  artista: string;
  dificultad: string;
  /** Undefined mientras el worker no termino de calcular este mapa. */
  resultado: DifficultyResult | undefined;
  sr: number | null;
  notas: string;
}

export interface Discrepancia {
  fila: FilaCalibracion;
  /** Rango de Tetra entre las filas con SR (1 = la mas facil). Empates con rango promedio. */
  rangoTetra: number;
  rangoOsu: number;
  /** rangoTetra - rangoOsu: positivo significa que Tetra la ve mas dificil que osu!. */
  diferenciaDeRango: number;
  /** overall de Tetra menos SR de osu! (crudo). */
  diferenciaCruda: number;
  /** Estrella predicha por el ajuste menos SR de osu!, o null si no hay ajuste. */
  diferenciaAjustada: number | null;
}

export interface CorrelacionDeSet {
  cancionId: string;
  titulo: string;
  n: number;
  rho: number | null;
}

export interface ResumenCalibracion {
  /** Filas que tienen a la vez resultado de Tetra y SR de osu!. */
  pares: number;
  spearman: number | null;
  ajuste: AjusteLogLog | null;
  /** Spearman dentro de cada cancion con al menos 3 pares (la escalera de un set). */
  porSet: CorrelacionDeSet[];
  peores: Discrepancia[];
}

/** Predice la estrella con el ajuste `a * valor^p`. */
export function predecir(ajuste: AjusteLogLog, valor: number): number {
  return ajuste.a * Math.pow(valor, ajuste.p);
}

const CANTIDAD_PEORES = 10;
const MINIMO_POR_SET = 3;

/**
 * Calcula todo lo que muestra la pantalla a partir de las filas. Solo cuentan
 * las filas con resultado de Tetra y SR valido. Las peores discrepancias se
 * ordenan por |diferencia de rango| (el orden es lo que importa, no la
 * escala) y desempatan por |diferencia ajustada| (o la cruda si no hay
 * ajuste), de mayor a menor.
 */
export function resumirCalibracion(
  filas: readonly FilaCalibracion[],
): ResumenCalibracion {
  const pares = filas.filter(
    (f): f is FilaCalibracion & { resultado: DifficultyResult; sr: number } =>
      f.resultado !== undefined && f.sr !== null,
  );
  const overall = pares.map((f) => f.resultado.overall);
  const sr = pares.map((f) => f.sr);

  const ajuste = ajustarLeyDePotencia(overall, sr);
  const rangosTetra = rangos(overall);
  const rangosOsu = rangos(sr);

  const discrepancias: Discrepancia[] = pares.map((fila, i) => ({
    fila,
    rangoTetra: rangosTetra[i]!,
    rangoOsu: rangosOsu[i]!,
    diferenciaDeRango: rangosTetra[i]! - rangosOsu[i]!,
    diferenciaCruda: fila.resultado.overall - fila.sr,
    diferenciaAjustada: ajuste
      ? predecir(ajuste, fila.resultado.overall) - fila.sr
      : null,
  }));
  discrepancias.sort((a, b) => {
    const porRango = Math.abs(b.diferenciaDeRango) - Math.abs(a.diferenciaDeRango);
    if (porRango !== 0) return porRango;
    return (
      Math.abs(b.diferenciaAjustada ?? b.diferenciaCruda) -
      Math.abs(a.diferenciaAjustada ?? a.diferenciaCruda)
    );
  });

  const porCancion = new Map<string, typeof pares>();
  for (const fila of pares) {
    const grupo = porCancion.get(fila.cancionId);
    if (grupo) grupo.push(fila);
    else porCancion.set(fila.cancionId, [fila]);
  }
  const porSet: CorrelacionDeSet[] = [];
  for (const [cancionId, grupo] of porCancion) {
    if (grupo.length < MINIMO_POR_SET) continue;
    porSet.push({
      cancionId,
      titulo: grupo[0]!.titulo,
      n: grupo.length,
      rho: spearman(
        grupo.map((f) => f.resultado.overall),
        grupo.map((f) => f.sr),
      ),
    });
  }

  return {
    pares: pares.length,
    spearman: spearman(overall, sr),
    ajuste,
    porSet,
    peores: discrepancias.slice(0, CANTIDAD_PEORES),
  };
}

// ---------------------------------------------------------------------------
// Exportacion
// ---------------------------------------------------------------------------

export interface ContextoDeExportacion {
  versionModelo: number;
  modeloCalibrado: boolean;
  /** Los PARAMETROS_DIFICULTAD vigentes, tal cual, para que quien lea el JSON sepa contra que se midio. */
  parametros: unknown;
  /** ISO 8601. Inyectado para que el test sea determinista. */
  generado: string;
}

/**
 * Arma el objeto que se serializa a JSON: es lo que lee Opus para ajustar
 * parametros. Incluye todas las filas (con o sin SR), el resumen y las peores
 * discrepancias con su vector completo.
 */
export function construirExportacion(
  filas: readonly FilaCalibracion[],
  contexto: ContextoDeExportacion,
): object {
  const resumen = resumirCalibracion(filas);
  return {
    formato: 'tetra-calibracion-v1',
    generado: contexto.generado,
    versionModelo: contexto.versionModelo,
    modeloCalibrado: contexto.modeloCalibrado,
    parametros: contexto.parametros,
    resumen: {
      pares: resumen.pares,
      spearman: resumen.spearman,
      ajuste: resumen.ajuste,
      porSet: resumen.porSet,
    },
    peoresDiscrepancias: resumen.peores.map((d) => ({
      cancionId: d.fila.cancionId,
      titulo: d.fila.titulo,
      dificultad: d.fila.dificultad,
      overall: d.fila.resultado?.overall ?? null,
      vector: d.fila.resultado?.vector ?? null,
      srOsu: d.fila.sr,
      notas: d.fila.notas,
      rangoTetra: d.rangoTetra,
      rangoOsu: d.rangoOsu,
      diferenciaDeRango: d.diferenciaDeRango,
      diferenciaCruda: d.diferenciaCruda,
      diferenciaAjustada: d.diferenciaAjustada,
    })),
    filas: filas.map((f) => ({
      clave: f.clave,
      cancionId: f.cancionId,
      titulo: f.titulo,
      artista: f.artista,
      dificultad: f.dificultad,
      overall: f.resultado?.overall ?? null,
      vector: f.resultado?.vector ?? null,
      srOsu: f.sr,
      notas: f.notas,
    })),
  };
}
