// T-045: e2e de las estadisticas globales. Va por la interfaz como una persona
// (menu, song select, header). Se juegan partidas reales de una dificultad
// corta, y se mira que los numeros de la pantalla coincidan con lo guardado en
// el historial (la suma hecha a mano en el test, ponderada por notas). Las
// pulsaciones se mandan como eventos de teclado con el reloj de audio como
// referencia (mismo recurso que replay.spec.ts). Corre con `--mute-audio` (ver
// playwright.config.ts): no suena nada.

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
  /** Fin, solo para las largas. */
  fin?: number;
}

/** Misma dificultad corta que replay.spec.ts: 11 simples y 2 largas (15 juicios), de 2,0 s a 6,4 s. */
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
/** De la primera a la ultima nota: lo que cuenta como tiempo jugado de una partida. */
const DURACION_JUGADA_MS = 4400;

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
    'Version:Estadisticas',
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
    name: 'estadisticas.osz',
    mimeType: 'application/octet-stream',
    buffer: crearOsz(titulo, NOTAS),
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
              new KeyboardEvent(p.tipo === 'down' ? 'keydown' : 'keyup', {
                code: p.code,
              }),
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

/** Todas las notas justo a tiempo: sin un solo miss. */
function partidaPerfecta(): PasoDeTeclado[] {
  const pasos: PasoDeTeclado[] = [];
  for (const nota of NOTAS) {
    const code = CODIGOS[nota.column]!;
    pasos.push({ t: nota.time, code, tipo: 'down' });
    pasos.push({ t: nota.fin ?? nota.time + 50, code, tipo: 'up' });
  }
  return pasos.sort((a, b) => a.t - b.t);
}

/**
 * Una partida con errores: cada nota a un desvio distinto y la segunda nota del
 * acorde de 6,0 s (columna 2, la tercera tecla, J) sin tocar: exactamente un miss.
 */
function partidaConUnMiss(): PasoDeTeclado[] {
  const errores = [0, 20, -25, 45, 10, 70, -40, 0, 30, -15, 5, -60, 35];
  const pasos: PasoDeTeclado[] = [];
  NOTAS.forEach((nota, i) => {
    if (i === 11) return;
    const code = CODIGOS[nota.column]!;
    const error = errores[i]!;
    pasos.push({ t: nota.time + error, code, tipo: 'down' });
    pasos.push({ t: (nota.fin ?? nota.time + error) + 50, code, tipo: 'up' });
  });
  return pasos.sort((a, b) => a.t - b.t);
}

interface FilaDeHistorial {
  hash: string;
  fecha: string;
  accuracy: number;
  notas: number;
  desviacionMedia: number;
  fallosPorColumna: number[];
  duracionJugadaMs: number;
}

/** Las filas guardadas en la tienda 'historial' de IndexedDB, tal cual. */
async function leerHistorialGuardado(page: Page): Promise<FilaDeHistorial[]> {
  return page.evaluate(
    () =>
      new Promise<FilaDeHistorial[]>((resolver, rechazar) => {
        const abrir = indexedDB.open('tetra-mapas');
        abrir.onerror = () => rechazar(abrir.error);
        abrir.onsuccess = () => {
          const db = abrir.result;
          const lectura = db
            .transaction('historial', 'readonly')
            .objectStore('historial')
            .getAll();
          lectura.onsuccess = () => {
            db.close();
            resolver(lectura.result as FilaDeHistorial[]);
          };
          lectura.onerror = () => rechazar(lectura.error);
        };
      }),
  );
}

async function jugarYVolverAlSongSelect(
  page: Page,
  pasos: PasoDeTeclado[],
): Promise<void> {
  await page.locator('.tetra-song-select-jugar').click();
  await esperarPartida(page);
  await tocar(page, pasos);
  await expect(page.locator('.tetra-resultados')).toBeVisible({ timeout: 60_000 });
  // El boton aparece cuando el record y el historial ya se guardaron.
  await page.getByRole('button', { name: 'Volver al song select' }).click();
  await expect(page.getByRole('heading', { name: 'Elegir canción' })).toBeVisible();
}

const cifra = (page: Page, indice: number) =>
  page.locator('.tetra-estg-cifra-valor').nth(indice);

test('el menu tiene cuatro botones y las estadisticas sin partidas muestran el estado vacio', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.tetra-menu-accesos button')).toHaveText([
    'Jugar',
    'Mapeador',
    'Estadísticas',
    'Ajustes',
  ]);

  await page
    .locator('.tetra-menu-accesos')
    .getByRole('button', { name: 'Estadísticas' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Estadísticas' }),
  ).toBeVisible();
  await expect(page.getByText('Todavía no hay partidas')).toBeVisible();
  // Sin partidas no hay nada que filtrar ni graficos que dibujar.
  await expect(page.locator('.tetra-estg-periodos')).toBeHidden();
  await expect(page.locator('.tetra-estg-canvas')).toHaveCount(0);

  // El estado vacio lleva a jugar.
  await page
    .locator('.tetra-estg')
    .getByRole('button', { name: 'Jugar', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Elegir canción' })).toBeVisible();
  // Desde el song select el bloque "Jugado" del header no es un acceso (hay audio y un worker vivos).
  await expect(page.locator('.tetra-header-boton')).toBeDisabled();
});

test('el bloque "Jugado" del header lleva a las estadisticas desde el menu y desde ajustes', async ({
  page,
}) => {
  await page.goto('/');
  const jugado = page.locator('.tetra-header-boton');
  await expect(jugado).toBeEnabled();
  await expect(jugado).toHaveAttribute('title', 'Ver estadísticas');

  await jugado.click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Estadísticas' }),
  ).toBeVisible();
  // Ya estando aca no lleva a ningun lado.
  await expect(jugado).toBeDisabled();

  await page.getByRole('button', { name: 'Volver al menú' }).click();
  await expect(page.getByRole('button', { name: 'Jugar', exact: true })).toBeVisible();
  await expect(jugado).toBeEnabled();

  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible();
  await expect(jugado).toBeEnabled();
  await jugado.click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Estadísticas' }),
  ).toBeVisible();
});

