# Estado del proyecto

Ultima actualizacion: 7 de octubre de 2026.

Estado corto y siempre al dia. **Si sos una sesion NUEVA, empeza por
`docs/HANDOFF.md`** (metodo de trabajo, reglas, lecciones), despues
`CLAUDE.md` y `docs/DISENO.md`. Este archivo solo dice donde estamos.

## Donde esta todo

- `main`: limpio, verde, 1128 tests + 27 e2e.
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
| T-027 | Hitsounds sintetizados (Normal, Suave, Seco) programados en el instante del golpe, solo en golpes validos; volumen de efectos aparte del de musica; tipo de golpe en ajustes |
| T-057 | Offset por cancion (control en el song select, teclas - y =; "Corregir offset" ajusta el de la cancion), velocidad en vivo con F3/F4, desviacion media y pulsaciones en el record con aviso si pasa de 8 ms |
| T-042 | Respaldo de la biblioteca en zip (canciones con audio, fondo y video, skins, records, ajustes), restaurar sin pisar ni duplicar, tarjeta "05 Biblioteca" en ajustes con uso de almacenamiento |
| T-056 | Partida: cajitas con pulsaciones por tecla, contador de juicios en vivo, barra de error con media movil, reintento manteniendo ` 0,5 s, saltar intro con Espacio; resultados con pulsaciones y UR; el record guarda pulsaciones y desviacion media |
| T-054 | Pulido: legibilidad sobre portadas, dificultades de facil a dificil, audio de cualquier dificultad, errores cerrables, fondo del menu inmediato |

La prueba de feel de Arnold ya se hizo: en una cancion real sus golpes salieron
centrados en cero. El motor esta bien sincronizado.

## En curso


| Ticket | Que es | Estado |
|---|---|---|

## Lo que sigue despues

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
- **Sintesis de la demo:** 5 a 13 s en una maquina cargada (en segundo plano, no
  bloquea). Facil queda en 1.1 estrellas: con negras puras el modelo no llega a 1.5.

## Decisiones pendientes de Arnold

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
