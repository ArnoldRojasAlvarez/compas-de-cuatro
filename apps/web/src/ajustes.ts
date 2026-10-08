// T-011: pantalla de ajustes propia. Los controles (offset, velocidad,
// skin) existian desde T-007/T-008/T-009 pero vivian sueltos dentro de la
// pantalla del cargador de desarrollo (T-006, eliminada en T-011, ver el
// ticket, "el problema que resuelve": todo aplastado en un solo lugar);
// esta pantalla es simplemente esos mismos controles, con la misma logica de
// persistencia (offset.ts, velocidad.ts, skin.ts) y el mismo comportamiento
// de siempre, movidos a su propio lugar en la navegacion.
//
// T-012 suma remapeo de teclas (keymap.ts + teclas.ts), el interruptor de
// FPS/ms (graficos.ts) y el restilado de todos los controles con los tokens.
// T-023 las presenta como tarjetas numeradas en una rejilla.
//
// T-053: minimalismo. Cada control es una etiqueta corta mas el control; las
// explicaciones largas pasan a `title` (tooltip) y a lo sumo queda un dato
// vivo en mono (por ejemplo "1200 ms" junto a la velocidad). Cuatro tarjetas:
// Juego (offset, velocidad, volumen), Teclas, Apariencia (skin con
// miniaturas, atenuacion del fondo, video de fondo, FPS) y Presentacion.
//
// T-042 suma la quinta, "Biblioteca": exportar e importar la copia de
// seguridad (dos botones y una linea de estado).
//
// T-058: offset, velocidad, volumen, efectos y atenuacion son barras del mismo
// componente (`crearBarra`): mismo riel, valor en la misma columna. La logica
// pura (formatos, recorte del offset, paso de los botones) vive en
// ajustes-barras-logica.ts.

import {
  ErrorDeRespaldo,
  crearRespaldo,
  estimarAlmacenamiento,
  importarOsk,
  leerAjustesLocales,
  leerRespaldo,
  listarSkins,
  restaurarRespaldo,
  type SkinGuardada,
} from '@tetra/storage';
import { TIPOS_HITSOUND, crearHitsound, reproducirHitsound, type TipoHitsound } from '@tetra/audio';
import {
  CODIGOS_TECLAS_POR_DEFECTO,
  SKINS_PROPIAS,
  dibujarMiniaturaDeSkin,
  type IdSkinPropia,
} from '@tetra/engine';
import { mensajeDeErrorDeCarga } from './cargador-logica.js';
import { EVENTO_BIBLIOTECA_CAMBIO } from './musica-menu-logica.js';
import {
  ajustesPisarianLocales,
  lineaDeAlmacenamiento,
  lineaDeExportacion,
  lineaDeRestauracion,
  nombreDeArchivoDeRespaldo,
} from './respaldo-logica.js';
import { guardarOffset, leerOffset } from './offset.js';
import { guardarMostrarFps, leerMostrarFps } from './graficos.js';
import { intentarAsignarCodigo, leerKeyMap, guardarKeyMap, type KeyMap } from './keymap.js';
import { nombreLegibleDeCodigo } from './teclas.js';
import { VELOCIDAD_MAX, VELOCIDAD_MIN, guardarVelocidad, leerVelocidad } from './velocidad.js';
import {
  OFFSET_BARRA_MAX,
  OFFSET_BARRA_MIN,
  deltaDeOffset,
  formatearOffset,
  formatearVelocidad,
  offsetABarra,
  pasoDeOffset,
} from './ajustes-barras-logica.js';
import { crearBotonIcono } from './iconos.js';
import {
  gananciaDeVolumen,
  guardarVolumen,
  guardarVolumenEfectos,
  leerVolumen,
  leerVolumenEfectos,
} from './volumen.js';
import {
  NOMBRES_DE_HITSOUND,
  esTipoHitsound,
  guardarTipoHitsound,
  leerTipoHitsound,
} from './hitsound-logica.js';
import {
  formatearPorcentaje,
  guardarAtenuacion,
  guardarMostrarBarraDeError,
  guardarMostrarJuicios,
  guardarMostrarTeclas,
  guardarVideoDeFondo,
  leerAtenuacion,
  leerMostrarBarraDeError,
  leerMostrarJuicios,
  leerMostrarTeclas,
  leerVideoDeFondo,
} from './apariencia.js';
import {
  guardarSeleccionDeSkin,
  leerSeleccionDeSkin,
  CATALOGO_PROPIAS,
  type SeleccionDeSkin,
} from './skin-activa.js';
import { seleccionesIguales } from './skin-activa-logica.js';
import {
  PASOS_PREVIOS,
  alternarPresentacion,
  guardarChecklist,
  leerChecklist,
  presentacionActiva,
  type PasoPrevio,
} from './presentacion.js';

/**
 * Envuelve `hijos` en una tarjeta `<section>` con su cabecera: indice
 * numerico en mono (`01` a `04`, el cuatro de la marca) y `<h2>` con el
 * titulo (T-023). `claseModificador` da a cada tarjeta su propia clase (por
 * ejemplo `tetra-ajustes-seccion-teclas`) para que ajustes.css pueda
 * ajustar el layout interno de cada una sin depender del orden de los hijos.
 */
function crearSeccion(
  indice: number,
  titulo: string,
  claseModificador: string,
  ...hijos: HTMLElement[]
): HTMLElement {
  const seccion = document.createElement('section');
  seccion.className = `tetra-ajustes-seccion tetra-ajustes-seccion-${claseModificador}`;

  const cabecera = document.createElement('div');
  cabecera.className = 'tetra-ajustes-seccion-cabecera';

  const numero = document.createElement('span');
  numero.className = 'tetra-ajustes-seccion-indice';
  numero.setAttribute('aria-hidden', 'true');
  numero.textContent = String(indice).padStart(2, '0');
  cabecera.appendChild(numero);

  const encabezado = document.createElement('h2');
  encabezado.className = 'tetra-ajustes-seccion-titulo';
  encabezado.textContent = titulo;
  cabecera.appendChild(encabezado);

  seccion.appendChild(cabecera);

  for (const hijo of hijos) {
    seccion.appendChild(hijo);
  }
  return seccion;
}

