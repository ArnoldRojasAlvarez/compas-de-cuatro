// Tests de T-066 (D3 y D4): reglas puras de deduplicacion, sin IndexedDB.

import { describe, expect, it } from 'vitest';
import type { Chart } from '@tetra/core';
import type { CancionGuardada } from './db.js';
import { combinarConExistente, coincidenciaEnBiblioteca, planearFusiones } from './duplicados.js';

function chart(
  nombre: string,
  tiempo: number,
  extra: Partial<Chart['metadata']> = {},
  titulo = 'Cancion',
): Chart {
  return {
    metadata: {
      title: titulo,
      artist: 'Arnold',
      creator: 'Arnold',
      difficultyName: nombre,
      audioFile: 'audio.mp3',
      previewTime: 0,
      ...extra,
    },
    overallDifficulty: 7,
    hpDrain: 5,
    timingPoints: [{ time: 0, bpm: 120, meter: 4 }],
    speedPoints: [],
    notes: [{ kind: 'tap', time: tiempo, column: 0 }],
  };
}

function cancion(
  id: string,
  dificultades: Chart[],
  extra: Partial<CancionGuardada> = {},
): CancionGuardada {
  return {
    id,
    titulo: 'Cancion',
    artista: 'Arnold',
    audio: new Blob([id]),
    dificultades,
    ...extra,
  };
}

const nombres = (c: CancionGuardada): string[] => c.dificultades.map((d) => d.metadata.difficultyName);

describe('combinarConExistente (D3)', () => {
  it('la misma dificultad no cambia nada: ya-estaba y la misma cancion', () => {
    const existente = cancion('a', [chart('Normal', 100)]);
    const r = combinarConExistente(existente, { dificultades: [chart('Normal', 100)] });
    expect(r.cancion).toBe(existente);
    expect(r.resumen).toEqual({
      estado: 'ya-estaba',
      dificultadesAgregadas: 0,
      dificultadesActualizadas: 0,
      archivosCompletados: false,
    });
  });

  it('un renombre de la dificultad no la duplica (el nombre no entra en la identidad)', () => {
    const existente = cancion('a', [chart('Normal', 100)]);
    const r = combinarConExistente(existente, { dificultades: [chart('Renombrada', 100)] });
    expect(r.resumen.estado).toBe('ya-estaba');
    expect(nombres(r.cancion)).toEqual(['Normal']);
  });

  it('una dificultad nueva se agrega al final y conserva el id y el audio', () => {
    const existente = cancion('a', [chart('Normal', 100)]);
    const r = combinarConExistente(existente, {
      dificultades: [chart('Normal', 100), chart('Hard', 200)],
    });
    expect(r.resumen).toMatchObject({ estado: 'actualizada', dificultadesAgregadas: 1 });
    expect(nombres(r.cancion)).toEqual(['Normal', 'Hard']);
    expect(r.cancion.id).toBe('a');
    expect(r.cancion.audio).toBe(existente.audio);
  });

  it('si el nombre de la nueva choca con otro, recibe " (2)", " (3)"', () => {
    const existente = cancion('a', [chart('Normal', 100), chart('Normal (2)', 150)]);
    const r = combinarConExistente(existente, { dificultades: [chart('Normal', 300)] });
    expect(nombres(r.cancion)).toEqual(['Normal', 'Normal (2)', 'Normal (3)']);
  });

  it('el mismo BeatmapID con otras notas reemplaza en su misma posicion', () => {
    const existente = cancion('a', [
      chart('Easy', 50),
      chart('Normal', 100, { beatmapId: 99 }),
      chart('Hard', 300),
    ]);
    const r = combinarConExistente(existente, {
      dificultades: [chart('Normal', 777, { beatmapId: 99 })],
    });
    expect(r.resumen).toMatchObject({
      estado: 'actualizada',
      dificultadesAgregadas: 0,
      dificultadesActualizadas: 1,
    });
    expect(nombres(r.cancion)).toEqual(['Easy', 'Normal', 'Hard']);
    expect(r.cancion.dificultades[1]!.notes[0]!.time).toBe(777);
  });

  it('las dificultades existentes que no vienen se conservan (pueden ser del mapeador)', () => {
    const existente = cancion('a', [chart('Normal', 100), chart('Del mapeador', 900)]);
    const r = combinarConExistente(existente, { dificultades: [chart('Normal', 100)] });
    expect(r.resumen.estado).toBe('ya-estaba');
    expect(nombres(r.cancion)).toEqual(['Normal', 'Del mapeador']);
  });

  it('completa el fondo y el video que faltaban, sin pisar los que ya habia', () => {
    const fondo = new Blob(['bg']);
    const video = new Blob(['vid']);
    const sin = cancion('a', [chart('Normal', 100)]);
    const r = combinarConExistente(sin, {
      dificultades: [chart('Normal', 100)],
      background: fondo,
      video,
      videoOffset: -50,
    });
    expect(r.resumen).toMatchObject({ estado: 'actualizada', archivosCompletados: true });
    expect(r.cancion.background).toBe(fondo);
    expect(r.cancion.video).toBe(video);
    expect(r.cancion.videoOffset).toBe(-50);

    const con = cancion('a', [chart('Normal', 100)], { background: new Blob(['viejo']) });
    const r2 = combinarConExistente(con, {
      dificultades: [chart('Normal', 100)],
      background: fondo,
    });
    expect(r2.resumen.estado).toBe('ya-estaba');
    expect(r2.cancion.background).toBe(con.background);
  });
});

