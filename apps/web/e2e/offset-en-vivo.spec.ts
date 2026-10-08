// T-060: e2e del offset en vivo. Un "jugador" con un desfase fisico constante
// (pulsa 60 ms DESPUES del click) toca una cancion importada; se comprueba que
// la media en vivo lo ve tarde (+), que subir el offset con = la acerca a 0 (y no
// la aleja: el signo es el punto delicado), que el offset de la cancion queda
// guardado y que los golpes que siguen caen de verdad cerca del centro. Tambien
// el boton "Ajustar offset" de la pausa y que en el auto nada de esto aplica.
//
// El jugador simulado se mueve con el AUDIO, no con el reloj de juego: pulsa cuando
// `clock.now() + clock.userOffset` (el instante real de la cancion) pasa de la nota
// mas el desfase. Asi, cambiar el offset mueve el reloj de juego pero no el
// desfase fisico, igual que una persona de verdad. Las pulsaciones son eventos de
// teclado; corre con `--mute-audio` (ver playwright.config.ts): no suena nada.

import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';

const AUDIO_DE_PRUEBA = '../../fixtures/click-120.wav';
const PRIMERA_NOTA_MS = 2000;
const PASO_ENTRE_NOTAS_MS = 300;
const CANTIDAD_DE_NOTAS = 80;
/** El desfase fisico del jugador simulado: pulsa esto despues de cada nota. */
const DESFASE_FISICO_MS = 60;

interface Depuracion {
  clock: { now(): number; isRunning: boolean; userOffset: number };
}

/** Un .osz de 4 teclas con una nota cada 300 ms desde los 2 s, sobre el audio del click track. */
function crearOsz(titulo: string): Buffer {
  const x = [64, 192, 320, 448];
  const notas: string[] = [];
  for (let i = 0; i < CANTIDAD_DE_NOTAS; i++) {
    notas.push(`${x[i % 4]},192,${PRIMERA_NOTA_MS + i * PASO_ENTRE_NOTAS_MS},1,0,0:0:0:0:`);
  }
  const osu = [
    'osu file format v14',
    '',
    '[General]',
    'AudioFilename: audio.wav',
    'AudioLeadIn: 0',
    'PreviewTime: 0',
    'Countdown: 0',
    'SampleSet: Soft',
    'Mode: 3',
    '',
    '[Metadata]',
    `Title:${titulo}`,
    'Artist:Tetra',
    'Creator:Prueba',
    'Version:OffsetEnVivo',
    '',
    '[Difficulty]',
    'HPDrainRate:5',
    'CircleSize:4',
    'OverallDifficulty:5',
    'ApproachRate:5',
    'SliderMultiplier:1.4',
    'SliderTickRate:1',
    '',
    '[TimingPoints]',
    '0,500,4,2,1,50,1,0',
    '',
    '[HitObjects]',
    ...notas,
    '',
  ].join('\n');
  const zip = zipSync({
    'mapa.osu': strToU8(osu),
    'audio.wav': new Uint8Array(readFileSync(AUDIO_DE_PRUEBA)),
  });
  return Buffer.from(zip);
}

async function importarYElegir(page: Page, titulo: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.locator('input[type="file"][accept=".osz"]').setInputFiles({
    name: `${titulo}.osz`,
    mimeType: 'application/octet-stream',
    buffer: crearOsz(titulo),
  });
  await page.getByText(titulo).first().click();
  await expect(page.locator('.tetra-song-select-jugar')).toBeVisible();
}

async function esperarPartida(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __tetraDebug?: Depuracion }).__tetraDebug;
      return d !== undefined && d.clock.isRunning && d.clock.now() > 300;
    },
    { timeout: 30_000 },
  );
}

/**
 * Pulsa las notas `desde` a `hasta` (exclusivo), cada una cuando el instante real de
 * la cancion pasa `DESFASE_FISICO_MS` de la nota. Una pulsacion por nota, columna i % 4.
 */
async function tocarConDesfase(page: Page, desde: number, hasta: number): Promise<void> {
  await page.evaluate(
    ({ desde: d0, hasta: h0, desfase, inicio, paso }) =>
      new Promise<void>((resolver) => {
        const dep = (window as unknown as { __tetraDebug: Depuracion }).__tetraDebug;
        const codigos = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
        let i = d0;
        const frame = (): void => {
          const instanteReal = dep.clock.now() + dep.clock.userOffset;
          while (i < h0 && instanteReal >= inicio + i * paso + desfase) {
            const code = codigos[i % 4]!;
            window.dispatchEvent(new KeyboardEvent('keydown', { code }));
            window.dispatchEvent(new KeyboardEvent('keyup', { code }));
            i++;
          }
          if (i >= h0) {
            resolver();
            return;
          }
          requestAnimationFrame(frame);
        };
        frame();
      }),
    {
      desde,
      hasta,
      desfase: DESFASE_FISICO_MS,
      inicio: PRIMERA_NOTA_MS,
      paso: PASO_ENTRE_NOTAS_MS,
    },
  );
}

