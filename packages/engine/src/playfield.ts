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
//   columna. Cada pool nace precalentado (ver `Pool.precalentar`), asi que en
//   la practica `render()` no hace `new` nunca; solo si una columna llega a
//   mostrar mas notas a la vez que el precalentado, el pool crece una vez.
//
// T-020: pasada grafica con la paleta propia (docs/DISENO.md). Todo lo que
// se genera (texturas de gradiente, textos de juicio, sprites de flash) se
// crea UNA vez en createPlayfield y se libera en destroy(). Ni render() ni
// showJudgement() ni setPressed() crean objetos: el estado de efectos son
// numeros y booleanos en arrays de tamano fijo. La aritmetica de las
// animaciones vive en efectos.ts (pura, con tests).

import { Container, FillGradient, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Chart, Column, Judgement, Ms, Note } from '@tetra/core';
import { COLUMN_COUNT, isHold } from '@tetra/core';
import {
  avanzarVentana,
  calcularProgreso,
  progresoAY,
  progresoEsVisible,
  receptorY,
  ventanaVacia,
  type GeometriaPista,
  type VentanaNotas,
} from './position.js';
import { imagenDeSkin, type TexturasDeSkin } from './skin.js';
import { alphaFlash, alphaJuicio, colorDeNota, escalaJuicio } from './efectos.js';

