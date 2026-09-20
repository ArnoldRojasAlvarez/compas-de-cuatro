# T-002 · Ventanas de juicio por OD

| | |
|---|---|
| **Fase** | 1 · Nucleo jugable |
| **Modelo** | Sonnet |
| **Rama** | `feat/judge-windows` |
| **Depende de** | nada. Se puede hacer en paralelo con T-001 |

## Contexto

Las ventanas de juicio definen cuanto margen tiene el jugador para acertar una
nota. Se copian las de osu!mania porque son las que la mano de Arnold ya tiene
aprendidas despues de años jugando: cambiarlas haria que el juego se sintiera
mal aunque fuera tecnicamente correcto.

Son funciones puras sobre numeros, asi que este es el primer codigo del
proyecto que se puede probar sin navegador ni audio.

## Contrato

```ts
// packages/core/src/judge/windows.ts
import type { Ms, HitWindows, Judgement } from '../types.js';

/**
 * Calcula los semianchos de las ventanas para un OD dado.
 * `max` es fijo en 16.5 ms. El resto sigue `base - 3 * od`.
 */
export function windowsForOD(od: number): HitWindows;

/**
 * Clasifica una desviacion. `error` positivo es tarde, negativo temprano.
 * Devuelve null si la nota esta fuera incluso de la ventana de miss, es decir
 * si todavia no le toca ser juzgada.
 */
export function judge(error: Ms, windows: HitWindows): Judgement | null;
```

## Constantes

| Juicio | osu! | Formula | Con OD 7.3 |
|---|---|---|---|
| `max` | 320 | `16.5` fijo | 16.5 |
| `perfect` | 300 | `64 - 3 * od` | 42.1 |
| `great` | 200 | `97 - 3 * od` | 75.1 |
| `good` | 100 | `127 - 3 * od` | 105.1 |
| `bad` | 50 | `151 - 3 * od` | 129.1 |
| `miss` | 0 | `188 - 3 * od` | 166.1 |

OD 7.3 es el del mapa de referencia (`Gumbarizo!`, Hidden's Festival).

## Criterios de aceptacion

- [ ] `windowsForOD(7.3)` devuelve los seis valores de la tabla, con tolerancia
      de 0.01 ms
- [ ] `windowsForOD` acepta OD de 0 a 10. Fuera de ese rango, lanza `RangeError`
- [ ] `max` vale 16.5 para cualquier OD
- [ ] Las ventanas son monotonas: `max < perfect < great < good < bad < miss`
      para todo OD valido
- [ ] `judge(0, w)` devuelve `'max'`
- [ ] `judge(16.5, w)` devuelve `'max'` y `judge(16.6, w)` devuelve `'perfect'`
      (el borde pertenece a la ventana mas estricta)
- [ ] `judge(-42, w)` con OD 7.3 devuelve `'perfect'`: el signo no cambia el juicio
- [ ] `judge(200, w)` devuelve `null`, no `'miss'`
- [ ] Ninguna de las dos funciones reserva memoria en el camino caliente:
      `judge` no crea objetos ni arrays

## Tests

Archivo `packages/core/src/judge/windows.test.ts`. Como minimo:

1. Tabla de valores exactos para OD 0, 5, 7.3 y 10
2. Monotonia verificada en bucle para OD de 0 a 10 en pasos de 0.1
3. Cada borde exacto de cada ventana, por arriba y por abajo, en positivo y en
   negativo
4. `RangeError` para OD -1 y 11

## Nota de implementacion

`judge` se llama una vez por tecla pulsada, o sea hasta veinte veces por
segundo en un mapa denso. Debe ser una cadena de comparaciones sobre
`Math.abs(error)`, sin `Object.entries`, sin `find`, sin `sort`.

## Terminado cuando

CI en verde, cobertura del archivo sobre 95%, revision de Opus aprobada y
squash merge a `main`.
