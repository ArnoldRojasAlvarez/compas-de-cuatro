# T-004 · Pista, entrada de teclado y bucle de juego

| | |
|---|---|
| **Fase** | 1 · Nucleo jugable |
| **Modelo** | Sonnet |
| **Rama** | `feat/playfield` |
| **Depende de** | T-001 (reloj), T-003 (motor de juicio) |
| **Cierra** | La fase 1 |

## Contexto

Es la pieza que junta todo y la primera que se puede ver. Al terminar este
ticket se abre el navegador, suena una pista, caen notas, se pulsan teclas y
sale una pantalla de resultados. Sin menus: eso es fase 3.

Es tambien el ticket donde se cobra la deuda de T-001. La prueba de deriva que
corre en vitest es sintetica; aca entra audio de verdad y se puede ver si el
sistema completo se siente sincronizado.

## Contrato

### Render

```ts
// packages/engine/src/playfield.ts
import type { Chart, Column, Judgement, Ms } from '@tetra/core';

export interface PlayfieldOptions {
  /** Cuantos ms de pista se ven de golpe. Menor valor, notas mas rapidas. */
  scrollDuration: Ms;
  /** Alto del area de juego en pixeles. */
  height: number;
  /** Ancho de cada carril en pixeles. */
  columnWidth: number;
  /** Distancia del receptor al borde inferior, en pixeles. */
  receptorOffset: number;
}

export interface Playfield {
  /** Dibuja el estado en el tiempo dado. Se llama una vez por frame. */
  render(time: Ms): void;

  /** Efecto visual al juzgar una nota. */
  showJudgement(column: Column, judgement: Judgement): void;

  /** Ilumina o apaga el receptor de una columna. */
  setPressed(column: Column, pressed: boolean): void;

  resize(width: number, height: number): void;

  destroy(): void;
}

export function createPlayfield(
  app: import('pixi.js').Application,
  chart: Chart,
  options: PlayfieldOptions,
): Playfield;
```

### Entrada

```ts
// packages/engine/src/input.ts
import type { Column, Ms } from '@tetra/core';

export interface InputEvent {
  time: Ms;
  column: Column;
  type: 'down' | 'up';
}

export interface InputSource {
  /**
   * Devuelve los eventos acumulados desde la llamada anterior, en orden
   * cronologico, y vacia la cola.
   * Array reusado: leerlo y soltarlo, no guardarlo.
   */
  drain(): readonly InputEvent[];

  /** Cambia el mapeo de teclas. Por defecto D, F, J, K. */
  setKeyMap(keys: readonly [string, string, string, string]): void;

  destroy(): void;
}

/**
 * `toGameTime` convierte el `timeStamp` del evento de teclado al tiempo del
 * reloj de audio. Se inyecta para poder probar sin navegador.
 */
export function createKeyboardInput(
  target: EventTarget,
  toGameTime: (eventTimeStamp: number) => Ms,
): InputSource;
```

## El punto critico: el tiempo de la pulsacion

**No se usa el momento en que corre el handler.** Se usa `event.timeStamp`,
que marca cuando ocurrio la pulsacion de verdad. Entre una cosa y la otra hay
varios milisegundos de cola de eventos, y en un juego donde la ventana mas
estricta son 16.5 ms, eso es un tercio de la ventana.

`event.timeStamp` viene en la base de tiempo de `performance`, no en la del
audio. La conversion es responsabilidad de `toGameTime`, que la capa de arriba
arma asi:

```
toGameTime(ts) = clock.now() - (performance.now() - ts)
```

Es decir: cuanto hace que ocurrio el evento, restado del tiempo de juego
actual. Esta es **la unica** lectura de `performance.now()` permitida en todo
el proyecto, y va acompañada de un `eslint-disable-next-line` con este ticket
citado como justificacion. No se usa para medir el paso del tiempo, solo para
medir la antiguedad de un evento.

## Posicion de las notas

```
progreso = (nota.time - tiempoActual) / scrollDuration
y = receptorY - progreso * (alto util)
```

