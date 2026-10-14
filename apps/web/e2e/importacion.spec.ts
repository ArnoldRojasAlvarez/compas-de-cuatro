// T-066 (paso 1): e2e de la importacion de .osz. Reimportar el mismo archivo no
// duplica la cancion y avisa que ya estaba; un .osz que no se puede importar
// muestra la causa en el banner (visible, sin pasar el mouse); y al abrir la
// app las canciones duplicadas que ya existian se fusionan en una, con su
// offset por cancion. Va por la interfaz como una persona.

import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';

const AUDIO_DE_PRUEBA = '../../fixtures/click-120.wav';

function osuDe(titulo: string, opciones: { teclas?: number; audio?: string } = {}): string {
  const { teclas = 4, audio = 'audio.wav' } = opciones;
  const notas: string[] = [];
  const x = [64, 192, 320, 448];
  for (let i = 0; i < 20; i++) notas.push(`${x[i % 4]},192,${2000 + i * 500},1,0,0:0:0:0:`);
  return [
    'osu file format v14',
    '',
    '[General]',
    `AudioFilename: ${audio}`,
    'AudioLeadIn: 0',
    'PreviewTime: 0',
    'Mode: 3',
    '',
    '[Metadata]',
    `Title:${titulo}`,
    'Artist:Tetra',
    'Creator:Prueba',
    'Version:Importacion',
    '',
    '[Difficulty]',
    'HPDrainRate:5',
    `CircleSize:${teclas}`,
    'OverallDifficulty:5',
    '',
    '[TimingPoints]',
    '0,500,4,2,1,50,1,0',
    '',
    '[HitObjects]',
    ...notas,
    '',
  ].join('\n');
}

function crearOsz(titulo: string, opciones: { teclas?: number; audio?: string } = {}): Buffer {
  const zip = zipSync({
    'mapa.osu': strToU8(osuDe(titulo, opciones)),
    'audio.wav': new Uint8Array(readFileSync(AUDIO_DE_PRUEBA)),
  });
  return Buffer.from(zip);
}

