# T-034: Seleccion, copiar, pegar y mover notas en el editor

Prioridad: alta. Tamano: M. Modelo: Sonnet. Archivos: `apps/web/src/mapeador-logica.ts` (operaciones puras nuevas), `apps/web/src/mapeador.ts`.

## Contexto

El editor solo pone y quita notas una por una. Mapear una cancion repite patrones (un compas de stream, un acorde cada cuatro tiempos): sin copiar y pegar, cada repeticion es trabajo a mano, y mover una frase una corchea obliga a borrarla y ponerla de nuevo.

## Contrato

```ts
// mapeador-logica.ts, todo puro e inmutable
export interface Seleccion { readonly desde: Ms; readonly hasta: Ms; readonly columnas: readonly Column[] }

export function notasEnSeleccion(notas: readonly Note[], s: Seleccion): Note[];
/** Mueve las notas elegidas `deltaMs` en el tiempo (y `deltaColumnas`), sin solapar la misma columna. */
export function moverNotas(notas: readonly Note[], elegidas: readonly Note[], deltaMs: Ms, deltaColumnas?: number): Note[];
/** Copia con tiempos relativos al inicio del portapapeles. */
export function copiarNotas(elegidas: readonly Note[]): { readonly notas: Note[]; readonly duracion: Ms };
export function pegarNotas(notas: readonly Note[], portapapeles: { notas: readonly Note[] }, enMs: Ms): Note[];
/** Ajusta las notas elegidas al slot mas cercano de la grilla actual. */
export function cuantizarNotas(notas: readonly Note[], elegidas: readonly Note[], g: Grilla): Note[];
```

## Comportamiento

- Seleccion: arrastrar con Shift sobre las pistas dibuja un rectangulo (tiempo x columnas); las notas dentro se resaltan.
- Atajos: Ctrl+C copiar, Ctrl+X cortar, Ctrl+V pegar en el cabezal (ajustado a la rejilla), Supr borrar la seleccion, Ctrl+A seleccionar todo, flechas con Alt mueven la seleccion un slot / una columna, Q cuantizar.
- El portapapeles vive en memoria de la sesion (no usa el del sistema).
- Cada operacion es un solo paso en el historial: un Ctrl+Z deshace el pegado entero.
- Mover una nota larga mueve su inicio y su fin; pegar sobre notas existentes en la misma columna las reemplaza solo en el intervalo ocupado.

## Criterios de aceptacion

- [ ] Copiar un compas y pegarlo cuatro pulsos despues produce las mismas columnas desplazadas exactamente 4 pulsos.
- [ ] Mover una frase no deja notas solapadas en una misma columna.
- [ ] Todo es deshacible de una sola vez.

## Tests

- Una prueba por funcion con casos de borde: seleccion vacia, nota larga que cruza el borde de la seleccion, pegar fuera del rango de la cancion, mover a columna fuera de 0 a 3 (se recorta o se rechaza, decidir y documentar).
- Que implementacion incorrecta los haria fallar: un `pegarNotas` que use tiempos absolutos en vez de relativos debe fallar el caso de pegar cuatro pulsos despues.

## Fuera de alcance

Portapapeles del sistema, transformaciones (invertir en el tiempo), seleccion no rectangular.

## Terminado cuando

Checks en verde y se mapeo un compas, se copio 8 veces y se movio una corchea en el navegador.
