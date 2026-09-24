# T-013 · Motor de dificultad: vector de siete skillsets

| | |
|---|---|
| **Fase** | 4 · Motor de dificultad |
| **Modelo** | Sonnet |
| **Rama** | `feat/dificultad` |
| **Depende de** | el contrato de `core/types.ts` (`Row`, `Skillset`, `SkillVector`, `DifficultyResult`) |
| **Bloquea a** | T-014 (estrellas en el song select, worker, calibracion) |

## La idea de fondo, que viene de Arnold

Un solo numero no alcanza para describir la dificultad de un mapa de mania. Un
5.29 de patron limpio se le hace mas facil a un jugador que un 4.8 lleno de
chordjacks, porque son habilidades distintas. Por eso el motor calcula **un
valor por habilidad** (el vector de siete) y la estrella global es **el maximo
del vector**. La UI (T-014) muestra el perfil completo, no solo el maximo.

Este ticket construye el motor en `core`: funcion pura, sin navegador. La
integracion con la UI, el Web Worker y la calibracion contra mapas reales de
osu! son T-014.

## Contrato

```ts
// packages/core/src/difficulty/index.ts
import type { Chart, DifficultyResult, Note, Row } from '../types.js';

/** Agrupa notas simultaneas en filas. Entrada ordenada por tiempo. */
export function construirFilas(notes: readonly Note[]): Row[];

/** Calcula el vector de siete skillsets y la estrella global. Pura y determinista. */
export function calcularDificultad(chart: Chart): DifficultyResult;

/** Todas las constantes del modelo, en un solo lugar, para poder calibrarlas. */
export const PARAMETROS_DIFICULTAD: { /* ver abajo */ };
```

Exportar desde `packages/core/src/index.ts`. No tocar `types.ts`.

## Paso 1: filas

Una fila junta las notas que caen en el mismo instante. Tolerancia de **1 ms**
(los mapas de osu! ponen los acordes en el mismo milisegundo exacto, pero
conviene tolerar redondeos). La cabeza de una nota larga cuenta como nota de su
fila. El cuerpo y la suelta de las LN quedan **fuera de esta version** (deuda
declarada: dificultad de LN).

## Paso 2: una pasada sobre las filas

Para cada fila `i` (desde la segunda):

- `dt` = tiempo desde la fila anterior, en ms, **acotado abajo a 25 ms** (para
  que grace notes no hagan explotar las divisiones).
- `v = 1000 / dt`: velocidad de filas, en filas por segundo.
- Para cada columna `c`, `ultimoGolpe[c]`: tiempo de la ultima fila que la uso.
- `columnasJack`: columnas de esta fila que tambien estaban en la fila anterior.
- Para cada columna jackeada, `dc = tiempo - ultimoGolpe[c]`.
- `ratioRitmo = |ln(dt / dtAnterior)|`: 0 si el ritmo es parejo, crece con la
  irregularidad.

### Modelo de strain

Cada skillset lleva un acumulador de "tension" que decae exponencialmente con el
tiempo y crece con cada fila que lo ejercita:

```
S_k = S_k * exp(-decaimiento_k * dt / 1000) + aporte_k
```

Los aportes por fila (las `A_*` son constantes en `PARAMETROS_DIFICULTAD`):

| Skillset | Cuando aporta | Aporte |
|---|---|---|
| `stream` | fila de 1 nota, sin jack | `A_stream * v` |
| `jumpstream` | fila de 2 notas, sin jack | `A_jump * v` |
| `handstream` | fila de 3 o 4 notas, sin jack | `A_hand * v * (size / 3)` |
| `jackspeed` | fila de 1 nota que repite columna | `A_jack * (1000 / dc)` |
| `chordjack` | fila de 2+ notas con al menos una columna repetida | `A_cjack * (1000 / dcMinimo) * (size / 2)` |
| `technical` | cualquier fila | `A_tech * v * min(ratioRitmo, TOPE_RITMO)` |
| `stamina` | cualquier fila | `A_stam * size`, con **decaimiento lento** |

`stamina` es distinta a proposito: su decaimiento es mucho mas lento que el de
las demas (vida media del orden de decenas de segundos), asi que no mide picos
sino **densidad sostenida**. Las otras seis tienen decaimiento rapido y miden
picos.

### Agregacion

- Se parte el mapa en secciones de **400 ms**. Por seccion y por skillset, se
  guarda el pico de `S_k` alcanzado.
- Por skillset: se ordenan los picos de mayor a menor y se suman con peso
  decreciente: `valor_k = sum(pico_i * 0.9^i)`. Esto evita que un solo pico
  aislado domine y que un mapa largo crezca sin limite (la serie converge).
