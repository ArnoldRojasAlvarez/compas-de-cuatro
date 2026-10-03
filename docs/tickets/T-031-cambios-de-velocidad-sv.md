# T-031: Cambios de velocidad (SV) en la pista y en el editor

Prioridad: media. Tamano: L. Modelo: Opus escribe el contrato de posicion, Sonnet implementa. Archivos: `packages/core/src/` (nuevo `velocidad-visual.ts`, puro), `packages/engine/src/position.ts` y `playfield.ts`, `apps/web/src/mapeador*.ts`.

## Contexto

El parser lee los puntos verdes (`SpeedPoint`) pero la pista dibuja todo a multiplicador 1 (`docs/ESTADO.md`, "Deuda declarada"). Muchos mapas importados se ven distinto de como fueron hechos, y el mapeador no puede ofrecer SV. El SV no cambia cuando hay que pulsar (el juicio sigue en `note.time`), solo la posicion visual.

## Contrato

```ts
// core, puro. Posicion visual acumulada: integral del multiplicador sobre el tiempo.
// Es monotona creciente mientras multiplier > 0.
export function posicionVisual(puntos: readonly SpeedPoint[], time: Ms): number;
// Distancia visual (en "ms equivalentes a velocidad 1") entre dos instantes.
export function distanciaVisual(puntos: readonly SpeedPoint[], desde: Ms, hasta: Ms): number;
```

Precalcular una tabla acumulada al crear la pista (no integrar por frame). `createPlayfield` sigue sin recibir la tabla desde afuera: la deriva de `chart.speedPoints`.

## Comportamiento

- Y de una nota = `receptorY - distanciaVisual(puntos, t, nota.time) * pxPorMs`.
- Sin puntos o con un solo `multiplier: 1`, el resultado es identico al de hoy (cero regresion visual).
- Mapeador: lista de puntos de velocidad editable (agregar en el cabezal, borrar), dibujo del editor con la misma funcion, el escritor `.osu` ya los emite.
- Multiplicadores no positivos se tratan como invalidos (se ignoran con un comentario), nunca como "ir hacia atras".

## Criterios de aceptacion

- [ ] Un mapa sin SV se ve exactamente igual (comparacion de posiciones en test).
- [ ] Con un SV de 2x en un tramo, las notas de ese tramo bajan al doble de velocidad y llegan al receptor en su `time` exacto.
- [ ] Sin allocaciones por frame en `render` (el objetivo de T-040 no se debe empeorar).

## Tests

- `posicionVisual` / `distanciaVisual`: sin puntos, un punto, varios, tiempo antes del primer punto, orden desordenado en la entrada.
- Propiedad: la nota alcanza `receptorY` exactamente cuando `t === nota.time`, con cualquier SV.
- Que implementacion incorrecta los haria fallar: una que aplique el multiplicador al tiempo absoluto (`t * m`) en vez de integrarlo debe fallar el caso de dos tramos.

## Fuera de alcance

Efectos tipo scroll hacia atras, easing entre velocidades.

## Terminado cuando

Checks en verde y un mapa importado con SV se vio correcto en el navegador.
