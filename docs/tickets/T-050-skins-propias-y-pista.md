# T-050 · Skins propias y pista mas viva (engine)

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Rama** | `feat/skins-propias` (worktree) |
| **Depende de** | T-009, T-020 |

## Contexto

Sin `.osk` importado la pista dibuja rectangulos tintados (T-020). Funciona,
pero para un estado demo hace falta que el juego traiga **skins propias**
lindas, con la identidad de `docs/DISENO.md` (instrumento de precision, teal
y ambar, nada de rosa osu!), y que la pista tenga mas respuesta visual al
golpe. Tambien hace falta que la pista deje ver el fondo de la cancion
(T-053 lo pone detras del lienzo).

Este ticket es solo `packages/engine`. El cableado en la app (elegir skin en
ajustes, pasarla a la partida) es T-053.

## La idea clave

Una skin propia es **una skin mas**: se dibuja con Canvas 2D en
`HTMLCanvasElement`s y se convierte a `TexturasDeSkin` con el mismo camino que
un `.osk`. Asi `playfield.ts` no necesita una rama por skin, y la misma
funcion de dibujo sirve para las miniaturas de ajustes.

## Contrato

```ts
// packages/engine/src/skins-propias.ts (nuevo)
export type IdSkinPropia = 'tetra' | 'barras' | 'circulos' | 'diamantes';

export interface SkinPropia {
  id: IdSkinPropia;
  /** Nombre corto para la UI: "Tetra", "Barras", "Circulos", "Diamantes". */
  nombre: string;
}

export const SKINS_PROPIAS: readonly SkinPropia[];
export const SKIN_PROPIA_POR_DEFECTO: IdSkinPropia; // 'tetra'

/**
 * Dibuja las 10 imagenes (ClaveImagenSkin) de la skin para un carril de
 * `anchoColumna` px (dibujar a 2x para que se vea nitido). Pura respecto
 * del estado: misma entrada, mismo dibujo.
 */
export function dibujarSkinPropia(
  id: IdSkinPropia,
  anchoColumna: number,
): Record<ClaveImagenSkin, HTMLCanvasElement>;

/** Lo de arriba convertido a Texture de Pixi (Texture.from(canvas)), listo para createPlayfield. */
export function texturasDeSkinPropia(id: IdSkinPropia, anchoColumna: number): TexturasDeSkin;

/**
 * Miniatura estatica para elegir skin: cuatro carriles con un par de notas,
 * una LN y los receptores, sobre fondo transparente. Para ajustes (T-053).
 */
export function dibujarMiniaturaDeSkin(ctx: CanvasRenderingContext2D, id: IdSkinPropia, ancho: number, alto: number): void;
```

```ts
// playfield.ts: createPlayfield gana un quinto parametro opcional
export interface OpcionesVisualesPista {
  /** 0 a 1. Opacidad del fondo de la pista (los carriles). Default 0.85. Menos = se ve mas el fondo de la cancion. */
  opacidadPista?: number;
}
export function createPlayfield(app, chart, options, skin?, visual?: OpcionesVisualesPista): Playfield;
```

Exportar todo lo nuevo desde `packages/engine/src/index.ts`. Nada de lo que ya
existe cambia de firma.

## Las cuatro skins

Todas usan la paleta (`docs/DISENO.md`). Exteriores (columnas 0 y 3) e
interiores (1 y 2) distintos, como en osu!mania 4K.

- **Tetra** (por defecto): barras con esquinas de 3px, cuerpo con gradiente
  vertical suave y un filo claro arriba; exteriores tinta (`#E7EEF0`),
  interiores teal (`#3FD8C2`). Receptor: barra fina con contorno, que al
  pulsar se llena con el color de la columna. Cuerpo de LN translucido del
  mismo color, cola redondeada.
- **Barras**: estilo clasico plano a lo ancho de todo el carril (casi sin
  margen), exteriores blancos, interiores ambar. Receptor como tecla.
- **Circulos**: notas redondas (diametro ~70 % del carril) con brillo interno;
  exteriores teal, interiores ambar. Receptor: anillo; pulsado: anillo lleno.
- **Diamantes**: rombos afilados (el cuatro: cuatro vertices), exteriores
  azul `#4F93D8`, interiores violeta `#9A78D8`. Receptor: rombo vacio.

Que se distingan a primera vista en una miniatura chica.

## Pista mas viva (playfield.ts)

Sin allocaciones por frame (la regla de T-020 sigue: todo se crea en
`createPlayfield` y se libera en `destroy`).

- **Iluminacion al golpe**: al juzgar una nota que no es miss, un destello en
  el receptor de esa columna con el color del juicio (`COLOR_JUICIO`), que se
  expande un poco y se apaga en ~160 ms. Un sprite por columna, reusado.
- **Haz de columna**: el flash de pulsado actual (T-020) toma un gradiente mas
  suave y alto; con skin propia toma el color de la columna.
- **Linea de juicio** con un glow tenue (dos lineas: una fina nitida, una
  ancha muy transparente).
- **Bordes del escenario**: una linea vertical de 1px a cada lado de la pista
  en `--linea`, para que la pista se lea sobre un fondo con imagen.
- **Fondo de la pista** con `opacidadPista` (default 0.85).
- **Juicio**: mantener el texto reutilizado; sumarle un leve desplazamiento
  vertical en el pop (de +6px a 0). MISS en rojo sin glow; MAX con glow teal.
- La aritmetica nueva (escala/alpha del destello, desplazamiento del juicio)
  va en `efectos.ts`, pura y con tests, como la existente.

## Criterios de aceptacion

- [ ] `texturasDeSkinPropia` devuelve las 10 claves para cada skin.
- [ ] Una partida con cada skin propia se ve bien a 60 fps (verificado en el
      navegador por el revisor; vos dejalo listo para eso).
- [ ] `.osk` importados siguen viendose igual que antes; sin skin y sin `.osk`
      sigue existiendo el fallback (aunque la app pasara a usar Tetra por
      defecto en T-053).
- [ ] Ningun `new` en `render()`, `showJudgement()` ni `setPressed()`.
- [ ] Los cuatro checks en verde.

## Tests

- `efectos.test.ts`: curvas nuevas (bordes 0, duracion, valores negativos).
- `skins-propias.test.ts`: `SKINS_PROPIAS` tiene 4 ids unicos y el default
  esta entre ellos. El dibujo con Canvas no se testea en vitest (node, sin
  canvas): misma razon que `playfield.ts`. Si queres, separa la geometria
  (puntos del rombo, radio del circulo segun ancho) en funciones puras y
  testealas.

## Fuera de alcance

La UI de ajustes, game.ts, el fondo de la cancion y el video (T-053).
Hitsounds. Skins por columna (4 colores distintos).

## Terminado cuando

Los cuatro checks en verde y el reporte lista decisiones no cubiertas.
