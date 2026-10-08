// T-044: e2e del modo auto y del replay. Va por la interfaz como una persona
// (menu, song select, botones-icono). El criterio central es el determinismo:
// jugar una partida, guardarla y mirarla con "Ver mejor partida" tiene que dar
// exactamente la misma pantalla de resultados. Las pulsaciones de la partida en
// vivo se mandan como eventos de teclado desde la pagina, con el reloj de audio
// como referencia (mismo recurso que contadores.spec.ts). Corre con
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

interface NotaDePrueba {
  time: number;
  column: 0 | 1 | 2 | 3;
  /** Fin, solo para las largas. */
  fin?: number;
}

/**
 * Una dificultad corta (la ultima nota a 6,4 s, termina en ~9 s de partida):
 * 11 simples y 2 largas, con un acorde. Cuatro, tres, cuatro y tres
 * pulsaciones por columna cuando se juega perfecto.
 */
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

function crearOsz(titulo: string, notas: NotaDePrueba[]): Buffer {
  const objetos = notas.map((n) =>
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
    'Version:Replay',
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

async function importarYElegir(page: Page, titulo: string, notas: NotaDePrueba[]): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar', exact: true }).click();
  await page.locator('input[type="file"][accept=".osz"]').setInputFiles({
    name: 'replay.osz',
    mimeType: 'application/octet-stream',
    buffer: crearOsz(titulo, notas),
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

const CODIGOS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];

/**
 * Una partida "humana": cada nota con un error distinto (temprano, tarde, justo),
 * una nota sin tocar (miss), una larga soltada tarde y otra temprano, y una
 * pulsacion al aire. Nada es perfecto, asi que el resultado no es trivial.
 */
function partidaImperfecta(): PasoDeTeclado[] {
  const errores = [0, 20, -25, 45, 10, 70, -40, 0, 30, -15, 5, -60, 35];
  const pasos: PasoDeTeclado[] = [];
  NOTAS.forEach((nota, i) => {
    if (i === 11) return; // la segunda nota del acorde no se toca: miss
    const code = CODIGOS[nota.column]!;
    const error = errores[i]!;
    pasos.push({ t: nota.time + error, code, tipo: 'down' });
    if (nota.fin !== undefined) {
      // La primera larga se suelta 40 ms tarde, la segunda 30 ms temprano.
      pasos.push({ t: nota.fin + (nota.time === 3600 ? 40 : -30), code, tipo: 'up' });
    } else {
      pasos.push({ t: nota.time + error + 50, code, tipo: 'up' });
    }
  });
  // Una pulsacion al aire en la columna 3, mucho antes de su primera nota.
  pasos.push({ t: 800, code: 'KeyK', tipo: 'down' }, { t: 850, code: 'KeyK', tipo: 'up' });
  return pasos.sort((a, b) => a.t - b.t);
}

test('Ver auto: el bot saca todo MAX, muestra AUTO y no guarda record ni cuenta las teclas del jugador', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await importarYElegir(page, 'Auto prueba', NOTAS);

  // Sin partidas guardadas no hay "Ver mejor partida"; "Ver auto" siempre esta.
  await expect(page.getByRole('button', { name: 'Ver mejor partida' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver auto', exact: true }).click();
  await esperarPartida(page);

  const etiqueta = page.locator('.tetra-hud .tetra-reproduccion-etiqueta');
  await expect(etiqueta).toHaveText('AUTO');

  // Las teclas del jugador no cuentan: el bot es el unico que pulsa.
  await page.keyboard.press('KeyD');
  await page.keyboard.press('KeyF');
  await expect(page.locator('.tetra-tecla-cuenta').first()).toHaveText('0');

  // Termina solo y muestra los resultados con la misma etiqueta.
  await expect(page.locator('.tetra-resultados')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.tetra-resultados-cabecera .tetra-reproduccion-etiqueta')).toHaveText(
    'AUTO',
  );
  await expect(page.locator('.tetra-resultados-rango')).toHaveText('SS');
  // 11 simples + 2 largas (cabeza y cola) = 15 juicios, todos MAX; ningun otro.
  await expect(page.locator('.tetra-resultados-fila-cantidad')).toHaveText([
    '15',
    '0',
    '0',
    '0',
    '0',
    '0',
  ]);
  await expect(page.locator('.tetra-resultados-secundarios')).toContainText('1000000');
  // Una pulsacion por nota, ni una de mas: las dos teclas reales de arriba no se sumaron.
  await expect(page.locator('.tetra-resultados-teclas')).toHaveText('D 3 · F 3 · J 4 · K 3');
  // Un bot perfecto no dice nada del offset: no se ofrece corregirlo.
  await expect(page.locator('.tetra-resultados-corregir')).toHaveCount(0);
  await expect(page.locator('.tetra-record-aviso')).toHaveCount(0);

  // No se guardo nada: la dificultad sigue sin record ni replay.
  await page.getByRole('button', { name: 'Volver al song select' }).click();
  await expect(page.getByRole('heading', { name: 'Elegir canción' })).toBeVisible();
  await expect(page.locator('.tetra-ss-record')).toHaveCount(0);
  await expect(page.locator('.tetra-dificultad-item-rango')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ver mejor partida' })).toHaveCount(0);
});

test('Ctrl+Enter ve el auto de la dificultad enfocada', async ({ page }) => {
  await importarYElegir(page, 'Atajo auto', NOTAS);
  await page.keyboard.press('Control+Enter');
  await esperarPartida(page);
  await expect(page.locator('.tetra-hud .tetra-reproduccion-etiqueta')).toHaveText('AUTO');
});

test('Ver mejor partida reproduce la partida guardada con exactamente el mismo resultado', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await importarYElegir(page, 'Replay prueba', NOTAS);

  // 1. Se juega una partida imperfecta en vivo.
  await page.locator('.tetra-song-select-jugar').click();
  await esperarPartida(page);
  await expect(page.locator('.tetra-hud .tetra-reproduccion-etiqueta')).toHaveCount(0);
  await tocar(page, partidaImperfecta());
  const enVivo = await leerResultados(page);
  // No es una partida perfecta ni vacia: hay de todo.
  expect(enVivo['conteos']).toMatch(/Miss\s*1/);
  expect(enVivo['principal']).not.toContain('1000000');
  await expect(page.locator('.tetra-record-aviso')).toContainText('Primer registro');

  // 2. Aparece "Ver mejor partida" y se la mira.
  await page.getByRole('button', { name: 'Volver al song select' }).click();
  await expect(page.locator('.tetra-ss-record')).toContainText('1 intento');
  const verMejor = page.getByRole('button', { name: 'Ver mejor partida' });
  await expect(verMejor).toBeVisible();
  await verMejor.click();
  await esperarPartida(page);
  await expect(page.locator('.tetra-hud .tetra-reproduccion-etiqueta')).toHaveText(
    /^REPLAY · \d{1,2} [a-z]{3}$/,
  );
  // El teclado no manda en una reproduccion.
  await page.keyboard.press('KeyJ');
  await page.keyboard.press('KeyJ');

  // 3. Mismo score, combo, conteos, desviaciones y pulsaciones.
  const reproducido = await leerResultados(page);
  expect(reproducido).toEqual(enVivo);
  await expect(page.locator('.tetra-resultados-cabecera .tetra-reproduccion-etiqueta')).toHaveText(
    /^REPLAY · \d{1,2} [a-z]{3}$/,
  );
  await expect(page.locator('.tetra-record-aviso')).toHaveCount(0);

  // 4. Mirarla no cuenta como intento ni cambia el record.
  await page.getByRole('button', { name: 'Volver al song select' }).click();
  await expect(page.locator('.tetra-ss-record')).toContainText('1 intento');
  await expect(page.locator('.tetra-ss-record')).not.toContainText('2 intentos');
  await expect(page.getByRole('button', { name: 'Ver mejor partida' })).toBeVisible();

  // 5. Un replay guardado que se danio no tumba nada: avisa y la pantalla sigue.
  await page.evaluate(
    () =>
      new Promise<void>((resolver, rechazar) => {
        const abrir = indexedDB.open('tetra-mapas');
        abrir.onerror = () => rechazar(abrir.error);
        abrir.onsuccess = () => {
          const db = abrir.result;
          const tx = db.transaction('replays', 'readwrite');
          const tienda = tx.objectStore('replays');
          const claves = tienda.getAllKeys();
          claves.onsuccess = () => {
            for (const clave of claves.result) {
              tienda.put({ hash: clave, texto: '{esto no es un replay', fecha: 'x' });
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolver();
          };
          tx.onerror = () => rechazar(tx.error);
        };
      }),
  );
  await page.getByRole('button', { name: 'Ver mejor partida' }).click();
  await expect(page.locator('.tetra-song-select-error')).toContainText('no se puede leer');
  await expect(page.getByRole('heading', { name: 'Elegir canción' })).toBeVisible();
});

test('Auto con una intro larga: Espacio salta y no hay un solo miss', async ({ page }) => {
  test.setTimeout(150_000);
  // La primera nota a 12 s; 16 notas cada 500 ms.
  const notas: NotaDePrueba[] = Array.from({ length: 16 }, (_, i) => ({
    time: 12_000 + i * 500,
    column: (i % 4) as 0 | 1 | 2 | 3,
  }));
  await importarYElegir(page, 'Auto intro', notas);
  await page.keyboard.press('Control+Enter');
  await esperarPartida(page);

  const aviso = page.locator('.tetra-saltar');
  await expect(aviso).toBeVisible();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__tetraDebug!.clock.now() > 9000, { timeout: 5000 });
  await expect(aviso).toBeHidden();

  await expect(page.locator('.tetra-resultados')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.tetra-resultados-fila-cantidad')).toHaveText([
    '16',
    '0',
    '0',
    '0',
    '0',
    '0',
  ]);
  await expect(page.locator('.tetra-resultados-rango')).toHaveText('SS');
});

test('mapeador: "Auto" juega el mapa en edicion con la etiqueta AUTO y sin un miss', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Mapeador', exact: true }).click();
  await page.setInputFiles('.tetra-mp-archivo', AUDIO_DE_PRUEBA);
  await expect(page.locator('.tetra-mp-estado')).toContainText('golpes detectados', {
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Generar mapa automático' }).click();
  await expect(page.locator('.tetra-mp-notas')).toContainText('notas');

  await page.getByRole('button', { name: 'Auto', exact: true }).click();
  await esperarPartida(page);
  await expect(page.locator('.tetra-hud .tetra-reproduccion-etiqueta')).toHaveText('AUTO');
  await page.waitForFunction(() => window.__tetraDebug!.clock.now() > 4000, { timeout: 20_000 });
  const juicios = await page
    .locator('.tetra-juicio')
    .evaluateAll((els) => els.map((el) => Number(el.textContent)));
  expect(juicios[0]).toBeGreaterThan(0); // MAX
  expect(juicios.slice(1)).toEqual([0, 0, 0, 0, 0]);

  // Escape pausa; salir vuelve al editor.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Salir al song select' }).click();
  await expect(page.getByRole('button', { name: 'Auto', exact: true })).toBeVisible();
});
