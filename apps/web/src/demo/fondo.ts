// T-051: fondo generativo de la cancion demo, dibujado con Canvas 2D.
//
// Un instrumento de precision en la oscuridad: gradiente profundo con sesgo
// verdoso (paleta de docs/DISENO.md), una figura de cuatro cuadrantes
// espejados (anillos y arcos en teal, marcas de reloj, una onda de cuatro
// lobulos) con un toque ambar en cada cuadrante, vineta y grano sutil. Es
// determinista: el grano sale de un PRNG con semilla. La figura queda a la
// derecha del centro para dejar aire a la izquierda, donde va la lista del
// song select.

import { crearPrng, SEMILLA } from './composicion.js';

const FONDO = '#0B0E11';
const TEAL = '63, 216, 194'; // #3FD8C2
const AMBAR = '232, 184, 74'; // #E8B84A

const GRAD = Math.PI / 180;

function crearLienzo(ancho: number, alto: number): HTMLCanvasElement {
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  return lienzo;
}

function arco(
  ctx: CanvasRenderingContext2D,
  r: number,
  desdeGrados: number,
  hastaGrados: number,
  estilo: string,
  grosor: number,
): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, desdeGrados * GRAD, hastaGrados * GRAD);
  ctx.strokeStyle = estilo;
  ctx.lineWidth = grosor;
  ctx.lineCap = 'butt';
  ctx.stroke();
}

