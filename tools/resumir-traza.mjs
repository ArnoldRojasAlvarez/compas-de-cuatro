// T-059: resume una traza de Chromium (la que graba `medir-rendimiento.mjs --traza`)
// para ver en que se va el frame: script, estilos, layout, pintado, composicion,
// GPU y recolector de basura.
//
// Uso: node tools/resumir-traza.mjs ruta/a/traza.json [--top=14]
//
// Para cada hilo que importa (render principal, compositor, GPU, raster) calcula
// el tiempo ocupado en los eventos de nivel superior y el tiempo propio (sin
// hijos) por nombre de evento. En el hilo principal agrupa por categoria y
// cuenta los GC y los frames de rAF (`FireAnimationFrame`).

import { readFileSync } from 'node:fs';

const ruta = process.argv[2];
if (!ruta) {
  console.error('Falta la ruta de la traza.');
  process.exit(1);
}
const TOP = Number((process.argv.find((a) => a.startsWith('--top=')) ?? '--top=14').slice(6));

const crudo = JSON.parse(readFileSync(ruta, 'utf8'));
const eventos = Array.isArray(crudo) ? crudo : crudo.traceEvents;

// --- hilos y procesos ---
const nombreHilo = new Map();
const nombreProceso = new Map();
for (const e of eventos) {
  if (e.ph !== 'M') continue;
  if (e.name === 'thread_name') nombreHilo.set(`${e.pid}:${e.tid}`, e.args.name);
  if (e.name === 'process_name') nombreProceso.set(e.pid, e.args.name);
}

const porHilo = new Map();
let tMin = Infinity;
let tMax = -Infinity;
for (const e of eventos) {
  if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
  const k = `${e.pid}:${e.tid}`;
  let lista = porHilo.get(k);
  if (!lista) porHilo.set(k, (lista = []));
  lista.push(e);
  if (e.ts < tMin) tMin = e.ts;
  if (e.ts + e.dur > tMax) tMax = e.ts + e.dur;
}
const duracionS = (tMax - tMin) / 1e6;

/** Recorre los eventos de un hilo con una pila: devuelve tiempo ocupado, tiempo propio por nombre y los de nivel superior. */
function analizar(lista) {
  lista.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const propio = new Map();
  const cuenta = new Map();
  const nivelSuperior = [];
  const pila = [];
  let ocupado = 0;
  const cerrar = (hasta) => {
    while (pila.length && pila[pila.length - 1].fin <= hasta) {
      const f = pila.pop();
      const t = f.dur - f.hijos;
      propio.set(f.e.name, (propio.get(f.e.name) ?? 0) + t);
      if (pila.length) pila[pila.length - 1].hijos += f.dur;
    }
  };
  for (const e of lista) {
    cerrar(e.ts);
    if (!pila.length) {
      ocupado += e.dur;
      nivelSuperior.push(e);
    }
    cuenta.set(e.name, (cuenta.get(e.name) ?? 0) + 1);
    pila.push({ e, fin: e.ts + e.dur, dur: e.dur, hijos: 0 });
  }
  cerrar(Infinity);
  return { ocupado, propio, cuenta, nivelSuperior };
}

const ms = (us) => (us / 1000).toFixed(1);
const porS = (us) => (us / 1000 / duracionS).toFixed(1);

console.log(`Traza: ${ruta}`);
console.log(`Duracion cubierta por eventos: ${duracionS.toFixed(1)} s\n`);

// Hilos con trabajo apreciable, ordenados por ocupacion.
const resumenes = [];
for (const [k, lista] of porHilo) {
  const a = analizar(lista);
  resumenes.push({ k, nombre: nombreHilo.get(k) ?? '?', proceso: nombreProceso.get(Number(k.split(':')[0])) ?? '?', a });
}
resumenes.sort((x, y) => y.a.ocupado - x.a.ocupado);
console.log('Hilos mas ocupados (ms de trabajo por segundo de traza):');
for (const r of resumenes.slice(0, 10)) {
  console.log(`  ${r.proceso} / ${r.nombre}: ${porS(r.a.ocupado)} ms/s (${((r.a.ocupado / (tMax - tMin)) * 100).toFixed(1)} %)`);
}

