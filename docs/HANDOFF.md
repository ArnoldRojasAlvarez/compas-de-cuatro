# Traspaso de contexto — Tetra

Este documento es para una sesion NUEVA que toma el proyecto sin haber visto la
conversacion anterior. Leelo entero antes de tocar nada. Despues lee, en este
orden: `docs/ESTADO.md`, `CLAUDE.md`, `docs/DISENO.md`.

Vos ocupas el asiento de **project manager, arquitecto y QA**. No escribis
codigo de produccion: lo escribe Sonnet. Ver "El modelo de trabajo" abajo.

---

## 1. Que es esto

**Tetra** es un juego de ritmo web de 4 carriles (osu!mania 4K): caen notas en
cuatro columnas y el jugador pulsa D, F, J, K en el momento exacto. El juego
mide la desviacion de cada golpe en milisegundos.

Es, al mismo tiempo, el **proyecto creativo del curso SE 2110 Apreciacion
Musical** de Arnold (Campus Tecnologico Local San Carlos). Para el curso se
llama **"Compas de Cuatro"**. Esto importa porque el curso manda sobre el codigo:

- El requisito de fondo del curso es **hacer musica**. Por eso el proyecto NO es
  solo software: Arnold va a **componer una pieza original**, la va a
  transcribir a un mapa jugable, y la va a **ejecutar en vivo** en la
  presentacion. Eso es lo que hace que el proyecto califique.
- Fechas que no se mueven:
  - **28 de octubre 2026**: avance II (desarrollo del proyecto y cronograma), se
    entrega por TECDigital, con un **video de grabacion de pantalla de Arnold
    haciendo la cancion**.
  - **18 de noviembre 2026**: avance III (conclusiones, anexos, bibliografia).
  - **Semana 17**: presentacion y ejecucion en vivo ante publico.
- El avance I ya se entrego (esta fuera del repo, era el documento escrito).

**El codigo va muy adelantado respecto al curso.** La cancion y el video son el
camino critico academico y NO dependen del codigo. Recuerdaselo a Arnold cuando
tenga sentido, sin presionar.

Quien es Arnold: jugador top ~40 mil del mundo, top 92 de Costa Rica en
osu!mania. Su criterio sobre feel y dificultad vale mas que cualquier metrica.
Es el unico que puede firmar la "prueba de feel" (si el timing se siente bien).

---

## 2. El modelo de trabajo

Tres modelos y un humano, con roles estrictos:

| Quien | Hace | No hace |
|---|---|---|
| **Vos (PM/arquitecto)** | Arquitectura, contratos, algoritmos dificiles, escribir tickets, revisar PR, decidir | Escribir codigo de produccion |
| **Sonnet** | Toda la implementacion y sus tests | Cambiar un contrato sin ticket |
| **Haiku** | Scaffolding, config, fixtures, conversiones, renombrados | Logica de juego, timing, dificultad |
| **Arnold** | Componer/tocar, prioridades, prueba de feel, aprobar merge | Nada, es su proyecto |

Como se despacha trabajo: con la herramienta **Agent**, `subagent_type:
"general-purpose"`, y `model: "sonnet"` o `"haiku"` segun la tarea. Corren en
segundo plano; llega una notificacion cuando terminan. En el prompt al agente
siempre: que archivos leer primero (CLAUDE.md, el ticket, types.ts), que NO
rompa, que deje los cuatro checks en verde, y que reporte decisiones no
cubiertas por el ticket.

**Regla de escalado:** si Haiku falla dos veces en la misma tarea, sube a
Sonnet. Si Sonnet falla dos veces, NO insistas una tercera: reescribi el ticket.
Dos fallos seguidos casi siempre significan que el ticket estaba mal
especificado, no que el modelo sea incapaz.

**Fallos por limite de sesion no son fallos de codigo.** Ya paso: un agente se
cayo por rate limit con el trabajo casi listo. En ese caso, evalua el estado del
working tree (compila?, pasan los checks?) y termina vos los pasos que falten en
vez de relanzar de cero.

### El formato de ticket

Cada ticket vive en `docs/tickets/T-XXX-nombre.md` y trae: contexto, el contrato
(firmas TypeScript exactas), criterios de aceptacion como checklist, que tests
deben pasar, que queda fuera de alcance, y "terminado cuando". Un ticket sin
contrato ni criterios se devuelve sin empezar. Mira los tickets existentes como
molde: `docs/tickets/` esta lleno de ejemplos.

---

## 3. El ciclo de cada tarea

1. Vos escribis el ticket en `docs/tickets/`, lo commiteas a `main`.
2. Creas la rama: `git checkout -b feat/<tema>`.
3. Despachas a Sonnet/Haiku con el Agent tool.
4. Cuando reporta, **verificas vos mismo, no le crees**:
   - `npm run typecheck && npm run lint && npm run test && npm run build`
   - Si toca UI o audio: corres el e2e (`cd apps/web && npx playwright test`) y
     **lo mira corriendo** (preview_start + screenshot).
   - Lees los tests nuevos y preguntate: **que implementacion incorrecta los
     haria fallar?** Si ninguna, el test no sirve (ver lecciones abajo).
