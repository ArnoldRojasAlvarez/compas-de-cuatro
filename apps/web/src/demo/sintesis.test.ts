// T-051: la parte de la sintesis que no necesita navegador: el codificador WAV,
// la percusion en JS, la masterizacion y el reparto en segmentos. Lo que usa
// OfflineAudioContext (bajo, acordes, melodia) se mide en el navegador.

import { describe, expect, it } from 'vitest';
import { componerDemo, NOTA_BOMBO } from './composicion.js';
import {
  aplicarFundidoFinal,
  codificarWav,
  comprimirBus,
  curvaDeAgachado,
  FRECUENCIA_MUESTREO,
  midiAHz,
  normalizarPico,
  picoDe,
  renderizarPercusion,
  saturarSuave,
  segmentosDe,
  type BufferCodificable,
} from './sintesis.js';

function bufferFalso(canales: number[][], sampleRate = 44100): BufferCodificable {
  const datos = canales.map((c) => Float32Array.from(c));
  return {
    numberOfChannels: datos.length,
    sampleRate,
    length: datos[0]?.length ?? 0,
    getChannelData: (c: number) => datos[c] as Float32Array,
  };
}

const ascii = (bytes: Uint8Array, desde: number, largo: number): string =>
  String.fromCharCode(...bytes.subarray(desde, desde + largo));

describe('codificarWav', () => {
  it('escribe una cabecera RIFF/WAVE PCM de 16 bits correcta', () => {
    const wav = codificarWav(bufferFalso([[0, 0.5, -0.5], [0, 0.25, -0.25]], 44100));
    const vista = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(vista.getUint32(16, true)).toBe(16); // tamano del bloque fmt
    expect(vista.getUint16(20, true)).toBe(1); // PCM
    expect(vista.getUint16(22, true)).toBe(2); // canales
    expect(vista.getUint32(24, true)).toBe(44100);
    expect(vista.getUint32(28, true)).toBe(44100 * 2 * 2); // bytes por segundo
    expect(vista.getUint16(32, true)).toBe(4); // alineacion de bloque
    expect(vista.getUint16(34, true)).toBe(16);
    const datos = 3 * 2 * 2;
    expect(vista.getUint32(40, true)).toBe(datos);
    expect(vista.getUint32(4, true)).toBe(36 + datos);
    expect(wav.byteLength).toBe(44 + datos);
  });

  it('intercala los canales y convierte a enteros de 16 bits', () => {
    const wav = codificarWav(bufferFalso([[0.5, -0.5], [0.25, -0.25]]));
    const vista = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(vista.getInt16(44, true)).toBe(Math.round(0.5 * 32767)); // I, muestra 0
    expect(vista.getInt16(46, true)).toBe(Math.round(0.25 * 32767)); // D, muestra 0
    expect(vista.getInt16(48, true)).toBe(Math.round(-0.5 * 32768)); // I, muestra 1
    expect(vista.getInt16(50, true)).toBe(Math.round(-0.25 * 32768)); // D, muestra 1
  });

  it('acota lo que se pasa de +-1 en vez de dar la vuelta', () => {
    const wav = codificarWav(bufferFalso([[2, -3, 1, -1]]));
    const vista = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(vista.getInt16(44, true)).toBe(32767);
    expect(vista.getInt16(46, true)).toBe(-32768);
    expect(vista.getInt16(48, true)).toBe(32767);
    expect(vista.getInt16(50, true)).toBe(-32768);
  });

  it('un buffer mono usa un canal y la alineacion correspondiente', () => {
    const wav = codificarWav(bufferFalso([[0.1, 0.2, 0.3]], 22050));
    const vista = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(vista.getUint16(22, true)).toBe(1);
    expect(vista.getUint32(24, true)).toBe(22050);
    expect(vista.getUint16(32, true)).toBe(2);
    expect(wav.byteLength).toBe(44 + 3 * 2);
  });
});

