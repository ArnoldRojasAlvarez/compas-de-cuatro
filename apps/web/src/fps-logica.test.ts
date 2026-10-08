// T-059: el contador de fps tiene que poder leerse. Se prueba con la serie que
// de verdad pasa en el navegador: frames que caen cada 16,7 ms pero medidos con
// un reloj que avanza de a bloques de audio de 2,67 ms.

import { describe, expect, it } from 'vitest';
import {
  VENTANA_FPS_MS,
  crearMedidorDeFps,
  formatearLecturaFps,
  type LecturaFps,
} from './fps-logica.js';

/**
 * De a cuanto avanza `audioContext.currentTime`: un bloque de render del audio
 * (128 muestras a 48 kHz) o un callback del dispositivo de salida (10 ms, lo
 * habitual en Windows). Se prueban los dos.
 */
const BLOQUES_MS = [128 / 48, 10];

/** Lo que lee el reloj de juego en el instante real `msReales`: cuantizado al bloque. */
function relojCuantizado(msReales: number, bloqueMs: number): number {
  return Math.floor(msReales / bloqueMs) * bloqueMs;
}

interface Frame {
  t: number;
  duracionMs: number;
}

/**
 * `cuantos` frames a `cadenciaMs`, con el tiempo de juego cuantizado y la duracion
 * real del frame. `tiron` alarga un frame (el reloj de verdad sigue corriendo).
 */
function serie(
  cuantos: number,
  cadenciaMs: number,
  bloqueMs: number = BLOQUES_MS[0]!,
  tiron?: { indice: number; ms: number },
): Frame[] {
  const frames: Frame[] = [];
  let real = 0;
  for (let i = 0; i < cuantos; i++) {
    const duracion = tiron !== undefined && i === tiron.indice ? tiron.ms : cadenciaMs;
    if (i > 0) real += duracion;
    frames.push({ t: relojCuantizado(real, bloqueMs), duracionMs: i === 0 ? 0 : duracion });
  }
  return frames;
}

function lecturas(frames: Frame[], ventanaMs?: number): LecturaFps[] {
  const medidor = crearMedidorDeFps(ventanaMs);
  const salida: LecturaFps[] = [];
  for (const frame of frames) {
    const lectura = medidor.registrar(frame.t, frame.duracionMs);
    if (lectura !== null) salida.push(lectura);
  }
  return salida;
}

describe('contador de fps: promedio de la ventana', () => {
  // El error del promedio es un bloque del reloj sobre los ~500 ms de la ventana: 0,5 % con
  // 2,67 ms (menos de 1 fps) y 2 % con 10 ms (hasta 1,2 fps).
  it.each([
    [BLOQUES_MS[0]!, 1],
    [BLOQUES_MS[1]!, 2],
  ])(
    'frames a 60 Hz con el reloj cuantizado a %f ms leen 60 fps estables (el contador de antes bailaba)',
    (bloqueMs, tolerancia) => {
      const frames = serie(300, 1000 / 60, bloqueMs);

      // Lo que hacia el contador anterior: 1000 / dt de cada frame, con el reloj cuantizado.
      const instantaneos: number[] = [];
      for (let i = 1; i < frames.length; i++) {
        instantaneos.push(1000 / (frames[i]!.t - frames[i - 1]!.t));
      }
      const baile = Math.max(...instantaneos) - Math.min(...instantaneos);
      expect(baile).toBeGreaterThan(5);

      const leidas = lecturas(frames);
      expect(leidas.length).toBeGreaterThanOrEqual(8);
      let mejor = Infinity;
      let peor = -Infinity;
      for (const lectura of leidas) {
        expect(Math.abs(lectura.fps - 60)).toBeLessThanOrEqual(tolerancia);
        mejor = Math.min(mejor, lectura.fps);
        peor = Math.max(peor, lectura.fps);
      }
      // Entre lecturas se mueve mucho menos que el contador instantaneo.
      expect(peor - mejor).toBeLessThan(baile / 2);
    },
  );

  it('a 144 Hz y a 30 Hz tambien promedia bien', () => {
    for (const hz of [144, 30]) {
      const leidas = lecturas(serie(hz * 5, 1000 / hz));
      expect(leidas.length).toBeGreaterThan(0);
      for (const lectura of leidas) expect(Math.abs(lectura.fps - hz)).toBeLessThan(hz * 0.02);
    }
  });

  it('no hay lectura hasta que la ventana abarca los 500 ms, y despues una por ventana', () => {
    const medidor = crearMedidorDeFps();
    let primera = -1;
    let cuantas = 0;
    const frames = serie(180, 1000 / 60); // 3 s
    frames.forEach((frame, i) => {
      if (medidor.registrar(frame.t, frame.duracionMs) !== null) {
        if (primera < 0) primera = i;
        cuantas++;
      }
    });
    // La referencia es el frame 0; a 60 Hz 500 ms son 30 frames.
    expect(primera).toBeGreaterThanOrEqual(29);
    expect(primera).toBeLessThanOrEqual(31);
    expect(cuantas).toBe(5); // 3 s / 0,5 s = 6 ventanas, la primera se abre con el frame 0 y la ultima no llega a cerrar
  });

  it('el cambio de texto es de unas 2 veces por segundo, no una por frame', () => {
    const medidor = crearMedidorDeFps();
    let textos = 0;
    for (const frame of serie(600, 1000 / 60)) {
      const lectura = medidor.registrar(frame.t, frame.duracionMs);
      if (lectura !== null) textos++;
    }
    // 10 s a 60 Hz: ~20 lecturas contra 600 frames.
    expect(textos).toBeLessThanOrEqual(21);
    expect(textos).toBeGreaterThanOrEqual(18);
  });
});

