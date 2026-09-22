#!/usr/bin/env node
// T-009: genera un .osk minimo pero valido para probar la importacion de
// skins, tanto a mano como en tests (ver docs/tickets/T-009-skins-osk.md,
// "Nota de derechos": la skin real de Arnold, "- !Sad Cookie.osk", es
// contenido de terceros y no se versiona; este es sintetico, igual en
// espiritu que fixtures/mania-test/mapa-de-prueba.osz de T-005, ver
// tools/generar-fixture-mania-test.mjs).
//
// Trae las 10 imagenes que esta primera version del juego usa (ver el
// ticket, "Alcance de esta primera version"), todas el mismo PNG minimo de
// 1x1 (el ticket pide justamente eso, "Para tests, generar un .osk minimo
// de prueba con imagenes de 1x1"): no importa como se vean, solo que sean
// PNG validos que el navegador pueda decodificar con createImageBitmap.
//
// Regenerar: node tools/generar-fixture-skin-test.mjs
// Es determinista: siempre genera el mismo .osk byte a byte.

import { zipSync } from 'fflate';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESTINO_DIR = join(__dirname, '..', 'fixtures', 'skin-test');

// PNG minimo valido de 1x1 (un pixel gris, sin transparencia), 68 bytes.
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Los 10 nombres que packages/storage/src/osk.ts busca (prefijo
// "mania-", ver ese archivo): las 6 de nota/LN por grupo de columna
// (exterior/interior) mas los 4 receptores (sin pulsar y pulsado).
const NOMBRES_IMAGENES = [
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
];

function main() {
  mkdirSync(DESTINO_DIR, { recursive: true });

  const png = Buffer.from(PNG_1X1_BASE64, 'base64');
  const entradas = {};
  for (const nombre of NOMBRES_IMAGENES) {
    entradas[nombre] = png;
  }
  // skin.ini de verdad, minimo: osk.ts no lo lee (ver el ticket, "Fuera de
  // esta version": layout desde skin.ini queda afuera), pero se incluye
  // igual para que el .osk se parezca a uno real y para no depender de
  // que la ausencia de skin.ini no rompa nada en el futuro.
  entradas['skin.ini'] = new TextEncoder().encode('[General]\nName: Skin de prueba T-009\n');

  const zipData = zipSync(entradas, { mtime: new Date('2020-01-01T00:00:00Z') }); // fecha fija: zip determinista

  const destino = join(DESTINO_DIR, 'skin-de-prueba.osk');
  writeFileSync(destino, zipData);
  console.log(`Generado: ${destino} (${zipData.length} bytes, ${NOMBRES_IMAGENES.length} imagenes)`);
}

main();