describe('masterizacion', () => {
  it('normalizarPico lleva el pico al objetivo con el mismo factor en todos los canales', () => {
    const izq = Float32Array.from([0.1, -0.4, 0.2]);
    const der = Float32Array.from([0.05, 0.2, -0.1]);
    const factor = normalizarPico([izq, der], 0.8);
    expect(factor).toBeCloseTo(2, 6);
    expect(picoDe([izq, der])).toBeCloseTo(0.8, 6);
    expect(der[1]).toBeCloseTo(0.4, 6); // el estereo no se mueve: mismo factor
  });

  it('normalizarPico deja en paz un buffer en silencio', () => {
    const silencio = new Float32Array(10);
    expect(normalizarPico([silencio], 0.9)).toBe(1);
    expect([...silencio].every((x) => x === 0)).toBe(true);
  });

  it('aplicarFundidoFinal baja a cero el final sin tocar lo anterior', () => {
    const canal = new Float32Array(100).fill(1);
    aplicarFundidoFinal([canal], 10);
    expect(canal[89]).toBe(1);
    expect(canal[99]).toBe(0);
    expect(canal[94]).toBeGreaterThan(0.3);
    expect(canal[94]).toBeLessThan(0.7);
    for (let i = 91; i < 100; i++) expect(canal[i]!).toBeLessThan(canal[i - 1]!);
  });

  it('saturarSuave deja la entrada en [-1, 1] dentro de [-1, 1], conserva el signo y redondea los picos', () => {
    const canal = Float32Array.from([-1, -0.5, 0, 0.1, 0.5, 1]);
    saturarSuave([canal], 1.8);
    for (const x of canal) expect(Math.abs(x)).toBeLessThanOrEqual(1 + 1e-6);
    expect(canal[0]!).toBeCloseTo(-1, 6); // el pico llega a +-1 exacto
    expect(canal[5]!).toBeCloseTo(1, 6);
    expect(canal[2]).toBe(0);
    // Un nivel medio sube respecto de uno bajo mas de lo lineal (curva comprimida).
    expect(canal[4]! / 0.5).toBeLessThan(canal[3]! / 0.1);
  });

  it('comprimirBus baja un tono fuerte y no toca uno suave', () => {
    const n = FRECUENCIA_MUESTREO; // un segundo
    const tono = (amplitud: number): Float32Array =>
      Float32Array.from({ length: n }, (_, i) => amplitud * Math.sin((2 * Math.PI * 220 * i) / n));
    const fuerte = [tono(0.9), tono(0.9)];
    const reduccion = comprimirBus(fuerte);
    expect(reduccion).toBeLessThan(-3);
    // En el regimen (segunda mitad) el pico es bastante menor que la entrada.
    expect(Math.max(...fuerte[0]!.subarray(n / 2).map(Math.abs))).toBeLessThan(0.7);
    // Los dos canales reciben la misma ganancia.
    expect(fuerte[0]![n - 100]).toBeCloseTo(fuerte[1]![n - 100]!, 7);

    const suave = [tono(0.02)];
    const original = suave[0]!.slice();
    comprimirBus(suave);
    expect(suave[0]![12345]).toBeCloseTo(original[12345]!, 6);
  });
});

describe('curvaDeAgachado', () => {
  const curva = curvaDeAgachado([1.0, 2.0], 3, 0.5);

  it('vale 1 lejos de los bombos y baja a la profundidad en cada uno', () => {
    expect(curva[0]).toBe(1);
    expect(curva[Math.round(0.5 * 500)]).toBe(1);
    expect(curva[Math.round(1.004 * 500)]!).toBeCloseTo(0.5, 1);
    expect(Math.min(...curva)).toBeGreaterThanOrEqual(0.5 - 1e-6);
    expect(Math.max(...curva)).toBeLessThanOrEqual(1);
  });

  it('vuelve despacio: a 90 ms todavia esta agachado y a 600 ms ya casi sube del todo', () => {
    const tras = (s: number): number => curva[Math.round((1.0 + s) * 500)]!;
    expect(tras(0.09)).toBeLessThan(0.85);
    expect(tras(0.09)).toBeGreaterThan(0.5);
    expect(tras(0.55)).toBeGreaterThan(0.99);
  });

  it('la curva tiene el largo de la duracion a su resolucion', () => {
    expect(curva.length).toBe(3 * 500);
  });
});

