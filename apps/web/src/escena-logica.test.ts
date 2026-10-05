// Tests de T-053 para escena-logica.ts.

import { describe, expect, it } from 'vitest';
import {
  ANCHO_CARRIL_MAX,
  ANCHO_CARRIL_MIN,
  INTRO_DESVANECE_MS,
  INTRO_VISIBLE_HASTA_MS,
  anchoDeCarril,
  debeResincronizar,
  lineaDeAutoria,
  medidasDePista,
  objetivoDeVideo,
  opacidadIntro,
  planDeVideo,
} from './escena-logica.js';

describe('anchoDeCarril', () => {
  it('a 800 de alto es ~88 px y a 1080 es ~119 px (alto x 0.11)', () => {
    expect(anchoDeCarril(800)).toBe(88);
    expect(anchoDeCarril(1080)).toBe(119);
  });

  it('crece con el alto', () => {
    expect(anchoDeCarril(1000)).toBeGreaterThan(anchoDeCarril(800));
  });

  it('no baja de 72 ni pasa de 130', () => {
    expect(anchoDeCarril(300)).toBe(ANCHO_CARRIL_MIN);
    expect(anchoDeCarril(0)).toBe(ANCHO_CARRIL_MIN);
    expect(anchoDeCarril(4000)).toBe(ANCHO_CARRIL_MAX);
  });

  it('un alto no valido da el minimo, no NaN', () => {
    expect(anchoDeCarril(Number.NaN)).toBe(ANCHO_CARRIL_MIN);
  });
});

describe('medidasDePista', () => {
  it('el alto de la pista es el alto de la ventana', () => {
    expect(medidasDePista(800).alto).toBe(800);
    expect(medidasDePista(1080).alto).toBe(1080);
  });

  it('el receptor queda a una fraccion del alto, con un minimo', () => {
    expect(medidasDePista(800).receptorOffset).toBe(120);
    expect(medidasDePista(1080).receptorOffset).toBe(162);
    expect(medidasDePista(300).receptorOffset).toBe(90);
  });

  it('la pista de 4 carriles entra en el ancho de una ventana normal', () => {
    const m = medidasDePista(800);
    expect(m.anchoCarril * 4).toBeLessThan(1280);
  });
});

describe('objetivoDeVideo', () => {
  it('es (t - videoOffset) / 1000', () => {
    expect(objetivoDeVideo(5000, 0)).toBe(5);
    expect(objetivoDeVideo(5000, 1000)).toBe(4);
    expect(objetivoDeVideo(5000, -500)).toBe(5.5);
  });

  it('es negativo mientras el video no empezo (lead-in o offset positivo)', () => {
    expect(objetivoDeVideo(-1500, 0)).toBe(-1.5);
    expect(objetivoDeVideo(200, 1000)).toBeCloseTo(-0.8, 10);
  });

  it('sin offset usa 0', () => {
    expect(objetivoDeVideo(2000)).toBe(2);
  });
});

describe('debeResincronizar', () => {
  it('no salta si la diferencia esta dentro del umbral, en ningun sentido', () => {
    expect(debeResincronizar(10.1, 10, 0.15)).toBe(false);
    expect(debeResincronizar(9.9, 10, 0.15)).toBe(false);
  });

  it('salta cuando la diferencia supera el umbral, adelantado o atrasado', () => {
    expect(debeResincronizar(10.2, 10, 0.15)).toBe(true);
    expect(debeResincronizar(9.8, 10, 0.15)).toBe(true);
  });

  it('exactamente en el umbral todavia no salta (se dice "supera")', () => {
    expect(debeResincronizar(10.5, 10, 0.5)).toBe(false);
  });

  it('el umbral por defecto es 0.15 s', () => {
    expect(debeResincronizar(10.14, 10)).toBe(false);
    expect(debeResincronizar(10.16, 10)).toBe(true);
  });

  it('un tiempo de video no valido se corrige y un objetivo no valido no', () => {
    expect(debeResincronizar(Number.NaN, 10)).toBe(true);
    expect(debeResincronizar(10, Number.NaN)).toBe(false);
  });
});

