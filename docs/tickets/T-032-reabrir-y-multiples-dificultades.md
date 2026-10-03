# T-032: Reabrir una cancion en el editor y varias dificultades

Prioridad: alta. Tamano: M. Modelo: Sonnet. Archivos: `packages/storage/src/index.ts` y `db.ts`, `apps/web/src/mapeador.ts`, `apps/web/src/song-select.ts` (un boton), `apps/web/src/router.ts`.

## Contexto

Una cancion guardada desde el mapeador no se puede volver a abrir (ver T-025, "Limites conocidos"): para corregir un mapa hay que rehacerlo. Y cada guardado crea una cancion nueva, asi que no hay forma de tener Facil, Normal y Dificil de la misma cancion. Para la entrega, Arnold va a iterar sobre su mapa muchas veces.

## Contrato

```ts
// storage
export function leerCancion(id: SongId): Promise<CancionGuardada | undefined>;
/** Reemplaza (mismo nombre de dificultad) o agrega una dificultad a una cancion existente. */
export function guardarDificultad(id: SongId, chart: Chart): Promise<void>;
export function borrarDificultad(id: SongId, difficultyName: string): Promise<void>;

// mapeador: entrada nueva
export interface OpcionesMapeador { /* ya existente */
  /** Si viene, el editor arranca cargado con esta dificultad de esta cancion. */
  abrir?: { songId: SongId; difficultyName: string };
}
```

## Comportamiento

- Song select: boton "Editar en el mapeador" en el detalle de la dificultad enfocada.
- El editor carga audio y notas desde la cancion guardada, con la grilla del primer punto de tiempo y el OD/HP del chart. El audio no se vuelve a pedir.
- "Guardar en la biblioteca" cuando se edita una cancion existente: reemplaza esa dificultad (misma `difficultyName`) o agrega una nueva si se cambio el nombre. No duplica la cancion.
- Para una cancion nueva sigue como hoy; un selector "Dificultad" permite guardar varias sobre la misma cancion despues del primer guardado.
- El borrador de `localStorage` no pisa una cancion abierta de la biblioteca.

## Criterios de aceptacion

- [ ] Editar y guardar una nota no cambia el `id` de la cancion ni la cantidad de canciones.
- [ ] Guardar con otro nombre de dificultad agrega una dificultad; el song select las lista todas.
- [ ] Una dificultad con tiempo variable o SV importada de osu! se abre sin perder esos puntos (se conservan al guardar aunque el editor no los edite todavia).

## Tests

- storage con `fake-indexeddb`: `guardarDificultad` reemplaza, agrega, no toca otras canciones; `borrarDificultad` de la ultima dificultad no deja una cancion vacia (la borra o falla con mensaje claro, decidir y documentar).
- Que implementacion incorrecta los haria fallar: una que cree una cancion nueva en cada guardado debe fallar "no cambia el id".

## Fuera de alcance

Editar canciones importadas de osu! con tiempo variable (ver T-033); fusionar canciones duplicadas.

## Terminado cuando

Checks en verde y se vio el ciclo abrir, mover una nota, guardar y reabrir en el navegador.
