import { describe, expect, it } from 'vitest';
import {
  HITSOUND_DEFAULT,
  esTipoHitsound,
  guardarTipoHitsound,
  instanteDeContextoDelGolpe,
  leerTipoHitsound,
  suenaElGolpe,
} from './hitsound-logica.js';

function crearStorageFalso(inicial: Record<string, string> = {}): Storage {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (clave: string) => datos.get(clave) ?? null,
    setItem: (clave: string, valor: string) => {
      datos.set(clave, valor);
    },
    removeItem: (clave: string) => {
      datos.delete(clave);
    },
    clear: () => datos.clear(),
    key: () => null,
    get length() {
      return datos.size;
    },
  } as Storage;
}

describe('tipo de hitsound guardado', () => {
  it('sin nada guardado devuelve el default', () => {
    expect(leerTipoHitsound(crearStorageFalso())).toBe(HITSOUND_DEFAULT);
  });

  it('ida y vuelta de los tres tipos', () => {
    for (const tipo of ['normal', 'suave', 'seco'] as const) {
      const storage = crearStorageFalso();
      guardarTipoHitsound(tipo, storage);
      expect(leerTipoHitsound(storage)).toBe(tipo);
    }
  });

  it('un valor desconocido vuelve al default', () => {
    expect(leerTipoHitsound(crearStorageFalso({ 'tetra:hitsound': 'estridente' }))).toBe(HITSOUND_DEFAULT);
    expect(leerTipoHitsound(crearStorageFalso({ 'tetra:hitsound': '' }))).toBe(HITSOUND_DEFAULT);
    // Una clave heredada de Object no es un tipo.
    expect(esTipoHitsound('toString')).toBe(false);
    expect(esTipoHitsound('constructor')).toBe(false);
  });
});

describe('instanteDeContextoDelGolpe', () => {
  it('un golpe de hace 40 ms cae 40 ms antes del ahora del contexto', () => {
    // clock.now() = 1000 ms, el golpe fue en 960 ms de juego, ctx en 12,5 s.
    expect(instanteDeContextoDelGolpe(12.5, 1000, 960)).toBeCloseTo(12.46, 9);
  });

  it('un golpe de este mismo instante cae en el ahora del contexto', () => {
    expect(instanteDeContextoDelGolpe(3, 500, 500)).toBe(3);
  });

  it('el offset del reloj no mueve el resultado: solo cuenta la antiguedad del golpe', () => {
    // Mismo golpe de hace 25 ms con offsets de reloj distintos (+80 y -30 ms).
    const a = instanteDeContextoDelGolpe(10, 2000 - 80, 1975 - 80);
    const b = instanteDeContextoDelGolpe(10, 2000 + 30, 1975 + 30);
    expect(a).toBeCloseTo(9.975, 9);
    expect(b).toBeCloseTo(9.975, 9);
  });

  it('con la cuenta regresiva (tiempos negativos) sigue la misma resta', () => {
    expect(instanteDeContextoDelGolpe(1.2, -300, -350)).toBeCloseTo(1.15, 9);
  });
});

describe('suenaElGolpe', () => {
  it('suenan todos los juicios menos miss', () => {
    for (const juicio of ['max', 'perfect', 'great', 'good', 'bad'] as const) {
      expect(suenaElGolpe(juicio)).toBe(true);
    }
    expect(suenaElGolpe('miss')).toBe(false);
  });

  it('una pulsacion sin nota a tiro (sin resultado) no suena', () => {
    expect(suenaElGolpe(undefined)).toBe(false);
  });
});
