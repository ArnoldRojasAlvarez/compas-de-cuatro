# T-005 · Importador de mapas .osu (mania 4K)

| | |
|---|---|
| **Fase** | 2 · Contenido |
| **Modelo** | Sonnet |
| **Rama** | `feat/import` |
| **Depende de** | el contrato de tipos de `core` |
| **Desbloquea** | tener una biblioteca de mapas de verdad para probar todo lo demas |

## Contexto

Hasta ahora el unico mapa es el click track sintetico. Para probar la pista, la
dificultad y el song select hace falta contenido real. El formato `.osu` es
texto plano y esta documentado, y un parser de mania 4K es corto.

Esto es contenido de terceros: sirve para desarrollo y pruebas, no para
publicar. La musica tiene dueño.

## El parser vive en core

`packages/core/src/chart/osu.ts`. Es funcion pura: entra el texto de un `.osu`,
sale un `Chart` (el tipo de `types.ts`) o un error. No toca el navegador, no lee
archivos, no descomprime nada. Recibe el texto ya leido.

```ts
// packages/core/src/chart/osu.ts
import type { Chart } from '../types.js';

export type ParseResult =
  | { ok: true; chart: Chart }
  | { ok: false; error: string };

/** Parsea el texto de un archivo .osu de modo mania con 4 columnas. */
export function parseOsu(text: string): ParseResult;
```

## Formato .osu, lo que importa para mania 4K

El archivo tiene secciones con encabezado entre corchetes. Las que se usan:

- **`[General]`**: `AudioFilename`, `Mode`. **Si `Mode` no es `3` (mania), es
  error.** `PreviewTime` sale de aca.
- **`[Metadata]`**: `Title`, `Artist`, `Creator`, `Version` (es el nombre de la
  dificultad).
- **`[Difficulty]`**: `OverallDifficulty`, `HPDrainRate`, y **`CircleSize`, que
  en mania es la cantidad de columnas. Si no es `4`, es error.**
- **`[TimingPoints]`**: lineas `time,beatLength,meter,...`. Un punto es rojo
  (cambio de BPM) si `beatLength > 0`: ahi `bpm = 60000 / beatLength`. Si
  `beatLength < 0` es un punto verde (SV), `multiplier = 100 / -beatLength`.
- **`[HitObjects]`**: una nota por linea, `x,y,time,type,hitSound,extras`.

### La columna sale de la x

En mania la columna se calcula de la coordenada x:

```
columna = floor(x * columnCount / 512)
```

Con 4 columnas eso da x = 64 -> col 0, 192 -> col 1, 320 -> col 2, 448 -> col 3.
Acotar el resultado a `[0, 3]` por si viene una x en el borde.

### Nota simple contra nota larga

El campo `type` es una mascara de bits:

- bit 0 (`type & 1`): nota normal, es un `tap`.
- bit 7 (`type & 128`): hold note, es una LN. Su `endTime` es el **primer campo
  de `extras`**, antes del primer `:`. Ejemplo de extras de una LN:
  `end,hitSample` donde `end` es el tiempo de la cola.

## Reglas del parser

- Las notas salen **ordenadas por `time` ascendente**: es un invariante de
  `Chart`. Ordenarlas al final, no confiar en que el archivo venga ordenado.
- Ignorar lineas vacias y comentarios (`//`).
- Ignorar secciones que no se usan (`[Events]`, `[Colours]`, etc.) sin fallar.
- Una LN con `endTime <= time` es invalida: descartarla y seguir, no abortar
  todo el mapa.
- Si falta una seccion obligatoria o un campo obligatorio, devolver
  `{ ok: false, error }` con un mensaje que diga que falto.

## La capa de navegador va aparte

`packages/audio` o un modulo nuevo `packages/storage`, a criterio, pero **fuera
de core**:

- Descomprimir un `.osz` (es un zip). Se puede us`fflate` de cdnjs, o la
  DecompressionStream del navegador. Elegir y justificar.
- Leer el `.osu` de adentro, pasarlo a `parseOsu`, y guardar el `Chart`, el
  audio y la portada en IndexedDB.
- Una API chica: `importarOsz(file): Promise<ChartId>` y
  `listarMapas(): Promise<MapaGuardado[]>`.

## Criterios de aceptacion (del parser, que es lo testeable en core)

- [ ] Un `.osu` de mania 4K valido produce un `Chart` con todas sus notas
- [ ] La columna se calcula bien: x 64, 192, 320, 448 dan columnas 0, 1, 2, 3
- [ ] Una hold note produce un `HoldNote` con el `endTime` correcto sacado de
      extras
- [ ] Las notas quedan ordenadas por `time` aunque el archivo las traiga
      desordenadas
- [ ] `Mode` distinto de 3 da error con mensaje claro
- [ ] `CircleSize` distinto de 4 da error con mensaje claro
- [ ] Un punto rojo de timing produce el BPM correcto (`60000 / beatLength`)
- [ ] Un punto verde produce el SV correcto (`100 / -beatLength`)
- [ ] Una LN con `endTime <= time` se descarta sin abortar el resto
- [ ] Falta de seccion obligatoria da `{ ok: false }`, no una excepcion

## Tests

`packages/core/src/chart/osu.test.ts`, con `.osu` de ejemplo embebidos como
strings en el test (no leas archivos desde core). Incluir un caso real
recortado: unas 20 notas con al menos una LN y un cambio de BPM.

Para la capa de IndexedDB, si se testea, va con Playwright o con un fake de
IndexedDB, no en core.

## Fuera de alcance

- Aplicar los SV al render. Eso es un ticket aparte. Aca solo se **parsean** y
  se guardan en el `Chart`.
- El song select. Es fase 3.

## Terminado cuando

Los cuatro checks en verde, cobertura del parser sobre 90%, un `.osz` real
importado y jugable en la pista de T-004, revision de Opus aprobada y squash
merge a `main`.
