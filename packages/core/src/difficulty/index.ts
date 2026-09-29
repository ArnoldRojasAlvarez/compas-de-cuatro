// T-013: motor de dificultad, vector de siete skillsets.
//
// La idea de fondo (de Arnold, ver docs/tickets/T-013-motor-dificultad.md):
// un solo numero no alcanza para describir la dificultad de un mapa de
// mania. Un 5.29 de patron limpio se le hace mas facil a un jugador que un
// 4.8 lleno de chordjacks, porque son habilidades distintas. Este modulo
// calcula un valor de "strain" (tension) por habilidad, agrega los picos del
// mapa y devuelve un vector de siete estrellas mas el maximo (`overall`).
//
// Funcion pura, sin navegador (ver CLAUDE.md, "core no toca el navegador"):
// entra un `Chart`, sale un `DifficultyResult`. No hay estado, no hay I/O.
//
// Fuera de alcance de este ticket (declarado como deuda en el ticket):
// - Dificultad de notas largas (cuerpo, suelta): solo la cabeza de una LN
//   cuenta, como una nota simple, para construir filas.
// - Balance de manos y "one-hand trills" como skillset aparte.
// - La calibracion de verdad contra mapas rankeados de osu!: eso es T-014.
//   Todo lo que hay aca (las `ESCALA_k`, los decaimientos, los `A_*`) es
//   provisional. Ver el JSDoc de `PARAMETROS_DIFICULTAD` para el detalle y
//   como se obtuvo cada numero.

import type {
  Chart,
  DifficultyResult,
  Note,
  Row,
  SkillVector,
  Skillset,
} from '../types.js';
import { COLUMN_COUNT, SKILLSETS } from '../types.js';

/**
 * Tolerancia, en ms, para juntar notas casi simultaneas en la misma fila
 * (ver `construirFilas`). Es una tolerancia de datos, no un parametro de
 * calibracion del modelo, pero vive aca igual, junto a las demas, por la
 * misma razon (un solo lugar para todas las constantes).
 */
const TOLERANCIA_FILA_MS = 1;

// ---------------------------------------------------------------------------
// Paso 1: filas
// ---------------------------------------------------------------------------

/**
 * Agrupa notas simultaneas en filas. Entrada ordenada por tiempo (invariante
 * de `Chart.notes`, ver types.ts).
 *
 * Una fila junta las notas que caen dentro de `TOLERANCIA_FILA_MS` de la
 * primera nota de esa fila (no de la nota anterior: comparar contra la
 * ancla evita que una cadena de diferencias de 0.9ms "arrastre" la fila mas
 * alla de la tolerancia real). Los mapas de osu! ponen los acordes en el
 * mismo milisegundo exacto; la tolerancia es solo para redondeos.
 *
 * La cabeza de una nota larga (`HoldNote.time`) cuenta como nota de su fila,
 * igual que una nota simple. El cuerpo y la suelta quedan fuera de esta
 * version (deuda declarada en el ticket: dificultad de LN).
 */
export function construirFilas(notes: readonly Note[]): Row[] {
  const filas: Row[] = [];

  for (const nota of notes) {
    const bit = 1 << nota.column;
    const ultima = filas[filas.length - 1];

    if (ultima !== undefined && nota.time - ultima.time <= TOLERANCIA_FILA_MS) {
      // Nota de una columna que ya estaba en la fila (choque de datos, no
      // deberia pasar en un mapa valido): no duplica el conteo.
      if ((ultima.mask & bit) === 0) {
        ultima.mask |= bit;
        ultima.size += 1;
      }
      continue;
    }

    filas.push({ time: nota.time, mask: bit, size: 1 });
  }

  return filas;
}

// ---------------------------------------------------------------------------
// Paso 2: modelo de strain
// ---------------------------------------------------------------------------

function vectorVacio(): SkillVector {
  return {
    stream: 0,
    jumpstream: 0,
    handstream: 0,
    stamina: 0,
    jackspeed: 0,
    chordjack: 0,
    technical: 0,
  };
}

