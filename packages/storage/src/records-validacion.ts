// T-055: lo que sale de IndexedDB no es de fiar (una version vieja, una
// edicion a mano, un bug). Esto convierte un valor desconocido en un
// RecordDeMapa bien formado o en `undefined`; nunca lanza. Un record
// corrupto se ignora al leer: el song select sigue andando sin el.

import { JUDGEMENTS } from '@tetra/core';
import type { Judgement, PartidaJugada, RecordDeMapa, Rango } from '@tetra/core';

const RANGOS_VALIDOS: readonly string[] = ['SS', 'S', 'A', 'B', 'C', 'D'];

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

function esNumeroFinito(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function normalizarConteos(valor: unknown): Record<Judgement, number> | undefined {
  if (!esObjeto(valor)) return undefined;
  const conteos = {} as Record<Judgement, number>;
  for (const juicio of JUDGEMENTS) {
    const cantidad = valor[juicio];
    if (!esNumeroFinito(cantidad) || cantidad < 0) return undefined;
    conteos[juicio] = cantidad;
  }
  return conteos;
}

/** Una partida bien formada (los campos opcionales mal formados se descartan), o `undefined`. */
export function normalizarPartida(valor: unknown): PartidaJugada | undefined {
  if (!esObjeto(valor)) return undefined;
  const { score, accuracy, maxCombo, rango, fecha } = valor;
  if (!esNumeroFinito(score) || !esNumeroFinito(accuracy) || !esNumeroFinito(maxCombo)) {
    return undefined;
  }
  if (typeof rango !== 'string' || !RANGOS_VALIDOS.includes(rango)) return undefined;
  if (typeof fecha !== 'string') return undefined;
  const counts = normalizarConteos(valor['counts']);
  if (counts === undefined) return undefined;

  const partida: PartidaJugada = { score, accuracy, maxCombo, counts, rango: rango as Rango, fecha };
  const desviacion = valor['desviacionMedia'];
  if (esNumeroFinito(desviacion)) partida.desviacionMedia = desviacion;
  const pulsaciones = valor['pulsaciones'];
  if (Array.isArray(pulsaciones) && pulsaciones.length === 4 && pulsaciones.every(esNumeroFinito)) {
    partida.pulsaciones = [...pulsaciones] as number[];
  }
  return partida;
}

/**
 * Un record bien formado, o `undefined`. Sin `mejor` valido no hay record. Una
 * `ultima` rota se reemplaza por `mejor` y unos `intentos` rotos por 1: lo
 * importante (el mejor) se rescata en vez de perderse por un campo accesorio.
 */
export function normalizarRecord(valor: unknown): RecordDeMapa | undefined {
  if (!esObjeto(valor)) return undefined;
  const hash = valor['hash'];
  if (typeof hash !== 'string' || hash === '') return undefined;
  const mejor = normalizarPartida(valor['mejor']);
  if (mejor === undefined) return undefined;
  const ultima = normalizarPartida(valor['ultima']) ?? mejor;
  const intentos = valor['intentos'];
  return {
    hash,
    mejor,
    ultima,
    intentos: esNumeroFinito(intentos) && intentos >= 1 ? Math.floor(intentos) : 1,
  };
}
