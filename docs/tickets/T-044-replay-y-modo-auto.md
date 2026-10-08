# T-044: Replay y modo auto

Prioridad: media (util para el video del avance II). Tamano: L. Modelo: Opus escribe el formato del replay, Sonnet implementa. Archivos: `packages/core/src/replay.ts` (nuevo, puro), `apps/web/src/game.ts`, `apps/web/src/results.ts`, `packages/storage`.

## Actualizacion del 7 de octubre (manda sobre lo de abajo)

- Los records ya existen (T-055: `RecordDeMapa` con `mejor`, `ultima`,
  `intentos`; tienda `records`, base version 5). El replay de la mejor partida se
  guarda en una **tienda nueva `replays`** (keyPath `hash`), base **version 6**,
  mismo guard con `contains`. Se reemplaza solo cuando `guardarPartida` dice
  `esMejor`. `borrarCancion` borra tambien sus replays (mismo criterio que los
  records: no si otra cancion comparte el hash). El respaldo (T-042) incluye
  los replays: agregalos al manifest y a `restaurarRespaldo` (version del
  respaldo sigue en 1; `replays` opcional al leer).
- `ResultadoPartida` `completado` ya trae `pulsaciones` y `desviaciones`
  (T-056); suma `replay: Replay`.
- `OpcionesPartida` gana `reproducir?: { replay: Replay; modo: 'auto' | 'replay' }`.
  Con eso `runGame` NO lee el teclado para columnas (si para Escape, la pausa,
  Espacio para saltar la intro y F3/F4); en cada frame inyecta al motor los
  eventos con `time <= clock.now()` en orden, con su propio `time` (no el del
  frame). Las cajitas de teclas (T-056) y el haz de pulsado de la pista
  reaccionan a los eventos inyectados igual que al teclado, y suenan los
  hitsounds (T-027). Reintentar y saltar intro funcionan (al hacer seek hacia
  adelante, los eventos salteados se descartan sin juzgar; el motor ya sabe
  marcar miss por tiempo, revisar que el bot no los cuente como miss: el salto
  de intro solo ocurre antes de la primera nota).
- Etiqueta chica arriba a la izquierda durante la partida: `AUTO` o
  `REPLAY · <fecha corta>` en mono, `--acento-2`. En resultados, la misma
  etiqueta junto al titulo. No se guarda record ni historial.
- Song select (fila de iconos de la cancion enfocada): boton-icono "Ver auto"
  (aria-label exacto) y, si la dificultad tiene replay guardado, "Ver mejor
  partida". Atajo: `Ctrl+Enter` = auto.
- Mapeador: boton "Auto" junto a "Probar" que juega `replayPerfecto` del mapa en
  edicion (mismo camino que Probar, incluido "probar desde el cabezal" si es
  facil; si no, desde el inicio y documentarlo).
- `replayPerfecto`: down en `time`, up en `endTime` para las LN, y up a
  `time + 40 ms` para las notas simples (no 0 ms: algun motor podria ver
  down/up en el mismo ms como raro); nunca pulsa dos veces la misma columna a la
  vez (si dos notas de la misma columna estan a menos de 40 ms, el up va a la
  mitad).
- Pensado para grabar el video del curso: con modo presentacion (F) y auto, la
  pantalla tiene que verse limpia.

## Contexto

Para el video de la cancion que se entrega el 28 de octubre hace falta mostrar el mapa jugandose sin errores, o repetir una partida buena. Hoy cada intento hay que jugarlo en vivo. Un modo auto (un "bot" que pulsa perfecto) tambien sirve como prueba automatica del mapa: si el bot no saca todo MAX, hay un problema en el mapa o en el motor.

## Contrato

```ts
// core, puro
export interface EventoReplay { time: Ms; column: Column; tipo: 'down' | 'up' }
export interface Replay { version: 1; hashMapa: string; offsetUsuario: Ms; eventos: EventoReplay[] }

/** Genera los eventos de un jugador perfecto: down en `time`, up en `endTime` para las largas. */
export function replayPerfecto(chart: Chart): Replay;
export function serializarReplay(r: Replay): string;
export function leerReplay(texto: string): Replay | null;
```

## Comportamiento

- Grabar: `runGame` acumula los eventos de teclado ya convertidos a tiempo de juego (los mismos que van al motor de juicio) y los devuelve en `ResultadoPartida` si la partida se completo.
- Guardar el mejor replay junto al record (T-028).
- Reproducir: `runGame` con `replay` en las opciones alimenta el motor con esos eventos en vez de leer el teclado; el score resultante debe ser identico al original (es una prueba de determinismo del motor).
- Modo auto: boton "Auto" en el song select y en el editor del mapeador; reproduce `replayPerfecto`. Muestra la etiqueta "AUTO" y no guarda record.

## Criterios de aceptacion

- [ ] Reproducir un replay grabado da el mismo score, combo y conteos que la partida original.
- [ ] `replayPerfecto` sobre cualquier mapa da 100 % de MAX (test sobre mapas de fixtures).
- [ ] Un replay de otro mapa (hash distinto) se rechaza con un mensaje claro.
- [ ] El reloj sigue siendo `audioContext.currentTime`: los eventos del replay se inyectan por tiempo de juego, no con temporizadores.

## Tests

- `replayPerfecto` + motor de juicio: todo MAX, notas largas incluidas.
- Serializacion ida y vuelta, version desconocida, texto corrupto.
- Que implementacion incorrecta los haria fallar: un bot que pulse un milisegundo tarde en las largas debe fallar "todo MAX" para esas notas.

## Fuera de alcance

Compartir replays por archivo entre usuarios, ver el replay con camara o efectos, replays de partidas abortadas.

## Terminado cuando

Checks en verde y se grabo un video corto de pantalla del modo auto con la cancion de Arnold.
