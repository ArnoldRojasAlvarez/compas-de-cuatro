# T-012 · Pulir ajustes: controles estilados, remapeo de teclas, FPS, entrada robusta

| | |
|---|---|
| **Fase** | 3 · La cascara |
| **Modelo** | Sonnet |
| **Rama** | `feat/ajustes` |
| **Depende de** | T-011 (pantalla de ajustes), `docs/DISENO.md` |

## Contexto

T-011 dejo la estructura: menu, song select, ajustes. Arnold senalo que los
controles nativos del navegador (los botones grises, los "Choose File", los
campos numericos blancos) desentonan con la identidad. Ademas faltan dos cosas
que pidio desde el principio: **cambiar las teclas** y **ver o no los FPS/ms**.

Y la revision de Opus encontro un bug de entrada que hay que arreglar antes de
construir el remapeo encima.

**Leer `docs/DISENO.md`. Todo control nuevo o restilado sale de los tokens.**

## Parte A: bug de entrada (hacer primero)

`packages/engine/src/input.ts` empareja teclas con `e.key.toLowerCase()`. Eso
falla de tres formas:

1. **Tecla pegada.** Con un simbolo mapeado (por ejemplo `;`), si el jugador
   suelta con Shift apretado el `keyup` llega como `:`, no coincide, y la tecla
   queda en `teclasPulsadas` para siempre. Desde ahi toda pulsacion de esa
   columna se descarta como autorrepeticion: la columna queda muerta.
2. **Depende de la distribucion del teclado.** `e.key` cambia segun el idioma del
   teclado. Lo estandar en juegos de ritmo es la posicion fisica.
3. **Perdida de foco.** Si la ventana pierde el foco con una tecla apretada
   (alt-tab), el `keyup` nunca llega y la columna queda muerta al volver.

**Cambio de contrato aprobado:**

- Emparejar por **`e.code`** (posicion fisica: `KeyD`, `KeyF`, `KeyJ`, `KeyK`,
  `Semicolon`, `Space`, etc.), no por `e.key`.
- `setKeyMap` recibe **codigos** (`e.code`), no teclas. Default:
  `['KeyD', 'KeyF', 'KeyJ', 'KeyK']`.
- Al perder el foco (`blur` en la ventana) se sueltan todas las teclas
  sostenidas: se emite un `up` por cada una, con el tiempo del evento de blur
  convertido por `toGameTime`, y se vacia `teclasPulsadas`. Asi una LN
  sostenida al hacer alt-tab se juzga como soltada, que es lo correcto.
  `createKeyboardInput` necesita saber de que objeto escuchar el `blur`; si el
  `target` es la ventana alcanza, si no, agregar un parametro opcional. Decidi y
  documenta.

Tests que tienen que poder fallar:

- Pulsar con un codigo y soltar con el mismo codigo pero otro `key` (simula
  Shift) libera la columna. Con la implementacion vieja este test falla.
- `blur` con una tecla sostenida emite su `up` y la siguiente pulsacion de esa
  columna se registra.
- El mapeo por codigo ignora `key`: un evento con `code: 'KeyD'` y `key: 'x'`
  va a la columna 0.

Actualizar los tests existentes de `input.test.ts` que hoy mandan `key: 'd'`.

## Parte B: remapeo de teclas

En la pantalla de ajustes:

- Cuatro casilleros, uno por columna, mostrando la tecla actual con un nombre
  legible (lo que el navegador reporte en `e.key` al momento de capturarla,
  guardado junto al codigo; o una tabla simple de codigo a nombre).
- Clic en un casillero lo pone en modo "pulsa una tecla". La siguiente tecla
  pulsada se guarda (su `e.code`). Escape cancela la captura.
- **Validacion**, como funcion pura testeable:
  - No se puede asignar el mismo codigo a dos columnas. Si pasa, avisar y no
    guardar (o intercambiar, a tu criterio, pero documentalo).
  - `Escape` no se puede asignar: es la tecla de salir de la partida.
- Boton para volver a los valores por defecto.
- Persistido en localStorage con el mismo patron que `offset.ts` y
  `velocidad.ts` (Storage inyectable). Al arrancar la partida, `game.ts` lo lee
  y llama `setKeyMap`.

## Parte C: opcion de FPS/ms

- Un interruptor en ajustes: "Mostrar FPS y ms". Persistido. Por defecto
  encendido (como hoy).
- Si esta apagado, el HUD no muestra el contador.

**No inventar opciones de "multithreading".** El render del navegador corre en
un solo hilo; el calculo de dificultad va a ir en un Web Worker (T-014), pero
eso no es una opcion del usuario. Un interruptor que no hace nada es peor que no
tenerlo.

## Parte D: controles con la identidad

Hoy se ven los controles por defecto del navegador. Restilar, con los tokens de
`tokens.css`:

- **Todos los botones** de la app (menu, song select, ajustes, resultados): base
  comun con `--superficie-2`, texto `--tinta`, borde `--linea`, foco visible con
  `--acento`, hover. El boton principal de cada pantalla (por ejemplo "Jugar" en
  el menu) puede destacarse con el acento. Una sola cosa brilla por pantalla.
- **Inputs numericos**: fondo `--superficie`, texto en mono, sin las flechas
  nativas si desentonan (los botones de mas y menos ya existen).
- **Inputs de archivo**: el `<input type=file>` nativo se oculta y se dispara
  desde un boton o una zona estilada. Aplica al song select (soltar `.osz`) y a
  ajustes (skin `.osk`).
- **Selects**: fondo y texto con tokens.
- Foco visible en todo lo interactivo, navegable con teclado.

Ajustes queda organizado en secciones con titulo: Juego (offset, velocidad),
Teclas, Graficos (FPS), Apariencia (skin).

## Parte E: limpieza de comentarios

Varios comentarios mencionan `cargador.ts`, que se elimino en T-011:
`game.ts`, `logo.ts`, `logo-logica.ts`, `router.ts`, `click-track.ts`, y el
e2e. Actualizarlos para que describan el codigo actual (quien llama a quien hoy).

## Cuidado con lo que ya funciona

- El e2e de sincronia sigue pasando. Si cambias textos de botones que el e2e usa
  ("Jugar", "Jugar click track"), actualizalo y confirma.
- Offset, velocidad, skins, song select, la partida: igual que hoy.

## Criterios de aceptacion

- [ ] La entrada empareja por `e.code`; los tres tests de la parte A pasan y el
      de Shift fallaria con la implementacion vieja
- [ ] `blur` suelta las teclas sostenidas
- [ ] Se pueden remapear las cuatro teclas, se validan duplicados y Escape, se
      persisten y la partida las usa
- [ ] El interruptor de FPS oculta y muestra el contador y se persiste
- [ ] Ningun boton, input, select o file input se ve con el estilo por defecto
      del navegador
- [ ] Ajustes esta ordenado en secciones
- [ ] No quedan comentarios que mencionen `cargador.ts`
- [ ] El e2e pasa
- [ ] Los cuatro checks en verde

## Fuera de alcance

- Opciones de audio (volumen, musica del menu).
- Header persistente.
- Estrellas y dificultad (T-013, T-014).

## Terminado cuando

Los cuatro checks en verde, el e2e pasando, revision de Opus mirando la app
corriendo, y squash merge a `main`.
