// T-050: skins propias de Tetra.
//
// Una skin propia es "una skin mas": se dibuja con Canvas 2D y se convierte a
// `TexturasDeSkin` por el mismo camino que un `.osk` (ver skin.ts), asi que
// playfield.ts no necesita una rama por skin. La misma funcion de dibujo
// sirve para las miniaturas de ajustes (`dibujarMiniaturaDeSkin`).
//
// El dibujo se hace a 2x (ver lienzo.ts) y Pixi lo reduce: bordes nitidos sin
// escalar pixeles. Los colores salen de la paleta de docs/DISENO.md; la
// matematica de color y de geometria vive en funciones puras (sin Canvas) para
// poder probarlas en vitest, que corre en node sin canvas.
//
// Convencion de columnas: exteriores (0 y 3) usan el grupo note1/key1 e
// interiores (1 y 2) note2/key2, la misma de osu!mania 4K (ver
// `imagenDeSkin` en skin.ts).

import { Texture } from 'pixi.js';
import { crearLienzo } from './lienzo.js';
import type { ClaveImagenSkin, TexturasDeSkin } from './skin.js';

export type IdSkinPropia = 'tetra' | 'barras' | 'circulos' | 'diamantes';

export interface SkinPropia {
  id: IdSkinPropia;
  /** Nombre corto para la UI: "Tetra", "Barras", "Circulos", "Diamantes". */
  nombre: string;
}

export const SKINS_PROPIAS: readonly SkinPropia[] = [
  { id: 'tetra', nombre: 'Tetra' },
  { id: 'barras', nombre: 'Barras' },
  { id: 'circulos', nombre: 'Círculos' },
  { id: 'diamantes', nombre: 'Diamantes' },
];

export const SKIN_PROPIA_POR_DEFECTO: IdSkinPropia = 'tetra';

// ---------------------------------------------------------------------------
// Paleta (docs/DISENO.md). Pixi y Canvas no leen CSS, van como constantes.
// ---------------------------------------------------------------------------

const FONDO = 0x0b0e11;
const SUPERFICIE = 0x131a1f;
const SUPERFICIE_2 = 0x1c252b;
const LINEA = 0x263139;
const TINTA = 0xe7eef0;
const TINTA_2 = 0x9daab2;
const TINTA_3 = 0x5f6e77;
const ACENTO = 0x3fd8c2;
const AMBAR = 0xe8b84a;
const AZUL = 0x4f93d8;
const VIOLETA = 0x9a78d8;
const BLANCO = 0xffffff;
/** Blanco con sesgo frio, para las notas "blancas" de Barras (no blanco de fabrica). */
const BLANCO_FRIO = 0xf1f5f6;

export interface ColoresDeSkin {
  /** Columnas 0 y 3. */
  exterior: number;
  /** Columnas 1 y 2. */
  interior: number;
}

/** Colores de nota de cada skin, exterior/interior. Salen todos de la paleta. */
export const COLORES_SKIN_PROPIA: Readonly<Record<IdSkinPropia, ColoresDeSkin>> = {
  tetra: { exterior: TINTA, interior: ACENTO },
  barras: { exterior: BLANCO_FRIO, interior: AMBAR },
  circulos: { exterior: ACENTO, interior: AMBAR },
  diamantes: { exterior: AZUL, interior: VIOLETA },
};

// ---------------------------------------------------------------------------
// Aritmetica pura: color y geometria
// ---------------------------------------------------------------------------

/**
 * Mezcla dos colores `0xRRGGBB` canal por canal: `t = 0` da `a`, `t = 1` da
 * `b`. `t` se recorta a `[0, 1]`.
 */
export function mezclarColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const canal = (desplazamiento: number): number => {
    const ca = (a >> desplazamiento) & 0xff;
    const cb = (b >> desplazamiento) & 0xff;
    return Math.round(ca + (cb - ca) * k);
  };
  return (canal(16) << 16) | (canal(8) << 8) | canal(0);
}

/** Un color `0xRRGGBB` como `rgba(r, g, b, alpha)` de CSS. */
export function colorCss(color: number, alpha = 1): string {
  return `rgba(${(color >> 16) & 0xff}, ${(color >> 8) & 0xff}, ${color & 0xff}, ${alpha})`;
}

