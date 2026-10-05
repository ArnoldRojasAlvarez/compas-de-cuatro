// T-050: utilidad interna para crear lienzos Canvas 2D a doble resolucion.
//
// La usan las skins propias (skins-propias.ts) y las texturas de brillo del
// playfield. No se exporta desde index.ts: es un detalle de implementacion.

/** Factor de supermuestreo: se dibuja a 2x y Pixi lo reduce, para que se vea nitido. */
export const ESCALA_LIENZO = 2;

export interface Lienzo {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Ancho logico del dibujo (en px sin el supermuestreo). */
  ancho: number;
  /** Alto logico del dibujo. */
  alto: number;
}

/**
 * Crea un canvas de `ancho` x `alto` px logicos, con el contexto ya escalado
 * para dibujar en coordenadas logicas (el canvas real mide `ESCALA_LIENZO`
 * veces mas). Los tamanos se redondean hacia arriba y nunca bajan de 1.
 */
export function crearLienzo(ancho: number, alto: number): Lienzo {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(ancho * ESCALA_LIENZO));
  canvas.height = Math.max(1, Math.ceil(alto * ESCALA_LIENZO));
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('No se pudo crear el contexto 2D del lienzo');
  ctx.scale(ESCALA_LIENZO, ESCALA_LIENZO);
  return {
    canvas,
    ctx,
    ancho: canvas.width / ESCALA_LIENZO,
    alto: canvas.height / ESCALA_LIENZO,
  };
}
