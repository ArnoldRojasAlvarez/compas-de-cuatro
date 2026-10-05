// T-051: sintesis de la cancion demo, renderizada de una vez (mas rapido que
// el tiempo real) y sin tocar el reloj del juego: aca no hay gameplay, solo se
// calcula un buffer.
//
// Reparto del trabajo, y por que (todo medido en el navegador: el render
// offline cobra por nodo y por efecto, no por nota):
//
//   Percusion (bombo, caja, hats, crash)  se sintetiza en JS puro (osciladores
//       y ruido con semilla en arreglos tipados) y se mezcla en una pista que
//       entra al grafo como un solo AudioBufferSourceNode. Un nodo por golpe
//       costaba mas que todo el resto junto.
//   Bajo, acordes y melodia  son osciladores y filtros de Web Audio, pero con
//       un conjunto de voces que se reutilizan (como un sintetizador
//       polifonico): cada nota solo programa frecuencia, filtro y envolvente
//       con setValueAtTime/exponentialRampToValueAtTime en una voz libre.
//   Efectos en Web Audio  sidechain con una curva de ganancia (agacha el pad y
//       el bajo en cada bombo), eco punteado (3/16) en ping-pong y una reverb
//       de peines realimentados.
//   Masterizacion en JS  compresor de bus, saturacion suave, fundido y
//       normalizacion a -1,4 dBFS (un DynamicsCompressorNode y un WaveShaper
//       con sobremuestreo costaban casi la mitad del tiempo de render).
//
// La pieza se parte en segmentos que se renderizan en paralelo (cada
// OfflineAudioContext corre en su hilo) con un poco de pre-roll que se
// descarta. Todo es determinista: el ruido sale de un PRNG con semilla.

import { crearPrng, PULSO_MS, SEMILLA, NOTA_CRASH, NOTA_HAT_ABIERTO } from './composicion.js';
import type { Composicion, EventoMusical } from './composicion.js';

export const FRECUENCIA_MUESTREO = 44100;
/** Pico final de la mezcla: 0,85 es -1,4 dBFS, por debajo del -1 dBFS pedido. */
export const PICO_OBJETIVO = 0.85;
/** Fuerza de la saturacion suave de la masterizacion (1 casi no toca; 2 ya aplana los picos). */
const DRIVE_DE_MASTER = 1.8;
/** Fundido de salida al final de la cola, en segundos. */
const FUNDIDO_FINAL_S = 0.6;

// ---------------------------------------------------------------------------
// Utilidades puras (se testean en node)
// ---------------------------------------------------------------------------

export function midiAHz(nota: number): number {
  return 440 * 2 ** ((nota - 69) / 12);
}

/** Cuanto vale el pico absoluto entre todos los canales. */
export function picoDe(canales: readonly Float32Array[]): number {
  let pico = 0;
  for (const canal of canales) {
    for (let i = 0; i < canal.length; i++) {
      const a = Math.abs(canal[i] ?? 0);
      if (a > pico) pico = a;
    }
  }
  return pico;
}

/**
 * Escala todos los canales (el mismo factor, para no mover el estereo) hasta
 * que el pico valga `objetivo`. Devuelve el factor aplicado. Un buffer en
 * silencio se deja como esta.
 */
export function normalizarPico(canales: readonly Float32Array[], objetivo = PICO_OBJETIVO): number {
  const pico = picoDe(canales);
  if (pico === 0 || !Number.isFinite(pico)) return 1;
  const factor = objetivo / pico;
  for (const canal of canales) {
    for (let i = 0; i < canal.length; i++) canal[i] = (canal[i] ?? 0) * factor;
  }
  return factor;
}

/** Baja a cero lineal las ultimas `muestras` de cada canal (que la cola no termine en seco). */
export function aplicarFundidoFinal(canales: readonly Float32Array[], muestras: number): void {
  for (const canal of canales) {
    const n = Math.min(muestras, canal.length);
    for (let k = 0; k < n; k++) {
      const i = canal.length - n + k;
      canal[i] = (canal[i] ?? 0) * (1 - (k + 1) / n);
    }
  }
}

/** La parte de AudioBuffer que necesita el codificador (para poder probarlo sin navegador). */
export interface BufferCodificable {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(canal: number): Float32Array;
}

