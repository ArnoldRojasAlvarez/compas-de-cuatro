# Estado del proyecto

Ultima actualizacion: 21 de setiembre de 2026.

Este archivo es el punto de entrada para retomar el trabajo. Si estas
empezando una sesion nueva, lee esto y despues `CLAUDE.md`.

## Donde esta todo

- Rama `main`: fases 1 y 2 fusionadas y verificadas. Los cuatro checks en verde.
- **Ya se puede soltar un `.osz` de osu! y jugarlo.** El proximo paso real es
  la prueba de feel de Arnold.

## Lo que ya esta cerrado

| Ticket | Que es | Modelo |
|---|---|---|
| Fase 0 | Monorepo con npm workspaces, TypeScript estricto, ESLint 9, Vitest, CI | Haiku |
| T-001 | Reloj de juego contra `AudioContext` | Sonnet |
| T-001-F1 | Cinco correcciones de la revision de T-001 | Sonnet |
| T-002 | Ventanas de juicio por OD | Sonnet |
| T-003 | Motor de juicio, score, combo y HP | Sonnet |
| Fixture | Click track de 120 BPM con su mapa sincronizado | Haiku |
| T-004 | Pista en Pixi, entrada de teclado, bucle y pantalla de resultados | Sonnet |
| T-005 | Importador de mapas `.osu` mania 4K, y `@tetra/storage` (IndexedDB) | Sonnet |
| T-006 | Cargador de desarrollo: soltar un `.osz` y jugarlo | Sonnet |

156 tests pasando en `main`, mas un e2e de Playwright.

## Como jugarlo ahora mismo

1. `npm run dev` desde la raiz. Abrir la URL que imprime Vite.
2. Soltar un `.osz` de mania 4K (bajado de osu!) en la zona de drop, o darle al
   boton del click track.
3. Teclas por defecto: D, F, J, K.

El `.osz` es contenido de terceros: sirve para probar, no para publicar.

## El riesgo critico quedo verificado

El e2e `apps/web/e2e/sincronia.spec.ts` corrio de verdad en Chromium: durante
60 segundos de reproduccion real de audio, la diferencia entre `clock.now()` y
`ctx.currentTime` se mantuvo constante. Eso es lo que cierra la deuda que venia
arrastrandose desde T-001: no solo la aritmetica del reloj es correcta, el
sistema completo se mantiene sincronizado con audio real en un navegador real.

Un juego de ritmo en web era viable. Ese era el riesgo que podia matar el
proyecto y ya no esta.

Para volver a correr el e2e: `cd apps/web && npx playwright test`. Si se queja
de que falta el navegador, antes: `npx playwright install chromium`.

## Lo unico pendiente de la fase 1: la prueba de feel

Ningun modelo puede firmarla. Arnold abre el juego, juega el click track de
`fixtures/click-120.wav`, y responde:

- Las notas caen donde suena el click?
- El receptor responde al instante o se siente pegajoso?
- En la pantalla de resultados, el grafico de desviacion esta centrado en cero,
  o hay un sesgo constante que delata un offset mal calculado?

Para jugarlo: `npm run dev` desde la raiz, abrir la URL que imprime Vite.

Si algo se siente mal, casi seguro es afinamiento (el offset de calibracion o
los numeros de `HP_DELTAS` en `packages/core/src/judge/engine.ts`), no un
problema de arquitectura. Se resuelve con un ticket chico de ajuste.

## La leccion que hay que seguir aplicando

En la revision de T-001 el hallazgo grave fue **un test que comparaba una
expresion contra si misma**: daba verde siempre y no podia fallar ni con la
implementacion rota. Antes de aceptar una asercion, hay que preguntarse que
implementacion incorrecta la haria fallar. Si no se le ocurre ninguna, el test
no sirve y da confianza falsa.

El segundo hallazgo fue un contrato que invitaba al error: `offset` era
mutable y valia `userOffset + outputLatency`, asi que escribirlo desde config
borraba la latencia sin avisar. Los dos defectos estaban en la especificacion,
no en el codigo entregado.

## Deuda declarada

- **La deriva real no esta medida.** Lo que corre en Vitest es sintetico:
  prueba la aritmetica del reloj, no el sistema completo contra hardware de
  audio. Eso lo cobra el e2e de T-004. Hasta entonces, el riesgo critico del
  proyecto sigue sin verificar.
- **Los cambios de velocidad (SV)** no estan implementados. Se asume
  multiplicador 1. Entran en la fase 2, con el importador.
- **El bono por combo** no esta en el score. Se dejo para cuando se sepa si el
  juego se siente bien.

## Decisiones pendientes del usuario

- **Repositorio remoto.** `gh` esta autenticado en la maquina. No se creo
  porque publicar es decision de Arnold. La CI nunca ha corrido de verdad,
  solo se simulo localmente.
- **Prueba de feel.** Cuando T-004 pase la revision, hace falta que Arnold
  juegue el click track y diga si las notas caen donde suenan. Ningun modelo
  puede firmar eso.

## Contexto del curso

Este proyecto es el proyecto creativo de SE 2110 Apreciacion Musical. Nombre
para el curso: **Compas de Cuatro**. Fechas que mandan sobre el calendario
tecnico:

| Fecha | Entrega |
|---|---|
| 28 de octubre | Avance II: desarrollo del proyecto y cronograma |
| 18 de noviembre | Avance III: conclusiones, anexos y bibliografia |
| Semana 17 | Presentacion y ejecucion en vivo ante publico |

El avance I ya se entrego. El requisito de fondo del curso es **hacer musica**,
asi que el proyecto incluye una composicion original que Arnold compone,
transcribe y ejecuta. Eso no es opcional: es lo que hace que el proyecto
califique.

**Fase M, componer la pieza, puede arrancar en cualquier momento porque no
depende del codigo.** Es la tarea que esta en el camino critico del curso, no
del software.
