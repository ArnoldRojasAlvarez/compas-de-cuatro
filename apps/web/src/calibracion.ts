// T-015: pantalla de calibracion del motor de dificultad contra el star
// rating de osu!. Herramienta de desarrollo: no esta en ninguna navegacion,
// se entra con `#calibracion` en la URL (ver router.ts). No aplica nada por
// si sola: muestra numeros y exporta JSON para que Opus ajuste los parametros.
//
// Las estrellas se leen con el mismo cliente/worker/cache de T-014 (no se
// calcula nada en el hilo principal). Las filas (con sus <input>) se crean
// UNA vez y despues solo se actualizan celdas de texto: reconstruirlas en
// cada resultado del worker le sacaria el foco al campo que se esta tipeando.

import './calibracion.css';
import type { Chart, DifficultyResult } from '@tetra/core';
import {
  hashMapa,
  MODELO_CALIBRADO,
  PARAMETROS_DIFICULTAD,
  SKILLSETS,
  VERSION_MODELO_DIFICULTAD,
} from '@tetra/core';
import { listarCanciones } from '@tetra/storage';
import { crearClienteDificultad } from './dificultad-worker-cliente.js';
import {
  cargarAnotaciones,
  construirExportacion,
  guardarAnotaciones,
  parsearSr,
  predecir,
  resumirCalibracion,
  type Anotaciones,
  type FilaCalibracion,
  type ResumenCalibracion,
} from './calibracion-logica.js';

export interface OpcionesCalibracion {
  /** Salir de la herramienta (el router vuelve al menu y limpia el hash). */
  aMenu: () => void;
}

function num(valor: number | null | undefined, decimales = 2): string {
  return valor === null || valor === undefined ? '...' : valor.toFixed(decimales);
}

function el<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  clase?: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