describe('contador de fps: peor frame de la ventana', () => {
  it('con todos los frames sanos el peor es el frame real (17 ms), no el del reloj cuantizado (21 ms)', () => {
    const leidas = lecturas(serie(300, 1000 / 60));
    for (const lectura of leidas) {
      expect(lectura.peorMs).toBeCloseTo(16.67, 1);
      expect(formatearLecturaFps(lectura)).toBe('60 fps · 17 ms max');
    }
  });

  it('un tiron aparece en la ventana en que ocurre y no en la siguiente', () => {
    // Un frame de 183 ms (como el tiron del proceso de GPU) en el frame 100.
    const frames = serie(240, 1000 / 60, BLOQUES_MS[0], { indice: 100, ms: 183 });
    const leidas = lecturas(frames);
    const conTiron = leidas.filter((l) => l.peorMs > 100);
    expect(conTiron).toHaveLength(1);
    expect(Math.round(conTiron[0]!.peorMs)).toBe(183);
    // El promedio de esa ventana baja (183 ms de un frame no es 60 fps) y las otras siguen en 60.
    expect(conTiron[0]!.fps).toBeLessThan(60);
    const sanas = leidas.filter((l) => l.peorMs <= 100);
    expect(sanas.length).toBeGreaterThanOrEqual(5);
    for (const lectura of sanas) expect(Math.round(lectura.fps)).toBe(60);
  });

  it('el frame de duracion desconocida (0) no cuenta como peor ni como mejor', () => {
    const medidor = crearMedidorDeFps();
    let ultima: LecturaFps | null = null;
    for (const frame of serie(120, 1000 / 60)) {
      ultima = medidor.registrar(frame.t, frame.duracionMs) ?? ultima;
    }
    expect(ultima!.peorMs).toBeGreaterThan(16);
  });
});

describe('contador de fps: pausas, saltos y valores raros', () => {
  it('reiniciar descarta la ventana en curso: el frame siguiente es la referencia', () => {
    const medidor = crearMedidorDeFps();
    for (const frame of serie(20, 1000 / 60)) medidor.registrar(frame.t, frame.duracionMs);
    medidor.reiniciar();
    // Despues de una pausa de 5 s de reloj de pared, el reloj de juego vuelve donde estaba: sin lectura espuria.
    expect(medidor.registrar(400, 5000)).toBeNull();
    let lectura: LecturaFps | null = null;
    for (let i = 1; i <= 40; i++) lectura = medidor.registrar(400 + i * (1000 / 60), 1000 / 60) ?? lectura;
    expect(lectura).not.toBeNull();
    expect(lectura!.peorMs).toBeCloseTo(16.67, 1);
    expect(Math.round(lectura!.fps)).toBe(60);
  });

  it('si el reloj va hacia atras (seek) abre una ventana nueva en vez de dar fps negativos', () => {
    const medidor = crearMedidorDeFps();
    medidor.registrar(10_000, 16.7);
    medidor.registrar(10_017, 16.7);
    expect(medidor.registrar(2_000, 16.7)).toBeNull();
    const lectura = medidor.registrar(2_600, 16.7);
    expect(lectura).not.toBeNull();
    expect(lectura!.fps).toBeGreaterThan(0);
  });

  it('ignora tiempos no finitos y duraciones absurdas (una pausa entera no es un frame)', () => {
    const medidor = crearMedidorDeFps();
    expect(medidor.registrar(Number.NaN, 16)).toBeNull();
    expect(medidor.registrar(Number.POSITIVE_INFINITY, 16)).toBeNull();
    medidor.registrar(0, 0);
    medidor.registrar(250, 60_000);
    const lectura = medidor.registrar(500, 16.7);
    expect(lectura).not.toBeNull();
    expect(lectura!.peorMs).toBeCloseTo(16.7, 1);
  });

  it('una ventana que dura mucho mas de 500 ms (frames lentos) sigue dando un promedio correcto', () => {
    // Frames cada 100 ms (10 fps): la ventana cierra al sexto frame, con 6 frames en 600 ms.
    const medidor = crearMedidorDeFps();
    let lectura: LecturaFps | null = null;
    for (let i = 0; i <= 10; i++) lectura = medidor.registrar(i * 100, 100) ?? lectura;
    expect(lectura).not.toBeNull();
    expect(Math.round(lectura!.fps)).toBe(10);
  });

  it('la ventana por defecto es de 500 ms', () => {
    expect(VENTANA_FPS_MS).toBe(500);
  });
});

describe('formato del contador', () => {
  it('"60 fps · 22 ms max", enteros', () => {
    expect(formatearLecturaFps({ fps: 59.6, peorMs: 21.5 })).toBe('60 fps · 22 ms max');
    expect(formatearLecturaFps({ fps: 143.6, peorMs: 7.2 })).toBe('144 fps · 7 ms max');
    expect(formatearLecturaFps({ fps: 31, peorMs: 183.4 })).toBe('31 fps · 183 ms max');
  });
});
