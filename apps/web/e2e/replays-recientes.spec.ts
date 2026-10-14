// T-065: e2e de los replays de las partidas recientes. Va por la interfaz como
// una persona: se juegan partidas con pulsaciones sinteticas (eventos de teclado
// mandados con el reloj de audio como referencia, el mismo recurso que
// replay.spec.ts), aparecen en "Partidas recientes", se ven desde la lista y desde
// la pantalla de resultados, y el resultado tiene que ser identico. Tambien se
// prueba "Conservar", la purga al abrir la app y el modo presentacion. Corre con
// `--mute-audio` (ver playwright.config.ts): no suena nada.

import { readFileSync } from 'node:fs';
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

const AUDIO_DE_PRUEBA = '../../fixtures/click-120.wav';
const X_DE_COLUMNA = [64, 192, 320, 448];
const CODIGOS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];

interface NotaDePrueba {
  time: number;
  column: 0 | 1 | 2 | 3;
  fin?: number;
}

/** Una dificultad corta (termina en ~9 s de partida): 11 simples y 2 largas, con un acorde. */
const NOTAS: NotaDePrueba[] = [
  { time: 2000, column: 0 },
  { time: 2400, column: 1 },
  { time: 2800, column: 2 },
  { time: 3200, column: 3 },
  { time: 3600, column: 0, fin: 4400 },
  { time: 4000, column: 2 },
  { time: 4400, column: 1 },
  { time: 4800, column: 3, fin: 5600 },
  { time: 5200, column: 2 },
  { time: 5600, column: 0 },
  { time: 6000, column: 1 },
  { time: 6000, column: 2 },
  { time: 6400, column: 3 },
];

function crearOsz(titulo: string): Buffer {
  const objetos = NOTAS.map((n) =>
    n.fin === undefined
      ? `${X_DE_COLUMNA[n.column]},192,${n.time},1,0,0:0:0:0:`
      : `${X_DE_COLUMNA[n.column]},192,${n.time},128,0,${n.fin}:0:0:0:0:`,
  );
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
    'Version:Recientes',
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
    ...objetos,
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
    name: 'recientes.osz',
    mimeType: 'application/octet-stream',
    buffer: crearOsz(titulo),
  });
  await page.getByText(titulo).first().click();
  await expect(page.locator('.tetra-song-select-jugar')).toBeVisible();
}

async function esperarPartida(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      window.__tetraDebug !== undefined &&
      window.__tetraDebug.clock.isRunning &&
      window.__tetraDebug.clock.now() > 300,
    { timeout: 30_000 },
  );
}

/** Lo que muestra la pantalla de resultados, tal cual (para comparar dos partidas). */
async function leerResultados(page: Page): Promise<Record<string, string | null>> {
  await expect(page.locator('.tetra-resultados')).toBeVisible({ timeout: 60_000 });
  const texto = (selector: string): Promise<string | null> =>
    page.locator(selector).first().textContent();
  return {
    principal: await texto('.tetra-resultados-principal'),
    conteos: await texto('.tetra-resultados-conteos'),
    estadisticas: await texto('.tetra-resultados-estadisticas'),
    teclas: await texto('.tetra-resultados-teclas'),
    ur: await texto('.tetra-resultados-ur'),
  };
}

type PasoDeTeclado = { t: number; code: string; tipo: 'down' | 'up' };

/** Manda los eventos de teclado cuando el reloj de juego llega a cada `t`. */
async function tocar(page: Page, pasos: PasoDeTeclado[]): Promise<void> {
  await page.evaluate(
    (lista) =>
      new Promise<void>((resolver) => {
        let i = 0;
        const paso = (): void => {
          const t = window.__tetraDebug?.clock.now() ?? Number.POSITIVE_INFINITY;
          while (i < lista.length && t >= lista[i]!.t) {
            const p = lista[i]!;
            window.dispatchEvent(
              new KeyboardEvent(p.tipo === 'down' ? 'keydown' : 'keyup', { code: p.code }),
            );
            i++;
          }
          if (i >= lista.length) {
            resolver();
            return;
          }
          requestAnimationFrame(paso);
        };
        paso();
      }),
    pasos,
  );
}

