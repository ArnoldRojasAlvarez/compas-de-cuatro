# T-059 · Medición del rendimiento de la partida

Mediciones de la partida en modo auto (T-044), repetibles con
`tools/medir-rendimiento.mjs`. Este documento se completa en tres tramos: la
tabla base (antes de tocar código de producción), el diagnóstico y la tabla
después de cada arreglo.

## Cómo se mide

- Script: `node tools/medir-rendimiento.mjs --build --escenarios=todos --res=1280x800,1920x1080`.
  Abre la app en Chromium con Playwright (siempre con `--mute-audio`: no suena
  nada), siembra la demo, importa un mapa sintético denso, elige la dificultad
  y pulsa "Ver auto". El resumen de una traza sale de `tools/resumir-traza.mjs`.
- Ventana de medición: 30 s de reloj de juego, de 10 s a 40 s (el reloj de
  juego decide cuándo empieza y termina, no un temporizador). Dentro, un `rAF`
  propio de la página, solo para medir, guarda la duración de cada frame. No es
  gameplay: el juego sigue leyendo `clock.now()`.
- Mapas: Difícil de "Primer Compás" (879 notas, 45 largas, de 5 a 16 notas por
  segundo) y "Denso 11" (sintético, 11 notas por segundo constantes, 504 notas,
  audio en silencio).
- Fondo: la portada de la demo (1920x1080). Video: un webm VP8 de 1280x720 a 30
  fps generado por el script y reempaquetado con el ffmpeg de Playwright (el
  Chromium de Playwright no trae H.264). Skin: Tetra salvo que se diga otra.
  Contadores: teclas, juicios y barra de error. FPS: el contador del HUD,
  encendido por defecto.

### Renderer y límites del entorno

- Renderer de WebGL que usó el Chromium (`UNMASKED_RENDERER`):
  `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A1) Direct3D11 vs_5_0 ps_5_0, D3D11)`.
  Es la GPU real de la máquina (Intel Iris Xe, i7-1365U, 16 GB, monitor de
  1920x1200 a 60 Hz). Chromium 153.0.8010.12, Windows 10, DPR 1.
- Por defecto el headless de Playwright cae en SwiftShader (`ANGLE (Google,
  Vulkan 1.3.0 (SwiftShader Device ...))`, software), que no sirve para decidir.
  Se evita con `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist` (lo
  hace el script por defecto, `--gpu=software` lo deshabilita).
- No se pudo usar una ventana visible: `chrome.exe` completo no se puede
  ejecutar desde esta sesión (`Permission denied`), solo el
  `chrome-headless-shell`. En headless los frames salen de un temporizador de
  60 Hz y no del vsync del monitor ni del DWM, así que **el arnés no ve la
  contención con otros programas ni la presentación real en pantalla**. Los
  tirones de más abajo son los que sí aparecen en este entorno; la máquina de
  Arnold puede tener otros.
- La máquina estaba casi en reposo (sin otros `node` ni navegadores de
  pruebas); los porcentajes de CPU de la tabla son del hilo principal del
  renderer (`TaskDuration` de CDP) y tienen ±3 puntos de ruido entre corridas.

## Tabla base (antes de cualquier arreglo)

Duración de cada frame en ms (rAF), 30 s de juego, una corrida por fila. A 60 Hz
un frame sano dura 16,7 ms. "CPU %" es el porcentaje del hilo principal;
"layouts/s" son los cálculos de layout por segundo (60 = uno por frame).