5. Si hay hallazgos, escribis un ticket de correccion o, si es un arreglo chico
   de config/comentario que entendes del todo, lo haces vos y lo declaras.
6. Squash merge a `main` con mensaje descriptivo. Borra la rama.
7. Actualizas `docs/ESTADO.md`.

### Reglas de git

- `main` esta siempre en verde y desplegable. Nada entra sin los cuatro checks.
- **Squash merge siempre** (`git merge --squash`). Un ticket es un commit.
- Rama por ticket, vida corta. `feat/`, `fix/`, `chore/`, `docs/`.
- Los commits terminan con la linea de co-autoria que indique el harness de la
  sesion actual (`Co-Authored-By: Claude <modelo> <noreply@anthropic.com>`).
- NO metas binarios grandes (el .wav del fixture) en un `git stash`: en Windows
  falla al mover el archivo y corta la operacion. Ya paso.
- Cuidado al mergear mientras un agente escribe en la misma rama: sus cambios sin
  commitear estan en el working tree. Commitealos o esperalo.

---

## 4. Arquitectura y reglas que no se negocian

Estan en `CLAUDE.md`, resumidas aca:

1. **El reloj es el audio.** El tiempo de juego sale SIEMPRE de
   `audioContext.currentTime`. Prohibido `performance.now()`, `Date.now()`,
   `setTimeout`, `setInterval` y el delta de `requestAnimationFrame` para
   gameplay. `rAF` sirve para dibujar (el logo del menu, por ejemplo), nunca
   para medir tiempo de juego. La entrada de teclado usa `event.timeStamp`, no
   el momento del handler. La unica lectura de `performance.now()` permitida
   convierte ese timeStamp a tiempo de juego, y esta justificada en linea.
2. **`packages/core` no toca el navegador.** Ni `window`, ni `AudioContext`, ni
   Pixi, ni React. Solo funciones puras. Es lo que lo hace testeable sin DOM y
   portable a C#/osu!framework si algun dia se migra. Un eslint lo obliga.
3. **Direccion de dependencias:** `core` no importa de nadie. `audio`, `engine`,
   `storage` importan de `core`. `apps/web` de todos. Nunca al reves. El eslint
   lo obliga.
4. **Nada de React dentro del loop de juego.** Los menus son React/DOM; la pista
   es Pixi puro. (Nota: la UI hoy es DOM plano + Canvas para el logo y Pixi para
   la pista; no se termino usando React, y esta bien.)

### Estructura del repo

```
packages/core/     logica pura: tipos (types.ts), parser .osu, timing, juicio, dificultad
packages/audio/    reloj (clock.ts)
packages/engine/   pista en Pixi (playfield), entrada, skins
packages/storage/  IndexedDB: importar .osz y .osk (no toca Pixi)
apps/web/          menu, song select, ajustes, bucle de juego, resultados, logo
docs/              ESTADO, DISENO, HANDOFF, tickets/
fixtures/          click track de prueba, .osz y .osk sinteticos
tools/             generadores de fixtures
```

### Comandos

- Los cuatro checks: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
- e2e: `cd apps/web && npx playwright test`. Si se queja del navegador:
  `npx playwright install chromium`.
- Correr la app: `npm run dev` desde la raiz, abrir la URL que imprime Vite.
- Gestor de paquetes: **npm workspaces** (no pnpm, no yarn).

---

## 5. Estado actual

`main` limpio, ~301 tests + un e2e de sincronia, los cuatro checks en verde.

**Hecho y fusionado:**

- Fase 0: monorepo, TS estricto, ESLint, Vitest, CI.
- T-001: reloj de audio (el riesgo critico; verificado con e2e de 60s sin deriva
  en navegador real: un juego de ritmo en web ES viable, ya no es supuesto).
- T-002/T-003: ventanas de juicio por OD y motor de score/combo/HP.
- T-004: pista en Pixi, entrada de teclado, bucle, pantalla de resultados.
- T-005: importador de mapas `.osu` mania 4K + `@tetra/storage`.
- T-006: cargador para soltar un `.osz` y jugarlo (ya reemplazado por el song select).
- T-007: calibracion de offset + resultados con desviacion medida en ms.
- T-008: velocidad de caida ajustable + salir con Escape.
- T-009: cargar una skin `.osk` y usar sus imagenes.
- T-010: sistema de diseno propio, menu y logo que respira.
- T-011: navegacion con router, song select (biblioteca con dificultades) y ajustes.