/** Una partida "humana": cada nota con un error distinto, una sin tocar (miss) y una pulsacion al aire. */
function partidaImperfecta(errores: number[]): PasoDeTeclado[] {
  const pasos: PasoDeTeclado[] = [];
  NOTAS.forEach((nota, i) => {
    if (i === 11) return; // la segunda nota del acorde no se toca: miss
    const code = CODIGOS[nota.column]!;
    const error = errores[i]!;
    pasos.push({ t: nota.time + error, code, tipo: 'down' });
    if (nota.fin !== undefined) {
      pasos.push({ t: nota.fin + (nota.time === 3600 ? 40 : -30), code, tipo: 'up' });
    } else {
      pasos.push({ t: nota.time + error + 50, code, tipo: 'up' });
    }
  });
  pasos.push({ t: 800, code: 'KeyK', tipo: 'down' }, { t: 850, code: 'KeyK', tipo: 'up' });
  return pasos.sort((a, b) => a.t - b.t);
}

const ERRORES_1 = [0, 20, -25, 45, 10, 70, -40, 0, 30, -15, 5, -60, 35];
const ERRORES_2 = [5, -10, 15, 30, -5, 20, 10, -20, 0, 40, -30, 0, 12].map((e, i) => (i % 3 === 0 ? e + 35 : e));

/** Juega una partida completa en vivo y devuelve lo que mostro la pantalla de resultados. */
async function jugarPartida(page: Page, errores: number[]): Promise<Record<string, string | null>> {
  await page.locator('.tetra-song-select-jugar').click();
  await esperarPartida(page);
  await tocar(page, partidaImperfecta(errores));
  return leerResultados(page);
}

const ETIQUETA = /^REPLAY · \d{1,2} [a-z]{3}$/;

/** Abre la base de la app tal cual esta (sin pasar por el codigo de la app) y devuelve las filas de 'recientes'. */
async function filasRecientes(
  page: Page,
): Promise<{ id: string; hash: string; fecha: string; texto: string; partida: Record<string, unknown>; fijado: boolean }[]> {
  return page.evaluate(
    () =>
      new Promise((resolver, rechazar) => {
        const abrir = indexedDB.open('tetra-mapas');
        abrir.onerror = () => rechazar(abrir.error);
        abrir.onsuccess = () => {
          const db = abrir.result;
          const peticion = db.transaction('recientes', 'readonly').objectStore('recientes').getAll();
          peticion.onsuccess = () => {
            db.close();
            resolver(peticion.result);
          };
          peticion.onerror = () => rechazar(peticion.error);
        };
      }),
  );
}