| escenario | resolución | p50 | p95 | p99 | max | > 20 ms | > 33 ms | CPU % | layouts/s |
|---|---|---|---|---|---|---|---|---|---|
| base | 1280x800 | 16.7 | 16.7 | 16.8 | 100.1 | 1 | 1 | 19 | 60 |
| base | 1920x1080 | 16.7 | 16.8 | 16.8 | 183.4 | 1 | 1 | 19 | 60 |
| sin-fondo | 1280x800 | 16.7 | 16.7 | 16.8 | 16.8 | 0 | 0 | 16 | 60 |
| sin-fondo | 1920x1080 | 16.7 | 16.8 | 16.8 | 50.0 | 1 | 1 | 16 | 60 |
| video | 1280x800 | 16.7 | 16.7 | 16.8 | 83.3 | 2 | 2 | 16 | 60 |
| video | 1920x1080 | 16.7 | 16.7 | 16.8 | 150.1 | 3 | 3 | 16 | 60 |
| skin-barras | 1280x800 | 16.7 | 16.8 | 16.8 | 116.7 | 1 | 1 | 14 | 60 |
| skin-barras | 1920x1080 | 16.7 | 16.8 | 16.8 | 183.4 | 1 | 1 | 14 | 60 |
| skin-circulos | 1280x800 | 16.7 | 16.7 | 16.8 | 83.4 | 1 | 1 | 13 | 60 |
| skin-circulos | 1920x1080 | 16.7 | 16.7 | 16.8 | 183.4 | 1 | 1 | 13 | 60 |
| skin-diamantes | 1280x800 | 16.7 | 16.7 | 16.8 | 83.3 | 1 | 1 | 14 | 60 |
| skin-diamantes | 1920x1080 | 16.7 | 16.7 | 16.8 | 166.7 | 1 | 1 | 11 | 60 |
| sin-contadores | 1280x800 | 16.7 | 16.7 | 16.8 | 33.3 | 1 | 1 | 10 | 60 |
| sin-contadores | 1920x1080 | 16.7 | 16.7 | 16.8 | 83.4 | 1 | 1 | 9 | 60 |
| sin-fps | 1280x800 | 16.7 | 16.7 | 16.8 | 49.9 | 1 | 1 | 9 | 7 |
| sin-fps | 1920x1080 | 16.7 | 16.7 | 16.8 | 116.7 | 1 | 1 | 12 | 7 |
| minimo (sin fondo, contadores ni fps) | 1280x800 | 16.7 | 16.8 | 16.8 | 100.0 | 1 | 1 | 6 | 7 |
| minimo | 1920x1080 | 16.7 | 16.8 | 16.8 | 150.0 | 1 | 1 | 4 | 7 |
| denso (11 notas/s) | 1280x800 | 16.7 | 16.7 | 16.8 | 16.8 | 0 | 0 | 14 | 60 |
| denso | 1920x1080 | 16.7 | 16.7 | 16.8 | 16.8 | 0 | 0 | 12 | 60 |
| denso-sin-fondo | 1280x800 | 16.7 | 16.7 | 16.8 | 16.8 | 0 | 0 | 11 | 60 |
| denso-sin-fondo | 1920x1080 | 16.7 | 16.8 | 16.8 | 16.8 | 0 | 0 | 12 | 60 |
| denso-video | 1280x800 | 16.7 | 16.7 | 16.8 | 16.8 | 0 | 0 | 12 | 60 |
| denso-video | 1920x1080 | 16.7 | 16.7 | 16.8 | 16.8 | 0 | 0 | 10 | 60 |
| denso-minimo | 1280x800 | 16.7 | 16.7 | 16.8 | 16.8 | 0 | 0 | 5 | 11 |
| denso-minimo | 1920x1080 | 16.7 | 16.7 | 16.8 | 16.8 | 0 | 0 | 7 | 11 |

Lectura rápida: salvo un único tirón por corrida, todos los frames duran
16,7 ms (p99 de 16,8 ms en las 26 filas). El tirón existe en todos los
escenarios de la demo y no en el mapa sintético; se estudia en el diagnóstico.

### Lo que marca hoy el contador de fps del HUD

El contador actual calcula `1000 / (t de este frame - t del anterior)` con
`clock.now()` y escribe el resultado en cada frame. Con los frames reales
cayendo cada 16,7 ms (p99 16,8 ms) y calculado sobre los mismos 30 s, esa
lectura sale así (es igual en las 26 filas):

