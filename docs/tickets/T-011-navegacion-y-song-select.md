# T-011 · Navegacion, song select y ajustes basicos

| | |
|---|---|
| **Fase** | 3 · La cascara |
| **Modelo** | Sonnet |
| **Rama** | `feat/song-select` |
| **Depende de** | T-010 (menu, diseno), T-005 (importador), T-009 (skins) |
| **Reemplaza** | el cargador de desarrollo, que era temporal |

## El problema que resuelve

Hoy todo esta aplastado en una sola pantalla: el logo, la zona de soltar mapas,
el click track, el offset, la velocidad y la skin, todos apilados. No hay
estructura. Este ticket le da la estructura logica de un juego de ritmo de
verdad: un menu que lleva a lugares distintos.

**Leer `docs/DISENO.md`. Todo hereda esa identidad.**

## La estructura de navegacion

Un router de pantallas simple en `apps/web` (una maquina de estados, no una
libreria de routing). Pantallas:

```
menu  ->  song-select  ->  juego  ->  resultados  ->  song-select
  |
  +----> ajustes  ->  menu
```

- **menu**: el logo de T-010, limpio, con accesos: **Jugar** y **Ajustes**. Se
  le quita el panel del cargador que tiene embebido hoy. El logo sigue
  respirando.
- **song-select**: la biblioteca de canciones cargadas. El corazon de este
  ticket. Ver abajo.
- **ajustes**: una pantalla propia con los controles que hoy andan sueltos
  (offset, velocidad, skin). Estructura basica esta bien; el pulido fino y las
  cosas nuevas (remapeo de teclas, graficos) son T-012.
- **juego** y **resultados**: ya existen; solo se enganchan al router. Al
  terminar o abortar una partida se vuelve al song-select, no al cargador viejo.

Cada pantalla tiene como volver. El menu es la raiz.

## Parte A: la biblioteca guarda todas las dificultades

Hoy el importador guarda solo la primera dificultad de un `.osz` (decision 4 de
T-005). El song select necesita todas.

- Cambiar `@tetra/storage` para que un `.osz` se guarde como **una cancion con
  N dificultades**: un modelo tipo `Cancion { id, titulo, artista, audio, bg,
  dificultades: Chart[] }`. Cada `.osu` de adentro es una dificultad.
- `listarCanciones()` devuelve las canciones con sus dificultades.
- Migracion de IndexedDB no destructiva, como la de T-009 (guard con
  `contains`, sin borrar lo que ya hay). Si el esquema cambia mucho, esta bien
  una tienda nueva; no romper los datos viejos.

## Parte B: el song select

La pantalla donde Arnold elige que jugar. Inspirada en lo que conoce de osu!
(lista a un lado, detalle al otro) pero con nuestra identidad, no un calco.

- **Lista de canciones a la derecha**, scrolleable. Cada item muestra titulo y
  artista. La cancion en **foco** se resalta y se expande para mostrar sus
  **dificultades**; las demas quedan colapsadas. Un movimiento con proposito al
  expandir, no por decorar (ver DISENO.md).
- **Panel de detalle a la izquierda**: de la cancion o dificultad en foco,
  mostrar los datos en mono (JetBrains Mono), tratados como instrumentos:
  **BPM, duracion, key count (4K), cantidad de notas, cantidad de notas
  largas, OD, HP**. Todo eso ya esta en el `Chart`.
- **Preview de audio al enfocar**: reproducir la cancion desde su `previewTime`.
  Un preview simple ya sirve; el fundido cruzado fino puede esperar. Este audio
  es aparte del reloj de juego, igual que el del logo, y se detiene al entrar a
  una partida.
- **Buscar** (por titulo o artista), **ordenar** (por titulo, por BPM) y un
  boton de **aleatorio** que salta a una cancion al azar.
- Elegir una dificultad arranca la partida con la velocidad, el offset y la skin
  ya configurados.
- **Importar desde aca**: la zona de soltar `.osz` vive en el song select (es
  donde uno agrega canciones), no en el menu. Al soltar una, aparece en la lista
  sin recargar.
- Si no hay ninguna cancion cargada, un estado vacio claro que invite a soltar
  un `.osz` o jugar el click track.

## El star rating queda para la fase 4

**No calcular estrellas todavia.** El motor de dificultad de siete skillsets es
la fase 4, un ticket grande aparte. Por ahora, en el detalle de cada dificultad,
mostrar lo que si tenemos (nombre de la dificultad, notas, OD). Si es facil,
agregar una densidad provisional (notas por segundo) **marcada como
provisional**. No inventar un numero de estrellas que despues va a cambiar.

## Cuidado con lo que ya funciona

- La partida, el juicio, el offset (T-007), la velocidad (T-008) y las skins
  (T-009) siguen funcionando exactamente igual.
- El click track sigue accesible (desde el song select o el menu, a tu criterio).
- El e2e `apps/web/e2e/sincronia.spec.ts` depende de poder llegar a jugar el
  click track y del gancho `window.__tetraDebug`. Con el router nuevo, la ruta
  para llegar al juego cambia. **Actualiza el e2e para que navegue hasta el
  click track por la UI nueva, y confirma que pasa.** No lo dejes roto.
- El logo y su audio se siguen liberando al entrar a una partida.

## Rendimiento

La lista puede tener muchas canciones. No hace falta virtualizar para las
cantidades de desarrollo, pero no crear mil nodos de golpe si es trivial
evitarlo. El preview de audio se carga al enfocar, no todas las canciones a la
vez.

## Criterios de aceptacion

- [ ] Desde el menu se llega a Jugar (song select) y a Ajustes, y se puede
      volver de cada uno
- [ ] Un `.osz` con varias dificultades las muestra todas bajo una cancion
- [ ] La cancion en foco se expande y muestra sus dificultades; las otras no
- [ ] El detalle muestra BPM, duracion, notas, LN, OD, HP en mono
- [ ] El preview suena al enfocar y se corta al entrar a la partida
- [ ] Buscar, ordenar y aleatorio funcionan
- [ ] Soltar un `.osz` en el song select lo agrega a la lista sin recargar
- [ ] Elegir una dificultad juega con offset, velocidad y skin aplicados
- [ ] Ajustes tiene offset, velocidad y skin, y volver al menu funciona
- [ ] Estado vacio claro cuando no hay canciones
- [ ] La migracion de IndexedDB no borra datos viejos
- [ ] El e2e pasa con la navegacion nueva
- [ ] Los cuatro checks en verde

## Fuera de alcance

- Star rating y el motor de dificultad (fase 4).
- Remapeo de teclas y opciones de graficos/fps en ajustes (T-012).
- Estilar los inputs nativos feos (T-012).
- Header persistente con tiempo jugado (otro ticket).
- Fundido cruzado fino del preview.

## Terminado cuando

Los cuatro checks en verde, el e2e pasando, revision de Opus, Arnold navega la
estructura y confirma que ya tiene sentido, y squash merge a `main`.
