// T-042: e2e de la copia de seguridad (ajustes, tarjeta Biblioteca). Exporta
// la biblioteca de un perfil, la restaura en un perfil limpio y comprueba que
// importar dos veces no duplica y que un archivo que no es un respaldo da un
// mensaje sin tocar nada.

import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Cuantas canciones hay en la base de IndexedDB (0 si todavia no existe la tienda). */
async function contarCanciones(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const peticion = indexedDB.open('tetra-mapas');
        peticion.onerror = () => resolve(0);
        peticion.onsuccess = () => {
          const db = peticion.result;
          if (!db.objectStoreNames.contains('canciones')) {
            db.close();
            resolve(0);
            return;
          }
          const cuenta = db.transaction('canciones', 'readonly').objectStore('canciones').count();
          cuenta.onsuccess = () => {
            db.close();
            resolve(cuenta.result);
          };
          cuenta.onerror = () => {
            db.close();
            resolve(0);
          };
        };
      }),
  );
}

async function irAAjustes(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible();
}

test('exportar un respaldo, restaurarlo en un perfil limpio y no duplicar al repetir', async ({
  page,
  browser,
}) => {
  // Perfil 1: la demo se siembra sola; se le suma un ajuste propio.
  await page.addInitScript(() => localStorage.setItem('tetra:velocidad-usuario', '9'));
  await irAAjustes(page);
  await expect.poll(() => contarCanciones(page), { timeout: 30_000 }).toBeGreaterThan(0);
  const cancionesOriginales = await contarCanciones(page);

  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar respaldo' }).click(),
  ]);
  expect(descarga.suggestedFilename()).toMatch(/^tetra-respaldo-\d{4}-\d{2}-\d{2}\.zip$/);
  await expect(page.locator('.tetra-ajustes-estado')).toContainText('Exportado: tetra-respaldo-');
  const carpeta = mkdtempSync(join(tmpdir(), 'tetra-respaldo-'));
  const ruta = join(carpeta, descarga.suggestedFilename());
  await descarga.saveAs(ruta);

  // Importar el mismo respaldo en el mismo perfil: nada nuevo, nada duplicado.
  page.on('dialog', (dialogo) => void dialogo.accept());
  await page.locator('#tetra-respaldo-archivo').setInputFiles(ruta);
  await expect(page.locator('.tetra-ajustes-estado')).toContainText('0 canciones nuevas');
  await expect(page.locator('.tetra-ajustes-estado')).toContainText(
    `${cancionesOriginales} ya ${cancionesOriginales === 1 ? 'existente' : 'existentes'}`,
  );
  expect(await contarCanciones(page)).toBe(cancionesOriginales);
  await expect(page.locator('.tetra-ajustes-error')).toBeEmpty();

  // Perfil limpio (la marca de la demo evita que se siembre otra): el respaldo la trae.
  const contexto = await browser.newContext();
  try {
    const limpio = await contexto.newPage();
    await limpio.addInitScript(() => localStorage.setItem('tetra:demo-sembrada', '1'));
    await irAAjustes(limpio);
    expect(await contarCanciones(limpio)).toBe(0);
    limpio.on('dialog', (dialogo) => void dialogo.accept());

    await limpio.locator('#tetra-respaldo-archivo').setInputFiles(ruta);
    await expect(limpio.locator('.tetra-ajustes-estado')).toContainText(
      `${cancionesOriginales} ${cancionesOriginales === 1 ? 'canción nueva' : 'canciones nuevas'}`,
    );
    expect(await contarCanciones(limpio)).toBe(cancionesOriginales);
    // Los ajustes del respaldo (no habia nada distinto que pisar) quedaron puestos.
    expect(await limpio.evaluate(() => localStorage.getItem('tetra:velocidad-usuario'))).toBe('9');
    await expect(limpio.locator('#tetra-velocidad-valor')).toHaveValue('9');

    // Y una segunda vez no suma nada.
    await limpio.locator('#tetra-respaldo-archivo').setInputFiles(ruta);
    await expect(limpio.locator('.tetra-ajustes-estado')).toContainText('0 canciones nuevas');
    expect(await contarCanciones(limpio)).toBe(cancionesOriginales);
  } finally {
    await contexto.close();
  }
});

test('un archivo que no es un respaldo muestra un error y no toca la biblioteca', async ({ page }) => {
  await irAAjustes(page);
  await expect.poll(() => contarCanciones(page), { timeout: 30_000 }).toBeGreaterThan(0);
  const antes = await contarCanciones(page);

  const carpeta = mkdtempSync(join(tmpdir(), 'tetra-respaldo-'));
  const falso = join(carpeta, 'no-es-un-respaldo.zip');
  writeFileSync(falso, 'esto no es un zip');
  await page.locator('#tetra-respaldo-archivo').setInputFiles(falso);

  await expect(page.locator('.tetra-ajustes-error')).toContainText('no es un zip válido');
  expect(await contarCanciones(page)).toBe(antes);
  // Los botones vuelven a quedar disponibles.
  await expect(page.getByRole('button', { name: 'Importar respaldo' })).toBeEnabled();
});
