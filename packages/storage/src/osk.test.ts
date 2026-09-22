// Tests de T-009 (capa de importacion de .osk). Mismo criterio que
// osz.test.ts: valores esperados tipeados a mano, zip armado en el
// momento con fflate.zipSync para no depender de ningun archivo en disco
// (salvo el ultimo bloque, que usa el fixture real de T-009, igual que
// index.test.ts hace con el .osz de T-005).

import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { extraerImagenesDeOsk, ubicarImagenesDeSkin } from './osk.js';

function armarOsk(entradas: Record<string, Uint8Array>): Blob {
  const zip = zipSync(entradas);
  return new Blob([zip], { type: 'application/zip' });
}

const PNG_1X1 = new Uint8Array([1, 2, 3]); // el contenido no importa para estos tests: storage no decodifica imagenes

describe('ubicarImagenesDeSkin', () => {
  it('encuentra las 10 imagenes cuando estan todas presentes', () => {
    const nombres = [
      'mania-note1.png',
      'mania-note2.png',
      'mania-note1H.png',
      'mania-note2H.png',
      'mania-note1L.png',
      'mania-note2L.png',
      'mania-key1.png',
      'mania-key2.png',
      'mania-key1D.png',
      'mania-key2D.png',
      'skin.ini',
      'hit300.png', // no es ninguna de las 10, tiene que quedar afuera
    ];
    const ubicaciones = ubicarImagenesDeSkin(nombres);
    expect(ubicaciones.note1).toBe('mania-note1.png');
    expect(ubicaciones.note2).toBe('mania-note2.png');
    expect(ubicaciones.note1H).toBe('mania-note1H.png');
    expect(ubicaciones.note2H).toBe('mania-note2H.png');
    expect(ubicaciones.note1L).toBe('mania-note1L.png');
    expect(ubicaciones.note2L).toBe('mania-note2L.png');
    expect(ubicaciones.key1).toBe('mania-key1.png');
    expect(ubicaciones.key2).toBe('mania-key2.png');
    expect(ubicaciones.key1D).toBe('mania-key1D.png');
    expect(ubicaciones.key2D).toBe('mania-key2D.png');
    expect(Object.keys(ubicaciones)).toHaveLength(10);
  });

  it('es insensible a mayusculas/minusculas (la skin real de Arnold trae "mania-key1.PNG")', () => {
    const ubicaciones = ubicarImagenesDeSkin(['MANIA-KEY1.PNG', 'mania-note2l.png']);
    expect(ubicaciones.key1).toBe('MANIA-KEY1.PNG');
    expect(ubicaciones.note2L).toBe('mania-note2l.png');
  });

  it('no confunde note1 con note1H (el nombre mas largo no matchea por substring)', () => {
    const ubicaciones = ubicarImagenesDeSkin(['mania-note1H.png']);
    expect(ubicaciones.note1H).toBe('mania-note1H.png');
    expect(ubicaciones.note1).toBeUndefined();
  });

  it('no confunde key1 con key1D', () => {
    const ubicaciones = ubicarImagenesDeSkin(['mania-key1D.png']);
    expect(ubicaciones.key1D).toBe('mania-key1D.png');
    expect(ubicaciones.key1).toBeUndefined();
  });

  it('a una skin incompleta le faltan claves, no lanza ni las inventa', () => {
    const ubicaciones = ubicarImagenesDeSkin(['mania-note1.png', 'mania-key1.png']);
    expect(Object.keys(ubicaciones)).toEqual(['note1', 'key1']);
  });

  it('ignora archivos con extension no soportada (por ejemplo un .wav con nombre parecido)', () => {
    const ubicaciones = ubicarImagenesDeSkin(['mania-note1.wav']);
    expect(ubicaciones.note1).toBeUndefined();
  });

  it('sin ninguna imagen conocida, devuelve vacio', () => {
    expect(ubicarImagenesDeSkin(['skin.ini', 'cursor.png', 'applause.wav'])).toEqual({});
  });
});

describe('extraerImagenesDeOsk', () => {
  it('arma un Blob por cada imagen encontrada, con el mime correcto', async () => {
    const osk = armarOsk({
      'mania-note1.png': PNG_1X1,
      'mania-key1D.jpg': PNG_1X1,
      'skin.ini': new TextEncoder().encode('[General]\nName: prueba\n'),
    });

    const imagenes = await extraerImagenesDeOsk(osk);

    expect(imagenes.note1).toBeInstanceOf(Blob);
    expect(imagenes.note1?.type).toBe('image/png');
    expect(imagenes.note1?.size).toBe(3);
    expect(imagenes.key1D?.type).toBe('image/jpeg');
    // El resto de las 10 claves, ausentes: skin incompleta, no rellenada.
    expect(imagenes.note2).toBeUndefined();
    expect(imagenes.note1H).toBeUndefined();
  });

  it('una skin a la que le faltan imagenes no lanza (fallback, no requisito)', async () => {
    const osk = armarOsk({ 'mania-note1.png': PNG_1X1 });
    const imagenes = await extraerImagenesDeOsk(osk);
    expect(Object.keys(imagenes)).toEqual(['note1']);
  });

  it('rechaza un archivo sin ninguna imagen de skin conocida (no parece ser una skin de mania)', async () => {
    const osk = armarOsk({ 'skin.ini': new TextEncoder().encode('[General]\n') });
    await expect(extraerImagenesDeOsk(osk)).rejects.toThrow(/no parece ser una skin/);
  });
});
