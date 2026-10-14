// T-004: render de la pista con Pixi.
//
// Este archivo si toca Pixi (a diferencia de position.ts): por eso no tiene
// test de vitest, que corre en node sin renderer (ver docs/tickets/T-004,
// seccion "Tests" y el comentario en position.ts). Lo que se prueba con
// assert es la aritmetica pura que usa aca adentro; lo visual lo cubre la
// prueba de feel de Arnold y el e2e.
//
// Rendimiento (ver T-004, "Rendimiento"): con 3500 notas no se crean 3500
// sprites. Dos tecnicas, combinadas:
// - Culling: `avanzarVentana` (position.ts) da, por columna, el rango de
//   indices visible dentro de `chart.notes` filtrado por columna. Los
//   punteros son monotonicos: nunca se vuelve a recorrer desde el principio.
// - Pooling: los sprites de marcador y de cuerpo de LN se reciclan por
//   columna. Desde T-039 cada pool nace dimensionado por el maximo de notas
//   visibles a la vez de SU columna (`maximoVisibleEnColumna`, segun el
//   scrollDuration y la densidad real del mapa) y precalentado (ver
//   `Pool.precalentar`): `render()` no crea sprites ni objetos nunca. Los
//   punteros de la ventana son un objeto por columna que se reescribe en sitio.
//
// T-020: pasada grafica con la paleta propia (docs/DISENO.md). Todo lo que
// se genera (texturas de gradiente, textos de juicio, sprites de flash) se
// crea UNA vez en createPlayfield y se libera en destroy(). Ni render() ni
// showJudgement() ni setPressed() crean objetos: el estado de efectos son
// numeros y booleanos en arrays de tamano fijo. La aritmetica de las
// animaciones vive en efectos.ts (pura, con tests).
//
// T-050: destello por columna al juzgar (un sprite reusado con mezcla
// aditiva), haz de pulsado mas suave y alto, glow de la linea de juicio,
// bordes del escenario opacos y `opacidadPista` (quinto parametro opcional).
// Las skins propias (skins-propias.ts) se reconocen por `infoDeSkinPropia`:
// sus piezas se dibujan a su tamano natural en vez de estirarse.

import { Container, FillGradient, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Chart, Column, Judgement, Ms, Note } from '@tetra/core';
import { COLUMN_COUNT, isHold } from '@tetra/core';
import {
  avanzarVentanaEnSitio,
  maximoVisibleEnColumna,
  calcularProgreso,
  progresoAY,
  progresoEsVisible,
  receptorY,
  tramoVisible,
  ventanaVacia,
  type GeometriaPista,
  type VentanaNotas,
} from './position.js';
import { imagenDeSkin, type TexturasDeSkin } from './skin.js';
import {
  alphaDestello,
  alphaFlash,
  alphaJuicio,
  colorDeNota,
  desplazamientoJuicio,
  escalaDestello,
  escalaJuicio,
  normalizarOpacidadPista,
} from './efectos.js';
import { crearLienzo } from './lienzo.js';
import { infoDeSkinPropia } from './skins-propias.js';

export interface PlayfieldOptions {
  /** Cuantos ms de pista se ven de golpe. Menor valor, notas mas rapidas. */
  scrollDuration: Ms;
  /** Alto del area de juego en pixeles. */
  height: number;
  /** Ancho de cada carril en pixeles. */
  columnWidth: number;
  /** Distancia del receptor al borde inferior, en pixeles. */
  receptorOffset: number;
  /**
   * T-039: el `scrollDuration` MAS LENTO que puede tener la pista durante la
   * partida (con la velocidad cambiando en caliente, F3/F4). Con el se
   * dimensionan los pools de sprites: cuanto mas lento, mas notas a la vez.
   * Sin esto se usa `scrollDuration` tal como llega al crear la pista.
   */
  scrollDurationMaximo?: Ms;
}

/** Ajustes visuales opcionales de la pista (T-050). */
export interface OpcionesVisualesPista {
  /** 0 a 1. Opacidad del fondo de la pista (los carriles). Default 0.85. Menos = se ve mas el fondo de la cancion. */
  opacidadPista?: number;
}

export interface Playfield {
  /** Dibuja el estado en el tiempo dado. Se llama una vez por frame. */
  render(time: Ms): void;

  /** Efecto visual al juzgar una nota. */
  showJudgement(column: Column, judgement: Judgement): void;

  /** Ilumina o apaga el receptor de una columna. */
  setPressed(column: Column, pressed: boolean): void;

  resize(width: number, height: number): void;

  destroy(): void;
}

// ---------------------------------------------------------------------------
// Constantes visuales
// ---------------------------------------------------------------------------

const ALTO_MARCADOR = 18;
const ALTO_COLA_FALLBACK = 8;
const ANCHO_MARCADOR_FACTOR = 0.82;
const ANCHO_CUERPO_FACTOR = 0.5;
const DURACION_POPUP_JUICIO: Ms = 450;
const ALTO_RECEPTOR = 6;
const ALTO_LINEA_JUICIO = 2;