| dato | valor |
|---|---|
| duración de frame vista por el reloj de audio, p50 | 18,7 ms |
| lectura instantánea del contador, mínimo ordinario (p5) | 47 fps |
| lectura instantánea del contador, p95 | 125 fps |
| frames cuya lectura cae fuera de 55 a 65 fps | 100 % |

Una captura de la partida a los 37,7 s muestra `54 fps / 18.7 ms` mientras el
`rAF` va a 16,7 ms exactos: es el "54" que vio Arnold.

## Traza del caso más pesado

`base`, 1920x1080, 30 s de traza (`node tools/medir-rendimiento.mjs --escenarios=base
--res=1920x1080 --traza=traza.json --traza-s=30` y `node tools/resumir-traza.mjs
traza.json`). Por segundo de traza:

| hilo | ocupado | por frame (60 por s) |
|---|---|---|
| Renderer, hilo principal | 138,8 ms (13,9 %) | 2,3 ms |
| GPU, hilo principal | 134,4 ms (13,4 %) | 2,2 ms |
| Renderer, compositor | 91,3 ms (9,1 %) | 1,5 ms |
| GPU, VizCompositor | 39,3 ms (3,9 %) | 0,7 ms |

En el hilo principal, tiempo propio por segundo: script 29,8 ms
(`FunctionCall` 24,7), estilos 17,9 (`Document::recalcStyle`, 1792 veces en
30 s: una por frame), pintado 18,3, actualización de capas del compositor 10,6,
layout 7,0 (1790 veces: uno por frame), `HitTest` 5,7 (solo del mouse sintético
del headless). `FireAnimationFrame` (el JS de los rAF): p50 0,1 ms, p99 0,5 ms,
máximo 1,6 ms. Recolector de basura: 3 GC menores (1,5 ms en total) y 9 mayores
(21,5 ms en total, el peor de 4,1 ms) en 30 s. Tareas del hilo principal de más
de 8 ms: 1 (8,2 ms, el primer frame de la traza).

El frame cuesta cerca de 2 ms de CPU y 2 ms de GPU de un presupuesto de 16,7 ms.
El único tirón de la traza está en el proceso de GPU (ver el diagnóstico).

## Diagnóstico

### Causas confirmadas (con el número que las demuestra)

1. **El contador de fps era ilegible por cómo medía, no por el juego.** Calculaba
   `1000 / dt` en cada frame con `dt` del reloj de audio, que avanza de a bloques
   (2,67 ms por bloque de render, y en Windows a veces de a 10 ms). Con los frames
   cayendo cada 16,7 ms (p99 16,8 ms) el contador cambiaba 60 veces por segundo y
   decía entre 47 y 125 fps (en las corridas con tirón, hasta 5 fps); el 100 % de
   las lecturas quedaba fuera de 55 a 65. La captura a los 37,7 s muestra
   `54 fps / 18.7 ms` con el rAF a 16,7 ms: es el 54 que vio Arnold.
2. **El contador reescribía su texto en cada frame**, y eso forzaba estilos y layout
   60 veces por segundo (`layouts/s` 60; sin el contador, 7). Tiempo de layout
   del hilo principal: 1,3 a 1,7 % antes, 0,4 % después de escribirlo dos veces por segundo.
3. **La flecha de la barra de error animaba `left`.** Con una persona tocando (teclado
   simulado con error de timing) había 55 layouts por segundo y 2,0 % de tiempo de
   layout; con la transición desactivada, 12 y 0,7 %. En auto no se ve porque el bot
   pega siempre al centro y la flecha no se mueve.

### Hipótesis del ticket que los datos descartan

