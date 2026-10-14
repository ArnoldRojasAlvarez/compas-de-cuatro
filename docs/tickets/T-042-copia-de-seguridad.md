# T-042: Copia de seguridad de la biblioteca

Prioridad: media. Tamano: M. Modelo: Sonnet. Archivos: `packages/storage/src/respaldo.ts` (nuevo), `packages/storage/src/index.ts`, `apps/web/src/ajustes.ts`.

## Contexto

Todo vive en IndexedDB y `localStorage` del navegador: canciones, mapas creados, skins, records y ajustes. Limpiar los datos del sitio, cambiar de navegador o de computadora lo borra todo, incluido el mapa que Arnold va a presentar. Un mapa que se hizo en horas no deberia depender de que nadie toque la configuracion del navegador.

## Contrato

```ts
export interface ContenidoRespaldo {
  version: 1;
  /** Canciones con audio y portada como bytes, listas para serializar a zip. */
  canciones: CancionGuardada[];
  skins: SkinGuardada[];
  records: RecordDeMapa[]; // T-055 (core), tienda 'records' de la base version 5
  ajustes: Record<string, string>; // claves 'tetra:*' de localStorage
}

/** Arma un zip: manifest.json con los metadatos y los blobs como archivos. */
export function exportarRespaldo(c: ContenidoRespaldo): Promise<Blob>;
/** Lee un zip de respaldo. Valida version y forma; rechaza con un mensaje claro si no sirve. */
export function leerRespaldo(zip: Blob): Promise<ContenidoRespaldo>;
/** Combina con lo existente: canciones por id (no duplica), ajustes solo si el usuario lo pide. */
export function restaurarRespaldo(c: ContenidoRespaldo, opciones: { sobrescribirAjustes: boolean }): Promise<ResumenRestauracion>;
```

## Comportamiento

- Actualizacion del 7 de octubre: los records son `RecordDeMapa` (T-055); las canciones pueden traer `video`, `videoOffset` e `importadaEn` (T-049), que tambien viajan. Los ajustes incluyen `tetra:offset-local:*` (T-057). La tarjeta de ajustes es nueva y chica: "05 Biblioteca" con dos botones ("Exportar respaldo", "Importar respaldo") y una linea mono con el uso de almacenamiento (`estimarAlmacenamiento`, T-049). El resumen tras importar es una linea, no un parrafo.
- No toques `song-select.ts`, `game.ts` ni `results.ts` (T-057 en paralelo).

- Ajustes: "Exportar respaldo" descarga `tetra-respaldo-AAAA-MM-DD.zip`; "Importar respaldo" lo restaura mostrando un resumen (canciones nuevas, ya existentes, skins, records).
- Usa `fflate`, que ya es dependencia de storage.
- Una cancion con el mismo id no se duplica ni se pisa sin avisar; se cuenta como "ya existente".
- Un respaldo corrupto o de una version futura se rechaza sin tocar nada de lo existente.

## Criterios de aceptacion

- [ ] Exportar y luego importar en una base vacia reproduce exactamente las mismas canciones (mismos ids, mismas notas, mismo audio).
- [ ] Importar dos veces seguidas no duplica nada.
- [ ] Un zip que no es un respaldo da un mensaje de error, no una excepcion sin atrapar.

## Tests

- Ida y vuelta con `fake-indexeddb`: canciones, skins, records y ajustes.
- Zip invalido, `manifest.json` ausente, version desconocida.
- Que implementacion incorrecta los haria fallar: una que serialice los Blob como `{}` (JSON.stringify) debe fallar la comparacion de audio.

## Fuera de alcance

Sincronizacion en la nube, cuentas de usuario (decision de producto: backend queda para el final).

## Terminado cuando

Checks en verde y se restauro un respaldo en un perfil de navegador limpio.

## Actualización de T-065

El respaldo lleva ahora también las partidas recientes **fijadas** ("Conservar", clave `recientes` del manifest, opcional al leer; la versión del respaldo sigue en 1). Las no fijadas no viajan: se purgan solas a los 7 días. Ver `docs/tickets/T-065-replays-recientes.md`.