const aclarar = (color: number, t: number): number => mezclarColor(color, BLANCO, t);
const oscurecer = (color: number, t: number): number => mezclarColor(color, FONDO, t);
/** Color del contorno de un receptor sin pulsar: neutro, con un toque del color de la columna. */
const colorReposo = (color: number): number =>
  mezclarColor(mezclarColor(TINTA_3, TINTA_2, 0.55), color, 0.22);

/** Diametro de las notas de Circulos como fraccion del ancho del carril. */
export const DIAMETRO_CIRCULO_FACTOR = 0.7;

/** Diametro (px) de una nota redonda en un carril de `anchoColumna` px. */
export function diametroCirculo(anchoColumna: number): number {
  return anchoColumna * DIAMETRO_CIRCULO_FACTOR;
}

/**
 * Los cuatro vertices de un rombo centrado en (`cx`, `cy`), como
 * `[x0, y0, x1, y1, x2, y2, x3, y3]` en este orden: arriba, derecha, abajo,
 * izquierda. `ancho` y `alto` son las diagonales completas.
 */
export function puntosRombo(cx: number, cy: number, ancho: number, alto: number): number[] {
  const mx = ancho / 2;
  const my = alto / 2;
  return [cx, cy - my, cx + mx, cy, cx, cy + my, cx - mx, cy];
}

/** Tamano en px de un lienzo para una pieza que mide `fraccion` del ancho de carril. Nunca baja de 1. */
export function tamanoLienzo(fraccion: number, anchoColumna: number): number {
  return Math.max(1, Math.ceil(fraccion * anchoColumna));
}

/**
 * Tamano de cada pieza de una skin propia, como fraccion del ancho del
 * carril (el alto tambien: asi no se deforma si cambia el ancho). Es la
 * medida del lienzo completo, margen de antialias incluido: playfield.ts
 * dibuja el sprite a este tamano, sin estirar. Las piezas de las skins de
 * `.osk` NO pasan por aca: se siguen estirando como siempre.
 */
export interface MedidasDeSkinPropia {
  anchoNota: number;
  altoNota: number;
  /** Ancho del cuerpo de LN; el alto lo pone la LN (se estira en vertical). */
  anchoCuerpo: number;
  anchoCola: number;
  altoCola: number;
  anchoReceptor: number;
  altoReceptor: number;
}

export const MEDIDAS_SKIN_PROPIA: Readonly<Record<IdSkinPropia, MedidasDeSkinPropia>> = {
  tetra: {
    anchoNota: 0.82,
    altoNota: 0.24,
    anchoCuerpo: 0.5,
    anchoCola: 0.62,
    altoCola: 0.18,
    anchoReceptor: 0.86,
    altoReceptor: 0.2,
  },
  barras: {
    anchoNota: 0.98,
    altoNota: 0.22,
    anchoCuerpo: 0.86,
    anchoCola: 0.98,
    altoCola: 0.12,
    anchoReceptor: 0.98,
    altoReceptor: 0.36,
  },
  circulos: {
    anchoNota: 0.76,
    altoNota: 0.76,
    anchoCuerpo: 0.34,
    anchoCola: 0.46,
    altoCola: 0.46,
    anchoReceptor: 0.8,
    altoReceptor: 0.8,
  },
  diamantes: {
    anchoNota: 0.8,
    altoNota: 0.58,
    anchoCuerpo: 0.26,
    anchoCola: 0.46,
    altoCola: 0.34,
    anchoReceptor: 0.84,
    altoReceptor: 0.62,
  },
};

/** Alto logico del lienzo del cuerpo de LN: es uniforme en vertical, asi que alcanza con poco. */
const ALTO_LIENZO_CUERPO = 4;

// ---------------------------------------------------------------------------
// Dibujo con Canvas 2D
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

/** Funcion de dibujo de una pieza: `w` x `h` son px logicos del lienzo, `cw` el ancho del carril. */
type DibujarPieza = (ctx: Ctx, w: number, h: number, color: number, cw: number) => void;

interface Dibujante {
  nota: DibujarPieza;
  cuerpo: DibujarPieza;
  cola: DibujarPieza;
  receptor: DibujarPieza;
  receptorPulsado: DibujarPieza;
}

function trazarRectRedondeado(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radio = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radio, y);
  ctx.arcTo(x + w, y, x + w, y + h, radio);
  ctx.arcTo(x + w, y + h, x, y + h, radio);
  ctx.arcTo(x, y + h, x, y, radio);
  ctx.arcTo(x, y, x + w, y, radio);
  ctx.closePath();
}