| hipótesis | dato |
|---|---|
| `filter: blur()` de `fondo-escena` vivo detrás de la partida | con la capa en `display: none` el tirón y la CPU quedan igual (167 contra 200 ms, 16 contra 19 %); en la traza la GPU no gasta nada en eso |
| `backdrop-filter` en el HUD | no hay ninguno: solo el header (oculto en partida), los menús y la pausa |
| Escrituras al DOM que disparan layout | solo las dos de arriba; el resto del HUD (combo, score, precisión, vida, progreso, juicios, cajitas, marcas) da 7 a 12 layouts por segundo, uno por golpe, y 0,3 a 0,7 % de layout |
| Allocaciones por frame y GC (T-039) | el heap sube 258 KB/s en todo el juego, 11 GC en 30 s, y la traza da 3 GC menores (1,5 ms en total) y 9 mayores (21,5 ms, el peor de 4,1 ms). T-039 baja 4 objetos por frame y el heap sigue en 258 contra 257 KB/s: no mueve nada medible |
| Destellos aditivos, glow, `Text` con `dropShadow` | ninguna subida de textura ni creación de objetos de WebGL en 15 s de partida; la GPU gasta 2,2 ms por frame |
| Las cuatro skins | misma cadencia (p99 16,8 ms); la CPU baja o sube dentro del ruido |
| Fondo con imagen y velo | con y sin fondo el p99 es el mismo; el tirón aparece en los dos |
| Video: `currentTime` asignado muy seguido | 0 asignaciones, 0 `play()` y 0 `pause()` en 30 s con video |
| Antialias y alfa del lienzo, hitsounds, audio de salida, HUD entero, el cuerpo de las notas largas fuera de pantalla | probados uno por uno contra el tirón de abajo: ninguno lo cambia |
| Doble rAF (el ticker de Pixi y el del juego) | probado con `autoStart: false` y `app.render()` dentro del frame: mismo p99, mismo tirón. No se adopta: adelantaría el dibujo un frame y movería la calibración de offset que Arnold ya hizo |
| Resolución del lienzo (`min(dpr, 2)`) | no cambia el costo medio, pero agranda el tirón de abajo (150 a 233 ms con DPR 1, 267 con 1,5, 417 con 2; con `resolution: 1` a DPR 2, 167 ms) |

### Pendiente: un tirón aislado de la GPU

En el Difícil de la demo hay **un tirón por corrida** de 33 a 233 ms (en las corridas
con más carga del sistema llegó a 0,9 y hasta 1,7 s) y no en el mapa sintético.
Lo que se sabe:

- Cae siempre en el mismo punto de la partida: entre 38,0 y 38,2 s de reloj de juego
  (y con otra partición de la canción, en 22,9 y 29,2 s, cuando la pantalla queda
  casi vacía). No cambia con `--seek`: depende de la posición en la canción.
- La causa es el mapa y no el audio: el Difícil sobre audio en silencio lo repite;
  Normal y Fácil con el mismo audio no. No es el cuerpo de las notas largas fuera de
  pantalla (se probó dejar de dibujarlo), ni los sonidos, ni el HUD, ni el fondo, ni
  el video, ni las skins, ni el modo de antialias o alfa del lienzo.
- Está en el proceso de GPU: una sola tarea `CommandBuffer::Flush` del contexto WebGL de
  222 ms sin eventos hijos (el tiempo se va dentro del driver D3D11), con el hilo
  principal del renderer ocioso y los comandos de ese frame idénticos a los de los
  frames sanos (un `drawElements`, un `bufferSubData`).
- Desaparece con `--disable-gpu-compositing` (composición por software) y si se pausa y
  reanuda la partida una vez; una página con WebGL trivial no lo tiene en 60 s.
