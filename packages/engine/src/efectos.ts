// T-020: aritmetica pura de los efectos de la pista (flash de golpe, animacion
// del juicio y color de nota del fallback).
//
// Igual que position.ts: nada de Pixi ni de DOM, solo funciones sobre numeros,
// para poder probarlas en vitest sin renderer. playfield.ts las llama desde
// render(), asi que ninguna aloca (salvo `animacionJuicio`, ver abajo).

/** Cuanto tarda el flash de una columna en apagarse despues de soltar la tecla. */
export const DECAY_FLASH_MS = 120;

/**
 * Alpha del flash de una columna: 1 mientras esta pulsada; al soltar decae
 * linealmente a 0 en `DECAY_FLASH_MS`. Con `msDesdeSoltar < 0` (todavia no se
 * soltio, o el reloj retrocedio) se devuelve 1.
 */
export function alphaFlash(pulsada: boolean, msDesdeSoltar: number): number {
  if (pulsada || msDesdeSoltar < 0) return 1;
  if (msDesdeSoltar >= DECAY_FLASH_MS) return 0;
  return 1 - msDesdeSoltar / DECAY_FLASH_MS;
}

// ---------------------------------------------------------------------------
// Animacion del juicio
// ---------------------------------------------------------------------------

/** Escala con la que aparece el juicio; baja linealmente a 1 en `POP_JUICIO_MS`. */
export const ESCALA_POP_JUICIO = 1.15;
/** Duracion del "pop" inicial del juicio (de `ESCALA_POP_JUICIO` a 1). */
export const POP_JUICIO_MS = 80;
/** Fraccion de la duracion total en la que el juicio se sostiene a alpha 1 antes de desvanecerse. */
export const FRACCION_SOSTENIDO_JUICIO = 0.5;

/**
 * Escala del juicio segun los ms desde que aparecio: `ESCALA_POP_JUICIO` en 0,
 * baja linealmente a 1 en `POP_JUICIO_MS` y se queda en 1. Fuera de
 * `[0, duracion)` vale 1 (el juicio ya no se ve, ver `alphaJuicio`).
 */
export function escalaJuicio(msDesdeAparicion: number, duracion: number): number {
  if (msDesdeAparicion < 0 || msDesdeAparicion >= duracion) return 1;
  if (msDesdeAparicion >= POP_JUICIO_MS) return 1;
  return ESCALA_POP_JUICIO - (ESCALA_POP_JUICIO - 1) * (msDesdeAparicion / POP_JUICIO_MS);
}

/**
 * Alpha del juicio segun los ms desde que aparecio: 1 durante el pop y el
 * sostenido (`FRACCION_SOSTENIDO_JUICIO` de la duracion), luego baja
 * linealmente a 0 al llegar a `duracion`. Fuera de `[0, duracion)` vale 0.
 */
export function alphaJuicio(msDesdeAparicion: number, duracion: number): number {
  if (msDesdeAparicion < 0 || msDesdeAparicion >= duracion) return 0;
  const inicioDesvanecido = duracion * FRACCION_SOSTENIDO_JUICIO;
  if (msDesdeAparicion <= inicioDesvanecido) return 1;
  return 1 - (msDesdeAparicion - inicioDesvanecido) / (duracion - inicioDesvanecido);
}

export interface AnimacionJuicio {
  escala: number;
  alpha: number;
}

/**
 * Las dos cosas juntas, para tests y para codigo fuera del loop de juego.
 * Devuelve un objeto nuevo por llamada, asi que el camino caliente
 * (playfield.render) NO la usa: llama a `escalaJuicio` y `alphaJuicio` por
 * separado, que devuelven numeros y no alocan.
 */
export function animacionJuicio(msDesdeAparicion: number, duracion: number): AnimacionJuicio {
  return {
    escala: escalaJuicio(msDesdeAparicion, duracion),
    alpha: alphaJuicio(msDesdeAparicion, duracion),
  };
}

// ---------------------------------------------------------------------------
// Color de nota (fallback sin skin)
// ---------------------------------------------------------------------------

/** Tinta de la paleta (`--tinta`): notas de las columnas exteriores. */
export const COLOR_NOTA_EXTERIOR = 0xe7eef0;
/** Acento de la paleta (`--acento`): notas de las columnas interiores. */
export const COLOR_NOTA_INTERIOR = 0x3fd8c2;

/**
 * Color de la nota en el fallback sin skin, con el patron clasico de 4K:
 * columnas exteriores (0 y 3) en tinta, interiores (1 y 2) en acento. Misma
 * convencion exterior/interior que `imagenDeSkin` (skin.ts).
 */
export function colorDeNota(columna: number): number {
  const exterior = columna === 0 || columna === 3;
  return exterior ? COLOR_NOTA_EXTERIOR : COLOR_NOTA_INTERIOR;
}