async function irASongSelect(page: Page): Promise<void> {
  // La marca evita que se siembre la cancion demo y ensucie los conteos.
  await page.addInitScript(() => localStorage.setItem('tetra:demo-sembrada', '1'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
}

async function importar(page: Page, nombre: string, buffer: Buffer): Promise<void> {
  await page.locator('input[type="file"][accept=".osz"]').setInputFiles({
    name: nombre,
    mimeType: 'application/octet-stream',
    buffer,
  });
}

test('importar el mismo .osz dos veces deja una sola cancion y avisa que ya estaba', async ({
  page,
}) => {
  await irASongSelect(page);
  const titulo = 'Cancion de reimportar';

  await importar(page, `${titulo}.osz`, crearOsz(titulo));
  await expect(page.locator('.tetra-song-item')).toHaveCount(1);
  await expect(page.locator('.tetra-song-select-error')).toBeHidden();

  await importar(page, `${titulo}.osz`, crearOsz(titulo));
  const banner = page.locator('.tetra-song-select-error');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('ya estaba en la biblioteca');
  await expect(banner).toContainText(titulo);
  await expect(page.locator('.tetra-song-item')).toHaveCount(1);
});

test('un .osz solo de 7K muestra la causa a la vista, sin pasar el mouse', async ({ page }) => {
  await irASongSelect(page);
  await importar(page, 'siete.osz', crearOsz('Solo siete', { teclas: 7 }));

  const banner = page.locator('.tetra-song-select-error');
  await expect(banner).toBeVisible();
  await expect(page.locator('.tetra-song-select-error-texto')).toContainText(
    'No se pudo importar siete.osz. Ninguna dificultad es de 4 teclas: el .osz trae solo mapas de 7K (1).',
  );
  await expect(page.locator('.tetra-song-item')).toHaveCount(0);
});

test('un set de audio virtual sin sus muestras falla con la causa a la vista', async ({ page }) => {
  await irASongSelect(page);
  // Sin keysounds ni lineas Sample: el mapa virtual no pide ningun sonido.
  await importar(page, 'piano.osz', crearOsz('Piano', { audio: 'virtual' }));

  await expect(page.locator('.tetra-song-select-error-texto')).toContainText(
    'Este .osz usa audio virtual pero no pide ningún sonido: no hay nada que reproducir.',
  );
});

test('un archivo dañado muestra que no se pudo abrir como zip', async ({ page }) => {
  await irASongSelect(page);
  await importar(page, 'roto.osz', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  await expect(page.locator('.tetra-song-select-error-texto')).toContainText(
    'El archivo está dañado o no es un .osz: no se pudo abrir como zip.',
  );
});

test('al abrir la app, dos canciones duplicadas se fusionan y el offset pasa a la que queda', async ({
  page,
}) => {
  await irASongSelect(page);
  const titulo = 'Cancion duplicada';
  await importar(page, `${titulo}.osz`, crearOsz(titulo));
  await expect(page.locator('.tetra-song-item')).toHaveCount(1);

  // Se arma el duplicado directo en la base (como lo dejaria un respaldo de otra
  // computadora): otra copia con otro id, mas nueva, con su propio offset.
  const idOriginal = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const abrir = indexedDB.open('tetra-mapas');
        abrir.onerror = () => reject(abrir.error);
        abrir.onsuccess = () => {
          const db = abrir.result;
          const tx = db.transaction('canciones', 'readwrite');
          const tienda = tx.objectStore('canciones');
          const lectura = tienda.getAll();
          lectura.onsuccess = () => {
            const original = lectura.result[0] as { id: string; importadaEn?: number };
            tienda.put({
              ...original,
              id: 'copia-e2e',
              importadaEn: (original.importadaEn ?? 0) + 60_000,
            });
            tx.oncomplete = () => {
              db.close();
              resolve(original.id);
            };
          };
        };
      }),
  );
  await page.evaluate(() => localStorage.setItem('tetra:offset-local:copia-e2e', '25'));

  await page.reload();
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();

  await expect(page.locator('.tetra-song-item')).toHaveCount(1);
  await expect
    .poll(() => page.evaluate((id) => localStorage.getItem(`tetra:offset-local:${id}`), idOriginal))
    .toBe('25');
  expect(await page.evaluate(() => localStorage.getItem('tetra:offset-local:copia-e2e'))).toBeNull();
});

// T-066 (paso 2): un .osz con dos pistas distintas da dos canciones; el banner
// lo dice y reimportarlo no duplica ninguna.
function crearOszDeDosPistas(titulo: string): Buffer {
  const audio = new Uint8Array(readFileSync(AUDIO_DE_PRUEBA));
  const zip = zipSync({
    'a-uno.osu': strToU8(osuDe(titulo, { audio: 'uno.wav' })),
    // Otras notas: sin esto las dos serian la misma dificultad (misma identidad).
    'b-dos.osu': strToU8(osuDe(titulo, { audio: 'dos.wav' }).replace(/2000,1/g, '2250,1')),
    'uno.wav': audio,
    'dos.wav': audio,
  });
  return Buffer.from(zip);
}

test('un .osz con dos pistas da dos canciones y reimportarlo no duplica ninguna', async ({
  page,
}) => {
  await irASongSelect(page);
  const titulo = 'Set de dos pistas';

  await importar(page, `${titulo}.osz`, crearOszDeDosPistas(titulo));
  await expect(page.locator('.tetra-song-item')).toHaveCount(2);
  const banner = page.locator('.tetra-song-select-error');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(`${titulo}: 2 canciones nuevas.`);

  await importar(page, `${titulo}.osz`, crearOszDeDosPistas(titulo));
  await expect(banner).toContainText(`${titulo}: 2 ya estaban.`);
  await expect(page.locator('.tetra-song-item')).toHaveCount(2);
});
