# T-049 · Fondos, video y biblioteca persistente (core + storage)

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Rama** | `feat/fondos-y-biblioteca` (worktree) |
| **Depende de** | T-005, T-011, T-032 |

## Contexto

El song select ya sabe pintar portadas (T-022) pero **ninguna cancion trae
fondo**: `parseOsu` ignora `[Events]` y `chart.metadata.backgroundFile` nunca
se llena. Muchos `.osz` traen imagen de fondo y algunos traen video. Ademas
Arnold pidio que la biblioteca del usuario quede bien guardada: hoy vive en
IndexedDB, pero el navegador puede desalojarla y no hay forma de borrar ni de
exportar una cancion.

Este ticket es solo `packages/core` y `packages/storage`. La UI que usa todo
esto es T-052 y T-053.

## Contrato

### core (`packages/core/src/types.ts`)

```ts
export interface ChartMetadata {
  // ...lo que ya hay...
  backgroundFile?: string;
  /** Video de fondo declarado en [Events] (ruta dentro del .osz, con '/'). */
  videoFile?: string;
  /** Desfase del video respecto del audio, en ms (campo 2 de la linea de video). */
  videoOffset?: Ms;
  /** [Metadata] Source y Tags, tal cual (recortados). Ausentes si vienen vacios. */
  source?: string;
  tags?: string;
}
```

### core (`packages/core/src/chart/osu.ts`)

`parseOsu` lee `[Events]`:

- Fondo: la primera linea `0,0,"archivo.jpg",x,y` (las comillas y `x,y` son
  opcionales). Tambien acepta el alias `Background,...`.
- Video: la primera linea `Video,offset,"archivo.mp4"` o `1,offset,"archivo"`.
- En las dos: quitar comillas, cambiar `\` por `/`, recortar espacios.
- Ignorar todo lo demas de `[Events]` (sprites, breaks, storyboard).
- `[Metadata] Source` y `Tags` a `source`/`tags` (ausentes si estan vacios).
- Un `[Events]` raro nunca hace fallar el mapa.

### core (`packages/core/src/chart/osu-escritor.ts`)

`escribirOsu` escribe en `[Events]` la linea de fondo `0,0,"<backgroundFile>",0,0`
si `metadata.backgroundFile` existe, y la de video si existe `videoFile`.
`Source:` y `Tags:` con los valores del chart (Tags conserva `tetra` si no hay).
El roundtrip `parseOsu(escribirOsu(chart))` conserva los cuatro campos nuevos.

### storage

```ts
// db.ts
export interface CancionGuardada {
  id: SongId;
  titulo: string;
  artista: string;
  audio: Blob;
  background?: Blob;
  /** Solo si el .osz trae un video que el navegador puede reproducir (mp4, m4v, webm). */
  video?: Blob;
  /** ms; copia de chart.metadata.videoOffset de la dificultad de la que salio el video. */
  videoOffset?: Ms;
  /** Date.now() al importar. Opcional porque las canciones viejas no lo tienen. */
  importadaEn?: number;
  dificultades: Chart[];
}

// index.ts (exports nuevos)
export function borrarCancion(id: SongId): Promise<void>;
/** Arma de nuevo un .osz con todo lo guardado (audio, fondo, video y un .osu por dificultad). */
export function exportarCancion(id: SongId): Promise<Blob>;
/** navigator.storage.persist() si existe; false si no existe o falla. Nunca lanza. */
export function pedirAlmacenamientoPersistente(): Promise<boolean>;
/** Bytes usados y cuota (navigator.storage.estimate); undefined si no esta disponible. */
export function estimarAlmacenamiento(): Promise<{ usado: number; cuota: number } | undefined>;
```

- `EntradaOsz` gana `fondo?: { nombre: string; bytes: Uint8Array }` y
  `video?: { nombre: string; bytes: Uint8Array }`; `construirOsz` los mete al
  zip sin recomprimir (`level: 0`).
- `mimeDesdeNombre` agrega `mp4`/`m4v` (`video/mp4`), `webm` (`video/webm`),
  `jpeg`, `png`, `webp` (`image/webp`), `gif`.
- **Busqueda en el zip tolerante**: helper interno `buscarEnZip(zip, nombre)`
  que prueba exacto y, si no, compara normalizando (`\` a `/`, sin `./`
  inicial, minusculas). Se usa para audio, fondo y video. Un `.osz` real
  muchas veces trae `BG.JPG` declarado como `bg.jpg`.
- Fondo: se toma de la primera dificultad (en el orden de siempre) que declare
  uno que exista en el zip. Mismo criterio para el video.
- Video con extension no reproducible (`avi`, `flv`, `mpg`, `wmv`): se ignora
  en silencio (la cancion se importa igual, sin video).
- `importarOsz` llena `importadaEn` y, despues de guardar, llama a
  `pedirAlmacenamientoPersistente()` sin esperar su resultado para nada.
- `exportarCancion`: usa `escribirOsu` de core por dificultad, el nombre de
  audio de `dificultades[0].metadata.audioFile`, y los nombres de fondo/video
  declarados en la metadata (si el Blob existe). El resultado reimportado da
  la misma cancion (mismo titulo, mismas dificultades, mismas notas).
- La version de la base **no cambia** (los campos nuevos son opcionales en el
  mismo object store; no hace falta migrar).

## Criterios de aceptacion

- [ ] Un `.osu` con `0,0,"BG.jpg",0,0` y `Video,-120,"vid.mp4"` parsea con
      `backgroundFile: 'BG.jpg'`, `videoFile: 'vid.mp4'`, `videoOffset: -120`.
- [ ] Rutas con `\` quedan con `/`; lineas de sprites/breaks no afectan.
- [ ] Un `.osz` con `bg.JPG` en el zip y `"bg.jpg"` en el `.osu` importa con fondo.
- [ ] Un `.osz` con video `.avi` importa sin video y sin error.
- [ ] `exportarCancion` + `importarOsz` = misma cancion (test).
- [ ] `borrarCancion` la saca de `listarCanciones`.
- [ ] Los cuatro checks en verde; ningun test existente cambia de expectativa
      salvo los que verificaban `[Events]` vacio en el escritor (documentarlo).

## Tests

- `osu.test.ts`: fondo con y sin comillas, alias `Background`, video con `Video`
  y con `1`, ruta con `\`, `[Events]` con basura, Source/Tags.
- `osu-escritor` roundtrip con fondo y video.
- `osz.test.ts`: busqueda tolerante, fondo de la segunda dificultad, video no
  reproducible ignorado, mime nuevos.
- `index.test.ts` (fake-indexeddb, como los existentes): borrar, exportar y
  reimportar.

## Fuera de alcance

Cualquier UI (T-052, T-053). Storyboards. Reparsear canciones ya guardadas
(no se guardo el `.osz` original: las viejas siguen sin fondo hasta
reimportarlas).

## Terminado cuando

Los cuatro checks en verde y el reporte lista cualquier decision no cubierta.
