// Tests de T-056 para apps/web/src/contadores-logica.ts.

import { describe, expect, it } from 'vitest';
import { windowsForOD } from '@tetra/core';
import {
  ANTICIPACION_DEL_SALTO_MS,
  DURACION_MARCA_MS,
  GOLPES_EN_MEDIA_MOVIL,
  GOLPES_MINIMOS_MEDIA_VIVA,
  INTRO_SALTABLE_MS,
  PASOS_DE_ALPHA,
  REINTENTO_MS,
  alphaDeMarca,
  crearMediaMovil,
  destinoDelSalto,
  formatearPulsaciones,
  formatearUR,
  fraccionesDeVentanas,
  pasoDeAlphaDeMarca,
  posicionEnBarra,
  progresoDeReintento,
  reintentoCompleto,
  saltoDisponible,
  textoDeMediaViva,
  tramosDeBarra,
  unstableRate,
} from './contadores-logica.js';

describe('posicionEnBarra', () => {
  it('error 0 va al centro', () => {
    expect(posicionEnBarra(0, 100)).toBe(0);
  });

  it('tarde corre a la derecha y temprano a la izquierda, de forma proporcional', () => {
    expect(posicionEnBarra(50, 100)).toBeCloseTo(0.5, 10);
    expect(posicionEnBarra(-25, 100)).toBeCloseTo(-0.25, 10);
  });

  it('el signo no se invierte: tarde es positivo (una resta al reves lo rompe)', () => {
    expect(posicionEnBarra(40, 80)).toBeGreaterThan(0);
    expect(posicionEnBarra(-40, 80)).toBeLessThan(0);
  });

  it('en el borde de la ventana vale 1 y mas alla se recorta, sin salirse de la barra', () => {
    expect(posicionEnBarra(100, 100)).toBe(1);
    expect(posicionEnBarra(300, 100)).toBe(1);
    expect(posicionEnBarra(-300, 100)).toBe(-1);
  });

  it('una ventana no valida o un error no finito dan el centro, no NaN', () => {
    expect(posicionEnBarra(30, 0)).toBe(0);
    expect(posicionEnBarra(30, -5)).toBe(0);
    expect(posicionEnBarra(30, Number.NaN)).toBe(0);
    expect(posicionEnBarra(Number.NaN, 100)).toBe(0);
  });
});

describe('alphaDeMarca', () => {
  it('nace entera y se apaga a los 2 s', () => {
    expect(alphaDeMarca(0)).toBe(1);
    expect(alphaDeMarca(DURACION_MARCA_MS)).toBe(0);
    expect(DURACION_MARCA_MS).toBe(2000);
  });

  it('baja de forma lineal y monotona', () => {
    expect(alphaDeMarca(500)).toBeCloseTo(0.75, 10);
    expect(alphaDeMarca(1000)).toBeCloseTo(0.5, 10);
    expect(alphaDeMarca(1500)).toBeCloseTo(0.25, 10);
    expect(alphaDeMarca(300)).toBeGreaterThan(alphaDeMarca(900));
  });

  it('pasada la vida queda en 0, no negativa', () => {
    expect(alphaDeMarca(5000)).toBe(0);
  });

  it('una edad negativa cuenta como recien nacida y una no valida como apagada', () => {
    expect(alphaDeMarca(-40)).toBe(1);
    expect(alphaDeMarca(Number.NaN)).toBe(0);
  });

  it('el paso cuantizado va de PASOS_DE_ALPHA a 0 y no cambia entre dos edades del mismo paso', () => {
    expect(pasoDeAlphaDeMarca(0)).toBe(PASOS_DE_ALPHA);
    expect(pasoDeAlphaDeMarca(DURACION_MARCA_MS)).toBe(0);
    expect(pasoDeAlphaDeMarca(1000)).toBe(PASOS_DE_ALPHA / 2);
    expect(pasoDeAlphaDeMarca(1000)).toBe(pasoDeAlphaDeMarca(1010));
  });
});

describe('fraccionesDeVentanas', () => {
  it('son las ventanas del OD sobre la mas ancha (bad), de adentro hacia afuera', () => {
    const v = windowsForOD(5);
    const f = fraccionesDeVentanas(v);
    expect(f).toHaveLength(5);
    expect(f[0]).toBeCloseTo(v.max / v.bad, 10);
    expect(f[1]).toBeCloseTo(v.perfect / v.bad, 10);
    expect(f[2]).toBeCloseTo(v.great / v.bad, 10);
    expect(f[3]).toBeCloseTo(v.good / v.bad, 10);
    expect(f[4]).toBe(1);
  });

  it('un OD alto estrecha las franjas respecto de uno bajo', () => {
    expect(fraccionesDeVentanas(windowsForOD(10))[1]!).toBeLessThan(
      fraccionesDeVentanas(windowsForOD(0))[1]!,
    );
  });
});

