// T-063: mapa entre la base de tiempo de `performance` y la posicion de salida
// del AudioContext, con precision menor que un bloque de audio.
//
// Por que existe. `ctx.currentTime` no avanza continuo: el navegador rinde el
// audio por bloques (en Chromium sobre Windows, rafagas de cuatro cuantos de
// 128 muestras cada ~10 ms) y entre dos rafagas el valor se queda quieto. Un
// reloj que lo lee en un instante cualquiera arrastra un error de 0 a un bloque
// entero (medido con tools/medir-reloj.mjs: 12 ms de rango, 3 ms de desvio). En
// una pulsacion eso es ruido puro: la media queda centrada pero la dispersion
// sube y la ventana de MAX (+-16 ms) casi no se alcanza.
//
// Como se arregla sin dejar de ser "el reloj es el audio" (CLAUDE.md, regla 1).
// `ctx.getOutputTimestamp()` devuelve un par {contextTime, performanceTime}: la
// posicion de audio que el dispositivo estaba sacando por los parlantes en ese
// instante de `performance.now()`. Las dos bases corren con cristales
// distintos pero a la misma velocidad a corto plazo, asi que su diferencia
// (`desfase`, en ms) es casi constante. Con ella, cualquier instante de
// `performance` (el `timeStamp` de un evento de teclado, o el de este frame) se
// convierte a tiempo de audio sin esperar al proximo bloque. El audio sigue
// mandando: el desfase se reancla a cada muestra del contexto con un filtro
// suave (sin deriva acumulada: si el cristal del audio va mas rapido o mas
// lento, el filtro lo sigue), y si el contexto se suspende o salta, se vuelve
// a anclar de cero. Es el mismo esquema que el reloj interpolado de osu!
// (framework: `InterpolatingFramedClock`, osu!: `DecouplingFramedClock`).
//
// Este archivo es, junto con el fallback crudo, el UNICO lugar donde se lee
// `performance.now()` para gameplay: ver `crearMapaDeTiempo`.

/** Muestra del ancla: posicion de salida (s) que se oia en un instante de `performance` (ms). */
export interface MuestraDeAncla {
  contextTime: number;
  performanceTime: number;
}

/**
 * Lo que el mapa necesita del contexto, para poder probarlo sin navegador.
 * `ancla()` devuelve `null` si el contexto no la da (navegador sin
 * `getOutputTimestamp`, o antes de que el dispositivo rinda la primera vez).
 */
export interface FuenteDeTiempo {
  /** `performance.now()`, en ms. */
  ahoraPerf(): number;
  /** `ctx.getOutputTimestamp()`, o null si no hay dato valido todavia. */
  ancla(): MuestraDeAncla | null;
  /** `ctx.currentTime - ctx.outputLatency`, en segundos: la posicion de salida sin interpolar. */
  salidaCruda(): number;
  /** `ctx.state === 'running'`. */
  corriendo(): boolean;
}

export interface MapaDeTiempo {
  /**
   * Posicion de salida (s de contexto) que se oye en este instante,
   * interpolada. Monotona mientras el contexto corre: nunca retrocede aunque el
   * ancla se corrija hacia atras. Con el contexto suspendido devuelve la
   * posicion cruda, que esta congelada.
   */
  ahora(): number;
  /**
   * Posicion de salida (s) que se oia en el instante `perfMs` de la base de
   * `performance` (por ejemplo `event.timeStamp`). No pasa por el guard de
   * monotonia: un evento vale lo que vale.
   */
  aContexto(perfMs: number): number;
  /** Olvida el ancla y el guard de monotonia (la proxima lectura ancla de cero). */
  reanclar(): void;
  /** true mientras se este interpolando (hay ancla valida). Solo diagnostico. */
  readonly anclado: boolean;
}

/**
 * Si una muestra nueva difiere del desfase actual en mas que esto (ms), no se
 * filtra: se salta al valor nuevo. Pasa al reanudar tras una pausa (la base de
 * `performance` siguio corriendo y el contexto no) o si el dispositivo de audio
 * cambio. Dentro del umbral es ruido del dispositivo y se filtra.
 */
export const SALTO_DE_REANCLAJE_MS = 20;
/** Fraccion de la diferencia que se corrige por muestra nueva. */
export const GANANCIA_DEL_FILTRO = 0.1;
/** Correccion maxima por muestra (ms): con frames de 16 ms garantiza que `ahora()` siga monotona. */
export const PASO_MAXIMO_MS = 0.5;
/**
 * El audio manda: el valor interpolado nunca se aleja mas que esto (ms) de la
 * lectura cruda `currentTime - latencia` tomada en el mismo instante, y un
 * ancla que la contradiga por mas que esto se descarta. La diferencia real
 * medida es de 4 a 14 ms (un bloque mas la parte de la latencia que
 * `outputLatency` no cuenta). Esto acota cualquier dato raro del navegador
 * (bajo carga, o si el hilo de audio se atasca y `performance` sigue) a un
 * error chico, en vez de dejar que el reloj de juego se dispare.
 */
export const TOLERANCIA_CRUDA_MS = 30;