export interface PlayfieldOptions {
  /** Cuantos ms de pista se ven de golpe. Menor valor, notas mas rapidas. */
  scrollDuration: Ms;
  /** Alto del area de juego en pixeles. */
  height: number;
  /** Ancho de cada carril en pixeles. */
  columnWidth: number;
  /** Distancia del receptor al borde inferior, en pixeles. */
  receptorOffset: number;
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

/** Cuantos sprites nacen ya creados por pool y por columna (ver Pool.precalentar). */
const PRECALENTADO_MARCADORES = 32;
const PRECALENTADO_CUERPOS = 8;

// Paleta (docs/DISENO.md, apps/web/src/tokens.css). Pixi no lee CSS, por eso
// van como constantes hex.
const COLOR_LINEA = 0x263139;
const COLOR_TINTA_3 = 0x5f6e77;
const COLOR_ACENTO = 0x3fd8c2;

const COLOR_RECEPTOR_APAGADO = COLOR_TINTA_3;
const ALPHA_LINEA_CARRIL = 0.7;
const ALPHA_LINEA_JUICIO = 0.5;

/** Alpha de los cuerpos de LN: baja en el fallback, la de siempre con skin. */
const ALPHA_CUERPO_FALLBACK = 0.42;
const ALPHA_CUERPO_SKIN = 0.55;

/** Alpha maximo del haz de flash y su tamano como fraccion de la pista. */
const ALPHA_MAX_FLASH = 0.55;
const ALTO_FLASH_FACTOR = 0.42;
const ANCHO_FLASH_FACTOR = 0.94;

/** Altura del texto de juicio, como fraccion de `receptorY`. */
const POSICION_JUICIO_FACTOR = 0.58;

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

export function createPlayfield(
  app: Application,
  chart: Chart,
  options: PlayfieldOptions,
  skin?: TexturasDeSkin,
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
  const capaMarcadores = new Container();
  const capaJuicios = new Container();
  raiz.addChild(capaFondo, capaFlash, capaCuerpos, capaReceptores, capaMarcadores, capaJuicios);

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

  // Haz del flash: blanco, transparente arriba y opaco abajo (en el
  // receptor); se tinta con el color de cada columna.
  const texturaFlash = generarTextura(app, 16, 128, (g) => {
    const gradiente = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 'rgba(255, 255, 255, 0)' },
        { offset: 1, color: 'rgba(255, 255, 255, 1)' },
      ],
    });
    g.rect(0, 0, 16, 128).fill(gradiente);
  });

  // -------------------------------------------------------------------------
  // Fondo, lineas de carril y linea de juicio
  // -------------------------------------------------------------------------

  const fondo = new Sprite(texturaFondo);
  capaFondo.addChild(fondo);

  const lineasCarril: Sprite[] = [];
  for (let i = 0; i <= COLUMN_COUNT; i++) {
    const linea = new Sprite(Texture.WHITE);
    linea.tint = COLOR_LINEA;
    linea.alpha = ALPHA_LINEA_CARRIL;
    linea.width = 1;
    capaFondo.addChild(linea);
    lineasCarril.push(linea);
  }

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

  // Por columna, lo que depende de si esa imagen viene de la skin o es el
  // fallback propio (se resuelve una vez aca): color y desplazamientos
  // verticales. En el fallback la nota y la cola se dibujan con su borde
  // inferior sobre la linea de tiempo; la skin se dibuja centrada, como hoy.
  const colorNota: number[] = [];
  const desplNota: number[] = [];
  const desplCola: number[] = [];
  const altoCola: number[] = [];
  const alphaCuerpo: number[] = [];

  // Estado de efectos por columna: numeros y booleanos de tamano fijo, sin
  // objetos nuevos por evento. `setPressed(false)` no trae tiempo, asi que
  // solo marca `soltadaPendiente` y render() toma el tiempo del frame.
  const pulsadas: boolean[] = [];
  const soltadaPendiente: boolean[] = [];
  const tiempoSoltada: Ms[] = [];

  for (let columna = 0; columna < COLUMN_COUNT; columna++) {
    const texturas = texturasPorColumna[columna]!;
    const color = colorDeNota(columna);
    colorNota.push(color);
    desplNota.push(texturas.nota === undefined ? -ALTO_MARCADOR / 2 : 0);
    desplCola.push(texturas.colaLn === undefined ? -ALTO_COLA_FALLBACK / 2 : 0);
    altoCola.push(texturas.colaLn === undefined ? ALTO_COLA_FALLBACK : ALTO_MARCADOR);
    alphaCuerpo.push(texturas.cuerpoLn === undefined ? ALPHA_CUERPO_FALLBACK : ALPHA_CUERPO_SKIN);

    pulsadas.push(false);
    soltadaPendiente.push(false);
    tiempoSoltada.push(Number.NEGATIVE_INFINITY);

    const poolMarcador = new Pool(capaMarcadores, () => {
      const sprite = new Sprite(Texture.WHITE);
      sprite.anchor.set(0.5, 0.5);
      return sprite;
    });
    poolMarcador.precalentar(PRECALENTADO_MARCADORES);
    poolMarcadores.push(poolMarcador);

    const poolCuerpo = new Pool(capaCuerpos, () => {
      const sprite = new Sprite(Texture.WHITE);
      sprite.alpha = ALPHA_CUERPO_SKIN;
      sprite.anchor.set(0.5, 0);
      return sprite;
    });
    poolCuerpo.precalentar(PRECALENTADO_CUERPOS);
    poolCuerpos.push(poolCuerpo);

    const receptor = new Sprite(Texture.WHITE);
    // Con imagen de skin el receptor se centra en la linea (como hoy); el
    // fallback es una barra baja que cuelga justo debajo de la linea de juicio.
    receptor.anchor.set(0.5, texturas.receptor === undefined ? 0 : 0.5);
    receptor.height = ALTO_RECEPTOR;
    aplicarTextura(receptor, texturas.receptor, Texture.WHITE, COLOR_RECEPTOR_APAGADO);
    capaReceptores.addChild(receptor);
    receptores.push(receptor);

    const haz = new Sprite(texturaFlash);
    haz.anchor.set(0.5, 1);
    haz.tint = color;
    haz.alpha = 0;
    haz.visible = false;
    capaFlash.addChild(haz);
    hacesFlash.push(haz);
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

  // Un solo objeto de geometria, reutilizado: se actualiza en cada llamada
  // en vez de crear uno nuevo (geometria() corre dentro de render()).
  const geo: GeometriaPista = { height: alturaActual, receptorOffset: options.receptorOffset };
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

    for (let columna = 0; columna < COLUMN_COUNT; columna++) {
      const receptor = receptores[columna]!;
      receptor.x = columnaX(columna);
      receptor.y = y;
      receptor.width = options.columnWidth * ANCHO_MARCADOR_FACTOR;

      const haz = hacesFlash[columna]!;
      haz.x = columnaX(columna);
      haz.y = y;
      haz.width = options.columnWidth * ANCHO_FLASH_FACTOR;
      haz.height = y * ALTO_FLASH_FACTOR;
    }

    for (const texto of textosJuicio) {
      texto.x = anchoPista / 2;
      texto.y = y * POSICION_JUICIO_FACTOR;
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
    }

    geometria();
    const yReceptorActual = receptorY(geo);
    for (let columna = 0; columna < COLUMN_COUNT; columna++) {
      const notas = notasPorColumna[columna]!;
      ventanasPorColumna[columna] = avanzarVentana(
        notas,
        ventanasPorColumna[columna]!,
        time,
        options.scrollDuration,
      );
      const { inicio, fin } = ventanasPorColumna[columna]!;

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

          if (colaVisible || cabezaVisible) {
            const cuerpo = poolCuerpo.obtener();
            cuerpo.x = columnaX(columna);
            cuerpo.y = colaY;
            cuerpo.width = options.columnWidth * ANCHO_CUERPO_FACTOR;
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
            marcador.width = options.columnWidth * ANCHO_MARCADOR_FACTOR;
            marcador.height = ALTO_MARCADOR;
            aplicarTextura(marcador, texturas.nota, texturaNota, color);
          }
          if (colaVisible) {
            const marcadorCola = poolMarcador.obtener();
            marcadorCola.x = columnaX(columna);
            marcadorCola.y = colaY + desplCola[columna]!;
            marcadorCola.width = options.columnWidth * ANCHO_MARCADOR_FACTOR;
            marcadorCola.height = altoCola[columna]!;
            aplicarTextura(marcadorCola, texturas.colaLn, texturaNota, color);
          }
        } else {
          const progreso = calcularProgreso(nota.time, time, options.scrollDuration);
          if (progresoEsVisible(progreso)) {
            const marcador = poolMarcador.obtener();
            marcador.x = columnaX(columna);
            marcador.y = progresoAY(progreso, geo) + desplNota[columna]!;
            marcador.width = options.columnWidth * ANCHO_MARCADOR_FACTOR;
            marcador.height = ALTO_MARCADOR;
            aplicarTextura(marcador, texturas.nota, texturaNota, color);
          }
        }
      }

      poolMarcador.ocultarSobrantes();
      poolCuerpo.ocultarSobrantes();
    }
  }

  function showJudgement(column: Column, judgement: Judgement): void {
    // El juicio es uno solo y va centrado en la pista: la columna no se usa.
    void column;
    juicioNuevo = INDICE_JUICIO[judgement];
    juicioPendiente = true;
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
    for (const linea of lineasCarril) linea.destroy();
    for (const texto of textosJuicio) texto.destroy();
    lineaJuicio.destroy();
    fondo.destroy();
    juicioVisible = -1;
    juicioPendiente = false;
    raiz.destroy({ children: true });
    // Las texturas generadas se liberan al final, cuando ningun sprite las usa.
    texturaFondo.destroy(true);
    texturaNota.destroy(true);
    texturaFlash.destroy(true);
  }

  return { render, showJudgement, setPressed, resize, destroy };
}