/** WAV PCM de 16 bits, canales intercalados, con la cabecera RIFF de 44 bytes. */
export function codificarWav(buffer: BufferCodificable): Uint8Array {
  const canales = buffer.numberOfChannels;
  const bytesPorMuestra = 2;
  const datos = buffer.length * canales * bytesPorMuestra;
  const salida = new Uint8Array(44 + datos);
  const vista = new DataView(salida.buffer);
  const texto = (desde: number, s: string): void => {
    for (let i = 0; i < s.length; i++) vista.setUint8(desde + i, s.charCodeAt(i));
  };

  texto(0, 'RIFF');
  vista.setUint32(4, 36 + datos, true);
  texto(8, 'WAVE');
  texto(12, 'fmt ');
  vista.setUint32(16, 16, true); // tamano del bloque fmt
  vista.setUint16(20, 1, true); // PCM
  vista.setUint16(22, canales, true);
  vista.setUint32(24, buffer.sampleRate, true);
  vista.setUint32(28, buffer.sampleRate * canales * bytesPorMuestra, true); // bytes por segundo
  vista.setUint16(32, canales * bytesPorMuestra, true); // alineacion de bloque
  vista.setUint16(34, 16, true); // bits por muestra
  texto(36, 'data');
  vista.setUint32(40, datos, true);

  const fuentes: Float32Array[] = [];
  for (let c = 0; c < canales; c++) fuentes.push(buffer.getChannelData(c));
  let desde = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < canales; c++) {
      const x = Math.max(-1, Math.min(1, fuentes[c]?.[i] ?? 0));
      // Asimetrico a proposito: -1 llega a -32768 y +1 a +32767.
      vista.setInt16(desde, x < 0 ? Math.round(x * 32768) : Math.round(x * 32767), true);
      desde += 2;
    }
  }
  return salida;
}

/** Muestras por segundo de la curva de agachado: de sobra para una envolvente de 90 ms. */
const RESOLUCION_AGACHADO = 500;

/**
 * Curva de ganancia del sidechain: vale 1 y en cada bombo baja a `profundidad`
 * en 4 ms y vuelve despacio (constante de tiempo 90 ms). Se entrega como una
 * sola curva para `setValueCurveAtTime`: cientos de eventos de automatizacion
 * sueltos en un mismo AudioParam cuestan mas que una curva.
 */
export function curvaDeAgachado(
  tiemposS: readonly number[],
  duracionS: number,
  profundidad: number,
): Float32Array<ArrayBuffer> {
  const n = Math.max(2, Math.ceil(duracionS * RESOLUCION_AGACHADO));
  const hundimiento = new Float32Array(n); // 0 sin efecto, 1 en el fondo del agachado
  const ataque = 0.004;
  const caida = 0.09;
  for (const t of tiemposS) {
    const desde = Math.max(0, Math.floor(t * RESOLUCION_AGACHADO));
    const hasta = Math.min(n - 1, desde + Math.ceil(0.6 * RESOLUCION_AGACHADO));
    for (let i = desde; i <= hasta; i++) {
      const x = i / RESOLUCION_AGACHADO - t;
      const e = x < 0 ? 0 : x < ataque ? x / ataque : Math.exp(-(x - ataque) / caida);
      if (e > (hundimiento[i] ?? 0)) hundimiento[i] = e;
    }
  }
  const curva = new Float32Array(n);
  for (let i = 0; i < n; i++) curva[i] = 1 - (1 - profundidad) * (hundimiento[i] ?? 0);
  return curva;
}

/** Parametros del compresor de bus (pegamento de la mezcla). */
export interface OpcionesCompresor {
  umbralDb: number;
  razon: number;
  rodillaDb: number;
  ataqueS: number;
  liberacionS: number;
}

export const COMPRESOR_DE_BUS: OpcionesCompresor = {
  umbralDb: -13,
  razon: 3,
  rodillaDb: 10,
  ataqueS: 0.008,
  liberacionS: 0.16,
};

/**
 * Compresor de bus feed-forward, en el lugar y con los canales enlazados (la
 * misma reduccion de ganancia para ambos, para no mover el estereo). Detector
 * de pico, curva con rodilla suave y suavizado con ataque y liberacion. Va en
 * JS y no como DynamicsCompressorNode porque en el render offline este ultimo
 * costaba casi lo que toda la sintesis. Devuelve la reduccion maxima en dB.
 */
export function comprimirBus(
  canales: readonly Float32Array[],
  frecuencia = FRECUENCIA_MUESTREO,
  op: OpcionesCompresor = COMPRESOR_DE_BUS,
): number {
  const largo = canales[0]?.length ?? 0;
  const kAtaque = Math.exp(-1 / (op.ataqueS * frecuencia));
  const kLiberacion = Math.exp(-1 / (op.liberacionS * frecuencia));
  const pendiente = 1 / op.razon - 1;
  let reduccion = 0; // dB, <= 0
  let peor = 0;
  for (let i = 0; i < largo; i++) {
    let pico = 1e-6;
    for (const canal of canales) {
      const a = Math.abs(canal[i] ?? 0);
      if (a > pico) pico = a;
    }
    const nivelDb = 8.685889638 * Math.log(pico);
    const sobre = nivelDb - op.umbralDb;
    let objetivo = 0;
    if (2 * sobre > op.rodillaDb) objetivo = pendiente * sobre;
    else if (2 * sobre > -op.rodillaDb) {
      const x = sobre + op.rodillaDb / 2;
      objetivo = (pendiente * x * x) / (2 * op.rodillaDb);
    }
    // Mas reduccion (valor mas negativo) usa el ataque; menos, la liberacion.
    const k = objetivo < reduccion ? kAtaque : kLiberacion;
    reduccion = objetivo + k * (reduccion - objetivo);
    if (reduccion < peor) peor = reduccion;
    const g = Math.exp(0.1151292546 * reduccion);
    for (const canal of canales) canal[i] = (canal[i] ?? 0) * g;
  }
  return peor;
}

