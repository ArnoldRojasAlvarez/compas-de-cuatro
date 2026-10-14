// T-063: medicion del reloj de audio en un navegador real.
//
// Abre Chromium (Playwright) en una pagina vacia con un AudioContext sonando
// (fuente muda) y mide dos cosas que importan para el tiempo de una pulsacion:
//
// 1. De a cuanto avanza `ctx.currentTime` entre lecturas consecutivas (el
//    "bloque"). Dentro de un bloque el valor NO cambia: cualquier conversion
//    que lo lea en un instante cualquiera arrastra un error de hasta un bloque.
// 2. El jitter de tres formas de fechar una pulsacion a partir de su
//    `event.timeStamp` (base de `performance.now()`):
//      a. `cruda`: clock.now() - (performance.now() - ts), que es lo que hacia
//         `toGameTime` en apps/web/src/game.ts hasta T-063.
//      b. `salida`: `ctx.getOutputTimestamp()` ({contextTime, performanceTime})
//         como ancla: contextTime + (ts - performanceTime) / 1000.
//      c. `filtrada`: el ancla de (b) pasada por el mismo filtro que usa
//         `crearMapaDeTiempo` en packages/audio (ver mapa-de-tiempo.ts).
//    Las pulsaciones son sinteticas: se toma `ts = performance.now()` y se
//    convierte en un instante al azar dentro de los siguientes 0 a 20 ms (como
//    pasa en el juego: el handler corre despues del evento). El error de cada
//    conversion se mide contra una recta ajustada por minimos cuadrados sobre
//    todas las muestras (la verdad es lineal: los dos relojes corren a la misma
//    velocidad; lo que queda es el ruido que cada metodo agrega).
//
// Es una herramienta de diagnostico: no corre en `npm run test`. Uso:
//   node tools/medir-reloj.mjs            (headless, dispositivo falso)
//   node tools/medir-reloj.mjs --headed   (ventana real, dispositivo de audio real)
//   node tools/medir-reloj.mjs --segundos=5

/* global AudioContext */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const SEGUNDOS = Number(args.segundos ?? 4);
const HEADED = args.headed === true;

// El filtro de produccion, tal cual esta compilado (la dist de packages/audio).
const rutaMapa = join(RAIZ, 'packages/audio/dist/mapa-de-tiempo.js');
let fuenteMapa = null;
try {
  fuenteMapa = readFileSync(rutaMapa, 'utf8').replace(/^export\s+/gm, '');
} catch {
  // sin dist compilada se miden solo (a) y (b)
}

function percentil(valores, p) {
  const v = valores.slice().sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
}

function resumen(nombre, errores) {
  const abs = errores.map(Math.abs);
  const media = errores.reduce((a, b) => a + b, 0) / errores.length;
  const std = Math.sqrt(errores.reduce((a, e) => a + (e - media) ** 2, 0) / errores.length);
  console.log(
    `  ${nombre.padEnd(9)} n=${errores.length}  std ${std.toFixed(2)} ms  |err| p50 ${percentil(abs, 50).toFixed(2)}  p99 ${percentil(abs, 99).toFixed(2)}  max ${Math.max(...abs).toFixed(2)}  rango ${(Math.max(...errores) - Math.min(...errores)).toFixed(2)} ms`,
  );
}

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage();
await page.goto('about:blank');