/** Muestra la pantalla de calibracion dentro de `contenedor`, reemplazando lo que hubiera. */
export function mostrarCalibracion(
  contenedor: HTMLElement,
  opciones: OpcionesCalibracion,
): void {
  contenedor.innerHTML = '';
  const anotaciones: Anotaciones = cargarAnotaciones(localStorage);
  const cliente = crearClienteDificultad();
  let destruida = false;

  const filas: FilaCalibracion[] = [];
  /** Celdas que dependen del calculo, por indice de fila, para actualizarlas sin reconstruir. */
  const celdas: Array<{
    overall: HTMLElement;
    vector: HTMLElement;
    ajustada: HTMLElement;
  }> = [];

  const raiz = el('div', 'calibracion');
  const cabecera = el('header', 'calibracion__cabecera');
  cabecera.appendChild(el('h1', 'calibracion__titulo', 'Calibración de dificultad'));
  const acciones = el('div', 'calibracion__acciones');
  const botonExportar = el('button', undefined, 'Exportar JSON');
  const botonVolver = el('button', undefined, 'Volver al menú');
  acciones.append(botonExportar, botonVolver);
  cabecera.appendChild(acciones);

  const aviso = el(
    'p',
    'calibracion__aviso',
    `Herramienta de desarrollo. Modelo v${VERSION_MODELO_DIFICULTAD}, ` +
      `${MODELO_CALIBRADO ? 'calibrado' : 'sin calibrar'}. No aplica nada: solo mide y exporta.`,
  );
  const estado = el('p', 'calibracion__estado', 'Cargando biblioteca...');
  const resumenEl = el('section', 'calibracion__resumen');
  const peoresEl = el('section', 'calibracion__peores');

  const tabla = el('table', 'calibracion__tabla');
  const encabezado = el('thead');
  const filaEncabezado = el('tr');
  for (const titulo of ['Mapa', 'SR osu!', 'Notas', 'Tetra', 'Ajustada', 'Vector']) {
    filaEncabezado.appendChild(el('th', undefined, titulo));
  }
  encabezado.appendChild(filaEncabezado);
  const cuerpo = el('tbody');
  tabla.append(encabezado, cuerpo);

  raiz.append(cabecera, aviso, estado, resumenEl, peoresEl, tabla);
  contenedor.appendChild(raiz);

  function persistir(): void {
    if (!guardarAnotaciones(localStorage, anotaciones)) {
      estado.textContent =
        'No se pudo guardar en localStorage: las anotaciones se pierden al recargar.';
    }
  }

  function textoVector(resultado: DifficultyResult | undefined): string {
    if (!resultado) return '...';
    return SKILLSETS.map((s) => `${s} ${resultado.vector[s].toFixed(2)}`).join('  ');
  }

  function filaDeResumen(etiqueta: string, valor: string): HTMLElement {
    const fila = el('div', 'calibracion__dato');
    fila.append(
      el('span', 'calibracion__dato-etiqueta', etiqueta),
      el('span', 'calibracion__dato-valor', valor),
    );
    return fila;
  }

  function pintarResumen(resumen: ResumenCalibracion): void {
    resumenEl.replaceChildren();
    resumenEl.appendChild(el('h2', undefined, 'Resumen'));
    resumenEl.appendChild(filaDeResumen('Mapas con SR y cálculo', String(resumen.pares)));
    resumenEl.appendChild(
      filaDeResumen(
        'Spearman Tetra vs osu! (meta > 0.85)',
        resumen.spearman === null ? 'sin datos' : num(resumen.spearman, 3),
      ),
    );
    const a = resumen.ajuste;
    resumenEl.appendChild(
      filaDeResumen(
        'Ajuste estrella = a * valor^p',
        a === null
          ? 'hacen falta 2 mapas con SR y overall positivos distintos'
          : `a = ${num(a.a, 4)}, p = ${num(a.p, 4)}, R2 = ${num(a.r2, 3)} (${a.usados} usados, ${a.descartados} descartados)`,
      ),
    );
    for (const set of resumen.porSet) {
      resumenEl.appendChild(
        filaDeResumen(
          `Set: ${set.titulo} (${set.n})`,
          set.rho === null ? 'sin orden' : num(set.rho, 3),
        ),
      );
    }
  }

  function pintarPeores(resumen: ResumenCalibracion): void {
    peoresEl.replaceChildren();
    peoresEl.appendChild(el('h2', undefined, 'Diez peores discrepancias'));
    if (resumen.peores.length === 0) {
      peoresEl.appendChild(
        el(
          'p',
          'calibracion__vacio',
          'Anota el SR de osu! en algunos mapas para ver esto.',
        ),
      );
      return;
    }
    const t = el('table', 'calibracion__tabla');
    const cab = el('tr');
    for (const titulo of [
      'Mapa',
      'Rango Tetra',
      'Rango osu!',
      'Tetra',
      'osu!',
      'Ajustada - osu!',
      'Vector',
    ]) {
      cab.appendChild(el('th', undefined, titulo));
    }
    t.appendChild(el('thead')).appendChild(cab);
    const cuerpoPeores = el('tbody');
    for (const d of resumen.peores) {
      const tr = el('tr');
      tr.append(
        el('td', undefined, `${d.fila.titulo} [${d.fila.dificultad}]`),
        el('td', 'calibracion__num', num(d.rangoTetra, 1)),
        el('td', 'calibracion__num', num(d.rangoOsu, 1)),
        el('td', 'calibracion__num', num(d.fila.resultado?.overall)),
        el('td', 'calibracion__num', num(d.fila.sr)),
        el(
          'td',
          'calibracion__num',
          d.diferenciaAjustada === null ? '-' : num(d.diferenciaAjustada),
        ),
        el('td', 'calibracion__vector', textoVector(d.fila.resultado)),
      );
      cuerpoPeores.appendChild(tr);
    }
    t.appendChild(cuerpoPeores);
    peoresEl.appendChild(t);
  }

  function actualizar(): void {
    const resumen = resumirCalibracion(filas);
    pintarResumen(resumen);
    pintarPeores(resumen);
    filas.forEach((f, i) => {
      const c = celdas[i];
      if (!c) return;
      c.overall.textContent = num(f.resultado?.overall);
      c.vector.textContent = textoVector(f.resultado);
      c.ajustada.textContent =
        resumen.ajuste && f.resultado
          ? num(predecir(resumen.ajuste, f.resultado.overall))
          : '-';
    });
  }

  function agregarFila(
    cancionId: string,
    titulo: string,
    artista: string,
    chart: Chart,
  ): void {
    const clave = String(hashMapa(chart));
    const guardada = anotaciones[clave];
    const indice = filas.length;
    const fila: FilaCalibracion = {
      clave,
      cancionId,
      titulo,
      artista,
      dificultad: chart.metadata.difficultyName,
      resultado: undefined,
      sr: guardada?.sr ?? null,
      notas: guardada?.notas ?? '',
    };
    filas.push(fila);

    const tr = el('tr');
    tr.appendChild(el('td', undefined, `${titulo} [${fila.dificultad}]`));

    const campoSr = el('input');
    campoSr.type = 'text';
    campoSr.inputMode = 'decimal';
    campoSr.className = 'calibracion__sr';
    campoSr.value = fila.sr === null ? '' : String(fila.sr);
    campoSr.addEventListener('input', () => {
      fila.sr = parsearSr(campoSr.value);
      anotaciones[clave] = { sr: fila.sr, notas: fila.notas };
      persistir();
      actualizar();
    });
    const tdSr = el('td');
    tdSr.appendChild(campoSr);

    const campoNotas = el('input');
    campoNotas.type = 'text';
    campoNotas.className = 'calibracion__notas';
    campoNotas.value = fila.notas;
    campoNotas.addEventListener('input', () => {
      fila.notas = campoNotas.value;
      anotaciones[clave] = { sr: fila.sr, notas: fila.notas };
      persistir();
    });
    const tdNotas = el('td');
    tdNotas.appendChild(campoNotas);

    const overall = el('td', 'calibracion__num', '...');
    const ajustada = el('td', 'calibracion__num', '-');
    const vector = el('td', 'calibracion__vector', '...');
    tr.append(tdSr, tdNotas, overall, ajustada, vector);
    cuerpo.appendChild(tr);
    celdas[indice] = { overall, vector, ajustada };

    cliente
      .pedir(chart, false)
      .then((resultado) => {
        if (destruida) return;
        fila.resultado = resultado;
        actualizar();
      })
      .catch(() => {
        if (!destruida) vector.textContent = 'error al calcular';
      });
  }

  function salir(): void {
    destruida = true;
    cliente.destruir();
    opciones.aMenu();
  }
  botonVolver.addEventListener('click', salir);

  botonExportar.addEventListener('click', () => {
    const datos = construirExportacion(filas, {
      versionModelo: VERSION_MODELO_DIFICULTAD,
      modeloCalibrado: MODELO_CALIBRADO,
      parametros: PARAMETROS_DIFICULTAD,
      generado: new Date().toISOString(),
    });
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const enlace = el('a');
    enlace.href = url;
    enlace.download = 'tetra-calibracion.json';
    enlace.click();
    URL.revokeObjectURL(url);
  });

  void listarCanciones()
    .then((canciones) => {
      if (destruida) return;
      for (const cancion of canciones) {
        for (const chart of cancion.dificultades) {
          agregarFila(cancion.id, cancion.titulo, cancion.artista, chart);
        }
      }
      estado.textContent =
        filas.length === 0
          ? 'La biblioteca está vacía: importa un .osz desde el song select.'
          : `${filas.length} dificultades.`;
      actualizar();
    })
    .catch(() => {
      estado.textContent = 'No se pudo leer la biblioteca.';
    });
}