- Crece con los píxeles (ventana y DPR) y con la carga del resto de la máquina.
- Con el contexto WebGL creado con `desynchronized: true` el tirón no apareció en las
  primeras corridas del arnés (máximo de 17 a 33 ms), mientras que `preserveDrawingBuffer`
  y `powerPreference` lo dejaron igual. Esa opción quedó como el ajuste "dibujo de baja
  latencia" (`tetra:dibujo-baja-latencia`), que **nace apagado y sin casilla en Ajustes**
  (una fila más en Apariencia hace que Ajustes no entre en 1280x800; se prende desde
  la consola con `localStorage.setItem('tetra:dibujo-baja-latencia', 'true')`): en una
  pantalla real puede mostrar cortes en la imagen (tearing) y desde el arnés no se ve. En la última tanda alternada de 4 pares, con la
  máquina cargada (Opera, Discord y GeForce NOW abiertos), el ajuste prendido no se
  distinguió del apagado (frames de más de 33 ms: 1, 18, 111 y 102 contra 8, 26, 61 y 39;
  máximos de 83 a 200 ms en los dos), así que **no está probado que ayude fuera del arnés
  limpio**. Queda como candidato para probar en la máquina de Arnold.
- Límite: sin ventana visible no se pudo ver si pasa con el vsync del monitor y el DWM.
  El contador nuevo muestra el peor frame de cada medio segundo (`60 fps · 183 ms max`):
  jugando el Difícil de la demo unos 40 s en la máquina de Arnold se ve si aparece ahí.

## Arreglos y mediciones antes y después

Las corridas se alternaron (antes, después, antes, después) para repartir el ruido de
la máquina, que tenía Opera, Discord y GeForce NOW abiertos: la carga cambia mucho entre
corridas (los frames de más de 33 ms van de 0 a 100 en la misma versión), así que
**las columnas fiables son las estructurales** (layouts por segundo, tiempo de layout, cambios
del contador); la CPU baja de forma consistente; los tirones no cambian y no se leen como mejora.
"Antes" es el código de la base de esta tabla, "después" el final de la rama, dos rondas
cada una (donde hay dos números van las dos rondas).

| escenario | CPU % antes | CPU % después | layouts/s antes | layouts/s después | layout % antes | layout % después | cambios/s del contador | fps que mostró el contador |
|---|---|---|---|---|---|---|---|---|
| demo Difícil, auto, 1920x1080 | 26 | 18 | 56 | 8 | 2,25 | 0,42 | 56,5 a 1,3 | 0 a 125 a 16 a 61 |
| demo Difícil, auto, 1280x800 | 26 | 19 | 58 | 8 | 2,23 | 0,40 | 58,1 a 1,4 | 1 a 125 a 23 a 61 |
| demo Difícil con video, auto, 1920x1080 | 28 | 20 | 58 | 8 | 2,27 | 0,46 | 57,7 a 1,5 | 1 a 125 a 16 a 62 |
| demo Difícil con video, auto, 1280x800 | 26 | 18 | 60 | 8 | 2,22 | 0,41 | 59,7 a 1,4 | 0 a 125 a 27 a 61 |
| Denso 11, auto, 1920x1080 | 24 | 20 | 60 | 12 | 2,01 | 0,60 | 59,7 a 1,4 | 0 a 125 a 40 a 61 |
| Denso 11, auto, 1280x800 | 28 | 22 | 60 | 12 | 2,34 | 0,63 | 59,9 a 1,4 | 0 a 125 a 56 a 62 |
| demo Difícil, teclado simulado, 1920x1080 | 27 | 23 | 58 | 12 | 3,08 | 0,82 | 57,8 a 1,4 | 0 a 125 a 31 a 61 |

En las dos últimas columnas el primer número es "antes" y el segundo "después" (separados
por "a" cuando son dos cifras seguidas: "56,5 a 1,3" son 56,5 antes y 1,3 después; el rango
de fps "0 a 125 a 16 a 61" son 0 a 125 antes y 16 a 61 después). Los mínimos de fps "después" por
debajo de 55 son ventanas con un tirón; en las ventanas sanas las lecturas son 59 a 61.

### Cada arreglo por separado (corridas alternadas)

