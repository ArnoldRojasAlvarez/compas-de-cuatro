# T-059 · Rendimiento de la partida (caidas de fps)

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Opus (medicion y diagnostico) + Sonnet (arreglos) |
| **Prioridad** | Alta: lo pidio Arnold el 7 de octubre |
| **Incluye** | T-039 (pista sin allocaciones) |

## Contexto

Arnold noto caidas abruptas de fps jugando: el contador cambiaba tan seguido
que casi no se leia, y vio valores como 54 en un monitor que deberia ir
estable. En un juego de ritmo un frame perdido se ve como un tiron de las notas
aunque el juicio siga bien (el reloj es el audio).

Desde la pasada del estado demo se sumaron cosas por frame que nunca se
midieron juntas: fondo con imagen y velo, video sincronizado, skins dibujadas
con destello aditivo y glow, juicio con sombra, cajitas de teclas, contador de
juicios, barra de error, aviso de velocidad, intro, replay, hitsounds (un
`AudioBufferSourceNode` por golpe) y la capa `fondo-escena` con `filter: blur`
que puede seguir viva detras de la pista.

## Primero medir, despues arreglar

1. **Medicion reproducible** (antes de tocar nada): un e2e o script de
   Playwright que juegue en modo auto (T-044) un mapa denso (Difícil de la demo
   y un mapa de prueba de 8 a 12 notas por segundo) durante 30 s, a 1280x800 y
   1920x1080, y registre la duracion de cada frame (desde el propio rAF, solo
   para medir: no es gameplay). Reportar p50, p95, p99, frames > 20 ms y
   frames > 33 ms. Con y sin fondo, con y sin video, con cada skin, con los
   contadores prendidos y apagados.
2. **Perfil** con el Performance de Chromium (trazas de Playwright) en los
   peores casos: que parte del frame se lleva el tiempo (script, estilos,
   layout, pintado, composicion, GPU), y si hay pausas del recolector.
3. **Hipotesis a confirmar o descartar con datos** (no arreglar a ciegas):
   - `filter: blur()` de `fondo-escena` o de resultados vivo detras de la
     partida; `backdrop-filter` en elementos del HUD.
   - Escrituras al DOM del HUD que disparan layout (contadores, barra de
     error, precision): deberian ser `transform`/`opacity` o texto sin cambiar
     el tamano de la caja.
   - Allocaciones por frame (T-039: `avanzarVentana`, closures en el bucle,
     arrays en `drain()`), destellos y glow de Pixi, `Text` con `dropShadow`.
   - Sincronia del video (`currentTime` asignado muy seguido).
   - Resolucion del lienzo de Pixi (`resolution: min(dpr, 2)`).
4. **Arreglos** solo de lo que la medicion senale, cada uno con su numero
   antes y despues.

## Tambien

- **El contador de fps es ilegible**: hoy se escribe cada frame. Mostrar el
  promedio de los ultimos ~500 ms (de tiempo de juego) y, al lado, el peor
  frame de esa ventana (`60 fps · 22 ms max`). Asi se lee y ademas delata los
  tirones.
- Dejar el script de medicion en `tools/` o como e2e opcional para repetirlo
  despues de cada ticket que toque la partida.

## Criterios de aceptacion

- [ ] Tabla de medicion antes y despues en el reporte (y en `docs/`).
- [ ] En la maquina de Arnold, el Difícil de la demo a 1920x1080 con fondo,
      skin Tetra y contadores prendidos: p99 por debajo de 20 ms a 60 Hz y
      ningun frame de mas de 33 ms despues del primer segundo.
- [ ] El contador de fps se puede leer.
- [ ] Los cuatro checks y el e2e en verde; el reloj sigue siendo el audio.
