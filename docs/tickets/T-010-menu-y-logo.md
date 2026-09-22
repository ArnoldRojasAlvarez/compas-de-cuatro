# T-010 · Sistema de diseno, menu principal y logo que respira

| | |
|---|---|
| **Fase** | 3 · La cascara |
| **Modelo** | Sonnet |
| **Rama** | `feat/menu` |
| **Depende de** | T-006 (cargador), audio del menu |
| **Establece** | la identidad visual que heredan las demas pantallas |

## Por que este ticket primero

La fase 3 son varias pantallas (menu, song select, config, header). Antes de
construirlas hay que fijar la identidad visual una sola vez, en tokens
compartidos, para que todas salgan del mismo lugar. Este ticket hace eso y
entrega la primera pantalla: el menu principal con el logo.

**Leer `docs/DISENO.md` antes de empezar. Es el contrato de diseno.**

## Parte A: tokens de diseno

Un unico archivo de CSS con custom properties, importado por `apps/web`, con
toda la paleta, la tipografia y la escala de `docs/DISENO.md`. Todas las
pantallas usan estos tokens, nunca hex sueltos.

- Cargar `Sora`, `IBM Plex Sans` y `JetBrains Mono` de Google Fonts.
- Definir los tokens de color, los de tipo (familias, escala) y unos de
  espaciado.
- El fondo del `body` y los colores base salen de tokens, no literales.

Migrar lo que ya existe (cargador, resultados) a estos tokens **es bienvenido
pero no obligatorio en este ticket**: si lo haces, que no rompa nada; si no, al
menos que el menu nuevo los use y quede como referencia.

## Parte B: el menu principal

Reemplaza la pantalla de arranque actual (el cargador crudo de T-006) por un
menu que se vea como un producto:

- El **logo** al centro o segun la composicion que elijas (ver parte C).
- Accesos a lo que hoy existe: **jugar** (que lleva al cargador o directo a
  soltar un mapa, como este hoy) y un lugar para el **click track**.
- Los controles de **offset** y **velocidad** que hoy viven sueltos en el
  cargador se pueden dejar donde estan por ahora; su hogar definitivo es la
  pantalla de config (otro ticket). No los rompas.
- Se ve bien apenas carga, sin scroll, sin necesidad de interactuar. El primer
  cuadro ya muestra el logo y las opciones.

No hace falta el song select todavia (es T-011). Este menu puede seguir usando
el cargador de `.osz` como camino a jugar.

## Parte C: el logo que respira

La pieza de identidad. Segun `docs/DISENO.md`:

- Un anillo con la marca al centro, en la face Display (`Sora`).
- **Respira con el beat**: un pulso de escala en cada golpe de la musica del
  menu. Si no hay musica sonando, una respiracion lenta de reposo, nunca
  quieto muerto.
- **Espectro de audio en toda la circunferencia**, partido en **cuatro
  cuadrantes espejados** que giran en sentido horario. Simetria de cuatro.
- Dibujado en **Canvas** (2D alcanza), no SVG a mano: es generativo, cambia cada
  frame. Lee el audio con un `AnalyserNode` conectado a la musica del menu.
- Colores del token `--acento`, con la amplitud de cada barra modulando brillo
  u opacidad. Nada de arcoiris.
- Respeta `prefers-reduced-motion`: si esta activo, el logo se queda en su estado
  de reposo sin girar ni pulsar.

### La musica del menu

Hace falta algo sonando para que el logo reaccione. Para este ticket, reproducir
en bucle el audio del click track (`fixtures/click-120.wav`) o el ultimo mapa
importado, lo que sea mas simple. El punto es tener un `AnalyserNode` con senal.
La musica del menu de verdad (elegir pista, control de volumen) es de un ticket
posterior; no te compliques aca.

**Ojo con el reloj:** la musica del menu NO usa el reloj de juego (`AudioClock`)
ni compite con el. Es una reproduccion aparte, solo para el visualizador. No
mezclar los dos.

## Rendimiento

- El logo dibuja en cada frame con `requestAnimationFrame`. Esto es **dibujo**,
  no medicion de tiempo de juego, asi que aca `rAF` esta permitido (el menu no
  juzga nada). Igual, no recalcular lo que no cambia.
- Cuando se entra a una partida, el bucle del logo se detiene y se libera el
  `AnalyserNode` y su fuente de audio. Nada de dos loops corriendo a la vez.

## Criterios de aceptacion

- [ ] Existe el archivo de tokens y el menu lo usa. Cero hex sueltos en el menu
- [ ] Las tres fuentes cargan y se ven aplicadas
- [ ] El menu se ve completo apenas carga, sin scroll ni interaccion previa
- [ ] Desde el menu se llega a jugar el click track y a soltar un `.osz`
- [ ] El logo pulsa con el beat de la musica del menu y su espectro gira en
      cuatro cuadrantes simetricos
- [ ] Con `prefers-reduced-motion`, el logo no gira ni pulsa
- [ ] Al entrar a una partida, el loop del logo y su audio se detienen (sin dos
      audios sonando, sin `rAF` colgado)
- [ ] El offset, la velocidad, el cargador de `.osz` y las skins siguen
      funcionando
- [ ] El e2e de sincronia sigue pasando (puede que tengas que ajustar como
      arranca, igual que en T-006 y T-008: si lo tocas, confirma que pasa)
- [ ] Los cuatro checks en verde

## Fuera de alcance

- Song select (T-011).
- Pantalla de config propia (otro ticket): por ahora los controles siguen donde
  esten.
- Header persistente con tiempo jugado (otro ticket).
- Musica de menu con seleccion y volumen.

## Terminado cuando

Los cuatro checks en verde, el e2e pasando, revision de Opus, Arnold ve el menu y
da el visto bueno a la direccion visual (o pide ajustes), y squash merge a
`main`.