test('tres partidas: los numeros coinciden con la suma a mano, el auto no cuenta y el filtro funciona', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await importarYElegir(page, 'Estadisticas prueba');

  // 1. Una partida con un miss y una perfecta.
  await jugarYVolverAlSongSelect(page, partidaConUnMiss());
  await jugarYVolverAlSongSelect(page, partidaPerfecta());

  // 2. Mirar el auto no deja nada en el historial.
  await page.getByRole('button', { name: 'Ver auto', exact: true }).click();
  await esperarPartida(page);
  await expect(page.locator('.tetra-resultados')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Volver al song select' }).click();
  await expect(page.getByRole('heading', { name: 'Elegir canción' })).toBeVisible();

  const filas = await leerHistorialGuardado(page);
  expect(filas).toHaveLength(2);
  // 15 juicios por partida (11 simples y 2 largas con cabeza y cola); un solo miss, en la columna J.
  expect(filas.map((f) => f.notas)).toEqual([15, 15]);
  expect(filas[0]!.fallosPorColumna).toEqual([0, 0, 1, 0]);
  expect(filas[1]!.fallosPorColumna).toEqual([0, 0, 0, 0]);
  // Las pulsaciones salen en el cuadro de animacion, unos ms tarde: puede ser un 300 y no un MAX, pero nunca un miss.
  expect(filas[1]!.accuracy).toBeGreaterThan(0.9);
  expect(filas.every((f) => f.duracionJugadaMs === DURACION_JUGADA_MS)).toBe(true);

  // 3. A la pantalla: Volver al menu y Estadisticas.
  await page.getByRole('button', { name: 'Volver al menú' }).click();
  await page
    .locator('.tetra-menu-accesos')
    .getByRole('button', { name: 'Estadísticas' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Estadísticas' }),
  ).toBeVisible();

  // Partidas y tiempo: dos partidas de 4,4 s.
  await expect(cifra(page, 0)).toHaveText('2');
  await expect(cifra(page, 1)).toHaveText(
    `${Math.floor((2 * DURACION_JUGADA_MS) / 1000)} s`,
  );

  // Precision y desviacion: la suma a mano, ponderada por notas (15 y 15) y por golpes juzgados (14 y 15).
  const [con, perfecta] = filas as [FilaDeHistorial, FilaDeHistorial];
  const precision = (con.accuracy * con.notas + perfecta.accuracy * perfecta.notas) / 30;
  await expect(cifra(page, 2)).toHaveText(`${(precision * 100).toFixed(2)}%`);
  const media = (con.desviacionMedia * 14 + perfecta.desviacionMedia * 15) / 29;
  const entero = Math.round(media);
  await expect(cifra(page, 3)).toHaveText(`${entero > 0 ? '+' : ''}${entero} ms`);

  // Graficos: nada de NaN con un solo dia, y el de fallos dice la columna.
  await expect(page.locator('.tetra-estg-canvas')).toHaveCount(3);
  await expect(
    page.getByRole('img', { name: 'Fallos por columna: D 0, F 0, J 1, K 0' }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: /^Desviación media por día: 1 día, de / }),
  ).toBeVisible();
  await expect(page.locator('.tetra-estg')).not.toContainText('NaN');

  // El filtro: las dos partidas son de hoy, entran en 7 y 30 dias y en todo.
  for (const periodo of ['7 días', '30 días', 'Todo']) {
    await page.getByRole('button', { name: periodo, exact: true }).click();
    await expect(
      page.getByRole('button', { name: periodo, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(cifra(page, 0)).toHaveText('2');
  }

  // 4. Una partida de hace diez dias sale del filtro de 7 dias y entra en el de 30.
  await page.evaluate(
    () =>
      new Promise<void>((resolver, rechazar) => {
        const abrir = indexedDB.open('tetra-mapas');
        abrir.onerror = () => rechazar(abrir.error);
        abrir.onsuccess = () => {
          const db = abrir.result;
          const tx = db.transaction('historial', 'readwrite');
          const fecha = new Date(new Date().getTime() - 10 * 86_400_000).toISOString();
          tx.objectStore('historial').put(
            {
              hash: 'vieja',
              fecha,
              score: 500_000,
              accuracy: 0.5,
              notas: 100,
              desviacionMedia: 40,
              desviacionTipica: 10,
              tempranas: 10,
              tardias: 80,
              fallosPorColumna: [0, 0, 0, 0],
              duracionJugadaMs: 60_000,
            },
            `${fecha}|vieja`,
          );
          tx.oncomplete = () => {
            db.close();
            resolver();
          };
          tx.onerror = () => rechazar(tx.error);
        };
      }),
  );
  await page.getByRole('button', { name: 'Volver al menú' }).click();
  await page.locator('.tetra-header-boton').click();
  await expect(cifra(page, 0)).toHaveText('3');
  await page.getByRole('button', { name: '7 días', exact: true }).click();
  await expect(cifra(page, 0)).toHaveText('2');
  await page.getByRole('button', { name: '30 días', exact: true }).click();
  await expect(cifra(page, 0)).toHaveText('3');
  // La partida vieja (50 % en 100 notas) pesa 100 de 130 notas: la precision media baja de verdad.
  const ponderada = (con.accuracy * 15 + perfecta.accuracy * 15 + 0.5 * 100) / 130;
  await expect(cifra(page, 2)).toHaveText(`${(ponderada * 100).toFixed(2)}%`);
});