describe('coincidenciaEnBiblioteca (D3)', () => {
  it('sin coincidencia da undefined', () => {
    expect(
      coincidenciaEnBiblioteca([chart('X', 1)], [cancion('a', [chart('Y', 2)])]),
    ).toBeUndefined();
  });

  it('coincide por contenido o por BeatmapID', () => {
    const lib = [cancion('a', [chart('Y', 2, { beatmapId: 5 })])];
    expect(coincidenciaEnBiblioteca([chart('Z', 2)], lib)?.id).toBe('a');
    expect(coincidenciaEnBiblioteca([chart('Z', 999, { beatmapId: 5 })], lib)?.id).toBe('a');
  });

  it('si coincide con varias gana la de importadaEn menor', () => {
    const lib = [
      cancion('nueva', [chart('Y', 2)], { importadaEn: 2000 }),
      cancion('vieja', [chart('Y', 2)], { importadaEn: 1000 }),
    ];
    expect(coincidenciaEnBiblioteca([chart('Y', 2)], lib)?.id).toBe('vieja');
  });
});

describe('planearFusiones (D4)', () => {
  it('canciones sin relacion no se tocan', () => {
    expect(
      planearFusiones([cancion('a', [chart('N', 1)]), cancion('b', [chart('N', 2)])]),
    ).toEqual([]);
  });

  it('la sobreviviente es la de importadaEn menor; las absorbidas van de la mas nueva a la mas vieja', () => {
    const planes = planearFusiones([
      cancion('b', [chart('N', 1)], { importadaEn: 2000 }),
      cancion('a', [chart('N', 1)], { importadaEn: 1000 }),
      cancion('c', [chart('N', 1)], { importadaEn: 3000 }),
    ]);
    expect(planes).toHaveLength(1);
    expect(planes[0]!.resultado.id).toBe('a');
    expect(planes[0]!.absorbidas).toEqual(['c', 'b']);
  });

  it('sin importadaEn cuenta como la mas vieja; el desempate es por id ascendente', () => {
    const [p1] = planearFusiones([
      cancion('x', [chart('N', 1)], { importadaEn: 5 }),
      cancion('z', [chart('N', 1)]),
    ]);
    expect(p1!.resultado.id).toBe('z');
    const [p2] = planearFusiones([cancion('m', [chart('N', 1)]), cancion('b', [chart('N', 1)])]);
    expect(p2!.resultado.id).toBe('b');
    expect(p2!.absorbidas).toEqual(['m']);
  });

  it('suma las dificultades que no comparten identidad y deja el audio y el titulo de la sobreviviente', () => {
    const [plan] = planearFusiones([
      cancion('a', [chart('Normal', 1)], { importadaEn: 1, titulo: 'Original' }),
      cancion('b', [chart('Normal', 1), chart('Hard', 2)], { importadaEn: 2, titulo: 'Copia' }),
    ]);
    expect(plan!.resultado.titulo).toBe('Original');
    expect(plan!.resultado.audio).toBeInstanceOf(Blob);
    expect(nombres(plan!.resultado)).toEqual(['Normal', 'Hard']);
  });

  it('un nombre que choca con distinto contenido recibe " (2)"', () => {
    const [plan] = planearFusiones([
      cancion('a', [chart('Normal', 1), chart('Otra', 5)], { importadaEn: 1 }),
      cancion('b', [chart('Normal', 1), chart('Otra', 9, {}, 'Cancion')], { importadaEn: 2 }),
    ]);
    expect(nombres(plan!.resultado)).toEqual(['Normal', 'Otra', 'Otra (2)']);
  });

  it('el fondo y el video salen de la primera absorbida que los tenga', () => {
    const fondo = new Blob(['bg']);
    const video = new Blob(['vid']);
    const [plan] = planearFusiones([
      cancion('a', [chart('N', 1)], { importadaEn: 1 }),
      cancion('b', [chart('N', 1)], { importadaEn: 2 }),
      cancion('c', [chart('N', 1)], { importadaEn: 3, background: fondo, video, videoOffset: 12 }),
    ]);
    expect(plan!.resultado.background).toBe(fondo);
    expect(plan!.resultado.video).toBe(video);
    expect(plan!.resultado.videoOffset).toBe(12);
  });

  it('el conjunto es el de la sobreviviente; si no tiene, el de la primera absorbida que lo tenga (T-066 paso 2)', () => {
    const [propio] = planearFusiones([
      cancion('a', [chart('N', 1)], { importadaEn: 1, conjunto: 'Mio' }),
      cancion('b', [chart('N', 1)], { importadaEn: 2, conjunto: 'Otro' }),
    ]);
    expect(propio!.resultado.conjunto).toBe('Mio');

    const [heredado] = planearFusiones([
      cancion('a', [chart('N', 1)], { importadaEn: 1 }),
      cancion('b', [chart('N', 1)], { importadaEn: 2 }),
      cancion('c', [chart('N', 1)], { importadaEn: 3, conjunto: 'Set' }),
    ]);
    expect(heredado!.resultado.conjunto).toBe('Set');
  });

  it('el fondo de la sobreviviente se respeta', () => {
    const propio = new Blob(['propio']);
    const [plan] = planearFusiones([
      cancion('a', [chart('N', 1)], { importadaEn: 1, background: propio }),
      cancion('b', [chart('N', 1)], { importadaEn: 2, background: new Blob(['otro']) }),
    ]);
    expect(plan!.resultado.background).toBe(propio);
  });

  it('clausura transitiva: A comparte con B y B con C da una sola fusion', () => {
    const planes = planearFusiones([
      cancion('a', [chart('N', 1, { beatmapId: 10 })], { importadaEn: 1 }),
      cancion('b', [chart('M', 2, { beatmapId: 10 }), chart('P', 3)], { importadaEn: 2 }),
      cancion('c', [chart('Q', 3)], { importadaEn: 3 }),
    ]);
    expect(planes).toHaveLength(1);
    expect(planes[0]!.resultado.id).toBe('a');
    expect(planes[0]!.absorbidas).toEqual(['c', 'b']);
    expect(planes[0]!.resultado.dificultades.map((d) => d.notes[0]!.time)).toEqual([1, 3]);
  });

  it('el mismo BeatmapID con otro contenido cuenta como la misma cancion', () => {
    const planes = planearFusiones([
      cancion('a', [chart('N', 1, { beatmapId: 7 })], { importadaEn: 1 }),
      cancion('b', [chart('N', 2, { beatmapId: 7 })], { importadaEn: 2 }),
    ]);
    expect(planes).toHaveLength(1);
    // Comparten identidad por id: la de la absorbida no se suma.
    expect(planes[0]!.resultado.dificultades).toHaveLength(1);
  });

  it('segunda corrida sin cambios (idempotente)', () => {
    const [plan] = planearFusiones([
      cancion('a', [chart('Normal', 1)], { importadaEn: 1 }),
      cancion('b', [chart('Normal', 1), chart('Hard', 2)], { importadaEn: 2 }),
    ]);
    expect(planearFusiones([plan!.resultado])).toEqual([]);
  });
});