function trazarRombo(ctx: Ctx, cx: number, cy: number, ancho: number, alto: number): void {
  const p = puntosRombo(cx, cy, ancho, alto);
  ctx.beginPath();
  ctx.moveTo(p[0]!, p[1]!);
  ctx.lineTo(p[2]!, p[3]!);
  ctx.lineTo(p[4]!, p[5]!);
  ctx.lineTo(p[6]!, p[7]!);
  ctx.closePath();
}

function degradadoVertical(
  ctx: Ctx,
  y0: number,
  y1: number,
  arriba: string,
  abajo: string,
): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, arriba);
  g.addColorStop(1, abajo);
  return g;
}

/** Cuerpo de LN translucido, uniforme en vertical, con un filo mas claro a cada lado. */
function dibujarCuerpoTranslucido(ctx: Ctx, w: number, h: number, color: number): void {
  ctx.fillStyle = colorCss(color, 0.34);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = colorCss(aclarar(color, 0.3), 0.7);
  ctx.fillRect(0, 0, 1.2, h);
  ctx.fillRect(w - 1.2, 0, 1.2, h);
}

// --- Tetra -----------------------------------------------------------------

const tetra: Dibujante = {
  nota(ctx, w, h, color) {
    const x = 1;
    const y = 1;
    const ancho = w - 2;
    const alto = h - 2;
    trazarRectRedondeado(ctx, x, y, ancho, alto, 3);
    ctx.fillStyle = degradadoVertical(
      ctx,
      y,
      y + alto,
      colorCss(aclarar(color, 0.1)),
      colorCss(oscurecer(color, 0.22)),
    );
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Base algo mas oscura (el borde de abajo es el momento del golpe) y filo claro arriba.
    ctx.fillStyle = colorCss(FONDO, 0.28);
    ctx.fillRect(x, y + alto - 2, ancho, 2);
    ctx.fillStyle = colorCss(BLANCO, 0.55);
    ctx.fillRect(x, y, ancho, 1.5);
    ctx.restore();
    trazarRectRedondeado(ctx, x + 0.5, y + 0.5, ancho - 1, alto - 1, 2.5);
    ctx.strokeStyle = colorCss(BLANCO, 0.16);
    ctx.lineWidth = 1;
    ctx.stroke();
  },
  cuerpo(ctx, w, h, color) {
    dibujarCuerpoTranslucido(ctx, w, h, color);
  },
  cola(ctx, w, h, color) {
    // Cola redondeada: una pastilla del mismo color, mas angosta que la cabeza.
    const x = 1;
    const y = 1;
    const ancho = w - 2;
    const alto = h - 2;
    trazarRectRedondeado(ctx, x, y, ancho, alto, alto / 2);
    ctx.fillStyle = degradadoVertical(
      ctx,
      y,
      y + alto,
      colorCss(aclarar(color, 0.12)),
      colorCss(oscurecer(color, 0.2)),
    );
    ctx.fill();
    ctx.strokeStyle = colorCss(BLANCO, 0.2);
    ctx.lineWidth = 1;
    trazarRectRedondeado(ctx, x + 0.5, y + 0.5, ancho - 1, alto - 1, (alto - 1) / 2);
    ctx.stroke();
  },
  receptor(ctx, w, h, color) {
    trazarRectRedondeado(ctx, 1, 1, w - 2, h - 2, 3);
    ctx.fillStyle = colorCss(TINTA, 0.06);
    ctx.fill();
    ctx.strokeStyle = colorCss(colorReposo(color), 0.95);
    ctx.lineWidth = 1.5;
    trazarRectRedondeado(ctx, 1.75, 1.75, w - 3.5, h - 3.5, 2.5);
    ctx.stroke();
  },
  receptorPulsado(ctx, w, h, color) {
    trazarRectRedondeado(ctx, 1, 1, w - 2, h - 2, 3);
    ctx.fillStyle = degradadoVertical(
      ctx,
      1,
      h - 1,
      colorCss(aclarar(color, 0.18)),
      colorCss(color),
    );
    ctx.fill();
    ctx.strokeStyle = colorCss(aclarar(color, 0.5), 0.9);
    ctx.lineWidth = 1.5;
    trazarRectRedondeado(ctx, 1.75, 1.75, w - 3.5, h - 3.5, 2.5);
    ctx.stroke();
  },
};

