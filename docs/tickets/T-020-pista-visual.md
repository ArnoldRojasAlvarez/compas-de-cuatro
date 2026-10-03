# T-020 · Pista: notas, receptores, flash de golpe, juicio y fondo

| | |
|---|---|
| **Fase** | 3 · La cascara (pasada grafica) |
| **Modelo** | Sonnet |
| **Rama** | `main` directo (ver "Git") |
| **Depende de** | T-004, T-009 (skins), `docs/DISENO.md` |

## Contexto

`packages/engine/src/playfield.ts` dibuja con rectangulos de `Texture.WHITE`
tintados en colores que no son de la paleta (rojo, amarillo, teal, azul por
columna, un violeta para las LN) y los juicios con un `new Text()` por golpe
(alloca en el loop de juego y ademas usa colores ajenos). No hay fondo de
pista ni lineas de carril, ni flash al golpear.

Objetivo: que la pista se vea como un instrumento de precision con la paleta
propia, sin perder rendimiento y sin tocar el soporte de skins `.osk`.

## Contrato

- La interfaz publica `Playfield`, `PlayfieldOptions` y `createPlayfield(app,
  chart, options, skin?)` **no cambian**. `index.ts` del engine no cambia
  salvo que exportes algo puro nuevo.
- Con skin (`skin` definido y la textura presente) se usa la textura tal cual,
  como hoy. **Lo que se mejora es el fallback sin skin.** Fondo de pista,
  lineas de carril, flash de golpe y juicio se dibujan con o sin skin.
- Paleta (de `apps/web/src/tokens.css`, aca como constantes hex porque Pixi no
  lee CSS): fondo `#0b0e11`, superficie `#131a1f`, linea `#263139`, acento
  `#3fd8c2`, ambar `#e8b84a`, tinta `#e7eef0`. Juicios: max `#3fd8c2`, perfect
  `#e8b84a`, great `#5fc46a`, good `#4f93d8`, bad `#9a78d8`, miss `#d8544e`.

### Que dibujar (fallback)

1. **Fondo de pista**: gradiente vertical sutil (de superficie casi
   transparente arriba a superficie mas densa abajo), hecho UNA vez al crear el
   playfield (Graphics o una textura de gradiente generada una vez con
   `FillGradient` o un canvas). Lineas de carril finas (1px, `#263139`, alpha
   baja) entre columnas y en los bordes.
2. **Notas**: el patron 4K clasico de colores es exterior/interior: columnas 0
   y 3 en tinta (`#e7eef0`), columnas 1 y 2 en acento (`#3fd8c2`). (Nada de
   rojo/rosa.) Forma: rectangulo bajo con un borde inferior mas brillante o
   una franja interna, para que se lea la linea de tiempo exacta (el borde de
   abajo es el momento del golpe). Se permiten dos sprites por nota si van en
   el pool, o una textura generada una vez por color.
3. **LN**: cuerpo del color de la columna con alpha baja (0.35 a 0.5); cola
   como una nota fina.
4. **Receptores**: una linea de juicio horizontal fina a lo ancho de la pista
   en `receptorY` (acento con alpha), mas un receptor por columna (contorno o
   barra baja) que al pulsar se ilumina (`setPressed`).
5. **Flash de golpe por columna**: al pulsar una columna, un haz vertical
   desde el receptor hacia arriba (gradiente que se desvanece hacia arriba,
   del color de la columna), un sprite por columna creado al inicio,
   `visible`/`alpha` animado en `render()` con el tiempo de juego (decay de
   ~120 ms despues de soltar). Tambien con skin.
6. **Juicio**: UN solo texto de juicio centrado en la pista (estilo
   osu!mania), reutilizado: se crea una vez por juicio posible (6 `Text` o
   `BitmapText` creados al inicio, uno visible a la vez) y se anima con el
   tiempo de juego: aparece con escala 1.15 y baja a 1.0 en ~80 ms, se
   sostiene y se desvanece hasta `DURACION_POPUP_JUICIO`. Etiquetas: `MAX`,
   `300`, `200`, `100`, `50`, `MISS` (o los nombres en mayusculas; decidi y
   documenta, pero que sea consistente con los colores de juicio). Fuente:
   `JetBrains Mono` o `Sora` si estan cargadas (fallback `monospace`),
   peso 600, letter-spacing. Bajo el texto, opcional, un indicador mini de
   temprano/tarde NO (fuera de alcance: no hay error en `showJudgement`).