describe('planDeVideo', () => {
  it('con objetivo negativo espera en el primer cuadro, aunque el video este corriendo', () => {
    expect(planDeVideo(-0.5, 3)).toEqual({ modo: 'esperar' });
  });

  it('en el instante 0 ya reproduce', () => {
    expect(planDeVideo(0, 0)).toEqual({ modo: 'reproducir', saltarA: null });
  });

  it('en hora: reproduce sin saltar', () => {
    expect(planDeVideo(12, 12.05)).toEqual({ modo: 'reproducir', saltarA: null });
  });

  it('desviado: salta al objetivo del reloj, no al tiempo del video', () => {
    expect(planDeVideo(12, 10)).toEqual({ modo: 'reproducir', saltarA: 12 });
    expect(planDeVideo(12, 15)).toEqual({ modo: 'reproducir', saltarA: 12 });
  });

  it('pasado el final del video queda quieto en vez de saltar', () => {
    expect(planDeVideo(61, 59.9, 60)).toEqual({ modo: 'terminado' });
    expect(planDeVideo(59, 59, 60)).toEqual({ modo: 'reproducir', saltarA: null });
  });

  it('con una duracion desconocida nunca da por terminado', () => {
    expect(planDeVideo(1000, 3)).toEqual({ modo: 'reproducir', saltarA: 1000 });
    expect(planDeVideo(1000, 3, Number.NaN)).toEqual({ modo: 'reproducir', saltarA: 1000 });
  });
});

describe('opacidadIntro', () => {
  it('se ve entera durante el lead-in y el principio de la cancion', () => {
    expect(opacidadIntro(-1500)).toBe(1);
    expect(opacidadIntro(0)).toBe(1);
    expect(opacidadIntro(INTRO_VISIBLE_HASTA_MS)).toBe(1);
  });

  it('se desvanece linealmente y desaparece alrededor de los 3 s', () => {
    expect(opacidadIntro(INTRO_VISIBLE_HASTA_MS + INTRO_DESVANECE_MS / 2)).toBeCloseTo(0.5, 10);
    expect(opacidadIntro(INTRO_VISIBLE_HASTA_MS + INTRO_DESVANECE_MS)).toBe(0);
    expect(INTRO_VISIBLE_HASTA_MS + INTRO_DESVANECE_MS).toBeGreaterThanOrEqual(2800);
    expect(INTRO_VISIBLE_HASTA_MS + INTRO_DESVANECE_MS).toBeLessThanOrEqual(3200);
  });

  it('no vuelve: queda en 0 mas alla', () => {
    expect(opacidadIntro(60_000)).toBe(0);
  });

  it('es monotona decreciente despues del tramo entero', () => {
    let anterior = 1;
    for (let t = INTRO_VISIBLE_HASTA_MS; t <= INTRO_VISIBLE_HASTA_MS + INTRO_DESVANECE_MS; t += 50) {
      const o = opacidadIntro(t);
      expect(o).toBeLessThanOrEqual(anterior);
      anterior = o;
    }
  });
});

describe('lineaDeAutoria', () => {
  it('une artista y dificultad con un punto medio', () => {
    expect(lineaDeAutoria({ artista: 'Rival', dificultad: 'Hard' })).toBe('Rival · Hard');
  });

  it('con una sola de las dos no deja separadores sueltos', () => {
    expect(lineaDeAutoria({ artista: 'Rival' })).toBe('Rival');
    expect(lineaDeAutoria({ dificultad: 'Hard' })).toBe('Hard');
    expect(lineaDeAutoria({ artista: '  ', dificultad: 'Hard' })).toBe('Hard');
    expect(lineaDeAutoria({})).toBe('');
  });
});