// Paleta (docs/DISENO.md, apps/web/src/tokens.css). Pixi no lee CSS, por eso
// van como constantes hex.
const COLOR_LINEA = 0x263139;
const COLOR_TINTA_3 = 0x5f6e77;
const COLOR_ACENTO = 0x3fd8c2;

const COLOR_RECEPTOR_APAGADO = COLOR_TINTA_3;
const ALPHA_LINEA_CARRIL = 0.7;
/** Los bordes del escenario (primera y ultima linea) van opacos: la pista tiene que leerse sobre un fondo con imagen. */
const ALPHA_BORDE_ESCENARIO = 1;
const ALPHA_LINEA_JUICIO = 0.5;
/** Glow de la linea de juicio: una segunda linea ancha y muy transparente bajo la nitida. */
const ALTO_GLOW_LINEA_JUICIO = 10;
const ALPHA_GLOW_LINEA_JUICIO = 0.14;

/** Alpha de los cuerpos de LN: baja en el fallback, la de siempre con skin. */
const ALPHA_CUERPO_FALLBACK = 0.42;
const ALPHA_CUERPO_SKIN = 0.55;

/** Alpha maximo del haz de flash y su tamano como fraccion de la pista. */
const ALPHA_MAX_FLASH = 0.5;
const ALTO_FLASH_FACTOR = 0.55;
const ANCHO_FLASH_FACTOR = 0.94;

/** Destello del receptor al golpear: alpha maximo y tamano base como fraccion del carril. */
const ALPHA_MAX_DESTELLO = 0.9;
const TAMANO_DESTELLO_FACTOR = 1.25;

/** Altura del texto de juicio, como fraccion de `receptorY`. */
const POSICION_JUICIO_FACTOR = 0.58;

/** Glow del texto MAX (teal); el resto de juicios no brilla y MISS en particular va seco. */
const GLOW_JUICIO_MAX = { alpha: 0.65, angle: 0, blur: 8, color: 0x3fd8c2, distance: 0 };

const FUENTE_JUICIO = "'JetBrains Mono', 'Sora', monospace";
const TAMANO_JUICIO = 34;

/** Orden fijo de los juicios: el indice es el del texto en `textosJuicio`. */
const ORDEN_JUICIOS: readonly Judgement[] = ['max', 'perfect', 'great', 'good', 'bad', 'miss'];

const INDICE_JUICIO: Record<Judgement, number> = {
  max: 0,
  perfect: 1,
  great: 2,
  good: 3,
  bad: 4,
  miss: 5,
};

/**
 * Colores de juicio de la paleta (docs/DISENO.md, `--j-*`). Etiquetas en
 * estilo osu!mania, consistentes con esos colores: MAX es el acento (teal),
 * 300 el ambar, 200 verde, 100 azul, 50 violeta y MISS rojo.
 */
const COLOR_JUICIO: Record<Judgement, number> = {
  max: 0x3fd8c2,
  perfect: 0xe8b84a,
  great: 0x5fc46a,
  good: 0x4f93d8,
  bad: 0x9a78d8,
  miss: 0xd8544e,
};

const ETIQUETA_JUICIO: Record<Judgement, string> = {
  max: 'MAX',
  perfect: '300',
  great: '200',
  good: '100',
  bad: '50',
  miss: 'MISS',
};

// ---------------------------------------------------------------------------
// Pool de sprites
// ---------------------------------------------------------------------------

/**
 * Pool simple de sprites reciclables: `usados` cuenta cuantos de `sprites`
 * estan en pantalla este frame. `obtener()` reusa el primero libre o crea
 * uno nuevo si el pool no alcanza; `ocultarSobrantes()` apaga los que
 * quedaron sin usar despues de dibujar.
 */
class Pool {
  private readonly sprites: Sprite[] = [];
  private usados = 0;

  constructor(
    private readonly contenedor: Container,
    private readonly crearSprite: () => Sprite,
  ) {}

  /** Crea `cantidad` sprites ocultos de entrada, para que render() no tenga que crearlos. */
  precalentar(cantidad: number): void {
    while (this.sprites.length < cantidad) {
      const sprite = this.crearSprite();
      sprite.visible = false;
      this.contenedor.addChild(sprite);
      this.sprites.push(sprite);
    }
  }

  reiniciar(): void {
    this.usados = 0;
  }

  obtener(): Sprite {
    if (this.usados < this.sprites.length) {
      const sprite = this.sprites[this.usados]!;
      sprite.visible = true;
      this.usados++;
      return sprite;
    }

    const sprite = this.crearSprite();
    this.contenedor.addChild(sprite);
    this.sprites.push(sprite);
    this.usados++;
    return sprite;
  }

  ocultarSobrantes(): void {
    for (let i = this.usados; i < this.sprites.length; i++) {
      this.sprites[i]!.visible = false;
    }
  }

  get cantidadViva(): number {
    return this.usados;
  }

