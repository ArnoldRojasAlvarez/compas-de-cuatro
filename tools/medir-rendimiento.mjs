// T-059: medicion repetible del rendimiento de la partida.
//
// Abre la app en Chromium (Playwright), pone en modo auto la cancion demo
// "Primer Compas" en Difícil (o un mapa sintetico denso de ~11 notas/s) y
// registra la duracion de cada frame con un rAF propio de la pagina. Ese rAF
// es SOLO para medir: no es gameplay, el juego sigue leyendo `clock.now()`
// (CLAUDE.md, "El reloj es el audio"). La ventana de medicion se decide con el
// reloj de juego (de 10 s a 10 s + `--segundos`), no con temporizadores.
//
// No corre en `npm run test` ni en el e2e por defecto: es una herramienta.
//
// Uso (desde la raiz del repo):
//   node tools/medir-rendimiento.mjs --build --escenarios=base,sin-fondo,video \
//        --res=1280x800,1920x1080 --salida=resultados.json
//   node tools/medir-rendimiento.mjs --escenarios=base --res=1920x1080 --traza
//
// Opciones:
//   --escenarios=a,b,c   nombres de ESCENARIOS (o "todos"). Por defecto: base.
//   --res=WxH,WxH        resoluciones del viewport. Por defecto: 1280x800,1920x1080.
//   --segundos=30        largo de la ventana de medicion (reloj de juego).
//   --build              compila la app antes (si no, usa apps/web/dist tal cual).
//   --traza              ademas de medir, graba una traza de Chromium (corrida aparte,
//                        sus numeros no se mezclan con los de la medicion limpia).
//   --traza-s=12         segundos de traza dentro de la ventana.
//   --salida=archivo     escribe el JSON completo (por escenario y resolucion).
//   --puerto=4180        puerto del servidor de `vite preview`.
//   --gpu=real|software  "real" (por defecto) fuerza D3D11/ANGLE para no caer en
//                        SwiftShader; "software" deja el default de headless.
//   --dpr=1              deviceScaleFactor del contexto.
//   --dist=dist-antes    carpeta (dentro de apps/web) con la compilacion a medir, para comparar dos
//                        versiones alternadas: `vite build --outDir dist-antes` desde apps/web.
//   --baja-latencia      prende el ajuste "Dibujo de baja latencia" (contexto WebGL desynchronized).
//   --heap             ademas mide cuanto crece el heap de JS por segundo y cuantos GC se ven (por frame, con precise-memory-info).
//   --desde=10000       reloj de juego (ms) en que empieza la ventana de medicion.
//   --pausar=ms, --seek=ms  diagnosticos: pausar la partida o saltar el reloj antes de medir.
//   --inyectar=archivo  script extra que se inyecta en la pagina antes que la app (para
//                        diagnosticos puntuales, por ejemplo envolver llamadas de WebGL).
//                        Puede dejar datos en window.__extra: se imprimen al final de cada corrida.
//
// Siempre con `--mute-audio`: nada suena. El renderer de WebGL se imprime al
// empezar (UNMASKED_RENDERER): si dice SwiftShader los numeros no sirven.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { chromium } from '@playwright/test';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TITULO_DEMO = 'Primer Compas';
const TITULO_DENSO = 'Denso 11';

/** Escenarios: que mapa, y que interruptores de apariencia estan prendidos. */
const BASE = {
  mapa: 'demo', // 'demo' (Difícil de Primer Compas) | 'denso' (sintetico)
  fondo: true, // imagen de fondo de la cancion
  video: false, // video de fondo (uno generado, VP8)
  skin: 'tetra',
  contadores: true, // teclas, juicios y barra de error
  fps: true, // contador de fps del HUD
};
export const ESCENARIOS = {
  base: {},
  'sin-fondo': { fondo: false },
  video: { video: true },
  'skin-barras': { skin: 'barras' },
  'skin-circulos': { skin: 'circulos' },
  'skin-diamantes': { skin: 'diamantes' },
  'sin-contadores': { contadores: false },
  'solo-teclas': { contadores: { teclas: true }, fps: false },
  'solo-juicios': { contadores: { juicios: true }, fps: false },
  'solo-barra': { contadores: { barra: true }, fps: false },
  'sin-fps': { fps: false },
  'minimo': { fondo: false, contadores: false, fps: false },
  denso: { mapa: 'denso' },
  'denso-sin-fondo': { mapa: 'denso', fondo: false },
  'denso-video': { mapa: 'denso', video: true },
  'denso-minimo': { mapa: 'denso', fondo: false, contadores: false, fps: false },
};

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