describe('tramosDeBarra', () => {
  const tramos = tramosDeBarra(windowsForOD(5));

  it('son nueve tramos que cubren la barra entera sin huecos ni solapes', () => {
    expect(tramos).toHaveLength(9);
    expect(tramos[0]!.desde).toBeCloseTo(0, 10);
    expect(tramos[8]!.hasta).toBeCloseTo(100, 10);
    for (let i = 1; i < tramos.length; i++) {
      expect(tramos[i]!.desde).toBeCloseTo(tramos[i - 1]!.hasta, 10);
    }
  });

  it('van de bad a max y vuelven a bad, con el max en el centro', () => {
    expect(tramos.map((t) => t.nivel)).toEqual([4, 3, 2, 1, 0, 1, 2, 3, 4]);
    expect(tramos[4]!.desde + tramos[4]!.hasta).toBeCloseTo(100, 10);
  });

  it('son simetricos respecto del centro', () => {
    for (let i = 0; i < 4; i++) {
      expect(tramos[i]!.desde).toBeCloseTo(100 - tramos[8 - i]!.hasta, 10);
      expect(tramos[i]!.hasta).toBeCloseTo(100 - tramos[8 - i]!.desde, 10);
    }
  });

  it('el max mide su ventana real: 16.5 ms de 151 - 3 x 5 = 136 ms de semiancho', () => {
    const v = windowsForOD(5);
    const ancho = tramos[4]!.hasta - tramos[4]!.desde;
    expect(ancho).toBeCloseTo((100 * v.max) / v.bad, 8);
  });
});

describe('crearMediaMovil', () => {
  it('sin valores vale 0', () => {
    const m = crearMediaMovil();
    expect(m.valor()).toBe(0);
    expect(m.cantidad()).toBe(0);
  });

  it('es la media de lo que lleva mientras no se llene el anillo', () => {
    const m = crearMediaMovil(4);
    m.agregar(10);
    m.agregar(20);
    expect(m.valor()).toBeCloseTo(15, 10);
    expect(m.cantidad()).toBe(2);
  });

  it('solo cuenta los ultimos N: el mas viejo sale al llenarse', () => {
    const m = crearMediaMovil(3);
    for (const v of [100, 1, 2, 3]) m.agregar(v);
    // Si el 100 siguiera dentro la media seria 26.5.
    expect(m.valor()).toBeCloseTo(2, 10);
    expect(m.cantidad()).toBe(3);
  });

  it('el tamano de arranque es de 30 golpes (T-060)', () => {
    expect(GOLPES_EN_MEDIA_MOVIL).toBe(30);
    const m = crearMediaMovil();
    for (let i = 0; i < 30; i++) m.agregar(50);
    m.agregar(-50);
    expect(m.cantidad()).toBe(30);
    expect(m.valor()).toBeCloseTo((29 * 50 - 50) / 30, 10);
  });

  it('respeta el signo: golpes tempranos dan una media negativa', () => {
    const m = crearMediaMovil(5);
    for (const v of [-20, -30, -10]) m.agregar(v);
    expect(m.valor()).toBeCloseTo(-20, 10);
  });

  it('ignora valores no finitos y reiniciar vuelve a 0', () => {
    const m = crearMediaMovil(3);
    m.agregar(10);
    m.agregar(Number.NaN);
    expect(m.cantidad()).toBe(1);
    m.reiniciar();
    expect(m.valor()).toBe(0);
    expect(m.cantidad()).toBe(0);
  });
});

describe('unstableRate', () => {
  it('es 10 veces la desviacion estandar poblacional', () => {
    // 10, 20, 30, 40: media 25, varianza 125, desviacion 11.1803...
    expect(unstableRate([10, 20, 30, 40])).toBeCloseTo(10 * Math.sqrt(125), 8);
  });

  it('no depende de la media: un sesgo constante no mueve el UR', () => {
    expect(unstableRate([110, 120, 130, 140])).toBeCloseTo(
      unstableRate([10, 20, 30, 40]),
      8,
    );
  });

  it('con menos de dos golpes no hay dispersion', () => {
    expect(unstableRate([])).toBe(0);
    expect(unstableRate([25])).toBe(0);
  });

  it('formatearUR redondea a entero y no muestra NaN', () => {
    expect(formatearUR(111.803)).toBe('112');
    expect(formatearUR(0)).toBe('0');
    expect(formatearUR(Number.NaN)).toBe('0');
  });
});