  destruir(): void {
    for (const sprite of this.sprites) {
      sprite.destroy();
    }
    this.sprites.length = 0;
    this.usados = 0;
  }
}

/**
 * Texturas de skin ya repartidas por columna (ver skin.ts, `imagenDeSkin`),
 * para no tener que volver a resolver "es columna exterior o interior" en
 * cada frame dentro de render(). Se calcula una sola vez al crear el
 * Playfield (ver mas abajo, dentro de createPlayfield): con esto la unica
 * llamada a `imagenDeSkin` de todo el archivo queda ahi, no repartida por
 * el render (ver el ticket, "Cuidado con la convencion de columnas").
 */
interface TexturasDeColumna {
  nota: Texture | undefined;
  cuerpoLn: Texture | undefined;
  colaLn: Texture | undefined;
  receptor: Texture | undefined;
  receptorPulsado: Texture | undefined;
}

function texturasDeColumna(columna: Column, skin: TexturasDeSkin | undefined): TexturasDeColumna {
  if (skin === undefined) {
    return {
      nota: undefined,
      cuerpoLn: undefined,
      colaLn: undefined,
      receptor: undefined,
      receptorPulsado: undefined,
    };
  }
  return {
    nota: skin[imagenDeSkin(columna, 'nota')],
    cuerpoLn: skin[imagenDeSkin(columna, 'cuerpoLn')],
    colaLn: skin[imagenDeSkin(columna, 'colaLn')],
    receptor: skin[imagenDeSkin(columna, 'receptor')],
    receptorPulsado: skin[imagenDeSkin(columna, 'receptorPulsado')],
  };
}

/**
 * Aplica a `sprite` la textura de skin si vino (`textura` no es
 * `undefined`), sin tintar (la imagen se ve tal cual la trae el skin); si
 * no vino, cae a `texturaFallback` tintada con `colorFallback` (ver el
 * ticket, "Fallback": sin skin, o con una skin a la que le falte esa imagen
 * puntual, se ve el dibujo propio de la paleta). Se llama en cada frame,
 * sobre sprites que ya existen (vienen del Pool): nunca crea una textura
 * nueva, solo reasigna cual usa el sprite (T-004, "Rendimiento" sigue
 * intacto).
 */
function aplicarTextura(
  sprite: Sprite,
  textura: Texture | undefined,
  texturaFallback: Texture,
  colorFallback: number,
): void {
  if (textura !== undefined) {
    sprite.texture = textura;
    sprite.tint = 0xffffff;
  } else {
    sprite.texture = texturaFallback;
    sprite.tint = colorFallback;
  }
}

/**
 * Dibuja con `dibujar` sobre un Graphics temporal y lo convierte en una
 * textura (una sola vez, al crear el playfield). El Graphics se descarta; la
 * textura la libera destroy().
 */
function generarTextura(
  app: Application,
  ancho: number,
  alto: number,
  dibujar: (g: Graphics) => void,
): Texture {
  const g = new Graphics();
  dibujar(g);
  const textura = app.renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, ancho, alto),
    resolution: 2,
  });
  g.destroy();
  return textura;
}

/**
 * Haz de pulsado: blanco, transparente arriba y mas opaco abajo (en el
 * receptor), con curva suave (varias paradas, no una rampa lineal) y bordes
 * laterales que se desvanecen. Se tinta con el color de la columna. Se dibuja
 * con Canvas 2D, una vez al crear el playfield.
 */
function crearTexturaHaz(): Texture {
  const { canvas, ctx, ancho, alto } = crearLienzo(32, 128);
  const vertical = ctx.createLinearGradient(0, 0, 0, alto);
  vertical.addColorStop(0, 'rgba(255, 255, 255, 0)');
  vertical.addColorStop(0.45, 'rgba(255, 255, 255, 0.08)');
  vertical.addColorStop(0.8, 'rgba(255, 255, 255, 0.34)');
  vertical.addColorStop(1, 'rgba(255, 255, 255, 0.78)');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, ancho, alto);
  // Desvanece los costados: lo que ya esta dibujado se queda segun este degradado horizontal.
  ctx.globalCompositeOperation = 'destination-in';
  const horizontal = ctx.createLinearGradient(0, 0, ancho, 0);
  horizontal.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
  horizontal.addColorStop(0.3, 'rgba(0, 0, 0, 1)');
  horizontal.addColorStop(0.7, 'rgba(0, 0, 0, 1)');
  horizontal.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, ancho, alto);
  return Texture.from(canvas);
}

/**
 * Brillo redondo para el destello del receptor: blanco al centro y
 * transparente en el borde. Se tinta con el color del juicio y se dibuja con
 * mezcla aditiva.
 */
function crearTexturaBrillo(): Texture {
  const { canvas, ctx, ancho, alto } = crearLienzo(64, 64);
  const g = ctx.createRadialGradient(ancho / 2, alto / 2, 0, ancho / 2, alto / 2, ancho / 2);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)');
  g.addColorStop(0.3, 'rgba(255, 255, 255, 0.55)');
  g.addColorStop(0.65, 'rgba(255, 255, 255, 0.14)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ancho, alto);
  return Texture.from(canvas);
}

