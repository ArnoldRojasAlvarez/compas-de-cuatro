# T-023 · Ajustes: tarjetas por seccion y controles consistentes

| | |
|---|---|
| **Fase** | 3 · La cascara (pasada grafica) |
| **Modelo** | Sonnet |
| **Rama** | `main` directo (ver "Git") |
| **Depende de** | T-012, `docs/DISENO.md` |

## Contexto

`apps/web/src/ajustes.ts` ya esta organizado en secciones (Juego, Teclas,
Graficos, Apariencia) con `crearSeccion`, pero visualmente es una columna de
controles con poca jerarquia. CSS en `apps/web/src/ajustes.css`.

## Contrato

- `mostrarAjustes` y `OpcionesAjustes` no cambian. Toda la logica (offset,
  velocidad, remapeo de teclas con su validacion, interruptor de FPS, skins)
  queda igual. Lo que cambia es el marcado y el estilo.
- Se pueden cambiar clases y estructura del DOM dentro de `ajustes.ts`.

### Diseno

- **Tarjetas**: cada seccion es una tarjeta (`--superficie`, borde `--linea`,
  `--radio-panel`), con titulo en mayusculas chicas con letter-spacing
  (`--tinta-3`) y un indice numerico en mono a la izquierda del titulo (`01`,
  `02`, `03`, `04`: el cuatro de la marca). En ancho >= 900px, grilla de dos
  columnas de tarjetas; en angosto, una.
- **Filas de control consistentes**: cada ajuste es una fila con etiqueta a
  la izquierda (nombre en `--tinta`, ayuda en `--tinta-2` chica debajo) y el
  control a la derecha, alineados. El mismo alto de control (por ejemplo 36px)
  para botones, inputs numericos y selects.
- **Valores numericos** (offset, velocidad) en mono tabular, con los botones
  de mas y menos pegados al input como un solo control segmentado.
- **Teclas**: los cuatro casilleros parecen teclas (keycaps): mono grande,
  borde inferior mas grueso, en modo captura borde y texto `--acento` con un
  pulso suave (sin pulso con `prefers-reduced-motion`). Columnas 1 y 2
  (interiores) con un detalle en acento y 0 y 3 en tinta, igual que la pista
  (T-020).
- **Interruptor de FPS**: se mantiene `.tetra-toggle` (vive en `style.css`, no
  lo edites ahi; si necesitas ajustarlo, sobreescribilo en `ajustes.css` con un
  selector mas especifico como `.tetra-ajustes .tetra-toggle`).
- **Skin**: el boton de importar `.osk` y el select de skin activa en la misma
  fila; el nombre de la skin activa visible.
- Mensajes de error con borde izquierdo `--j-miss`.
- Encabezado de la pantalla: titulo en Sora a la izquierda y boton volver.

### CSS

Todo en `apps/web/src/ajustes.css` (ya existe, ya importado desde
`style.css`). **No edites `style.css`.**

## Criterios de aceptacion

- [ ] Cuatro tarjetas con titulo e indice; grilla de dos columnas en ancho.
- [ ] Controles del mismo alto, alineados; numeros en mono.
- [ ] Teclas como keycaps, captura visible.
- [ ] Todo lo que funcionaba sigue igual (guardar offset, velocidad, teclas, FPS, skin).
- [ ] Se ve bien a 1280x800 y a 375 de ancho.

## Tests

Si extraes logica pura nueva, con test. Los tests existentes siguen pasando.
Este ticket es mayormente visual: la verificacion es mirarlo.

## Fuera de alcance

Ajustes nuevos, cambiar como se persisten.

## Git

Directo en `main`, compartido. `git add` SOLO con rutas explicitas
(`apps/web/src/ajustes.ts`, `apps/web/src/ajustes.css`). Jamas `git add -A`,
stash, checkout, reset, rebase. Commit: `feat(web): ajustes en tarjetas con
controles consistentes (T-023)` y la linea `Co-Authored-By: Claude Sonnet 5.5
<noreply@anthropic.com>`.

## Terminado cuando

Los cuatro checks en verde (si falla algo en archivos que no son tuyos,
reintenta o aisla con vitest y declaralo) y el commit hecho.