// Hilo principal del renderer que corre la pagina: el que tiene FireAnimationFrame.
const principal = resumenes.find((r) => r.a.cuenta.has('FireAnimationFrame')) ?? resumenes.find((r) => r.nombre === 'CrRendererMain');
if (principal) {
  const { a } = principal;
  console.log(`\nHilo principal (${principal.proceso} / ${principal.nombre}), tiempo propio por evento (ms/s):`);
  const filas = [...a.propio.entries()].sort((x, y) => y[1] - x[1]).slice(0, TOP);
  for (const [nombre, us] of filas) console.log(`  ${nombre.padEnd(34)} ${porS(us).padStart(7)} ms/s   n=${a.cuenta.get(nombre)}`);

  const grupos = {
    script: /^(FunctionCall|EvaluateScript|v8\.run|V8\.Execute|EventDispatch|TimerFire|FireAnimationFrame|RunTask|v8\.callFunction)$/,
    estilos: /^(UpdateLayoutTree|RecalculateStyles|ScheduleStyleRecalculation|InvalidateLayout)$/,
    layout: /^(Layout|IntersectionObserverController::computeIntersections)$/,
    pintado: /^(PrePaint|Paint|UpdateLayer|UpdateLayerTree|Layerize|PaintImage|RasterTask|CompositeLayers|Commit|HitTest)$/,
    gc: /(GC|MinorGC|MajorGC)/,
  };
  const suma = { script: 0, estilos: 0, layout: 0, pintado: 0, gc: 0 };
  for (const [nombre, us] of a.propio) {
    for (const [g, re] of Object.entries(grupos)) {
      if (re.test(nombre)) {
        suma[g] += us;
        break;
      }
    }
  }
  console.log('  Por categoria (ms/s, tiempo propio): ' + Object.entries(suma).map(([g, us]) => `${g} ${porS(us)}`).join(' | '));

  // Frames de rAF.
  const frames = a.nivelSuperior.length ? principal && eventos.filter((e) => e.ph === 'X' && `${e.pid}:${e.tid}` === principal.k && e.name === 'FireAnimationFrame') : [];
  if (frames.length) {
    const d = frames.map((f) => f.dur).sort((x, y) => x - y);
    const p = (q) => ms(d[Math.min(d.length - 1, Math.floor(q * d.length))]);
    console.log(`\nFireAnimationFrame (JS de los rAF): n=${d.length} p50=${p(0.5)} ms p95=${p(0.95)} p99=${p(0.99)} max=${ms(d[d.length - 1])} ms`);
  }

  // GC.
  const gcs = eventos.filter((e) => e.ph === 'X' && `${e.pid}:${e.tid}` === principal.k && /(^|\.)(MinorGC|MajorGC)$|^V8\.GC/.test(e.name));
  const gcMenor = gcs.filter((e) => e.name === 'MinorGC');
  const gcMayor = gcs.filter((e) => e.name === 'MajorGC');
  const stats = (l) => (l.length ? `n=${l.length} total=${ms(l.reduce((s, e) => s + e.dur, 0))} ms max=${ms(Math.max(...l.map((e) => e.dur)))} ms` : 'n=0');
  console.log(`GC menor: ${stats(gcMenor)} | GC mayor: ${stats(gcMayor)}`);

  // Tareas largas del hilo principal y de que estan hechas.
  const largas = a.nivelSuperior.filter((e) => e.dur > 8000).sort((x, y) => y.dur - x.dur).slice(0, 8);
  console.log(`\nTareas de nivel superior de mas de 8 ms: ${a.nivelSuperior.filter((e) => e.dur > 8000).length} (se listan las 8 peores)`);
  const lista = porHilo.get(principal.k);
  for (const t of largas) {
    const hijos = lista.filter((e) => e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur);
    const acum = new Map();
    for (const h of hijos) acum.set(h.name, (acum.get(h.name) ?? 0) + h.dur);
    const top = [...acum.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([n, us]) => `${n} ${ms(us)}`).join(', ');
    console.log(`  ${t.name} ${ms(t.dur)} ms @${((t.ts - tMin) / 1e6).toFixed(2)} s: ${top}`);
  }
}

// Otros hilos relevantes.
for (const nombre of ['Compositor', 'CrGpuMain', 'VizCompositorThread']) {
  const r = resumenes.find((x) => x.nombre === nombre && x.a.ocupado > 0);
  if (!r) continue;
  console.log(`\n${r.proceso} / ${r.nombre}: ${porS(r.a.ocupado)} ms/s ocupado. Tiempo propio:`);
  for (const [n, us] of [...r.a.propio.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6)) {
    console.log(`  ${n.padEnd(34)} ${porS(us).padStart(7)} ms/s   n=${r.a.cuenta.get(n)}`);
  }
}
