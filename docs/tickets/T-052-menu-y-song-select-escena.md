# T-052 · Escena: menu con musica de la biblioteca y song select minimalista

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Rama** | `feat/escena-menu-song-select` (worktree) |
| **Depende de** | T-049 (fondos, borrar, exportar), T-051 (evento `tetra:biblioteca-cambio`), T-022, T-024 |

## Contexto

Arnold pidio dejar el juego en estado demo: **minimalista, sin saturar la
pantalla de texto**, que muestre la informacion de la cancion, que la
reproduzca y que use sus imagenes (muchas traen fondo). Hoy el menu suena con
el click track y el song select tiene mucho texto y controles a la vista.

Este ticket rehace el menu y el song select alrededor de una **escena**: el
fondo de la cancion que suena ocupa toda la ventana (con blur y oscurecido),
y la interfaz flota encima con poco texto.

## Contrato

### `apps/web/src/fondo-escena.ts` (nuevo)

```ts
export interface OpcionesFondo {
  /** px de blur. Default 0. */
  desenfoque?: number;
  /** 0 a 1: cuanto se oscurece la imagen. Default 0.6. */
  oscuridad?: number;
}
export interface FondoEscena {
  /** Pone la imagen (o el fondo por defecto si `imagen` es undefined) con un fundido de ~400 ms. Llamar con el mismo Blob no hace nada. */
  poner(imagen: Blob | undefined, opciones?: OpcionesFondo): void;
  /** Vuelve al fondo por defecto y revoca los object URLs. */
  limpiar(): void;
}
/** Singleton: una capa fija detras de #app (z-index bajo, pointer-events none). */
export function fondoEscena(): FondoEscena;
```

- Dos capas que se cruzan (fundido); object URLs creados una vez por Blob y
  revocados al reemplazarse.
- El fondo por defecto es el halo y la rejilla de T-024 que ya existen (no
  los dupliques: si viven en `style.css` sobre `body`, la capa de imagen va
  encima y en "sin imagen" queda transparente).
- Respeta `prefers-reduced-motion` (sin fundido).

### `apps/web/src/musica-menu.ts` (nuevo)

La musica del menu deja de ser el click track: suena una cancion de la
biblioteca (`listarCanciones`), desde su `previewTime`, con fundido de entrada,
y al terminar pasa a otra (sin repetir la ultima si hay mas de una). Si la
biblioteca esta vacia, el click track de siempre. Expone lo que el logo
necesita (un `AnalyserNode`) y lo que el menu muestra:

```ts
export interface MusicaMenu {
  readonly analizador: AnalyserNode | null;
  /** Cancion sonando (o null con el click track). */
  readonly actual: CancionGuardada | null;
  siguiente(): Promise<void>;
  alternarPausa(): void;
  readonly pausada: boolean;
  /** Se llama cuando cambia `actual` o `pausada`. */
  alCambiar(cb: () => void): void;
  detener(): void;
}
export function crearMusicaMenu(): MusicaMenu;
```

- Ganancia con `gananciaDeVolumen(leerVolumen())` de `apps/web/src/volumen.ts`
  (ya existe).
- Un `AudioContext` propio, aparte del reloj de juego (CLAUDE.md, regla 1). Se
  cierra en `detener()`.
- Politica de autoplay: si el contexto arranca suspendido, se reanuda con el
  primer `pointerdown`/`keydown` (como hoy el logo).
- Si llega el evento `tetra:biblioteca-cambio` mientras suena el click track,
  pasa a la primera cancion (asi la demo de T-051 entra sola).
- `logo.ts` deja de crear su propio audio: recibe el analizador (o null) desde
  el menu. La logica del pulso (`logo-logica.ts`) no cambia.

### Menu (`menu.ts`)

- Fuera el titulo duplicado "Tetra" y el lema: el logo ya dice TETRA. El logo
  un poco mas grande (≈ 220 px). Clic en el logo = Jugar.
- Botones Jugar, Mapeador, Ajustes (mismos textos: los usa el e2e).
- Abajo a la izquierda, discreto: **lo que suena** en una linea
  (`Titulo · Artista`, mono pequeno, `--tinta-2`) con dos botones-icono SVG
  (pausa/reproducir y siguiente, con `aria-label`). Nada mas.
- El fondo de la escena es el de la cancion que suena (`oscuridad` ~0.7,
  `desenfoque` ~2 px).
- Al ir a Jugar, el song select abre con esa cancion enfocada (opcion nueva
  `cancionInicial?: SongId` en `OpcionesSongSelect`; el router la pasa).

