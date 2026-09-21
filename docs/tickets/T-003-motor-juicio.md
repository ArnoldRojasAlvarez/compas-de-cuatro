# T-003 · Motor de juicio y score

| | |
|---|---|
| **Fase** | 1 · Nucleo jugable |
| **Modelo** | Sonnet |
| **Rama** | `feat/judge` (la misma de T-002) |
| **Depende de** | T-002, las ventanas |
| **Bloquea a** | T-004, la pista |

## Contexto

Es el corazon del juego y es logica pura: entra un mapa y una secuencia de
pulsaciones con su tiempo, sale una lista de juicios y un estado de score.
Vive en `core`, no toca el navegador y se prueba entero sin audio ni render.

Se llama varias veces por frame, asi que el camino caliente no puede reservar
memoria.

## Contrato

```ts
// packages/core/src/judge/engine.ts
import type { Chart, Column, HitResult, Ms, ScoreState } from '../types.js';

export interface JudgeEngine {
  /**
   * Procesa una pulsacion en una columna.
   * Devuelve el juicio, o `null` si no habia ninguna nota juzgable cerca
   * (pulsacion al aire: no penaliza, solo se ignora).
   */
  press(time: Ms, column: Column): HitResult | null;

  /**
   * Procesa una soltada. Solo importa si hay una LN sostenida en esa columna.
   * Devuelve el juicio de la cola, o `null` si no habia LN activa.
   */
  release(time: Ms, column: Column): HitResult | null;

  /**
   * Marca como miss todo lo que ya se paso de su ventana. Se llama una vez
   * por frame, antes de dibujar.
   * IMPORTANTE: devuelve un array reusado internamente. Quien lo recibe lo
   * lee y lo suelta, no lo guarda.
   */
  update(time: Ms): readonly HitResult[];

  readonly state: ScoreState;

  /** true cuando ya se juzgaron todas las notas del mapa. */
  readonly finished: boolean;

  /** true si el HP llego a 0. */
  readonly failed: boolean;
}

export function createJudgeEngine(chart: Chart): JudgeEngine;
```

## Reglas de juicio

### Emparejar pulsacion con nota

Al recibir `press(t, c)`, se busca **la nota sin juzgar mas temprana de la
columna `c`** cuyo `|t - nota.time|` sea menor o igual a `windows.miss`.

- Si la hay, se juzga con `judge(error, windows)` de T-002.
- Si no la hay, se devuelve `null`. Una pulsacion al aire no penaliza.

Nunca se salta una nota para juzgar una posterior: siempre se toma la mas
temprana pendiente de esa columna.

### Notas largas

- La **cabeza** se juzga igual que una nota simple, en `press`.
- La **cola** se juzga en `release`, con las ventanas multiplicadas por
  **1.5**. Soltar una LN es menos preciso que pulsarla y castigarlo igual
  se siente injusto.
- Si se suelta antes de entrar a la ventana de la cola, la cola cuenta `miss`.
- Si la cabeza fue `miss`, la cola tambien cuenta `miss` y la LN no se puede
  recuperar sosteniendo.

### Miss por tiempo

En `update(t)`, toda nota sin juzgar con `t > nota.time + windows.miss` pasa a
`miss`. Para una LN, si la cabeza pasa a `miss` por tiempo, la cola tambien.

## Score, precision y HP

### Precision

Formula de osu!mania, con los pesos por juicio:

```
peso = { max: 320, perfect: 300, great: 200, good: 100, bad: 50, miss: 0 }
accuracy = suma(peso de cada juicio) / (320 * cantidad de juicios)
```

Con cero juicios emitidos, `accuracy` vale `1`.

### Score

**Version 1, deliberadamente simple:** proporcional a la precision, con un
maximo de 1 000 000.

```
score = floor(1_000_000 * suma(peso) / (320 * totalJuicios del mapa))
```

Donde `totalJuicios del mapa` cuenta 1 por nota simple y 2 por LN (cabeza y
cola). El bono por combo queda para un ticket posterior: meterlo ahora
complica el modelo antes de que sepamos si el juego se siente bien.

### Combo

Sube con todo salvo `miss` y `bad`. Se rompe con `miss` y con `bad`.
`maxCombo` guarda el maximo alcanzado.

### HP

Empieza en `1`. Cada juicio suma o resta, y despues se acota a `[0, 1]`:

| Juicio | Cambio |
|---|---|
| `max` | `+0.005` |
| `perfect` | `+0.004` |
| `great` | `+0.002` |
| `good` | `0` |
| `bad` | `-0.010 * (1 + hpDrain / 10)` |
| `miss` | `-0.040 * (1 + hpDrain / 10)` |

Cuando llega a 0, `failed` pasa a `true` y se queda asi. El motor **no** deja
de juzgar al fallar: quien decide si corta la partida es la capa de arriba.

Estos numeros son de arranque y se van a ajustar cuando Arnold juegue. Ponelos
en una constante exportada, `HP_DELTAS`, para que se puedan tocar sin buscar
por todo el archivo.

## Rendimiento

- Un puntero por columna al indice de la proxima nota pendiente. Nada de
  recorrer el array entero en cada `press`.
- `press` y `release` no crean objetos salvo el `HitResult` que devuelven.
- `update` reusa el mismo array de salida: lo vacia con `length = 0`, no con
  `[]`.
- Con un mapa de 3500 notas, procesar la partida completa debe tardar menos
  de 50 ms.

## Criterios de aceptacion

- [ ] `press` exacto sobre una nota devuelve `max` y sube el combo
- [ ] `press` al aire devuelve `null`, no cambia el estado y no rompe el combo
- [ ] Dos `press` seguidos en la misma columna juzgan dos notas distintas,
      nunca la misma dos veces
- [ ] `press` en la columna 0 no juzga una nota de la columna 1
- [ ] Una nota que pasa su ventana de miss aparece en el `update` siguiente
      con juicio `miss`, una sola vez
- [ ] La cola de una LN usa ventanas 1.5 veces mas anchas que la cabeza
- [ ] Soltar una LN demasiado temprano da `miss` en la cola
- [ ] Cabeza en `miss` fuerza cola en `miss`
- [ ] `bad` rompe el combo
- [ ] Con todo en `max`, `accuracy` da `1` y `score` da `1000000`
- [ ] Con todo en `miss`, `accuracy` da `0`, `score` da `0` y `failed` es `true`
- [ ] Mapa mixto: la precision coincide con la formula calculada a mano
- [ ] `finished` pasa a `true` solo cuando se juzgo hasta la ultima nota
- [ ] El HP se acota: nunca pasa de 1 ni baja de 0
- [ ] `update` llamado dos veces con el mismo tiempo no emite el mismo miss dos veces

## Tests

En `packages/core/src/judge/engine.test.ts`. Armá los mapas de prueba con un
helper local que construya `Chart` a mano, no leas archivos.

Incluí un test de rendimiento: mapa generado de 3500 notas, partida completa
simulada, por debajo de 50 ms.

## Terminado cuando

Los cuatro checks en verde, cobertura de `judge/` sobre 90%, revision de Opus
aprobada y squash merge a `main`.
