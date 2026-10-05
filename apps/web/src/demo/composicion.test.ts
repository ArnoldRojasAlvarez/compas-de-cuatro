// T-051: la partitura de la demo. Funcion pura: se prueba sin navegador.

import { describe, expect, it } from 'vitest';
import {
  BPM,
  COMPAS_MS,
  crearPrng,
  componerDemo,
  inicioDeSeccion,
  SLOT_MS,
  TOTAL_COMPASES,
  type EventoMusical,
} from './composicion.js';

const composicion = componerDemo();

function eventosDe(voz: EventoMusical['voz'], desdeCompas = 0, hastaCompas = TOTAL_COMPASES): EventoMusical[] {
  return composicion.eventos.filter(
    (e) => e.voz === voz && e.tiempo >= desdeCompas * COMPAS_MS - 1e-6 && e.tiempo < hastaCompas * COMPAS_MS - 1e-6,
  );
}

const claseDeAltura = (nota: number): number => ((nota % 12) + 12) % 12;

describe('componerDemo: forma general', () => {
  it('es determinista: dos llamadas dan exactamente lo mismo', () => {
    expect(componerDemo()).toEqual(composicion);
  });

  it('tiene 128 BPM y dura entre 80 y 95 segundos', () => {
    expect(composicion.bpm).toBe(128);
    expect(composicion.bpm).toBe(BPM);
    expect(composicion.duracion).toBeGreaterThanOrEqual(80_000);
    expect(composicion.duracion).toBeLessThanOrEqual(95_000);
    // 44 compases de 4/4.
    expect(composicion.duracion).toBeCloseTo(TOTAL_COMPASES * 4 * (60000 / 128), 6);
  });

  it('los eventos estan ordenados por tiempo', () => {
    for (let i = 1; i < composicion.eventos.length; i++) {
      expect(composicion.eventos[i]!.tiempo).toBeGreaterThanOrEqual(composicion.eventos[i - 1]!.tiempo);
    }
  });

  it('todo cae dentro de la duracion y con valores validos', () => {
    for (const e of composicion.eventos) {
      expect(e.tiempo).toBeGreaterThanOrEqual(0);
      expect(e.duracion).toBeGreaterThanOrEqual(0);
      expect(e.tiempo + e.duracion).toBeLessThanOrEqual(composicion.duracion + 1e-6);
      expect(e.intensidad).toBeGreaterThan(0);
      expect(e.intensidad).toBeLessThanOrEqual(1);
      expect(Number.isInteger(e.nota)).toBe(true);
    }
  });

  it('la percusion dura 0 y las voces tonales dan duracion', () => {
    for (const e of composicion.eventos) {
      if (e.voz === 'bombo' || e.voz === 'caja' || e.voz === 'hat') expect(e.duracion).toBe(0);
      else expect(e.duracion).toBeGreaterThan(0);
    }
  });

  it('cada evento cae en la rejilla de semicorcheas', () => {
    for (const e of composicion.eventos) {
      const slots = e.tiempo / SLOT_MS;
      expect(Math.abs(slots - Math.round(slots))).toBeLessThan(1e-9);
    }
  });

  it('el preview queda dentro de la pieza y arranca donde ya suena la melodia', () => {
    expect(composicion.preview).toBeGreaterThanOrEqual(0);
    expect(composicion.preview).toBeLessThan(composicion.duracion - 10_000);
    const enElPreview = composicion.eventos.filter(
      (e) => e.voz === 'melodia' && e.tiempo >= composicion.preview && e.tiempo < composicion.preview + COMPAS_MS,
    );
    expect(enElPreview.length).toBeGreaterThan(0);
  });
});

