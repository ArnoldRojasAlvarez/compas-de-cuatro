// T-034 y T-046: e2e de la edicion del mapeador (seleccion, copiar, pegar,
// mover, cuantizar) y del minimapa. Va por la interfaz con un audio real, como
// flujo.spec.ts. Las notas se leen del borrador que el editor guarda en
// localStorage despues de cada paso (es lo que sobrevive a recargar), asi se
// comprueban tiempos y columnas exactos y no solo el conteo.
//
// Cada test arranca con un contexto limpio. Playwright corre con --mute-audio.

import { expect, test, type Page } from '@playwright/test';

const AUDIO_DE_PRUEBA = '../../fixtures/click-120.wav';

interface NotaLeida {
  kind: 'tap' | 'hold';
  time: number;
  endTime?: number;
  column: number;
}

/** Abre el editor con el audio cargado y la rejilla en 120 BPM, offset 0, 1/4 (un slot = 125 ms). */
async function abrirEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mapeador', exact: true }).click();
  await page.setInputFiles('.tetra-mp-archivo', AUDIO_DE_PRUEBA);
  await expect(page.locator('.tetra-mp-estado')).toContainText('golpes detectados', {
    timeout: 60_000,
  });
  const bpm = page.getByLabel('BPM', { exact: true });
  await bpm.fill('120');
  await bpm.blur();
  const offset = page.getByLabel('Offset (ms)');
  await offset.fill('0');
  await offset.blur();
  await enfocarEditor(page);
}

/** Saca el foco de los campos de texto: ahi los atajos del editor no actuan. */
async function enfocarEditor(page: Page): Promise<void> {
  await page.locator('.tetra-mp-titulo').click();
}

/** Las notas del mapa tal como las guarda el borrador, en [columna, tiempo]. */
async function leerNotas(page: Page): Promise<[number, number][]> {
  const notas = await page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('tetra:mapeador-borrador') ?? '{"notas":[]}') as {
        notas: NotaLeida[];
      }).notas,
  );
  return notas.map((n) => [n.column, n.time]);
}

/** Pone D F J K en los slots 0 a 3 (0, 125, 250 y 375 ms): una nota por columna. */
async function ponerEscalera(page: Page): Promise<void> {
  await page.keyboard.press('Home');
  const teclas = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
  for (let i = 0; i < teclas.length; i++) {
    await page.keyboard.press(teclas[i]!);
    await page.keyboard.press('ArrowUp');
  }
  await page.keyboard.press('Home');
  expect(await leerNotas(page)).toEqual([
    [0, 0],
    [1, 125],
    [2, 250],
    [3, 375],
  ]);
}

/** Geometria del canvas, la misma cuenta que hace mapeador.ts (geometria() y yCabezal). */
async function geometriaDelCanvas(page: Page): Promise<{
  x: (columna: number) => number;
  /** Y de un instante con el cabezal en 0 y el zoom por defecto (0.3 px por ms). */
  y: (ms: number) => number;
}> {
  const caja = (await page.locator('.tetra-mp-canvas').boundingBox())!;
  const ancho = Math.max(200, Math.floor(caja.width));
  const alto = Math.max(200, Math.floor(caja.height));
  const anchoCol = Math.min(96, Math.floor(ancho / 6));
  const izquierda = Math.floor((ancho - anchoCol * 4) / 2);
  const yCabezal = Math.round(alto * 0.8);
  return {
    x: (columna) => caja.x + izquierda + anchoCol * (columna + 0.5),
    y: (ms) => caja.y + yCabezal - ms * 0.3,
  };
}