/** Dibuja la figura en el origen (ya trasladado): `unidad` es el radio exterior en px. */
function dibujarFigura(ctx: CanvasRenderingContext2D, unidad: number): void {
  const radioInterior = unidad * 0.2;
  const anillos = 7;
  const paso = (unidad - radioInterior) / anillos;

  // Cada cuadrante es el espejo del anterior: se dibuja uno, rotado cuatro veces.
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.rotate((k * Math.PI) / 2);

    for (let i = 0; i < anillos; i++) {
      const r = radioInterior + paso * (i + 1);
      // El arco es simetrico respecto a la diagonal del cuadrante (45 grados).
      const mitad = 40 - 4.5 * (i % 4) - (i > 4 ? 6 : 0);
      const alfa = 0.66 - i * 0.055;
      const grosor = i % 3 === 0 ? 3 : 1.5;
      arco(ctx, r, 45 - mitad, 45 + mitad, `rgba(${TEAL}, ${alfa})`, grosor);
    }

    // Marcas de reloj entre dos anillos, cada 3 grados, con una mas larga cada 15.
    const rMarca = radioInterior + paso * 3.4;
    for (let g = 3; g < 90; g += 3) {
      const larga = g % 15 === 0;
      const a = g * GRAD;
      const largo = larga ? paso * 0.55 : paso * 0.28;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * rMarca, Math.sin(a) * rMarca);
      ctx.lineTo(Math.cos(a) * (rMarca + largo), Math.sin(a) * (rMarca + largo));
      ctx.strokeStyle = `rgba(${TEAL}, ${larga ? 0.55 : 0.28})`;
      ctx.lineWidth = larga ? 2 : 1;
      ctx.stroke();
    }

    // Toque ambar: un arco corto y grueso en el anillo 5, centrado en la diagonal.
    arco(ctx, radioInterior + paso * 5, 45 - 5, 45 + 5, `rgba(${AMBAR}, 0.85)`, 6);

    // Un cuadradito ambar sobre la diagonal, afuera de todo.
    const rPunto = unidad * 1.06;
    const a45 = 45 * GRAD;
    ctx.fillStyle = `rgba(${AMBAR}, 0.7)`;
    ctx.fillRect(Math.cos(a45) * rPunto - 5, Math.sin(a45) * rPunto - 5, 10, 10);

    // Linea radial fina que parte cada cuadrante.
    ctx.beginPath();
    ctx.moveTo(radioInterior * 0.6, 0);
    ctx.lineTo(unidad * 0.98, 0);
    ctx.strokeStyle = `rgba(${TEAL}, 0.16)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  // Onda de cuatro lobulos: un osciloscopio cerrado alrededor del centro.
  ctx.beginPath();
  const radioOnda = radioInterior + paso * 1.6;
  for (let g = 0; g <= 360; g += 1) {
    const a = g * GRAD;
    const r = radioOnda + paso * 0.34 * Math.sin(4 * a) + paso * 0.1 * Math.sin(12 * a);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (g === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = `rgba(${TEAL}, 0.7)`;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Centro: cuatro cuadrados, uno por cuadrante.
  const lado = unidad * 0.035;
  const hueco = unidad * 0.012;
  ctx.fillStyle = `rgba(${TEAL}, 0.7)`;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const x = sx < 0 ? -hueco - lado : hueco;
    const y = sy < 0 ? -hueco - lado : hueco;
    ctx.fillRect(x, y, lado, lado);
  }
}

function agregarGrano(ctx: CanvasRenderingContext2D, ancho: number, alto: number): void {
  const imagen = ctx.getImageData(0, 0, ancho, alto);
  const datos = imagen.data;
  const azar = crearPrng(SEMILLA ^ 0x51ed);
  for (let i = 0; i < datos.length; i += 4) {
    // Ruido de luminancia (igual en los tres canales) de +-5 niveles.
    const ruido = (azar() - 0.5) * 10;
    datos[i] = (datos[i] ?? 0) + ruido;
    datos[i + 1] = (datos[i + 1] ?? 0) + ruido;
    datos[i + 2] = (datos[i + 2] ?? 0) + ruido;
  }
  ctx.putImageData(imagen, 0, 0);
}

/** Dibuja el fondo y lo devuelve como JPEG. Determinista. */
export async function dibujarFondoDemo(ancho: number, alto: number): Promise<Blob> {
  const lienzo = crearLienzo(ancho, alto);
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el contexto 2D para el fondo de la demo.');

  // Base y gradientes profundos.
  ctx.fillStyle = FONDO;
  ctx.fillRect(0, 0, ancho, alto);

  const cx = ancho * 0.68;
  const cy = alto * 0.5;
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, alto * 0.95);
  halo.addColorStop(0, 'rgba(24, 66, 66, 0.55)');
  halo.addColorStop(0.45, 'rgba(16, 38, 40, 0.3)');
  halo.addColorStop(1, 'rgba(11, 14, 17, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, ancho, alto);

  const calido = ctx.createRadialGradient(ancho * 0.06, alto * 1.02, 0, ancho * 0.06, alto * 1.02, alto * 0.7);
  calido.addColorStop(0, 'rgba(70, 52, 18, 0.32)');
  calido.addColorStop(1, 'rgba(11, 14, 17, 0)');
  ctx.fillStyle = calido;
  ctx.fillRect(0, 0, ancho, alto);

  // La figura de cuatro cuadrantes.
  ctx.save();
  ctx.translate(cx, cy);
  dibujarFigura(ctx, alto * 0.48);
  ctx.restore();

  // Vineta: oscurece los bordes para que la interfaz mande.
  const vineta = ctx.createRadialGradient(ancho * 0.55, alto * 0.5, alto * 0.35, ancho * 0.55, alto * 0.5, ancho * 0.72);
  vineta.addColorStop(0, 'rgba(5, 7, 9, 0)');
  vineta.addColorStop(1, 'rgba(5, 7, 9, 0.7)');
  ctx.fillStyle = vineta;
  ctx.fillRect(0, 0, ancho, alto);

  agregarGrano(ctx, ancho, alto);

  return new Promise<Blob>((resolver, rechazar) => {
    lienzo.toBlob(
      (blob) => {
        if (blob) resolver(blob);
        else rechazar(new Error('El navegador no pudo codificar el fondo de la demo.'));
      },
      'image/jpeg',
      0.9,
    );
  });
}
