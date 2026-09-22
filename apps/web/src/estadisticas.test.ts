// Tests de T-007 para apps/web/src/estadisticas.ts.
//
// La leccion del proyecto (ver docs/tickets/T-007-calibracion-offset.md):
// antes de cada asercion, preguntarse que implementacion incorrecta la
// haria fallar. Los valores de media y desviacion estandar de abajo estan
// calculados a mano (no salen de correr la misma funcion y pegar el
// resultado), para que un error real en la formula se note.

import { describe, expect, it } from 'vitest';
import {
  calcularOffsetCorregido,
  contarTempranoTarde,
  desviacionEstandar,
  erroresJuzgados,
  etiquetaDeSigno,
  media,
  type GolpeRegistrado,
} from './estadisticas.js';

describe('media', () => {
  it('array vacio da 0', () => {
    expect(media([])).toBe(0);
  });

  it('un array simetrico alrededor de 0 da 0', () => {
    // -30, -10, 10, 30: suma 0, media 0.
    expect(media([-30, -10, 10, 30])).toBe(0);
  });

  it('media calculada a mano sobre un array asimetrico', () => {
    // -40 - 20 - 10 + 5 + 15 = -50; -50 / 5 = -10.
    expect(media([-40, -20, -10, 5, 15])).toBe(-10);
  });
});

describe('desviacionEstandar', () => {
  it('array vacio da 0', () => {
    expect(desviacionEstandar([])).toBe(0);
  });

  it('un solo elemento da 0 (no hay dispersion posible)', () => {
    expect(desviacionEstandar([42])).toBe(0);
  });

  it('desviacion estandar calculada a mano (poblacional, se divide por n)', () => {
    // errores: -30, -10, 10, 30. media = 0.
    // desviaciones al cuadrado: 900, 100, 100, 900 -> suma 2000.
    // 2000 / 4 = 500. sqrt(500) = 22.360679...
    expect(desviacionEstandar([-30, -10, 10, 30])).toBeCloseTo(22.3606797749979, 9);
  });

  it('desviacion estandar con media distinta de 0, calculada a mano', () => {
    // errores: -40, -20, -10, 5, 15. media = -10 (ver test de media).
    // desviaciones: -30, -10, 0, 15, 25.
    // cuadrados: 900, 100, 0, 225, 625 -> suma 1850.
    // 1850 / 5 = 370. sqrt(370) = 19.235384...
    expect(desviacionEstandar([-40, -20, -10, 5, 15])).toBeCloseTo(19.235384061671343, 9);
  });

  it('una implementacion que dividiera por n-1 (muestral) fallaria este valor', () => {
    // Mismo array que arriba, pero con n-1: 1850 / 4 = 462.5, sqrt = 21.5...
    // Se deja el calculo aca al lado para dejar explicito que esta funcion
    // no debe dar ese numero.
    const resultado = desviacionEstandar([-40, -20, -10, 5, 15]);
    expect(resultado).not.toBeCloseTo(Math.sqrt(462.5), 5);
  });
});

describe('contarTempranoTarde', () => {
  it('array vacio da 0 y 0', () => {
    expect(contarTempranoTarde([])).toEqual({ temprano: 0, tarde: 0 });
  });

  it('cuenta cada lado por separado', () => {
    expect(contarTempranoTarde([-40, -20, -10, 5, 15])).toEqual({ temprano: 3, tarde: 2 });
  });

  it('un error de exactamente 0 no cuenta como temprano ni como tarde', () => {
    expect(contarTempranoTarde([-5, 0, 5])).toEqual({ temprano: 1, tarde: 1 });
  });
});

describe('etiquetaDeSigno', () => {
  it('negativo es temprano', () => {
    expect(etiquetaDeSigno(-1)).toBe('temprano');
  });

  it('positivo es tarde', () => {
    expect(etiquetaDeSigno(1)).toBe('tarde');
  });

  it('cero no es ninguno de los dos', () => {
    expect(etiquetaDeSigno(0)).toBeNull();
  });
});

describe('erroresJuzgados', () => {
  it('descarta los golpes en miss y deja el error de los demas', () => {
    const golpes: GolpeRegistrado[] = [
      { judgement: 'great', error: -20 },
      { judgement: 'miss', error: 300 },
      { judgement: 'bad', error: 90 },
      { judgement: 'miss', error: -500 },
      { judgement: 'perfect', error: 3 },
    ];

    expect(erroresJuzgados(golpes)).toEqual([-20, 90, 3]);
  });
});

// ---------------------------------------------------------------------------
// calcularOffsetCorregido: el signo, que es donde esto se rompe (T-007).
//
// Ver el JSDoc de la funcion en estadisticas.ts para la derivacion
// completa. Estos tests fijan la relacion con numeros concretos: si alguien
// invierte el signo (resta la media en vez de sumarla), el primer test ya
// falla (espera -24 y la implementacion invertida da +24), y el tercero lo
// confirma simulando una segunda partida con el mismo sesgo fisico.
// ---------------------------------------------------------------------------

describe('calcularOffsetCorregido', () => {
  it('con media negativa (pego temprano), el offset nuevo BAJA en esa magnitud', () => {
    // offsetActual + mediaError = 0 + (-24) = -24, no +24: es el punto
    // exacto donde el bug clasico de signo invertido se cuela.
    expect(calcularOffsetCorregido(0, -24)).toBe(-24);
  });

  it('con media positiva (pego tarde), el offset nuevo SUBE en esa magnitud', () => {
    expect(calcularOffsetCorregido(0, 15)).toBe(15);
  });

  it('parte de un offset ya distinto de cero: se suma la media, no se reemplaza', () => {
    // offsetActual = 10, mediaError = -24 -> 10 + (-24) = -14.
    expect(calcularOffsetCorregido(10, -24)).toBe(-14);
  });

  it('test de signo: aplicar la correccion sobre el mismo sesgo fisico deja el error en 0, no lo duplica', () => {
    // Modela un jugador con un sesgo fisico fijo (ver el JSDoc de
    // calcularOffsetCorregido): pulsa siempre "sesgoFisico" ms antes o
    // despues de cada nota en terminos de tiempo real, sin importar el
    // offset configurado. Con el offset actual, eso se mide como una media
    // de error de -24ms.
    const offsetActual = 0;
    const mediaMedida = -24;
    const offsetNuevo = calcularOffsetCorregido(offsetActual, mediaMedida);

    // De la formula del reloj (clock.now() = tiempoReal - offset, y
    // error = tiempoDeJuego - nota.time): error = sesgoFisico - offset.
    // Con el offset actual, error = mediaMedida, asi que
    // sesgoFisico = mediaMedida + offsetActual.
    const sesgoFisico = mediaMedida + offsetActual;

    // Si el jugador repite el mismo sesgo fisico en la proxima partida, el
    // error con el offset nuevo tiene que dar 0: la correccion cancela el
    // sesgo. Con el signo invertido (offsetNuevo = offsetActual -
    // mediaMedida = 24), esto daria -24 - 24 = -48: el doble del sesgo
    // original, no cero.
    const errorConOffsetNuevo = sesgoFisico - offsetNuevo;

    expect(errorConOffsetNuevo).toBe(0);
  });

  it('test de signo, caso tarde: mismo razonamiento con un sesgo positivo', () => {
    const offsetActual = 5;
    const mediaMedida = 18;
    const offsetNuevo = calcularOffsetCorregido(offsetActual, mediaMedida);

    const sesgoFisico = mediaMedida + offsetActual;
    const errorConOffsetNuevo = sesgoFisico - offsetNuevo;

    expect(errorConOffsetNuevo).toBe(0);
  });
});