### Song select (`song-select.ts`, `song-select.css`)

Mismo comportamiento de fondo (buscar, ordenar, filtrar, teclado, worker de
dificultad, importar, jugar, editar en el mapeador, boton de volver desde
resultados), otra cara:

- **Fondo de escena** = portada de la cancion enfocada (`desenfoque` ~12 px,
  `oscuridad` ~0.65). Cambia con fundido al moverse por la lista.
- **Izquierda, la cancion enfocada** (protagonista, sin caja pesada): titulo
  grande (Sora), artista, y en una linea mono chica: creador, BPM (rango si
  varia), duracion, notas. Fuente (`source`) si existe, tenue. Debajo, las
  dificultades como chips con la estrella coloreada (T-022); la elegida
  resaltada. El perfil de skillsets queda, compacto (barras finas, sin
  parrafos). Boton grande **Jugar**.
- **Reproductor del preview**: el preview arranca solo al enfocar (como hoy) y
  ahora se ve: un boton-icono pausa/reproducir y una barra fina de progreso de
  la cancion (posicion actual sobre la duracion total; clic en la barra salta
  a esa posicion del preview). Volumen de `volumen.ts`.
- **Acciones secundarias** como botones-icono con `aria-label` y `title`
  (sin texto visible): editar en el mapeador (su nombre accesible sigue siendo
  "Editar en el mapeador", lo usa el e2e), exportar `.osz` (`exportarCancion`,
  descarga con `<a download>`), borrar (`borrarCancion`, con confirmacion en
  dos pasos sobre el mismo boton: primer clic pide confirmar 3 s).
- **Derecha, la lista**: tarjetas compactas con la portada como miniatura o
  fondo (T-022), titulo y artista; la enfocada se destaca. Arriba, un solo
  campo de busqueda; orden y filtro de estrellas detras de un boton-icono de
  filtros que despliega una fila (cerrada por defecto).
- **Importar**: un boton-icono "+" (nombre accesible "Importar .osz") y soltar
  un `.osz` en **cualquier lugar de la ventana** muestra un velo con
  "Soltar para importar". Se va la caja punteada fija.
- "Jugar click track" sigue existiendo como boton visible (lo usa el e2e),
  pero chico y secundario (al pie de la lista).
- Estado vacio: una sola linea y el boton de importar. Sin parrafos.
- El encabezado "Elegir cancion" sigue siendo un `h1` accesible (lo usa el
  e2e); puede ser chico.
- Escuchar `tetra:biblioteca-cambio` en `window` mientras el song select esta
  montado: recargar la lista conservando el foco. Quitar el listener al salir.
- Al salir (jugar, menu) llamar `fondoEscena().limpiar()` **salvo** al jugar:
  la partida pone su propio fondo (T-053) y conviene no parpadear; en ese caso
  dejarlo como esta.

### Texto y tono

Menos es mas. Ningun parrafo de ayuda visible por defecto; si algo necesita
explicacion, `title`. Etiquetas cortas. Mayusculas con letter-spacing solo en
etiquetas de datos.

## Criterios de aceptacion

- [ ] Con canciones con fondo, el menu y el song select muestran la imagen de
      la cancion a pantalla completa, con fundido al cambiar.
- [ ] Sin canciones: el menu suena con el click track; al sembrarse la demo
      (T-051) pasa a la demo sin recargar.
- [ ] El preview se puede pausar y saltar; la barra avanza.
- [ ] Borrar y exportar funcionan; borrar la cancion enfocada mueve el foco a
      la siguiente.
- [ ] Soltar un `.osz` en cualquier parte importa.
- [ ] Sin audios colgados al cambiar de pantalla (menu, song select, partida,
      ajustes, mapeador): un solo `AudioContext` de musica vivo a la vez.
- [ ] 1280x800 y 1920x1080 sin scroll de pagina en el song select; 1024x640
      usable.
- [ ] e2e (`cd apps/web && npx playwright test`) en verde y los cuatro checks.

## Tests

Logica pura nueva en `*-logica.ts` con tests: elegir la siguiente cancion del
menu sin repetir, formateo de la linea de datos (BPM con rango, duracion
mm:ss), posicion de la barra de progreso a partir de un clic.

## Fuera de alcance

La partida, resultados y ajustes (T-053). La cancion demo (T-051).

## Terminado cuando

Los cuatro checks y el e2e en verde, y el reporte describe cada pantalla.
