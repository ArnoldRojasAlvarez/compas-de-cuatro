// Tests de T-042: lo puro de la tarjeta Biblioteca de ajustes.

import { describe, expect, it } from 'vitest';
import {
  ajustesPisarianLocales,
  formatearBytes,
  lineaDeAlmacenamiento,
  lineaDeRestauracion,
  nombreDeArchivoDeRespaldo,
} from './respaldo-logica.js';

const RESUMEN_VACIO = {
  cancionesNuevas: 0,
  cancionesExistentes: 0,
  skinsNuevas: 0,
  skinsExistentes: 0,
  recordsNuevos: 0,
  recordsActualizados: 0,
  replaysNuevos: 0,
  historialNuevo: 0,
  ajustesRestaurados: 0,
};

describe('nombreDeArchivoDeRespaldo', () => {
  it('usa la fecha local con ceros a la izquierda', () => {
    expect(nombreDeArchivoDeRespaldo(new Date(2026, 9, 7, 23, 59))).toBe('tetra-respaldo-2026-10-07.zip');
    expect(nombreDeArchivoDeRespaldo(new Date(2027, 0, 3, 0, 1))).toBe('tetra-respaldo-2027-01-03.zip');
  });
});

describe('formatearBytes y lineaDeAlmacenamiento', () => {
  it('elige la unidad', () => {
    expect(formatearBytes(0)).toBe('0 B');
    expect(formatearBytes(820)).toBe('820 B');
    expect(formatearBytes(1536)).toBe('1.5 KB');
    expect(formatearBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatearBytes(3 * 1024 ** 3)).toBe('3.0 GB');
    expect(formatearBytes(-1)).toBe('0 B');
    expect(formatearBytes(Number.NaN)).toBe('0 B');
  });

  it('sin estimacion del navegador la linea queda vacia', () => {
    expect(lineaDeAlmacenamiento(undefined)).toBe('');
    expect(lineaDeAlmacenamiento({ usado: 2 * 1024 * 1024, cuota: 1024 ** 3 })).toBe(
      'Usando 2.0 MB de 1.0 GB',
    );
  });
});

describe('lineaDeRestauracion', () => {
  it('es una sola linea, con singular y plural', () => {
    expect(lineaDeRestauracion({ ...RESUMEN_VACIO, cancionesNuevas: 1 })).toBe('1 canción nueva');
    expect(
      lineaDeRestauracion({
        ...RESUMEN_VACIO,
        cancionesNuevas: 3,
        cancionesExistentes: 1,
        skinsNuevas: 2,
        recordsNuevos: 4,
        recordsActualizados: 1,
        ajustesRestaurados: 6,
      }),
    ).toBe('3 canciones nuevas, 1 ya existente, 2 skins, 5 récords, ajustes');
  });

  it('T-044: cuenta los replays restaurados, entre los records y los ajustes', () => {
    expect(lineaDeRestauracion({ ...RESUMEN_VACIO, replaysNuevos: 1 })).toBe(
      '0 canciones nuevas, 1 replay',
    );
    expect(
      lineaDeRestauracion({ ...RESUMEN_VACIO, recordsNuevos: 2, replaysNuevos: 2, ajustesRestaurados: 1 }),
    ).toBe('0 canciones nuevas, 2 récords, 2 replays, ajustes');
  });

  it('T-045: cuenta las partidas del historial restauradas, despues de los replays', () => {
    expect(lineaDeRestauracion({ ...RESUMEN_VACIO, historialNuevo: 1 })).toBe(
      '0 canciones nuevas, 1 partida',
    );
    expect(
      lineaDeRestauracion({ ...RESUMEN_VACIO, replaysNuevos: 2, historialNuevo: 40, ajustesRestaurados: 1 }),
    ).toBe('0 canciones nuevas, 2 replays, 40 partidas, ajustes');
  });

  it('cuando no entra nada nuevo lo dice con ceros y muestra lo que ya estaba', () => {
    const texto = lineaDeRestauracion({ ...RESUMEN_VACIO, cancionesExistentes: 2, skinsExistentes: 1 });
    expect(texto).toBe('0 canciones nuevas, 2 ya existentes');
    expect(texto).not.toContain('\n');
  });
});

describe('ajustesPisarianLocales', () => {
  it('solo avisa si una clave local tiene otro valor', () => {
    expect(ajustesPisarianLocales({ 'tetra:a': '1' }, { 'tetra:a': '2' })).toBe(true);
    expect(ajustesPisarianLocales({ 'tetra:a': '1' }, { 'tetra:a': '1' })).toBe(false);
    // Una clave que no existe aca se puede restaurar sin pisar nada.
    expect(ajustesPisarianLocales({ 'tetra:a': '1' }, {})).toBe(false);
    // Claves locales que el respaldo no trae no se tocan.
    expect(ajustesPisarianLocales({}, { 'tetra:a': '1' })).toBe(false);
  });
});