| arreglo | medido | antes | después |
|---|---|---|---|
| Contador legible (2b07d92) | cambios de texto por segundo, demo Difícil 1920x1080 | 59,2 a 59,7 | 1,2 a 1,4 |
| | layouts/s, mismo escenario | 59 a 60 | 8 |
| | tiempo de layout | 1,65 a 1,70 % | 0,35 % |
| | texto en la captura de la partida | `54 fps / 18.7 ms` | `60 fps · 17 ms max` |
| Pista sin allocaciones (T-039, 6618a59) | heap de JS que sube por segundo, Difícil | 258 y 259 KB/s | 257 y 256 KB/s (sin cambio medible) |
| | objetos de Pixi construidos en 10 000 frames (test con Pixi falso) | 0 (el pool de 32 se quedaba corto con 40 notas visibles en una columna: crecía) | 0 con 40 notas visibles |
| Flecha con transform (34f74a4) | layouts/s con teclado simulado | 55 y 55 | 12 y 12 |
| | tiempo de layout | 2,19 y 1,91 % | 0,67 y 0,91 % |

### Tabla completa después de los arreglos (una corrida por fila)

Tomada con la máquina más cargada que la tabla base (Opera, Discord y GeForce NOW
abiertos): por eso la CPU sube en todas las filas y aparecen frames de 33 ms sueltos en el mapa
sintético. Sirve para ver que ningún escenario empeora de forma estructural.