// --- Barras ----------------------------------------------------------------

const barras: Dibujante = {
  nota(ctx, w, h, color) {
    const x = 0.5;
    const y = 0.5;
    const ancho = w - 1;
    const alto = h - 1;
    trazarRectRedondeado(ctx, x, y, ancho, alto, 1.5);
    ctx.fillStyle = degradadoVertical(
      ctx,
      y,
      y + alto,
      colorCss(aclarar(color, 0.06)),
      colorCss(color),
    );
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = colorCss(oscurecer(color, 0.3));
    ctx.fillRect(x, y + alto - 2.5, ancho, 2.5);
    ctx.fillStyle = colorCss(BLANCO, 0.35);
    ctx.fillRect(x, y, ancho, 1);
    ctx.restore();
  },
  cuerpo(ctx, w, h, color) {
    // Clasico y plano: un bloque translucido a casi todo el ancho, sin filos.
    ctx.fillStyle = colorCss(color, 0.3);
    ctx.fillRect(0, 0, w, h);
  },
  cola(ctx, w, h, color) {
    trazarRectRedondeado(ctx, 0.5, 0.5, w - 1, h - 1, 1);
    ctx.fillStyle = colorCss(oscurecer(color, 0.14));
    ctx.fill();
  },
  receptor(ctx, w, h, color) {
    // Una tecla: losa oscura con bisel arriba y un canto de color abajo.
    trazarRectRedondeado(ctx, 0.5, 0.5, w - 1, h - 1, 2);
    ctx.fillStyle = degradadoVertical(
      ctx,
      0,
      h,
      colorCss(SUPERFICIE_2, 0.95),
      colorCss(SUPERFICIE, 0.95),
    );
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = colorCss(mezclarColor(LINEA, TINTA_3, 0.5));
    ctx.fillRect(0, 0, w, 1.5);
    ctx.fillStyle = colorCss(colorReposo(color), 0.9);
    ctx.fillRect(0, h - 3, w, 3);
    ctx.restore();
    trazarRectRedondeado(ctx, 0.75, 0.75, w - 1.5, h - 1.5, 1.75);
    ctx.strokeStyle = colorCss(LINEA);
    ctx.lineWidth = 1;
    ctx.stroke();
  },
  receptorPulsado(ctx, w, h, color) {
    trazarRectRedondeado(ctx, 0.5, 0.5, w - 1, h - 1, 2);
    ctx.fillStyle = degradadoVertical(
      ctx,
      0,
      h,
      colorCss(aclarar(color, 0.12), 0.92),
      colorCss(oscurecer(color, 0.25), 0.92),
    );
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = colorCss(BLANCO, 0.4);
    ctx.fillRect(0, 0, w, 1.5);
    ctx.fillStyle = colorCss(aclarar(color, 0.45));
    ctx.fillRect(0, h - 3, w, 3);
    ctx.restore();
  },
};

// --- Circulos --------------------------------------------------------------

/** Esfera con brillo interno: gradiente radial desplazado hacia arriba a la izquierda y un reflejo. */
function dibujarEsfera(
  ctx: Ctx,
  cx: number,
  cy: number,
  radio: number,
  color: number,
  conReflejo: boolean,
): void {
  const g = ctx.createRadialGradient(
    cx - radio * 0.25,
    cy - radio * 0.3,
    radio * 0.08,
    cx,
    cy,
    radio,
  );
  g.addColorStop(0, colorCss(aclarar(color, 0.45)));
  g.addColorStop(0.55, colorCss(color));
  g.addColorStop(1, colorCss(oscurecer(color, 0.22)));
  ctx.beginPath();
  ctx.arc(cx, cy, radio, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, radio - 0.6, 0, Math.PI * 2);
  ctx.strokeStyle = colorCss(aclarar(color, 0.4), 0.5);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  if (conReflejo) {
    const reflejo = degradadoVertical(
      ctx,
      cy - radio * 0.68,
      cy - radio * 0.1,
      colorCss(BLANCO, 0.4),
      colorCss(BLANCO, 0),
    );
    ctx.beginPath();
    ctx.ellipse(cx, cy - radio * 0.38, radio * 0.55, radio * 0.28, 0, 0, Math.PI * 2);
    ctx.fillStyle = reflejo;
    ctx.fill();
  }
}

