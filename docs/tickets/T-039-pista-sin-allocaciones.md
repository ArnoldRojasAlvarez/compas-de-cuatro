# T-039: Pista sin allocaciones por frame

Prioridad: media. Tamano: S. Modelo: Sonnet. Archivos: `packages/engine/src/position.ts` (`avanzarVentana`), `packages/engine/src/playfield.ts`, sus tests.

## Contexto

El QA de T-020 dejo una deuda: `avanzarVentana` sigue devolviendo un objeto por columna por frame (4 por frame), y un pool de sprites puede crecer una vez si una columna pasa de 32 notas visibles. En un stream rapido a 240 Hz son miles de objetos por segundo para el recolector de basura, justo en el camino critico del juego.

## Contrato

La firma publica de `createPlayfield` no cambia. `avanzarVentana` pasa a escribir en un arreglo de estado preasignado en vez de devolver objetos nuevos:

```ts
export interface VentanaColumna { inicio: number; fin: number }
/** Actualiza `salida[c]` en sitio para las cuatro columnas. No aloca. */
export function avanzarVentanaEnSitio(estado: readonly VentanaColumna[], /* resto igual */): void;
```

La funcion anterior se conserva (con su test) como referencia hasta que nadie la use y luego se elimina en este mismo ticket.

## Comportamiento

- Pool de sprites dimensionado por el maximo de notas visibles calculado al crear la pista (segun `scrollDuration` y la densidad real del mapa), no por una constante.
- `render(t)` no crea objetos, closures ni strings.

## Criterios de aceptacion

- [ ] Mismos resultados visuales que antes (los tests de `position.test.ts` pasan sin cambios de valores esperados).
- [ ] Prueba de no-allocacion: contar objetos creados durante 10 000 llamadas a `render` con un mapa denso, con un contador falso de constructores; debe ser 0 despues del calentamiento.
- [ ] Un mapa con 40 notas visibles en una columna no rompe ni crece el pool durante la partida.

## Tests

- Equivalencia entre la version en sitio y la anterior sobre muchas ventanas aleatorias con semilla.
- Que implementacion incorrecta los haria fallar: una que devuelva siempre el mismo objeto mutado compartido entre columnas debe fallar el test de equivalencia.

## Fuera de alcance

Cambiar el motor de render (Pixi) o el formato de skins.

## Terminado cuando

Checks en verde, e2e de sincronia en verde, y los FPS medidos con el contador de ajustes no empeoran en un mapa denso.
