# T-022 · Song select: tarjetas con portada, estrellas con color, perfil legible

| | |
|---|---|
| **Fase** | 3 · La cascara (pasada grafica) |
| **Modelo** | Sonnet |
| **Rama** | `main` directo (ver "Git") |
| **Depende de** | T-011, T-012, T-014, `docs/DISENO.md` |

## Contexto

El song select (`apps/web/src/song-select.ts`, CSS en
`apps/web/src/song-select.css`) funciona bien pero se ve como una lista
generica. `CancionGuardada` (de `@tetra/storage`) ya trae `background?: Blob`
(la portada del `.osz`), y hoy no se usa en ningun lado.

## Contrato

- Ninguna funcion exportada cambia (`mostrarSongSelect`, `OpcionesSongSelect`).
  El comportamiento (buscar, ordenar, filtrar por estrellas, preview de audio,
  teclado, jugar, worker de dificultad, boton "Jugar click track", soltar
  `.osz`) queda **igual**. Los textos de botones que usa el e2e ("Jugar click
  track") no cambian.
- **No toques** `mostrarBotonVolverDesdeResultados` (contrato con T-021) ni
  `game.ts`, `results.ts`, `router.ts`, `menu.ts`.

### Logica pura nueva (en `apps/web/src/song-select-logica.ts`, con test)

```ts
export type NivelEstrellas = 'facil' | 'normal' | 'dificil' | 'insano' | 'experto' | 'extremo';
/** < 2 facil, < 3 normal, < 4 dificil, < 5 insano, < 6.5 experto, el resto extremo. NaN o negativo => 'facil'. */
export function nivelDeEstrellas(estrellas: number): NivelEstrellas;
```

Cada nivel tiene un color (en CSS, por clase `tetra-estrella-<nivel>`):
facil `--j-200`, normal `--j-100`, dificil `--acento`, insano `--acento-2`,
experto `--j-miss`, extremo `--j-50`. Los valores de corte se pueden ajustar
si al verlo con mapas reales no se distinguen; documentalo.

### Diseno

- **Tarjetas de cancion**: cada `.tetra-song-item` es una tarjeta con la
  portada de fondo (si existe) cubierta por un velo oscuro en gradiente (de
  `--fondo` opaco a la izquierda a semitransparente a la derecha) para que el
  texto se lea siempre. Sin portada: fondo `--superficie` con una franja
  vertical fina a la izquierda.
  - Object URLs: `URL.createObjectURL(background)` **una vez por cancion**
    (cache `Map<SongId, string>`), nunca por render; revocar todas al salir
    del song select (al jugar, al volver al menu, y antes de recargar la
    biblioteca). Si ya hay un punto de limpieza (por ejemplo donde se
    destruye el reproductor), usalo.
  - Hover: el velo se aclara apenas y la tarjeta se desplaza 2 a 4px a la
    derecha; foco (`:focus-visible` y la cancion enfocada) con borde
    izquierdo en `--acento` y glow muy tenue. Una sola cosa brilla: la
    cancion enfocada.
  - Titulo en Sora, artista en `--tinta-2`, dificultades como chips con la
    estrella coloreada.
- **Panel de detalle**: la portada de la cancion enfocada grande arriba (con
  el mismo velo, alto fijo ~160px), titulo y artista superpuestos abajo a la
  izquierda. Datos (BPM, duracion, notas, etc.) como grilla de celdas mono.
- **Badge de estrellas**: `.tetra-estrella` con el color de
  `nivelDeEstrellas` (fondo del color con alpha baja, borde y texto en el
  color). El marcado de "provisional" (subrayado punteado) se mantiene.
- **Perfil de skillsets**: mas legible: nombre del skillset con ancho fijo,
  pista de la barra visible en `--superficie-2`, barra en `--tinta-3` y la
  dominante en `--acento`, valor en mono tabular alineado a la derecha, un
  poco mas de alto de fila. Mantener las clases existentes si se puede.
- **Estado vacio** (biblioteca sin canciones): bloque con presencia, un icono
  hecho con CSS (cuatro barras verticales, el cuatro de la marca, NO emoji),
  titulo corto ("Tu biblioteca esta vacia"), una linea de ayuda (soltar un
  `.osz` de mania 4K o probar el click track) y la zona de soltar resaltada.
- Zona de soltar `.osz`: borde punteado `--linea`, al arrastrar encima
  (`.tetra-song-select-zona-activa`) borde y texto en `--acento`.
- Respetar `prefers-reduced-motion` (sin desplazamientos).
- Se ve bien a 1280x800 y a 375 de ancho (ya existe un quiebre a 720px).

### CSS

Todo en `apps/web/src/song-select.css` (ya existe y ya esta importado desde
`style.css`). **No edites `style.css`.**

## Criterios de aceptacion

- [ ] Tarjetas con portada (si la hay) y velo legible; sin portada se ven bien igual.
- [ ] Object URLs cacheados por cancion y revocados al salir.
- [ ] Estrellas coloreadas por nivel; perfil de skillsets legible con la dominante en acento.
- [ ] Estado vacio con presencia.
- [ ] Todo lo que funcionaba sigue igual (buscar, filtro, teclado, preview, jugar, click track).

## Tests

En `apps/web/src/song-select-logica.test.ts`: `nivelDeEstrellas` en cada
borde exacto (1.99 facil, 2 normal, 6.49 experto, 6.5 extremo, NaN facil).
Los tests existentes siguen pasando.

## Fuera de alcance

Portadas de tamano reducido (thumbnails generados), cambiar el storage,
paginacion o virtualizacion de la lista.

## Git

Directo en `main`, compartido. `git add` SOLO con rutas explicitas
(`apps/web/src/song-select.ts`, `apps/web/src/song-select-logica.ts`,
`apps/web/src/song-select-logica.test.ts`, `apps/web/src/song-select.css`).
Jamas `git add -A`, stash, checkout, reset, rebase. Commit: `feat(web): song
select con portadas, estrellas por nivel y perfil legible (T-022)` y la linea
`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Terminado cuando

Los cuatro checks en verde (si falla algo en archivos que no son tuyos,
reintenta o aisla con vitest y declaralo) y el commit hecho.
