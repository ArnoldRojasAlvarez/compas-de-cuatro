# T-044: Replay y modo auto

Prioridad: media (util para el video del avance II). Tamano: L. Modelo: Opus escribe el formato del replay, Sonnet implementa. Archivos: `packages/core/src/replay.ts` (nuevo, puro), `apps/web/src/game.ts`, `apps/web/src/results.ts`, `packages/storage`.

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
