# Tetra

Juego ritmico de 4 carriles (osu!mania 4K) en web. Es el proyecto creativo del
curso SE 2110 Apreciacion Musical, Campus Tecnologico Local San Carlos.
Nombre del proyecto para el curso: **Compas de Cuatro**.

## Reglas que no se negocian

### 1. El reloj es el audio

El tiempo del juego se lee **siempre** de `audioContext.currentTime`.

Prohibido para cualquier cosa de gameplay:

- `performance.now()`
- `Date.now()`
- el delta acumulado de `requestAnimationFrame`
- `setTimeout` / `setInterval`

`rAF` corre a la frecuencia del monitor y se desfasa del audio de forma
acumulativa. A los tres minutos el desfase es audible. El reloj de audio va
con el mismo cristal que reproduce el sonido, entonces no puede
desincronizarse de si mismo.

Para la entrada de teclado se usa `event.timeStamp` del evento, que marca
cuando ocurrio la pulsacion, **no** el momento en que corre el handler.

### 2. `packages/core` no toca el navegador

`core` no puede importar ni referenciar `window`, `document`, `AudioContext`,
`performance`, Pixi, React ni ninguna API del navegador. Solo funciones y
tipos puros.

Esto existe por dos razones: hace `core` testeable sin DOM, y deja abierta la
posibilidad de portar la logica a C# / osu!framework sin reescribirla.

### 3. Direccion de las dependencias

```
core  <-  audio
core  <-  engine
core, audio, engine  <-  apps/web
```

Nunca al reves. `core` no importa de nadie.

### 4. Nada de React dentro del loop de juego

Los menus son React. La pista de juego es Pixi puro. Un re-render de React a
mitad de un stream es un frame perdido.

## Estructura

```
packages/core/     logica pura: tipos, parser, timing, juicio, dificultad
packages/audio/    reloj, precarga, previews, espectro
packages/engine/   render de la pista con Pixi
apps/web/          ensambla todo
docs/tickets/      especificaciones de trabajo
fixtures/          mapas de prueba con resultados esperados
```

## Convenciones

- Gestor de paquetes: **npm workspaces** (no pnpm, no yarn).
- TypeScript estricto. Nada de `any` sin un comentario que lo justifique.
- Ramas: `feat/<tema>`, `fix/<ticket>`, `chore/<tema>`. Vida maxima 3 dias.
- Commits: `feat(core): ventanas de juicio por OD (T-002)`.
- Merge a `main` solo por PR con CI en verde. Squash merge.

## Estilo de texto

Los documentos y comentarios se escriben en espanol. **No usar rayas (—)**
como inciso ni como separador: se usa coma, dos puntos, punto y coma o
parentesis. Es una preferencia explicita del dueno del proyecto.

## Reparto de trabajo

| Modelo | Le toca | No le toca |
|---|---|---|
| Opus | Arquitectura, contratos, algoritmos dificiles, tickets, revision de PR | Escribir codigo de produccion |
| Sonnet | Toda la implementacion y sus tests | Cambiar un contrato sin ticket |
| Haiku | Scaffolding, config, fixtures, conversiones, renombrados | Cualquier cosa con logica de juego, timing o dificultad |

Si Haiku falla dos veces en la misma tarea, sube a Sonnet. Si Sonnet falla dos
veces, sube a Opus para reescribir el ticket: dos fallos seguidos casi siempre
significan que el ticket estaba mal especificado.
