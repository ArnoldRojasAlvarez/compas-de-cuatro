// T-052: iconos SVG inline para los botones sin texto (menu y song select).
// Nada de emoji (docs/DISENO.md, "Que evitar"): trazos finos de 24x24 que toman
// el color del texto (`currentColor`). El nombre accesible del boton lo pone
// quien lo crea (aria-label y title); el icono en si va oculto a lectores.

export type NombreIcono =
  | 'reproducir'
  | 'pausa'
  | 'siguiente'
  | 'volver'
  | 'filtros'
  | 'mas'
  | 'menos'
  | 'reloj'
  | 'azar'
  | 'editar'
  | 'exportar'
  | 'borrar'
  | 'confirmar'
  | 'cerrar'
  | 'auto'
  | 'replay';

interface DefinicionIcono {
  /** Trazos (path d). */
  trazos: string[];
  /** Circulos [cx, cy, r], siempre sin relleno. */
  circulos?: [number, number, number][];
  /** Relleno solido en vez de trazo (reproducir, pausa, siguiente). */
  relleno?: boolean;
}

const ICONOS: Record<NombreIcono, DefinicionIcono> = {
  reproducir: { trazos: ['M8 5.5v13l11-6.5z'], relleno: true },
  pausa: { trazos: ['M7 5h3.5v14H7z', 'M13.5 5H17v14h-3.5z'], relleno: true },
  siguiente: { trazos: ['M5.5 5.5v13l9-6.5z', 'M16.5 5h2.5v14h-2.5z'], relleno: true },
  volver: { trazos: ['M15 5l-7 7 7 7'] },
  filtros: {
    trazos: ['M4 7h8', 'M18 7h2', 'M4 17h2', 'M12 17h8'],
    circulos: [
      [15, 7, 2.5],
      [9, 17, 2.5],
    ],
  },
  mas: { trazos: ['M12 5v14', 'M5 12h14'] },
  menos: { trazos: ['M5 12h14'] },
  reloj: { trazos: ['M12 7.5V12l3 2'], circulos: [[12, 12, 8.5]] },
  azar: {
    trazos: [
      'M3 7h3c3 0 5 2.2 7 5s4 5 7 5h1',
      'M3 17h3c1.4 0 2.6-.6 3.6-1.6',
      'M13.6 8.4C14.6 7.5 16 7 18 7h2',
      'M18 4l3 3-3 3',
      'M18 14l3 3-3 3',
    ],
  },
  editar: { trazos: ['M4 20h4l10.5-10.5-4-4L4 16z', 'M13 7l4 4'] },
  exportar: { trazos: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'] },
  borrar: {
    trazos: ['M5 7h14', 'M10 7V4.5h4V7', 'M7 7l1 13h8l1-13', 'M10.5 11v5.5', 'M13.5 11v5.5'],
  },
  confirmar: { trazos: ['M5 12.5l4.5 4.5L19 7.5'] },
  cerrar: { trazos: ['M6 6l12 12', 'M18 6L6 18'] },
  // T-044: una pantalla con el triangulo de reproducir (ver el mapa jugado solo).
  auto: { trazos: ['M4 5h16v11H4z', 'M9 20h6', 'M12 16v4', 'M10.5 8v5l4-2.5z'] },
  // T-044: flecha que gira hacia atras con la aguja de un reloj (volver a ver una partida).
  replay: { trazos: ['M4.5 12a7.5 7.5 0 1 0 2.4-5.5', 'M4 4.5v4h4', 'M12 8v4l2.5 1.5'] },
}

const NS = 'http://www.w3.org/2000/svg';

/** Crea el SVG de un icono. Decorativo (`aria-hidden`): el boton que lo contiene lleva el nombre. */
export function crearIcono(nombre: NombreIcono): SVGSVGElement {
  const def = ICONOS[nombre];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('tetra-icono');
  if (def.relleno) {
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('stroke', 'none');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  for (const d of def.trazos) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  for (const [cx, cy, r] of def.circulos ?? []) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', String(cy));
    c.setAttribute('r', String(r));
    svg.appendChild(c);
  }
  return svg;
}

/**
 * Boton-icono: `<button>` con el icono y el nombre accesible en aria-label y
 * title (el tooltip nativo). `nombre` es el texto que lee un lector de pantalla.
 */
export function crearBotonIcono(
  icono: NombreIcono,
  nombre: string,
  clase = '',
): HTMLButtonElement {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = clase === '' ? 'tetra-boton-icono' : `tetra-boton-icono ${clase}`;
  boton.setAttribute('aria-label', nombre);
  boton.title = nombre;
  boton.appendChild(crearIcono(icono));
  return boton;
}

/** Cambia el icono de un boton-icono ya creado y su nombre accesible. */
export function cambiarBotonIcono(boton: HTMLButtonElement, icono: NombreIcono, nombre: string): void {
  boton.setAttribute('aria-label', nombre);
  boton.title = nombre;
  boton.replaceChildren(crearIcono(icono));
}
