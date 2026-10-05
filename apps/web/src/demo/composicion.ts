// T-051: la partitura de la cancion demo "Primer Compas". Funcion pura y
// determinista: no toca el navegador y no usa Math.random (el poco azar que
// hay, la humanizacion de intensidades, sale de un PRNG con semilla fija).
//
// La pieza esta en la menor, 4/4, 128 BPM, 44 compases (82,5 s):
//
//   compases  seccion   que pasa
//   0 a 3     intro     hats que van creciendo y el pad de acordes
//   4 a 11    A         entra el bombo, la caja y el bajo (Am F C G, dos veces)
//   12 a 19   B         la melodia arriba, hats a semicorcheas, bajo en corcheas,
//                       acordes sincopados (F G Am E, dos frases)
//   20 a 23   quiebre   sin bombo: pad, melodia lenta y redoble de caja
//   24 a 31   A'        vuelve el groove, mas lleno: bajo en corcheas, hats a
//                       semicorcheas y una contramelodia
//   32 a 39   B'        el climax: la melodia mas alta sobre un arpegio de
//                       semicorcheas, con crash y fills
//   40 a 43   cola      el acorde final de la menor (con la novena) que se apaga
//
// La progresion de A es i-VI-III-VII (Am F C G); la de B baja a VI-VII-i-V
// (F G Am E), donde el E mayor (con el sol sostenido) es la dominante que
// empuja a la tonica. Cada compas tiene un acorde y los acordes estan
// conducidos para que las voces se muevan poco entre uno y otro.
//
// Los mapas (mapas.ts) se derivan de estos eventos: nada de lo que se juega
// existe fuera de la partitura.

export interface EventoMusical {
  /** ms desde el inicio de la pieza. */
  tiempo: number;
  /** ms; 0 para golpes de percusion. */
  duracion: number;
  voz: 'bombo' | 'caja' | 'hat' | 'bajo' | 'acorde' | 'melodia';
  /** Nota MIDI (percusion: cualquier valor fijo). */
  nota: number;
  /** 0 a 1. */
  intensidad: number;
}

export interface Composicion {
  bpm: number;
  /** ms totales, incluida la cola final. */
  duracion: number;
  /** ms de la seccion que mejor representa la pieza (para PreviewTime). */
  preview: number;
  eventos: EventoMusical[]; // ordenados por tiempo
}

// ---------------------------------------------------------------------------
// Rejilla de tiempo
// ---------------------------------------------------------------------------

export const BPM = 128;
/** Una negra. */
export const PULSO_MS = 60000 / BPM;
/** Un compas de 4/4. */
export const COMPAS_MS = PULSO_MS * 4;
/** Una semicorchea: la rejilla mas fina de la pieza (16 por compas). */
export const SLOT_MS = PULSO_MS / 4;
export const SLOTS_POR_COMPAS = 16;

/** Notas MIDI fijas para la percusion (convencion General MIDI). */
export const NOTA_BOMBO = 36;
export const NOTA_CAJA = 38;
export const NOTA_HAT_CERRADO = 42;
export const NOTA_HAT_ABIERTO = 46;
/** Platillo de ataque: es un 'hat' con la nota 49 (el sintetizador lo suena largo). */
export const NOTA_CRASH = 49;

// ---------------------------------------------------------------------------
// PRNG con semilla (mulberry32): determinista, sin Math.random
// ---------------------------------------------------------------------------

export const SEMILLA = 0x5eed_0004;