/**
 * Calcula el vector de siete skillsets y la estrella global. Pura y
 * determinista: dos llamadas con el mismo `chart` dan el mismo resultado.
 *
 * Ver docs/tickets/T-013-motor-dificultad.md para el algoritmo completo. En
 * resumen: se construyen las filas, se hace una pasada acumulando "strain"
 * por skillset (decae exponencialmente con el tiempo, crece con cada fila
 * que lo ejercita), se parte el mapa en secciones de 400ms guardando el pico
 * de cada skillset por seccion, y se agregan esos picos con peso geometrico
 * decreciente para que un solo pico aislado no domine y el valor converja
 * aunque el mapa sea largo.
 */
export function calcularDificultad(chart: Chart): DifficultyResult {
  const filas = construirFilas(chart.notes);
  const P = PARAMETROS_DIFICULTAD;

  const vector = vectorVacio();

  if (filas.length < 2) {
    // Sin filas, o una sola: no hay ningun `dt` que procesar (el modelo
    // necesita una fila anterior para tener sentido). El vector se queda en
    // 0, que es finito y no es NaN: cumple la propiedad de mapas vacios o
    // degenerados sin necesitar un caso especial mas adelante.
    return { vector, overall: 0 };
  }

  // Strain actual de cada skillset, decayendo y creciendo fila a fila.
  const strain = vectorVacio();

  // Pico de cada skillset dentro de la seccion de 400ms en curso.
  const picoSeccion = vectorVacio();
  // Picos ya cerrados, por skillset, en el orden en que se cerraron las
  // secciones (el orden no importa: se ordenan antes de agregar).
  const picosPorSkillset: Record<Skillset, number[]> = {
    stream: [],
    jumpstream: [],
    handstream: [],
    stamina: [],
    jackspeed: [],
    chordjack: [],
    technical: [],
  };

  const primeraFila = filas[0]!;
  let seccionActual = Math.floor(primeraFila.time / P.duracionSeccionMs);

  /** Cierra la seccion en curso: guarda su pico y arranca la siguiente en 0. */
  function cerrarSeccion(): void {
    for (const k of SKILLSETS) {
      picosPorSkillset[k].push(picoSeccion[k]);
      picoSeccion[k] = 0;
    }
  }

  /** Registra el strain actual como candidato a pico de la seccion de `tiempo`. */
  function registrarEnSeccion(tiempo: number): void {
    const seccion = Math.floor(tiempo / P.duracionSeccionMs);
    while (seccion > seccionActual) {
      cerrarSeccion();
      seccionActual++;
    }
    for (const k of SKILLSETS) {
      if (strain[k] > picoSeccion[k]) picoSeccion[k] = strain[k];
    }
  }

  // `ultimoGolpe[c]`: tiempo de la ultima fila que uso la columna `c`.
  const ultimoGolpe: number[] = new Array(COLUMN_COUNT).fill(-Infinity);
  for (let c = 0; c < COLUMN_COUNT; c++) {
    if ((primeraFila.mask & (1 << c)) !== 0) ultimoGolpe[c] = primeraFila.time;
  }

  let maskAnterior = primeraFila.mask;
  let dtAnterior: number | null = null;

  for (let i = 1; i < filas.length; i++) {
    const fila = filas[i]!;
    const anterior = filas[i - 1]!;

    const dtCrudo = fila.time - anterior.time;
    const dt = Math.max(dtCrudo, P.dtMinimoMs);
    const v = 1000 / dt;

    const maskJack = fila.mask & maskAnterior;

    let dcMinimo = Infinity;
    for (let c = 0; c < COLUMN_COUNT; c++) {
      if ((maskJack & (1 << c)) !== 0) {
        const dc = fila.time - ultimoGolpe[c]!;
        if (dc < dcMinimo) dcMinimo = dc;
      }
    }
    const huboJack = maskJack !== 0;

    const ratioRitmo = dtAnterior === null ? 0 : Math.abs(Math.log(dt / dtAnterior));
    const ratioRitmoAcotado = Math.min(ratioRitmo, P.topeRitmo);

    // Decaimiento exponencial de los siete acumuladores antes de sumar el
    // aporte de esta fila (S_k = S_k * exp(-decaimiento_k * dt/1000) + aporte_k).
    // Stamina (v2) no entra aca: no decae ni acumula notas, es una media
    // movil que se actualiza mas abajo, despues de los seis de pico.
    for (const k of SKILLSETS) {
      if (k === 'stamina') continue;
      strain[k] *= Math.exp((-P.decaimientoRapido * dt) / 1000);
    }

    const A = P.aportes;

    if (!huboJack) {
      if (fila.size === 1) {
        strain.stream += A.stream * v;
      } else if (fila.size === 2) {
        strain.jumpstream += A.jumpstream * v;
      } else {
        // fila.size es 3 o 4 (una fila valida tiene entre 1 y 4 notas).
        strain.handstream += A.handstream * v * (fila.size / 3);
      }
    } else {
      // T-017: jackspeed aporta con al menos una columna repetida, sin
      // importar el tamano de la fila (un jack de un dedo dentro de un
      // acorde, [12][2][23], es jackspeed). Chordjack conserva la definicion
      // de T-013: fila de 2 o mas notas con alguna columna repetida (acordes
      // densos con repeticiones parciales, [124][14][134]). Una fila de 2 o
      // mas notas con jack alimenta los dos skillsets.
      strain.jackspeed += A.jackspeed * (1000 / dcMinimo);
      if (fila.size >= 2) {
        strain.chordjack += A.chordjack * (1000 / dcMinimo) * (fila.size / 2);
      }
    }

    strain.technical += A.technical * v * ratioRitmoAcotado;

    // Stamina v2 (T-016): media movil exponencial, en el tiempo, de la
    // dificultad instantanea de patron m. `m` se mide en UNIDADES DE ESTRELLA:
    // m = max_k(ESCALA_k * strain_k) sobre los seis de pico. Los strains
    // crudos no son comparables entre skillsets (la ESCALA de chordjack es
    // ~4 veces la de stream), y con el max crudo un chordjack sostenido casi
    // no alimentaba stamina. `exponenteEstrellas` NO se aplica dentro de m
    // (se aplica una sola vez, al valor agregado de cada skillset al final).
    // En regimen sostenido S tiende a m; un mapa facil da m bajo y stamina
    // baja por largo que sea. Ya no cuenta notas.
    const E = P.escala;
    const m = Math.max(
      E.stream * strain.stream,
      E.jumpstream * strain.jumpstream,
      E.handstream * strain.handstream,
      E.jackspeed * strain.jackspeed,
      E.chordjack * strain.chordjack,
      E.technical * strain.technical,
    );
    const f = Math.exp((-P.decaimientoStamina * dt) / 1000);
    strain.stamina = strain.stamina * f + m * (1 - f);

    registrarEnSeccion(fila.time);

    for (let c = 0; c < COLUMN_COUNT; c++) {
      if ((fila.mask & (1 << c)) !== 0) ultimoGolpe[c] = fila.time;
    }
    maskAnterior = fila.mask;
    dtAnterior = dt;
  }

  // Cierra la ultima seccion en curso (nunca se cierra dentro del bucle:
  // solo se cierran secciones "anteriores" a la fila que se esta procesando).
  cerrarSeccion();

  for (const k of SKILLSETS) {
    const picos = picosPorSkillset[k].slice().sort((a, b) => b - a);
    let valor = 0;
    let peso = 1;
    for (const pico of picos) {
      valor += pico * peso;
      peso *= P.pesoAgregacion;
    }
    vector[k] = P.escala[k] * valor ** P.exponenteEstrellas;
  }

  let overall = 0;
  for (const k of SKILLSETS) {
    if (vector[k] > overall) overall = vector[k];
  }

  return { vector, overall };
}