interface OpcionesFila {
  /** Nombre corto del ajuste (a la izquierda, en `--tinta`). Sin nombre, la fila es solo control. */
  nombre?: string;
  /** `id` del control al que apunta el `<label>` del nombre. Sin `id`, el nombre es un `<span>`. */
  idControl?: string;
  /** Explicacion larga: va como tooltip (`title`) de toda la fila, no como texto visible. */
  ayuda?: string;
  /** Lo que va a la derecha de la fila. */
  controles: HTMLElement[];
  /** El control ocupa todo el ancho debajo del texto (teclas, skin) en vez de ir a la derecha. */
  apilada?: boolean;
}

/**
 * Fila de ajuste consistente (T-023): etiqueta corta a la izquierda y
 * control(es) a la derecha, con el mismo alto de control en todas. La ayuda,
 * si hay, es el tooltip de la fila entera.
 */
function crearFila(opciones: OpcionesFila): HTMLElement {
  const fila = document.createElement('div');
  fila.className = opciones.apilada
    ? 'tetra-ajustes-fila tetra-ajustes-fila-apilada'
    : 'tetra-ajustes-fila';
  if (opciones.ayuda !== undefined) fila.title = opciones.ayuda;

  if (opciones.nombre !== undefined) {
    const nombre = document.createElement(opciones.idControl !== undefined ? 'label' : 'span');
    nombre.className = 'tetra-ajustes-fila-nombre';
    nombre.textContent = opciones.nombre;
    if (nombre instanceof HTMLLabelElement && opciones.idControl !== undefined) {
      nombre.htmlFor = opciones.idControl;
    }
    fila.appendChild(nombre);
  }

  const controles = document.createElement('div');
  controles.className = 'tetra-ajustes-fila-control';
  for (const control of opciones.controles) {
    controles.appendChild(control);
  }
  fila.appendChild(controles);
  return fila;
}

/** Agrupa varias filas en una sola fila horizontal de la tarjeta (en angosto se apilan). */
function agruparEnFila(...filas: HTMLElement[]): HTMLElement {
  const grupo = document.createElement('div');
  grupo.className = 'tetra-ajustes-controles-fila';
  for (const fila of filas) grupo.appendChild(fila);
  return grupo;
}

/** Dato vivo en mono, junto a un control ("1200 ms", "80%"). */
function crearDatoVivo(texto: string): HTMLElement {
  const dato = document.createElement('span');
  dato.className = 'tetra-ajustes-valor tetra-ajustes-dato';
  dato.textContent = texto;
  return dato;
}

interface OpcionesBarra {
  id: string;
  min: number;
  max: number;
  paso: number;
  /** Posicion inicial de la barra. */
  valor: number;
  /** Texto inicial del valor, a la derecha de la barra. */
  texto: string;
  /** Una rayita en el centro del riel (el cero del offset). */
  marcaCentro?: boolean;
  /** Botones a los costados de la barra (el offset). Sin ellos, el hueco queda vacio. */
  menos?: HTMLElement;
  mas?: HTMLElement;
}

/**
 * Barra de ajuste (T-058): el mismo componente para offset, velocidad,
 * volumen, efectos y atenuacion. Cuatro columnas fijas (hueco del `-`, riel,
 * hueco del `+`, valor), asi que todas las barras tienen el mismo largo de riel
 * y el valor cae en la misma columna, lleven botones o no.
 */
function crearBarra(opciones: OpcionesBarra): {
  entrada: HTMLInputElement;
  dato: HTMLElement;
  control: HTMLElement;
} {
  const entrada = document.createElement('input');
  entrada.type = 'range';
  entrada.id = opciones.id;
  entrada.className = 'tetra-ajustes-rango';
  entrada.min = String(opciones.min);
  entrada.max = String(opciones.max);
  entrada.step = String(opciones.paso);
  entrada.value = String(opciones.valor);

  const riel = document.createElement('div');
  riel.className = opciones.marcaCentro
    ? 'tetra-ajustes-riel tetra-ajustes-riel-centro'
    : 'tetra-ajustes-riel';
  riel.appendChild(entrada);

  const dato = crearDatoVivo(opciones.texto);

  const control = document.createElement('div');
  control.className = 'tetra-ajustes-barra';
  if (opciones.menos) {
    opciones.menos.classList.add('tetra-ajustes-barra-menos');
    control.appendChild(opciones.menos);
  }
  control.appendChild(riel);
  if (opciones.mas) {
    opciones.mas.classList.add('tetra-ajustes-barra-mas');
    control.appendChild(opciones.mas);
  }
  control.appendChild(dato);
  return { entrada, dato, control };
}

/** Barra 0 a 100 (en pasos de 1) con su valor en vivo; `alCambiar` recibe la fraccion 0 a 1. */
function crearDeslizador(
  id: string,
  inicial: number,
  alCambiar: (fraccion: number) => void,
): { entrada: HTMLInputElement; control: HTMLElement } {
  const { entrada, dato, control } = crearBarra({
    id,
    min: 0,
    max: 100,
    paso: 1,
    valor: Math.round(inicial * 100),
    texto: formatearPorcentaje(inicial),
  });
  entrada.addEventListener('input', () => {
    const fraccion = Number(entrada.value) / 100;
    dato.textContent = formatearPorcentaje(fraccion);
    alCambiar(fraccion);
  });
  return { entrada, control };
}

