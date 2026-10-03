# T-021 · Pantalla de resultados: rango, datos destacados, conteos y grafico

| | |
|---|---|
| **Fase** | 3 · La cascara (pasada grafica) |
| **Modelo** | Sonnet |
| **Rama** | `main` directo (ver "Git") |
| **Depende de** | T-004, T-007, `docs/DISENO.md` |

## Contexto

`apps/web/src/results.ts` muestra texto plano ("Score: ..", "Max: 12") y un
grafico de desviacion con colores sueltos (`#14141c`, `#6ee7b7`). Es la
pantalla donde el jugador mira su medicion: tiene que lucirse.

## Contrato

- `mostrarResultados(contenedor, estado, desviaciones, offsetActual)` y la
  interfaz `Desviacion` **no cambian**. El boton de corregir offset (T-007)
  mantiene su comportamiento y su clase `.tetra-resultados-corregir`.
- `song-select.ts` agrega despues, a `#app` (no al panel), el boton
  `.tetra-resultados-volver-song-select` con texto "Volver al song select".
  **No toques song-select.ts.** Tu layout tiene que verse bien con ese boton
  agregado al final de `#app` como hermano del panel.

### Logica pura nueva: `apps/web/src/resultados-logica.ts`

```ts
export type Rango = 'S' | 'A' | 'B' | 'C' | 'D';
/** accuracy de 0 a 1. S >= 0.95, A >= 0.90, B >= 0.80, C >= 0.70, D el resto. */
export function rangoDePrecision(accuracy: number): Rango;
/** Fraccion 0..1 de cada juicio sobre el total de juicios (total 0 => todo 0). */
export function fraccionesDeJuicio(counts: Record<Judgement, number>): Record<Judgement, number>;
```

(`Judgement` de `@tetra/core`.)

### Diseno

- **Bloque principal** (grilla de dos columnas en ancho >= 720px, una en
  angosto): a la izquierda la **letra de rango** enorme (Sora, ~8rem), color
  por rango: S `--acento`, A `--j-200`, B `--j-100`, C `--j-50`, D `--j-miss`.
  A la derecha, **precision** grande en mono (es el dato estrella: `98.53%`),
  debajo score y combo maximo en mono tabular, con etiquetas en mayusculas
  chicas `--tinta-3`.
- **Conteos por juicio**: una fila por juicio (`JUDGEMENTS` en orden) con
  nombre, cantidad en mono tabular y una barra horizontal proporcional a
  `fraccionesDeJuicio` en el color del juicio: max `--j-max`, perfect
  `--j-300`, great `--j-200`, good `--j-100`, bad `--j-50`, miss `--j-miss`.
- **Estadisticas** (media, desviacion estandar, temprano/tarde): como chips o
  celdas de dato, mono, con etiqueta.
- **Grafico de desviacion** (canvas 2D, se dibuja una vez): fondo
  `--superficie` (leer los tokens con `getComputedStyle(document.documentElement)`
  una vez, con fallback hex), bandas horizontales tenues que marcan las
  ventanas de juicio NO (no se conocen aca: fuera de alcance), linea de cero en
  `--acento` con alpha, rejilla horizontal tenue en `--linea`, puntos
  coloreados **por juicio** con los colores `--j-*`, los miss como marcas en
  el borde (o una x) en `--j-miss`. Etiquetas en `JetBrains Mono` 11px
  `--tinta-3`. Respetar `devicePixelRatio` para que no se vea borroso (canvas
  interno escalado, tamano CSS fijo y responsivo con `max-width: 100%`).
- Entrada de la pantalla: aparicion escalonada sutil de los bloques (opacity
  + translateY corto, CSS), desactivada con `prefers-reduced-motion`.
- Una sola cosa brilla: el rango (o la precision). El resto en neutros.

### CSS

Todo en `apps/web/src/resultados.css` (ya existe, ya importado desde
`style.css`). **No edites `style.css`.** Incluye ahi el estilo del boton
`.tetra-resultados-volver-song-select` (se puede destacar como accion
principal de la pantalla, con el acento).

## Criterios de aceptacion

- [ ] Letra de rango grande con su color; precision, score y combo maximo destacados en mono.
- [ ] Conteos con barra proporcional en el color del juicio.
- [ ] Grafico nitido (DPR), puntos por color de juicio, linea de cero y rejilla.
- [ ] Boton de corregir offset y boton de volver siguen funcionando.
- [ ] Se ve bien a 1280x800 y a 375 de ancho.

## Tests

`apps/web/src/resultados-logica.test.ts`: bordes exactos de cada rango
(0.95 es S, 0.9499 es A, 0.70 es C, 0.6999 es D, 1 es S, 0 es D); fracciones
que suman 1, total 0 da ceros.

## Fuera de alcance

Guardar historial de partidas, ventanas de juicio en el grafico, cambiar
song-select.ts.

## Git

Directo en `main`, compartido. `git add` SOLO con rutas explicitas
(`apps/web/src/results.ts`, `apps/web/src/resultados-logica.ts`,
`apps/web/src/resultados-logica.test.ts`, `apps/web/src/resultados.css`).
Jamas `git add -A`, stash, checkout, reset, rebase. Commit: `feat(web):
resultados con rango, conteos por juicio y grafico limpio (T-021)` y la linea
`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Terminado cuando

Los cuatro checks en verde (si falla algo en archivos que no son tuyos,
reintenta o aisla con vitest y declaralo) y el commit hecho.
