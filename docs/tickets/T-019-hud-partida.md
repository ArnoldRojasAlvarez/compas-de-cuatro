# T-019 · HUD de la partida: combo, score, precision, vida y progreso

| | |
|---|---|
| **Fase** | 3 · La cascara (pasada grafica) |
| **Modelo** | Sonnet |
| **Rama** | `main` directo (sesion con otro trabajador en el mismo arbol; ver "Git") |
| **Depende de** | T-004, T-012 (contador de FPS), `docs/DISENO.md` |

## Contexto

Hoy el HUD (`apps/web/src/game.ts`, `crearHud` y `actualizarHud`) es una fila
de texto plano debajo del lienzo: "Score: 1234 Combo: 12 (max 40) ...". No
tiene identidad, no muestra la vida (HP) ni cuanto falta de cancion, y
reescribe `textContent` de todo cada frame aunque nada cambie.

Objetivo: un HUD que se lea como un instrumento de medicion (docs/DISENO.md):
datos en JetBrains Mono con `tabular-nums`, una sola cosa que brilla (el
combo), acento teal, ambar de apoyo.

## Contrato

### Logica pura nueva: `apps/web/src/hud-logica.ts`

```ts
/** Escala del combo en un pulso: 1 en reposo; sube a 1 + AMPLITUD_PULSO justo al subir el combo y vuelve a 1 linealmente en DURACION_PULSO_MS. */
export const DURACION_PULSO_MS = 120;
export const AMPLITUD_PULSO = 0.12;
export function escalaPulsoCombo(msDesdeSubida: number): number;
/** Fraccion 0..1 de cancion transcurrida; negativo (lead-in) da 0, mas que la duracion da 1; duracion <= 0 da 0. */
export function fraccionProgreso(t: number, duracion: number): number;
/** "98.53%" con dos decimales; accuracy de 0 a 1. */
export function formatearPrecision(accuracy: number): string;
/** Score con separador de miles fijo (espacio fino o punto, decidi y documenta), sin depender del locale del navegador. */
export function formatearScore(score: number): string;
/** Nivel de alerta de la vida: 'ok' (>= 0.5), 'baja' (>= 0.2), 'critica' (< 0.2). */
export function nivelDeVida(hp: number): 'ok' | 'baja' | 'critica';
```

`escalaPulsoCombo` recibe ms medidos con el **reloj de juego** (`t` de
`clock.now()`), nunca con `performance.now()` ni con el delta de rAF.

### `game.ts`

- `crearHud` y `actualizarHud` se reescriben; su firma interna puede cambiar
  (no son exportadas). `runGame` y `ResultadoPartida` NO cambian.
- Estructura: un envoltorio `.tetra-partida` (position: relative) que contiene
  el `.tetra-lienzo` (canvas de Pixi) y el HUD superpuesto:
  - **Combo**: grande, centrado horizontalmente sobre la pista, a la altura del
    tercio superior-medio (no tapa los receptores). Display `Sora` o mono, a
    tu criterio, pero numerico. Se oculta (o se ve muy tenue) con combo menor
    que 2. Etiqueta chica "COMBO" en mayusculas con letter-spacing.
    Pulso al subir: `transform: scale(escalaPulsoCombo(t - tUltimaSubida))`.
    Al cortarse el combo (vuelve a 0) un destello breve en `--j-miss` es
    opcional.
  - **Score y precision**: arriba a la derecha de la pista (fuera del lienzo,
    al costado), `--fuente-datos`, `tabular-nums`. Precision mas grande que el
    score o al reves, pero con jerarquia clara. Combo maximo chico.
  - **Barra de vida (HP)**: vertical y fina, pegada al borde derecho de la
    pista. Color `--acento`; `--acento-2` (ambar) en nivel 'baja'; `--j-miss`
    en 'critica'. Altura proporcional a `estado.hp` (usar `transform:
    scaleY()` con `transform-origin: bottom`, no `height`, para no forzar
    layout).
  - **Progreso de la cancion**: barra horizontal fina arriba de la pista (ancho
    de la pista), relleno teal tenue, `scaleX(fraccionProgreso(t,
    clock.duration))`.
  - **FPS/ms**: se mantiene, con el mismo interruptor (`leerMostrarFps`), chico
    y en `--tinta-3`, en una esquina.
- Rendimiento (es el loop de juego): **nada de allocaciones evitables por
  frame**. Cachear el ultimo valor mostrado de cada dato y tocar
  `textContent` / `style` solo cuando cambia. Ningun `querySelector` por frame.
  Nada de `classList` toggles por frame salvo cuando cambia el nivel de vida.
  Nada de React. No forzar reflow (no leer `offsetWidth` ni similares).
- El reloj no se toca. El orden del bucle (reloj, entrada, juicio, dibujo,
  HUD) no se toca.

### CSS: `apps/web/src/hud.css`

Ya existe (se movio de `style.css`) y ya esta importado desde `style.css`.
Todo tu CSS va ahi. **No edites `style.css`.** Respeta
`@media (prefers-reduced-motion: reduce)`: sin pulso de escala (el numero
cambia sin animar). Solo tokens de `tokens.css`, nada de colores sueltos salvo
transparencias de un token (`color-mix` o rgba del mismo hex).

## Criterios de aceptacion

- [ ] Combo grande centrado sobre la pista, con pulso al subir, sin tapar receptores.
- [ ] Score, precision y combo maximo en mono tabular, alineados y legibles.
- [ ] Barra de HP vertical con los tres niveles de color; barra de progreso arriba.
- [ ] FPS/ms opcional sigue funcionando con el interruptor de ajustes.
- [ ] Ningun `textContent` ni `style` se escribe si el valor no cambio.
- [ ] Sin `performance.now()`, `Date.now()`, timers nuevos.
- [ ] El e2e de sincronia sigue pasando (`cd apps/web && npx playwright test`) si el entorno lo permite; si no, declaralo.

## Tests

`apps/web/src/hud-logica.test.ts`, que puedan fallar con implementaciones
incorrectas: pulso en 0 ms vale 1 + AMPLITUD, en DURACION/2 vale la mitad del
camino, en >= DURACION vale 1, negativo vale 1; progreso con t negativo, t a
mitad, t pasado; precision con redondeo (0.98535 da "98.54%" o el que
corresponda, explicitalo); score con miles (1234567); nivel de vida en los
bordes exactos 0.5 y 0.2.

## Fuera de alcance

La pista Pixi (T-020), resultados (T-021), cambiar el motor de juicio o el
calculo de HP.

## Git

Trabajas directo en `main`, compartido con otros trabajadores en paralelo.
`git add` SOLO con rutas explicitas tuyas (`apps/web/src/game.ts`,
`apps/web/src/hud-logica.ts`, `apps/web/src/hud-logica.test.ts`,
`apps/web/src/hud.css`). Jamas `git add -A`, stash, checkout, reset, rebase.
Commit: `feat(web): HUD de partida con combo, vida y progreso (T-019)` y la
linea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Terminado cuando

Los cuatro checks en verde (`npm run typecheck && npm run lint && npm run test
&& npm run build`; si falla algo en archivos que no son tuyos, reintenta en
unos minutos o corre vitest sobre tus archivos y declaralo) y el commit hecho.
