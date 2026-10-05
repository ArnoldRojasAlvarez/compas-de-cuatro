# T-053 · Partida con fondo y video, resultados y ajustes minimalistas

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Rama** | `feat/partida-escena` (worktree) |
| **Depende de** | T-049 (video y fondo en `CancionGuardada`), T-050 (skins propias), T-019, T-021, T-023, T-026 |

## Contexto

Para el estado demo la partida tiene que usar el fondo de la cancion (y su
video si trae), ocupar la pantalla, y elegir entre las skins propias de T-050.
Ajustes tiene demasiado texto explicativo. Resultados se ve bien pero flota
sobre un fondo vacio.

Regla de Arnold: **minimalista, sin saturar la pantalla de texto.**

## Contrato

### `game.ts`

```ts
export interface EscenaPartida {
  fondo?: Blob;
  video?: Blob;
  /** ms, de CancionGuardada.videoOffset. */
  videoOffset?: Ms;
  titulo?: string;
  artista?: string;
  dificultad?: string;
}
export interface OpcionesPartida {
  inicioMs?: Ms;
  escena?: EscenaPartida;
}
```

- `runGame(chart, audio, skin?, opciones?)` no cambia de firma. **Nuevo**: si
  `skin` es `undefined`, `runGame` resuelve la skin activa el mismo con
  `resolverSkinDePartida` (abajo). Quien pasa texturas (el song select actual,
  con un `.osk`) sigue funcionando igual.
- **Pista a pantalla completa en alto**: el alto de la pista es el alto de la
  ventana; el ancho de carril escala con el alto (≈ alto × 0.11, entre 72 y
  130 px), centrada. Se recalcula en `resize` de la ventana (el playfield ya
  tiene `resize`).
- **Fondo**: capa detras del lienzo, a pantalla completa, con la imagen
  (`object-fit: cover`) y un velo negro con la atenuacion de ajustes (default
  80 %). Sin imagen: el fondo de la app de siempre.
- **Video** (si hay y el ajuste esta encendido): `<video muted playsinline>`
  en la capa de fondo, por encima de la imagen. Sincronia **contra el reloj de
  audio**: en cada frame, `objetivo = (t - videoOffset) / 1000`; si
  `objetivo < 0` el video espera en el primer cuadro; si la diferencia con
  `video.currentTime` supera 0.15 s se hace `currentTime = objetivo`; se pausa
  y reanuda con la pausa del juego. Nunca se lee el tiempo del video para nada
  de gameplay. Si el video falla al cargar, queda la imagen.
- La pista con `opacidadPista` (T-050) leida de ajustes (derivada de la
  atenuacion: con atenuacion alta la pista puede ser mas transparente).
- **Volumen**: `ClockOptions` en `packages/audio` gana `destino?: AudioNode`
  (default `ctx.destination`); game.ts pasa un `GainNode` con
  `gananciaDeVolumen(leerVolumen())` (`apps/web/src/volumen.ts`, ya existe).
  Test en `clock.test.ts` de que el source se conecta al destino pedido.
- **Intro de la cancion**: al arrancar, abajo a la izquierda, `Titulo` y
  `Artista · Dificultad` en una linea chica, que se desvanecen solos a los
  ~3 s de tiempo de juego (medido con el reloj, no con timers).
- **HUD** (T-019) mas limpio: combo centrado sobre la pista (ya esta);
  precision arriba a la derecha de la pantalla, grande y mono; score chico
  debajo; "Combo max" fuera del HUD (queda en resultados). Barra de vida fina
  pegada al borde derecho de la pista; progreso como linea finisima arriba de
  todo. Nada de etiquetas en mayusculas que no hagan falta.
- Pausa (T-026) sin cambios de comportamiento; el video se pausa con ella.

### `apps/web/src/skin-activa.ts` (nuevo) y `skin.ts`

- La skin activa en localStorage pasa a poder ser `propia:<IdSkinPropia>`
  ademas de un `SkinId` de `.osk`. Sin nada guardado => `propia:tetra`
  (`SKIN_PROPIA_POR_DEFECTO`). La opcion "sin skin (rectangulos)" desaparece de
  la UI (el fallback sigue existiendo en engine para un `.osk` incompleto).
- `resolverSkinDePartida(anchoColumna: number): Promise<TexturasDeSkin>`:
  propia => `texturasDeSkinPropia`; `.osk` => `cargarTexturasDeSkin` (si ya no
  existe en la base, cae a la propia por defecto). Nunca lanza.
- Logica pura (parsear/serializar la seleccion) con tests.

### Resultados (`results.ts`, `resultados.css`)

- Mismo contenido y mismo boton de volver (T-021, el song select lo agrega).
- El fondo de la cancion detras (blur ~10 px, atenuado), via la `escena`
  que recibe `runGame` (resultados se pintan desde runGame).
- Arriba: titulo de la cancion y dificultad en una linea chica.
- Menos texto: el subtitulo del grafico se va (el grafico se explica solo con
  sus ejes); etiquetas cortas.

### Ajustes (`ajustes.ts`, `ajustes.css`)

Mismas cuatro tarjetas numeradas (T-023), menos texto:

- Cada control: **etiqueta corta + control**. Las explicaciones largas pasan a
  `title` (tooltip). Como mucho un dato vivo en mono (por ejemplo "1200 ms"
  junto a la velocidad).
- **Juego**: offset, velocidad, **volumen de musica** (slider 0 a 100 %,
  guarda con `guardarVolumen`).
- **Teclas**: igual.
- **Apariencia** (reemplaza "Graficos" + "Apariencia"):
  - **Skin**: una grilla de tarjetas con miniatura (`dibujarMiniaturaDeSkin`
    de engine, en un canvas por tarjeta) para las cuatro propias, mas una
    tarjeta por cada `.osk` importado (con su nombre) y una tarjeta "+" para
    importar `.osk`. La activa con borde `--acento`.
  - **Atenuar fondo**: slider 0 a 100 % (default 80).
  - **Video de fondo**: interruptor (default encendido).
  - **Mostrar FPS**: interruptor (ya existe).
- **Presentacion**: igual, menos texto.
- Las preferencias nuevas (atenuacion, video) en un modulo con el patron de
  `velocidad.ts` (localStorage inyectable, tests).

## Criterios de aceptacion

- [ ] Una cancion con fondo se juega con la imagen atenuada detras; con video,
      el video corre en sincronia (desfase visible < 0.2 s) y se pausa con la
      pausa.
- [ ] La pista ocupa el alto de la ventana a 1280x800 y a 1920x1080.
- [ ] Cambiar de skin en ajustes cambia la pista en la proxima partida; las
      miniaturas se ven nitidas.
- [ ] El volumen afecta la partida.
- [ ] Ajustes entra en 1280x800 sin parrafos visibles.
- [ ] e2e (`cd apps/web && npx playwright test`) y los cuatro checks en verde.

## Tests

Preferencias nuevas, seleccion de skin (serializar/parsear/default), calculo
del ancho de carril segun alto, decision de resincronizar el video (pura:
`debeResincronizar(tiempoVideo, objetivo, umbral)`), visibilidad de la intro
segun t.

## Fuera de alcance

Menu y song select (T-052; ojo, **no toques** `song-select.ts`, `menu.ts`,
`logo.ts`, `router.ts`: el revisor conecta la `escena` desde el song select
despues de fusionar). Hitsounds. Records.

## Terminado cuando

Los cuatro checks y el e2e en verde, con el reporte de decisiones no cubiertas.