/** Copia una fila de 'recientes' con otra fecha (hace `dias` dias) y la marca `fijado`. */
async function sembrarCopiasAntiguas(
  page: Page,
  copias: { dias: number; fijado: boolean }[],
): Promise<void> {
  await page.evaluate(
    (lista) =>
      new Promise<void>((resolver, rechazar) => {
        const abrir = indexedDB.open('tetra-mapas');
        abrir.onerror = () => rechazar(abrir.error);
        abrir.onsuccess = () => {
          const db = abrir.result;
          const tx = db.transaction('recientes', 'readwrite');
          const tienda = tx.objectStore('recientes');
          const lectura = tienda.getAll();
          lectura.onsuccess = () => {
            const base = lectura.result[0] as {
              hash: string;
              texto: string;
              partida: Record<string, unknown>;
            };
            for (const { dias, fijado } of lista) {
              const fecha = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
              tienda.put({
                id: `${base.hash}|${fecha}`,
                hash: base.hash,
                fecha,
                texto: base.texto,
                partida: { ...base.partida, fecha },
                fijado,
              });
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolver();
          };
          tx.onerror = () => rechazar(tx.error);
        };
      }),
    copias,
  );
}

test('jugar, ver el replay desde resultados y desde la lista de recientes: mismo resultado', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await importarYElegir(page, 'Recientes prueba');

  // Sin partidas no hay lista.
  await expect(page.locator('.tetra-ss-recientes')).toHaveCount(0);

  // 1. Partida en vivo; en resultados aparece "Ver replay" junto a "Volver".
  const enVivo = await jugarPartida(page, ERRORES_1);
  expect(enVivo['conteos']).toMatch(/Miss\s*1/);
  await expect(page.locator('.tetra-record-aviso')).toContainText('Primer registro');
  const verDesdeResultados = page.getByRole('button', { name: 'Ver replay', exact: true });
  await expect(verDesdeResultados).toBeVisible();
  await expect(page.getByRole('button', { name: 'Volver al song select' })).toBeVisible();

  // 2. "Ver replay" de resultados: misma pista, etiqueta REPLAY y exactamente el mismo resultado.
  await verDesdeResultados.click();
  await esperarPartida(page);
  await expect(page.locator('.tetra-hud .tetra-reproduccion-etiqueta')).toHaveText(ETIQUETA);
  const desdeResultados = await leerResultados(page);
  expect(desdeResultados).toEqual(enVivo);
  // Mirarlo no cuenta: ni aviso de record ni nuevo intento.
  await expect(page.locator('.tetra-record-aviso')).toHaveCount(0);
  // Y se puede volver a ver.
  await expect(page.getByRole('button', { name: 'Ver de nuevo' })).toBeVisible();

  // 3. Volver al song select: la partida esta en "Partidas recientes".
  await page.getByRole('button', { name: 'Volver al song select' }).click();
  await expect(page.locator('.tetra-ss-record')).toContainText('1 intento');
  await expect(page.locator('.tetra-ss-recientes-titulo')).toHaveText('Partidas recientes');
  const filas = page.locator('.tetra-ss-reciente');
  await expect(filas).toHaveCount(1);
  await expect(filas.first().locator('.tetra-ss-reciente-fecha')).toHaveText(
    /^\d{1,2} [a-z]{3} \d{2}:\d{2}$/,
  );
  await expect(filas.first().locator('.tetra-ss-reciente-precision')).toHaveText(/^\d+\.\d{2}%$/);
  // Es el record: mismo score que el bloque del record, y lleva la marca "Mejor".
  await expect(filas.first().locator('.tetra-ss-reciente-score')).toHaveText(
    (await page.locator('.tetra-ss-record-score').textContent())!,
  );
  await expect(filas.first().locator('.tetra-ss-reciente-mejor')).toBeVisible();

  // 4. Una segunda partida, distinta: la lista tiene dos, la nueva primero.
  const segunda = await jugarPartida(page, ERRORES_2);
  expect(segunda).not.toEqual(enVivo);
  await page.getByRole('button', { name: 'Volver al song select' }).click();
  await expect(filas).toHaveCount(2);
  await expect(page.locator('.tetra-ss-record')).toContainText('2 intentos');

  // 5. "Ver replay" de la fila mas vieja (la primera partida): el resultado coincide con el de entonces.
  await filas.nth(1).getByRole('button', { name: 'Ver replay' }).click();
  await esperarPartida(page);
  await expect(page.locator('.tetra-hud .tetra-reproduccion-etiqueta')).toHaveText(ETIQUETA);
  // El teclado no manda en una reproduccion.
  await page.keyboard.press('KeyJ');
  expect(await leerResultados(page)).toEqual(enVivo);
  await page.getByRole('button', { name: 'Volver al song select' }).click();

  // 6. Y la de la fila nueva reproduce la segunda partida.
  await filas.nth(0).getByRole('button', { name: 'Ver replay' }).click();
  await esperarPartida(page);
  expect(await leerResultados(page)).toEqual(segunda);
  await page.getByRole('button', { name: 'Volver al song select' }).click();
  await expect(page.locator('.tetra-ss-record')).toContainText('2 intentos');
  await expect(page.locator('.tetra-ss-record')).not.toContainText('3 intentos');

  // 7. Conservar: la fila queda marcada, el boton cambia y sobrevive a recargar.
  const conservar = filas.nth(1).getByRole('button', { name: 'Conservar', exact: true });
  await conservar.click();
  const conservada = filas.nth(1).getByRole('button', { name: 'Dejar de conservar' });
  await expect(conservada).toHaveAttribute('aria-pressed', 'true');
  await expect(filas.nth(1)).toHaveClass(/tetra-ss-reciente-fijada/);
  await page.reload();
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.getByText('Recientes prueba').first().click();
  await expect(filas).toHaveCount(2);
  await expect(filas.nth(1).getByRole('button', { name: 'Dejar de conservar' })).toBeVisible();
  await expect(filas.nth(0).getByRole('button', { name: 'Conservar', exact: true })).toBeVisible();
});