function leerArgumentos(argv) {
  const a = { _: [] };
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (m) a[m[1]] = m[2] ?? true;
    else a._.push(arg);
  }
  return a;
}

const args = leerArgumentos(process.argv.slice(2));
const PUERTO = Number(args.puerto ?? 4180);
const URL_BASE = `http://localhost:${PUERTO}`;
const SEGUNDOS = Number(args.segundos ?? 30);
const T_INICIO_MS = Number(args.desde ?? 10_000);
const RESOLUCIONES = String(args.res ?? '1280x800,1920x1080')
  .split(',')
  .map((r) => {
    const [w, h] = r.split('x').map(Number);
    return { ancho: w, alto: h };
  });
const NOMBRES = args.escenarios === 'todos' ? Object.keys(ESCENARIOS) : String(args.escenarios ?? 'base').split(',');
const DPR = Number(args.dpr ?? 1);
const CACHE = join(tmpdir(), 'tetra-medicion');
mkdirSync(CACHE, { recursive: true });

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

function compilar() {
  console.log('Compilando la app...');
  const r = spawnSync('npm', ['run', 'build', '-w', '@tetra/web'], { cwd: RAIZ, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error('Fallo el build.');
}

async function levantarServidor() {
  if (!args.dist && (args.build || !existsSync(join(RAIZ, 'apps/web/dist/index.html')))) compilar();
  const proceso = spawn(
    process.execPath,
    [join(RAIZ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PUERTO), '--strictPort', '--outDir', String(args.dist ?? 'dist')],
    { cwd: join(RAIZ, 'apps/web'), stdio: 'ignore' },
  );
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(URL_BASE);
      if (r.ok) return proceso;
    } catch {
      // todavia no esta
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  proceso.kill();
  throw new Error('El servidor de preview no arranco.');
}

function apagar(proceso) {
  if (!proceso || proceso.killed) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proceso.pid), '/T', '/F'], { stdio: 'ignore' });
  else proceso.kill();
}

// ---------------------------------------------------------------------------
// Material de prueba: mapa denso (.osz), video generado
// ---------------------------------------------------------------------------