// ---------------------------------------------------------------------------
// Constantes del modelo
// ---------------------------------------------------------------------------

/**
 * Todas las constantes del modelo de dificultad, en un solo lugar para
 * poder calibrarlas sin buscar por todo el archivo.
 *
 * **PROVISIONAL.** Nada de esto esta calibrado contra mapas reales todavia:
 * eso es T-014, con Arnold arbitrando las discrepancias contra mapas
 * rankeados de osu!. Lo que hay aca es lo minimo defendible para que el
 * vector de siete skillsets sea internamente consistente (ver mas abajo
 * "Como se obtuvo ESCALA"), no un resultado calibrado.
 *
 * - `aportes` (las `A_*` del ticket): se dejan todas en 1. No hay todavia
 *   ninguna razon basada en datos para creer que, por ejemplo, un jack
 *   "pesa" mas por nota que un stream antes de escalar; inventar esos pesos
 *   a ojo seria peor que no tenerlos. `escala` (las `ESCALA_k`) hace todo el
 *   trabajo de equiparar los skillsets en esta version.
 *
 * - `escala`: se calculo con un patron canonico por skillset (los mismos
 *   patrones que usan los tests de discriminacion, ver
 *   `docs/tickets/T-013-motor-dificultad.md`, "Discriminacion"), corrido 60
 *   segundos a 12 notas por segundo (el stream de referencia del ticket:
 *   1234 a 1/4, 180 BPM), y leyendo el `valor_k` sin escalar (`escala = 1`)
 *   que da `calcularDificultad`. La cuenta fue, para cada uno de los seis
 *   skillsets de pico (stream, jumpstream, handstream, jackspeed, chordjack,
 *   technical): `ESCALA_k = 4 / valor_k`. Esto dice exactamente que, a
 *   igual NPS, los seis patrones canonicos dan 4.00 estrellas (regla 1 y 2
 *   del ticket). El patron de `technical` no es un stream a NPS constante
 *   (mide irregularidad de ritmo, no velocidad), asi que su patron canonico
 *   alterna dt = 50ms y 116.667ms (mismo cociente 60/140 que usa el test de
 *   discriminacion, pero reescalado para que el promedio de NPS de todas
 *   formas 12, y quede comparable a los otros seis).
 *
 *   `stamina` se ancla distinto (regla 3 del ticket): con el mismo stream de
 *   referencia de 60s/12nps, `ESCALA_stamina = 4 / valor_stamina` de ESE
 *   mismo corrido (no un patron propio). RE-ANCLADA EN T-016 (regla 3 nueva, reemplaza
 *   la de T-013 para stamina): stamina ya no suma notas sino que es una media
 *   movil (vida media 35s) de m = max_k(ESCALA_k * strain_k) sobre los seis de
 *   pico, es decir, en unidades de estrella (con el max de strains crudos
 *   stamina quedaba casi muerta en maratones de chordjack). La referencia es
 *   un stream SOSTENIDO de 600s a 12 nps, donde la media movil ya esta en
 *   regimen, y el anclaje es `stamina_estrella = stream_estrella` en ese mismo
 *   mapa (no un 4 fijo). Con `ESCALA_stamina = 1` (las otras seis con su
 *   valor definitivo) ese mapa da stream = 4.0000021152156915 y
 *   `valor_stamina` = 3.999974024093306, entonces
 *   `ESCALA_stamina = 4.0000021152156915 / 3.999974024093306 =
 *   1.0000070228262024`. Se cambio la referencia de 60s a 600s porque con 60s
 *   la media movil estaba a ~70% de su regimen (`valor_stamina` 2.62) y la
 *   escala resultante (1.525) hacia que stamina superara al patron en
 *   cualquier mapa largo, aunque fuera facil. Las otras seis escalas no
 *   cambian. En m no se aplica `exponenteEstrellas`; se aplica una sola vez,
 *   al valor agregado de cada skillset (stamina incluido).
 *   Consecuencia buscada: en ese
 *   stream de 60s, `stamina` y `stream` dan igual (los dos 4.00); en mapas
 *   mas cortos gana el patron, en maratones mas largos gana stamina (ver
 *   "Stamina mide duracion" en los tests).
 *
 *   Los `valor_k` sin escalar (`escala = 1`) que dieron estos numeros, con
 *   el patron canonico de cada skillset corrido 60s a 12 notas por segundo
 *   (el script quedo en el scratchpad de la sesion, no en el repo, por eso
 *   se deja la tabla completa aca en vez de solo la ruta):
 *
 *   | skillset    | patron canonico (12 nps, 60s)                | valor_k sin escalar | ESCALA_k = 4 / valor_k |
 *   |-------------|-----------------------------------------------|----------------------|------------------------|
 *   | stream      | roll 0,1,2,3 en filas de 1                     | 4174.575169287345    | 0.0009581813329002417  |
 *   | jumpstream  | filas {0,1} (2) alternando {2} (1)             | 954.8684539168519    | 0.004189058695563852   |
 *   | handstream  | filas {0,1,2} (3) alternando {3} (1)           | 544.8686171138438    | 0.00734121928546354    |
 *   | jackspeed   | columna 0 repetida                             | 4174.575169287345    | 0.0009581813329002417  |
 *   | chordjack   | acorde {0,1} repetido                          | 1058.8625120551303   | 0.0037776386966769278  |
 *   | technical   | roll con dt alternando 50/116.667ms            | 4250.013129211589    | 0.0009411735630901524  |
 *   | stamina (v2)| (del mismo corrido de stream de referencia)    | 3.999974024093306    | 1.0000070228262024     |
 *
 *   Que `jackspeed` de exactamente el mismo `valor_k` que `stream` no es
 *   casualidad: con una sola columna, `1000/dc` (jackspeed) y `v` (stream)
 *   son la misma cantidad, porque `dc` y `dt` coinciden cuando la unica
 *   columna de la fila es siempre la misma. Es una confirmacion cruzada de
 *   que el modelo esta calculando lo que dice calcular, no un ajuste hecho
 *   a mano.
 *
 *   RE-ANCLAJE EN T-017 (jackspeed por columna repetida): se volvio a aplicar
 *   la regla 1 (patrones canonicos, 12 nps, 60s, `escala = 1`, `ESCALA_k =
 *   4 / valor_k`) con la definicion final: jackspeed aporta en cualquier fila
 *   con al menos una columna repetida (`1000/dcMinimo`, sin importar el
 *   tamano de la fila); chordjack queda EXACTAMENTE como en T-013 (fila de 2
 *   o mas notas con alguna columna repetida, aporte `(1000/dcMinimo) *
 *   size/2`). Los dos patrones canonicos (una columna repetida; acorde {0,1}
 *   repetido) dan los mismos valores que en T-013: valor_jackspeed
 *   4174.575169287345 y valor_chordjack 1058.8625120551303, asi que las dos
 *   escalas no cambian. Lo que cambia es que una fila con jack de 2 o mas
 *   notas alimenta los dos skillsets (en el canonico de chordjack jackspeed
 *   da 1.0146 estrellas, antes 0). `ESCALA_stamina` no cambia: el stream de
 *   referencia de 600s no tiene jacks; re-derivado 1.0000070228262397 contra
 *   1.0000070228262024 (igual a 1e-13). Script: `escala-t017.mjs` (scratchpad).
 *
 *   SESGO CONOCIDO (revision de Opus, T-013): la regla "a igual notas por
 *   segundo, igual estrella" subestima los jacks. Un stream a 12 notas/s
 *   reparte la carga en cuatro dedos (3 golpes por dedo por segundo); un jack
 *   a 12 notas/s son 12 golpes por segundo en un solo dedo, muchisimo mas
 *   dificil. Lo mismo, en menor medida, con chordjack. No se corrige a ojo:
 *   `ESCALA_jackspeed` y `ESCALA_chordjack` son el primer objetivo de la
 *   calibracion contra mapas reales (T-015). Mientras tanto, la UI marca las
 *   estrellas como provisionales (T-014).
 *
 *   Verificado (con estas `ESCALA_k` ya escritas abajo) contra las diez
 *   propiedades del ticket en `packages/core/src/difficulty/index.test.ts`:
 *   discriminacion a 10s, velocidad, stamina, simetria, etc. Un cambio
 *   futuro al modelo que desalinee esta tabla lo va a mostrar un test
 *   fallando, no un numero mudo en este comentario.
 *
 * - `exponenteEstrellas` (T-016): `estrella_k = ESCALA_k * valor_k ^ p`. Vale 1
 *   (no cambia nada) hasta que T-015 lo ajuste con datos por minimos
 *   cuadrados log-log. No se elige a ojo.
 *
 * - `aportes` no incluye stamina: en v2 stamina no acumula notas.
 *
 * - `decaimientoRapido` / `decaimientoStamina`: tasas de decaimiento en 1/s
 *   (`S_k *= exp(-decaimiento_k * dt_segundos)`). Los seis skillsets de pico
 *   usan `decaimientoRapido`, con vida media de 2s (`ln(2)/2 ≈ 0.347`,
 *   redondeado a 0.35): suficientemente rapido para que midan picos locales,
 *   no densidad acumulada. `stamina` usa `decaimientoStamina`, con vida
 *   media de 35s (`ln(2)/35 ≈ 0.0198`, redondeado a 0.02): "decenas de
 *   segundos" como pide el ticket, para que mida densidad sostenida en vez
 *   de picos.
 *
 * - `dtMinimoMs` (25) y `duracionSeccionMs` (400) y `pesoAgregacion` (0.9):
 *   estos tres vienen dados literalmente por el ticket, no son ajuste
 *   propio.
 *
 * - `topeRitmo` (2): tope de `ratioRitmo` en el aporte de `technical`.
 *   `ratioRitmo = |ln(dt/dtAnterior)|` no tiene cota natural (un salto de
 *   tempo extremo lo puede disparar); 2 permite que un cambio de tempo de
 *   hasta ~7.4x (`e^2`) siga sumando cada vez mas, y por encima de eso deja
 *   de crecer, para que un unico salto de datos corrupto (o una nota suelta
 *   aislada) no domine todo el skillset.
 */