/**
 * Control de calibracion de offset (T-007; T-058 lo pasa a barra): de
 * -150 a +150 ms con el cero marcado en el centro, y dos botones de a 1 ms
 * (Shift: 5) porque arrastrar no alcanza para afinar. Doble clic sobre la barra
 * vuelve a 0. Se lee de localStorage al armar el control y se guarda ahi mismo
 * en cada cambio; game.ts lo vuelve a leer al arrancar la proxima partida y se
 * lo pasa al reloj como `ClockOptions.userOffset`.
 *
 * El offset guardado puede pasar de la barra (el de calibracion admite mas):
 * entonces la barra queda en el tope y el numero muestra el valor real, que
 * solo se reemplaza al mover la barra o apretar un boton.
 *
 * El signo lo define el reloj (packages/audio/src/clock.ts) y el motor de
 * juicio: subir el offset mueve los golpes hacia temprano (puntos mas abajo
 * en el grafico de resultados), bajarlo hacia tarde. Lo mas comodo es el
 * boton "corregir offset" de la pantalla de resultados, que hace justo eso a
 * partir de la media medida.
 */
function crearControlDeOffset(aCalibrar: () => void): HTMLElement {
  let real = leerOffset();

  const botonMenos = crearBotonIcono('menos', 'Bajar el offset 1 ms');
  botonMenos.title = 'Bajar 1 ms (con Shift, 5 ms)';
  const botonMas = crearBotonIcono('mas', 'Subir el offset 1 ms');
  botonMas.title = 'Subir 1 ms (con Shift, 5 ms)';

  const { entrada, dato, control } = crearBarra({
    id: 'tetra-offset-valor',
    min: OFFSET_BARRA_MIN,
    max: OFFSET_BARRA_MAX,
    paso: 1,
    valor: offsetABarra(real),
    texto: formatearOffset(real),
    marcaCentro: true,
    menos: botonMenos,
    mas: botonMas,
  });

  function fijarOffset(valor: number): void {
    real = valor;
    entrada.value = String(offsetABarra(valor));
    dato.textContent = formatearOffset(valor);
    guardarOffset(valor);
  }

  entrada.addEventListener('input', () => fijarOffset(Number(entrada.value)));
  entrada.addEventListener('dblclick', () => fijarOffset(0));
  // Shift+flecha mueve 5 ms; sin Shift el input nativo ya mueve un paso (1 ms).
  entrada.addEventListener('keydown', (e) => {
    if (!e.shiftKey) return;
    const sentido =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -1
          : null;
    if (sentido === null) return;
    e.preventDefault();
    fijarOffset(pasoDeOffset(real, deltaDeOffset(sentido, true)));
  });
  botonMenos.addEventListener('click', (e) => {
    fijarOffset(pasoDeOffset(real, deltaDeOffset(-1, e.shiftKey)));
  });
  botonMas.addEventListener('click', (e) => {
    fijarOffset(pasoDeOffset(real, deltaDeOffset(1, e.shiftKey)));
  });

  const fila = crearFila({
    nombre: 'Offset',
    idControl: entrada.id,
    ayuda:
      'Offset en ms. Si en los resultados pegas temprano (puntos abajo), bajalo; si pegas tarde (arriba), subilo. Doble clic en la barra lo vuelve a 0.',
    controles: [control],
  });
  // T-060: "Calibrar" mide el offset sin cancion. Va pegado al nombre y no en los
  // controles, para que las cinco barras sigan midiendo y alineandose igual.
  const calibrar = document.createElement('button');
  calibrar.type = 'button';
  calibrar.className = 'tetra-ajustes-calibrar';
  calibrar.textContent = 'Calibrar';
  calibrar.title = 'Mide tu offset con un metrónomo, sin necesitar una canción.';
  calibrar.addEventListener('click', aCalibrar);
  fila.querySelector('.tetra-ajustes-fila-nombre')?.after(calibrar);
  return fila;
}

/**
 * Control de velocidad de caida (T-008; T-058 lo pasa a barra): de 1 a 12,
 * guarda al mover. Muestra el concepto natural del jugador (mas numero = mas
 * rapido = menos notas en pantalla a la vez), no los ms de `scrollDuration`:
 * ese numero se guarda tal cual en localStorage y game.ts lo convierte a ms
 * recien al arrancar la partida, con `velocidadAScrollDuration`. Junto a la
 * barra queda, en vivo, el nivel y lo que dura una nota en cruzar la pista.
 */
function crearControlDeVelocidad(): HTMLElement {
  const inicial = leerVelocidad();
  const { entrada, dato, control } = crearBarra({
    id: 'tetra-velocidad-valor',
    min: VELOCIDAD_MIN,
    max: VELOCIDAD_MAX,
    paso: 1,
    valor: inicial,
    texto: formatearVelocidad(inicial),
  });
  entrada.addEventListener('input', () => {
    const velocidad = Number(entrada.value);
    guardarVelocidad(velocidad);
    dato.textContent = formatearVelocidad(velocidad);
  });

  return crearFila({
    nombre: 'Velocidad',
    idControl: entrada.id,
    ayuda: `Más alto, las notas caen más rápido y hay menos en pantalla a la vez (de ${VELOCIDAD_MIN} a ${VELOCIDAD_MAX}). El dato es lo que tarda una nota en cruzar la pista.`,
    controles: [control],
  });
}

/** Volumen de la musica (T-053): deslizador 0 a 100 %, compartido con el menu y el preview. */
function crearControlDeVolumen(): HTMLElement {
  const { entrada, control } = crearDeslizador('tetra-volumen-valor', leerVolumen(), (fraccion) => {
    guardarVolumen(fraccion);
  });
  return crearFila({
    nombre: 'Volumen',
    idControl: entrada.id,
    ayuda: 'Volumen de la música en la partida, el menú y la previa de las canciones.',
    controles: [control],
  });
}

/** Volumen de los efectos (T-027): el mismo deslizador que el de la musica, con su clave propia. */
function crearControlDeEfectos(): HTMLElement {
  const { entrada, control } = crearDeslizador('tetra-efectos-valor', leerVolumenEfectos(), (fraccion) => {
    guardarVolumenEfectos(fraccion);
  });
  return crearFila({
    nombre: 'Efectos',
    idControl: entrada.id,
    ayuda: 'Volumen del sonido de cada golpe en la partida.',
    controles: [control],
  });
}