| escenario | resolución | p50 | p95 | p99 | max | > 20 ms | > 33 ms | CPU % | layouts/s | contador: cambios/s, fps mostrados |
|---|---|---|---|---|---|---|---|---|---|---|
| base | 1280x800 | 16.7 | 16.7 | 16.8 | 49.9 | 3 | 3 | 21 | 8 | 1.3, 52 a 84 |
| base | 1920x1080 | 16.7 | 16.7 | 16.8 | 133.4 | 2 | 2 | 17 | 8 | 1.4, 47 a 62 |
| sin-fondo | 1280x800 | 16.7 | 16.7 | 16.8 | 100.0 | 1 | 1 | 22 | 8 | 1.2, 49 a 61 |
| sin-fondo | 1920x1080 | 16.7 | 16.7 | 16.8 | 149.9 | 1 | 1 | 21 | 8 | 1.3, 47 a 61 |
| video | 1280x800 | 16.7 | 16.8 | 16.8 | 83.3 | 1 | 1 | 19 | 8 | 1.3, 53 a 61 |
| video | 1920x1080 | 16.7 | 16.7 | 16.8 | 183.4 | 2 | 2 | 22 | 8 | 1.3, 46 a 61 |
| skin-barras | 1280x800 | 16.7 | 16.7 | 16.8 | 83.3 | 1 | 1 | 20 | 8 | 1.3, 53 a 62 |
| skin-barras | 1920x1080 | 16.7 | 16.7 | 16.8 | 116.7 | 1 | 1 | 20 | 8 | 1.3, 48 a 62 |
| skin-circulos | 1280x800 | 16.7 | 16.7 | 16.8 | 133.3 | 1 | 1 | 24 | 8 | 1.4, 47 a 62 |
| skin-circulos | 1920x1080 | 16.7 | 16.7 | 16.8 | 133.3 | 1 | 1 | 23 | 8 | 1.3, 47 a 62 |
| skin-diamantes | 1280x800 | 16.7 | 16.8 | 16.8 | 100.1 | 1 | 1 | 22 | 8 | 1.4, 51 a 61 |
| skin-diamantes | 1920x1080 | 16.7 | 16.7 | 16.8 | 183.3 | 1 | 1 | 21 | 8 | 1.2, 44 a 61 |
| sin-contadores | 1280x800 | 16.7 | 16.7 | 16.8 | 183.4 | 1 | 1 | 13 | 8 | 1.2, 44 a 61 |
| sin-contadores | 1920x1080 | 16.7 | 16.8 | 16.8 | 300.0 | 1 | 1 | 11 | 8 | 1.2, 38 a 61 |
| solo-teclas | 1280x800 | 16.7 | 16.8 | 16.8 | 33.3 | 1 | 1 | 19 | 7 | - |
| solo-teclas | 1920x1080 | 16.7 | 16.7 | 16.8 | 99.9 | 1 | 1 | 18 | 7 | - |
| solo-juicios | 1280x800 | 16.7 | 16.7 | 16.8 | 149.9 | 1 | 1 | 11 | 7 | - |
| solo-juicios | 1920x1080 | 16.7 | 16.8 | 16.8 | 266.7 | 1 | 1 | 12 | 7 | - |
| solo-barra | 1280x800 | 16.7 | 16.8 | 16.8 | 16.8 | 0 | 0 | 12 | 7 | - |
| solo-barra | 1920x1080 | 16.7 | 16.8 | 16.8 | 66.6 | 1 | 1 | 12 | 7 | - |
| sin-fps | 1280x800 | 16.7 | 16.8 | 16.8 | 83.3 | 1 | 1 | 21 | 7 | - |
| sin-fps | 1920x1080 | 16.7 | 16.7 | 16.8 | 166.7 | 1 | 1 | 20 | 7 | - |
| minimo | 1280x800 | 16.7 | 16.7 | 16.8 | 933.3 | 1 | 1 | 12 | 6 | - |
| minimo | 1920x1080 | 16.7 | 16.7 | 16.8 | 1750.0 | 2 | 2 | 12 | 7 | - |
| denso | 1280x800 | 16.7 | 16.8 | 16.8 | 33.3 | 1 | 1 | 26 | 12 | 1.3, 58 a 61 |
| denso | 1920x1080 | 16.7 | 16.8 | 16.8 | 33.4 | 10 | 10 | 26 | 12 | 1.5, 56 a 61 |
| denso-sin-fondo | 1280x800 | 16.7 | 16.7 | 16.8 | 16.8 | 0 | 0 | 25 | 12 | 1.3, 59 a 61 |
| denso-sin-fondo | 1920x1080 | 16.7 | 16.7 | 16.8 | 50.1 | 5 | 5 | 26 | 12 | 1.4, 56 a 61 |
| denso-video | 1280x800 | 16.7 | 16.8 | 16.8 | 33.4 | 15 | 15 | 27 | 12 | 1.5, 56 a 61 |
| denso-video | 1920x1080 | 16.7 | 33.3 | 33.5 | 66.6 | 122 | 122 | 25 | 12 | 1.7, 34 a 61 |
| denso-minimo | 1280x800 | 16.7 | 16.8 | 16.8 | 33.4 | 2 | 2 | 14 | 11 | - |
| denso-minimo | 1920x1080 | 16.7 | 16.7 | 16.8 | 50.0 | 1 | 1 | 13 | 11 | - |

Las filas "minimo" de 933 y 1750 ms son del mismo tirón de la GPU con el sistema cargado.
Las lecturas del contador por debajo de 55 fps son las ventanas con un tirón o con carga
del sistema: el promedio de ese medio segundo baja y el peor frame lo explica.

## Cómo repetir la medición

```
node tools/medir-rendimiento.mjs --build --escenarios=todos --res=1280x800,1920x1080 --heap --salida=resultados.json
node tools/medir-rendimiento.mjs --escenarios=base --res=1920x1080 --traza=traza.json --traza-s=30
node tools/resumir-traza.mjs traza.json
```

Para comparar dos versiones alternadas: compilar la anterior con
`vite build --outDir dist-antes` desde `apps/web` y correr el arnés con `--dist=dist-antes` y
sin él, alternando. Otras opciones (`--notas-humano`, `--baja-latencia`, `--desde`, `--seek`,
`--inyectar`, `--chromium-args`) están en la cabecera del script.