/**
 * Saturacion suave tipo tanh, en el lugar: redondea los picos que quedan en
 * vez de recortarlos. Con `drive` 1 apenas toca; sube el contenido armonico
 * cerca de +-1. Una entrada en [-1, 1] sale en [-1, 1] (+-1 queda en +-1).
 */
export function saturarSuave(canales: readonly Float32Array[], drive = 1.25): void {
  const norma = Math.tanh(drive);
  for (const canal of canales) {
    for (let i = 0; i < canal.length; i++) canal[i] = Math.tanh(drive * (canal[i] ?? 0)) / norma;
  }
}

// ---------------------------------------------------------------------------
// Percusion en JS puro
// ---------------------------------------------------------------------------

/** Pasa altos de segundo orden (RBJ), en el lugar. */
function pasaAltos(datos: Float32Array, corteHz: number, frecuencia: number): void {
  const w = (2 * Math.PI * corteHz) / frecuencia;
  const alfa = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const a0 = 1 + alfa;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alfa) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < datos.length; i++) {
    const x = datos[i] ?? 0;
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    datos[i] = y;
  }
}

/** Ruido blanco con semilla, ya filtrado con un pasa altos. */
function ruidoFiltrado(corteHz: number, frecuencia: number, semilla: number): Float32Array {
  const datos = new Float32Array(Math.floor(frecuencia * 1.6));
  const azar = crearPrng(semilla);
  for (let i = 0; i < datos.length; i++) datos[i] = azar() * 2 - 1;
  pasaAltos(datos, corteHz, frecuencia);
  return datos;
}

/** Una muestra de percusion lista para sumar: ya trae su amplitud base y se escala por la intensidad. */
type Plantilla = Float32Array;
const VACIA: Plantilla = new Float32Array(0);
type Canal = Float32Array<ArrayBuffer>;

/** Corta una plantilla de ruido con envolvente exponencial: ataque corto y caida con constante `tau`. */
function plantillaDeRuido(
  ruido: Float32Array,
  desdeS: number,
  duracionS: number,
  tau: number,
  amplitud: number,
  frecuencia: number,
): Plantilla {
  const n = Math.floor(duracionS * frecuencia);
  const salida = new Float32Array(n);
  const desde = Math.floor(desdeS * frecuencia) % Math.max(1, ruido.length - n);
  const ataque = Math.floor(0.001 * frecuencia);
  for (let i = 0; i < n; i++) {
    const t = i / frecuencia;
    const env = (i < ataque ? (i + 1) / ataque : 1) * Math.exp(-t / tau);
    salida[i] = (ruido[desde + i] ?? 0) * env * amplitud;
  }
  return salida;
}

function plantillaDeBombo(frecuencia: number): Plantilla {
  const n = Math.floor(0.45 * frecuencia);
  const salida = new Float32Array(n);
  let fase = 0;
  let faseClic = 0;
  for (let i = 0; i < n; i++) {
    const t = i / frecuencia;
    // Barrido de altura de 155 a 44 Hz: el "golpe" del bombo.
    const f = 44 + 111 * Math.exp(-t / 0.03);
    fase += (2 * Math.PI * f) / frecuencia;
    const ataque = t < 0.003 ? t / 0.003 : 1;
    const cola = t > 0.36 ? Math.max(0, 1 - (t - 0.36) / 0.09) : 1;
    let muestra = 0.5 * Math.sin(fase) * ataque * Math.exp(-t / 0.135) * cola;
    // Clic del mazo: un tono agudo que cae muy rapido.
    const fc = 220 + 1580 * Math.exp(-t / 0.004);
    faseClic += (2 * Math.PI * fc) / frecuencia;
    muestra += 0.1 * Math.sin(faseClic) * Math.exp(-t / 0.003);
    salida[i] = muestra;
  }
  return salida;
}

function plantillaDeCuerpoDeCaja(frecuencia: number): Plantilla {
  const n = Math.floor(0.14 * frecuencia);
  const salida = new Float32Array(n);
  let fase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / frecuencia;
    const f = 158 + 47 * Math.exp(-t / 0.03);
    fase += (2 * Math.PI * f) / frecuencia;
    // Onda triangular a partir del seno.
    const tri = (2 / Math.PI) * Math.asin(Math.sin(fase));
    const ataque = t < 0.002 ? t / 0.002 : 1;
    salida[i] = 0.6 * tri * ataque * Math.exp(-t / 0.0158);
  }
  return salida;
}