### Rendimiento (obligatorio)

- **Cero `new` en `render()`** y en `showJudgement()` / `setPressed()` despues
  de la creacion: ni `Text`, ni `Graphics`, ni objetos literales en el camino
  caliente (el array `popupsPendientes` de objetos se reemplaza por estado
  fijo: ultimo juicio + tiempo de aparicion; el tiempo de aparicion se toma
  en el proximo `render(time)` como hoy).
- Graphics del fondo y texturas generadas se crean una vez y se destruyen en
  `destroy()`.
- Se mantiene el culling y el pooling de T-004.

### Logica pura nueva (testeable): `packages/engine/src/efectos.ts`

```ts
/** Alpha del flash de una columna: 1 mientras esta pulsada; al soltar decae linealmente a 0 en DECAY_FLASH_MS. msDesdeSoltar < 0 o pulsada => 1. */
export const DECAY_FLASH_MS = 120;
export function alphaFlash(pulsada: boolean, msDesdeSoltar: number): number;
/** Animacion del juicio: { escala, alpha } segun ms desde que aparecio; fuera de [0, duracion) => alpha 0. */
export function animacionJuicio(msDesdeAparicion: number, duracion: number): { escala: number; alpha: number };
/** Color de nota por columna en el fallback (exterior/interior). */
export function colorDeNota(columna: number): number;
```

`animacionJuicio` devuelve un objeto: llamala de forma que no aloque por frame
(por ejemplo una variante que escriba en un objeto de salida reutilizado, o
dos funciones `escalaJuicio` y `alphaJuicio`). Decidi y documenta.

Para saber "ms desde que se solto" el playfield necesita el tiempo del ultimo
`setPressed(col, false)`: como `setPressed` no recibe tiempo, registra un flag
y toma el tiempo en el siguiente `render(time)` (mismo patron que los popups).

## Criterios de aceptacion

- [ ] Sin skin: fondo con gradiente, lineas de carril, notas tinta/teal, LN legibles, receptores y linea de juicio.
- [ ] Con skin: las texturas de la skin se siguen usando para notas, LN y receptores.
- [ ] Flash por columna al pulsar, con decay al soltar.
- [ ] Un solo juicio centrado, reutilizado, con los colores de juicio de la paleta.
- [ ] Cero allocaciones en el camino caliente (revisable leyendo `render`).
- [ ] `destroy()` libera todo lo nuevo.

## Tests

`packages/engine/src/efectos.test.ts`: decay del flash (pulsada, 0 ms, mitad,
pasado), escala y alpha del juicio en 0, durante el pop, a mitad, al final y
fuera de rango, colores exterior/interior. Que fallen con una implementacion
incorrecta (por ejemplo, colores invertidos o decay que no llega a 0).

## Fuera de alcance

HUD (T-019), cambios a `PlayfieldOptions`, SV, mostrar temprano/tarde.

## Git

Directo en `main`, compartido. `git add` SOLO con rutas explicitas
(`packages/engine/src/playfield.ts`, `packages/engine/src/efectos.ts`,
`packages/engine/src/efectos.test.ts`, y `packages/engine/src/index.ts` si lo
tocas). Jamas `git add -A`, stash, checkout, reset, rebase. Commit:
`feat(engine): pista con paleta propia, flash de golpe y juicio reutilizado
(T-020)` y la linea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Terminado cuando

Los cuatro checks en verde (correr `npm run typecheck` antes de `npm run test`:
los tests usan la dist de los paquetes; si falla algo en archivos que no son
tuyos, reintenta o aisla con vitest y declaralo) y el commit hecho.