export function crearMapaDeTiempoDesde(fuente: FuenteDeTiempo): MapaDeTiempo {
  /** contextTime*1000 - performanceTime, en ms, filtrado. null = sin ancla. */
  let desfase: number | null = null;
  let ultimaMuestraPerf = Number.NEGATIVE_INFINITY;
  /** Ultimo valor devuelto por `ahora()` mientras corre (guard de monotonia). */
  let ultimoAhora = Number.NEGATIVE_INFINITY;

  function actualizar(): void {
    if (!fuente.corriendo()) {
      desfase = null;
      return;
    }
    const m = fuente.ancla();
    // Antes de la primera rendicion Chromium devuelve ceros: no es un ancla.
    if (m === null || !(m.performanceTime > 0) || !Number.isFinite(m.contextTime)) return;
    if (m.performanceTime === ultimaMuestraPerf) return; // misma muestra que la vez anterior
    ultimaMuestraPerf = m.performanceTime;
    const medido = m.contextTime * 1000 - m.performanceTime;
    // Un ancla que contradiga a la lectura cruda no es un ancla: se descarta
    // y se vuelve al camino crudo hasta que llegue una coherente.
    const implicadoMs = fuente.ahoraPerf() + medido;
    if (Math.abs(implicadoMs - fuente.salidaCruda() * 1000) > TOLERANCIA_CRUDA_MS) {
      desfase = null;
      return;
    }
    if (desfase === null || Math.abs(medido - desfase) > SALTO_DE_REANCLAJE_MS) {
      desfase = medido;
      return;
    }
    const paso = (medido - desfase) * GANANCIA_DEL_FILTRO;
    desfase += Math.max(-PASO_MAXIMO_MS, Math.min(PASO_MAXIMO_MS, paso));
  }

  function aContexto(perfMs: number): number {
    actualizar();
    // La lectura cruda en el instante `perfMs`: lo que hacia el reloj antes
    // de T-063 (con el error de hasta un bloque que eso implica).
    const cruda = fuente.salidaCruda() - (fuente.ahoraPerf() - perfMs) / 1000;
    if (desfase === null) return cruda;
    // El audio manda: el interpolado se acota a la cruda +- la tolerancia.
    const interpolado = (perfMs + desfase) / 1000;
    const tolerancia = TOLERANCIA_CRUDA_MS / 1000;
    return Math.min(cruda + tolerancia, Math.max(cruda - tolerancia, interpolado));
  }

  return {
    ahora(): number {
      actualizar();
      if (!fuente.corriendo()) {
        // Suspendido: la posicion cruda esta congelada. El guard no se toca
        // para que al reanudar no haya un salto hacia atras.
        return Math.max(ultimoAhora, fuente.salidaCruda());
      }
      // Sin ancla, la cruda tal cual (no se pasa por aContexto: dos lecturas
      // de performance.now() en la misma linea ya difieren en microsegundos).
      const valor = desfase === null ? fuente.salidaCruda() : aContexto(fuente.ahoraPerf());
      if (valor < ultimoAhora) return ultimoAhora;
      ultimoAhora = valor;
      return valor;
    },
    aContexto,
    reanclar(): void {
      desfase = null;
      ultimaMuestraPerf = Number.NEGATIVE_INFINITY;
      ultimoAhora = Number.NEGATIVE_INFINITY;
    },
    get anclado(): boolean {
      return desfase !== null;
    },
  };
}

export interface OpcionesDeMapa {
  /**
   * Latencia de salida (s) que se resta a `currentTime` en el camino crudo (sin
   * ancla). La decide el reloj (`useOutputLatency`); con ancla no se usa, porque
   * `getOutputTimestamp` ya dice que posicion se oye.
   */
  latenciaSalida: number;
  /** Solo para tests: reemplaza `performance.now()`. */
  ahoraPerf?: () => number;
}

/**
 * El mapa sobre un AudioContext real.
 *
 * Esta es la lectura de `performance.now()` que CLAUDE.md permite para
 * gameplay: no mide el paso del tiempo de juego (eso lo sigue dando el
 * contexto, que es a lo que se ancla), solo sirve de regla comun entre el
 * `timeStamp` de los eventos y el ancla que da el propio AudioContext.
 */
export function crearMapaDeTiempo(ctx: AudioContext, opciones: OpcionesDeMapa): MapaDeTiempo {
  const ahoraPerf =
    opciones.ahoraPerf ??
    // eslint-disable-next-line no-restricted-properties -- T-063: unica lectura de performance.now() para gameplay. Es la base de tiempo que comparten event.timeStamp y ctx.getOutputTimestamp(); el reloj sigue anclado al audio.
    ((): number => performance.now());
  const tieneAncla = typeof ctx.getOutputTimestamp === 'function';
  return crearMapaDeTiempoDesde({
    ahoraPerf,
    ancla(): MuestraDeAncla | null {
      if (!tieneAncla) return null;
      const t = ctx.getOutputTimestamp();
      if (t.contextTime === undefined || t.performanceTime === undefined) return null;
      return { contextTime: t.contextTime, performanceTime: t.performanceTime };
    },
    salidaCruda(): number {
      return ctx.currentTime - opciones.latenciaSalida;
    },
    corriendo(): boolean {
      // Un contexto falso de test sin `state` se toma como corriendo.
      return ctx.state === undefined || ctx.state === 'running';
    },
  });
}