describe('renderizarPercusion', () => {
  const composicion = componerDemo();
  const total = Math.ceil((composicion.duracion / 1000) * FRECUENCIA_MUESTREO);
  const pistas = renderizarPercusion(composicion.eventos, total);

  it('es determinista', () => {
    const otra = renderizarPercusion(composicion.eventos, total);
    // Comparacion a mano: toEqual sobre millones de muestras es lentisimo.
    const iguales = (a: Float32Array, b: Float32Array): boolean => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    };
    expect(iguales(otra.principal[0], pistas.principal[0])).toBe(true);
    expect(iguales(otra.principal[1], pistas.principal[1])).toBe(true);
    expect(iguales(otra.caja[1], pistas.caja[1])).toBe(true);
  });

  it('todo es finito y los picos no llegan a saturar antes de masterizar', () => {
    let todoFinito = true;
    for (const pista of [...pistas.principal, ...pistas.caja]) {
      for (let i = 0; i < pista.length; i += 7) if (!Number.isFinite(pista[i])) todoFinito = false;
    }
    expect(todoFinito).toBe(true);
    expect(picoDe(pistas.principal)).toBeGreaterThan(0.3);
    expect(picoDe(pistas.principal)).toBeLessThan(2.5);
  });

  it('en la intro solo suenan hats: nada de bombo ni caja antes del compas 4', () => {
    const antes = Math.round((4 * 1.875 - 0.01) * FRECUENCIA_MUESTREO);
    // El pico de la intro es de hats (ruido agudo y bajito), claramente menor que un bombo.
    const picoIntro = picoDe(pistas.principal.map((c) => c.subarray(0, antes)));
    const bombo = composicion.eventos.find((e) => e.voz === 'bombo')!;
    const desde = Math.round((bombo.tiempo / 1000) * FRECUENCIA_MUESTREO);
    const picoBombo = picoDe(pistas.principal.map((c) => c.subarray(desde, desde + 2000)));
    expect(picoIntro).toBeGreaterThan(0);
    expect(picoBombo).toBeGreaterThan(2 * picoIntro);
  });

  it('el bombo suena en su instante, grave, y la caja solo aparece en la pista de caja', () => {
    const bombo = composicion.eventos.find((e) => e.voz === 'bombo' && e.nota === NOTA_BOMBO)!;
    const desde = Math.round((bombo.tiempo / 1000) * FRECUENCIA_MUESTREO);
    // Un bombo solo (sin los hats que caen en el mismo instante) es un seno grave:
    // pocos cruces por cero despues del clic inicial.
    const solo = renderizarPercusion([{ ...bombo, tiempo: 0 }], 20000);
    const trozo = solo.principal[0].subarray(40, 1800);
    let cruces = 0;
    for (let i = 1; i < trozo.length; i++) if (Math.sign(trozo[i]!) !== Math.sign(trozo[i - 1]!)) cruces++;
    const hz = cruces / 2 / (trozo.length / FRECUENCIA_MUESTREO);
    expect(hz).toBeGreaterThan(40);
    expect(hz).toBeLessThan(150);
    // En la mezcla, la pista de caja esta en silencio justo en el bombo si no hay caja ahi.
    const hayCaja = composicion.eventos.some((e) => e.voz === 'caja' && Math.abs(e.tiempo - bombo.tiempo) < 50);
    if (!hayCaja) expect(picoDe(pistas.caja.map((c) => c.subarray(desde, desde + 1500)))).toBe(0);
  });

  it('cada golpe de caja deja energia en la pista de caja', () => {
    const cajas = composicion.eventos.filter((e) => e.voz === 'caja').slice(0, 20);
    for (const e of cajas) {
      const desde = Math.round((e.tiempo / 1000) * FRECUENCIA_MUESTREO);
      expect(picoDe(pistas.caja.map((c) => c.subarray(desde, desde + 1500)))).toBeGreaterThan(0.05);
    }
  });

  it('un evento mas fuerte suena mas fuerte (la intensidad escala la amplitud)', () => {
    const suave = renderizarPercusion([{ tiempo: 100, duracion: 0, voz: 'bombo', nota: 36, intensidad: 0.4 }], 20000);
    const fuerte = renderizarPercusion([{ tiempo: 100, duracion: 0, voz: 'bombo', nota: 36, intensidad: 0.8 }], 20000);
    expect(picoDe(fuerte.principal)).toBeCloseTo(2 * picoDe(suave.principal), 5);
  });

  it('un evento fuera del buffer no rompe nada', () => {
    const p = renderizarPercusion([{ tiempo: 99_000, duracion: 0, voz: 'hat', nota: 42, intensidad: 0.5 }], 1000);
    expect(picoDe(p.principal)).toBe(0);
  });
});

describe('segmentosDe', () => {
  it('cubre la pieza entera sin huecos ni solapes', () => {
    const total = Math.ceil(82.5 * FRECUENCIA_MUESTREO);
    const segmentos = segmentosDe(total);
    expect(segmentos.length).toBeGreaterThan(4);
    expect(segmentos[0]!.desde).toBe(0);
    expect(segmentos[segmentos.length - 1]!.hasta).toBe(total);
    for (let i = 1; i < segmentos.length; i++) expect(segmentos[i]!.desde).toBe(segmentos[i - 1]!.hasta);
  });

  it('el ultimo segmento absorbe un resto corto para que la cola quede en uno solo', () => {
    const paso = 10 * FRECUENCIA_MUESTREO;
    const segmentos = segmentosDe(paso * 3 + 1000);
    expect(segmentos).toHaveLength(3);
    expect(segmentos[2]!.hasta - segmentos[2]!.desde).toBe(paso + 1000);
  });

  it('una pieza corta es un solo segmento', () => {
    expect(segmentosDe(1000)).toEqual([{ desde: 0, hasta: 1000 }]);
  });
});

describe('midiAHz', () => {
  it('la = 440 Hz y una octava arriba duplica', () => {
    expect(midiAHz(69)).toBeCloseTo(440, 9);
    expect(midiAHz(81)).toBeCloseTo(880, 9);
    expect(midiAHz(60)).toBeCloseTo(261.6256, 3);
  });
});