export interface PistasDePercusion {
  /** Bombo, hats y crash: va derecho a la mezcla. Dos canales. */
  principal: [Canal, Canal];
  /** Solo la caja: ademas de la mezcla, alimenta la reverb. Dos canales. */
  caja: [Canal, Canal];
}

function sumar(destino: Float32Array, plantilla: Plantilla, desde: number, ganancia: number): void {
  const fin = Math.min(destino.length, desde + plantilla.length);
  for (let i = Math.max(0, desde); i < fin; i++) {
    destino[i] = (destino[i] ?? 0) + (plantilla[i - desde] ?? 0) * ganancia;
  }
}

/**
 * Sintetiza la percusion de la composicion en dos pistas estereo de `total`
 * muestras. Pura y determinista.
 */
export function renderizarPercusion(
  eventos: readonly EventoMusical[],
  total: number,
  frecuencia = FRECUENCIA_MUESTREO,
): PistasDePercusion {
  const principal: [Canal, Canal] = [new Float32Array(total), new Float32Array(total)];
  const caja: [Canal, Canal] = [new Float32Array(total), new Float32Array(total)];

  const ruidoCaja = ruidoFiltrado(1100, frecuencia, SEMILLA ^ 0x9e3779b9);
  const ruidoHats = ruidoFiltrado(7200, frecuencia, SEMILLA ^ 0x85ebca6b);
  const ruidoCrash = ruidoFiltrado(4200, frecuencia, SEMILLA ^ 0xc2b2ae35);

  const bombo = plantillaDeBombo(frecuencia);
  const cuerpo = plantillaDeCuerpoDeCaja(frecuencia);
  // Tres variantes de cada golpe de ruido para que no suenen identicos.
  const desfases = [0.0, 0.37, 0.71];
  const cajas = desfases.map((d) => plantillaDeRuido(ruidoCaja, d, 0.24, 0.0263, 0.75, frecuencia));
  const hatsCerrados = desfases.map((d) => plantillaDeRuido(ruidoHats, d, 0.07, 0.008, 0.55, frecuencia));
  const hatsAbiertos = desfases.map((d) => plantillaDeRuido(ruidoHats, d, 0.32, 0.04, 0.58, frecuencia));
  const crash = plantillaDeRuido(ruidoCrash, 0.2, 1.5, 0.2, 0.7, frecuencia);

  let golpe = 0;
  for (const e of eventos) {
    const desde = Math.round((e.tiempo / 1000) * frecuencia);
    const v = e.intensidad;
    const variante = golpe++ % 3;
    switch (e.voz) {
      case 'bombo':
        sumar(principal[0], bombo, desde, v);
        sumar(principal[1], bombo, desde, v);
        break;
      case 'caja':
        for (const pista of [principal, caja]) {
          sumar(pista[0], cajas[variante] ?? VACIA, desde, v);
          sumar(pista[1], cajas[variante] ?? VACIA, desde, v);
          sumar(pista[0], cuerpo, desde, v);
          sumar(pista[1], cuerpo, desde, v);
        }
        break;
      case 'hat': {
        // Los hats van un poco a la derecha (izquierda 0,85, derecha 1,0).
        const plantilla =
          e.nota === NOTA_CRASH
            ? crash
            : e.nota === NOTA_HAT_ABIERTO
              ? (hatsAbiertos[variante] ?? VACIA)
              : (hatsCerrados[variante] ?? VACIA);
        sumar(principal[0], plantilla, desde, v * 0.85);
        sumar(principal[1], plantilla, desde, v);
        break;
      }
      default:
        break;
    }
  }
  return { principal, caja };
}

// ---------------------------------------------------------------------------
// Grafo de mezcla (Web Audio)
// ---------------------------------------------------------------------------

function ganancia(ctx: BaseAudioContext, valor: number, destino?: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.value = valor;
  if (destino) g.connect(destino);
  return g;
}

/**
 * Reverb de sala chica hecha con peines realimentados (estilo Freeverb): dos
 * lineas de retardo por canal con tiempos primos entre si y un pasabajos comun
 * que oscurece la cola. Es mucho mas barata que un ConvolverNode (que en el
 * render offline costaba mas que todo el resto junto) y alcanza para dar aire
 * al pad, a la melodia y a la caja. Devuelve la entrada.
 */
