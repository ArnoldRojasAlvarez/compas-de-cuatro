# T-055 · Records por dificultad con conteos de juicio

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Rama** | `feat/records` (worktree) |
| **Depende de** | T-028 (lo reemplaza y lo amplia), T-052, T-054 |

## Contexto

Arnold pidio guardar el puntaje por cancion y ver cuantas notas de cada tipo
salieron (por ejemplo 10 perfect, 2 miss). Hoy una partida no deja rastro:
los conteos se ven en resultados y se pierden. T-028 estaba escrito y sin
implementar; este ticket lo reemplaza, con conteos y pulsaciones por tecla.

## Contrato

### core (`packages/core/src/records.ts`, nuevo, puro, exportado desde index)

```ts
export type Rango = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D';
export interface PartidaJugada {
  score: number;
  accuracy: number;         // 0 a 1
  maxCombo: number;
  counts: Record<Judgement, number>;
  rango: Rango;
  /** ms con signo (negativo = temprano), sin los miss. Ausente si no se midio. */
  desviacionMedia?: number;
  /** Pulsaciones por columna (4 numeros). Ausente si no se midio. */
  pulsaciones?: readonly number[];
  /** Texto ISO. Lo pone quien guarda. */
  fecha: string;
}
export interface RecordDeMapa {
  /** hashMapa(chart) (ya existe en core). */
  hash: string;
  mejor: PartidaJugada;
  ultima: PartidaJugada;
  intentos: number;
}
/** Mayor score gana; empate, mayor precision; empate, la nueva. `ultima` siempre la nueva; intentos + 1. */
export function combinarRecord(previo: RecordDeMapa | undefined, hash: string, nueva: PartidaJugada): RecordDeMapa;
export function rangoDePrecision(accuracy: number, counts: Record<Judgement, number>): Rango;
```

- `rangoDePrecision` se **mueve** desde `apps/web/src/resultados-logica.ts` a core
  (los umbrales actuales quedan iguales) y gana `SS`: precision 100 % (o
  todo MAX/300 sin miss). `resultados-logica.ts` lo reexporta para no romper a
  quien lo importe. Revisa los tests existentes del rango.

### storage

- Tienda nueva `records` (keyPath `hash`), `VERSION_BASE` 5, mismo guard con
  `contains` que las demas (migracion no destructiva).
- `guardarPartida(hash: string, partida: PartidaJugada): Promise<{ record: RecordDeMapa; esMejor: boolean; anterior?: PartidaJugada }>`
  (lee, combina con `combinarRecord`, guarda, en una transaccion).
- `leerRecords(hashes: readonly string[]): Promise<Map<string, RecordDeMapa>>`.
- `borrarCancion` tambien borra los records de sus dificultades.
- Un registro corrupto (sin `mejor`, tipos raros) se ignora al leer, nunca lanza.

### web

- **Guardar**: en `song-select.ts`, `jugar()`, cuando `runGame` devuelve
  `completado`, armar `PartidaJugada` desde `resultado.score` (rango con
  `rangoDePrecision`) y llamar `guardarPartida(hashMapa(chart), ...)`. Una
  partida abandonada o reintentada no cuenta. Partidas desde "probar" del
  mapeador no cuentan (no pasan por aca). `desviacionMedia` y `pulsaciones`
  todavia no estan en el resultado (las agrega T-056 en paralelo): dejalas
  afuera; el revisor las conecta al fusionar.
- **Aviso en resultados**: `results.ts` lo pinta `runGame`, y ese archivo es de
  T-056. No lo toques: despues de guardar, el song select agrega dentro de
  `.tetra-resultados` (ya existe) un elemento chico arriba: "Nuevo record" en
  `--acento` con la diferencia de score (`+12 340`) si `esMejor` y habia
  anterior; "Primer registro" si no habia; nada si no mejoro.
- **Song select**, para la dificultad enfocada, debajo de la linea de datos y
  sin caja pesada:
  - el rango grande (letra, Sora, color por rango: SS y S `--acento-2`, A
    `--acento`, B `--j-200`, C `--j-100`, D `--j-miss`), precision en mono y
    score;
  - una linea de conteos con el color de cada juicio: `MAX 812 · 300 140 ·
    200 12 · 100 3 · 50 0 · MISS 2` (numeros en mono, etiquetas tenues);
  - intentos en tenue ("12 intentos"); el detalle de la ultima partida en
    `title`.
  - Sin record: nada (ni un "sin jugar").
- **Chips de dificultad**: si la dificultad tiene record, una letra de rango
  chica dentro del chip.
- **Lista**: la tarjeta de cada cancion muestra el mejor rango entre sus
  dificultades (letra chica), si hay.
- Leer los records una vez al cargar la biblioteca (`leerRecords` con todos los
  hashes) y de nuevo al volver de una partida.

## Criterios de aceptacion

- [ ] Jugar dos veces la misma dificultad conserva la mejor, guarda la ultima y
      cuenta 2 intentos.
- [ ] Los conteos guardados coinciden con los de la pantalla de resultados.
- [ ] Borrar una cancion borra sus records.
- [ ] Un record corrupto no tumba el song select.
- [ ] Los cuatro checks y el e2e (`--workers=1`) en verde.

## Tests

- `combinarRecord`: primer record, mejor score gana, empate por precision,
  `ultima` siempre la nueva, intentos suma. Una implementacion que reemplace
  siempre por la ultima tiene que fallar.
- `rangoDePrecision`: SS, bordes de cada umbral.
- storage con `fake-indexeddb`: guardar dos partidas, `esMejor`, `anterior`,
  leer muchos, borrar cancion borra records, registro corrupto ignorado,
  migracion desde la version 4 conserva canciones.

## Fuera de alcance

`game.ts`, `results.ts`, `hud.css`, `ajustes.ts` (T-056). Historial completo,
tablas en linea.
