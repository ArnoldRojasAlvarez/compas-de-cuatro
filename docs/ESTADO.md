# Estado del proyecto

Ultima actualizacion: 13 de octubre de 2026.

Estado corto y siempre al dia. **Si sos una sesion NUEVA, empeza por
`docs/HANDOFF.md`** (metodo de trabajo, reglas, lecciones), despues
`CLAUDE.md` y `docs/DISENO.md`. Este archivo solo dice donde estamos.

## Donde esta todo

- `main`: limpio, verde, 1520 tests + 64 e2e (ver nota de T-061 abajo; el e2e se verifica con `--workers=1`, ver T-063).
- Estado demo: menu con musica de la biblioteca, song select sobre la escena, partida con fondo y video, cuatro skins propias, cancion demo sembrada.
- En curso: nada.

## Hecho

| Ticket | Que es |
|---|---|
| Fase 0 | Monorepo npm workspaces, TS estricto, ESLint 9, Vitest, CI |
| T-001 | Reloj de juego contra `AudioContext` (verificado con e2e real, sin deriva) |
| T-002, T-003 | Ventanas de juicio por OD, motor de score, combo y HP |
| T-004 | Pista en Pixi, entrada de teclado, bucle y resultados |
| T-005 | Importador de `.osu`/`.osz` mania 4K y `@tetra/storage` |
| T-006 | Cargador de desarrollo (ya reemplazado por el song select) |
| T-007 | Calibracion de offset y desviacion medida en ms |
| T-008 | Velocidad de caida ajustable y salir con Escape |
| T-009 | Skins `.osk` cargadas por el usuario |
| T-010 | Sistema de diseno propio, menu y logo que respira |
| T-011 | Router, song select con biblioteca y dificultades, ajustes |
| T-012 | Ajustes pulidos, remapeo de teclas, FPS, entrada por `e.code` (bug de teclas muertas) |
| T-013 | Motor de dificultad de siete skillsets en `core` (escalas provisionales) |
| T-014 | Estrellas y perfil de skillsets en el song select, Web Worker, cache versionada |
| T-016 | Motor v2: stamina como media movil del strain en estrellas, anclada en regimen; exponente de estrellas (version 2) |
| T-017 | Jackspeed en cualquier fila con jack; chordjack igual que T-013 (version 3) |
| T-018 | Calibracion v1 con 54 SR de osu! lazer: Spearman 0.962, error medio 0.21 estrellas (version 4) |
| Header | Header persistente con hora y tiempo jugado acumulado (suma el tiempo de cancion real, oculto en partida) |
| T-015 | Herramienta `#calibracion`: SR de osu! por dificultad, Spearman, ajuste log-log, export JSON |
| T-019 | HUD de partida: combo con pulso (reloj de juego), precision y score en mono, barra de vida y de progreso, FPS opcional; solo escribe al DOM si cambia |
| T-020 | Pista con paleta propia: fondo con gradiente, carriles, notas tinta/teal, flash por columna, un juicio reutilizado (sin `new Text` por golpe) |
| T-021 | Resultados: rango S/A/B/C/D, precision destacada, barras por juicio, grafico nitido con puntos por juicio |
| T-022 | Song select: tarjetas con portada (object URLs cacheados y revocados), estrellas por nivel, perfil legible, estado vacio |
| T-023 | Ajustes en cuatro tarjetas numeradas, controles de 36px, teclas como keycaps |
| T-024 | Fondo con halo y rejilla de cuatro columnas, transicion de entrada por pantalla, microinteracciones, header sin trabajo por frame |
| T-025 | Mapeador: editor manual (canvas, rejilla, onda, grabacion en vivo, deshacer), mapeo automatico por onsets y tempo con cuatro niveles, analisis en Web Worker, probar, guardar en la biblioteca y exportar `.osz`/`.osu` |
| T-026 | Pausa con Escape (menu Continuar, Reintentar, Salir; cuenta regresiva de 3 s medida con otro `AudioContext`; el reloj se congela con `ctx.suspend()`) y reintento sin volver al song select |
| T-037 | Modo presentacion: atajo F o boton en ajustes, sin header ni textos de ayuda, interfaz 10 % mas grande, cursor que se oculta a los 2 s, lista "Antes de presentar"; la pantalla completa real no se pudo verificar en el panel de pruebas |
| T-032 | Reabrir una cancion de la biblioteca en el mapeador (boton "Editar en el mapeador" en el song select), guardar reemplaza o agrega dificultades sobre la misma cancion, conserva tempos y velocidades originales, boton "Nuevo" |
| T-035 | "Probar desde el cabezal" (`runGame` acepta `inicioMs` como cuarto parametro opcional: solo cuentan las notas desde ahi, sin misses de las anteriores) y compensacion de latencia al grabar en vivo (offset de calibracion + latencia de salida, mismo ajuste que `clock.now()`) |
| T-040 | E2E de pausa (reloj congelado, cuenta regresiva, reintentar) y del mapeador de punta a punta (cargar audio, generar, editar, deshacer, guardar, reabrir), estables 3 de 3; tests de rendimiento sin depender de la carga; CI con un job `e2e` aparte (nunca corrio en GitHub: no hay repositorio remoto) |
| T-049 | `parseOsu` lee fondo y video de `[Events]`, Source y Tags; busqueda tolerante en el zip; video mp4/webm; `borrarCancion`, `exportarCancion`, almacenamiento persistente |
| T-050 | Cuatro skins propias (Tetra, Barras, Circulos, Diamantes) dibujadas con Canvas; destello al golpe, glow de la linea de juicio, opacidad de pista |
| T-051 | Cancion demo "Primer Compas" compuesta por codigo y sintetizada en el navegador (82 s, 128 BPM), Facil 1.1, Normal 2.3, Dificil 3.9 estrellas, fondo generativo; se siembra sola una vez |
| T-052 | Escena: fondo de la cancion a pantalla completa; menu con musica de la biblioteca (pausa, siguiente); song select minimalista con preview visible, exportar y borrar, importar soltando en cualquier parte |
| T-053 | Partida a pantalla completa con fondo atenuado y video sincronizado al reloj, intro, HUD limpio, volumen; resultados con fondo; ajustes con poco texto, skins en miniatura, atenuacion y video |
| T-055 | Records por dificultad: mejor y ultima partida, intentos, conteos de cada juicio, rango SS; se ven en el song select (detalle, chips y lista) y con aviso de nuevo record en resultados |
| T-061 | Diagnostico de tirones con "Mostrar FPS": frames > 30 ms con su momento, densidad y atribucion de long-animation-frame; histograma; linea en resultados y boton "Copiar diagnóstico" (JSON) |
| T-059 | Rendimiento: el "54 fps" era el contador (1000/dt con el reloj de audio, que avanza por bloques); el juego va a 16,7 ms con p99 16,8 en GPU real. Contador nuevo `60 fps · 17 ms max` (promedio de 500 ms y peor frame), layouts de 60/s a 8/s, flecha de la barra de error con transform, T-039 (pista sin objetos por frame), arnes `tools/medir-rendimiento.mjs`. Pendiente: un tiron aislado del driver de GPU, opcion experimental de baja latencia |
| T-048 | Tildes y enie en todo texto visible (UI y mensajes de error de los paquetes); "Fácil"/"Difícil" se muestran con tilde sin cambiar el `difficultyName` guardado; `tildes.test.ts` vigila palabras comunes sin tilde y rayas |
| T-034 | Mapeador: Mayus+arrastrar elige (rectangulo alineado a la grilla), Ctrl+A/C/X/V, Supr, Alt+flechas mueve (slot o columna), Q cuantiza; cada operacion es un paso de deshacer; el portapapeles sobrevive entre dificultades |
| T-046 | Minimapa del mapeador: onda, densidad de notas, huecos de mas de 8 compases en ambar, marcas cada 8 compases, cabezal y zona visible; clic o arrastre salta |
| T-045 | Estadisticas globales: historial por partida completada (tienda `historial`, base v7, tope 2000, viaja en el respaldo, no se borra con la cancion), pantalla con partidas, tiempo, precision y desviacion medias (ponderadas por notas), graficos por dia, fallos por columna y temprano/tarde; cuarto boton del menu y el bloque Jugado del header |
| T-044 | Replay y modo auto: `replayPerfecto` (todo MAX), grabar y reproducir con resultado identico (motor determinista: cada evento resuelve antes lo expirado hasta su tiempo; expiracion por frame con margen de 50 ms para no correr pulsaciones atrasadas), mejor partida en la tienda `replays` (base v6) y en el respaldo; "Ver auto" (Ctrl+Enter), "Ver mejor partida", Auto en el mapeador |
| T-058 | Velocidad y offset con barra en ajustes (offset con `-`/`+` de 1 ms y doble clic a 0); las cinco barras iguales |
| T-027 | Hitsounds sintetizados (Normal, Suave, Seco) programados en el instante del golpe, solo en golpes validos; volumen de efectos aparte del de musica; tipo de golpe en ajustes |
| T-057 | Offset por cancion (control en el song select, teclas - y =; "Corregir offset" ajusta el de la cancion), velocidad en vivo con F3/F4, desviacion media y pulsaciones en el record con aviso si pasa de 8 ms |
| T-042 | Respaldo de la biblioteca en zip (canciones con audio, fondo y video, skins, records, ajustes), restaurar sin pisar ni duplicar, tarjeta "05 Biblioteca" en ajustes con uso de almacenamiento |
| T-056 | Partida: cajitas con pulsaciones por tecla, contador de juicios en vivo, barra de error con media movil, reintento manteniendo ` 0,5 s, saltar intro con Espacio; resultados con pulsaciones y UR; el record guarda pulsaciones y desviacion media |
| T-054 | Pulido: legibilidad sobre portadas, dificultades de facil a dificil, audio de cualquier dificultad, errores cerrables, fondo del menu inmediato |
| T-060 | LN que desaparecian: el cuerpo se dibuja si el tramo entero toca la pista (test que falla en el codigo viejo); offset GLOBAL por defecto (es el del equipo, como en osu!): teclas `-`/`=` en partida, "Ajustar offset" en la pausa y "Corregir offset" en resultados lo corrigen, con "Solo esta canción" como opcion chica; media en vivo junto a la barra de error; "Calibrar" en ajustes (metronomo a 120 BPM, fechado con el mapa de tiempo de T-063); el offset por cancion es una barra compacta (la de T-058) en el song select con arrastre, rueda, flechas, doble clic a 0 y teclas `-`/`=`. Los 95 ms de Xevel eran el total (68 previos + 27): la cuenta es correcta, el boton ahora dice de cuanto a cuanto |
| T-063 | Reloj interpolado: `ctx.currentTime` avanza en rafagas de ~10 ms y cada pulsacion heredaba hasta un bloque de error (12 ms de rango medidos, std 2,9); ahora el reloj se ancla a `getOutputTimestamp()` e interpola con `performance.now()` (rango 0,2 ms, std 0,03), `clock.desdeTimeStamp(ts)` fecha la entrada, la pista se dibuja suave, y el interpolado nunca se aleja mas de 30 ms de la lectura cruda (el audio manda); `tools/medir-reloj.mjs` lo mide en Chromium real. Ojo: el e2e en paralelo (workers por defecto) falla por carga en la maquina de Arnold tambien en `main`; verificar con `--workers=1` |
| T-064 | Bloqueo de atajos del navegador en partida: preventDefault de todo lo que el juego no usa (Alt+numpad, Alt solo, Ctrl+W/P/R, F1, F5; decisión pura `debeBloquearTecla`), Keyboard Lock en pantalla completa en Chromium (Ctrl+W/T/N/Tab, Escape sigue pausando), `beforeunload` solo con partida, y una nota en "Antes de presentar". Alt+Tab, la tecla Windows y Alt+F4 no se pueden bloquear desde una página. Falta la prueba real en Opera con pantalla completa (el e2e usa dobles) |

La prueba de feel de Arnold ya se hizo: en una cancion real sus golpes salieron
centrados en cero. El motor esta bien sincronizado.

## En curso

- **T-061, nota:** el e2e `diagnostico-tirones.spec.ts` fallo 1 vez de 28 sin poder ver el error (la primera corrida tras un build en frio, con otro agente corriendo su e2e en el mismo puerto 4173). Sospecha: la linea de resultados formatea un "peor" de mas de 999 ms con separador de miles y la regex del test espera `\d+ ms`. Revisar antes de dar el test por estable.
- **T-062 (modo practica):** escrito, listo para despachar (T-060 y T-061 ya entraron).



| Ticket | Que es | Estado |
|---|---|---|

## Lo que sigue despues

- **Tirones en el Opera de Arnold: resuelto.** El diagnostico de T-061 mostro
  renderer "Microsoft Basic Render Driver" (sin GPU, 332 frames de 33 ms en
  Xevel). Con la aceleracion por hardware activada en Opera: ANGLE Intel Iris
  Xe, p50 16,6 y p99 17,1 ms, un solo tiron de 66 ms antes de empezar.
- **Prueba de feel de T-063 (pendiente de Arnold):** jugar Xevel Expert con el
  reloj nuevo. Antes: media +27 ms tarde, desvio 32 ms, 429 MAX. Se espera que
  el desvio baje mucho y la media quede parecida (la cuantizacion solo
  explicaba ~4 ms del sesgo; el resto es la cadena visual de vsync, unos 20 a
  30 ms a 60 Hz, mas el teclado: lo que corrige el offset global). Despues,
  recalibrar el offset global con dos o tres partidas.
- **Idea para probar (feel):** dibujar la pista un vsync adelante (`t + 16,7
  ms`) para que la nota se vea donde corresponde al presentarse el frame; el
  juicio no cambia. Reduciria el sesgo visual sin tocar el offset. Ver T-063,
  "Fuera de alcance".

- **Pendiente chico de T-048:** el titulo de la demo sigue "Primer Compas" (es un
  dato guardado y la clave para no duplicarla). Para "Primer Compás" en
  instalaciones nuevas: cambiar `TITULO_DEMO`, sumar el titulo viejo al chequeo
  de duplicado en `demo/index.ts` y actualizar dos tests. Decision de Arnold.
- **Mapeador:** hoy mover la seleccion es Alt+flechas (las flechas solas mueven
  el cabezal). Si Arnold prefiere flechas solas con seleccion activa, es chico.
- **Backlog restante:** T-038 responsive, T-043 accesibilidad y temas, T-047
  primera ejecucion guiada, T-031 SV, T-033 tempo variable, T-036 automapa v2,
  T-041 Prettier (solo cuando no haya trabajo en vuelo).

- **Backlog de mejoras:** `docs/BACKLOG.md` indexa los tickets T-026 a T-048
  (pausa, hitsounds, records, mejoras del mapeador, modo presentacion, e2e,
  accesibilidad, respaldo y mas), con prioridad, dependencias y decisiones
  pendientes de Arnold.

- **Calibracion con datos:** la herramienta ya esta (T-015). Falta que Arnold
  anote el SR de osu! de unas 25 dificultades. Los `.osz` de Arnold los
  importa osu! lazer y desaparecen de Descargas; se leen de su almacen con
  `medir-lazer.mjs` (scratchpad, ver T-017).
- **Mapeador con musica real:** probar el automatico con la cancion de Arnold,
  revisar BPM de oido y ver que ajustes de `PRESETS_AUTO` hacen falta. Ideas
  pendientes: tempo variable, copiar y pegar, latencia de grabacion, reabrir en
  el editor una cancion de la biblioteca (ver `docs/tickets/T-025-mapeador.md`).
- **Probar en el navegador sin sonido:** en `npm run dev`, poner
  `localStorage.setItem('tetra:mudo','1')` en la consola silencia todo el audio
  de esa pestana (lo inyecta `vite.config.ts`, solo en dev y por navegador).
- **La cancion y el video del avance II (28 de octubre):** camino critico del
  curso, no depende del codigo.

## Deuda declarada

- **Scripts y Vitest usan la `dist`:** `npm run dev` y `npm run build` ya leen
  el fuente de los paquetes (alias en `apps/web/vite.config.ts`). Los scripts
  de medicion y Vitest siguen importando la `dist`: correr `npm run typecheck`
  despues de cambiar un paquete.

- **Calibracion parcial:** 54 dificultades de chordjack, jumpstream y stream,
  SR 1.3 a 6.3 (datos en `docs/calibracion/`). Sin cobertura de jacks de un
  dedo, tech ni mapas de mas de 6.3; jackspeed sigue con peso 1 sin datos.
  Por eso `MODELO_CALIBRADO = false` y la UI sigue diciendo "provisional".

- **Cambios de velocidad (SV):** se parsean del `.osu` pero no se aplican al
  dibujo. Todo se ve a multiplicador 1.
- **Bono por combo:** el score es proporcional a la precision, sin bono.
- **Musica del menu:** suena la biblioteca (T-052). El logo y la musica
  arrancan con el primer clic o tecla (politica de autoplay del navegador).
- **Canciones viejas sin fondo:** las importadas antes de T-049 no guardaron el
  `.osz`; para ver su fondo hay que reimportarlas.
- **Miss por tiempo 50 ms mas tarde:** desde T-044 la expiracion por frame va con margen (ver arriba). No cambia ningun juicio, solo cuando se ve el MISS.
- **Sintesis de la demo:** 5 a 13 s en una maquina cargada (en segundo plano, no
  bloquea). Facil queda en 1.1 estrellas: con negras puras el modelo no llega a 1.5.

## Decisiones pendientes de Arnold

- Tomadas el 7 de octubre: score sin bono por combo (T-029 cerrado); tildes y enie en la interfaz (T-048, se hace despues de T-034/T-046).

- **Repositorio remoto en GitHub.** `gh` esta autenticado. No se creo porque
  publicar es su decision. La CI nunca corrio de verdad, solo localmente.

## Calendario del curso (manda sobre el tecnico)

| Fecha | Entrega |
|---|---|
| 28 de octubre | Avance II por TECDigital: desarrollo, cronograma y video de la cancion |
| 18 de noviembre | Avance III: conclusiones, anexos, bibliografia |
| Semana 17 | Presentacion y ejecucion en vivo ante publico |

## Como jugarlo

`npm run dev` desde la raiz, abrir la URL de Vite. Menu, Jugar, soltar un `.osz`
de mania 4K o el click track. Teclas D, F, J, K por defecto.