- Estrellas por skillset: `estrella_k = ESCALA_k * valor_k`.
- `overall = max(vector)`.

### Escala: provisional y honesta

La escala tiene que dejar los siete skillsets **comparables entre si**, porque
el vector solo tiene sentido si un 5 de jacks y un 5 de stream son "igual de
dificiles". Eso se calibra de verdad en T-014 contra mapas rankeados de osu!,
con Arnold arbitrando.

Para esta version, fijar las `ESCALA_k` asi y documentarlo como provisional:

1. Cada skillset de pico (los seis que no son stamina) tiene un **patron
   canonico** (ver tests). A la misma cantidad de **notas por segundo**, los
   patrones canonicos dan la misma estrella en su skillset.
2. La escala global se ajusta para que **un stream 1234 a 12 notas por segundo
   (1/4 a 180 BPM) durante 60 segundos de, aproximadamente, 4 estrellas.**
3. **Stamina se ancla distinto**, porque no tiene "patron" sino duracion: su
   escala se fija para que en ese mismo stream de referencia de 60 s,
   `stamina` quede aproximadamente igual a `stream`. Consecuencia buscada: en
   mapas mas cortos que eso domina el skillset del patron; en maratones mas
   largos domina stamina. Que es exactamente lo que un jugador espera.

No inventar precision que no hay. En el JSDoc de `PARAMETROS_DIFICULTAD`, dejar
dicho que los numeros son provisionales hasta la calibracion de T-014.

## Tests: propiedades que tienen que poder fallar

La leccion del proyecto: un test que no puede fallar no sirve. Por eso este
motor se prueba con **propiedades**, no con numeros magicos que dependan de la
calibracion. Armar los mapas de prueba con un generador local en el test (no
archivos).

1. **Vacio y degenerado:** mapa sin notas da todo 0, `overall` 0, sin `NaN`. Una
   sola nota da valores finitos.
2. **Filas:** tres notas en el mismo ms forman una fila de `size` 3 con la mascara
   correcta; dos notas a 0.5 ms tambien (tolerancia); a 2 ms, no.
3. **Discriminacion.** Cada patron canonico tiene como skillset maximo el suyo.
   **Usar mapas cortos, de unos 10 segundos:** stamina esta disenada para
   dominar los mapas largos (ver la escala), asi que en un test de
   discriminacion de 60 s le ganaria legitimamente a todos, y eso no seria un
   bug. En 10 s tiene que ganar el patron:
   - roll `0,1,2,3,0,1,2,3...` en filas de 1 -> `stream`
   - jumpstream (filas de 2 alternando con filas de 1, sin repetir columnas) -> `jumpstream`
   - handstream (filas de 3 alternando, sin jacks) -> `handstream`
   - una sola columna repetida rapido -> `jackspeed`
   - el mismo acorde de 2 repetido `[0,1],[0,1],[0,1]...` -> `chordjack`
   - stream con ritmo irregular (intervalos que alternan, por ejemplo 60 ms y
     140 ms) -> `technical` mucho mayor que en el mismo stream con ritmo parejo;
     y en el ritmo parejo `technical` es casi 0.
4. **Velocidad:** el mismo patron 1.5 veces mas rapido da un valor
   **estrictamente mayor** en su skillset.
5. **Stamina mide duracion:** el mismo stream de 15 s y de 90 s. La proporcion
   `stamina(90)/stamina(15)` es mayor que `stream(90)/stream(15)`. Esa es la
   propiedad que define a stamina.
6. **Simetria espejo:** reflejar columnas (`c -> 3 - c`) da **exactamente** el
   mismo vector. Un motor que trate distinto una mano de la otra falla aca.
7. **Invariancia temporal:** correr todas las notas +10 s da el mismo vector.
8. **`overall` es el maximo** del vector, siempre.
9. **Determinismo:** dos llamadas iguales dan resultados identicos.
10. **Rendimiento:** mapa de 3500 notas en menos de 50 ms, y que el test verifique
    que se calculo algo (valores mayores a 0), no solo el tiempo.

Sobre el cronometro del test de rendimiento: `core` no tiene lib DOM ni
`@types/node`. Usar el mismo recurso que `judge/engine.test.ts` (tipo minimo
declarado localmente). Mirar como lo resolvio ese test.

## Fuera de alcance

- UI, estrellas en el song select, Web Worker, cache: T-014.
- Calibracion contra mapas reales: T-014.
- Dificultad de notas largas (cuerpos, suelta, LN tech).
- Balance de manos y one-hand trills como skillset aparte.

## Terminado cuando

Los cuatro checks en verde, las diez propiedades cubiertas, revision de Opus, y
squash merge a `main`.