export const PARAMETROS_DIFICULTAD: {
  readonly dtMinimoMs: number;
  readonly topeRitmo: number;
  readonly duracionSeccionMs: number;
  readonly pesoAgregacion: number;
  readonly decaimientoRapido: number;
  readonly decaimientoStamina: number;
  readonly exponenteEstrellas: number;
  readonly aportes: Readonly<Record<Exclude<Skillset, 'stamina'>, number>>;
  readonly escala: Readonly<Record<Skillset, number>>;
} = {
  dtMinimoMs: 25,
  topeRitmo: 2,
  duracionSeccionMs: 400,
  pesoAgregacion: 0.9,
  decaimientoRapido: 0.35,
  decaimientoStamina: 0.02,
  exponenteEstrellas: 1,
  aportes: {
    stream: 1,
    jumpstream: 1,
    handstream: 1,
    jackspeed: 1,
    chordjack: 1,
    technical: 1,
  },
  escala: {
    stream: 0.0009581813329002417,
    jumpstream: 0.004189058695563852,
    handstream: 0.00734121928546354,
    stamina: 1.0000070228262024,
    jackspeed: 0.0009581813329002417,
    chordjack: 0.0037776386966769278,
    technical: 0.0009411735630901524,
  },
};

/**
 * Version del modelo de dificultad (T-014). El song select (ver
 * apps/web/src/dificultad-logica.ts) cachea el resultado de
 * `calcularDificultad` por mapa en IndexedDB, y la clave de esa cache
 * incluye este numero junto al hash del mapa. Cualquier cambio a
 * `PARAMETROS_DIFICULTAD` (o al algoritmo de `calcularDificultad` mismo)
 * TIENE que subir esta version: si no, la cache sigue devolviendo el
 * resultado viejo y el song select muestra estrellas desactualizadas sin
 * que nadie se entere (ver el ticket T-014, "La trampa que hay que
 * evitar"). Historial: 1 = T-013 (stamina acumulaba notas); 2 = T-016
 * (stamina como media movil de la dificultad de patron, mas
 * `exponenteEstrellas`); 3 = T-017 (jackspeed aporta con cualquier columna
 * repetida sin importar el tamano de la fila; chordjack sigue como en T-013).
 */
export const VERSION_MODELO_DIFICULTAD = 3;

/**
 * Mientras sea `false`, el modelo NO esta calibrado contra mapas reales:
 * las `escala` de arriba salen de igualar NPS entre patrones canonicos, no
 * de datos (ver el JSDoc de `PARAMETROS_DIFICULTAD`, "SESGO CONOCIDO",
 * subestima jacks y chordjack). El song select (T-014) tiene que marcar
 * cualquier estrella como provisional mientras esto sea `false`, para no
 * mostrarle al jugador un numero como si fuera definitivo. T-015 lo pone
 * en `true` cuando la calibracion contra mapas rankeados de osu! este
 * hecha.
 */
export const MODELO_CALIBRADO = false;