Una nota con `progreso = 0` esta sobre el receptor. Con `progreso = 1` esta
entrando por arriba. Las notas con `progreso` fuera de `[-0.1, 1.1]` no se
dibujan.

Las LN se dibujan como un cuerpo estirado entre cabeza y cola, con el cuerpo
recortado al receptor mientras se sostiene.

**Los cambios de velocidad (SV) quedan fuera de este ticket.** Se asume
multiplicador 1 en toda la pista. Va en fase 2, con el importador.

## Rendimiento

Con 3500 notas no se pueden crear 3500 sprites.

- **Pooling.** Un pool de sprites por columna. Una nota que sale de pantalla
  devuelve su sprite al pool.
- **Culling.** Solo se recorre la ventana de notas visibles, con punteros de
  inicio y fin que avanzan monotonicamente. Nada de filtrar el array completo
  cada frame.
- Objetivo: **60 fps estables** con el mapa mas denso disponible, en una
  maquina normal.

## Bucle de juego

```ts
// apps/web/src/game.ts
export function runGame(chart: Chart, audio: AudioBuffer): Promise<ScoreState>;
```

Por frame, en este orden exacto:

1. `const t = clock.now()`
2. `for (const ev of input.drain())` y despachar a `engine.press` / `engine.release`
3. `engine.update(t)` y mostrar los juicios que salgan
4. `playfield.render(t)`
5. Actualizar el HUD: score, combo, precision, y el contador de fps y ms

El orden importa. Si se dibuja antes de procesar la entrada, se pierde un
frame de respuesta.

La promesa resuelve cuando `engine.finished` es `true` o cuando el audio
termina, lo que ocurra primero.

## Pantalla de resultados

Al terminar: juicios por tipo, precision, combo maximo, score y un grafico
simple de la desviacion de cada golpe en el tiempo, que es lo que le sirve a
un jugador para saber si va temprano o tarde. DOM plano, sin Pixi.

## Criterios de aceptacion

- [ ] El tiempo de la pulsacion sale de `event.timeStamp`, nunca del momento
      del handler
- [ ] Mantener una tecla pulsada genera un solo `down`, no repeticion automatica
- [ ] Pulsar dos teclas en el mismo frame genera dos eventos en orden
- [ ] `drain()` devuelve los eventos en orden cronologico y deja la cola vacia
- [ ] Con 3500 notas, la cantidad de sprites vivos se mantiene acotada y no
      crece con el largo del mapa
- [ ] Una nota con `progreso` 0 se dibuja centrada en el receptor
- [ ] `destroy()` quita los listeners: no quedan fugas al salir de la partida
- [ ] Cambiar `scrollDuration` en caliente reposiciona las notas sin reiniciar

## Tests

- **Unitarios** de `input.ts` con un `EventTarget` falso y un `toGameTime`
  controlado: no hace falta navegador.
- **Unitarios** del calculo de posicion: es aritmetica pura, sacala a una
  funcion exportada para poder probarla sin Pixi.
- **E2E con Playwright**, que es lo que cobra la deuda de T-001:
  1. Cargar la pagina con un mapa de prueba
  2. Dejar correr 60 segundos de audio real
  3. Comparar `clock.now()` contra `audioContext.currentTime` cada segundo
  4. La diferencia se mantiene bajo 5 ms

  Si Playwright no se puede montar en este ticket, **hay que decirlo
  explicitamente en el reporte** y abrir la deuda como ticket aparte. No se
  cierra en silencio.

## Prueba de feel (Arnold)

Ningun assert cubre esto. Jugar un mapa completo y responder:

- Las notas caen donde suenan?
- El receptor responde al instante o se siente pegajoso?
- La desviacion promedio del grafico de resultados esta centrada en cero, o
  hay un sesgo constante que delata un offset mal calculado?

Esta prueba puede rechazar el PR con la CI en verde.

## Terminado cuando

Los cuatro checks en verde, el e2e de deriva pasando o su deuda declarada,
revision de Opus aprobada, prueba de feel de Arnold y squash merge a `main`.
