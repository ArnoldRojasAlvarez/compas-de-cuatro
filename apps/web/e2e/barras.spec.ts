// T-058: e2e de las barras de velocidad y offset de ajustes. Velocidad y offset
// se ajustan con barra (como el volumen), guardan al mover, y las cinco barras
// se ven iguales: mismo largo de riel y el valor en la misma columna.

import { expect, test, type Page } from '@playwright/test';

async function irAAjustes(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible();
}

function guardado(page: Page, clave: string): Promise<string | null> {
  return page.evaluate((c) => localStorage.getItem(c), clave);
}

/** El valor en vivo que acompana a una barra (el hermano de su riel dentro de la misma barra). */
function valorDe(page: Page, id: string) {
  return page.locator(`.tetra-ajustes-barra:has(#${id}) .tetra-ajustes-dato`);
}

test('velocidad: la barra va de 1 a 12, muestra el nivel y los ms, y guarda al mover', async ({
  page,
}) => {
  await irAAjustes(page);
  const barra = page.locator('#tetra-velocidad-valor');
  await expect(barra).toHaveAttribute('type', 'range');
  await expect(barra).toHaveAttribute('min', '1');
  await expect(barra).toHaveAttribute('max', '12');
  // Por defecto: nivel 3, 1200 ms.
  await expect(barra).toHaveValue('3');
  await expect(valorDe(page, 'tetra-velocidad-valor')).toHaveText('3 · 1200 ms');

  await barra.fill('7');
  await expect(valorDe(page, 'tetra-velocidad-valor')).toHaveText('7 · 514 ms');
  expect(await guardado(page, 'tetra:velocidad-usuario')).toBe('7');

  await barra.fill('12');
  await expect(valorDe(page, 'tetra-velocidad-valor')).toHaveText('12 · 300 ms');
  expect(await guardado(page, 'tetra:velocidad-usuario')).toBe('12');

  // Sobrevive a recargar.
  await page.reload();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.locator('#tetra-velocidad-valor')).toHaveValue('12');
  await expect(valorDe(page, 'tetra-velocidad-valor')).toHaveText('12 · 300 ms');
});

test('offset: la barra va de -150 a +150, el valor lleva signo y guarda al mover', async ({
  page,
}) => {
  await irAAjustes(page);
  const barra = page.locator('#tetra-offset-valor');
  await expect(barra).toHaveAttribute('type', 'range');
  await expect(barra).toHaveAttribute('min', '-150');
  await expect(barra).toHaveAttribute('max', '150');
  await expect(barra).toHaveValue('0');
  await expect(valorDe(page, 'tetra-offset-valor')).toHaveText('0 ms');
  // Sin offset guardado no se escribe nada solo por abrir ajustes.
  expect(await guardado(page, 'tetra:offset-usuario')).toBeNull();

  await barra.fill('12');
  await expect(valorDe(page, 'tetra-offset-valor')).toHaveText('+12 ms');
  expect(await guardado(page, 'tetra:offset-usuario')).toBe('12');

  await barra.fill('-8');
  await expect(valorDe(page, 'tetra-offset-valor')).toHaveText('-8 ms');
  expect(await guardado(page, 'tetra:offset-usuario')).toBe('-8');

  // Sobrevive a recargar.
  await page.reload();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.locator('#tetra-offset-valor')).toHaveValue('-8');
  await expect(valorDe(page, 'tetra-offset-valor')).toHaveText('-8 ms');
});

test('offset: los botones - y + mueven 1 ms, con Shift 5, y el doble clic vuelve a 0', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('tetra:offset-usuario') === null) {
      localStorage.setItem('tetra:offset-usuario', '10');
    }
  });
  await irAAjustes(page);
  const barra = page.locator('#tetra-offset-valor');
  const valor = valorDe(page, 'tetra-offset-valor');
  const menos = page.getByRole('button', { name: 'Bajar el offset 1 ms' });
  const mas = page.getByRole('button', { name: 'Subir el offset 1 ms' });
  await expect(valor).toHaveText('+10 ms');

  await mas.click();
  await expect(valor).toHaveText('+11 ms');
  expect(await guardado(page, 'tetra:offset-usuario')).toBe('11');

  await menos.click();
  await menos.click();
  await expect(valor).toHaveText('+9 ms');
  expect(await guardado(page, 'tetra:offset-usuario')).toBe('9');

  await mas.click({ modifiers: ['Shift'] });
  await expect(valor).toHaveText('+14 ms');
  await menos.click({ modifiers: ['Shift'] });
  await menos.click({ modifiers: ['Shift'] });
  await expect(valor).toHaveText('+4 ms');
  expect(await guardado(page, 'tetra:offset-usuario')).toBe('4');
  await expect(barra).toHaveValue('4');

  // Cruza el cero: los botones siguen sin saltos.
  await menos.click({ modifiers: ['Shift'] });
  await expect(valor).toHaveText('-1 ms');
  expect(await guardado(page, 'tetra:offset-usuario')).toBe('-1');

  // Doble clic cerca del extremo derecho: el primer clic mueve la barra lejos del cero,
  // el doble clic la devuelve a 0.
  const caja = (await barra.boundingBox())!;
  await barra.dblclick({ position: { x: caja.width - 4, y: caja.height / 2 } });
  await expect(barra).toHaveValue('0');
  await expect(valor).toHaveText('0 ms');
  expect(await guardado(page, 'tetra:offset-usuario')).toBe('0');
});

