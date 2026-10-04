# T-035: Probar desde aqui y latencia de grabacion

Prioridad: alta. Tamano: M. Modelo: Sonnet. Archivos: `apps/web/src/game.ts` (opcion de inicio), `apps/web/src/mapeador.ts`, `packages/audio/src/clock.ts` solo si hace falta (ya tiene `seek`).

## Contexto

"Probar el mapa" arranca siempre del principio (T-025, "Limites conocidos"). Revisar el compas 60 de una cancion obliga a jugar los 59 anteriores. Ademas, al grabar en vivo con D F J K el sonido de salida llega con latencia y las notas quedan tarde.

## Contrato

```ts
// game.ts: opciones nuevas, todas opcionales (los llamadores actuales no cambian)
export interface OpcionesPartida {
  skin?: TexturasDeSkin;
  /** Arranca la partida en este instante (ms) de la cancion, con el lead-in normal antes. */
  inicioMs?: Ms;
}
export function runGame(chart: Chart, audio: AudioBuffer, opciones?: OpcionesPartida): Promise<ResultadoPartida>;
```

La firma actual `runGame(chart, audio, skin?)` se conserva como sobrecarga hasta migrar `song-select.ts`.

## Nota de implementacion

El contrato final difiere en un detalle del de arriba: en vez de reemplazar el tercer parametro por un objeto de opciones, `runGame(chart, audio, skin?, opciones?)` recibe `OpcionesPartida` como cuarto parametro. Es mas simple y no cambia a ningun llamador existente. Las notas largas que empiezan antes del inicio se descartan enteras (decision pedida por el ticket).

## Comportamiento

- Desde `inicioMs` el motor de juicio ignora las notas anteriores (no cuentan como miss) y la barra de progreso arranca en proporcion. El reloj se posiciona con `clock.seek`, no con un temporizador.
- Editor: boton "Probar desde el cabezal" junto a "Probar el mapa".
- Grabacion en vivo: el tiempo de cada nota grabada resta `offset del usuario` (el de calibracion de T-007) mas la latencia de salida del contexto (`ctx.outputLatency` si existe), de forma que lo grabado coincida con lo que el jugador escucho cuando pulso. Casilla "Compensar latencia" activa por defecto.
- Un test visual en el editor: el aviso muestra cuantos ms se compensaron.

## Criterios de aceptacion

- [ ] Probar desde el segundo 30 no genera misses de las notas anteriores y los resultados reflejan solo lo jugado.
- [ ] Con la compensacion, grabar siguiendo el metronomo deja las notas dentro de una ventana de +-10 ms de la rejilla en un caso de prueba controlado.
- [ ] El juego sin `inicioMs` se comporta exactamente como hoy (el e2e de sincronia sigue pasando).

## Tests

- Logica pura: `filtrarNotasDesde(chart, inicioMs)` mantiene las notas largas que cruzan el inicio como falsas (no jugables) o las recorta (decidir y documentar).
- `compensarLatencia(tiempo, offsetUsuario, latenciaSalida)` con signos explicitos.
- Que implementacion incorrecta los haria fallar: una compensacion con el signo invertido debe fallar el caso "grabado coincide con lo escuchado".

## Fuera de alcance

Reproducir en bucle un tramo, practica a velocidad reducida (ticket futuro de "modo practica").

## Terminado cuando

Checks en verde, el e2e de sincronia en verde, y se probo desde la mitad de un mapa en el navegador.