/** Devuelve una funcion que da numeros en [0, 1). Mismo uso que Math.random. */
export function crearPrng(semilla: number): () => number {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Armonia
// ---------------------------------------------------------------------------

type Acorde = 'Am' | 'F' | 'C' | 'G' | 'E' | 'Dm';

interface DatosAcorde {
  /** Nota MIDI de la raiz para el bajo (A1 = 33). */
  raiz: number;
  /** Voicing del pad, de grave a agudo: cuatro voces con la septima o la novena. */
  notas: readonly number[];
  /** Tres voces para los acordes sincopados: la tercera y la septima siempre estan. */
  golpe: readonly number[];
}

const ACORDES: Record<Acorde, DatosAcorde> = {
  Am: { raiz: 33, notas: [57, 60, 64, 67], golpe: [60, 64, 67] }, // La Do Mi Sol (Am7)
  F: { raiz: 29, notas: [57, 60, 64, 65], golpe: [60, 64, 65] }, // La Do Mi Fa (Fmaj7, sin raiz: la pone el bajo)
  C: { raiz: 36, notas: [60, 64, 67, 71], golpe: [64, 67, 71] }, // Do Mi Sol Si (Cmaj7)
  G: { raiz: 31, notas: [59, 62, 67, 69], golpe: [62, 67, 69] }, // Si Re Sol La (G add9)
  E: { raiz: 40, notas: [56, 59, 62, 64], golpe: [56, 62, 64] }, // Sol# Si Re Mi (E7 sin quinta)
  Dm: { raiz: 38, notas: [57, 60, 62, 65], golpe: [60, 62, 65] }, // La Do Re Fa (Dm7)
};

/** Clases de altura de la menor natural (A B C D E F G). */
const ESCALA_MENOR = new Set([9, 11, 0, 2, 4, 5, 7]);

/** La nota de la escala inmediatamente por debajo de `nota` (nota de paso hacia la raiz siguiente). */
function vecinaPorDebajo(nota: number): number {
  let n = nota - 1;
  while (!ESCALA_MENOR.has(((n % 12) + 12) % 12)) n -= 1;
  return n;
}

// ---------------------------------------------------------------------------
// Melodias: [slot, nota MIDI, duracion en slots] por compas
// ---------------------------------------------------------------------------

type Figura = readonly [number, number, number];

/** Frase 1 de B (sobre F G Am E): sube, deja respirar al final de cada compas. */
const B_FRASE_1: readonly (readonly Figura[])[] = [
  [[0, 72, 3], [3, 77, 3], [6, 76, 2], [8, 72, 4]],
  [[0, 74, 3], [3, 79, 3], [6, 77, 2], [8, 74, 4], [12, 71, 2], [14, 74, 2]],
  [[0, 81, 4], [4, 79, 2], [6, 76, 2], [8, 76, 4], [12, 72, 2], [14, 76, 2]],
  [[0, 80, 3], [3, 83, 3], [6, 80, 2], [8, 76, 6]],
];

/** Frase 2 de B: la respuesta, llega mas alto y termina sobre la sensible. */
const B_FRASE_2: readonly (readonly Figura[])[] = [
  [[0, 72, 3], [3, 77, 3], [6, 76, 2], [8, 72, 2], [10, 76, 2], [12, 77, 2]],
  [[0, 74, 3], [3, 79, 3], [6, 83, 2], [8, 81, 4], [12, 79, 2], [14, 74, 2]],
  [[0, 84, 3], [3, 81, 3], [6, 79, 2], [8, 76, 4], [12, 79, 2], [14, 81, 2]],
  [[0, 83, 3], [3, 80, 3], [6, 76, 2], [8, 80, 6]],
];

/** Contramelodia de A' sobre Am F C G, primera pasada: notas largas y respuestas cortas. */
const A2_PASADA_1: readonly (readonly Figura[])[] = [
  [[0, 76, 5], [6, 74, 2], [8, 72, 6]],
  [[0, 77, 5], [6, 76, 2], [8, 72, 6]],
  [[0, 79, 5], [6, 76, 2], [8, 72, 4], [12, 76, 2], [14, 79, 2]],
  [[0, 79, 3], [3, 74, 3], [6, 71, 2], [8, 74, 8]],
];

/** Segunda pasada de A': la misma idea una tercera mas arriba. */
const A2_PASADA_2: readonly (readonly Figura[])[] = [
  [[0, 81, 5], [6, 79, 2], [8, 76, 6]],
  [[0, 77, 3], [3, 81, 3], [6, 79, 2], [8, 77, 6]],
  [[0, 84, 4], [4, 83, 2], [6, 79, 2], [8, 76, 6]],
  [[0, 83, 3], [3, 79, 3], [6, 74, 2], [8, 79, 4], [12, 83, 2]],
];

/** Melodia lenta del quiebre (Am F Dm E). */
const QUIEBRE: readonly (readonly Figura[])[] = [
  [[0, 81, 8], [8, 79, 4], [12, 76, 4]],
  [[0, 77, 8], [8, 76, 4], [12, 72, 4]],
  [[0, 74, 8], [8, 77, 4], [12, 81, 4]],
  [[0, 80, 6], [6, 83, 2], [8, 80, 4]],
];

// ---------------------------------------------------------------------------
// Plan de la pieza
// ---------------------------------------------------------------------------

type NombreSeccion = 'intro' | 'A' | 'B' | 'quiebre' | 'A2' | 'B2' | 'cola';

interface Seccion {
  nombre: NombreSeccion;
  acordes: readonly Acorde[];
}

const CICLO_A: readonly Acorde[] = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'];
const CICLO_B: readonly Acorde[] = ['F', 'G', 'Am', 'E', 'F', 'G', 'Am', 'E'];

const PLAN: readonly Seccion[] = [
  { nombre: 'intro', acordes: ['Am', 'F', 'C', 'G'] },
  { nombre: 'A', acordes: CICLO_A },
  { nombre: 'B', acordes: CICLO_B },
  { nombre: 'quiebre', acordes: ['Am', 'F', 'Dm', 'E'] },
  { nombre: 'A2', acordes: CICLO_A },
  { nombre: 'B2', acordes: CICLO_B },
  { nombre: 'cola', acordes: ['Am', 'Am', 'Am', 'Am'] },
];

/** Compas (desde 0) donde empieza cada seccion, util para los tests y para el preview. */
export function inicioDeSeccion(nombre: NombreSeccion): number {
  let compas = 0;
  for (const s of PLAN) {
    if (s.nombre === nombre) return compas;
    compas += s.acordes.length;
  }
  throw new Error(`Seccion desconocida: ${nombre}`);
}

export const TOTAL_COMPASES = PLAN.reduce((suma, s) => suma + s.acordes.length, 0);

// ---------------------------------------------------------------------------
// Composicion
// ---------------------------------------------------------------------------

const ORDEN_VOZ: Record<EventoMusical['voz'], number> = {
  bombo: 0,
  caja: 1,
  hat: 2,
  bajo: 3,
  acorde: 4,
  melodia: 5,
};

function acotar(valor: number): number {
  return Math.min(1, Math.max(0.05, valor));
}

export function componerDemo(): Composicion {
  const azar = crearPrng(SEMILLA);
  const eventos: EventoMusical[] = [];

  /** Un poco de variacion de intensidad, siempre con el mismo orden de llamadas. */
  const humano = (base: number, amplitud = 0.06): number =>
    acotar(base + (azar() - 0.5) * 2 * amplitud);

  function agregar(
    voz: EventoMusical['voz'],
    compas: number,
    slot: number,
    slotsDuracion: number,
    nota: number,
    intensidad: number,
  ): void {
    eventos.push({
      tiempo: compas * COMPAS_MS + slot * SLOT_MS,
      duracion: slotsDuracion * SLOT_MS,
      voz,
      nota,
      intensidad,
    });
  }

  const golpe = (
    voz: 'bombo' | 'caja' | 'hat',
    compas: number,
    slot: number,
    nota: number,
    intensidad: number,
  ): void => agregar(voz, compas, slot, 0, nota, humano(intensidad));

  // Aplana el plan: un compas por entrada, con el acorde que sigue (para las notas de paso).
  interface Compas {
    global: number;
    seccion: NombreSeccion;
    /** Indice dentro de la seccion. */
    i: number;
    cantidad: number;
    acorde: Acorde;
    siguiente: Acorde;
  }
  const compases: Compas[] = [];
  for (const s of PLAN) {
    s.acordes.forEach((acorde, i) => {
      compases.push({
        global: compases.length,
        seccion: s.nombre,
        i,
        cantidad: s.acordes.length,
        acorde,
        siguiente: acorde, // se corrige abajo
      });
    });
  }
  compases.forEach((c, k) => {
    c.siguiente = compases[k + 1]?.acorde ?? c.acorde;
  });

  // -- Voces ----------------------------------------------------------------

  /** Hats a corcheas: el contratiempo (slots 2, 6, 10, 14) pesa mas. */
  function hatsCorcheas(c: Compas, escala: number, abierto: boolean, conCrash = false): void {
    for (let slot = conCrash ? 2 : 0; slot < SLOTS_POR_COMPAS; slot += 2) {
      const contratiempo = slot % 4 === 2;
      if (abierto && slot === 14) {
        golpe('hat', c.global, slot, NOTA_HAT_ABIERTO, 0.62 * escala);
        continue;
      }
      golpe('hat', c.global, slot, NOTA_HAT_CERRADO, (contratiempo ? 0.68 : 0.42) * escala);
    }
  }

  /** Hats a semicorcheas: la rejilla completa, con acento en el contratiempo. */
  function hatsSemicorcheas(c: Compas, abierto: boolean, conCrash = false): void {
    for (let slot = conCrash ? 1 : 0; slot < SLOTS_POR_COMPAS; slot++) {
      if (abierto && slot === 14) {
        golpe('hat', c.global, slot, NOTA_HAT_ABIERTO, 0.66);
        continue;
      }
      const base = slot % 4 === 0 ? 0.5 : slot % 4 === 2 ? 0.76 : 0.3;
      golpe('hat', c.global, slot, NOTA_HAT_CERRADO, base);
    }
  }

  function bombosYCajas(c: Compas, estilo: 'sincopado' | 'cuatro'): void {
    const ultimoDelGrupo = c.i % 4 === 3;
    const ultimoDeLaSeccion = c.i === c.cantidad - 1;

    let bombos: number[];
    if (estilo === 'cuatro') {
      // Cuatro al piso con un bombo de contratiempo que alterna (6 y 14).
      bombos = c.i % 2 === 0 ? [0, 4, 6, 8, 12] : [0, 4, 8, 12, 14];
    } else {
      bombos = c.i % 2 === 0 ? [0, 6, 8, 11] : [0, 6, 8, 14];
    }
    // En el fill el bombo se calla para que la caja se luzca.
    if (ultimoDeLaSeccion) bombos = bombos.filter((s) => s < 8 && s !== 6);
    else if (ultimoDelGrupo) bombos = bombos.filter((s) => s < 12 && s !== 11);
    for (const slot of bombos) {
      golpe('bombo', c.global, slot, NOTA_BOMBO, slot % 4 === 0 ? 0.96 : 0.74);
    }

    if (ultimoDeLaSeccion) {
      // Redoble de ocho: crece hasta el final y desemboca en la seccion siguiente.
      const pasos: readonly [number, number][] = [
        [2, 0.42],
        [4, 0.8],
        [6, 0.5],
        [8, 0.56],
        [10, 0.64],
        [12, 0.74],
        [13, 0.68],
        [14, 0.84],
        [15, 0.96],
      ];
      for (const [slot, v] of pasos) golpe('caja', c.global, slot, NOTA_CAJA, v);
    } else if (ultimoDelGrupo) {
      for (const [slot, v] of [[4, 0.88], [12, 0.72], [14, 0.78], [15, 0.9]] as const) {
        golpe('caja', c.global, slot, NOTA_CAJA, v);
      }
    } else {
      golpe('caja', c.global, 4, NOTA_CAJA, 0.9);
      golpe('caja', c.global, 12, NOTA_CAJA, 0.94);
      // Nota fantasma antes del siguiente compas, solo en los impares del groove sincopado.
      if (estilo === 'sincopado' && c.i % 2 === 1) golpe('caja', c.global, 15, NOTA_CAJA, 0.26);
    }
  }

  function bajoSincopado(c: Compas): void {
    const { raiz } = ACORDES[c.acorde];
    const paso = vecinaPorDebajo(ACORDES[c.siguiente].raiz + 12) - 12;
    // Raiz, rebote de octava, quinta o raiz, y nota de paso hacia el acorde que viene.
    const quintaORaiz = c.i % 2 === 0 ? raiz : raiz + 7;
    const figuras: readonly Figura[] = [
      [0, raiz, 3],
      [3, raiz + 12, 1],
      [6, quintaORaiz, 2],
      [8, raiz, 3],
      [11, raiz + 12, 1],
      [14, paso, 2],
    ];
    const fuerza = [0.95, 0.66, 0.76, 0.92, 0.66, 0.74];
    figuras.forEach(([slot, nota, dur], k) => {
      agregar('bajo', c.global, slot, dur, nota, humano(fuerza[k] ?? 0.7, 0.04));
    });
  }

  function bajoEnCorcheas(c: Compas): void {
    const { raiz } = ACORDES[c.acorde];
    const paso = vecinaPorDebajo(ACORDES[c.siguiente].raiz + 12) - 12;
    const notas = [raiz, raiz, raiz + 12, raiz, raiz, raiz, raiz + 12, paso];
    const fuerza = [0.95, 0.6, 0.82, 0.6, 0.9, 0.6, 0.82, 0.72];
    notas.forEach((nota, k) => {
      agregar('bajo', c.global, k * 2, 2, nota, humano(fuerza[k] ?? 0.7, 0.04));
    });
  }

  function bajoLargo(c: Compas, slots: number, intensidad: number): void {
    agregar('bajo', c.global, 0, slots, ACORDES[c.acorde].raiz, intensidad);
  }

  /** Pad sostenido: las cuatro voces durante todo el compas. */
  function padSostenido(c: Compas, intensidad: number): void {
    for (const nota of ACORDES[c.acorde].notas) {
      agregar('acorde', c.global, 0, SLOTS_POR_COMPAS, nota, humano(intensidad, 0.03));
    }
  }

  /** Acordes sincopados 6-4-6: tres voces (el bajo ya toca la raiz; el E7 conserva su sol sostenido). */
  function padSincopado(c: Compas): void {
    const voces = ACORDES[c.acorde].golpe;
    const golpes: readonly Figura[] = [
      [0, 0, 5],
      [6, 0, 4],
      [10, 0, 6],
    ];
    const fuerza = [0.82, 0.6, 0.72];
    golpes.forEach(([slot, , dur], k) => {
      for (const nota of voces) {
        agregar('acorde', c.global, slot, dur, nota, humano(fuerza[k] ?? 0.7, 0.03));
      }
    });
  }

  /**
   * Arpegio de semicorcheas sobre las tres voces agudas del acorde: el brillo del
   * climax. Cada nota es corta; el pad sostenido de fondo los une.
   */
  function arpegio(c: Compas): void {
    const voces = ACORDES[c.acorde].golpe;
    const orden = [0, 1, 2, 1];
    for (let slot = 0; slot < SLOTS_POR_COMPAS; slot++) {
      const nota = voces[orden[slot % 4] ?? 0] ?? 60;
      agregar('acorde', c.global, slot, 1, nota, humano(slot % 4 === 0 ? 0.42 : 0.3, 0.04));
    }
  }

  function melodia(c: Compas, figuras: readonly Figura[], intensidad: number): void {
    figuras.forEach(([slot, nota, dur], k) => {
      // El primer golpe de cada compas es el mas firme.
      agregar('melodia', c.global, slot, dur, nota, humano(k === 0 ? intensidad + 0.06 : intensidad, 0.04));
    });
  }

  function crash(c: Compas): void {
    golpe('hat', c.global, 0, NOTA_CRASH, 0.95);
  }

  // -- Secciones --------------------------------------------------------------

  for (const c of compases) {
    switch (c.seccion) {
      case 'intro': {
        // Hats que entran bajito y suben; el pad se abre con el compas.
        hatsCorcheas(c, 0.55 + 0.15 * c.i, false);
        padSostenido(c, 0.36 + 0.1 * c.i);
        if (c.i === 3) {
          // Pre-fill: semicorcheas en la ultima negra para anunciar a A.
          for (const slot of [13, 15]) golpe('hat', c.global, slot, NOTA_HAT_CERRADO, 0.5);
        }
        break;
      }
      case 'A': {
        if (c.i === 0) crash(c);
        hatsCorcheas(c, 1, c.i % 2 === 1, c.i === 0);
        bombosYCajas(c, 'sincopado');
        bajoSincopado(c);
        padSostenido(c, 0.55);
        break;
      }
      case 'B': {
        if (c.i === 0) crash(c);
        hatsSemicorcheas(c, c.i % 2 === 1, c.i === 0);
        bombosYCajas(c, 'cuatro');
        bajoEnCorcheas(c);
        padSincopado(c);
        melodia(c, (c.i < 4 ? B_FRASE_1 : B_FRASE_2)[c.i % 4] ?? [], 0.8);
        break;
      }
      case 'quiebre': {
        bajoLargo(c, SLOTS_POR_COMPAS, 0.7);
        padSostenido(c, 0.5);
        melodia(c, QUIEBRE[c.i] ?? [], 0.62);
        if (c.i >= 2) {
          // Hats solo en el contratiempo: el pulso sigue vivo sin bombo.
          for (let slot = 2; slot < SLOTS_POR_COMPAS; slot += 4) {
            golpe('hat', c.global, slot, NOTA_HAT_CERRADO, 0.4);
          }
        }
        if (c.i === 3) {
          // Redoble que crece hacia A'.
          const pasos: readonly [number, number][] = [
            [0, 0.3],
            [2, 0.34],
            [4, 0.4],
            [6, 0.46],
            [8, 0.52],
            [10, 0.58],
            [12, 0.66],
            [13, 0.72],
            [14, 0.82],
            [15, 0.96],
          ];
          for (const [slot, v] of pasos) golpe('caja', c.global, slot, NOTA_CAJA, v);
        }
        break;
      }
      case 'A2': {
        if (c.i === 0) crash(c);
        hatsSemicorcheas(c, c.i % 2 === 1, c.i === 0);
        bombosYCajas(c, 'sincopado');
        bajoEnCorcheas(c);
        padSostenido(c, 0.6);
        melodia(c, (c.i < 4 ? A2_PASADA_1 : A2_PASADA_2)[c.i % 4] ?? [], 0.72);
        break;
      }
      case 'B2': {
        if (c.i === 0) crash(c);
        hatsSemicorcheas(c, true, c.i === 0);
        bombosYCajas(c, 'cuatro');
        bajoEnCorcheas(c);
        // El climax cambia la textura de B: en vez de los acordes sincopados,
        // un pad sostenido y el arpegio de semicorcheas.
        padSostenido(c, 0.5);
        arpegio(c);
        // El climax repite la frase de respuesta, la mas alta, con mas pegada.
        melodia(c, B_FRASE_2[c.i % 4] ?? [], 0.88);
        break;
      }
      case 'cola': {
        if (c.i === 0) {
          crash(c);
          golpe('bombo', c.global, 0, NOTA_BOMBO, 0.96);
          agregar('bajo', c.global, 0, 3 * SLOTS_POR_COMPAS, ACORDES.Am.raiz, 0.85);
          // Am con novena (si): el final queda abierto y calido, no cerrado en seco.
          for (const nota of [57, 60, 64, 71]) {
            agregar('acorde', c.global, 0, 3 * SLOTS_POR_COMPAS, nota, humano(0.62, 0.02));
          }
          agregar('melodia', c.global, 0, 2.5 * SLOTS_POR_COMPAS, 81, 0.8);
        }
        break;
      }
    }
  }

  // Orden total y estable: por tiempo y, a igual tiempo, por voz y nota.
  eventos.sort(
    (a, b) => a.tiempo - b.tiempo || ORDEN_VOZ[a.voz] - ORDEN_VOZ[b.voz] || a.nota - b.nota,
  );

  return {
    bpm: BPM,
    duracion: TOTAL_COMPASES * COMPAS_MS,
    // El primer compas de B: ya suena la melodia con todo el groove.
    preview: inicioDeSeccion('B') * COMPAS_MS,
    eventos,
  };
}
