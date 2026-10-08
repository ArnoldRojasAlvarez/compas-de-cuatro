// T-027: hitsounds sin archivos. Cada tipo se sintetiza una vez en un
// AudioBuffer mono (un clic corto de instrumento de precision, nada de "pop"
// chillon) y la partida lo reproduce en cada golpe con un
// AudioBufferSourceNode nuevo: crear el source es inevitable en Web Audio y
// barato; el buffer, que es lo caro, no se vuelve a crear.
//
// Todo es deterministico: el ruido sale de un generador con semilla fija (no
// de Math.random), asi el mismo tipo suena igual siempre y los tests pueden
// comparar muestras. Ningun tiempo de juego se lee aca: `cuando` llega
// ya convertido a tiempo del AudioContext (ver CLAUDE.md, "El reloj es el
// audio").

export type TipoHitsound = 'normal' | 'suave' | 'seco';

export const TIPOS_HITSOUND: readonly TipoHitsound[] = ['normal', 'suave', 'seco'];

/** Una componente del sonido: seno de `frecuencia` Hz con caida exponencial de constante `tau` segundos. */
interface Parcial {
  frecuencia: number;
  tau: number;
  amplitud: number;
}

interface Receta {
  /** Largo del buffer, en segundos. */
  duracion: number;
  /** Tonos que componen el cuerpo del sonido. */
  parciales: readonly Parcial[];
  /** Transitorio de ruido (el "clic" del ataque); amplitud 0 lo apaga. */
  ruido: { tau: number; amplitud: number };
  /** Subida suave del tonal, en segundos; 0 es ataque seco. */
  ataque: number;
  /** Semilla del ruido: cada tipo tiene la suya. */
  semilla: number;
  /** Pico final del buffer (0 a 1): deja los tres tipos a un volumen parecido. */
  pico: number;
}

// Normal: ping de madera/metal corto (1,76 kHz mas su quinta) con un clic de
// ruido en el ataque y un cuerpo grave tenue. Seco: casi solo transitorio y un
// golpe grave, el de un palillo contra una tabla. Suave: tono redondo (880 Hz)
// con ataque de unos ms, sin ruido, de caida mas larga.
const RECETAS: Readonly<Record<TipoHitsound, Receta>> = {
  normal: {
    duracion: 0.06,
    parciales: [
      { frecuencia: 1760, tau: 0.006, amplitud: 1 },
      { frecuencia: 2640, tau: 0.0035, amplitud: 0.35 },
      { frecuencia: 520, tau: 0.01, amplitud: 0.3 },
    ],
    ruido: { tau: 0.0009, amplitud: 0.45 },
    ataque: 0,
    semilla: 0x2f6e2b1d,
    pico: 0.8,
  },
  suave: {
    duracion: 0.1,
    parciales: [
      { frecuencia: 880, tau: 0.02, amplitud: 1 },
      { frecuencia: 1760, tau: 0.01, amplitud: 0.22 },
    ],
    ruido: { tau: 0.001, amplitud: 0 },
    ataque: 0.003,
    semilla: 0x1b873593,
    pico: 0.7,
  },
  seco: {
    duracion: 0.035,
    parciales: [
      { frecuencia: 190, tau: 0.005, amplitud: 0.6 },
      { frecuencia: 3200, tau: 0.0015, amplitud: 0.3 },
    ],
    ruido: { tau: 0.0022, amplitud: 0.9 },
    ataque: 0,
    semilla: 0x6c8e9cf5,
    pico: 0.85,
  },
};

/** Subida de unos pocos samples al inicio para que el buffer no arranque con un escalon. */
const FADE_IN_S = 0.00015;
/** Bajada final: el buffer siempre termina en silencio, sin clic de corte. */
const FADE_OUT_S = 0.003;

/** xorshift32: ruido blanco reproducible en [-1, 1). */
function crearRuido(semilla: number): () => number {
  let x = semilla >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x80000000 - 1;
  };
}

/**
 * Sintetiza el buffer de un tipo de hitsound (mono, a la frecuencia de
 * muestreo del contexto). Se llama una vez por partida, no por golpe.
 */
export function crearHitsound(ctx: BaseAudioContext, tipo: TipoHitsound): AudioBuffer {
  const receta = RECETAS[tipo];
  const sr = ctx.sampleRate;
  const largo = Math.max(1, Math.round(receta.duracion * sr));
  const buffer = ctx.createBuffer(1, largo, sr);
  const datos = buffer.getChannelData(0);

  const ruido = crearRuido(receta.semilla);
  let ruidoPrevio = 0;
  for (let i = 0; i < largo; i++) {
    const t = i / sr;
    let muestra = 0;

    // Subida con seno cuadrado: arranca plana, sin pico de pendiente.
    const forma =
      receta.ataque > 0 ? Math.sin((Math.min(1, t / receta.ataque) * Math.PI) / 2) ** 2 : 1;
    for (const parcial of receta.parciales) {
      muestra +=
        parcial.amplitud *
        forma *
        Math.exp(-t / parcial.tau) *
        Math.sin(2 * Math.PI * parcial.frecuencia * t);
    }

    if (receta.ruido.amplitud > 0) {
      // Diferencia entre muestras de ruido: un pasa altos barato, el ruido
      // queda agudo y seco en vez de un soplido.
      const actual = ruido();
      muestra +=
        receta.ruido.amplitud * Math.exp(-t / receta.ruido.tau) * (actual - ruidoPrevio) * 0.5;
      ruidoPrevio = actual;
    }

    const entrada = Math.min(1, t / FADE_IN_S);
    const salida = Math.max(0, Math.min(1, (receta.duracion - t) / FADE_OUT_S));
    datos[i] = muestra * entrada * salida;
  }

  let maximo = 0;
  for (let i = 0; i < largo; i++) {
    maximo = Math.max(maximo, Math.abs(datos[i]!));
  }
  if (maximo > 0) {
    const escala = receta.pico / maximo;
    for (let i = 0; i < largo; i++) {
      datos[i] = datos[i]! * escala;
    }
  }
  return buffer;
}

/**
 * Programa el hitsound en el instante `cuando`, en tiempo del AudioContext
 * (no de pared). Si ese instante ya paso, suena en el acto: no se adelanta.
 * `destino` es el nodo de ganancia de efectos de la partida; sin el, suena
 * directo a la salida. Un tiempo negativo (contexto recien creado) se lleva
 * a 0, porque `start` lanza un RangeError con valores negativos. Devuelve el
 * source por si quien llama quiere enterarse de cuando termina (`onended`).
 */
export function reproducirHitsound(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  cuando: number,
  destino: AudioNode = ctx.destination,
): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(destino);
  source.start(Math.max(0, cuando));
  return source;
}