/**
 * Suena el hitsound una vez, con el volumen de efectos guardado. Usa un
 * contexto propio que se cierra apenas termina el sonido (no deja un
 * AudioContext abierto en una pantalla de ajustes). Pasa por
 * `connect(ctx.destination)` como todo el audio de la app, asi el silenciador
 * de desarrollo (`tetra:mudo`) lo alcanza igual.
 */
function probarHitsound(tipo: TipoHitsound): void {
  const ctx = new AudioContext();
  const ganancia = ctx.createGain();
  ganancia.gain.value = gananciaDeVolumen(leerVolumenEfectos());
  ganancia.connect(ctx.destination);
  const source = reproducirHitsound(ctx, crearHitsound(ctx, tipo), ctx.currentTime, ganancia);
  source.onended = () => {
    void ctx.close().catch(() => {
      // best-effort: si el navegador ya lo cerro no hay nada que hacer.
    });
  };
}

/** Tipo de hitsound (T-027): al cambiarlo suena una vez, para elegir de oido. */
function crearControlDeSonidoDeGolpe(): HTMLElement {
  const selector = document.createElement('select');
  selector.id = 'tetra-hitsound-tipo';
  for (const tipo of TIPOS_HITSOUND) {
    const opcion = document.createElement('option');
    opcion.value = tipo;
    opcion.textContent = NOMBRES_DE_HITSOUND[tipo];
    selector.appendChild(opcion);
  }
  selector.value = leerTipoHitsound();
  selector.addEventListener('change', () => {
    if (!esTipoHitsound(selector.value)) return;
    guardarTipoHitsound(selector.value);
    probarHitsound(selector.value);
  });
  return crearFila({
    nombre: 'Golpe',
    idControl: selector.id,
    ayuda: 'Sonido de cada golpe. Al cambiarlo suena una vez.',
    controles: [selector],
  });
}

const NOMBRES_COLUMNA = ['Columna 1', 'Columna 2', 'Columna 3', 'Columna 4'] as const;

/**
 * Control de remapeo de teclas (T-012, "Parte B"). Cuatro casilleros, uno
 * por columna: un clic entra en modo "pulsa una tecla", la siguiente tecla
 * pulsada (por su `e.code`, ver keymap.ts) se guarda, y Escape cancela la
 * captura sin guardar nada.
 *
 * El listener de `keydown` que escucha la captura se agrega a `window`
 * SOLO mientras hay un casillero capturando, y se saca apenas termina la
 * captura (se asigne algo, se cancele con Escape, o falle la validacion):
 * asi no hace falta un gancho de "destruir esta pantalla" que el router no
 * ofrece (ver router.ts, cada pantalla simplemente reemplaza el contenido
 * de `contenedor` en la siguiente navegacion). Un listener de vida entera
 * de la pantalla, sin ese cuidado, se iria acumulando cada vez que el
 * jugador entra a ajustes y nunca se limpiaria solo.
 */
function crearControlDeTeclas(onError: (mensaje: string) => void): HTMLElement {
  const grilla = document.createElement('div');
  grilla.className = 'tetra-ajustes-teclas-grilla';

  let mapa: KeyMap = leerKeyMap();
  let columnaCapturando: number | null = null;

  const botones: HTMLButtonElement[] = NOMBRES_COLUMNA.map((_nombre, indice) => {
    const casillero = document.createElement('div');
    // Columnas 1 y 2 (las interiores) con detalle en acento y 0 y 3 en
    // tinta, igual que la pista (T-020).
    const interior = indice === 1 || indice === 2;
    casillero.className = interior
      ? 'tetra-tecla-casillero tetra-tecla-casillero-interior'
      : 'tetra-tecla-casillero';

    const etiqueta = document.createElement('span');
    etiqueta.className = 'tetra-tecla-etiqueta';
    etiqueta.setAttribute('aria-hidden', 'true');
    etiqueta.textContent = `Col. ${indice + 1}`;
    casillero.appendChild(etiqueta);

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'tetra-tecla-boton';
    boton.addEventListener('click', () => empezarCaptura(indice));
    casillero.appendChild(boton);

    grilla.appendChild(casillero);
    return boton;
  });

  function actualizarBotones(): void {
    botones.forEach((boton, indice) => {
      const capturandoEsta = columnaCapturando === indice;
      // mapa[indice] siempre existe: `botones` tiene exactamente los mismos
      // 4 elementos que `mapa` (ver el `.map` que arma `botones` arriba),
      // pero noUncheckedIndexedAccess no puede probarlo con un indice que
      // no es un literal.
      const nombreTecla = nombreLegibleDeCodigo(mapa[indice]!);
      boton.textContent = capturandoEsta ? 'Pulsa una tecla...' : nombreTecla;
      boton.setAttribute(
        'aria-label',
        `${NOMBRES_COLUMNA[indice]}: ${capturandoEsta ? 'pulsa una tecla' : nombreTecla}`,
      );
      boton.classList.toggle('tetra-tecla-boton-capturando', capturandoEsta);
      // Mientras se captura una columna, las otras tres quedan inhabilitadas:
      // evita que dos casilleros entren en modo captura a la vez, lo que
      // volveria ambiguo a que columna va la proxima tecla pulsada.
      boton.disabled = columnaCapturando !== null && !capturandoEsta;
    });
  }

  function manejarKeydownDeCaptura(evento: Event): void {
    const e = evento as KeyboardEvent;
    const columna = columnaCapturando;
    if (columna === null) return;
    e.preventDefault(); // no dejar que la tecla capturada dispare nada mas de la pagina

    if (e.code === 'Escape') {
      terminarCaptura();
      return;
    }

    // Importante: `mapa` (y el mensaje de error) se actualizan ANTES de
    // llamar a terminarCaptura(), porque terminarCaptura() es quien llama a
    // actualizarBotones() para volver a pintar los casilleros. Si se
    // actualizara despues, el repintado de terminarCaptura() todavia veria
    // el `mapa` viejo y el casillero se quedaria mostrando la tecla
    // anterior hasta el proximo repintado (el bug se vio a mano probando
    // esto en el navegador: el localStorage quedaba bien, la UI no).
    const resultado = intentarAsignarCodigo(mapa, columna, e.code);
    if (!resultado.permitido) {
      if (resultado.motivo === 'escape-prohibido') {
        onError('Escape no se puede asignar: es la tecla para salir de la partida.');
      } else {
        const indiceExistente = mapa.indexOf(e.code);
        const nombreColumnaExistente = NOMBRES_COLUMNA[indiceExistente] ?? 'otra columna';
        onError(`Esa tecla ya está asignada a ${nombreColumnaExistente}.`);
      }
      terminarCaptura();
      return;
    }
    onError('');
    mapa = resultado.mapaNuevo;
    guardarKeyMap(mapa);
    terminarCaptura();
  }

  function empezarCaptura(columna: number): void {
    if (columnaCapturando !== null) return; // ya hay una captura en curso
    onError(''); // limpia un error de un intento anterior, si quedo alguno
    columnaCapturando = columna;
    actualizarBotones();
    window.addEventListener('keydown', manejarKeydownDeCaptura);
  }

  function terminarCaptura(): void {
    window.removeEventListener('keydown', manejarKeydownDeCaptura);
    columnaCapturando = null;
    actualizarBotones();
  }

  const botonReset = document.createElement('button');
  botonReset.type = 'button';
  botonReset.className = 'tetra-tecla-reset';
  botonReset.textContent = 'Restablecer';
  botonReset.title = 'Volver a D, F, J, K';
  botonReset.addEventListener('click', () => {
    if (columnaCapturando !== null) terminarCaptura();
    mapa = CODIGOS_TECLAS_POR_DEFECTO;
    guardarKeyMap(mapa);
    onError('');
    actualizarBotones();
  });

  actualizarBotones();

  const pie = document.createElement('div');
  pie.className = 'tetra-ajustes-teclas-pie';
  pie.appendChild(botonReset);

  const fila = crearFila({
    ayuda: 'Clic en una columna y pulsa la tecla nueva. Escape cancela sin guardar.',
    controles: [grilla, pie],
    apilada: true,
  });
  return fila;
}

