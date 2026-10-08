# T-046: Minimapa y vista general del editor

Prioridad: media. Tamano: S. Modelo: Sonnet. Archivos: `apps/web/src/mapeador-logica.ts` (calculo de densidad), `apps/web/src/mapeador.ts`, `apps/web/src/mapeador.css`.

## Contexto

El editor solo muestra unos segundos a la vez. En una cancion de tres minutos no hay forma de ver la forma completa: donde esta la parte densa, donde quedan huecos sin mapear, ni de saltar a otro lugar sin arrastrar la barra a ciegas. Ya existe la onda y la lista de golpes detectados, pero no se ven en conjunto.

## Contrato

```ts
// mapeador-logica.ts, puro
export interface CubetaVista { densidadNotas: number; energia: number; hayNotas: boolean }
/** Resume la cancion en `ancho` cubetas: notas por cubeta, energia de audio normalizada. */
export function resumirParaMinimapa(
  notas: readonly Note[], picos: Float32Array, msPorCubetaPicos: Ms, duracionMs: Ms, ancho: number,
): CubetaVista[];
```

## Comportamiento

- Una franja horizontal bajo la barra de posicion: onda de energia al fondo, densidad de notas encima (altura por cubeta), cabezal y zona visible resaltados, marcas de compas cada 8 compases.
- Clic o arrastre en la franja salta a ese instante (misma funcion `buscar` que usa la barra).
- Huecos grandes sin notas (mas de 8 compases) se marcan en ambar para que se vean de un vistazo.
- Se redibuja solo cuando cambian las notas o el ancho, no por frame (el cabezal sobre la franja si se mueve por frame, en una capa aparte barata).

## Criterios de aceptacion

- [ ] Con 0 notas la franja muestra solo la onda y no tiene NaN.
- [ ] Generar un mapa automatico actualiza la franja de inmediato.
- [ ] Saltar con clic coloca el cabezal en el tiempo correcto (error menor a una cubeta).

## Tests

- `resumirParaMinimapa`: sin notas, notas en un extremo, `ancho` mayor que la cantidad de cubetas de audio, duracion 0.
- Que implementacion incorrecta los haria fallar: una que asigne las notas a la cubeta por indice de nota en vez de por tiempo debe fallar el caso de notas agrupadas en un extremo.

## Fuera de alcance

Edicion directa sobre el minimapa, zoom del minimapa.

## Terminado cuando

Checks en verde y se vio la franja con un mapa generado y con huecos marcados.

## Implementacion (7 de octubre de 2026)

- La franja mide 56 px y va justo bajo la barra de posicion. Son dos lienzos apilados: el de fondo (onda de energia en verde agua, barras blancas de densidad de notas desde abajo, marcas de compas cada 8 compases con su numero, huecos en ambar) y el de arriba (zona visible del editor y cabezal, el unico que se pinta por frame y recibe el mouse). El de fondo se redibuja solo si cambia el arreglo de notas, el audio, el ancho o alto, la duracion o el BPM/offset de la grilla.
- Una cubeta por pixel de ancho. Las notas se cuentan por el instante en que EMPIEZAN (una larga cuenta una vez). La energia es el promedio de los picos de la cubeta, normalizado por la cubeta mas fuerte; se dibuja con raiz para que se vean los pasajes suaves.
- `huecosSinNotas`: tramos de MAS de 8 compases (4 pulsos cada uno, segun el BPM de la grilla) sin notas ni largas sostenidas, incluidos el principio (intro) y el final. Con 0 notas no se marca nada: un mapa vacio no tiene huecos, el criterio de aceptacion pide solo la onda.
- Funciones puras nuevas, ademas de `resumirParaMinimapa`: `huecosSinNotas`, `marcasDeCompas`, `tiempoDeXMinimapa` y `xDeTiempoMinimapa`.
- Clic o arrastre salta con la misma `buscar()` de la barra de posicion (con captura de puntero, el arrastre sigue aunque el mouse salga de la franja).
- Solo lectura: no se edita ni se hace zoom sobre la franja (fuera de alcance).