function crearReverb(ctx: BaseAudioContext, salida: AudioNode): GainNode {
  const entrada = ganancia(ctx, 1);
  const tiempos: readonly (readonly number[])[] = [
    [0.0297, 0.0437],
    [0.0331, 0.0479],
  ];
  tiempos.forEach((lado, c) => {
    const suma = ctx.createGain();
    suma.gain.value = 0.3;
    const tono = ctx.createBiquadFilter();
    tono.type = 'lowpass';
    tono.frequency.value = 3400;
    const pan = ctx.createStereoPanner();
    pan.pan.value = c === 0 ? -0.8 : 0.8;
    suma.connect(tono);
    tono.connect(pan);
    pan.connect(salida);
    for (const t of lado) {
      const retardo = ctx.createDelay(0.1);
      retardo.delayTime.value = t;
      const realimentacion = ganancia(ctx, 0.84);
      entrada.connect(retardo);
      retardo.connect(realimentacion);
      realimentacion.connect(retardo);
      retardo.connect(suma);
    }
  });
  return entrada;
}

/** Una voz del sintetizador: nodos persistentes que se reutilizan nota tras nota. */
interface Voz {
  /** Instante (s) a partir del cual la voz esta libre: ya no tiene eventos de automatizacion pendientes. */
  libre: number;
}

/**
 * Conjunto de voces que crece segun hace falta: una nota toma la primera voz
 * libre y, si no hay, se crea una nueva. Las voces nuevas arrancan sus
 * osciladores en el instante en que se usan por primera vez (un oscilador
 * en marcha cuesta render aunque suene en silencio), asi que el conjunto
 * termina del tamano exacto de la polifonia que pide la partitura.
 */
class Reserva<V extends Voz> {
  private readonly voces: V[] = [];

  constructor(private readonly crear: (arranque: number) => V) {}

  tomar(t: number): V {
    for (const v of this.voces) if (v.libre <= t) return v;
    const nueva = this.crear(Math.max(0, t - 0.05));
    this.voces.push(nueva);
    return nueva;
  }
}

interface VozBajo extends Voz {
  frecuencias: readonly AudioParam[];
  corte: AudioParam;
  amplitud: AudioParam;
}

interface VozPad extends Voz {
  frecuencia: AudioParam;
  corte: AudioParam;
  amplitud: AudioParam;
}

interface VozMelodia extends Voz {
  frecuencias: readonly AudioParam[];
  corte: AudioParam;
  amplitud: AudioParam;
  vibrato: AudioParam;
}

interface Mezcla {
  ctx: OfflineAudioContext;
  bajos: Reserva<VozBajo>;
  /** Tres reservas del pad con reparto estereo fijo (izquierda, centro, derecha). */
  pads: readonly Reserva<VozPad>[];
  melodias: Reserva<VozMelodia>;
  agacharPad: AudioParam;
  agacharBajo: AudioParam;
}

function nuevoOscilador(ctx: BaseAudioContext, tipo: OscillatorType, arranque: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = tipo;
  o.frequency.value = 110;
  // k-rate: la altura se actualiza una vez por bloque de 128 muestras (2,9 ms).
  // Es inaudible en un cambio de nota y evita calcular la fase muestra a muestra.
  o.frequency.automationRate = 'k-rate';
  o.start(arranque);
  return o;
}

function nuevoPasabajos(ctx: BaseAudioContext, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = q;
  f.frequency.value = 800;
  // En a-rate, automatizar el corte hace que Chrome recalcule los coeficientes
  // del biquad en cada muestra (senos y cosenos a 44100 por segundo y por voz):
  // era lo que mas costaba del render. En k-rate se recalculan una vez por bloque.
  f.frequency.automationRate = 'k-rate';
  f.Q.automationRate = 'k-rate';
  return f;
}

function crearVozBajo(ctx: BaseAudioContext, destino: AudioNode, arranque: number): VozBajo {
  const sierra = nuevoOscilador(ctx, 'sawtooth', arranque);
  const sub = nuevoOscilador(ctx, 'sine', arranque);
  const filtro = nuevoPasabajos(ctx, 3.5);
  const g = ganancia(ctx, 0, destino);
  sierra.connect(ganancia(ctx, 0.5, filtro));
  filtro.connect(g);
  sub.connect(ganancia(ctx, 0.9, g));
  return { libre: 0, frecuencias: [sierra.frequency, sub.frequency], corte: filtro.frequency, amplitud: g.gain };
}

function crearVozPad(ctx: BaseAudioContext, destino: AudioNode, arranque: number): VozPad {
  const sierra = nuevoOscilador(ctx, 'sawtooth', arranque);
  const filtro = nuevoPasabajos(ctx, 0.8);
  const g = ganancia(ctx, 0, destino);
  sierra.connect(filtro);
  filtro.connect(g);
  return { libre: 0, frecuencia: sierra.frequency, corte: filtro.frequency, amplitud: g.gain };
}