/** El numero de la media en vivo (`+61 ms`), o null si no se ve. */
async function mediaEnVivo(page: Page): Promise<number | null> {
  const texto = page.locator('.tetra-error-media-texto');
  if (!(await texto.isVisible())) return null;
  const contenido = (await texto.textContent()) ?? '';
  const m = /^([+-]?\d+) ms$/.exec(contenido);
  return m === null ? null : Number(m[1]);
}

async function offsetsLocales(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const salida: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (clave !== null && clave.startsWith('tetra:offset-local:')) {
        salida.push(localStorage.getItem(clave) ?? '');
      }
    }
    return salida;
  });
}

async function userOffsetDelReloj(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __tetraDebug: Depuracion }).__tetraDebug.clock.userOffset,
  );
}

/**
 * Cuanto se desvio (en % del ancho de la barra desde el centro) el golpe mas
 * reciente: la marca de mayor opacidad. 0 es justo a tiempo; +, tarde.
 */
async function desvioDelUltimoGolpe(page: Page): Promise<number> {
  return page.evaluate(() => {
    const marcas = Array.from(
      document.querySelectorAll<HTMLElement>('.tetra-error-marca[data-juicio]'),
    );
    let mejor: HTMLElement | null = null;
    for (const marca of marcas) {
      if (mejor === null || Number(marca.style.opacity) > Number(mejor.style.opacity)) mejor = marca;
    }
    return mejor === null ? Number.NaN : parseFloat(mejor.style.left) - 50;
  });
}

test('= sube el offset de la cancion y acerca a 0 la media tarde; - la aleja; queda guardado', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await importarYElegir(page, 'Offset en vivo');
  await page.locator('.tetra-song-select-jugar').click();
  await esperarPartida(page);

  // Sin golpes no hay numero.
  expect(await mediaEnVivo(page)).toBeNull();

  // 9 golpes: todavia no. Con el decimo aparece, y es tarde (+).
  await tocarConDesfase(page, 0, 9);
  await expect(page.locator('.tetra-error-media-texto')).toBeHidden();
  await tocarConDesfase(page, 9, 30);
  await expect(page.locator('.tetra-error-media-texto')).toBeVisible();
  const inicial = (await mediaEnVivo(page))!;
  // 60 ms de desfase fisico mas lo que tarda el cuadro de animacion (hasta ~17 ms).
  expect(inicial).toBeGreaterThanOrEqual(55);
  expect(inicial).toBeLessThanOrEqual(90);
  // Los golpes caen a la derecha del centro (tarde).
  expect(await desvioDelUltimoGolpe(page)).toBeGreaterThan(10);

  // = x3: el offset de la cancion sube 3 ms, el aviso lo dice, el reloj lo usa y la media BAJA 3.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Equal');
  await expect(page.locator('.tetra-offset-aviso')).toHaveText('Offset de la canción +3 ms');
  expect(await userOffsetDelReloj(page)).toBe(3);
  expect(await offsetsLocales(page)).toEqual(['3']);
  const trasTres = (await mediaEnVivo(page))!;
  expect(inicial - trasTres).toBeGreaterThanOrEqual(2);
  expect(inicial - trasTres).toBeLessThanOrEqual(4);

  // - x2 hace lo contrario: baja el offset 2 ms y la media SUBE 2.
  await page.keyboard.press('Minus');
  await page.keyboard.press('Minus');
  await expect(page.locator('.tetra-offset-aviso')).toHaveText('Offset de la canción +1 ms');
  const trasMenos = (await mediaEnVivo(page))!;
  expect(trasMenos - trasTres).toBeGreaterThanOrEqual(1);
  expect(trasMenos - trasTres).toBeLessThanOrEqual(3);
  expect(await offsetsLocales(page)).toEqual(['1']);

  // Shift + = suma de a 5 ms. Hasta llevar el offset a la media medida.
  const pasos = Math.round(trasMenos / 5);
  for (let i = 0; i < pasos; i++) await page.keyboard.press('Shift+Equal');
  const offsetFinal = 1 + 5 * pasos;
  await expect(page.locator('.tetra-offset-aviso')).toHaveText(
    `Offset de la canción +${offsetFinal} ms`,
  );
  expect(await userOffsetDelReloj(page)).toBe(offsetFinal);
  expect(await offsetsLocales(page)).toEqual([String(offsetFinal)]);
  // La media en vivo ya esta cerca de 0, sin esperar golpes nuevos.
  const trasAjustar = (await mediaEnVivo(page))!;
  expect(Math.abs(trasAjustar)).toBeLessThanOrEqual(5);

  // Y los golpes que vienen, con el mismo desfase fisico, caen de verdad cerca del centro:
  // el offset movio el reloj de juego, no al jugador.
  await tocarConDesfase(page, 30, 60);
  const ultimo = await desvioDelUltimoGolpe(page);
  // Antes del ajuste el ultimo golpe estaba a mas de 10 puntos a la derecha del centro.
  expect(Math.abs(ultimo)).toBeLessThan(10);
  const final = (await mediaEnVivo(page))!;
  expect(Math.abs(final)).toBeLessThanOrEqual(15);

  // El aviso se va solo (~1 s de reloj de juego).
  await expect(page.locator('.tetra-offset-aviso')).toBeHidden({ timeout: 5000 });
});