const datos = await page.evaluate(
  async ({ segundos, fuenteMapa }) => {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    // Una fuente muda mantiene el grafo rindiendo.
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(g).connect(ctx.destination);
    osc.start();
    await ctx.resume();
    await new Promise((r) => setTimeout(r, 300));

    // 1. Bloques de currentTime: lazo apretado leyendo hasta que cambie.
    const bloques = [];
    const saltosPerf = [];
    let ultimo = ctx.currentTime;
    let perfUltimo = performance.now();
    const fin = performance.now() + segundos * 1000;
    const muestras = []; // [perfNow, ctxTime*1000, outCtx*1000, outPerf]
    while (performance.now() < fin) {
      const p = performance.now();
      const c = ctx.currentTime;
      if (c !== ultimo) {
        bloques.push((c - ultimo) * 1000);
        saltosPerf.push(p - perfUltimo);
        ultimo = c;
        perfUltimo = p;
        const o = ctx.getOutputTimestamp();
        muestras.push([p, c * 1000, o.contextTime * 1000, o.performanceTime]);
      }
    }

    // 2. Pulsaciones sinteticas: ts = performance.now(); se convierte en un
    //    instante al azar de los siguientes 0..20 ms.
    const pulsos = []; // [ts, cruda, salida, filtrada]
    let mapa = null;
    if (fuenteMapa) {
      mapa = new Function(`${fuenteMapa}; return crearMapaDeTiempo;`)()(ctx, {
        latenciaSalida: ctx.outputLatency,
      });
    }
    const fin2 = performance.now() + segundos * 1000;
    while (performance.now() < fin2) {
      const ts = performance.now();
      const espera = Math.random() * 20;
      // espera ocupada: como un handler que corre un rato despues del evento
      while (performance.now() - ts < espera) {
        /* ocupado */
      }
      const ahora = performance.now();
      const cruda = ctx.currentTime * 1000 - (ahora - ts);
      const o = ctx.getOutputTimestamp();
      const salida = o.contextTime * 1000 + (ts - o.performanceTime);
      const filtrada = mapa ? mapa.aContexto(ts) * 1000 : NaN;
      pulsos.push([ts, cruda, salida, filtrada]);
      // un respiro para que el bucle de eventos avance (como entre frames)
      await new Promise((r) => setTimeout(r, Math.random() * 8));
    }
    await ctx.close();
    return {
      sampleRate: ctx.sampleRate,
      baseLatency: ctx.baseLatency,
      outputLatency: ctx.outputLatency,
      bloques,
      saltosPerf,
      muestras,
      pulsos,
      tieneFiltro: mapa !== null,
    };
  },
  { segundos: SEGUNDOS, fuenteMapa },
);
await browser.close();

console.log(`Chromium ${HEADED ? 'con ventana' : 'headless'}: sampleRate ${datos.sampleRate}, baseLatency ${(datos.baseLatency * 1000).toFixed(1)} ms, outputLatency ${(datos.outputLatency * 1000).toFixed(1)} ms`);
console.log(`Bloques de currentTime (n=${datos.bloques.length}): p50 ${percentil(datos.bloques, 50).toFixed(2)} ms, p99 ${percentil(datos.bloques, 99).toFixed(2)} ms, max ${Math.max(...datos.bloques).toFixed(2)} ms, min ${Math.min(...datos.bloques).toFixed(2)} ms`);
console.log(`Separacion real entre saltos (performance.now): p50 ${percentil(datos.saltosPerf, 50).toFixed(2)} ms, p99 ${percentil(datos.saltosPerf, 99).toFixed(2)} ms, max ${Math.max(...datos.saltosPerf).toFixed(2)} ms`);
// Que relacion hay entre currentTime y lo que getOutputTimestamp dice que se oye:
// si (currentTime - contextTime) coincide con outputLatency, las dos formas de
// compensar la latencia son equivalentes en promedio.
const difLat = datos.muestras.map((m) => m[1] - m[2]);
const difPerf = datos.muestras.map((m) => m[0] - m[3]);
console.log(`currentTime - contextTime (justo tras un salto): p50 ${percentil(difLat, 50).toFixed(2)} ms, min ${Math.min(...difLat).toFixed(2)}, max ${Math.max(...difLat).toFixed(2)} (outputLatency reportada ${(datos.outputLatency * 1000).toFixed(1)} ms)`);
console.log(`performance.now() - performanceTime del ancla: p50 ${percentil(difPerf, 50).toFixed(2)} ms, max ${Math.max(...difPerf).toFixed(2)} ms`);

// Error de cada metodo contra la recta ajustada (pendiente libre, para no suponer 1 exacto).
function residuos(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  return { pendiente: b, residuos: ys.map((y, i) => y - (a + b * xs[i])) };
}

const ts = datos.pulsos.map((p) => p[0]);
console.log(`Jitter de la conversion de pulsaciones sinteticas (${datos.pulsos.length} pulsos, error contra la recta ajustada):`);
const cruda = residuos(ts, datos.pulsos.map((p) => p[1]));
resumen('cruda', cruda.residuos);
const salida = residuos(ts, datos.pulsos.map((p) => p[2]));
resumen('salida', salida.residuos);
if (datos.tieneFiltro) {
  const filtrada = residuos(ts, datos.pulsos.map((p) => p[3]));
  resumen('filtrada', filtrada.residuos);
  console.log(`  pendientes: cruda ${cruda.pendiente.toFixed(6)}, salida ${salida.pendiente.toFixed(6)}, filtrada ${filtrada.pendiente.toFixed(6)}`);
} else {
  console.log('  (sin packages/audio/dist/mapa-de-tiempo.js: no se midio el filtro; corre npm run typecheck)');
}