function crearVozMelodia(ctx: BaseAudioContext, lfo: AudioNode, destino: AudioNode, arranque: number): VozMelodia {
  const sierra = nuevoOscilador(ctx, 'sawtooth', arranque);
  const cuadrada = nuevoOscilador(ctx, 'square', arranque);
  cuadrada.detune.value = 6;
  const filtro = nuevoPasabajos(ctx, 1.4);
  const g = ganancia(ctx, 0, destino);
  sierra.connect(ganancia(ctx, 0.6, filtro));
  cuadrada.connect(ganancia(ctx, 0.28, filtro));
  filtro.connect(g);
  // Vibrato: un LFO comun entra por una ganancia propia de cada voz (en cents).
  const profundidad = ganancia(ctx, 0);
  lfo.connect(profundidad);
  profundidad.connect(sierra.detune);
  profundidad.connect(cuadrada.detune);
  return {
    libre: 0,
    frecuencias: [sierra.frequency, cuadrada.frequency],
    corte: filtro.frequency,
    amplitud: g.gain,
    vibrato: profundidad.gain,
  };
}

function armarMezcla(ctx: OfflineAudioContext, pistas: PistasDePercusion, desde: number, largo: number): Mezcla {
  const pulso = PULSO_MS / 1000;

  // Suma maestra. El compresor y el saturador se aplican despues, en JS, sobre
  // la mezcla completa (ver `comprimirBus` y `saturarSuave`): en el render offline
  // un compresor y un WaveShaper con sobremuestreo costaban casi la mitad del tiempo.
  const maestro = ctx.createGain();
  maestro.connect(ctx.destination);

  // Reverb comun (sala chica); cada voz manda lo suyo.
  const reverb = crearReverb(ctx, maestro);
  const enviarReverb = (cantidad: number): GainNode => ganancia(ctx, cantidad, reverb);

  // Percusion: dos pistas ya mezcladas en JS, cada una un solo nodo.
  const pistaFuente = (datos: [Canal, Canal], destino: AudioNode): void => {
    const buffer = ctx.createBuffer(2, largo, ctx.sampleRate);
    buffer.copyToChannel(datos[0].subarray(desde, desde + largo), 0);
    buffer.copyToChannel(datos[1].subarray(desde, desde + largo), 1);
    const fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(destino);
    fuente.start(0);
  };
  pistaFuente(pistas.principal, maestro);
  pistaFuente(pistas.caja, enviarReverb(0.16));

  // Bajo y pad se agachan con el bombo (sidechain): cada uno pasa por un
  // GainNode cuya ganancia sigue la curva de `curvaDeAgachado`.
  const agachadoBajo = ganancia(ctx, 1, maestro);
  const busBajo = ganancia(ctx, 1.0, agachadoBajo);
  const bajos = new Reserva((arranque) => crearVozBajo(ctx, busBajo, arranque));

  const agachadoPad = ganancia(ctx, 1, maestro);
  const busPad = ganancia(ctx, 1.0, agachadoPad);
  busPad.connect(enviarReverb(0.34));
  // Las voces del acorde se reparten por altura con tres panoramizadores
  // compartidos (uno por nota seria mucho mas caro en el render).
  const pads = [-0.45, 0, 0.45].map((posicion) => {
    const pan = ctx.createStereoPanner();
    pan.pan.value = posicion;
    pan.connect(busPad);
    return new Reserva((arranque) => crearVozPad(ctx, pan, arranque));
  });

  // Melodia: seca, con eco punteado en ping-pong y reverb.
  const busMelodia = ganancia(ctx, 1.0, maestro);
  busMelodia.connect(enviarReverb(0.26));
  const envioEco = ganancia(ctx, 0.36);
  busMelodia.connect(envioEco);
  const retardoI = ctx.createDelay(1);
  const retardoD = ctx.createDelay(1);
  retardoI.delayTime.value = 0.75 * pulso; // corchea con puntillo
  retardoD.delayTime.value = 0.75 * pulso;
  const tonoEco = ctx.createBiquadFilter();
  tonoEco.type = 'lowpass';
  tonoEco.frequency.value = 3000;
  const realimentacion = ganancia(ctx, 0.4);
  const panI = ctx.createStereoPanner();
  panI.pan.value = -0.65;
  const panD = ctx.createStereoPanner();
  panD.pan.value = 0.65;
  const salidaEco = ganancia(ctx, 0.55, maestro);
  envioEco.connect(retardoI);
  retardoI.connect(panI);
  panI.connect(salidaEco);
  retardoI.connect(tonoEco);
  tonoEco.connect(retardoD);
  retardoD.connect(panD);
  panD.connect(salidaEco);
  retardoD.connect(realimentacion);
  realimentacion.connect(retardoI);
  salidaEco.connect(enviarReverb(0.2));

  const lfo = nuevoOscilador(ctx, 'sine', 0);
  lfo.frequency.value = 5.3;
  const melodias = new Reserva((arranque) => crearVozMelodia(ctx, lfo, busMelodia, arranque));

  return { ctx, bajos, pads, melodias, agacharPad: agachadoPad.gain, agacharBajo: agachadoBajo.gain };
}

// ---------------------------------------------------------------------------
// Notas: programar una voz libre
// ---------------------------------------------------------------------------

