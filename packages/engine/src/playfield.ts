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
//   columna. `render()` nunca hace `new Sprite()` salvo la primera vez que
//   el pool de esa columna necesita crecer; despues reutiliza.

import { Container, Sprite, Text, Texture } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Chart, Column, Judgement, Ms, Note } from '@tetra/core';
import { COLUMN_COUNT, isHold } from '@tetra/core';
import {
  avanzarVentana,
  calcularPosicionNota,
  receptorY,
  ventanaVacia,
  type VentanaNotas,
} from './position.js';

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
const ANCHO_MARCADOR_FACTOR = 0.82;
const ANCHO_CUERPO_FACTOR = 0.5;
const DURACION_POPUP_JUICIO: Ms = 450;
const ALTO_RECEPTOR = 6;

const COLOR_COLUMNA: readonly number[] = [0xff5f6d, 0xffc857, 0x4ecdc4, 0x556fb5];
const COLOR_RECEPTOR_APAGADO = 0x333344;
const COLOR_RECEPTOR_ENCENDIDO = 0xffffff;
const COLOR_CUERPO_LN = 0x8899ff;

const COLOR_JUICIO: Record<Judgement, number> = {
  max: 0xffffff,
  perfect: 0xffe066,
  great: 0x6ee7b7,
  good: 0x60a5fa,
  bad: 0xf97316,
  miss: 0xef4444,
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

interface PopupJuicio {
  texto: Text;
  spawnTime: Ms;
}

export function createPlayfield(
  app: Application,
  chart: Chart,
  options: PlayfieldOptions,
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

  const capaCuerpos = new Container();
  const capaMarcadores = new Container();
  const capaReceptores = new Container();
  const capaJuicios = new Container();
  raiz.addChild(capaCuerpos, capaReceptores, capaMarcadores, capaJuicios);

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

  const poolMarcadores: Pool[] = [];
  const poolCuerpos: Pool[] = [];
  const receptores: Sprite[] = [];

  for (let columna = 0; columna < COLUMN_COUNT; columna++) {
    poolMarcadores.push(
      new Pool(capaMarcadores, () => {
        const sprite = new Sprite(Texture.WHITE);
        sprite.tint = COLOR_COLUMNA[columna]!;
        sprite.anchor.set(0.5, 0.5);
        return sprite;
      }),
    );
    poolCuerpos.push(
      new Pool(capaCuerpos, () => {
        const sprite = new Sprite(Texture.WHITE);
        sprite.tint = COLOR_CUERPO_LN;
        sprite.alpha = 0.55;
        sprite.anchor.set(0.5, 0);
        return sprite;
      }),
    );

    const receptor = new Sprite(Texture.WHITE);
    receptor.tint = COLOR_RECEPTOR_APAGADO;
    receptor.anchor.set(0.5, 0.5);
    receptor.height = ALTO_RECEPTOR;
    capaReceptores.addChild(receptor);
    receptores.push(receptor);
  }

  const popupsPendientes: Array<{ column: Column; judgement: Judgement }> = [];
  const popupsActivos: PopupJuicio[] = [];

  function geometria(): { height: number; receptorOffset: number } {
    return { height: alturaActual, receptorOffset: options.receptorOffset };
  }

  function columnaX(columna: number): number {
    return columna * options.columnWidth + options.columnWidth / 2;
  }

  function posicionarReceptores(): void {
    const y = receptorY(geometria());
    receptores.forEach((receptor, columna) => {
      receptor.x = columnaX(columna);
      receptor.y = y;
      receptor.width = options.columnWidth * ANCHO_MARCADOR_FACTOR;
    });
  }
  posicionarReceptores();

  function render(time: Ms): void {
    // Los popups nuevos se registran con el tiempo de ESTE frame: showJudgement()
    // siempre se llama antes que render() dentro del mismo frame (ver el
    // orden del bucle en apps/web/src/game.ts), asi que no hace falta
    // guardar un timestamp aparte para saber cuando "nacio" cada uno.
    for (const pendiente of popupsPendientes) {
      const texto = new Text({
        text: pendiente.judgement.toUpperCase(),
        style: { fill: COLOR_JUICIO[pendiente.judgement], fontSize: 20, fontWeight: 'bold' },
      });
      texto.anchor.set(0.5, 0.5);
      texto.x = columnaX(pendiente.column);
      texto.y = receptorY(geometria()) - 40;
      capaJuicios.addChild(texto);
      popupsActivos.push({ texto, spawnTime: time });
    }
    popupsPendientes.length = 0;

    for (let i = popupsActivos.length - 1; i >= 0; i--) {
      const popup = popupsActivos[i]!;
      const transcurrido = time - popup.spawnTime;
      if (transcurrido >= DURACION_POPUP_JUICIO || transcurrido < 0) {
        popup.texto.destroy();
        popupsActivos.splice(i, 1);
        continue;
      }
      const progreso = transcurrido / DURACION_POPUP_JUICIO;
      popup.texto.alpha = 1 - progreso;
      popup.texto.y = receptorY(geometria()) - 40 - progreso * 20;
    }

    const geo = geometria();
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
      poolMarcador.reiniciar();
      poolCuerpo.reiniciar();

      for (let i = inicio; i < fin; i++) {
        const nota = notas[i]!;

        if (isHold(nota)) {
          const cabeza = calcularPosicionNota(nota.time, time, options.scrollDuration, geo);
          const cola = calcularPosicionNota(nota.endTime, time, options.scrollDuration, geo);
          const yReceptorActual = receptorY(geo);
          const yCabezaClipeada = Math.min(cabeza.y, yReceptorActual);

          if (cola.visible || cabeza.visible) {
            const cuerpo = poolCuerpo.obtener();
            cuerpo.x = columnaX(columna);
            cuerpo.y = cola.y;
            cuerpo.width = options.columnWidth * ANCHO_CUERPO_FACTOR;
            cuerpo.height = Math.max(0, yCabezaClipeada - cola.y);
          }

          // La cabeza deja de dibujarse como marcador aparte una vez que ya
          // paso el receptor: a partir de ahi el cuerpo recortado hace de
          // cabeza visual (ver T-004, "Las LN se dibujan... con el cuerpo
          // recortado al receptor mientras se sostiene").
          if (cabeza.visible && cabeza.y <= yReceptorActual) {
            const marcador = poolMarcador.obtener();
            marcador.x = columnaX(columna);
            marcador.y = cabeza.y;
            marcador.width = options.columnWidth * ANCHO_MARCADOR_FACTOR;
            marcador.height = ALTO_MARCADOR;
          }
          if (cola.visible) {
            const marcadorCola = poolMarcador.obtener();
            marcadorCola.x = columnaX(columna);
            marcadorCola.y = cola.y;
            marcadorCola.width = options.columnWidth * ANCHO_MARCADOR_FACTOR;
            marcadorCola.height = ALTO_MARCADOR;
          }
        } else {
          const posicion = calcularPosicionNota(nota.time, time, options.scrollDuration, geo);
          if (posicion.visible) {
            const marcador = poolMarcador.obtener();
            marcador.x = columnaX(columna);
            marcador.y = posicion.y;
            marcador.width = options.columnWidth * ANCHO_MARCADOR_FACTOR;
            marcador.height = ALTO_MARCADOR;
          }
        }
      }

      poolMarcador.ocultarSobrantes();
      poolCuerpo.ocultarSobrantes();
    }
  }

  function showJudgement(column: Column, judgement: Judgement): void {
    popupsPendientes.push({ column, judgement });
  }

  function setPressed(column: Column, pressed: boolean): void {
    const receptor = receptores[column]!;
    receptor.tint = pressed ? COLOR_RECEPTOR_ENCENDIDO : COLOR_RECEPTOR_APAGADO;
  }

  function resize(width: number, height: number): void {
    alturaActual = height;
    posicionarReceptores();
    void width; // el ancho lo administra quien llama (layout de columnas fijo por columnWidth)
  }

  function destroy(): void {
    for (const pool of poolMarcadores) pool.destruir();
    for (const pool of poolCuerpos) pool.destruir();
    for (const receptor of receptores) receptor.destroy();
    for (const popup of popupsActivos) popup.texto.destroy();
    popupsActivos.length = 0;
    popupsPendientes.length = 0;
    raiz.destroy({ children: true });
  }

  return { render, showJudgement, setPressed, resize, destroy };
}