/** Mayus + arrastrar entre dos puntos de la pantalla (el rectangulo de seleccion). */
async function arrastrarConMayus(
  page: Page,
  desde: { x: number; y: number },
  hasta: { x: number; y: number },
): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(desde.x, desde.y);
  await page.mouse.down();
  await page.mouse.move(hasta.x, hasta.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

test('mapeador: elegir todo, copiar y pegar cuatro pulsos despues, y un Ctrl+Z deshace el pegado entero', async ({
  page,
}) => {
  await abrirEditor(page);
  await ponerEscalera(page);

  await page.keyboard.press('Control+a');
  await expect(page.locator('.tetra-mp-elegidas')).toHaveText('4 elegidas');
  await page.keyboard.press('Control+c');

  // Cuatro pulsos a 120 BPM son 2000 ms: PageUp mueve el cabezal exactamente eso.
  await page.keyboard.press('PageUp');
  await page.keyboard.press('Control+v');
  expect(await leerNotas(page)).toEqual([
    [0, 0],
    [1, 125],
    [2, 250],
    [3, 375],
    [0, 2000],
    [1, 2125],
    [2, 2250],
    [3, 2375],
  ]);
  // Lo pegado queda elegido.
  await expect(page.locator('.tetra-mp-elegidas')).toHaveText('4 elegidas');

  // Un solo Ctrl+Z quita el pegado entero; Ctrl+Y lo devuelve.
  await page.keyboard.press('Control+z');
  expect(await leerNotas(page)).toHaveLength(4);
  await page.keyboard.press('Control+y');
  expect(await leerNotas(page)).toHaveLength(8);

  // Pegar de nuevo cuatro pulsos mas adelante, ocho veces seguidas.
  for (let k = 0; k < 8; k++) {
    await page.keyboard.press('PageUp');
    await page.keyboard.press('Control+v');
  }
  const notas = await leerNotas(page);
  expect(notas).toHaveLength(8 + 8 * 4);
  expect(notas.filter(([c]) => c === 3).map(([, t]) => t)).toEqual(
    Array.from({ length: 10 }, (_, k) => 375 + k * 2000),
  );
});

test('mapeador: Mayus + arrastrar elige un rectangulo y se copia alineado a su borde', async ({ page }) => {
  await abrirEditor(page);
  await ponerEscalera(page);
  const geo = await geometriaDelCanvas(page);

  // Columnas 1 a 3 y slots 0 a 3: tres notas (F, J y K), con el borde del rectangulo en el instante 0.
  await arrastrarConMayus(page, { x: geo.x(1), y: geo.y(0) + 10 }, { x: geo.x(3), y: geo.y(375) - 10 });
  await expect(page.locator('.tetra-mp-elegidas')).toHaveText('3 elegidas');

  await page.keyboard.press('Control+c');
  await page.keyboard.press('PageUp');
  await page.keyboard.press('Control+v');
  // Alineado al borde del rectangulo (0), no a la primera nota (125): F cae en 2125, no en 2000.
  expect((await leerNotas(page)).filter(([, t]) => t >= 2000)).toEqual([
    [1, 2125],
    [2, 2250],
    [3, 2375],
  ]);

  // Un clic normal en una pista suelta la seleccion.
  await page.mouse.click(geo.x(0), geo.y(500));
  await expect(page.locator('.tetra-mp-elegidas')).toHaveText('');
});

test('mapeador: Alt + flechas mueve lo elegido un slot o una columna, rechaza salirse de las pistas y se deshace de a un paso', async ({
  page,
}) => {
  await abrirEditor(page);
  await ponerEscalera(page);

  await page.keyboard.press('Control+a');
  // Una corchea (1/2) son 250 ms: con la rejilla en 1/2, un slot.
  await page.keyboard.press('BracketLeft');
  await page.keyboard.press('BracketLeft');
  await page.keyboard.press('Alt+ArrowUp');
  expect(await leerNotas(page)).toEqual([
    [0, 250],
    [1, 375],
    [2, 500],
    [3, 625],
  ]);

  // La columna 3 no puede ir mas a la derecha: no se mueve nada y se avisa.
  await page.keyboard.press('Alt+ArrowRight');
  expect(await leerNotas(page)).toEqual([
    [0, 250],
    [1, 375],
    [2, 500],
    [3, 625],
  ]);
  await expect(page.locator('.tetra-mp-estado')).toContainText('No se mueve');

  // Hacia la izquierda la columna 0 tampoco puede.
  await page.keyboard.press('Alt+ArrowLeft');
  expect((await leerNotas(page))[0]).toEqual([0, 250]);

  // Abajo = mas temprano; el instante 0 es el piso: la segunda bajada se rechaza.
  await page.keyboard.press('Alt+ArrowDown');
  const alPiso = [
    [0, 0],
    [1, 125],
    [2, 250],
    [3, 375],
  ];
  expect(await leerNotas(page)).toEqual(alPiso);
  await page.keyboard.press('Alt+ArrowDown');
  expect(await leerNotas(page)).toEqual(alPiso);

  // Cada movimiento aceptado es un paso (los rechazados no cuentan): el primer
  // Ctrl+Z deshace la bajada y el segundo la subida.
  await page.keyboard.press('Control+z');
  expect((await leerNotas(page))[0]).toEqual([0, 250]);
  await page.keyboard.press('Control+z');
  expect(await leerNotas(page)).toEqual(alPiso);
  // Y las notas siguen elegidas tras deshacer: se puede volver a mover sin elegir de nuevo.
  await expect(page.locator('.tetra-mp-elegidas')).toHaveText('4 elegidas');
});

test('mapeador: cortar, eliminar con Supr y cuantizar con Q, cada uno deshacible', async ({ page }) => {
  await abrirEditor(page);
  await ponerEscalera(page);

  // Cortar: sale del mapa y se pega donde esta el cabezal.
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+x');
  expect(await leerNotas(page)).toEqual([]);
  await page.keyboard.press('PageUp');
  await page.keyboard.press('Control+v');
  expect(await leerNotas(page)).toEqual([
    [0, 2000],
    [1, 2125],
    [2, 2250],
    [3, 2375],
  ]);
  // Lo pegado queda elegido: Supr lo elimina y Ctrl+Z lo trae de vuelta (y elegido).
  await page.keyboard.press('Delete');
  expect(await leerNotas(page)).toEqual([]);
  await page.keyboard.press('Control+z');
  expect(await leerNotas(page)).toHaveLength(4);
  await expect(page.locator('.tetra-mp-elegidas')).toHaveText('4 elegidas');

  // Cuantizar a 1/2 (250 ms): 2125 y 2375 estan a medio slot y suben.
  await page.keyboard.press('BracketLeft');
  await page.keyboard.press('BracketLeft');
  await page.keyboard.press('q');
  expect(await leerNotas(page)).toEqual([
    [0, 2000],
    [1, 2250],
    [2, 2250],
    [3, 2500],
  ]);
  await page.keyboard.press('Control+z');
  expect(await leerNotas(page)).toEqual([
    [0, 2000],
    [1, 2125],
    [2, 2250],
    [3, 2375],
  ]);
});

test('mapeador: los botones de la seleccion se habilitan segun haya algo elegido y algo copiado', async ({
  page,
}) => {
  await abrirEditor(page);
  await ponerEscalera(page);
  const copiar = page.getByRole('button', { name: 'Copiar', exact: true });
  const pegar = page.getByRole('button', { name: 'Pegar', exact: true });
  await expect(copiar).toBeDisabled();
  await expect(pegar).toBeDisabled();
  await expect(copiar).toHaveAttribute('title', /Ctrl\+C/);

  await page.keyboard.press('Control+a');
  await expect(copiar).toBeEnabled();
  await copiar.click();
  await expect(pegar).toBeEnabled();
  await page.keyboard.press('PageUp');
  await pegar.click();
  expect(await leerNotas(page)).toHaveLength(8);

  // Esc suelta la seleccion.
  await page.keyboard.press('Escape');
  await expect(copiar).toBeDisabled();
});

// ---------------------------------------------------------------------------
// T-046: minimapa
// ---------------------------------------------------------------------------

/** Posicion del cabezal y duracion en ms, leidas de "m:ss.mmm / m:ss.mmm". */
async function leerPosicion(page: Page): Promise<{ ms: number; duracion: number }> {
  const texto = (await page.locator('.tetra-mp-tiempo').textContent()) ?? '';
  const [a, b] = texto.split('/').map((parte) => {
    const m = /(\d+):(\d+)\.(\d+)/.exec(parte);
    return m ? Number(m[1]) * 60_000 + Number(m[2]) * 1000 + Number(m[3]) : Number.NaN;
  });
  return { ms: a!, duracion: b! };
}

/** Cuenta pixeles de colores reconocibles en el lienzo de fondo del minimapa y mira unas columnas. */
async function leerMinimapa(
  page: Page,
  fracciones: number[] = [],
): Promise<{ ancho: number; alto: number; claros: number; ambar: number; onda: number; ambarEn: boolean[] }> {
  return page.evaluate((fr) => {
    const lienzo = document.querySelector<HTMLCanvasElement>('.tetra-mp-minimapa-fondo')!;
    const { width, height } = lienzo;
    const d = lienzo.getContext('2d')!.getImageData(0, 0, width, height).data;
    const esAmbar = (i: number): boolean => d[i]! > 200 && d[i + 1]! > 150 && d[i + 1]! < 215 && d[i + 2]! < 140;
    let claros = 0;
    let ambar = 0;
    let onda = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]!;
      const g = d[i + 1]!;
      const b = d[i + 2]!;
      if (r > 200 && g > 200 && b > 200) claros++;
      else if (esAmbar(i)) ambar++;
      else if (g > 70 && g > r + 40 && b > 60) onda++;
    }
    // La franja de arriba (3 px) es la linea ambar de los huecos: se mira su fila 1.
    const ambarEn = fr.map((f) => esAmbar((1 * width + Math.floor(f * width)) * 4));
    return { ancho: width, alto: height, claros, ambar, onda, ambarEn };
  }, fracciones);
}

