# T-001 · Reloj de audio

| | |
|---|---|
| **Fase** | 1 · Nucleo jugable |
| **Modelo** | Sonnet |
| **Rama** | `feat/audio-clock` |
| **Bloquea a** | T-003 (pista), T-004 (entrada), y todo lo demas |

## Por que este ticket decide el proyecto

Es el riesgo critico. Si el reloj se desfasa, el juego es injugable y no hay
nada que construir encima. Se hace primero justamente para descubrirlo ya, con
una pantalla fea, y no en noviembre con toda la UI encima.

Si este ticket no se puede cerrar con la tolerancia que pide, el proyecto se
detiene y se evalua migrar a osu!framework antes de escribir nada mas.

## Contexto

El navegador tiene dos relojes que no van juntos:

- `requestAnimationFrame` corre a la frecuencia del monitor (60, 144, 240 Hz).
- El audio corre con el reloj del hardware de sonido.

Si se dibuja contra `rAF` y se reproduce contra el audio, la diferencia se
acumula. A los tres minutos es audible. La unica salida es que **todo** se
derive del reloj del audio.

## Contrato

```ts
// packages/audio/src/clock.ts

export interface AudioClock {
  /**
   * Posicion actual dentro de la pista, en ms desde el inicio del audio.
   * Es la unica fuente de verdad temporal del juego.
   * Devuelve valores negativos durante la cuenta regresiva previa.
   */
  now(): Ms;

  /** Arranca la reproduccion. `leadIn` ms de silencio antes del tiempo 0. */
  start(leadIn: Ms): void;

  stop(): void;

  /**
   * Salta a una posicion. Usado por el editor y por el modo practica.
   *
   * Justo despues de `seek(time)`, `now()` vale `time - offset`, no `time`:
   * lo que se oye en ese instante todavia se programo hace `outputLatency`,
   * entonces el tiempo de juego tiene que ir atrasado respecto al buffer.
   */
  seek(time: Ms): void;

  readonly isRunning: boolean;

  /** Duracion total de la pista en ms. */
  readonly duration: Ms;

  /** Offset manual del usuario, en ms. Se puede cambiar en caliente. */
  userOffset: Ms;

  /** Latencia de salida detectada, en ms. Solo lectura. */
  readonly outputLatency: Ms;

  /**
   * Compensacion total aplicada a `now()`, en ms.
   * Derivada: `userOffset + outputLatency`. De solo lectura para que no se
   * pueda pisar por accidente y perder la latencia calculada: para cambiar
   * la parte que corresponde al usuario se escribe `userOffset`.
   */
  readonly offset: Ms;
}

export interface ClockOptions {
  /** Offset manual del usuario, de config. Positivo retrasa las notas. */
  userOffset?: Ms;
  /**
   * Si es true, usa `audioContext.outputLatency` cuando el navegador lo
   * reporta. Por defecto true.
   */
  useOutputLatency?: boolean;
}

export function createAudioClock(
  ctx: AudioContext,
  buffer: AudioBuffer,
  options?: ClockOptions,
): AudioClock;
```

## Como se implementa

1. Se reproduce con un `AudioBufferSourceNode`. Nada de `<audio>`: no da
   precision suficiente y su `currentTime` va a saltos.
2. Al arrancar se guarda `startedAt = ctx.currentTime + leadIn / 1000`.
3. `now()` devuelve `(ctx.currentTime - startedAt) * 1000 - offset`.
4. `seek(t)` para el source actual, crea uno nuevo con
   `source.start(0, t / 1000)` y recalcula `startedAt`.
5. `offset` es derivado, de solo lectura: se recalcula solo con leer
   `userOffset + outputLatency`. `outputLatency` se calcula una vez, al
   construir el reloj, a partir de `ctx.outputLatency`. Si viene
   `undefined` o `0`, se ignora y `outputLatency` queda en `0`. `userOffset`
   si se puede cambiar en caliente despues de construido el reloj.

## Criterios de aceptacion

- [ ] `now()` nunca lee `performance.now()`, `Date.now()` ni acumula deltas de `rAF`
- [ ] Antes de `start()`, `now()` devuelve `0`
- [ ] Con `leadIn = 2000`, justo despues de `start()` el valor es cercano a `-2000`
      y crece hacia `0`
- [ ] `seek(30000)` deja `now()` en `30000 - offset`, dentro de 5 ms (con un
      offset distinto de cero: justo despues del seek todavia se esta
      oyendo el audio anterior, asi que el tiempo de juego va atrasado
      respecto al buffer, ver H3 de T-001-F1)
- [ ] Cambiar `userOffset` mueve `now()` en esa misma cantidad, de inmediato,
      y `offset` siempre refleja `userOffset + outputLatency`
- [ ] `stop()` congela el valor; llamar `now()` despues no sigue avanzando
- [ ] Llamar `start()` dos veces seguidas no deja dos sources sonando a la vez
- [ ] `seek()` con el reloj detenido cambia la posicion sin arrancar el audio

## Prueba de deriva

**Corregido despues de la revision. La version original de esta seccion pedia
un test que no podia fallar:** comparaba `clock.now()` contra
`ctx.currentTime * 1000` con `startedAt` y `offset` en cero, o sea la misma
expresion de los dos lados. Daba 0 ms siempre, incluso con la implementacion
rota. Ver H1 de `T-001-F1-correcciones.md`.

La deriva real es la del renderizador contra el hardware de audio, y esa solo
se puede medir en un navegador de verdad. **Queda para el ticket de e2e de la
fase 1**, no para vitest.

Lo que si se prueba en vitest es la razon de fondo por la que `now()` no se
desincroniza. El doble de prueba avanza con pasos irregulares (jitter) durante
3 minutos simulados, y el test verifica dos cosas a la vez:

1. `clock.now()` se mantiene a menos de 5 ms de la posicion real del audio.
2. Un contador ingenuo que suma un delta nominal fijo por frame **si** se
   despega, por mas de 5 ms.

La segunda asercion es la que le da valor a la primera: si el contador ingenuo
no se despegara, el escenario no seria representativo y habria que subir el
jitter. Con el patron actual el contador ingenuo se va unos 7.5 segundos.

## Prueba de feel (Arnold)

Cuando el test pase, hace falta una verificacion humana que ningun assert
cubre: jugar un mapa completo y sentir si las notas caen donde suenan. Esta
prueba puede rechazar el PR aunque la CI este en verde.

## Fuera de alcance

- Calibracion interactiva del offset (es T-010, fase 3)
- Precarga y cache de audio (es T-005)
- Espectro para el logo animado (es T-020, fase 3)

## Terminado cuando

CI en verde, prueba de deriva pasando, revision de Opus aprobada y squash
merge a `main`.
