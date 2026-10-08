// T-042: lo puro de la tarjeta "Biblioteca" de ajustes (nombre del archivo,
// textos de la linea de estado, cuando preguntar por los ajustes). Separado de
// ajustes.ts para poder testearlo sin navegador.

import type { ResumenRestauracion } from '@tetra/storage';

/** `tetra-respaldo-AAAA-MM-DD.zip`, con la fecha local de `fecha`. */
export function nombreDeArchivoDeRespaldo(fecha: Date): string {
  const dos = (n: number): string => String(n).padStart(2, '0');
  return `tetra-respaldo-${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}.zip`;
}

/** Bytes legibles: "820 B", "12.3 KB", "4.5 MB", "1.2 GB". */
export function formatearBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  let valor = bytes;
  let indice = 0;
  while (valor >= 1024 && indice < unidades.length - 1) {
    valor /= 1024;
    indice += 1;
  }
  return indice === 0 ? `${Math.round(valor)} B` : `${valor.toFixed(1)} ${unidades[indice]}`;
}

/** La linea de estado en reposo: cuanto ocupa la biblioteca (vacia si el navegador no lo dice). */
export function lineaDeAlmacenamiento(uso: { usado: number; cuota: number } | undefined): string {
  if (uso === undefined) return '';
  return `Usando ${formatearBytes(uso.usado)} de ${formatearBytes(uso.cuota)}`;
}

/** Lo que dice la linea de estado tras exportar. */
export function lineaDeExportacion(nombre: string, bytes: number): string {
  return `Exportado: ${nombre} (${formatearBytes(bytes)})`;
}

function plural(n: number, singular: string, pluralTexto: string): string {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

/**
 * El resumen de una restauracion en una sola linea, corta para que entre en la
 * tarjeta sin saltar: canciones nuevas, las que ya estaban y, si hay, skins,
 * records, replays, partidas del historial y ajustes restaurados.
 */
export function lineaDeRestauracion(r: ResumenRestauracion): string {
  const partes = [plural(r.cancionesNuevas, 'cancion nueva', 'canciones nuevas')];
  if (r.cancionesExistentes > 0) {
    partes.push(plural(r.cancionesExistentes, 'ya existente', 'ya existentes'));
  }
  if (r.skinsNuevas > 0) partes.push(plural(r.skinsNuevas, 'skin', 'skins'));
  const records = r.recordsNuevos + r.recordsActualizados;
  if (records > 0) partes.push(plural(records, 'record', 'records'));
  if (r.replaysNuevos > 0) partes.push(plural(r.replaysNuevos, 'replay', 'replays'));
  if (r.historialNuevo > 0) partes.push(plural(r.historialNuevo, 'partida', 'partidas'));
  if (r.ajustesRestaurados > 0) partes.push('ajustes');
  return partes.join(', ');
}

/**
 * true si restaurar los ajustes del respaldo pisaria algun valor que ya hay
 * (una clave con otro valor). Si solo hay claves que faltan o que ya valen lo
 * mismo, restaurarlas no destruye nada y no hace falta preguntar.
 */
export function ajustesPisarianLocales(
  delRespaldo: Readonly<Record<string, string>>,
  locales: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(delRespaldo).some(
    ([clave, valor]) => Object.hasOwn(locales, clave) && locales[clave] !== valor,
  );
}
