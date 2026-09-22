// T-010: logica pura del logo que respira (docs/tickets/T-010-menu-y-logo.md,
// "Parte C"), separada de logo.ts igual que cargador-logica.ts separa la
// logica de cargador.ts: esto no toca Canvas, AudioContext ni
// requestAnimationFrame, asi que se puede testear sin navegador (ver
// vitest.config.ts, entorno node). logo.ts es la unica pieza que si
// necesita DOM: lee estos calculos y los dibuja.

/** Energia del cuadro actual del analizador, normalizada a 0..1 (promedio
 * de las magnitudes de frecuencia sobre 255, el maximo de un Uint8Array). */
export function calcularEnergia(datosFrecuencia: ArrayLike<number>): number {
  if (datosFrecuencia.length === 0) return 0;
  let suma = 0;
  for (let i = 0; i < datosFrecuencia.length; i++) {
    suma += datosFrecuencia[i] ?? 0;
  }
  return suma / datosFrecuencia.length / 255;
}

/**
 * Divide los datos de frecuencia del analizador en `numBarras` baldes
 * promediados, uno por barra del espectro (ver docs/DISENO.md, "El
 * logotipo": "las barras del espectro de audio"). Cada valor devuelto esta
 * normalizado a 0..1, igual que calcularEnergia.
 */
export function calcularAlturasDeBarras(
  datosFrecuencia: ArrayLike<number>,
  numBarras: number,
): number[] {
  if (numBarras <= 0) return [];
  const tamanoBalde = Math.max(1, Math.floor(datosFrecuencia.length / numBarras));
  const alturas: number[] = [];
  for (let i = 0; i < numBarras; i++) {
    const inicio = i * tamanoBalde;
    const fin = i === numBarras - 1 ? datosFrecuencia.length : inicio + tamanoBalde;
    let suma = 0;
    let cuenta = 0;
    for (let j = inicio; j < fin && j < datosFrecuencia.length; j++) {
      suma += datosFrecuencia[j] ?? 0;
      cuenta++;
    }
    alturas.push(cuenta > 0 ? suma / cuenta / 255 : 0);
  }
  return alturas;
}

/** Estado del detector de pulso, de un cuadro al siguiente (ver avanzarPulso). */
export interface EstadoPulso {
  readonly promedioMovil: number;
  readonly escalaPulso: number;
  readonly cuadrosDesdeUltimoPulso: number;
  readonly inicializado: boolean;
}

export const ESTADO_PULSO_INICIAL: EstadoPulso = {
  promedioMovil: 0,
  escalaPulso: 0,
  cuadrosDesdeUltimoPulso: Number.POSITIVE_INFINITY,
  inicializado: false,
};

const SUAVIZADO_PROMEDIO = 0.1; // que tan rapido el promedio movil sigue a la energia real
const UMBRAL_RELATIVO = 1.15; // el golpe tiene que superar el promedio en un 15%
const UMBRAL_MINIMO = 0.05; // ignora silencio y ruido de piso: sin esto, cualquier variacion minima dispara un pulso
const CUADROS_DE_ENFRIAMIENTO = 12; // ~200ms a 60fps: no deja disparar dos veces seguidas el mismo golpe
const AMPLITUD_PULSO = 0.07; // 7% de escala extra en el instante del golpe
const DECAIMIENTO_PULSO = 0.82; // que tan rapido se apaga el pulso, cuadro a cuadro

/**
 * Avanza un cuadro del detector de pulso: deteccion de golpe por energia.
 * Compara la energia del cuadro actual contra un promedio movil corto, y
 * dispara un pulso cuando hay un salto claro por encima de ese promedio,
 * con un enfriamiento minimo para no disparar dos veces seguidas por el
 * mismo golpe. No es deteccion de tempo (eso pediria seguir el beat de
 * verdad, fuera de alcance de T-010): alcanza para que el anillo "sienta"
 * el click track, que es la unica fuente sonora de este ticket (ver el
 * ticket, "La musica del menu").
 */
export function avanzarPulso(estado: EstadoPulso, energia: number): EstadoPulso {
  const promedioMovil = estado.inicializado
    ? estado.promedioMovil * (1 - SUAVIZADO_PROMEDIO) + energia * SUAVIZADO_PROMEDIO
    : energia;
  const cuadrosDesdeUltimoPulso = estado.cuadrosDesdeUltimoPulso + 1;
  const hayGolpe =
    estado.inicializado &&
    energia > UMBRAL_MINIMO &&
    energia > promedioMovil * UMBRAL_RELATIVO &&
    cuadrosDesdeUltimoPulso >= CUADROS_DE_ENFRIAMIENTO;

  return {
    promedioMovil,
    escalaPulso: hayGolpe ? AMPLITUD_PULSO : estado.escalaPulso * DECAIMIENTO_PULSO,
    cuadrosDesdeUltimoPulso: hayGolpe ? 0 : cuadrosDesdeUltimoPulso,
    inicializado: true,
  };
}

const VELOCIDAD_RESPIRACION_REPOSO = 0.03; // radianes por cuadro: un ciclo cada ~210 cuadros (~3.5s a 60fps)
const AMPLITUD_RESPIRACION_REPOSO = 0.015; // 1.5% de escala: sutil, para que nunca quede "quieto muerto" (docs/DISENO.md)

/** Respiracion de reposo: un seno lento, independiente del audio, para que
 * el logo nunca quede estatico incluso sin musica sonando o sin golpes
 * claros que detectar. `tick` es un contador de cuadros propio del logo
 * (ver logo.ts), no un reloj: es dibujo, no gameplay (ver CLAUDE.md, regla
 * 1, y docs/tickets/T-010-menu-y-logo.md, "Sobre rAF"). */
export function escalaDeReposo(tick: number): number {
  return Math.sin(tick * VELOCIDAD_RESPIRACION_REPOSO) * AMPLITUD_RESPIRACION_REPOSO;
}

/** Escala final del anillo: 1 +- la respiracion de reposo +- el pulso del
 * golpe actual. Los dos se suman: el reposo nunca se apaga del todo, el
 * pulso lo acentua en cada golpe. */
export function escalaTotal(tick: number, escalaPulso: number): number {
  return 1 + escalaDeReposo(tick) + escalaPulso;
}

const VELOCIDAD_ROTACION = 0.006; // radianes por cuadro, sentido horario

/** Angulo de rotacion acumulado del espectro, siempre creciente (sentido
 * horario): ver docs/DISENO.md, "El logotipo", "giran en sentido horario". */
export function anguloDeRotacion(tick: number): number {
  return tick * VELOCIDAD_ROTACION;
}