function bajo(m: Mezcla, t: number, dur: number, nota: number, v: number): void {
  const voz = m.bajos.tomar(t);
  const f = midiAHz(nota);
  for (const p of voz.frecuencias) p.setValueAtTime(f, t);
  // Filtro "pluck": arranca abierto y se cierra enseguida.
  voz.corte.setValueAtTime(650 + 1500 * v, t);
  voz.corte.exponentialRampToValueAtTime(190 + 300 * v, t + 0.2);

  const g = voz.amplitud;
  const a = 0.18 * (0.55 + 0.45 * v);
  const fin = t + dur;
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(a, t + 0.008);
  let cierre: number;
  if (dur > 0.8) {
    // Nota larga: se sostiene y se suelta al final.
    g.setValueAtTime(a, fin - 0.12);
    g.linearRampToValueAtTime(0, fin + 0.05);
    cierre = fin + 0.05;
  } else {
    g.exponentialRampToValueAtTime(a * 0.55, fin);
    g.linearRampToValueAtTime(0, fin + 0.035);
    cierre = fin + 0.035;
  }
  voz.libre = Math.max(cierre, t + 0.2) + 0.001;
}

function acorde(m: Mezcla, t: number, dur: number, nota: number, v: number): void {
  // Reparto estereo por altura: las voces graves a la izquierda.
  const zona = m.pads[nota < 59 ? 0 : nota < 65 ? 1 : 2];
  if (!zona) return;
  const voz = zona.tomar(t);
  voz.frecuencia.setValueAtTime(midiAHz(nota), t);
  const g = voz.amplitud;
  const fin = t + dur;
  if (dur >= 1) {
    // Pad: ataque lento y filtro que se abre; la salida se cruza con el acorde que sigue.
    const corte = 650 + 2700 * v;
    voz.corte.setValueAtTime(corte * 0.5, t);
    voz.corte.exponentialRampToValueAtTime(corte, t + 0.7);
    const a = 0.13 * (0.5 + v);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(a, t + 0.28);
    g.setValueAtTime(a, fin - 0.05);
    g.linearRampToValueAtTime(0, fin + 0.45);
    voz.libre = fin + 0.451;
  } else {
    // Golpe corto (acorde sincopado o nota de arpegio): pluck con filtro que cae.
    const corte = 900 + 2600 * v;
    const caida = Math.max(0.1, dur * 0.9);
    voz.corte.setValueAtTime(corte * 2.0, t);
    voz.corte.exponentialRampToValueAtTime(corte * 0.55, t + caida);
    const a = 0.16 * (0.5 + v);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(a, t + 0.005);
    g.exponentialRampToValueAtTime(a * 0.3, t + Math.max(0.09, dur * 0.85));
    g.linearRampToValueAtTime(0, t + dur + 0.12);
    voz.libre = Math.max(t + dur + 0.12, t + caida) + 0.001;
  }
}

function melodia(m: Mezcla, t: number, dur: number, nota: number, v: number): void {
  const voz = m.melodias.tomar(t);
  const f = midiAHz(nota);
  for (const p of voz.frecuencias) p.setValueAtTime(f, t);
  voz.corte.setValueAtTime(2300 + 2600 * v, t);
  voz.corte.exponentialRampToValueAtTime(1500 + 700 * v, t + 0.3);

  const g = voz.amplitud;
  const a = 0.32 * (0.55 + 0.6 * v);
  const fin = t + dur;
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(a, t + 0.006);
  g.exponentialRampToValueAtTime(a * 0.62, t + 0.14);
  g.setValueAtTime(a * 0.62, Math.max(t + 0.14, fin - 0.04));
  g.linearRampToValueAtTime(0, fin + 0.16);

  // Vibrato que entra despues del ataque, solo en las notas largas.
  const vib = voz.vibrato;
  vib.setValueAtTime(0, t);
  let cierre = Math.max(t + 0.3, fin + 0.16);
  if (dur > 0.45) {
    vib.linearRampToValueAtTime(0, t + 0.22);
    vib.linearRampToValueAtTime(10, t + 0.55);
    vib.setValueAtTime(10, fin);
    vib.linearRampToValueAtTime(0, fin + 0.1);
    cierre = Math.max(cierre, fin + 0.1);
  }
  voz.libre = cierre + 0.001;
}

function programar(m: Mezcla, e: EventoMusical, t: number): void {
  const dur = e.duracion / 1000;
  switch (e.voz) {
    case 'bajo':
      bajo(m, t, dur, e.nota, e.intensidad);
      break;
    case 'acorde':
      acorde(m, t, dur, e.nota, e.intensidad);
      break;
    case 'melodia':
      melodia(m, t, dur, e.nota, e.intensidad);
      break;
    default:
      // La percusion ya esta en las pistas de JS.
      break;
  }
}

// ---------------------------------------------------------------------------
// Sintesis
// ---------------------------------------------------------------------------