const circulos: Dibujante = {
  nota(ctx, w, h, color, cw) {
    dibujarEsfera(ctx, w / 2, h / 2, diametroCirculo(cw) / 2, color, true);
  },
  cuerpo(ctx, w, h, color) {
    dibujarCuerpoTranslucido(ctx, w, h, color);
  },
  cola(ctx, w, h, color) {
    dibujarEsfera(ctx, w / 2, h / 2, Math.min(w, h) / 2 - 1.5, color, false);
  },
  receptor(ctx, w, h, color) {
    const radio = Math.min(w, h) / 2 - 2.5;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, radio, 0, Math.PI * 2);
    ctx.fillStyle = colorCss(TINTA, 0.05);
    ctx.fill();
    ctx.strokeStyle = colorCss(colorReposo(color), 0.95);
    ctx.lineWidth = 2.5;
    ctx.stroke();
  },
  receptorPulsado(ctx, w, h, color) {
    const radio = Math.min(w, h) / 2 - 2.5;
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, radio);
    g.addColorStop(0, colorCss(aclarar(color, 0.2), 0.95));
    g.addColorStop(1, colorCss(color, 0.7));
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, radio, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = colorCss(aclarar(color, 0.45), 0.95);
    ctx.lineWidth = 2.5;
    ctx.stroke();
  },
};

// --- Diamantes -------------------------------------------------------------

/**
 * Gema: un rombo partido por la diagonal horizontal en dos facetas, la de
 * arriba mas clara y la de abajo mas oscura. Vertices afilados (union en
 * punta, sin redondear).
 */
function dibujarGema(ctx: Ctx, w: number, h: number, color: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const p = puntosRombo(cx, cy, w - 3, h - 3);
  ctx.lineJoin = 'miter';

  // Faceta superior: izquierda, arriba, derecha.
  ctx.beginPath();
  ctx.moveTo(p[6]!, p[7]!);
  ctx.lineTo(p[0]!, p[1]!);
  ctx.lineTo(p[2]!, p[3]!);
  ctx.closePath();
  ctx.fillStyle = degradadoVertical(
    ctx,
    p[1]!,
    p[3]!,
    colorCss(aclarar(color, 0.38)),
    colorCss(aclarar(color, 0.06)),
  );
  ctx.fill();

  // Faceta inferior: izquierda, derecha, abajo.
  ctx.beginPath();
  ctx.moveTo(p[6]!, p[7]!);
  ctx.lineTo(p[2]!, p[3]!);
  ctx.lineTo(p[4]!, p[5]!);
  ctx.closePath();
  ctx.fillStyle = degradadoVertical(
    ctx,
    p[3]!,
    p[5]!,
    colorCss(color),
    colorCss(oscurecer(color, 0.28)),
  );
  ctx.fill();

  // Contorno fino y arista central.
  trazarRombo(ctx, cx, cy, w - 3, h - 3);
  ctx.strokeStyle = colorCss(aclarar(color, 0.5), 0.65);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p[6]!, p[7]!);
  ctx.lineTo(p[2]!, p[3]!);
  ctx.strokeStyle = colorCss(BLANCO, 0.22);
  ctx.stroke();
}

