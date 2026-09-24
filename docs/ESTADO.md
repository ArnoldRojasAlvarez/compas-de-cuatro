# Estado del proyecto

Ultima actualizacion: 24 de setiembre de 2026.

Estado corto y siempre al dia. **Si sos una sesion NUEVA, empeza por
`docs/HANDOFF.md`** (metodo de trabajo, reglas, lecciones), despues
`CLAUDE.md` y `docs/DISENO.md`. Este archivo solo dice donde estamos.

## Donde esta todo

- `main`: limpio, verde, 351 tests + e2e de sincronia.
- En curso: ver tabla de abajo.

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

La prueba de feel de Arnold ya se hizo: en una cancion real sus golpes salieron
centrados en cero. El motor esta bien sincronizado.

## En curso

| Ticket | Que es | Estado |
|---|---|---|
| T-014 | Estrellas y perfil de siete skillsets en el song select, Web Worker, cache | Despachado |

## Lo que sigue despues

- **T-015:** herramienta de calibracion contra mapas de osu! con star rating
  conocido. Arnold aporta 30 a 50 mapas con su SR y arbitra discrepancias.
- **Header persistente** con tiempo y tiempo jugado.
- **La cancion y el video del avance II (28 de octubre):** camino critico del
  curso, no depende del codigo.

## Deuda declarada

- **Estrellas sin calibrar, con sesgo conocido:** la escala provisional
  subestima los jacks (12 golpes/s en un dedo frente a 3 por dedo en un
  stream). Lo corrige T-015. La UI las marca como provisionales.
- **Ajustes en ventanas angostas:** debajo de ~560 px el boton "+1" se cae a
  otra linea y se separa de su grupo. En escritorio se ve bien.

- **Cambios de velocidad (SV):** se parsean del `.osu` pero no se aplican al
  dibujo. Todo se ve a multiplicador 1.
- **Bono por combo:** el score es proporcional a la precision, sin bono.
- **Musica del menu:** hoy es el click track en bucle; falta elegir pista y
  volumen. Y el logo arranca quieto hasta el primer clic (politica de autoplay
  del navegador).

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
