# T-064 · Bloqueo de los atajos del navegador durante la partida

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Rama** | `feat/bloqueo-atajos` (worktree) |
| **Depende de** | T-026, T-037, T-057, T-060 |

## Contexto

Arnold puede apretar por accidente, en plena partida, combinaciones que hacen
cosas en el navegador o cierran la pestaña. Caso concreto: en Opera, Alt + 7 del
teclado numérico. Con el juego en vivo ante público no puede pasar.

## Qué se hizo

Tres capas, de la que siempre anda a la que depende del navegador. Todo vive
mientras corre `runGame` (partida y pausa) y se apaga en `limpiar()`.

1. **preventDefault** en `keydown` y `keyup` de todo lo que el juego no usa
   (`apps/web/src/bloqueo-atajos.ts`, listener de captura en `window`, nunca
   `stopPropagation`: la entrada recibe el mismo evento, con su `timeStamp`, en el
   mismo orden). La decisión es la función pura `debeBloquearTecla`
   (`bloqueo-atajos-logica.ts`, con tests):
   - Siempre pasan: F11, Escape sin modificadores.
   - Pasan sin Ctrl, Alt ni Meta: F3, F4, `, Espacio, `-`, `=`, el `+` y el `-`
     del teclado numérico (y el `+` de otras distribuciones, por `key`).
   - En la pausa también pasan Tab, Enter, Espacio y flechas (los botones del menú).
   - Se bloquea el resto: cualquier combinación con Ctrl, Alt o Meta (incluso
     con teclas del juego), el teclado numérico, F1, F2, F5, F10, F12, Shift+Escape
     y las propias teclas Alt, Meta y Ctrl, también en `keyup` (soltar Alt solo
     abre la barra de menú).
   - Los carriles se bloquean también (no cortan la entrada): evita la búsqueda
     rápida de Firefox con `'` y `/`.
2. **Keyboard Lock API** (solo Chromium): con la partida en pantalla completa se
   llama a `navigator.keyboard.lock()` con casi todo el teclado menos F11, lo que
   captura Ctrl+W, Ctrl+T, Ctrl+N y Ctrl+Tab. Se suelta al salir de pantalla
   completa o de la partida. Sin soporte (Firefox, Safari) no hace nada ni da
   errores. Con el bloqueo, mantener Escape sale de pantalla completa y una
   pulsación corta llega a la página (la pausa sigue andando).
3. **beforeunload** con confirmación solo mientras hay partida (o pausa).

La lista "Antes de presentar" de ajustes suma una nota: jugar en pantalla
completa para que el bloqueo sea total, y Alt+Tab, la tecla Windows y Alt+F4
fuera de pantalla completa no se pueden bloquear desde una página.

## Límites

- Alt+Tab, la tecla Windows y Alt+F4 los toma el sistema operativo: ninguna
  página puede bloquearlos. Ctrl+Alt+Supr tampoco.
- Fuera de pantalla completa (o en navegadores sin Keyboard Lock) Ctrl+W, Ctrl+T,
  Ctrl+N y Ctrl+Tab no se pueden capturar; queda `beforeunload` como red.
- Los menús (React) no cambian: no hay bloqueo fuera de la partida.
- La pantalla completa y el Keyboard Lock reales no se pudieron ejercitar en
  Chromium sin cabeza: el e2e usa dobles de `navigator.keyboard` y de
  `document.fullscreenElement`. Falta que Arnold lo pruebe en Opera con la
  presentación (F) y Ctrl+W en plena partida.

## Tests

- `bloqueo-atajos-logica.test.ts`: la decisión por tecla y contexto, la lista del
  lock (sin F11) y las condiciones de captura y de confirmación.
- `e2e/bloqueo-atajos.spec.ts`: con pulsaciones reales, Alt+numpad, Alt solo,
  Ctrl+W, F1 y Tab se previenen en partida y no en el menú; Escape pausa; en la
  pausa Tab pasa; `beforeunload` solo con partida; el lock se pide en pantalla
  completa y se suelta al salir; sin `navigator.keyboard` no hay errores.
