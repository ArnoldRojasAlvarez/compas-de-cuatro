# T-024 · Global: fondo, transiciones entre pantallas, botones, menu y header

| | |
|---|---|
| **Fase** | 3 · La cascara (pasada grafica) |
| **Modelo** | Sonnet |
| **Rama** | `main` directo (ver "Git") |
| **Depende de** | T-010, T-012, header persistente, `docs/DISENO.md` |

## Contexto

Las pantallas cambian de golpe (el router reemplaza `#app`), el fondo es un
color plano y los botones no tienen microinteracciones. El header persistente
(`apps/web/src/header.ts`, CSS en `apps/web/src/header.css`) existe pero es
muy basico.

**Restriccion fuerte:** `apps/web/src/router.ts` y `apps/web/src/menu.ts` son
de otro trabajador que esta trabajando en paralelo (agrega un boton
"Mapeador" al menu). **No los toques.** Todo lo del menu se hace por CSS
(`apps/web/src/menu.css`), tokens o `logo.ts` si hiciera falta (no hace).
Tampoco toques `game.ts`, `results.ts`, `song-select.ts`, `ajustes.ts`,
`packages/`, ni ningun archivo `mapeador*`.

## Contrato

Archivos tuyos: `apps/web/src/style.css` (solo las reglas base: `body`,
`#app`, controles base `#app button`, inputs, etc.; las lineas `@import` de
arriba no se tocan salvo para agregar las tuyas), `apps/web/src/tokens.css`,
`apps/web/src/menu.css`, `apps/web/src/header.css`, `apps/web/src/header.ts`,
`apps/web/index.html` (si hace falta, por ejemplo `theme-color`).

### 1. Fondo

- En `body`: gradiente radial muy sutil (un halo teal casi imperceptible,
  alpha <= 0.06, arriba al centro) sobre `--fondo`, mas una **rejilla de cuatro
  columnas** muy tenue (lineas verticales `--linea` a alpha ~0.25, que dividen
  el ancho en cuatro), hecha con `background-image` (gradientes lineales) y
  `background-attachment: fixed`. Sin imagenes externas.
- En partida (`body.tetra-en-juego`) el fondo vuelve a ser plano `--fondo`: la
  pista no compite con nada.

### 2. Transiciones entre pantallas

- Sin tocar el router: animacion de entrada en CSS para los hijos directos de
  `#app` (`#app > *`): fade + translateY de 6 a 8px, 180 a 220ms, ease-out.
  Cada vez que el router reemplaza el contenido, los nodos nuevos entran
  animados. `animation-fill-mode: both` con estado final `transform: none`
  (que no deja un containing block que rompa `position: fixed` de hijos).
- **Excepcion**: en partida no se anima nada (`body.tetra-en-juego #app > *`
  sin animacion): el primer frame de la pista no se puede retrasar.
- `@media (prefers-reduced-motion: reduce)`: sin animaciones ni transiciones
  en toda la app (regla global que las apague).

### 3. Botones y controles base

- Microinteracciones en `#app button`: transicion de `background`,
  `border-color`, `color` y `transform` (120 a 160ms); `:active` con
  `translateY(1px)`; el primario (`.tetra-boton-primario`) con un brillo
  tenue del acento en hover (`box-shadow` con el acento a alpha baja).
- Foco visible consistente (ya existe, revisar que se vea en todos los
  fondos).
- Tipografia: revisar `line-height`, `-webkit-font-smoothing: antialiased`,
  `text-rendering: optimizeLegibility`, y que titulos usen `--fuente-display`
  con `text-wrap: balance`.
- Tokens nuevos si hacen falta (por ejemplo `--duracion-rapida: 140ms`,
  `--curva-salida`, `--sombra-acento`), agregados a `tokens.css` sin cambiar
  los existentes.

### 4. Menu (solo `menu.css`)

- Titulo del menu con un poco mas de presencia (peso, tracking), lema en
  `--tinta-2`. Botones de acceso con el mismo lenguaje de microinteracciones.
  Que se vea bien si aparece un tercer boton (Mapeador) en
  `.tetra-menu-accesos` sin tocar menu.ts.

### 5. Header (`header.ts` y `header.css`)

- Pulir: fondo `--fondo` con alpha y `backdrop-filter: blur(8px)`, marca
  "Tetra" con un detalle de cuatro barras chicas (CSS) a la izquierda, datos
  en mono tabular. Mantener alto 32px (`--alto-header`) y `pointer-events:
  none`.
- **Bug de rendimiento a corregir** (hallazgo de QA): el ciclo de rAF del
  header llama `pintarHora()` todos los frames para siempre, tambien durante la
  partida, y `formatearHora(new Date())` aloca un `Date` y strings en cada
  frame del loop de juego. Corregir: mientras `document.body` tenga la clase
  `CLASE_EN_JUEGO`, el ciclo no pinta (o mejor, el ciclo solo pinta cuando
  cambia el segundo/minuto sin alocar en los frames intermedios). La hora del
  header no es tiempo de juego: no hay regla del reloj que aplique, pero el
  loop de juego no tiene que pagar su costo.

## Criterios de aceptacion

- [ ] Fondo con halo y rejilla de cuatro columnas, plano en partida.
- [ ] Transicion de entrada en cada cambio de pantalla, ninguna en partida, nada con reduced-motion.
- [ ] Botones con hover/active/foco consistentes en todas las pantallas.
- [ ] Header pulido y sin trabajo por frame durante la partida.
- [ ] `router.ts`, `menu.ts` y archivos de otras pantallas sin tocar.

## Tests

Si extraes logica pura del header (por ejemplo "hay que repintar"), con test.
Los tests de `tiempo-jugado.test.ts` siguen pasando.

## Fuera de alcance

Las pantallas de los otros tickets (T-019 a T-023), el mapeador, el router.

## Git

Directo en `main`, compartido. `git add` SOLO con rutas explicitas de tu
lista. Jamas `git add -A`, stash, checkout, reset, rebase. Commit: `feat(web):
fondo, transiciones, microinteracciones y header pulido (T-024)` y la linea
`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Terminado cuando

Los cuatro checks en verde (si falla algo en archivos que no son tuyos,
reintenta o aisla con vitest y declaralo) y el commit hecho.