test('offset: con la barra enfocada, las flechas mueven 1 ms y Shift+flecha 5 ms', async ({
  page,
}) => {
  await irAAjustes(page);
  const barra = page.locator('#tetra-offset-valor');
  const valor = valorDe(page, 'tetra-offset-valor');
  await barra.focus();

  await barra.press('ArrowRight');
  await expect(valor).toHaveText('+1 ms');
  await barra.press('Shift+ArrowRight');
  await expect(valor).toHaveText('+6 ms');
  expect(await guardado(page, 'tetra:offset-usuario')).toBe('6');
  await barra.press('Shift+ArrowLeft');
  await barra.press('Shift+ArrowDown');
  await expect(valor).toHaveText('-4 ms');
  await barra.press('ArrowLeft');
  await expect(valor).toHaveText('-5 ms');
  expect(await guardado(page, 'tetra:offset-usuario')).toBe('-5');
});

test('offset guardado fuera de la barra: la barra queda en el tope y el numero muestra el real', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('tetra:offset-usuario') === null) {
      localStorage.setItem('tetra:offset-usuario', '240');
    }
  });
  await irAAjustes(page);
  const barra = page.locator('#tetra-offset-valor');
  const valor = valorDe(page, 'tetra-offset-valor');
  await expect(barra).toHaveValue('150');
  await expect(valor).toHaveText('+240 ms');
  // Abrir ajustes no pisa el valor real.
  expect(await guardado(page, 'tetra:offset-usuario')).toBe('240');

  // Con + no se aleja mas; con - vuelve de a 1 ms desde el valor real.
  await page.getByRole('button', { name: 'Subir el offset 1 ms' }).click();
  await expect(valor).toHaveText('+240 ms');
  await page.getByRole('button', { name: 'Bajar el offset 1 ms' }).click();
  await expect(valor).toHaveText('+239 ms');
  expect(await guardado(page, 'tetra:offset-usuario')).toBe('239');

  // Mover la barra reemplaza el valor real.
  await barra.fill('100');
  await expect(valor).toHaveText('+100 ms');
  expect(await guardado(page, 'tetra:offset-usuario')).toBe('100');
});

test('las cinco barras se ven iguales y Ajustes sigue entrando en 1280x800', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await irAAjustes(page);
  const ids = [
    'tetra-offset-valor',
    'tetra-velocidad-valor',
    'tetra-volumen-valor',
    'tetra-efectos-valor',
    'tetra-atenuacion-valor',
  ];
  const medidas = [];
  for (const id of ids) {
    const riel = (await page.locator(`#${id}`).boundingBox())!;
    const dato = (await valorDe(page, id).boundingBox())!;
    const barra = (await page.locator(`.tetra-ajustes-barra:has(#${id})`).boundingBox())!;
    // Posiciones respecto del inicio de la barra: el riel y el valor caen en las mismas columnas.
    medidas.push({
      id,
      ancho: Math.round(riel.width),
      rielX: Math.round(riel.x - barra.x),
      datoX: Math.round(dato.x - barra.x),
      datoAncho: Math.round(dato.width),
    });
  }
  const primera = medidas[0]!;
  expect(primera.ancho).toBeGreaterThan(100);
  for (const m of medidas) {
    expect(m, m.id).toEqual({ ...primera, id: m.id });
  }

  // El golpe y las barras de la tarjeta Juego comparten el borde derecho de los controles.
  await expect(
    page.locator('.tetra-ajustes-seccion-juego .tetra-ajustes-barra'),
  ).toHaveCount(4);
  await expect(page.locator('#tetra-hitsound-tipo')).toBeVisible();

  // Nada queda cortado por el borde de la ventana.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
    .toBeLessThanOrEqual(800);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1280);
});