test('la purga al abrir la app borra las de mas de 7 dias, conserva las fijadas y deja la mejor partida', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await importarYElegir(page, 'Purga prueba');
  await jugarPartida(page, ERRORES_1);
  await page.getByRole('button', { name: 'Volver al song select' }).click();
  await expect(page.locator('.tetra-ss-reciente')).toHaveCount(1);

  // Se siembran, en la base, tres copias de esa partida con otras fechas: una de hace 10 dias,
  // otra de hace 9 dias pero fijada, y una de hace 6 dias.
  await sembrarCopiasAntiguas(page, [
    { dias: 10, fijado: false },
    { dias: 9, fijado: true },
    { dias: 6, fijado: false },
  ]);
  expect(await filasRecientes(page)).toHaveLength(4);

  // Al abrir la app (recargar) se purga sola.
  await page.reload();
  await expect.poll(async () => (await filasRecientes(page)).length, { timeout: 15_000 }).toBe(3);

  const quedan = (await filasRecientes(page))
    .map((fila) => ({
      dias: Math.round((Date.now() - Date.parse(fila.fecha)) / (24 * 60 * 60 * 1000)),
      fijado: fila.fijado,
    }))
    .sort((a, b) => a.dias - b.dias);
  expect(quedan.map((q) => q.dias)).toEqual([0, 6, 9]);
  expect(quedan.find((q) => q.dias === 9)?.fijado).toBe(true);

  // El replay de la mejor partida no se toco: "Ver mejor partida" sigue estando.
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.getByText('Purga prueba').first().click();
  await expect(page.getByRole('button', { name: 'Ver mejor partida' })).toBeVisible();
  await expect(page.locator('.tetra-ss-reciente')).toHaveCount(3);
});

test('el modo presentacion se mantiene al ver un replay reciente (pista limpia para grabar)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await importarYElegir(page, 'Presentacion prueba');
  await jugarPartida(page, ERRORES_1);
  await page.getByRole('button', { name: 'Volver al song select' }).click();
  await expect(page.locator('.tetra-ss-reciente')).toHaveCount(1);

  // F activa el modo presentacion; el replay se ve sin header y con la etiqueta tenue.
  await page.keyboard.press('KeyF');
  await expect(page.locator('body')).toHaveClass(/tetra-presentacion/);
  await page.locator('.tetra-ss-reciente').first().getByRole('button', { name: 'Ver replay' }).click();
  await esperarPartida(page);
  await expect(page.locator('body')).toHaveClass(/tetra-presentacion/);
  await expect(page.locator('.tetra-header')).toBeHidden();
  await expect(page.locator('.tetra-hud .tetra-reproduccion-etiqueta')).toHaveText(ETIQUETA);
  await expect(page.locator('.tetra-hud .tetra-reproduccion-etiqueta')).toHaveCSS('opacity', '0.45');
  await leerResultados(page);
});