const diamantes: Dibujante = {
  nota(ctx, w, h, color) {
    dibujarGema(ctx, w, h, color);
  },
  cuerpo(ctx, w, h, color) {
    dibujarCuerpoTranslucido(ctx, w, h, color);
  },
  cola(ctx, w, h, color) {
    dibujarGema(ctx, w, h, color);
  },
  receptor(ctx, w, h, color) {
    // Rombo vacio: solo el contorno, con un trazo interior mas tenue.
    ctx.lineJoin = 'miter';
    trazarRombo(ctx, w / 2, h / 2, w - 3, h - 3);
    ctx.fillStyle = colorCss(TINTA, 0.04);
    ctx.fill();
    ctx.strokeStyle = colorCss(colorReposo(color), 0.95);
    ctx.lineWidth = 2;
    ctx.stroke();
  },
  receptorPulsado(ctx, w, h, color) {
    ctx.lineJoin = 'miter';
    dibujarGema(ctx, w, h, color);
    trazarRombo(ctx, w / 2, h / 2, w * 0.5, h * 0.5);
    ctx.strokeStyle = colorCss(BLANCO, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
  },
};

const DIBUJANTES: Readonly<Record<IdSkinPropia, Dibujante>> = {
  tetra,
  barras,
  circulos,
  diamantes,
};

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

/** Que pieza (y con que color) va en cada una de las 10 claves de imagen. */
interface Ranura {
  clave: ClaveImagenSkin;
  pieza: keyof Dibujante;
  grupo: 'exterior' | 'interior';
}

const RANURAS: readonly Ranura[] = [
  { clave: 'note1', pieza: 'nota', grupo: 'exterior' },
  { clave: 'note2', pieza: 'nota', grupo: 'interior' },
  { clave: 'note1H', pieza: 'cuerpo', grupo: 'exterior' },
  { clave: 'note2H', pieza: 'cuerpo', grupo: 'interior' },
  { clave: 'note1L', pieza: 'cola', grupo: 'exterior' },
  { clave: 'note2L', pieza: 'cola', grupo: 'interior' },
  { clave: 'key1', pieza: 'receptor', grupo: 'exterior' },
  { clave: 'key2', pieza: 'receptor', grupo: 'interior' },
  { clave: 'key1D', pieza: 'receptorPulsado', grupo: 'exterior' },
  { clave: 'key2D', pieza: 'receptorPulsado', grupo: 'interior' },
];

/** Medidas (fraccion del carril) del lienzo de una pieza concreta. */
function medidaDePieza(
  medidas: MedidasDeSkinPropia,
  pieza: keyof Dibujante,
): { ancho: number; alto: number } {
  switch (pieza) {
    case 'nota':
      return { ancho: medidas.anchoNota, alto: medidas.altoNota };
    case 'cuerpo':
      // El alto es fijo en px logicos (no depende del carril): se resuelve afuera.
      return { ancho: medidas.anchoCuerpo, alto: 0 };
    case 'cola':
      return { ancho: medidas.anchoCola, alto: medidas.altoCola };
    case 'receptor':
    case 'receptorPulsado':
      return { ancho: medidas.anchoReceptor, alto: medidas.altoReceptor };
  }
}

/**
 * Dibuja las 10 imagenes (ClaveImagenSkin) de la skin para un carril de
 * `anchoColumna` px, a 2x para que se vean nitidas. Pura respecto del estado:
 * misma entrada, mismo dibujo. Cada llamada crea canvases nuevos; no se usa
 * en el camino caliente.
 */
export function dibujarSkinPropia(
  id: IdSkinPropia,
  anchoColumna: number,
): Record<ClaveImagenSkin, HTMLCanvasElement> {
  const dibujante = DIBUJANTES[id];
  const medidas = MEDIDAS_SKIN_PROPIA[id];
  const colores = COLORES_SKIN_PROPIA[id];
  const resultado = {} as Record<ClaveImagenSkin, HTMLCanvasElement>;

  for (const ranura of RANURAS) {
    const medida = medidaDePieza(medidas, ranura.pieza);
    const ancho = tamanoLienzo(medida.ancho, anchoColumna);
    const alto =
      ranura.pieza === 'cuerpo' ? ALTO_LIENZO_CUERPO : tamanoLienzo(medida.alto, anchoColumna);
    const lienzo = crearLienzo(ancho, alto);
    dibujante[ranura.pieza](
      lienzo.ctx,
      lienzo.ancho,
      lienzo.alto,
      colores[ranura.grupo],
      anchoColumna,
    );
    resultado[ranura.clave] = lienzo.canvas;
  }
  return resultado;
}

/** Lo que playfield.ts necesita saber de una skin propia ademas de las texturas. */
export interface InfoDeSkinPropia {
  id: IdSkinPropia;
  medidas: MedidasDeSkinPropia;
  colores: ColoresDeSkin;
}

// Las `TexturasDeSkin` de una skin propia se registran aca (clave: el objeto
// devuelto). Asi playfield.ts distingue una skin propia de un `.osk` sin
// cambiar el tipo `TexturasDeSkin` ni la firma de createPlayfield. WeakMap:
// no retiene la skin si nadie mas la usa.
const INFO_POR_TEXTURAS = new WeakMap<TexturasDeSkin, InfoDeSkinPropia>();

/**
 * Si `skin` salio de `texturasDeSkinPropia`, devuelve sus medidas y colores;
 * para un `.osk` (o `undefined`) devuelve `undefined`.
 */
export function infoDeSkinPropia(skin: TexturasDeSkin | undefined): InfoDeSkinPropia | undefined {
  return skin === undefined ? undefined : INFO_POR_TEXTURAS.get(skin);
}

/**
 * Las imagenes de `dibujarSkinPropia` convertidas a Texture de Pixi
 * (`Texture.from(canvas)`), listas para pasarle a createPlayfield como
 * `skin`. Las texturas las libera quien las pidio (`Object.values(...)`
 * y `destroy(true)`).
 */
export function texturasDeSkinPropia(id: IdSkinPropia, anchoColumna: number): TexturasDeSkin {
  const imagenes = dibujarSkinPropia(id, anchoColumna);
  const texturas: TexturasDeSkin = {};
  for (const clave of Object.keys(imagenes) as ClaveImagenSkin[]) {
    texturas[clave] = Texture.from(imagenes[clave]);
  }
  INFO_POR_TEXTURAS.set(texturas, {
    id,
    medidas: MEDIDAS_SKIN_PROPIA[id],
    colores: COLORES_SKIN_PROPIA[id],
  });
  return texturas;
}

/**
 * Miniatura estatica para elegir skin: cuatro carriles con notas sueltas, una
 * LN sostenida (con su receptor pulsado) y los receptores, sobre fondo
 * transparente. Dibuja en el rectangulo (0, 0, ancho, alto) del contexto; el
 * contenido se recorta a ese rectangulo.
 */
export function dibujarMiniaturaDeSkin(
  ctx: CanvasRenderingContext2D,
  id: IdSkinPropia,
  ancho: number,
  alto: number,
): void {
  const cw = ancho / 4;
  const medidas = MEDIDAS_SKIN_PROPIA[id];
  const imagenes = dibujarSkinPropia(id, cw);
  const yJuicio = alto * 0.8;
  const columnaPulsada = 2;

  /** Dibuja una imagen de la skin centrada en (cx, cy), a su tamano logico (el canvas es 2x). */
  const pegar = (clave: ClaveImagenSkin, cx: number, cy: number): void => {
    const img = imagenes[clave];
    const w = img.width / 2;
    const h = img.height / 2;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  };
  const exterior = (col: number): boolean => col === 0 || col === 3;
  const clave = (
    col: number,
    exteriorClave: ClaveImagenSkin,
    interiorClave: ClaveImagenSkin,
  ): ClaveImagenSkin => (exterior(col) ? exteriorClave : interiorClave);
  const cx = (col: number): number => col * cw + cw / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ancho, alto);
  ctx.clip();

  // Lineas de carril y linea de juicio.
  ctx.fillStyle = colorCss(LINEA, 0.9);
  for (let i = 0; i <= 4; i++) {
    const x = Math.min(ancho - 1, i * cw);
    ctx.fillRect(x, 0, 1, alto);
  }
  ctx.fillStyle = colorCss(ACENTO, 0.45);
  ctx.fillRect(0, yJuicio - 0.5, ancho, 1);

  // LN sostenida en la columna 2: cuerpo, cola y cabeza sobre la linea.
  const colaY = alto * 0.16;
  const cuerpo = imagenes[clave(columnaPulsada, 'note1H', 'note2H')];
  const anchoCuerpo = medidas.anchoCuerpo * cw;
  ctx.drawImage(cuerpo, cx(columnaPulsada) - anchoCuerpo / 2, colaY, anchoCuerpo, yJuicio - colaY);
  pegar(clave(columnaPulsada, 'note1L', 'note2L'), cx(columnaPulsada), colaY);

  // Receptores (el de la LN pulsado).
  for (let col = 0; col < 4; col++) {
    const pulsado = col === columnaPulsada;
    pegar(pulsado ? clave(col, 'key1D', 'key2D') : clave(col, 'key1', 'key2'), cx(col), yJuicio);
  }

  // Notas: dos sueltas en columnas distintas mas la cabeza de la LN.
  pegar('note1', cx(0), alto * 0.52);
  pegar('note2', cx(1), alto * 0.3);
  pegar('note1', cx(0), alto * 0.2);
  pegar('note1', cx(3), alto * 0.44);
  pegar(clave(columnaPulsada, 'note1', 'note2'), cx(columnaPulsada), yJuicio);

  ctx.restore();
}
