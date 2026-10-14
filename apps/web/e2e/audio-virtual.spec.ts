// T-066 (paso 3): e2e de las canciones con audio virtual. Un set sintetico de
// dos piezas (muestras WAV de 50 ms armadas aca) entra como dos canciones,
// reimportarlo da "2 ya estaban", se juega una con "Ver auto" hasta los
// resultados (el reloj corre sobre el buffer renderizado) y el mapeador queda
// deshabilitado. Va por la interfaz como una persona. Corre con `--mute-audio`.

import { strToU8, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __tetraDebug?: {
      clock: { now(): number; isRunning: boolean };
      ctx: { currentTime: number };
    };
  }
}

const X_DE_COLUMNA = [64, 192, 320, 448];

/** Un WAV mono de 16 bits y 44,1 kHz con un tono de `ms` milisegundos. */
function wavDeTono(ms: number, frecuencia: number): Uint8Array {
  const frecuenciaDeMuestreo = 44100;
  const muestras = Math.round((frecuenciaDeMuestreo * ms) / 1000);
  const bytes = new Uint8Array(44 + muestras * 2);
  const vista = new DataView(bytes.buffer);
  const texto = (desde: number, valor: string): void => {
    for (let i = 0; i < valor.length; i++) bytes[desde + i] = valor.charCodeAt(i);
  };
  texto(0, 'RIFF');
  vista.setUint32(4, 36 + muestras * 2, true);
  texto(8, 'WAVE');
  texto(12, 'fmt ');
  vista.setUint32(16, 16, true);
  vista.setUint16(20, 1, true); // PCM
  vista.setUint16(22, 1, true); // mono
  vista.setUint32(24, frecuenciaDeMuestreo, true);
  vista.setUint32(28, frecuenciaDeMuestreo * 2, true);
  vista.setUint16(32, 2, true);
  vista.setUint16(34, 16, true);
  texto(36, 'data');
  vista.setUint32(40, muestras * 2, true);
  for (let i = 0; i < muestras; i++) {
    const envolvente = 1 - i / muestras;
    const valor = Math.sin((2 * Math.PI * frecuencia * i) / frecuenciaDeMuestreo) * 0.5 * envolvente;
    vista.setInt16(44 + i * 2, Math.round(valor * 32767), true);
  }
  return bytes;
}

/**
 * Una pieza virtual: 20 notas con keysound `k.wav` y un acompanamiento con
 * lineas Sample (`fondo.wav`). `desfase` mueve las notas para que dos piezas
 * no tengan las mismas (si no, la deduplicacion las tomaria por la misma).
 */
function osuVirtual(version: string, desfase: number): string {
  const notas: string[] = [];
  for (let i = 0; i < 20; i++) {
    notas.push(`${X_DE_COLUMNA[i % 4]},192,${2000 + desfase + i * 300},1,0,0:0:0:0:k.wav`);
  }
  return [
    'osu file format v14',
    '',
    '[General]',
    'AudioFilename: virtual',
    'AudioLeadIn: 0',
    'PreviewTime: 0',
    'Mode: 3',
    '',
    '[Metadata]',
    'Title:Set virtual',
    'Artist:Tetra',
    'Creator:Prueba',
    `Version:${version}`,
    '',
    '[Difficulty]',
    'HPDrainRate:5',
    'CircleSize:4',
    'OverallDifficulty:5',
    '',
    '[Events]',
    'Sample,500,0,"fondo.wav",70',
    'Sample,1500,0,"fondo.wav",70',
    'Sample,3000,1,"fondo.wav",100',
    '',
    '[TimingPoints]',
    '0,500,4,2,1,80,1,0',
    '',
    '[HitObjects]',
    ...notas,
    '',
  ].join('\n');
}

function crearOszVirtual(): Buffer {
  const zip = zipSync({
    '1.osu': strToU8(osuVirtual('Canon - 4K EX', 0)),
    '2.osu': strToU8(osuVirtual('Campanella - 4K Full', 100)),
    'k.wav': wavDeTono(50, 880),
    'fondo.wav': wavDeTono(50, 440),
  });
  return Buffer.from(zip);
}

async function irASongSelect(page: Page): Promise<void> {
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

test('un set virtual de dos piezas entra como dos canciones, se juega con Ver auto y reimportarlo da 2 ya estaban', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await irASongSelect(page);
  await importar(page, 'set-virtual.osz', crearOszVirtual());

  // Dos tarjetas (una por pieza) y el resumen de la importacion.
  await expect(page.locator('.tetra-song-item')).toHaveCount(2);
  await expect(page.locator('.tetra-song-select-error-texto')).toContainText(
    'Set virtual: 2 canciones nuevas.',
  );
  await expect(page.locator('.tetra-song-item').filter({ hasText: 'Canon' })).toHaveCount(1);
  await expect(page.locator('.tetra-song-item').filter({ hasText: 'Campanella' })).toHaveCount(1);

  // El mapeador no abre canciones virtuales: el boton esta, pero deshabilitado.
  await page.getByText('Canon', { exact: true }).first().click();
  const editar = page.getByRole('button', { name: /mapeador/i });
  await expect(editar).toBeDisabled();
  await expect(editar).toHaveAttribute('title', 'El mapeador no abre canciones con audio virtual.');

  // Ver auto: el reloj corre sobre el buffer renderizado y llega a los resultados.
  await page.getByRole('button', { name: 'Ver auto', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__tetraDebug !== undefined &&
      window.__tetraDebug.clock.isRunning &&
      window.__tetraDebug.clock.now() > 300,
    { timeout: 30_000 },
  );
  await expect(page.locator('.tetra-hud .tetra-reproduccion-etiqueta')).toHaveText('AUTO');
  await expect(page.locator('.tetra-resultados')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.tetra-resultados-rango')).toHaveText('SS');
  await expect(page.locator('.tetra-resultados-fila-cantidad').first()).toHaveText('20');

  // Reimportar el mismo set: las dos ya estaban, ninguna tarjeta nueva.
  await page.getByRole('button', { name: 'Volver al song select' }).click();
  await expect(page.getByRole('heading', { name: 'Elegir canción' })).toBeVisible();
  await importar(page, 'set-virtual.osz', crearOszVirtual());
  await expect(page.locator('.tetra-song-select-error-texto')).toContainText(
    'Set virtual: 2 ya estaban.',
  );
  await expect(page.locator('.tetra-song-item')).toHaveCount(2);
});