describe('componerDemo: estructura', () => {
  const intro = inicioDeSeccion('intro');
  const A = inicioDeSeccion('A');
  const B = inicioDeSeccion('B');
  const quiebre = inicioDeSeccion('quiebre');
  const A2 = inicioDeSeccion('A2');
  const B2 = inicioDeSeccion('B2');
  const cola = inicioDeSeccion('cola');

  it('las secciones son intro, A, B, quiebre, A, B y cola, en ese orden', () => {
    expect([intro, A, B, quiebre, A2, B2, cola]).toEqual([0, 4, 12, 20, 24, 32, 40]);
  });

  it('la intro solo tiene hats y acordes', () => {
    const voces = new Set(composicion.eventos.filter((e) => e.tiempo < A * COMPAS_MS).map((e) => e.voz));
    expect([...voces].sort()).toEqual(['acorde', 'hat']);
  });

  it('el bombo entra en A y se calla en el quiebre', () => {
    expect(eventosDe('bombo', 0, A)).toHaveLength(0);
    expect(eventosDe('bombo', A, B).length).toBeGreaterThan(8);
    expect(eventosDe('bombo', quiebre, A2)).toHaveLength(0);
    expect(eventosDe('bombo', A2, B2).length).toBeGreaterThan(8);
  });

  it('caja y bajo entran junto con el bombo', () => {
    expect(eventosDe('caja', 0, A)).toHaveLength(0);
    expect(eventosDe('bajo', 0, A)).toHaveLength(0);
    expect(eventosDe('caja', A, B).length).toBeGreaterThan(8);
    expect(eventosDe('bajo', A, B).length).toBeGreaterThan(8);
  });

  it('la melodia no suena antes de B y es mas densa que en el quiebre', () => {
    expect(eventosDe('melodia', 0, B)).toHaveLength(0);
    expect(eventosDe('melodia', B, quiebre).length).toBeGreaterThan(20);
    expect(eventosDe('melodia', B, quiebre).length).toBeGreaterThan(eventosDe('melodia', quiebre, A2).length);
  });

  it('B tiene mas hats que A (semicorcheas contra corcheas)', () => {
    expect(eventosDe('hat', B, quiebre).length).toBeGreaterThan(1.5 * eventosDe('hat', A, B).length);
  });

  it('el final es un solo acorde largo con la melodia sobre la tonica', () => {
    const final = composicion.eventos.filter((e) => e.tiempo >= cola * COMPAS_MS - 1e-6);
    expect(final.filter((e) => e.voz === 'acorde').length).toBe(4);
    const largos = final.filter((e) => e.duracion >= 2 * COMPAS_MS);
    expect(largos.length).toBeGreaterThanOrEqual(6); // 4 voces del acorde, bajo y melodia
    const melodia = final.filter((e) => e.voz === 'melodia');
    expect(melodia).toHaveLength(1);
    expect(claseDeAltura(melodia[0]!.nota)).toBe(9); // la
  });
});

describe('componerDemo: armonia', () => {
  /** Raiz esperada del bajo en cada compas de A (Am F C G Am F C G). */
  const A = inicioDeSeccion('A');

  it('el bajo marca i-VI-III-VII en A: la, fa, do, sol', () => {
    const esperadas = [9, 5, 0, 7, 9, 5, 0, 7];
    esperadas.forEach((clase, k) => {
      const compas = A + k;
      const primerBajo = composicion.eventos.find(
        (e) => e.voz === 'bajo' && Math.abs(e.tiempo - compas * COMPAS_MS) < 1e-6,
      );
      expect(primerBajo, `compas ${compas}`).toBeDefined();
      expect(claseDeAltura(primerBajo!.nota)).toBe(clase);
    });
  });

  it('el pad de cada compas de A tiene la triada del acorde (y su septima o novena)', () => {
    const triadas: number[][] = [
      [9, 0, 4], // Am
      [5, 9, 0], // F
      [0, 4, 7], // C
      [7, 11, 2], // G
    ];
    for (let k = 0; k < 8; k++) {
      const compas = A + k;
      const clases = new Set(
        composicion.eventos
          .filter((e) => e.voz === 'acorde' && Math.abs(e.tiempo - compas * COMPAS_MS) < 1e-6)
          .map((e) => claseDeAltura(e.nota)),
      );
      for (const c of triadas[k % 4]!) expect(clases.has(c), `compas ${compas}, clase ${c}`).toBe(true);
    }
  });

  it('B pasa por el E mayor: su sol sostenido es la sensible que empuja a la menor', () => {
    const B = inicioDeSeccion('B');
    // El compas 3 de B es el E7: los acordes sincopados traen la tercera (sol sostenido, 8)
    // y la septima (re, 2); sin la tercera seria un mi menor, no la dominante.
    const clases = new Set(
      composicion.eventos
        .filter((e) => e.voz === 'acorde' && e.tiempo >= (B + 3) * COMPAS_MS - 1e-6 && e.tiempo < (B + 4) * COMPAS_MS)
        .map((e) => claseDeAltura(e.nota)),
    );
    for (const c of [8, 2]) expect(clases.has(c)).toBe(true);
  });

  it('la melodia solo usa notas de la menor natural y la sensible', () => {
    const permitidas = new Set([9, 11, 0, 2, 4, 5, 7, 8]); // A B C D E F G y G#
    for (const e of eventosDe('melodia')) expect(permitidas.has(claseDeAltura(e.nota))).toBe(true);
  });

  it('la melodia vive en el registro de la voz (do5 a do6) y el bajo abajo de do3', () => {
    for (const e of eventosDe('melodia')) {
      expect(e.nota).toBeGreaterThanOrEqual(69);
      expect(e.nota).toBeLessThanOrEqual(84);
    }
    for (const e of eventosDe('bajo')) expect(e.nota).toBeLessThan(60);
  });
});

describe('crearPrng', () => {
  it('es determinista, esta en [0, 1) y no es constante', () => {
    const a = crearPrng(123);
    const b = crearPrng(123);
    const valores: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      valores.push(x);
    }
    expect(new Set(valores).size).toBeGreaterThan(990);
    expect(crearPrng(124)()).not.toBe(crearPrng(123)());
  });

  it('la media de muchas muestras ronda 0,5', () => {
    const azar = crearPrng(7);
    let suma = 0;
    for (let i = 0; i < 20_000; i++) suma += azar();
    expect(suma / 20_000).toBeGreaterThan(0.49);
    expect(suma / 20_000).toBeLessThan(0.51);
  });
});