**La prueba de feel ya se hizo:** en una cancion real los golpes de Arnold
salieron centrados en cero. El motor esta bien sincronizado. Por eso se
adelantaron T-007 (calibrar/medir) y T-008 (velocidad).

**Lo que sigue (ver ESTADO.md para el detalle):**

- **T-012, pulir Ajustes:** estilar los inputs nativos feos (los "Choose File"
  grises que desentonan), remapeo de teclas, opciones de graficos/fps.
- **Fase 4, motor de dificultad:** el gran ticket. El vector de SIETE skillsets
  (stream, jumpstream, handstream, stamina, jackspeed, chordjack, technical) y
  el star rating de verdad. La idea de fondo, que Arnold planteo y hay que
  respetar: un solo numero no alcanza para la dificultad; se calcula un vector
  por skillset y la estrella global es el maximo. Eso explica por que un 5.29
  limpio se siente mas facil que un 4.8 lleno de chordjacks. El tipo
  `SkillVector` ya existe en `core/types.ts`. Se valida contra mapas rankeados
  de osu! y Arnold arbitra las discrepancias.
- **Header persistente** con tiempo y tiempo jugado (esta en las capturas de osu!
  que dio Arnold, todavia sin hacer).
- **La cancion y el video del avance II** (camino critico del curso).

**Limpieza menor pendiente:** varios comentarios en `game.ts`, `logo.ts`,
`router.ts`, `click-track.ts` mencionan `cargador.ts`, que se elimino en T-011.
Historicos, no rompen nada.

---

## 6. Lecciones que costaron y hay que seguir aplicando

Estas son el motivo de que la revision exista aparte de la CI. En cada caso el
codigo pasaba los cuatro checks y AUN ASI no estaba bien.

1. **Un test que no puede fallar es peor que no tener test.** En T-001 la prueba
   de deriva comparaba una expresion contra si misma (daba 0 siempre, incluso
   con la implementacion rota). Antes de aceptar cualquier asercion: que
   implementacion incorrecta la haria fallar? Si no se te ocurre ninguna, no
   sirve.
2. **Un contrato puede invitar al error.** El `offset` del reloj era un campo
   mutable que valia `userOffset + outputLatency`; escribirlo desde config
   borraba la latencia sin avisar. Se cambio a `userOffset` mutable con `offset`
   derivado de solo lectura. El defecto estaba en la especificacion, no en el
   codigo.
3. **"El archivo del test existe" no es "el test paso".** El e2e de Playwright
   estuvo escrito pero nunca corrido (faltaba el navegador). Corrélo de verdad.
4. **Los criterios de aceptacion pueden estar mal.** Un criterio que escribi
   sobre la direccion del offset contradecia la matematica ya probada del reloj.
   Gano el codigo probado; corregi el criterio. No fuerces el codigo a cumplir un
   criterio equivocado.
5. **Los tests flaky no se fusionan.** El e2e era intermitente ("2 de 3") por una
   carrera contra el fin de la partida. Se estabilizo antes de mergear, no
   despues.
6. **Arreglos chicos de config/comentario los podes hacer vos** y declararlos, en
   vez de gastar un ciclo de agente. Para codigo de produccion, no.

---

## 7. Decisiones de producto ya tomadas

- **Stack:** web, TypeScript, Pixi para la pista, Canvas para el logo, Web Audio
  para el reloj, Vite, Vitest + Playwright, IndexedDB. Ruta de escape a
  osu!framework abierta gracias a que `core` es puro (probablemente no haga
  falta: el e2e ya probo que web es viable).
- **Mapas:** se importan `.osu`/`.osz` de osu! para probar (contenido de
  terceros, para desarrollo, NO para publicar). El mapa que Arnold presente debe
  ser el suyo (su propia cancion mapeada). El editor propio y el auto-mapper
  quedaron como trabajo futuro, fuera del semestre.
- **Skins:** se cargan `.osk` que el usuario suelta (no se empaquetan skins
  ajenas). Misma logica de derechos que los mapas.
- **Diseno:** identidad propia "instrumento de precision", lejos de osu!. Ver
  `docs/DISENO.md`. Acento teal, NO rosa osu!. Arnold pidio explicitamente algo
  propio, no un calco.
- **Backend/login:** no hay, y queda para el final. Todo local con IndexedDB.

---

## 8. Como arrancar tu primera accion

1. Lee ESTADO.md, CLAUDE.md, DISENO.md.
2. `npm run typecheck && npm run lint && npm run test && npm run build` para
   confirmar que `main` esta sano.
3. Preguntale a Arnold por cual seguir (T-012 pulir ajustes, Fase 4 dificultad,
   o algo que el priorice), o si prefiere enfocarse en la cancion/video del
   curso.
4. Escribi el ticket, despacha a Sonnet, revisa, fusiona. Como siempre.

Bienvenido al asiento. El proyecto esta sano y bien documentado; mantenelo asi.