/** WAV mono de 16 bits en silencio: la partida solo necesita un reloj que corra. */
function crearWavSilencio(segundos) {
  const tasa = 22050;
  const muestras = tasa * segundos;
  const datos = muestras * 2;
  const b = Buffer.alloc(44 + datos);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + datos, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(tasa, 24);
  b.writeUInt32LE(tasa * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(datos, 40);
  return b;
}

/** PRNG con semilla (mulberry32) para que el mapa denso sea siempre el mismo. */
function prng(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mapa de ~11 notas por segundo: un stream que no repite columna, un jump cada 8 y LN ocasionales. */
function crearOszDenso(titulo, notasPorSegundo = 11, duracionS = 50) {
  const x = [64, 192, 320, 448];
  const rnd = prng(59);
  const paso = 1000 / notasPorSegundo;
  const objetos = [];
  let anterior = 0;
  const hastaMs = (duracionS - 4) * 1000;
  for (let i = 0, t = 2000; t < hastaMs; i++, t = 2000 + Math.round(i * paso)) {
    let c = Math.floor(rnd() * 4);
    if (c === anterior) c = (c + 1 + Math.floor(rnd() * 3)) % 4;
    anterior = c;
    if (i % 8 === 7) {
      // jump: dos columnas a la vez
      const otra = (c + 2) % 4;
      objetos.push(`${x[c]},192,${t},1,0,0:0:0:0:`, `${x[otra]},192,${t},1,0,0:0:0:0:`);
    } else if (i % 23 === 11) {
      objetos.push(`${x[c]},192,${t},128,0,${t + Math.round(paso * 2)}:0:0:0:0:`);
      i += 2; // la LN ocupa la columna: se saltan dos pasos
      t = 2000 + Math.round(i * paso);
    } else {
      objetos.push(`${x[c]},192,${t},1,0,0:0:0:0:`);
    }
  }
  if (args.notas) {
    // Diagnostico: en vez del stream aleatorio, las notas de un JSON [{time, column, endTime}] (recortadas con --notas-desde/--notas-hasta).
    const desde = Number(args['notas-desde'] ?? 0);
    const hasta = Number(args['notas-hasta'] ?? Infinity);
    objetos.length = 0;
    for (const n of JSON.parse(readFileSync(String(args.notas), 'utf8'))) {
      if (n.time < desde || n.time > hasta) continue;
      objetos.push(
        n.endTime === null
          ? `${x[n.column]},192,${n.time},1,0,0:0:0:0:`
          : `${x[n.column]},192,${n.time},128,0,${n.endTime}:0:0:0:0:`,
      );
    }
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
    'Creator:Medicion',
    'Version:Denso',
    '',
    '[Difficulty]',
    'HPDrainRate:5',
    'CircleSize:4',
    'OverallDifficulty:8',
    'ApproachRate:5',
    'SliderMultiplier:1.4',
    'SliderTickRate:1',
    '',
    '[TimingPoints]',
    '0,363.6,4,2,1,50,1,0',
    '',
    '[HitObjects]',
    ...objetos,
    '',
  ].join('\n');
  return Buffer.from(
    zipSync({ 'mapa.osu': strToU8(osu), 'audio.wav': new Uint8Array(crearWavSilencio(duracionS)) }),
  );
}

/** El ffmpeg que instala Playwright (`npx playwright install ffmpeg`), si esta. */
function buscarFfmpeg() {
  const bases = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'), join(process.env.HOME ?? '', '.cache', 'ms-playwright')];
  for (const base of bases) {
    if (!base || !existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      if (!d.startsWith('ffmpeg-')) continue;
      for (const exe of ['ffmpeg-win64.exe', 'ffmpeg-linux', 'ffmpeg-mac']) {
        const p = join(base, d, exe);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

/**
 * Video de prueba: se graba una vez desde un canvas animado con MediaRecorder
 * (VP8/webm, 1280x720 a 30 fps; el Chromium de Playwright no trae H.264) y se
 * guarda en cache. Tiene movimiento y detalle para que el decodificador trabaje.
 */
async function obtenerVideo(browser) {
  const ruta = join(CACHE, 'video-prueba-720p.webm');
  if (existsSync(ruta)) return readFileSync(ruta);
  console.log('Generando el video de prueba (una sola vez, ~1 min)...');
  const contexto = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pagina = await contexto.newPage();
  await pagina.goto('about:blank');
  const base64 = await pagina.evaluate(async (segundos) => {
    const lienzo = document.createElement('canvas');
    lienzo.width = 1280;
    lienzo.height = 720;
    document.body.appendChild(lienzo);
    const g = lienzo.getContext('2d');
    const flujo = lienzo.captureStream(30);
    const grabador = new MediaRecorder(flujo, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 2_500_000 });
    const trozos = [];
    grabador.ondataavailable = (e) => e.data.size > 0 && trozos.push(e.data);
    const fin = new Promise((r) => (grabador.onstop = r));
    grabador.start(1000);
    const t0 = performance.now();
    await new Promise((resolver) => {
      const dibujar = () => {
        const t = (performance.now() - t0) / 1000;
        const grad = g.createLinearGradient(0, 0, 1280, 720);
        grad.addColorStop(0, `hsl(${(t * 20) % 360} 60% 25%)`);
        grad.addColorStop(1, `hsl(${(t * 20 + 120) % 360} 60% 15%)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, 1280, 720);
        for (let i = 0; i < 90; i++) {
          g.fillStyle = `hsla(${(i * 13 + t * 40) % 360} 70% 60% / 0.35)`;
          const x = (Math.sin(t * 0.7 + i) * 0.5 + 0.5) * 1280;
          const y = (Math.cos(t * 0.5 + i * 1.7) * 0.5 + 0.5) * 720;
          g.beginPath();
          g.arc(x, y, 20 + (i % 7) * 12, 0, Math.PI * 2);
          g.fill();
        }
        if (t < segundos) requestAnimationFrame(dibujar);
        else resolver();
      };
      dibujar();
    });
    grabador.stop();
    await fin;
    const blob = new Blob(trozos, { type: 'video/webm' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, 55);
  await contexto.close();
  // MediaRecorder no escribe duracion ni indice de busqueda: sin ellos el video
  // no se puede mover con `currentTime` como uno real. Se reempaqueta con el
  // ffmpeg que trae Playwright (solo copia los paquetes, no recodifica).
  const crudo = join(CACHE, 'video-crudo.webm');
  writeFileSync(crudo, Buffer.from(base64, 'base64'));
  const ffmpeg = buscarFfmpeg();
  if (ffmpeg) {
    const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', crudo, '-c', 'copy', ruta]);
    if (r.status === 0 && existsSync(ruta)) return readFileSync(ruta);
    console.warn('No se pudo reempaquetar el video; se usa el crudo (puede no admitir busqueda).');
  }
  writeFileSync(ruta, readFileSync(crudo));
  return readFileSync(ruta);
}

// ---------------------------------------------------------------------------
// Instrumentacion de la pagina (solo para medir)
// ---------------------------------------------------------------------------

/** Se inyecta antes que la app. El rAF es unicamente de medicion. */
function instrumentacion({ tIni, tFin, heap }) {
  const N = 60000;
  const dt = new Float64Array(N);
  // Lo mismo medido con el reloj de juego (lo que usa el contador de fps del HUD): sirve para ver cuanto se mueve su lectura.
  const dtReloj = new Float64Array(N);
  const med = (window.__med = { n: 0, activo: false, terminado: false, dt, dtReloj, tIni, tFin, perfIni: 0, perfFin: 0, tirones: [], contador: [] });
  let previo = 0;
  let previoReloj = 0;
  // Lo que muestra el contador de fps del HUD durante la ventana: cada vez que cambia su texto.
  let elContador = null;
  let textoContador = null;
  // Con --heap (y --enable-precise-memory-info): cuanto crece el heap de JS por segundo (aprox. lo que se aloca) y cuantos GC se ven.
  let heapPrevio = 0;
  med.heap = { subidaBytes: 0, gcs: 0, bajadaBytes: 0, gcMayorMax: 0 };
  const paso = (ts) => {
    const g = window.__tetraDebug;
    if (g && g.clock.isRunning && !med.terminado) {
      const t = g.clock.now();
      if (t >= tIni && t < tFin) {
        if (!med.activo) {
          med.activo = true;
          med.perfIni = performance.now();
          previo = 0;
          previoReloj = 0;
        }
        if (previo > 0 && med.n < N) {
          dtReloj[med.n] = t - previoReloj;
          // Los tirones (> 25 ms) se anotan con el reloj de juego en que ocurrieron, para ver si caen siempre en el mismo punto de la cancion.
          if (ts - previo > 25) med.tirones.push([Math.round(t - tIni), Math.round(ts - previo)]);
          dt[med.n++] = ts - previo;
        }
        previo = ts;
        previoReloj = t;
        if (heap) {
          const usado = performance.memory.usedJSHeapSize;
          if (heapPrevio > 0) {
            const d = usado - heapPrevio;
            if (d >= 0) med.heap.subidaBytes += d;
            else if (d < -65536) {
              med.heap.gcs++;
              med.heap.bajadaBytes -= d;
            }
          }
          heapPrevio = usado;
        }
        elContador ??= document.querySelector('.tetra-fps');
        if (elContador) {
          const texto = elContador.textContent;
          if (texto !== textoContador) {
            textoContador = texto;
            if (med.contador.length < 20000) med.contador.push([Math.round(t - tIni), texto]);
          }
        }
      } else if (med.activo && t >= tFin) {
        med.activo = false;
        med.terminado = true;
        med.perfFin = performance.now();
      }
    }
    requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

// ---------------------------------------------------------------------------
// Estadisticas
// ---------------------------------------------------------------------------

function percentil(ordenado, p) {
  if (ordenado.length === 0) return NaN;
  const i = Math.min(ordenado.length - 1, Math.max(0, Math.ceil(p * ordenado.length) - 1));
  return ordenado[i];
}

export function estadisticas(dt) {
  const v = Float64Array.from(dt).sort();
  const n = v.length;
  let suma = 0;
  let sobre20 = 0;
  let sobre33 = 0;
  for (const x of dt) {
    suma += x;
    if (x > 20) sobre20++;
    if (x > 33) sobre33++;
  }
  return {
    frames: n,
    media: suma / n,
    p50: percentil(v, 0.5),
    p95: percentil(v, 0.95),
    p99: percentil(v, 0.99),
    max: v[n - 1],
    sobre20,
    sobre33,
  };
}

// ---------------------------------------------------------------------------
// Una corrida
// ---------------------------------------------------------------------------

async function prepararBiblioteca(ctx) {
  // Siembra la demo y importa el mapa denso, una sola vez por corrida: todas las paginas del contexto comparten la base.
  const pagina = await ctx.newPage();
  await pagina.goto(URL_BASE);
  await pagina.waitForFunction(() => localStorage.getItem('tetra:demo-sembrada') !== null, null, { timeout: 90_000 });
  // Mapa denso: se importa por la interfaz, como en el e2e.
  await pagina.getByRole('button', { name: 'Jugar', exact: true }).click();
  await pagina.locator('input[type="file"][accept=".osz"]').setInputFiles({
    name: 'denso.osz',
    mimeType: 'application/octet-stream',
    buffer: crearOszDenso(TITULO_DENSO),
  });
  await pagina.getByText(TITULO_DENSO).first().waitFor({ timeout: 30_000 });
  await pagina.close();
}

/** Ajusta las canciones guardadas: sin fondo / con video. Hay que recargar despues. */
async function parcharCanciones(pagina, { fondo, videoBase64 }) {
  await pagina.evaluate(
    async ({ fondo, videoBase64 }) => {
      const db = await new Promise((res, rej) => {
        const p = indexedDB.open('tetra-mapas');
        p.onsuccess = () => res(p.result);
        p.onerror = () => rej(p.error);
      });
      const todas = await new Promise((res, rej) => {
        const p = db.transaction('canciones').objectStore('canciones').getAll();
        p.onsuccess = () => res(p.result);
        p.onerror = () => rej(p.error);
      });
      // La portada de la demo se guarda aparte la primera vez para poder volver a ponerla.
      const demo = todas.find((c) => c.titulo === 'Primer Compas');
      if (demo && demo._fondoOriginal === undefined) demo._fondoOriginal = demo.background;
      const fondoDemo = demo?._fondoOriginal;
      const tx = db.transaction('canciones', 'readwrite');
      const tienda = tx.objectStore('canciones');
      for (const c of todas) {
        if (fondo) c.background = fondoDemo;
        else delete c.background;
        if (videoBase64) {
          const bin = atob(videoBase64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          c.video = new Blob([bytes], { type: 'video/webm' });
          c.videoOffset = 0;
        } else {
          delete c.video;
          delete c.videoOffset;
        }
        if (c === demo) c._fondoOriginal = fondoDemo;
        tienda.put(c);
      }
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    { fondo, videoBase64 },
  );
}

function aNumeros(metricas) {
  const o = {};
  for (const m of metricas.metrics) o[m.name] = m.value;
  return o;
}

async function medirUna({ browser, ctx, videoBase64, nombre, config, res, trazar, rutaTraza }) {
  const pagina = await ctx.newPage();
  await pagina.setViewportSize({ width: res.ancho, height: res.alto });
  const ajustes = {
    'tetra:mostrar-fps': String(config.fps),
    'tetra:mostrar-teclas': String(config.contadores === true || config.contadores?.teclas === true),
    'tetra:mostrar-juicios': String(config.contadores === true || config.contadores?.juicios === true),
    'tetra:mostrar-barra-error': String(config.contadores === true || config.contadores?.barra === true),
    'tetra:video-de-fondo': String(config.video),
    'tetra:skin-activa': `propia:${config.skin}`,
    ...(args['ls-exp'] ? { 'exp-ctx': String(args['ls-exp']) } : {}),
    // El ajuste "Dibujo de baja latencia" (nace apagado): --baja-latencia lo prende.
    'tetra:dibujo-baja-latencia': String(Boolean(args['baja-latencia'])),
  };
  await pagina.goto(URL_BASE);
  await pagina.evaluate((a) => {
    for (const [k, v] of Object.entries(a)) localStorage.setItem(k, v);
  }, ajustes);
  await parcharCanciones(pagina, { fondo: config.fondo, videoBase64: config.video ? videoBase64 : null });
  await pagina.reload();

  const titulo = config.mapa === 'demo' ? TITULO_DEMO : TITULO_DENSO;
  try {
    await pagina.getByRole('button', { name: 'Jugar', exact: true }).click();
    await pagina.getByText(titulo).first().click({ timeout: 15_000 });
    if (config.mapa === 'demo') {
      await pagina.locator('.tetra-dificultad-item', { hasText: String(args.dificultad ?? 'Difícil') }).click();
    }
    if (args['notas-humano']) await pagina.locator('.tetra-song-select-jugar').click();
    else await pagina.getByRole('button', { name: 'Ver auto', exact: true }).click();
  } catch (e) {
    const ruta = join(CACHE, 'fallo-navegacion.png');
    await pagina.screenshot({ path: ruta });
    const lista = await pagina.locator('.tetra-song-select-lista').evaluate((el) => `${el.children.length} items: ${el.textContent.slice(0, 200)} | ${getComputedStyle(el).display} ${JSON.stringify(el.getBoundingClientRect())}`).catch(() => 'sin lista');
    console.error(`No se pudo elegir la cancion. Captura en ${ruta}. Lista: ${lista}`);
    throw e;
  }
  try {
    await pagina.waitForFunction(
      () => window.__tetraDebug !== undefined && window.__tetraDebug.clock.isRunning && window.__tetraDebug.clock.now() > 300,
      null,
      { timeout: 40_000 },
    );
  } catch (e) {
    const ruta = join(CACHE, 'fallo-arranque.png');
    await pagina.screenshot({ path: ruta });
    console.error(`No arranco la partida. Captura en ${ruta}. Texto: ${(await pagina.locator('body').innerText()).slice(0, 400)}`);
    throw e;
  }

  if (args.seek) {
    // Diagnostico: salta el reloj a `--seek` ms (lo que el replay se haya perdido se entrega de golpe, antes de la ventana).
    await pagina.evaluate((ms) => window.__tetraDebug.clock.seek(ms), Number(args.seek));
  }
  if (args.pausar) {
    // Diagnostico: pausa la partida `--pausar` ms de pared y la reanuda, para separar "tiempo de juego" de "tiempo desde que cargo la pagina".
    await pagina.keyboard.press('Escape');
    await pagina.waitForTimeout(Number(args.pausar));
    await pagina.keyboard.press('Escape');
    await pagina.waitForTimeout(4500);
  }
  if (args['notas-humano']) {
    // Partida con teclado: se tocan las notas del JSON con eventos de teclado desde la pagina (como el e2e),
    // con un error de timing distinto en cada golpe, para que la barra de error y los juicios se muevan como con una persona.
    const notas = JSON.parse(readFileSync(String(args['notas-humano']), 'utf8'));
    await pagina.evaluate((lista) => {
      const codigos = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
      let s = 7;
      const azar = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
      const pasos = [];
      for (const n of lista) {
        const error = (azar() + azar() + azar() - 1.5) * 50; // ~ +-25 ms, campana
        pasos.push({ t: n.time + error, code: codigos[n.column], down: true });
        pasos.push({ t: (n.endTime ?? n.time + 50) + error / 2, code: codigos[n.column], down: false });
      }
      pasos.sort((a, b) => a.t - b.t);
      let i = 0;
      const paso = () => {
        const g = window.__tetraDebug;
        if (!g) return;
        const t = g.clock.now();
        while (i < pasos.length && t >= pasos[i].t) {
          const p = pasos[i++];
          window.dispatchEvent(new KeyboardEvent(p.down ? 'keydown' : 'keyup', { code: p.code }));
        }
        requestAnimationFrame(paso);
      };
      requestAnimationFrame(paso);
    }, notas);
  }
  if (args.foto) {
    // Diagnostico: una captura de pantalla cuando el reloj llega a `--foto` ms (altera la medicion; solo para mirar).
    await pagina.waitForFunction((ms) => window.__tetraDebug.clock.now() >= ms, Number(args.foto), { polling: 50 });
    await pagina.screenshot({ path: join(CACHE, `foto-${args.foto}.png`) });
  }
  // `--sin-cdp`: no toca el protocolo mientras dura la ventana (descarta que la herramienta altere lo medido).
  const cdp = args['sin-cdp'] ? null : await ctx.newCDPSession(pagina);
  await cdp?.send('Performance.enable');
  await pagina.waitForFunction(() => window.__med.activo || window.__med.terminado, null, { polling: 100, timeout: 60_000 });
  const antes = cdp ? aNumeros(await cdp.send('Performance.getMetrics')) : {};
  let trazaListo = null;
  if (trazar) {
    await browser.startTracing(pagina, {
      path: rutaTraza,
      screenshots: false,
      categories: args['traza-cat'] ? String(args['traza-cat']).split(',') : [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'v8',
        'v8.execute',
        'toplevel',
        'cc',
        'gpu',
        'viz',
        'blink',
        'benchmark',
        'latencyInfo',
      ],
    });
    trazaListo = pagina
      .waitForTimeout(Number(args['traza-s'] ?? 12) * 1000)
      .then(() => browser.stopTracing());
  }
  if (args['sin-cdp']) await pagina.waitForTimeout(SEGUNDOS * 1000 + 1500);
  await pagina.waitForFunction(() => window.__med.terminado, null, { polling: 250, timeout: (SEGUNDOS + 40) * 1000 });
  if (trazaListo) await trazaListo;
  const despues = cdp ? aNumeros(await cdp.send('Performance.getMetrics')) : {};
  const datos = await pagina.evaluate(() => ({
    dt: Array.from(window.__med.dt.subarray(0, window.__med.n)),
    dtReloj: Array.from(window.__med.dtReloj.subarray(0, window.__med.n)),
    tirones: window.__med.tirones,
    contador: window.__med.contador,
    heap: window.__med.heap,
    msVentana: window.__med.perfFin - window.__med.perfIni,
    nodos: document.getElementsByTagName('*').length,
    video: (() => {
      const v = document.querySelector('video');
      return v ? { t: v.currentTime, pausado: v.paused, listo: v.readyState, duracion: v.duration } : null;
    })(),
  }));
  const dpr = await pagina.evaluate(() => window.devicePixelRatio);
  if (args.inyectar) {
    console.log('  extra:', JSON.stringify(await pagina.evaluate(() => (typeof window.__extraFn === 'function' ? window.__extraFn() : (window.__extra ?? null)))));
  }
  if (config.video && (datos.video === null || datos.video.pausado)) console.warn('AVISO: el video no se esta reproduciendo en este escenario.');
  await pagina.close();

  const delta = (k) => (despues[k] ?? 0) - (antes[k] ?? 0);
  const seg = datos.msVentana / 1000;
  return {
    nombre,
    res: `${res.ancho}x${res.alto}`,
    dpr,
    ...estadisticas(datos.dt),
    reloj: lecturaDelContador(datos.dtReloj),
    cpu: {
      tareaPct: (delta('TaskDuration') / seg) * 100,
      scriptPct: (delta('ScriptDuration') / seg) * 100,
      layoutPct: (delta('LayoutDuration') / seg) * 100,
      estilosPct: (delta('RecalcStyleDuration') / seg) * 100,
      layoutsPorS: delta('LayoutCount') / seg,
      estilosPorS: delta('RecalcStyleCount') / seg,
      heapMB: despues['JSHeapUsedSize'] / 1048576,
      heapDeltaMB: delta('JSHeapUsedSize') / 1048576,
    },
    nodos: datos.nodos,
    video: datos.video,
    tirones: datos.tirones,
    contador: resumenDelContador(datos.contador, seg),
    heap: args.heap
      ? { subidaKBPorS: datos.heap.subidaBytes / 1024 / seg, gcs: datos.heap.gcs, gcsPorS: datos.heap.gcs / seg, liberadoMB: datos.heap.bajadaBytes / 1048576 }
      : null,
  };
}

/** Lo que mostro el contador del HUD: cuantas veces cambio su texto, el rango de fps que dijo y un ejemplo. */
function resumenDelContador(cambios, segundos) {
  if (cambios.length === 0) return null;
  const fps = cambios.map(([, texto]) => Number.parseInt(texto, 10)).filter(Number.isFinite);
  const peores = cambios.map(([, texto]) => /(\d+(?:\.\d+)?) ms max/.exec(texto)?.[1]).filter(Boolean).map(Number);
  return {
    cambiosPorS: cambios.length / segundos,
    fpsMin: Math.min(...fps),
    fpsMax: Math.max(...fps),
    peorMsMax: peores.length ? Math.max(...peores) : null,
    ejemplo: cambios[Math.floor(cambios.length / 2)][1],
  };
}

/** Como se veria el contador de fps de hoy (1000 / dt de cada frame, medido con el reloj de juego). */
function lecturaDelContador(dtReloj) {
  const fps = dtReloj.filter((d) => d > 0).map((d) => 1000 / d).sort((a, b) => a - b);
  const dtOrdenado = Float64Array.from(dtReloj).sort();
  const fuera = fps.filter((f) => f < 55 || f > 65).length;
  return {
    p50Ms: percentil(dtOrdenado, 0.5),
    p99Ms: percentil(dtOrdenado, 0.99),
    maxMs: dtOrdenado[dtOrdenado.length - 1],
    fpsMin: fps[0],
    fpsP5: percentil(fps, 0.05),
    fpsP95: percentil(fps, 0.95),
    fpsMax: fps[fps.length - 1],
    pctFuera55a65: (fuera / fps.length) * 100,
  };
}

function fila(r) {
  const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/d');
  return `| ${r.nombre} | ${r.res} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.p99)} | ${f(r.max)} | ${r.sobre20} | ${r.sobre33} | ${r.frames} | ${f(r.cpu.tareaPct, 0)} | ${f(r.cpu.scriptPct, 0)} | ${f(r.cpu.layoutsPorS, 0)} |`;
}

// ---------------------------------------------------------------------------
// Programa principal
// ---------------------------------------------------------------------------

async function principal() {
  const servidor = await levantarServidor();
  const argsChromium = ['--mute-audio', '--autoplay-policy=no-user-gesture-required'];
  if (args.heap) argsChromium.push('--enable-precise-memory-info');
  if (String(args.gpu ?? 'real') === 'real') {
    argsChromium.push('--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist');
  }
  // `--chromium-args=--flag1,--flag2`: banderas extra para diagnosticar (se suman a las de siempre).
  if (args['chromium-args']) argsChromium.push(...String(args['chromium-args']).split(','));
  const browser = await chromium.launch({ headless: true, args: argsChromium });
  const resultados = [];
  let ctx = null;
  try {
    // Renderer de WebGL: si dice SwiftShader es software y no sirve para decidir.
    const sonda = await browser.newPage();
    await sonda.goto('about:blank');
    const renderer = await sonda.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const e = gl?.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'desconocido';
    });
    await sonda.close();
    console.log(`Renderer WebGL: ${renderer}`);
    console.log(`Chromium ${browser.version()} | ventana ${SEGUNDOS} s de reloj de juego desde ${T_INICIO_MS / 1000} s | dpr ${DPR}`);
    if (/swiftshader/i.test(renderer)) console.warn('AVISO: renderer por software (SwiftShader). Estos numeros no sirven para decidir.');

    const necesitaVideo = NOMBRES.some((n) => (ESCENARIOS[n] ?? {}).video);
    const videoBytes = necesitaVideo ? await obtenerVideo(browser) : null;
    const videoBase64 = videoBytes ? videoBytes.toString('base64') : null;
    // Un solo contexto: la demo se siembra una vez y la instrumentacion de medicion se inyecta en todas sus paginas.
    ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: DPR });
    await ctx.addInitScript(instrumentacion, { tIni: T_INICIO_MS, tFin: T_INICIO_MS + SEGUNDOS * 1000, heap: Boolean(args.heap) });
    if (args.inyectar) await ctx.addInitScript({ path: String(args.inyectar) });
    await prepararBiblioteca(ctx);

    console.log('\n| escenario | res | p50 ms | p95 | p99 | max | >20 ms | >33 ms | frames | CPU tarea % | script % | layouts/s |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const nombre of NOMBRES) {
      const preset = ESCENARIOS[nombre];
      if (!preset) throw new Error(`Escenario desconocido: ${nombre}`);
      const config = { ...BASE, ...preset };
      for (const res of RESOLUCIONES) {
        const r = await medirUna({ browser, ctx, videoBase64, nombre, config, res, trazar: false });
        resultados.push({ ...r, config, renderer });
        console.log(fila(r));
        if (r.heap) console.log(`  heap de JS: sube ${r.heap.subidaKBPorS.toFixed(0)} KB/s, ${r.heap.gcs} GC vistos (${r.heap.gcsPorS.toFixed(2)}/s), libera ${r.heap.liberadoMB.toFixed(1)} MB`);
        if (r.contador) console.log(`  contador del HUD: ${r.contador.cambiosPorS.toFixed(1)} cambios/s, dijo de ${r.contador.fpsMin} a ${r.contador.fpsMax} fps${r.contador.peorMsMax === null ? '' : `, peor ${r.contador.peorMsMax} ms`}, ejemplo "${r.contador.ejemplo}"`);
        if (r.tirones.length) console.log(`  tirones (ms desde el inicio de la ventana, ms de frame): ${JSON.stringify(r.tirones)}`);
      }
    }
    if (args.traza) {
      // Corrida aparte con traza, en el primer escenario y la ultima resolucion pedidos.
      const nombre = NOMBRES[0];
      const res = RESOLUCIONES[RESOLUCIONES.length - 1];
      const ruta = String(args.traza === true ? join(CACHE, `traza-${nombre}-${res.ancho}x${res.alto}.json`) : args.traza);
      const config = { ...BASE, ...ESCENARIOS[nombre] };
      console.log(`\nGrabando traza de "${nombre}" a ${res.ancho}x${res.alto} en ${ruta}`);
      const r = await medirUna({ browser, ctx, videoBase64, nombre: `${nombre} (con traza)`, config, res, trazar: true, rutaTraza: ruta });
      console.log(fila(r));
    }
  } finally {
    await browser.close();
    apagar(servidor);
  }
  if (args.salida) writeFileSync(String(args.salida), JSON.stringify(resultados, null, 2));
}

// Solo corre como programa; importado (por ejemplo desde un test) no hace nada.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
