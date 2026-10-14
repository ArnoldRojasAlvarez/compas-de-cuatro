# T-065 · Replays de las partidas recientes

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Rama** | `feat/replays-recientes` (worktree) |
| **Depende de** | T-044, T-042, T-063 |

## Contexto

Para el video del curso hace falta jugar una canción y después grabar la partida
con su replay. Hasta ahora solo se guardaba el replay de la MEJOR partida de cada
dificultad (tienda `replays`, T-044): si la partida que se quería mostrar no
superaba el récord, se perdía.

## Qué se hizo

**Almacenamiento (`@tetra/storage`, base versión 8).** Tienda nueva `recientes`
(clave `id = <hash>|<fecha>`, índices `hash` y `fecha`). Cada partida completada
guarda ahí su replay, su resumen (`PartidaJugada`) y la marca `fijado`, en la misma
transacción que el récord (`guardarPartida`), mejore o no. Solo se guardan partidas
completadas con replay de la biblioteca (no el auto, no los replays vistos, no el
click track), igual que el récord.

- **Purga al abrir la app** (`purgarReplaysRecientes`, llamada desde `main.ts`):
  fuera las de más de 7 días y, de las que quedan sin fijar, todas menos las 200
  más nuevas. Las fijadas no se purgan nunca ni cuentan para el tope. Una fila
  corrupta se borra. La regla es una función pura (`idsAPurgar`) con tests.
- **El replay de la mejor partida se conserva siempre**: vive en su tienda
  `replays` (T-044), que la purga no toca. Una reciente que es la mejor se purga a
  los 7 días como cualquiera, pero "Ver mejor partida" sigue estando.
- **Conservar**: `conservarPartidaReciente(id, fijado)`. Una fila fijada no se purga.
- Borrar una canción borra también las recientes de sus dificultades (fijadas o no),
  salvo que otra canción tenga el mismo mapa (mismo criterio que los récords).
- **Migración** 7 a 8 no destructiva: mismo guard con `contains`; quien venía de 1
  a 7 conserva todo y solo gana la tienda (con sus dos índices).

**Respaldo (T-042): decisión.** El respaldo lleva solo las recientes **fijadas**
(`recientes` en el manifest, opcional al leer, versión del respaldo sigue en 1). Las
demás se purgan solas a los 7 días y hasta 200 replays inflarían el zip (cada uno
unas decenas de KB); la mejor partida ya viaja en `replays`. Al restaurar, una fila
fijada que no estaba se agrega, y una que ya estaba sin fijar queda fijada; nada
más se pisa. Restaurar dos veces el mismo respaldo no duplica. El resumen suma
`recientesNuevos` y la línea de la tarjeta de ajustes los cuenta como replays.

**Interfaz.**

- Song select: bajo la fila de acciones de la dificultad enfocada, "Partidas
  recientes" (solo si hay): fecha y hora locales, precisión, rango y score de cada
  partida, con "Ver replay" y "Conservar" (el marcador queda lleno y la fila con
  borde de acento; otro clic la suelta). La que es el récord lleva "Mejor". La lista
  se desplaza sola pasadas unas cuatro filas.
- Resultados: "Ver replay" junto a "Volver al song select" (barra pegada abajo).
  Reproduce la partida recién jugada con el mismo audio, fondo, skin y HUD. Si lo
  que terminó ya era un replay o el auto, el botón dice "Ver de nuevo".
- El replay respeta el modo presentación (F): sin header, interfaz grande, cursor
  que se oculta y la etiqueta `REPLAY · fecha` tenue (T-044/T-037). Mirarlo no
  suma tiempo jugado, intentos, récord ni historial.

## Determinismo

El replay guardado como reciente se serializa con `serializarReplay` (JSON conserva
los decimales exactos de los tiempos que da el reloj interpolado de T-063) y se
reproduce con las mismas reglas del motor de T-044 (`entregarEvento` y expiración
con margen). `recientes.test.ts` lo fija: se juega una partida sintética en vivo con
tiempos de decimales largos, se guarda como reciente (con otra mejor, para que el
replay solo exista en `recientes`), se lee de la base y se reproduce a 240, 144, 60,
24 y 4 fps: el estado final es idéntico en todas. El e2e lo repite de punta a punta.

## Límites

- Una reciente que es la mejor se purga a los 7 días de la lista (el replay de la
  mejor sigue en "Ver mejor partida").
- El tope de 200 y los 7 días se aplican solo al abrir la app, no durante la sesión.
- Los replays recientes no viajan en el respaldo salvo los fijados (ver arriba).
- No hay compartir replays por archivo ni exportarlos como video: para el video del
  curso se graba la pantalla (OBS) con el modo presentación.

## Tests

- `packages/storage/src/recientes.test.ts` (25): guardado junto al récord, lista
  ordenada, lectura exacta con decimales, conservar, purga (7 días, tope de 200,
  fijadas, mejor partida, filas corruptas), borrado con la canción, migración desde
  una base real en versión 7, respaldo (ida y vuelta, idempotencia, respaldo viejo,
  filas malas) y el determinismo.
- `replay-logica.test.ts`: la fecha y hora local corta.
- `e2e/replays-recientes.spec.ts`: jugar con pulsaciones sintéticas, ver el replay
  desde resultados y desde la lista (resultado idéntico, sin intento extra), dos
  partidas, conservar y recargar, la purga al abrir la app con filas sembradas
  y el modo presentación durante un replay reciente.
