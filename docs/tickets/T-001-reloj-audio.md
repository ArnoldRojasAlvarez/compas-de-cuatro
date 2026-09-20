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

  /** Salta a una posicion. Usado por el editor y por el modo practica. */
  seek(time: Ms): void;

  readonly isRunning: boolean;

  /** Duracion total de la pista en ms. */
  readonly duration: Ms;

  /**
   * Compensacion total aplicada a `now()`, en ms.
   * Suma de la latencia de salida reportada por el navegador y del offset
   * que el usuario calibro a mano.
   */
  offset: Ms;
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
5. `offset` se recalcula cuando cambia `userOffset` o cuando el navegador
   reporta `outputLatency`. Si `outputLatency` viene `undefined` o `0`, se
   ignora y solo cuenta el offset del usuario.

## Criterios de aceptacion

- [ ] `now()` nunca lee `performance.now()`, `Date.now()` ni acumula deltas de `rAF`
- [ ] Antes de `start()`, `now()` devuelve `0`
- [ ] Con `leadIn = 2000`, justo despues de `start()` el valor es cercano a `-2000`
      y crece hacia `0`
- [ ] `seek(30000)` deja `now()` en un valor cercano a `30000` dentro de 5 ms
- [ ] Cambiar `offset` mueve `now()` en esa misma cantidad, de inmediato
- [ ] `stop()` congela el valor; llamar `now()` despues no sigue avanzando
- [ ] Llamar `start()` dos veces seguidas no deja dos sources sonando a la vez
- [ ] `seek()` con el reloj detenido cambia la posicion sin arrancar el audio

## Prueba de deriva (la que importa)

Test automatizado con un tono de 3 minutos que lleva un click cada 500 ms:

1. Se arranca el reloj.
2. Cada 10 segundos se compara `clock.now()` contra la posicion real del
   audio, calculada desde el buffer.
3. **La deriva acumulada a los 3 minutos debe ser menor a 5 ms.**

Si esta prueba no pasa, el ticket no se cierra. No se negocia el umbral.

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
