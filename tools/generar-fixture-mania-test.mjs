#!/usr/bin/env node
// T-005: genera un .osz minimo pero valido para probar la importacion a
// mano (ver docs/tickets/T-005-importador-osu.md, "Terminado cuando": "un
// .osz real importado y jugable"). No hay ningun .osz de verdad en el repo
// porque el contenido de terceros no se versiona (ver el ticket,
// "Contexto"): este es sintetico, generado por este script, igual en
// espiritu que fixtures/click-120 (ver tools/generar-fixture-click.py),
// pero empaquetado como .osu + .wav dentro de un zip .osz de verdad.
//
// Es un mapa de prueba de importacion, no de juego: el audio es un blip
// corto que marca cada nota para poder confirmar de oido que el import
// quedo sincronizado, no una cancion real.
//
// Regenerar: node tools/generar-fixture-mania-test.mjs
// Es determinista: siempre genera el mismo .osz byte a byte.

import { zipSync } from 'fflate';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESTINO_DIR = join(__dirname, '..', 'fixtures', 'mania-test');
const NOTA_INTERVALO_MS = 300;
const CANTIDAD_NOTAS = 20;
const SAMPLE_RATE = 44100;
const COLUMNAS_X = [64, 192, 320, 448];

function generarOsu() {
  const lineasHitObjects = [];
  for (let i = 0; i < CANTIDAD_NOTAS; i++) {
    const time = i * NOTA_INTERVALO_MS;
    const x = COLUMNAS_X[i % 4];
    if (i === CANTIDAD_NOTAS - 1) {
      // La ultima nota es una hold (LN) de 600 ms, para tener al menos una
      // en el fixture (ver el ticket, seccion "Tests").
      lineasHitObjects.push(`${x},192,${time},128,0,${time + 600}:0:0:0:0:`);
    } else {
      lineasHitObjects.push(`${x},192,${time},1,0,0:0:0:0:`);
    }
  }

  // beatLength 300 -> bpm 200 (60000 / 300), consistente con el intervalo
  // entre notas de este mismo generador.
  return `osu file format v14

[General]
AudioFilename: audio.wav
AudioLeadIn: 0
PreviewTime: 0
Countdown: 0
SampleSet: Soft
Mode: 3

[Metadata]
Title:Mapa de prueba T-005
Artist:Tetra
Creator:Arnold Alvarez
Version:Prueba de importacion

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:5
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,300,4,2,1,50,1,0

[HitObjects]
${lineasHitObjects.join('\n')}
`;
}

/** WAV PCM 16 bits, mono, 44100 Hz, con un blip corto de 880 Hz en cada nota. */
function generarWav(duracionSegundos) {
  const cantidadMuestras = Math.floor(SAMPLE_RATE * duracionSegundos);
  const dataSize = cantidadMuestras * 2; // 16 bits = 2 bytes por muestra
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // formato PCM
  buffer.writeUInt16LE(1, 22); // 1 canal (mono)
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits por muestra
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < cantidadMuestras; i++) {
    const tSeg = i / SAMPLE_RATE;
    const tMs = tSeg * 1000;
    const faseDesdeBlip = tMs % NOTA_INTERVALO_MS;
    let muestra = 0;
    if (faseDesdeBlip < 30) {
      const envolvente = Math.exp(-faseDesdeBlip / 8);
      muestra = 0.3 * envolvente * Math.sin(2 * Math.PI * 880 * tSeg);
    }
    buffer.writeInt16LE(Math.round(muestra * 32767), 44 + i * 2);
  }

  return buffer;
}

function main() {
  mkdirSync(DESTINO_DIR, { recursive: true });

  const osuTexto = generarOsu();
  const duracionSegundos = (CANTIDAD_NOTAS * NOTA_INTERVALO_MS + 1000) / 1000;
  const wavBuffer = generarWav(duracionSegundos);

  const zipData = zipSync(
    {
      'mapa.osu': new TextEncoder().encode(osuTexto),
      'audio.wav': new Uint8Array(wavBuffer.buffer, wavBuffer.byteOffset, wavBuffer.byteLength),
    },
    { mtime: new Date('2020-01-01T00:00:00Z') }, // fecha fija (rango valido de zip: 1980-2099): el zip sale byte a byte igual en cada regeneracion
  );

  const destino = join(DESTINO_DIR, 'mapa-de-prueba.osz');
  writeFileSync(destino, zipData);
  console.log(`Generado: ${destino} (${zipData.length} bytes, ${duracionSegundos}s de audio)`);
}

main();
