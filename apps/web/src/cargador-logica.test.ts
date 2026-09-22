// Tests de T-006 para la parte del cargador que no depende del DOM (ver
// cargador-logica.ts).

import { describe, expect, it } from 'vitest';
import { decodificarBlobDeAudio, mensajeDeErrorDeCarga } from './cargador-logica.js';
import type { DecodificadorDeAudio } from './cargador-logica.js';

describe('decodificarBlobDeAudio', () => {
  it('pasa los bytes del Blob al decodificador y devuelve su resultado', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const blob = new Blob([bytes]);
    const bufferFalso = {} as AudioBuffer;

    let recibido: ArrayBuffer | undefined;
    const decodificadorFalso: DecodificadorDeAudio = {
      decodeAudioData: async (arrayBuffer) => {
        recibido = arrayBuffer;
        return bufferFalso;
      },
    };

    const resultado = await decodificarBlobDeAudio(blob, decodificadorFalso);

    expect(resultado).toBe(bufferFalso);
    expect(recibido).toBeDefined();
    expect(new Uint8Array(recibido!)).toEqual(bytes);
  });

  it('propaga el error si el decodificador rechaza (audio corrupto o formato no soportado)', async () => {
    const blob = new Blob([new Uint8Array([0])]);
    const decodificadorQueFalla: DecodificadorDeAudio = {
      decodeAudioData: async () => {
        throw new Error('formato de audio no soportado');
      },
    };

    await expect(decodificarBlobDeAudio(blob, decodificadorQueFalla)).rejects.toThrow(
      /no soportado/,
    );
  });
});

describe('mensajeDeErrorDeCarga', () => {
  it('devuelve el mensaje de un Error tal cual', () => {
    expect(mensajeDeErrorDeCarga(new Error('El .osz no contiene ningun archivo .osu.'))).toBe(
      'El .osz no contiene ningun archivo .osu.',
    );
  });

  it('envuelve un valor que no es Error en un mensaje generico', () => {
    expect(mensajeDeErrorDeCarga('algo raro')).toBe('Error inesperado: algo raro');
    expect(mensajeDeErrorDeCarga(42)).toBe('Error inesperado: 42');
  });
});