describe('formatearPulsaciones', () => {
  it('une tecla y cuenta con puntos medios', () => {
    expect(formatearPulsaciones(['D', 'F', 'J', 'K'], [412, 398, 401, 405])).toBe(
      'D 412 · F 398 · J 401 · K 405',
    );
  });

  it('sin etiqueta usa el numero de columna', () => {
    expect(formatearPulsaciones(['D'], [1, 2])).toBe('D 1 · 2 2');
  });
});

describe('reintento mantenido', () => {
  it('el progreso del aro es la fraccion de los 500 ms mantenidos', () => {
    expect(REINTENTO_MS).toBe(500);
    expect(progresoDeReintento(0)).toBe(0);
    expect(progresoDeReintento(250)).toBeCloseTo(0.5, 10);
    expect(progresoDeReintento(500)).toBe(1);
  });

  it('se queda en 1 al pasarse y en 0 con tiempos negativos o no validos', () => {
    expect(progresoDeReintento(900)).toBe(1);
    expect(progresoDeReintento(-30)).toBe(0);
    expect(progresoDeReintento(Number.NaN)).toBe(0);
  });

  it('reintenta exactamente a los 500 ms y no antes', () => {
    expect(reintentoCompleto(499.9)).toBe(false);
    expect(reintentoCompleto(500)).toBe(true);
    expect(reintentoCompleto(700)).toBe(true);
    expect(reintentoCompleto(0)).toBe(false);
  });
});

describe('saltar intro', () => {
  it('el destino es 2 s antes de la primera nota', () => {
    expect(ANTICIPACION_DEL_SALTO_MS).toBe(2000);
    expect(destinoDelSalto(12000)).toBe(10000);
  });

  it('el destino nunca baja de 0', () => {
    expect(destinoDelSalto(1500)).toBe(0);
  });

  it('se ofrece solo si la primera nota esta a mas de 5 s', () => {
    expect(INTRO_SALTABLE_MS).toBe(5000);
    expect(saltoDisponible(0, 5000)).toBe(false);
    expect(saltoDisponible(0, 5001)).toBe(true);
    expect(saltoDisponible(0, 800)).toBe(false);
  });

  it('con el lead-in (t negativo) ya esta disponible', () => {
    expect(saltoDisponible(-1500, 9000)).toBe(true);
  });

  it('desaparece al llegar al destino: hasta ahi si, de ahi en adelante no', () => {
    expect(saltoDisponible(6999, 9000)).toBe(true);
    expect(saltoDisponible(7000, 9000)).toBe(false);
    expect(saltoDisponible(8500, 9000)).toBe(false);
  });

  it('sin notas no hay salto', () => {
    expect(saltoDisponible(0, undefined)).toBe(false);
  });

  it('en una partida desde mitad de mapa (empieza 1.5 s antes de la primera nota) no se ofrece', () => {
    // Primera nota a 40 s; la partida arranca en 38.5 s: ya pasaron el destino (38 s).
    expect(saltoDisponible(38500, 40000)).toBe(false);
  });
});

describe('textoDeMediaViva (T-060)', () => {
  it('no se muestra hasta tener 10 golpes', () => {
    expect(GOLPES_MINIMOS_MEDIA_VIVA).toBe(10);
    expect(textoDeMediaViva(61, 9)).toBeNull();
    expect(textoDeMediaViva(61, 10)).toBe('+61 ms');
  });

  it('lleva el signo: tarde con +, temprano con -, y 0 sin signo', () => {
    expect(textoDeMediaViva(61.4, 30)).toBe('+61 ms');
    expect(textoDeMediaViva(-24.6, 30)).toBe('-25 ms');
    expect(textoDeMediaViva(0.2, 30)).toBe('0 ms');
    expect(textoDeMediaViva(-0.2, 30)).toBe('0 ms');
  });

  it('una media no valida no se muestra', () => {
    expect(textoDeMediaViva(Number.NaN, 30)).toBeNull();
  });
});
