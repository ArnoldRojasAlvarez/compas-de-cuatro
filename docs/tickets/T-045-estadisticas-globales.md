# T-045: Estadisticas globales

Prioridad: baja. Tamano: M. Modelo: Sonnet. Archivos: `packages/core/src/estadistica/` (agregaciones puras), `packages/storage` (historial), nueva pantalla `apps/web/src/estadisticas-globales.ts` y `.css`, `apps/web/src/router.ts`, `apps/web/src/menu.ts`.

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
