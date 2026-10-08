# T-045: Estadisticas globales

Prioridad: baja. Tamano: M. Modelo: Sonnet. Archivos: `packages/core/src/estadistica/` (agregaciones puras), `packages/storage` (historial), nueva pantalla `apps/web/src/estadisticas-globales.ts` y `.css`, `apps/web/src/router.ts`, `apps/web/src/menu.ts`.

## Actualizacion del 7 de octubre (manda sobre lo de abajo)

- La base va por la **version 6** (T-044 agrego `replays`): `historial` entra en
  la **version 7**, mismo guard con `contains`. El respaldo (T-042) lo incluye
  (opcional al leer, version del respaldo sigue en 1) y `borrarCancion` **no**
  lo borra (el historial es del jugador, no de la cancion; documentarlo).
- `ResultadoPartida` `completado` ya trae `score`, `pulsaciones`,
  `desviaciones` (T-056) y `replay` (T-044). Para `fallosPorColumna` hace falta
  la columna: `Desviacion` (en `results.ts`) gana `column: Column`, que
  `game.ts` llena desde `resultado.note.column`. Es el unico cambio en `game.ts`.
- El registro se arma en logica pura (`apps/web/src/historial-logica.ts`, con
  tests) desde el resultado, y se guarda en `song-select.ts` justo despues de
  `registrarPartida` (T-055), con la misma regla: solo partidas completadas de
  la biblioteca, nunca auto ni replay (T-044). `duracionJugadaMs` es el tramo
  jugado (primera a ultima nota del mapa jugado). Agregar `notas: number` al
  registro para ponderar los promedios.
- Entrada: el menu gana un **cuarto boton** "Estadisticas" (cuatro botones, el
  numero de la casa), mismo estilo que Mapeador y Ajustes. Ademas el bloque
  "JUGADO" del header es clicable y lleva a la misma pantalla (`title`).
- Pantalla minimalista sobre la escena (fondo por defecto), sin parrafos:
  cuatro numeros grandes en mono arriba (partidas, tiempo, precision media,
  desviacion media con signo), el grafico de linea por dia, barras por columna
  con la tecla de cada una, y una barra partida temprano/tarde. Filtro 7 dias,
  30 dias, todo como segmentado chico. Un `h1` accesible "Estadisticas".
- Graficos: canvas con DPR como el de resultados, colores de los tokens, sin
  librerias.

## Contexto

El header muestra el tiempo jugado y ya hay record por mapa (T-028), pero no hay una vista de como evoluciona el jugador. Arnold mide su timing al milisegundo: ver su desviacion media bajar con las semanas, o que columna falla mas, es exactamente el tipo de dato que el proyecto ofrece como idea ("instrumento de precision").

## Contrato

```ts
// core, puro
export interface RegistroPartida {
  hash: string;
  fecha: string;       // ISO
  score: number;
  accuracy: number;
  desviacionMedia: Ms; // con signo
  desviacionTipica: Ms;
  tempranas: number; tardias: number;
  fallosPorColumna: [number, number, number, number];
  duracionJugadaMs: Ms;
}
export function resumirHistorial(r: readonly RegistroPartida[]): ResumenHistorial;
export function serieDiaria(r: readonly RegistroPartida[], campo: 'accuracy' | 'desviacionMedia'): { dia: string; valor: number }[];
```

Tienda nueva `historial` en IndexedDB (version 6, mismo guard con `contains`). Se guarda un registro por partida completada, con tope de las ultimas 2000.

## Comportamiento

- Pantalla "Estadisticas" accesible desde el menu: partidas jugadas, tiempo total, precision media, desviacion media y su tendencia (grafico de linea por dia, canvas con DPR como el de resultados), columna que mas se falla (barras por columna), proporcion temprano/tarde.
- Filtros: ultimos 7 dias, 30 dias, todo.
- Sin datos: estado vacio con la misma estetica que el song select vacio.

## Criterios de aceptacion

- [ ] Jugar tres partidas cambia los numeros de forma coherente con la suma manual.
- [ ] Los graficos no tienen NaN con un solo dia de datos ni con cero partidas.
- [ ] El historial no crece sin tope.

## Tests

- `resumirHistorial` y `serieDiaria`: vacio, un registro, varios dias, orden desordenado, un dia con muchas partidas (promedio ponderado por notas, documentar).
- Que implementacion incorrecta los haria fallar: un promedio simple de promedios por partida (sin ponderar) debe fallar el caso de dos partidas de tamano muy distinto.

## Fuera de alcance

Comparar con otros jugadores, exportar a CSV (ver T-042 para respaldo).

## Terminado cuando

Checks en verde y se vieron los graficos con datos reales de tres partidas.