async function clicEnMinimapa(page: Page, fraccion: number): Promise<void> {
  const caja = (await page.locator('.tetra-mp-minimapa-cabezal').boundingBox())!;
  await page.mouse.click(caja.x + caja.width * fraccion, caja.y + caja.height / 2);
}

test('minimapa: un clic o un arrastre en la franja salta a ese instante, con error de menos de una cubeta', async ({
  page,
}) => {
  await abrirEditor(page);
  const caja = (await page.locator('.tetra-mp-minimapa-cabezal').boundingBox())!;
  const { duracion } = await leerPosicion(page);
  expect(duracion).toBeGreaterThan(50_000);
  const cubeta = duracion / Math.floor(caja.width);

  for (const f of [0.5, 0.1, 0.9]) {
    await clicEnMinimapa(page, f);
    await expect
      .poll(async () => Math.abs((await leerPosicion(page)).ms - duracion * f), { timeout: 5000 })
      .toBeLessThan(cubeta);
  }

  // Arrastrar: el cabezal sigue al mouse hasta soltarlo.
  await page.mouse.move(caja.x + caja.width * 0.2, caja.y + caja.height / 2);
  await page.mouse.down();
  await page.mouse.move(caja.x + caja.width * 0.7, caja.y + caja.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs((await leerPosicion(page)).ms - duracion * 0.7), { timeout: 5000 })
    .toBeLessThan(cubeta);

  // El cabezal del minimapa (color de acento) se dibuja en el lienzo de arriba, en el lugar del clic.
  const acento = await page.evaluate((f) => {
    const lienzo = document.querySelector<HTMLCanvasElement>('.tetra-mp-minimapa-cabezal')!;
    const x = Math.min(lienzo.width - 1, Math.round(f * lienzo.width));
    const d = lienzo.getContext('2d')!.getImageData(x, 10, 1, 1).data;
    return d[0]! < 100 && d[1]! > 190 && d[2]! > 170;
  }, 0.7);
  expect(acento).toBe(true);
});