test('Ctrl + = no ajusta (es el zoom del navegador)', async ({
  page,
}) => {
  await importarYElegir(page, 'Offset sin zoom');
  await page.locator('.tetra-song-select-jugar').click();
  await esperarPartida(page);

  await page.keyboard.press('Control+Equal');
  await expect(page.locator('.tetra-offset-aviso')).toBeHidden();
  expect(await userOffsetDelReloj(page)).toBe(0);
  expect(await offsetsLocales(page)).toEqual([]);
});

test('la pausa ofrece Ajustar offset con 20 golpes o mas, lo aplica y reinicia la media en vivo', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await importarYElegir(page, 'Offset en pausa');
  await page.locator('.tetra-song-select-jugar').click();
  await esperarPartida(page);

  const dialogo = page.getByRole('dialog', { name: 'Partida en pausa' });
  // Por clase y no por nombre: tras aplicarlo el boton cambia de texto.
  const ajustar = dialogo.locator('.tetra-pausa-ajuste');

  // Con 10 golpes todavia no hay boton.
  await tocarConDesfase(page, 0, 10);
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeVisible();
  await expect(ajustar).toBeHidden();
  // Esc otra vez continua (cuenta de 3 s con el reloj de otro AudioContext).
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden({ timeout: 10_000 });

  // 20 o mas: aparece, con la media tarde (+) entre parentesis.
  await tocarConDesfase(page, 10, 28);
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeVisible();
  await expect(ajustar).toBeVisible();
  const etiqueta = (await ajustar.textContent()) ?? '';
  const m = /^Ajustar offset \(\+(\d+) ms\)$/.exec(etiqueta);
  expect(m, `etiqueta: ${etiqueta}`).not.toBeNull();
  const propuesto = Number(m![1]);
  expect(propuesto).toBeGreaterThanOrEqual(55);
  expect(propuesto).toBeLessThanOrEqual(90);

  // Aplicarlo: el boton queda apagado con el offset nuevo, y el reloj y lo guardado lo siguen.
  await ajustar.click();
  await expect(ajustar).toBeDisabled();
  await expect(ajustar).toHaveText(`Offset de la canción +${propuesto} ms`);
  expect(await userOffsetDelReloj(page)).toBe(propuesto);
  expect(await offsetsLocales(page)).toEqual([String(propuesto)]);

  // Continuar: la media en vivo arranca de cero (sin numero) y los golpes siguientes caen cerca del centro.
  await dialogo.getByRole('button', { name: 'Continuar' }).click();
  await expect(dialogo).toBeHidden({ timeout: 10_000 });
  await expect(page.locator('.tetra-error-media-texto')).toBeHidden();
  await tocarConDesfase(page, 28, 44);
  await expect(page.locator('.tetra-error-media-texto')).toBeVisible();
  const media = (await mediaEnVivo(page))!;
  expect(Math.abs(media)).toBeLessThanOrEqual(15);

  // Con menos de 20 golpes desde el ajuste, la pausa ya no ofrece nada.
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeVisible();
  await expect(ajustar).toBeHidden();
});

test('viendo el auto, - y = no ajustan nada', async ({ page }) => {
  await importarYElegir(page, 'Offset en el auto');
  await page.getByRole('button', { name: 'Ver auto', exact: true }).click();
  await esperarPartida(page);

  await page.keyboard.press('Equal');
  await page.keyboard.press('Equal');
  await expect(page.locator('.tetra-offset-aviso')).toBeHidden();
  expect(await userOffsetDelReloj(page)).toBe(0);
  expect(await offsetsLocales(page)).toEqual([]);
});