/** Largo de cada segmento que se renderiza por separado, en segundos. */
const SEGMENTO_S = 10;
/**
 * Lo que se renderiza de mas antes de cada segmento (se descarta): deja
 * que las colas (eco, reverb, soltado del pad, compresor) lleguen en regimen.
 * Tiene que superar la duracion de cualquier evento que empiece antes del
 * segmento y siga sonando en el, salvo en el ultimo (ver `segmentosDe`).
 */
const PREROLL_S = 2.5;

export interface Segmento {
  /** Primer frame de la pieza que cubre, y el ultimo (exclusivo). */
  desde: number;
  hasta: number;
}

/**
 * Parte la pieza en segmentos de unos 10 s que se renderizan en paralelo (un
 * OfflineAudioContext por segmento, cada uno en su hilo). El ultimo segmento
 * absorbe el resto si es corto, para que la cola final (acorde largo del
 * cierre) quede entera en uno solo.
 */
export function segmentosDe(totalFrames: number, frecuencia = FRECUENCIA_MUESTREO): Segmento[] {
  const paso = Math.round(SEGMENTO_S * frecuencia);
  const segmentos: Segmento[] = [];
  for (let desde = 0; desde < totalFrames; desde += paso) {
    segmentos.push({ desde, hasta: Math.min(totalFrames, desde + paso) });
  }
  const ultimo = segmentos[segmentos.length - 1];
  const anterior = segmentos[segmentos.length - 2];
  if (ultimo && anterior && ultimo.hasta - ultimo.desde < paso / 2) {
    segmentos.pop();
    anterior.hasta = ultimo.hasta;
  }
  return segmentos;
}

async function renderizarSegmento(
  composicion: Composicion,
  segmento: Segmento,
  pistas: PistasDePercusion,
): Promise<Float32Array[]> {
  const frecuencia = FRECUENCIA_MUESTREO;
  const arranque = Math.max(0, segmento.desde - Math.round(PREROLL_S * frecuencia));
  const largo = segmento.hasta - arranque;
  const origenS = arranque / frecuencia;
  const finS = segmento.hasta / frecuencia;

  const ctx = new OfflineAudioContext(2, largo, frecuencia);
  const mezcla = armarMezcla(ctx, pistas, arranque, largo);

  const tiemposBombo: number[] = [];
  for (const e of composicion.eventos) {
    const t = e.tiempo / 1000;
    // Solo lo que empieza dentro de la ventana renderizada (pre-roll incluido).
    if (t < origenS || t >= finS) continue;
    programar(mezcla, e, t - origenS);
    if (e.voz === 'bombo') tiemposBombo.push(t - origenS);
  }
  const duracionS = largo / frecuencia;
  mezcla.agacharPad.setValueCurveAtTime(curvaDeAgachado(tiemposBombo, duracionS, 0.52), 0, duracionS);
  mezcla.agacharBajo.setValueCurveAtTime(curvaDeAgachado(tiemposBombo, duracionS, 0.6), 0, duracionS);

  const buffer = await ctx.startRendering();
  // Se descarta el pre-roll: solo se devuelve lo que cae en [desde, hasta).
  const salto = segmento.desde - arranque;
  const cantidad = segmento.hasta - segmento.desde;
  const canales: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    canales.push(buffer.getChannelData(c).slice(salto, salto + cantidad));
  }
  return canales;
}

/**
 * Renderiza la composicion en un buffer estereo de 44100 Hz con el pico
 * normalizado a -1,4 dBFS. Devuelve un AudioBuffer.
 */
export async function sintetizarDemo(composicion: Composicion): Promise<AudioBuffer> {
  const total = Math.ceil((composicion.duracion / 1000) * FRECUENCIA_MUESTREO);
  const pistas = renderizarPercusion(composicion.eventos, total);
  const segmentos = segmentosDe(total);
  const partes = await Promise.all(segmentos.map((seg) => renderizarSegmento(composicion, seg, pistas)));

  const canales = [new Float32Array(total), new Float32Array(total)];
  segmentos.forEach((seg, k) => {
    partes[k]?.forEach((datos, c) => canales[c]?.set(datos, seg.desde));
  });

  // Masterizacion en JS: se lleva el pico a un nivel conocido para que el
  // umbral del compresor tenga sentido, se comprime, se satura suave, se aplica
  // el fundido de salida y se normaliza al pico final.
  normalizarPico(canales, 0.9);
  comprimirBus(canales);
  saturarSuave(canales, DRIVE_DE_MASTER);
  aplicarFundidoFinal(canales, Math.floor(FUNDIDO_FINAL_S * FRECUENCIA_MUESTREO));
  normalizarPico(canales, PICO_OBJETIVO);

  const buffer = new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate: FRECUENCIA_MUESTREO });
  canales.forEach((datos, c) => buffer.copyToChannel(datos, c));
  return buffer;
}
