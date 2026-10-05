// T-052: el fondo de la escena. Una capa fija detras de #app con la imagen de
// la cancion (desenfocada y oscurecida), compartida por el menu y el song
// select. Es un singleton: hay un solo fondo en pantalla, y cambiarlo es un
// fundido entre dos capas.
//
// El fondo por defecto (el halo teal y la rejilla de cuatro columnas de T-024)
// vive en `body` (style.css): esta capa no lo duplica, solo se pone encima
// cuando hay imagen y se vuelve transparente cuando no (por eso `limpiar` es
// un fundido a opacidad 0 del contenedor, no un cambio de color).
//
// Object URLs: uno por Blob, creado al ponerlo y revocado cuando su capa deja
// de verse (al terminar el fundido) o al limpiar. Nunca hay mas de dos vivos.

export interface OpcionesFondo {
  /** px de blur. Default 0. */
  desenfoque?: number;
  /** 0 a 1: cuanto se oscurece la imagen. Default 0.6. */
  oscuridad?: number;
  /**
   * T-054: 0 a 1, cuanto se oscurece ademas el CENTRO (una vineta inversa: el
   * centro mas oscuro, los bordes con mas imagen). Es para el menu, donde el
   * logo y los botones tienen que leerse sobre una portada clara. Default 0.
   */
  centro?: number;
}

export interface FondoEscena {
  /** Pone la imagen (o el fondo por defecto si `imagen` es undefined) con un fundido de ~400 ms. Llamar con el mismo Blob no hace nada. */
  poner(imagen: Blob | undefined, opciones?: OpcionesFondo): void;
  /** Vuelve al fondo por defecto y revoca los object URLs. */
  limpiar(): void;
}

const DESENFOQUE_POR_DEFECTO = 0;
const OSCURIDAD_POR_DEFECTO = 0.6;
const CENTRO_POR_DEFECTO = 0;

/** Recorta la oscuridad y el centro a 0..1 y el desenfoque a >= 0; un valor no numerico vuelve al default. */
export function normalizarOpcionesFondo(opciones: OpcionesFondo | undefined): {
  desenfoque: number;
  oscuridad: number;
  centro: number;
} {
  const d = opciones?.desenfoque;
  const o = opciones?.oscuridad;
  const c = opciones?.centro;
  return {
    desenfoque: d !== undefined && Number.isFinite(d) ? Math.max(0, d) : DESENFOQUE_POR_DEFECTO,
    oscuridad: o !== undefined && Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : OSCURIDAD_POR_DEFECTO,
    centro: c !== undefined && Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : CENTRO_POR_DEFECTO,
  };
}

interface Capa {
  el: HTMLDivElement;
  url: string | null;
}

let instancia: FondoEscena | null = null;

/** Singleton: una capa fija detras de #app (z-index bajo, pointer-events none). */
export function fondoEscena(): FondoEscena {
  if (instancia === null) instancia = crearFondoEscena();
  return instancia;
}

