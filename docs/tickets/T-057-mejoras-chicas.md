# T-057 · Mejoras chicas: offset por cancion, velocidad en vivo, detalle del record

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Rama** | `feat/mejoras-chicas` (worktree) |
| **Depende de** | T-007, T-008, T-055, T-056 |

## Contexto

Arnold pidio seguir con mejoras chicas como las de T-055/T-056, las que un
jugador de mania espera y hoy faltan. Siempre minimalista.

## 1. Offset por cancion

Algunos `.osz` vienen corridos unos ms. Hoy solo hay offset global.

- `apps/web/src/offset-local.ts` (nuevo, patron de `velocidad.ts`, storage
  inyectable, tests): `leerOffsetLocal(songId): Ms` (0 por defecto),
  `guardarOffsetLocal(songId, ms)`, recorte a ±300 ms, entero. Clave
  `tetra:offset-local:<songId>`. `borrarCancion` no lo limpia (es localStorage;
  documentar, no hace falta).
- `game.ts`: `OpcionesPartida` gana `offsetLocal?: Ms`; el reloj arranca con
  `userOffset = leerOffset() + offsetLocal`. Resultados sigue recibiendo el
  offset con el que se jugo; el boton "Corregir offset" de resultados corrige
  **el offset local** si la partida trajo uno distinto de 0 o si se jugo desde
  la biblioteca (decidi y documenta; la idea es que corregir no rompa las otras
  canciones). Lo mas simple y claro: si hay `offsetLocal` en las opciones
  (aunque sea 0), "Corregir offset" ajusta el local de esa cancion.
- Song select: en la fila de iconos de la cancion enfocada, un control chico
  `−  +3 ms  +` (mono, botones-icono de 1 ms; Shift+clic 5 ms) que solo aparece
  si es distinto de 0, o al pasar el mouse / enfocar un icono de reloj. `title`
  explica "Offset de esta cancion". Teclas `-` y `=` en el song select lo
  ajustan de a 1 ms (ignoradas mientras se escribe en el buscador).

## 2. Velocidad de caida en vivo

- En partida, `F3` baja y `F4` sube la velocidad (mismo rango 1 a 12 de
  `velocidad.ts`), con efecto inmediato (el playfield ya lee
  `options.scrollDuration` por referencia) y se guarda con `guardarVelocidad`.
- Aviso chico centrado arriba de la pista: `Velocidad 7 · 514 ms`, que se
  desvanece ~1 s despues (medido con `clock.now()`; en pausa no hace falta).
- `preventDefault` sobre F3/F4 durante la partida.

## 3. Detalle del record en el song select

Desde T-056 el record guarda `desviacionMedia` y `pulsaciones`.

- En la fila del record (T-055), despues de los intentos y en tenue:
  la desviacion media de la mejor partida como `+4 ms` / `-3 ms` (mono) con
  `title` "En promedio pegas tarde/temprano por 4 ms".
- En el `title` del detalle de la ultima partida, agregar las pulsaciones por
  tecla (`D 412 · F 398 · J 401 · K 405`) si estan.
- Si la desviacion media de la mejor partida supera ±8 ms, el valor se pinta
  en `--acento-2` y su `title` sugiere ajustar el offset de la cancion (y el
  control de offset local de arriba queda visible).

## Criterios de aceptacion

- [ ] Offset local +20 en una cancion: las notas de esa cancion se juzgan 20 ms
      corridas; otra cancion no cambia.
- [ ] "Corregir offset" en resultados de una cancion de la biblioteca ajusta el
      local de esa cancion, no el global.
- [ ] F3/F4 cambian la velocidad en vivo, persiste, y el aviso se va solo.
- [ ] La fila del record muestra la desviacion media cuando existe.
- [ ] Los cuatro checks y el e2e (`--workers=1`) en verde; e2e nuevo para F3/F4
      y para el offset local si es viable.

## Tests

`offset-local.ts` (default, recorte, entero, ida y vuelta, por cancion),
logica pura del aviso de velocidad (texto y alpha segun t), formateo de la
desviacion con signo y la regla de ±8 ms.

## Fuera de alcance

`ajustes.ts`, `ajustes.css`, `packages/storage`, `packages/audio` (otros
tickets en paralelo). Hitsounds (T-027).