export function createPlayfield(
  app: Application,
  chart: Chart,
  options: PlayfieldOptions,
  skin?: TexturasDeSkin,
  visual?: OpcionesVisualesPista,
): Playfield {
  // Se guarda la referencia a `options`, no una copia: si quien nos creo
  // muta `options.scrollDuration` en caliente, el proximo render() ya lo ve,
  // sin hacer falta un setter aparte ni recrear el playfield (ver T-004,
  // criterio "cambiar scrollDuration en caliente reposiciona las notas sin
  // reiniciar"). Decision de implementacion, el contrato del ticket no
  // detalla el mecanismo.
  let alturaActual = options.height;

  const raiz = new Container();
  app.stage.addChild(raiz);

  const capaFondo = new Container();
  const capaFlash = new Container();
  const capaCuerpos = new Container();
  const capaReceptores = new Container();
  const capaDestellos = new Container();
  const capaMarcadores = new Container();
  const capaJuicios = new Container();
  raiz.addChild(
    capaFondo,
    capaFlash,
    capaCuerpos,
    capaReceptores,
    capaDestellos,
    capaMarcadores,
    capaJuicios,
  );

  // Notas separadas por columna, en el mismo orden ascendente que
  // chart.notes (mismo patron que MotorDeJuicio en packages/core): permite
  // que avanzarVentana trabaje con punteros por columna independientes.
  const notasPorColumna: Note[][] = [[], [], [], []];
  for (const nota of chart.notes) {
    notasPorColumna[nota.column]!.push(nota);
  }

  const ventanasPorColumna: VentanaNotas[] = [
    ventanaVacia(),
    ventanaVacia(),
    ventanaVacia(),
    ventanaVacia(),
  ];

  // Texturas de skin resueltas por columna, calculadas una sola vez aca (ver
  // el comentario de `texturasDeColumna` mas arriba): el resto de
  // createPlayfield y render() solo lee este array, nunca vuelve a llamar
  // `imagenDeSkin`.
  const texturasPorColumna: TexturasDeColumna[] = [];
  for (let columna = 0; columna < COLUMN_COUNT; columna++) {
    texturasPorColumna.push(texturasDeColumna(columna as Column, skin));
  }

  // Si la skin es una de las propias (texturasDeSkinPropia) se conocen sus
  // medidas y colores: las piezas se dibujan a su tamano natural (no se
  // estiran como las de un .osk) y el haz de pulsado toma el color de la
  // columna. Con un .osk o sin skin esto es `undefined` y todo queda como antes.
  const propia = infoDeSkinPropia(skin);
  const opacidadPista = normalizarOpacidadPista(visual?.opacidadPista);
  // T-039: con el scrollDuration mas lento que puede tener la partida caben mas notas a la vez.
  const scrollDurationDePool = Math.max(options.scrollDuration, options.scrollDurationMaximo ?? 0);

  // -------------------------------------------------------------------------
  // Texturas generadas (una vez; se destruyen en destroy())
  // -------------------------------------------------------------------------

  // Fondo de pista: gradiente vertical de superficie casi transparente
  // arriba a superficie mas densa abajo.
  const texturaFondo = generarTextura(app, 4, 256, (g) => {
    const gradiente = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 'rgba(19, 26, 31, 0.15)' },
        { offset: 1, color: 'rgba(19, 26, 31, 0.92)' },
      ],
    });
    g.rect(0, 0, 4, 256).fill(gradiente);
  });

  // Nota del fallback: cuerpo en gris que se tinta con el color de la
  // columna (queda un poco mas oscuro) y una franja inferior blanca (que
  // toma el color pleno). El borde de abajo es el momento del golpe.
  const anchoTexNota = 64;
  const franjaNota = 4;
  const texturaNota = generarTextura(app, anchoTexNota, ALTO_MARCADOR, (g) => {
    const cuerpo = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 0x8a8a8a },
        { offset: 1, color: 0xd0d0d0 },
      ],
    });
    g.rect(0, 0, anchoTexNota, ALTO_MARCADOR - franjaNota).fill(cuerpo);
    g.rect(0, ALTO_MARCADOR - franjaNota, anchoTexNota, franjaNota).fill(0xffffff);
  });

  // Haz del flash y brillo del destello: se dibujan con Canvas 2D (ver
  // crearTexturaHaz y crearTexturaBrillo).
  const texturaFlash = crearTexturaHaz();
  const texturaBrillo = crearTexturaBrillo();

  // -------------------------------------------------------------------------
  // Fondo, lineas de carril y linea de juicio
  // -------------------------------------------------------------------------

  const fondo = new Sprite(texturaFondo);
  fondo.alpha = opacidadPista;
  capaFondo.addChild(fondo);

  const lineasCarril: Sprite[] = [];
  for (let i = 0; i <= COLUMN_COUNT; i++) {
    const linea = new Sprite(Texture.WHITE);
    linea.tint = COLOR_LINEA;
    // Primera y ultima linea: los bordes del escenario, opacos.
    linea.alpha = i === 0 || i === COLUMN_COUNT ? ALPHA_BORDE_ESCENARIO : ALPHA_LINEA_CARRIL;
    linea.width = 1;
    capaFondo.addChild(linea);
    lineasCarril.push(linea);
  }

  const glowLineaJuicio = new Sprite(Texture.WHITE);
  glowLineaJuicio.tint = COLOR_ACENTO;
  glowLineaJuicio.alpha = ALPHA_GLOW_LINEA_JUICIO;
  glowLineaJuicio.anchor.set(0, 0.5);
  glowLineaJuicio.height = ALTO_GLOW_LINEA_JUICIO;
  capaReceptores.addChild(glowLineaJuicio);

  const lineaJuicio = new Sprite(Texture.WHITE);
  lineaJuicio.tint = COLOR_ACENTO;
  lineaJuicio.alpha = ALPHA_LINEA_JUICIO;
  lineaJuicio.anchor.set(0, 0.5);
  lineaJuicio.height = ALTO_LINEA_JUICIO;
  capaReceptores.addChild(lineaJuicio);

  // -------------------------------------------------------------------------
  // Pools, receptores y flash por columna
  // -------------------------------------------------------------------------

  const poolMarcadores: Pool[] = [];
  const poolCuerpos: Pool[] = [];
  const receptores: Sprite[] = [];
  const hacesFlash: Sprite[] = [];
  const destellos: Sprite[] = [];

  // Por columna, lo que depende de si esa imagen viene de la skin o es el
  // fallback propio (se resuelve una vez aca): color y desplazamientos
  // verticales. En el fallback la nota y la cola se dibujan con su borde
  // inferior sobre la linea de tiempo; la skin se dibuja centrada, como hoy.
  const colorNota: number[] = [];
  const desplNota: number[] = [];
  const desplCola: number[] = [];
  const altoCola: number[] = [];
  const alphaCuerpo: number[] = [];
  /** Color del haz de pulsado por columna: el de la skin propia, o el de la nota del fallback. */
  const colorHaz: number[] = [];

  // Estado de efectos por columna: numeros y booleanos de tamano fijo, sin
  // objetos nuevos por evento. `setPressed(false)` no trae tiempo, asi que
  // solo marca `soltadaPendiente` y render() toma el tiempo del frame.
  const pulsadas: boolean[] = [];
  const soltadaPendiente: boolean[] = [];
  const tiempoSoltada: Ms[] = [];
  // Destello al golpe (T-050): mismo patron. showJudgement() no recibe tiempo,
  // asi que deja el pedido y el color y render() toma el tiempo del frame.
  const destelloPendiente: boolean[] = [];
  const colorDestelloPendiente: number[] = [];
  const tiempoDestello: Ms[] = [];

  for (let columna = 0; columna < COLUMN_COUNT; columna++) {
    const texturas = texturasPorColumna[columna]!;
    const color = colorDeNota(columna);
    colorNota.push(color);
    desplNota.push(texturas.nota === undefined ? -ALTO_MARCADOR / 2 : 0);
    desplCola.push(texturas.colaLn === undefined ? -ALTO_COLA_FALLBACK / 2 : 0);
    altoCola.push(texturas.colaLn === undefined ? ALTO_COLA_FALLBACK : ALTO_MARCADOR);
    alphaCuerpo.push(
      propia !== undefined
        ? 1 // la translucidez de una skin propia ya viene en la textura
        : texturas.cuerpoLn === undefined
          ? ALPHA_CUERPO_FALLBACK
          : ALPHA_CUERPO_SKIN,
    );
    // Exterior o interior se decide una sola vez, con la misma funcion que usa la skin.
    const exterior = imagenDeSkin(columna as Column, 'nota') === 'note1';
    colorHaz.push(
      propia === undefined ? color : exterior ? propia.colores.exterior : propia.colores.interior,
    );

    pulsadas.push(false);
    soltadaPendiente.push(false);
    tiempoSoltada.push(Number.NEGATIVE_INFINITY);
    destelloPendiente.push(false);
    colorDestelloPendiente.push(COLOR_JUICIO.max);
    tiempoDestello.push(Number.NEGATIVE_INFINITY);

    // T-039: los pools se dimensionan por lo que esta columna puede mostrar a la
    // vez, no por una constante. Una nota larga usa un cuerpo y hasta dos
    // marcadores (cabeza y cola), una simple un marcador.
    const visiblesMaximo = maximoVisibleEnColumna(notasPorColumna[columna]!, scrollDurationDePool);

    const poolMarcador = new Pool(capaMarcadores, () => {
      const sprite = new Sprite(Texture.WHITE);
      sprite.anchor.set(0.5, 0.5);
      return sprite;
    });
    poolMarcador.precalentar(visiblesMaximo * 2);
    poolMarcadores.push(poolMarcador);

    const poolCuerpo = new Pool(capaCuerpos, () => {
      const sprite = new Sprite(Texture.WHITE);
      sprite.alpha = ALPHA_CUERPO_SKIN;
      sprite.anchor.set(0.5, 0);
      return sprite;
    });
    poolCuerpo.precalentar(visiblesMaximo);
    poolCuerpos.push(poolCuerpo);

    const receptor = new Sprite(Texture.WHITE);
    // Con imagen de skin el receptor se centra en la linea (como hoy); el
    // fallback es una barra baja que cuelga justo debajo de la linea de juicio.
    receptor.anchor.set(0.5, texturas.receptor === undefined ? 0 : 0.5);
    // (el alto y el ancho se fijan en posicionarElementos)
    aplicarTextura(receptor, texturas.receptor, Texture.WHITE, COLOR_RECEPTOR_APAGADO);
    capaReceptores.addChild(receptor);
    receptores.push(receptor);

    const haz = new Sprite(texturaFlash);
    haz.anchor.set(0.5, 1);
    haz.tint = colorHaz[columna]!;
    haz.alpha = 0;
    haz.visible = false;
    capaFlash.addChild(haz);
    hacesFlash.push(haz);

    const destello = new Sprite(texturaBrillo);
    destello.anchor.set(0.5, 0.5);
    destello.blendMode = 'add';
    destello.alpha = 0;
    destello.visible = false;
    capaDestellos.addChild(destello);
    destellos.push(destello);
  }

  // -------------------------------------------------------------------------
  // Juicio: un Text por juicio posible, creados ahora, uno visible a la vez
  // -------------------------------------------------------------------------

  const textosJuicio: Text[] = [];
  for (const juicio of ORDEN_JUICIOS) {
    const texto = new Text({
      text: ETIQUETA_JUICIO[juicio],
      style: {
        fill: COLOR_JUICIO[juicio],
        fontFamily: FUENTE_JUICIO,
        fontSize: TAMANO_JUICIO,
        fontWeight: '600',
        letterSpacing: 3,
        // Solo MAX brilla (teal); el resto va seco, MISS incluido.
        ...(juicio === 'max' ? { dropShadow: GLOW_JUICIO_MAX } : {}),
      },
    });
    texto.anchor.set(0.5, 0.5);
    texto.visible = false;
    capaJuicios.addChild(texto);
    textosJuicio.push(texto);
  }

  // Estado del juicio: el ultimo pedido y el tiempo en que aparecio. Como
  // showJudgement() no recibe tiempo, solo deja `juicioPendiente`; render()
  // toma el tiempo del frame (showJudgement va antes que render() en el
  // bucle de apps/web/src/game.ts). Si llegan varios en el mismo frame
  // gana el ultimo.
  let juicioNuevo = 0;
  let juicioPendiente = false;
  let juicioVisible = -1;
  let juicioAparicion: Ms = 0;
  // Altura base del texto de juicio (el pop lo baja unos px y vuelve).
  let baseJuicioY = 0;

  // Un solo objeto de geometria, reutilizado: se actualiza en cada llamada
  // en vez de crear uno nuevo (geometria() corre dentro de render()).
  const geo: GeometriaPista = {
    height: alturaActual,
    receptorOffset: options.receptorOffset,
  };
  function geometria(): GeometriaPista {
    geo.height = alturaActual;
    geo.receptorOffset = options.receptorOffset;
    return geo;
  }

  function columnaX(columna: number): number {
    return columna * options.columnWidth + options.columnWidth / 2;
  }

  function posicionarElementos(): void {
    const anchoPista = options.columnWidth * COLUMN_COUNT;
    const y = receptorY(geometria());

    fondo.width = anchoPista;
    fondo.height = alturaActual;

    for (let i = 0; i <= COLUMN_COUNT; i++) {
      const linea = lineasCarril[i]!;
      // La ultima linea se corre 1px hacia adentro para no quedar fuera del canvas.
      linea.x = i === COLUMN_COUNT ? anchoPista - 1 : i * options.columnWidth;
      linea.height = alturaActual;
    }

    lineaJuicio.x = 0;
    lineaJuicio.y = y;
    lineaJuicio.width = anchoPista;
    glowLineaJuicio.x = 0;
    glowLineaJuicio.y = y;
    glowLineaJuicio.width = anchoPista;

    for (let columna = 0; columna < COLUMN_COUNT; columna++) {
      const receptor = receptores[columna]!;
      receptor.x = columnaX(columna);
      receptor.y = y;
      if (propia !== undefined) {
        receptor.width = options.columnWidth * propia.medidas.anchoReceptor;
        receptor.height = options.columnWidth * propia.medidas.altoReceptor;
      } else {
        receptor.width = options.columnWidth * ANCHO_MARCADOR_FACTOR;
        receptor.height = ALTO_RECEPTOR;
      }

      const haz = hacesFlash[columna]!;
      haz.x = columnaX(columna);
      haz.y = y;
      haz.width = options.columnWidth * ANCHO_FLASH_FACTOR;
      haz.height = y * ALTO_FLASH_FACTOR;

      const destello = destellos[columna]!;
      destello.x = columnaX(columna);
      destello.y = y;
    }

    baseJuicioY = y * POSICION_JUICIO_FACTOR;
    for (const texto of textosJuicio) {
      texto.x = anchoPista / 2;
      texto.y = baseJuicioY;
    }
  }
  posicionarElementos();

  function render(time: Ms): void {
    // Juicio: el nuevo (si hay) toma el tiempo de ESTE frame y reemplaza al
    // que estuviera visible.
    if (juicioPendiente) {
      if (juicioVisible >= 0) textosJuicio[juicioVisible]!.visible = false;
      juicioVisible = juicioNuevo;
      juicioAparicion = time;
      juicioPendiente = false;
      textosJuicio[juicioVisible]!.visible = true;
    }
    if (juicioVisible >= 0) {
      const texto = textosJuicio[juicioVisible]!;
      const transcurrido = time - juicioAparicion;
      const alpha = alphaJuicio(transcurrido, DURACION_POPUP_JUICIO);
      if (alpha <= 0) {
        texto.visible = false;
        juicioVisible = -1;
      } else {
        texto.alpha = alpha;
        texto.scale.set(escalaJuicio(transcurrido, DURACION_POPUP_JUICIO));
        texto.y = baseJuicioY + desplazamientoJuicio(transcurrido);
      }
    }

    // Flash de golpe por columna.
    for (let columna = 0; columna < COLUMN_COUNT; columna++) {
      if (soltadaPendiente[columna]) {
        tiempoSoltada[columna] = time;
        soltadaPendiente[columna] = false;
      }
      const alpha = alphaFlash(pulsadas[columna]!, time - tiempoSoltada[columna]!);
      const haz = hacesFlash[columna]!;
      haz.visible = alpha > 0;
      haz.alpha = alpha * ALPHA_MAX_FLASH;

      // Destello al golpe: toma el tiempo de este frame y se anima solo con el.
      if (destelloPendiente[columna]) {
        tiempoDestello[columna] = time;
        destelloPendiente[columna] = false;
        destellos[columna]!.tint = colorDestelloPendiente[columna]!;
      }
      const msDestello = time - tiempoDestello[columna]!;
      const alphaDeDestello = alphaDestello(msDestello);
      const destello = destellos[columna]!;
      destello.visible = alphaDeDestello > 0;
      if (alphaDeDestello > 0) {
        destello.alpha = alphaDeDestello * ALPHA_MAX_DESTELLO;
        destello.scale.set(
          (options.columnWidth * TAMANO_DESTELLO_FACTOR * escalaDestello(msDestello)) /
            texturaBrillo.width,
        );
      }
    }

    geometria();
    // Medidas de las piezas, una vez por frame: las de la skin propia (a su
    // tamano natural) o las de siempre (estiradas, con osk y fallback).
    const ancho = options.columnWidth;
    const anchoNota =
      propia !== undefined ? ancho * propia.medidas.anchoNota : ancho * ANCHO_MARCADOR_FACTOR;
    const altoNota = propia !== undefined ? ancho * propia.medidas.altoNota : ALTO_MARCADOR;
    const anchoCuerpo =
      propia !== undefined ? ancho * propia.medidas.anchoCuerpo : ancho * ANCHO_CUERPO_FACTOR;
    const anchoCola =
      propia !== undefined ? ancho * propia.medidas.anchoCola : ancho * ANCHO_MARCADOR_FACTOR;
    const altoColaPropia = propia !== undefined ? ancho * propia.medidas.altoCola : 0;
    const yReceptorActual = receptorY(geo);
    for (let columna = 0; columna < COLUMN_COUNT; columna++) {
      const notas = notasPorColumna[columna]!;
      // En sitio (T-039): el objeto de la columna se reescribe, no se crea uno por frame.
      const ventana = ventanasPorColumna[columna]!;
      avanzarVentanaEnSitio(notas, ventana, time, options.scrollDuration);
      const { inicio, fin } = ventana;

      const poolMarcador = poolMarcadores[columna]!;
      const poolCuerpo = poolCuerpos[columna]!;
      const texturas = texturasPorColumna[columna]!;
      const color = colorNota[columna]!;
      poolMarcador.reiniciar();
      poolCuerpo.reiniciar();

      for (let i = inicio; i < fin; i++) {
        const nota = notas[i]!;

        if (isHold(nota)) {
          // Se usan las funciones de progreso sueltas (position.ts) y no
          // `calcularPosicionNota`: esa devuelve un objeto por nota.
          const progresoCabeza = calcularProgreso(nota.time, time, options.scrollDuration);
          const progresoCola = calcularProgreso(nota.endTime, time, options.scrollDuration);
          const cabezaY = progresoAY(progresoCabeza, geo);
          const colaY = progresoAY(progresoCola, geo);
          const cabezaVisible = progresoEsVisible(progresoCabeza);
          const colaVisible = progresoEsVisible(progresoCola);
          const yCabezaClipeada = Math.min(cabezaY, yReceptorActual);

          // T-060: el cuerpo se dibuja si el tramo entero toca la pista, no solo
          // si la cabeza o la cola caen adentro (una LN larga mantenida tiene
          // los dos extremos afuera).
          if (tramoVisible(progresoCabeza, progresoCola)) {
            const cuerpo = poolCuerpo.obtener();
            cuerpo.x = columnaX(columna);
            cuerpo.y = colaY;
            cuerpo.width = anchoCuerpo;
            cuerpo.height = Math.max(0, yCabezaClipeada - colaY);
            cuerpo.alpha = alphaCuerpo[columna]!;
            aplicarTextura(cuerpo, texturas.cuerpoLn, Texture.WHITE, color);
          }

          // La cabeza deja de dibujarse como marcador aparte una vez que ya
          // paso el receptor: a partir de ahi el cuerpo recortado hace de
          // cabeza visual (ver T-004, "Las LN se dibujan... con el cuerpo
          // recortado al receptor mientras se sostiene"). La cabeza usa la
          // misma imagen que una nota suelta (`texturas.nota`): en
          // osu!mania no hay una imagen aparte para la cabeza de una LN.
          if (cabezaVisible && cabezaY <= yReceptorActual) {
            const marcador = poolMarcador.obtener();
            marcador.x = columnaX(columna);
            marcador.y = cabezaY + desplNota[columna]!;
            marcador.width = anchoNota;
            marcador.height = altoNota;
            aplicarTextura(marcador, texturas.nota, texturaNota, color);
          }
          if (colaVisible) {
            const marcadorCola = poolMarcador.obtener();
            marcadorCola.x = columnaX(columna);
            marcadorCola.y = colaY + desplCola[columna]!;
            marcadorCola.width = anchoCola;
            marcadorCola.height = propia !== undefined ? altoColaPropia : altoCola[columna]!;
            aplicarTextura(marcadorCola, texturas.colaLn, texturaNota, color);
          }
        } else {
          const progreso = calcularProgreso(nota.time, time, options.scrollDuration);
          if (progresoEsVisible(progreso)) {
            const marcador = poolMarcador.obtener();
            marcador.x = columnaX(columna);
            marcador.y = progresoAY(progreso, geo) + desplNota[columna]!;
            marcador.width = anchoNota;
            marcador.height = altoNota;
            aplicarTextura(marcador, texturas.nota, texturaNota, color);
          }
        }
      }

      poolMarcador.ocultarSobrantes();
      poolCuerpo.ocultarSobrantes();
    }
  }

  function showJudgement(column: Column, judgement: Judgement): void {
    // El texto de juicio es uno solo y va centrado en la pista.
    juicioNuevo = INDICE_JUICIO[judgement];
    juicioPendiente = true;
    // El destello del receptor es por columna y con el color del juicio; un
    // miss no destella (no hubo golpe que celebrar).
    if (judgement !== 'miss') {
      destelloPendiente[column] = true;
      colorDestelloPendiente[column] = COLOR_JUICIO[judgement];
    }
  }

  function setPressed(column: Column, pressed: boolean): void {
    const receptor = receptores[column]!;
    const texturas = texturasPorColumna[column]!;
    const texturaActiva = pressed ? texturas.receptorPulsado : texturas.receptor;
    const colorFallback = pressed ? colorNota[column]! : COLOR_RECEPTOR_APAGADO;
    aplicarTextura(receptor, texturaActiva, Texture.WHITE, colorFallback);

    if (pressed) {
      pulsadas[column] = true;
      soltadaPendiente[column] = false;
    } else if (pulsadas[column]) {
      // El tiempo de soltado lo toma el proximo render(time).
      pulsadas[column] = false;
      soltadaPendiente[column] = true;
    }
  }

  function resize(width: number, height: number): void {
    alturaActual = height;
    posicionarElementos();
    void width; // el ancho lo administra quien llama (layout de columnas fijo por columnWidth)
  }

  function destroy(): void {
    for (const pool of poolMarcadores) pool.destruir();
    for (const pool of poolCuerpos) pool.destruir();
    for (const receptor of receptores) receptor.destroy();
    for (const haz of hacesFlash) haz.destroy();
    for (const destello of destellos) destello.destroy();
    for (const linea of lineasCarril) linea.destroy();
    for (const texto of textosJuicio) texto.destroy();
    lineaJuicio.destroy();
    glowLineaJuicio.destroy();
    fondo.destroy();
    juicioVisible = -1;
    juicioPendiente = false;
    raiz.destroy({ children: true });
    // Las texturas generadas se liberan al final, cuando ningun sprite las usa.
    texturaFondo.destroy(true);
    texturaNota.destroy(true);
    texturaFlash.destroy(true);
    texturaBrillo.destroy(true);
  }

  return { render, showJudgement, setPressed, resize, destroy };
}