function crearFondoEscena(): FondoEscena {
  const contenedor = document.createElement('div');
  contenedor.className = 'tetra-fondo-escena';
  contenedor.setAttribute('aria-hidden', 'true');

  const capas: [Capa, Capa] = [
    { el: document.createElement('div'), url: null },
    { el: document.createElement('div'), url: null },
  ];
  for (const capa of capas) {
    capa.el.className = 'tetra-fondo-capa';
    contenedor.appendChild(capa.el);
  }
  const velo = document.createElement('div');
  velo.className = 'tetra-fondo-velo';
  contenedor.appendChild(velo);
  // T-054: oscurece solo el centro. Una capa aparte (no un cambio de gradiente
  // del velo) para que pasar del menu al song select funda su opacidad en vez
  // de saltar.
  const centro = document.createElement('div');
  centro.className = 'tetra-fondo-centro';
  contenedor.appendChild(centro);
  document.body.prepend(contenedor);

  /** Indice de la capa que se ve ahora, o -1 si no hay imagen. */
  let activa = -1;
  /** El Blob que se esta mostrando o que esta por mostrarse (decodificandose). */
  let blobActual: Blob | undefined;
  /** Se incrementa en cada cambio: una decodificacion que llega tarde se descarta. */
  let version = 0;
  /** Hay una imagen decodificandose (ya pedida, todavia sin mostrar). */
  let pendiente = false;

  function sinMovimiento(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function liberar(capa: Capa): void {
    if (capa.url !== null) URL.revokeObjectURL(capa.url);
    capa.url = null;
    capa.el.style.backgroundImage = '';
  }

  /** Libera una capa cuando termino de desvanecerse (o ya, sin movimiento). Si mientras tanto volvio a usarse, no la toca. */
  function liberarAlDesvanecer(capa: Capa, url: string | null): void {
    if (url === null) return;
    const liberarSiSigue = (): void => {
      if (capa.url === url && !capa.el.classList.contains('tetra-fondo-capa-visible')) liberar(capa);
    };
    if (sinMovimiento()) {
      liberarSiSigue();
      return;
    }
    capa.el.addEventListener('transitionend', liberarSiSigue, { once: true });
  }

  function aplicarOpciones(opciones: OpcionesFondo | undefined): void {
    const { desenfoque, oscuridad, centro: oscuridadDelCentro } = normalizarOpcionesFondo(opciones);
    // El desenfoque se aplica a las dos capas (la que sale tambien) y la
    // oscuridad al velo; todo transiciona por CSS.
    for (const capa of capas) capa.el.style.filter = desenfoque > 0 ? `blur(${desenfoque}px)` : '';
    velo.style.opacity = String(oscuridad);
    centro.style.opacity = String(oscuridadDelCentro);
  }

  function mostrarCapa(indice: number, url: string): void {
    const nueva = capas[indice]!;
    const vieja = activa >= 0 ? capas[activa]! : null;
    liberar(nueva);
    nueva.url = url;
    nueva.el.style.backgroundImage = `url("${url}")`;
    nueva.el.classList.add('tetra-fondo-capa-visible');
    contenedor.classList.add('tetra-fondo-escena-visible');
    activa = indice;
    if (vieja !== null && vieja !== nueva) {
      vieja.el.classList.remove('tetra-fondo-capa-visible');
      liberarAlDesvanecer(vieja, vieja.url);
    }
  }

  function ocultarTodo(): void {
    contenedor.classList.remove('tetra-fondo-escena-visible');
    for (const capa of capas) {
      capa.el.classList.remove('tetra-fondo-capa-visible');
      liberarAlDesvanecer(capa, capa.url);
    }
    activa = -1;
  }

  return {
    poner(imagen, opciones) {
      aplicarOpciones(opciones);
      if (imagen === blobActual) {
        // Mismo Blob: sin fundido. Si ya se desvanecio (limpiar) y vuelve a
        // pedirse el mismo, se muestra de nuevo.
        if (imagen === undefined || activa >= 0 || pendiente) return;
      }
      const miVersion = ++version;
      blobActual = imagen;
      pendiente = false;
      if (imagen === undefined) {
        ocultarTodo();
        return;
      }
      // Se pre-decodifica antes de cruzar: sin esto el fundido pasaria por un
      // instante vacio mientras el navegador decodifica la imagen nueva.
      const url = URL.createObjectURL(imagen);
      const sonda = new Image();
      pendiente = true;
      const mostrar = (): void => {
        if (miVersion !== version) {
          URL.revokeObjectURL(url);
          return;
        }
        pendiente = false;
        mostrarCapa(activa === 0 ? 1 : 0, url);
      };
      sonda.src = url;
      sonda.decode().then(mostrar, mostrar);
    },
    limpiar() {
      version++;
      pendiente = false;
      blobActual = undefined;
      ocultarTodo();
    },
  };
}