/**
 * Interruptor con etiqueta corta (T-012, "Parte C"; T-053 lo generaliza). Un
 * `<input type=checkbox>` restilado como switch (ver style.css,
 * `.tetra-toggle`): accesible, funciona con teclado y lector de pantalla.
 */
function crearInterruptor(
  id: string,
  nombre: string,
  ayuda: string,
  inicial: boolean,
  alCambiar: (encendido: boolean) => void,
): HTMLElement {
  const etiqueta = document.createElement('label');
  etiqueta.className = 'tetra-toggle';

  const casilla = document.createElement('input');
  casilla.type = 'checkbox';
  casilla.id = id;
  casilla.checked = inicial;
  casilla.addEventListener('change', () => alCambiar(casilla.checked));
  etiqueta.appendChild(casilla);

  return crearFila({ nombre, idControl: id, ayuda, controles: [etiqueta] });
}

const ANCHO_MINIATURA = 112;
const ALTO_MINIATURA = 84;

/** Canvas de miniatura nitido: el lienzo se escala por devicePixelRatio y se dibuja en coordenadas logicas. */
function crearLienzoDeMiniatura(
  dibujar: (ctx: CanvasRenderingContext2D, ancho: number, alto: number) => void,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'tetra-skin-miniatura';
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(ANCHO_MINIATURA * dpr);
  canvas.height = Math.round(ALTO_MINIATURA * dpr);
  canvas.style.width = `${ANCHO_MINIATURA}px`;
  canvas.style.height = `${ALTO_MINIATURA}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
    dibujar(ctx, ANCHO_MINIATURA, ALTO_MINIATURA);
  }
  return canvas;
}

/**
 * Miniatura de una `.osk` importada: sus notas y receptores en los cuatro
 * carriles, con las imagenes que traiga (las que falten simplemente no se
 * dibujan: el motor las suple con rectangulos).
 */
async function dibujarMiniaturaDeOsk(
  ctx: CanvasRenderingContext2D,
  skin: SkinGuardada,
  ancho: number,
  alto: number,
): Promise<void> {
  const cw = ancho / 4;
  const claves = ['note1', 'note2', 'key1', 'key2'] as const;
  const imagenes = new Map<string, ImageBitmap>();
  for (const clave of claves) {
    const blob = skin.imagenes[clave];
    if (blob === undefined) continue;
    try {
      imagenes.set(clave, await createImageBitmap(blob));
    } catch {
      // una imagen ilegible se omite.
    }
  }
  const pegar = (clave: string, centroX: number, centroY: number): void => {
    const img = imagenes.get(clave);
    if (img === undefined) return;
    const escala = Math.min((cw * 0.86) / img.width, (alto * 0.2) / img.height);
    const w = img.width * escala;
    const h = img.height * escala;
    ctx.drawImage(img, centroX - w / 2, centroY - h / 2, w, h);
  };
  const interior = (col: number): boolean => col === 1 || col === 2;
  for (let col = 0; col < 4; col++) {
    const cx = col * cw + cw / 2;
    pegar(interior(col) ? 'note2' : 'note1', cx, alto * (col % 2 === 0 ? 0.35 : 0.55));
    pegar(interior(col) ? 'key2' : 'key1', cx, alto * 0.8);
  }
}

/**
 * Elegir skin (T-053): una grilla de tarjetas con miniatura. Primero las
 * cuatro propias de Tetra (T-050), despues una por cada `.osk` importado (con
 * su nombre) y al final una tarjeta "+" que abre el selector de archivos
 * `.osk`. La activa lleva borde en acento; elegir una la guarda al instante
 * y se usa desde la proxima partida.
 *
 * El `<input type=file>` nativo queda oculto (ver style.css,
 * `.tetra-input-archivo-oculto`) y se dispara con `.click()` desde la tarjeta.
 */
function crearControlDeSkin(onError: (mensaje: string) => void): HTMLElement {
  const grilla = document.createElement('div');
  grilla.className = 'tetra-skins-grilla';

  interface Tarjeta {
    seleccion: SeleccionDeSkin;
    boton: HTMLButtonElement;
  }
  const tarjetas: Tarjeta[] = [];
  /** Skins `.osk` que existen hoy en la base: la activa guardada que no este aca cae a la propia por defecto. */
  let idsOsk = new Set<string>();

  function seleccionVigente(): SeleccionDeSkin {
    const guardada = leerSeleccionDeSkin();
    if (guardada.tipo === 'osk' && !idsOsk.has(guardada.id)) {
      return { tipo: 'propia', id: CATALOGO_PROPIAS.porDefecto };
    }
    return guardada;
  }

  function marcarActiva(): void {
    const vigente = seleccionVigente();
    for (const tarjeta of tarjetas) {
      const activa = seleccionesIguales(tarjeta.seleccion, vigente);
      tarjeta.boton.classList.toggle('tetra-skin-activa', activa);
      tarjeta.boton.setAttribute('aria-pressed', String(activa));
    }
  }

  function crearTarjeta(
    seleccion: SeleccionDeSkin,
    nombre: string,
    lienzo: HTMLCanvasElement,
  ): HTMLButtonElement {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'tetra-skin';
    boton.title = nombre;
    boton.appendChild(lienzo);
    const rotulo = document.createElement('span');
    rotulo.className = 'tetra-skin-nombre';
    rotulo.textContent = nombre;
    boton.appendChild(rotulo);
    boton.addEventListener('click', () => {
      guardarSeleccionDeSkin(seleccion);
      marcarActiva();
    });
    tarjetas.push({ seleccion, boton });
    return boton;
  }

  for (const propia of SKINS_PROPIAS) {
    const id: IdSkinPropia = propia.id;
    const lienzo = crearLienzoDeMiniatura((ctx, ancho, alto) => {
      dibujarMiniaturaDeSkin(ctx, id, ancho, alto);
    });
    grilla.appendChild(crearTarjeta({ tipo: 'propia', id }, propia.nombre, lienzo));
  }

  // Tarjeta "+": importar una .osk.
  const entradaArchivo = document.createElement('input');
  entradaArchivo.type = 'file';
  entradaArchivo.accept = '.osk';
  entradaArchivo.id = 'tetra-skin-archivo';
  entradaArchivo.className = 'tetra-input-archivo-oculto';

  const botonImportar = document.createElement('button');
  botonImportar.type = 'button';
  botonImportar.className = 'tetra-skin tetra-skin-importar';
  botonImportar.title = 'Importar una skin .osk de osu!mania. Si le falta alguna imagen, se suple con la skin base.';
  botonImportar.setAttribute('aria-label', 'Importar skin .osk');
  const mas = document.createElement('span');
  mas.className = 'tetra-skin-mas';
  mas.setAttribute('aria-hidden', 'true');
  mas.textContent = '+';
  botonImportar.appendChild(mas);
  botonImportar.addEventListener('click', () => entradaArchivo.click());
  grilla.appendChild(botonImportar);

  // Repuebla las tarjetas de `.osk` con lo que hay en IndexedDB (que no tiene
  // notificaciones de cambio): se llama al armar el control y tras cada importacion.
  async function refrescarOsk(): Promise<void> {
    let skins: SkinGuardada[] = [];
    try {
      skins = await listarSkins();
    } catch {
      // sin base de datos solo quedan las propias.
    }
    for (let i = tarjetas.length - 1; i >= 0; i--) {
      const tarjeta = tarjetas[i]!;
      if (tarjeta.seleccion.tipo === 'osk') {
        tarjeta.boton.remove();
        tarjetas.splice(i, 1);
      }
    }
    idsOsk = new Set(skins.map((skin) => skin.id));
    for (const skin of skins) {
      const lienzo = crearLienzoDeMiniatura((ctx, ancho, alto) => {
        void dibujarMiniaturaDeOsk(ctx, skin, ancho, alto);
      });
      const boton = crearTarjeta({ tipo: 'osk', id: skin.id }, skin.nombre, lienzo);
      grilla.insertBefore(boton, botonImportar);
    }
    marcarActiva();
  }
  marcarActiva();
  void refrescarOsk();

  entradaArchivo.addEventListener('change', () => {
    const archivo = entradaArchivo.files?.[0];
    entradaArchivo.value = '';
    if (!archivo) return;
    void (async () => {
      try {
        const id = await importarOsk(archivo);
        guardarSeleccionDeSkin({ tipo: 'osk', id });
        await refrescarOsk();
      } catch (error) {
        onError(mensajeDeErrorDeCarga(error));
      }
    })();
  });

  return crearFila({
    ayuda: 'Skin de las notas y los receptores. Se usa desde la próxima partida.',
    controles: [grilla, entradaArchivo],
    apilada: true,
  });
}

/** Atenuacion del fondo de la cancion detras de la pista (0 a 100 %, 80 % por defecto). */
function crearControlDeAtenuacion(): HTMLElement {
  const { entrada, control } = crearDeslizador('tetra-atenuacion-valor', leerAtenuacion(), (fraccion) => {
    guardarAtenuacion(fraccion);
  });
  return crearFila({
    nombre: 'Atenuar fondo',
    idControl: entrada.id,
    ayuda:
      'Cuánto se oscurece la imagen o el video de fondo de la canción detrás de la pista. Más atenuación, la pista se lee mejor.',
    controles: [control],
  });
}

/**
 * Modo presentacion (T-037): boton para entrar y salir (pantalla completa, sin
 * header ni textos de ayuda, cursor que se oculta) y la lista "Antes de
 * presentar", que solo recuerda y no bloquea nada. T-053: la lista va
 * plegada para no sumar texto a la pantalla.
 */
function crearControlDePresentacion(aCalibrar: () => void): HTMLElement {
  const boton = document.createElement('button');
  boton.type = 'button';
  const pintar = (): void => {
    boton.textContent = presentacionActiva() ? 'Salir' : 'Entrar';
  };
  pintar();
  boton.addEventListener('click', () => {
    void alternarPresentacion().then(pintar);
  });

  const lista = document.createElement('ul');
  lista.className = 'tetra-presentacion-lista';
  const estado = { ...leerChecklist() };
  for (const paso of PASOS_PREVIOS) {
    const item = document.createElement('li');
    const etiqueta = document.createElement('label');
    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.checked = estado[paso.id];
    casilla.addEventListener('change', () => {
      (estado as Record<PasoPrevio, boolean>)[paso.id] = casilla.checked;
      guardarChecklist(estado);
    });
    etiqueta.append(casilla, document.createTextNode(paso.texto));
    item.appendChild(etiqueta);
    // T-060: el paso de calibrar el offset lleva a la pantalla que lo hace.
    if (paso.id === 'offset') {
      const ir = document.createElement('button');
      ir.type = 'button';
      ir.className = 'tetra-ajustes-calibrar';
      ir.textContent = 'Calibrar';
      ir.addEventListener('click', aCalibrar);
      item.appendChild(ir);
    }
    lista.appendChild(item);
  }

  const fila = crearFila({
    nombre: 'Presentación',
    ayuda: 'Pantalla completa, sin header ni avisos, y el cursor se oculta solo. Atajo: F.',
    controles: [boton],
  });
  const pliegue = document.createElement('details');
  pliegue.className = 'tetra-ajustes-pliegue';
  const resumen = document.createElement('summary');
  resumen.textContent = 'Antes de presentar';
  pliegue.append(resumen, lista);
  const envoltorio = document.createElement('div');
  envoltorio.className = 'tetra-ajustes-grupo';
  envoltorio.append(fila, pliegue);
  return envoltorio;
}

/** Baja `blob` como archivo `nombre`: un enlace temporal con `download`, sin tocar la pagina. */
function descargarArchivo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // El navegador necesita un instante para empezar la descarga antes de soltar la URL.
  // eslint-disable-next-line no-restricted-globals -- solo libera memoria tras una descarga; no mide tiempo de juego (CLAUDE.md, "El reloj es el audio").
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Copia de seguridad (T-042): dos botones y una linea de estado en mono. La
 * linea muestra cuanto ocupa la biblioteca y, tras exportar o importar, lo que
 * paso en una sola frase; los errores van al aviso de arriba. Importar mezcla
 * con lo que ya hay y nunca pisa canciones ni skins; los ajustes solo se
 * reemplazan si el respaldo traeria valores distintos a los actuales Y la
 * persona acepta (si no hay nada que pisar, se restauran sin preguntar).
 *
 * `rearmar` vuelve a dibujar la pantalla con un texto de estado (se usa cuando
 * se restauraron ajustes, para que los controles muestren los valores nuevos).
 */
function crearControlDeRespaldo(
  onError: (mensaje: string) => void,
  rearmar: (estado: string) => void,
  estadoInicial: string,
): HTMLElement {
  const botonExportar = document.createElement('button');
  botonExportar.type = 'button';
  botonExportar.id = 'tetra-respaldo-exportar';
  botonExportar.textContent = 'Exportar respaldo';
  botonExportar.title = 'Baja un zip con tus canciones, skins, récords y ajustes.';

  const botonImportar = document.createElement('button');
  botonImportar.type = 'button';
  botonImportar.id = 'tetra-respaldo-importar';
  botonImportar.textContent = 'Importar respaldo';
  botonImportar.title =
    'Suma lo del respaldo a tu biblioteca. Lo que ya hay no se pisa; los ajustes solo si lo aceptas.';

  const entradaArchivo = document.createElement('input');
  entradaArchivo.type = 'file';
  entradaArchivo.accept = '.zip,application/zip';
  entradaArchivo.id = 'tetra-respaldo-archivo';
  entradaArchivo.className = 'tetra-input-archivo-oculto';

  const estado = document.createElement('span');
  estado.className = 'tetra-ajustes-estado';
  estado.setAttribute('role', 'status');
  estado.textContent = estadoInicial;
  estado.title = estadoInicial;
  /** Si ya se puso un resultado, la estimacion de almacenamiento (que llega tarde) no lo pisa. */
  let hayResultado = estadoInicial !== '';
  function decir(texto: string): void {
    hayResultado = true;
    estado.textContent = texto;
    estado.title = texto;
  }
  if (!hayResultado) {
    void estimarAlmacenamiento().then((uso) => {
      if (hayResultado) return;
      const texto = lineaDeAlmacenamiento(uso);
      estado.textContent = texto;
      estado.title = texto;
    });
  }

  function ocupado(valor: boolean): void {
    botonExportar.disabled = valor;
    botonImportar.disabled = valor;
  }

  botonExportar.addEventListener('click', () => {
    onError('');
    ocupado(true);
    decir('Armando el respaldo...');
    void (async () => {
      try {
        const zip = await crearRespaldo();
        const nombre = nombreDeArchivoDeRespaldo(new Date());
        descargarArchivo(zip, nombre);
        decir(lineaDeExportacion(nombre, zip.size));
      } catch (error) {
        decir('');
        onError(`No se pudo exportar el respaldo: ${mensajeDeErrorDeCarga(error)}`);
      } finally {
        ocupado(false);
      }
    })();
  });

  botonImportar.addEventListener('click', () => entradaArchivo.click());

  entradaArchivo.addEventListener('change', () => {
    const archivo = entradaArchivo.files?.[0];
    entradaArchivo.value = '';
    if (!archivo) return;
    onError('');
    ocupado(true);
    decir('Leyendo el respaldo...');
    void (async () => {
      try {
        // Primero se lee y valida todo: si algo esta mal no se toca nada.
        const respaldo = await leerRespaldo(archivo);
        const sobrescribirAjustes =
          !ajustesPisarianLocales(respaldo.ajustes, leerAjustesLocales()) ||
          window.confirm('El respaldo trae ajustes distintos a los actuales. ¿Reemplazarlos?');
        const resumen = await restaurarRespaldo(respaldo, { sobrescribirAjustes });
        window.dispatchEvent(new CustomEvent(EVENTO_BIBLIOTECA_CAMBIO));
        const texto = lineaDeRestauracion(resumen);
        if (resumen.ajustesRestaurados > 0) {
          rearmar(texto);
        } else {
          decir(texto);
        }
      } catch (error) {
        decir('');
        onError(
          error instanceof ErrorDeRespaldo
            ? error.message
            : `No se pudo restaurar el respaldo: ${mensajeDeErrorDeCarga(error)}`,
        );
      } finally {
        ocupado(false);
      }
    })();
  });

  const fila = crearFila({
    ayuda: 'Copia de seguridad de la biblioteca: canciones, skins, récords y ajustes, en un zip.',
    controles: [botonExportar, botonImportar, entradaArchivo],
  });
  const envoltorio = document.createElement('div');
  envoltorio.className = 'tetra-ajustes-grupo tetra-ajustes-respaldo';
  envoltorio.append(fila, estado);
  return envoltorio;
}

/** Gancho de navegacion que le pasa el router (ver router.ts). */
export interface OpcionesAjustes {
  /** Volver al menu. Es la unica salida de esta pantalla (ver el ticket, "Cada pantalla tiene como volver"). */
  aMenu: () => void;
  /** T-060: abrir "Calibrar offset", que mide el offset global sin cancion y vuelve aca. */
  aCalibrarOffset: () => void;
}

/**
 * Muestra la pantalla de ajustes dentro de `contenedor`, reemplazando lo
 * que hubiera. Cinco tarjetas numeradas en una rejilla (T-023, T-053, T-042):
 * Juego (offset, velocidad, volumen, efectos, golpe), Teclas, Apariencia (skin, atenuacion,
 * video, FPS), Presentacion y Biblioteca (copia de seguridad).
 */
export function mostrarAjustes(
  contenedor: HTMLElement,
  opciones: OpcionesAjustes,
  /** Texto inicial de la linea de estado de Biblioteca (lo usa la propia pantalla al redibujarse tras restaurar ajustes). */
  estadoDeBiblioteca = '',
): void {
  contenedor.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'tetra-ajustes';

  const encabezado = document.createElement('div');
  encabezado.className = 'tetra-ajustes-encabezado';

  const titulo = document.createElement('h1');
  titulo.textContent = 'Ajustes';
  encabezado.appendChild(titulo);

  const botonVolver = document.createElement('button');
  botonVolver.type = 'button';
  botonVolver.className = 'tetra-boton-volver';
  botonVolver.textContent = '← Menú';
  botonVolver.addEventListener('click', () => opciones.aMenu());
  encabezado.appendChild(botonVolver);

  panel.appendChild(encabezado);

  const mensajeError = document.createElement('p');
  mensajeError.className = 'tetra-ajustes-error';
  mensajeError.setAttribute('role', 'alert');
  function mostrarError(mensaje: string): void {
    mensajeError.textContent = mensaje;
  }

  // El mensaje de error va arriba de las tarjetas: asi se ve sin importar
  // cuanto haya que bajar para llegar a la tarjeta que lo causo.
  panel.appendChild(mensajeError);

  const rejilla = document.createElement('div');
  rejilla.className = 'tetra-ajustes-rejilla';
  rejilla.appendChild(
    crearSeccion(
      1,
      'Juego',
      'juego',
      // T-058: las cuatro barras (mismo riel y misma columna de valor) y el
      // selector del golpe, una fila cada uno.
      crearControlDeOffset(opciones.aCalibrarOffset),
      crearControlDeVelocidad(),
      crearControlDeVolumen(),
      crearControlDeEfectos(),
      crearControlDeSonidoDeGolpe(),
    ),
  );
  rejilla.appendChild(crearSeccion(2, 'Teclas', 'teclas', crearControlDeTeclas(mostrarError)));
  rejilla.appendChild(
    crearSeccion(
      3,
      'Apariencia',
      'apariencia',
      crearControlDeSkin(mostrarError),
      // Los seis controles de debajo de las skins van en una rejilla de tres columnas (ver ajustes.css).
      agruparEnFila(
        crearControlDeAtenuacion(),
        crearInterruptor(
          'tetra-video-casilla',
          'Video de fondo',
          'Reproduce el video de fondo de la canción, si trae uno. Apagado, se ve solo la imagen.',
          leerVideoDeFondo(),
          guardarVideoDeFondo,
        ),
        crearInterruptor(
          'tetra-fps-casilla',
          'Mostrar FPS',
          'Muestra los cuadros por segundo (promedio de medio segundo) y el cuadro más lento de ese tramo durante la partida.',
          leerMostrarFps(),
          guardarMostrarFps,
        ),
        // T-056: los contadores de la partida, la segunda fila de la misma rejilla.
        crearInterruptor(
          'tetra-teclas-casilla',
          'Teclas',
          'Cajitas con las pulsaciones de cada tecla, bajo la pista.',
          leerMostrarTeclas(),
          guardarMostrarTeclas,
        ),
        crearInterruptor(
          'tetra-juicios-casilla',
          'Juicios',
          'Cuántas notas llevas de cada juicio, al costado de la pista.',
          leerMostrarJuicios(),
          guardarMostrarJuicios,
        ),
        crearInterruptor(
          'tetra-barra-error-casilla',
          'Barra de error',
          'Una marca por golpe que muestra si pegaste temprano o tarde, bajo la línea de juicio.',
          leerMostrarBarraDeError(),
          guardarMostrarBarraDeError,
        ),
      ),
    ),
  );
  rejilla.appendChild(
    crearSeccion(
      4,
      'Presentación',
      'presentacion',
      crearControlDePresentacion(opciones.aCalibrarOffset),
    ),
  );
  rejilla.appendChild(
    crearSeccion(
      5,
      'Biblioteca',
      'biblioteca',
      crearControlDeRespaldo(
        mostrarError,
        (estado) => mostrarAjustes(contenedor, opciones, estado),
        estadoDeBiblioteca,
      ),
    ),
  );
  panel.appendChild(rejilla);

  contenedor.appendChild(panel);
}