test('minimapa: sin notas solo muestra la onda, y generar un mapa automatico actualiza la franja', async ({
  page,
}) => {
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await abrirEditor(page);

  // Sin notas: onda si, notas y huecos no (un mapa vacio no tiene "huecos").
  await expect.poll(async () => (await leerMinimapa(page)).onda).toBeGreaterThan(50);
  const vacio = await leerMinimapa(page);
  expect(vacio.claros).toBe(0);
  expect(vacio.ambar).toBe(0);
  expect(vacio.alto).toBeGreaterThan(20);

  await page.getByRole('button', { name: 'Generar mapa automatico' }).click();
  await expect(page.locator('.tetra-mp-notas')).toContainText('notas');
  // De inmediato: aparecen las barras de notas y, como hay notas a lo largo de toda la cancion, ningun hueco.
  await expect.poll(async () => (await leerMinimapa(page)).claros, { timeout: 3000 }).toBeGreaterThan(50);
  expect((await leerMinimapa(page)).ambar).toBe(0);

  // Borrar todo vuelve a la franja solo con onda.
  await page.getByRole('button', { name: 'Borrar todo' }).click();
  await expect.poll(async () => (await leerMinimapa(page)).claros, { timeout: 3000 }).toBe(0);
  expect(errores).toEqual([]);
});

test('minimapa: los tramos de mas de 8 compases sin notas se marcan en ambar y desaparecen al llenarlos', async ({
  page,
}) => {
  await abrirEditor(page);
  // A 120 BPM, 8 compases son 16 s. Notas en 0 s y a mitad de la cancion (~30 s): hay un hueco de ~30 s a cada lado de la segunda.
  await page.keyboard.press('Home');
  await page.keyboard.press('KeyD');
  await clicEnMinimapa(page, 0.5);
  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await leerMinimapa(page, [0.25, 0.75])).ambarEn, { timeout: 3000 }).toEqual([
    true,
    true,
  ]);

  // Un compas de 8 no es hueco: notas cada ~15 s (menos de 16 s) y no queda ambar.
  await clicEnMinimapa(page, 0.25);
  await page.keyboard.press('KeyJ');
  await clicEnMinimapa(page, 0.75);
  await page.keyboard.press('KeyK');
  await expect.poll(async () => (await leerMinimapa(page)).ambar, { timeout: 3000 }).toBe(0);
});