describe('keysounds de canciones virtuales (T-066 paso 3)', () => {
  const virtual = (id: string, dificultades: Chart[], keysounds: Record<string, string>, extra = {}) =>
    ({ id, titulo: 'Pieza', artista: 'Arnold', keysounds, dificultades, ...extra }) as CancionGuardada;

  it('combinarConExistente une los keysounds si cambia algo y gana el nombre que ya estaba', () => {
    const existente = virtual('a', [chart('Normal', 100)], { 'a.ogg': 'h1', 'b.ogg': 'h2' });
    const r = combinarConExistente(existente, {
      dificultades: [chart('Dificil', 200)],
      keysounds: { 'b.ogg': 'otro', 'c.ogg': 'h3' },
    });
    expect(r.resumen.estado).toBe('actualizada');
    expect(r.cancion.keysounds).toEqual({ 'a.ogg': 'h1', 'b.ogg': 'h2', 'c.ogg': 'h3' });
  });

  it('si no cambia nada, la existente queda igual aunque traiga keysounds', () => {
    const existente = virtual('a', [chart('Normal', 100)], { 'a.ogg': 'h1' });
    const r = combinarConExistente(existente, {
      dificultades: [chart('Normal', 100)],
      keysounds: { 'z.ogg': 'h9' },
    });
    expect(r.cancion).toBe(existente);
  });

  it('planearFusiones une los keysounds de las absorbidas; gana la sobreviviente', () => {
    const vieja = virtual('a', [chart('Normal', 100)], { 'a.ogg': 'h1' }, { importadaEn: 1 });
    const nueva = virtual(
      'b',
      [chart('Normal', 100), chart('Dificil', 200)],
      { 'a.ogg': 'otro', 'b.ogg': 'h2' },
      { importadaEn: 2 },
    );
    const [plan] = planearFusiones([nueva, vieja]);
    expect(plan!.resultado.id).toBe('a');
    expect(plan!.resultado.keysounds).toEqual({ 'a.ogg': 'h1', 'b.ogg': 'h2' });
    expect(plan!.resultado.audio).toBeUndefined();
  });
});
