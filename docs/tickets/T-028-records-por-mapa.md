# T-028: Records por mapa

Prioridad: alta. Tamano: M. Modelo: Sonnet. Archivos: `packages/core/src/records.ts` (nuevo, puro), `packages/storage/src/db.ts` y `index.ts`, `apps/web/src/song-select.ts` y `results.ts` (solo lectura/escritura del record).

## Contexto

Las partidas no dejan rastro: al volver al song select no se sabe si ya se jugo un mapa ni como salio. Para Arnold (que mide su timing al milisegundo) y para la presentacion, tener el mejor resultado por dificultad cierra el ciclo de practica.

## Contrato

```ts
// core, puro (clave del mapa = hashMapa(chart), ya existe)
export interface Record {
  hash: string;
  score: number;
  accuracy: number; // 0 a 1
  maxCombo: number;
  rango: 'S' | 'A' | 'B' | 'C' | 'D';
  /** Desviacion media en ms, con signo (negativo = temprano). */
  desviacionMedia: number;
  intentos: number;
  /** Instante de la ultima partida, texto ISO. Lo pone quien guarda, no core. */
  fecha: string;
}
export function combinarRecord(previo: Record | undefined, nuevo: Omit<Record, 'intentos'>): Record;
// score mayor gana; en empate, mayor precision; intentos siempre suma 1.

// storage: nueva tienda 'records' (version 5 de la base, mismo guard con contains que T-009/T-014)
export function guardarRecord(r: Record): Promise<void>;
export function leerRecord(hash: string): Promise<Record | undefined>;
export function leerRecords(hashes: readonly string[]): Promise<Map<string, Record>>;
```

El rango reutiliza `rangoDePrecision` de `apps/web/src/resultados-logica.ts`: moverlo a core si hace falta para no duplicar umbrales.

## Comportamiento

- Al terminar una partida `completado` se combina y guarda el record. Una partida abandonada no cuenta.
- En los resultados: etiqueta "Nuevo record" si mejoro el score, con la diferencia.
- En el song select: cada dificultad muestra su mejor rango y precision; sin jugar, nada.
- Migracion no destructiva: las tiendas existentes quedan intactas.

## Criterios de aceptacion

- [ ] Jugar dos veces el mismo mapa conserva el mejor y cuenta 2 intentos.
- [ ] Cambiar una sola nota del mapa cambia el hash y por lo tanto el record es otro (comportamiento esperado, documentado en el codigo).
- [ ] Un record corrupto en la base no tumba el song select.

## Tests

- `combinarRecord`: mejor score gana, empate por precision, intentos suma, primer record.
- `guardarRecord`/`leerRecords` con `fake-indexeddb` (ya es dependencia de storage).
- Que implementacion incorrecta los haria fallar: una que reemplace siempre por el ultimo debe fallar "mejor score gana".

## Fuera de alcance

Tabla de clasificacion en linea. Historial completo de partidas (ver T-045, estadisticas).

## Terminado cuando

Checks en verde y se vio el record aparecer tras dos partidas en el navegador.
