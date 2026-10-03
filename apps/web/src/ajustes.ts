// T-011: pantalla de ajustes propia. Los controles (offset, velocidad,
// skin) existian desde T-007/T-008/T-009 pero vivian sueltos dentro de la
// pantalla del cargador de desarrollo (T-006, eliminada en T-011, ver el
// ticket, "el problema que resuelve": todo aplastado en un solo lugar);
// esta pantalla es simplemente esos mismos tres controles, con la misma
// logica de persistencia (offset.ts, velocidad.ts, skin.ts) y el mismo
// comportamiento de siempre, movidos a su propio lugar en la navegacion.
//
// T-012 "Pulir ajustes" suma tres cosas mas (ver el ticket): remapeo de
// teclas (keymap.ts + teclas.ts), el interruptor de FPS/ms (graficos.ts), y
// el restilado de todos los controles con los tokens de tokens.css. Tambien
// reorganiza la pantalla en secciones con titulo: Juego, Teclas, Graficos,
// Apariencia (ver el ticket, "Parte D", ultimo parrafo).

import { importarOsk, listarSkins, type SkinGuardada } from '@tetra/storage';
import { CODIGOS_TECLAS_POR_DEFECTO } from '@tetra/engine';
import { mensajeDeErrorDeCarga } from './cargador-logica.js';
import { guardarOffset, leerOffset } from './offset.js';
import { guardarSkinActiva, leerSkinActiva } from './skin.js';
import { guardarMostrarFps, leerMostrarFps } from './graficos.js';
import { intentarAsignarCodigo, leerKeyMap, guardarKeyMap, type KeyMap } from './keymap.js';
import { nombreLegibleDeCodigo } from './teclas.js';
import {
  VELOCIDAD_MAX,
  VELOCIDAD_MIN,
  clampVelocidad,
  guardarVelocidad,
  leerVelocidad,
  velocidadAScrollDuration,
} from './velocidad.js';

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
  /** Nombre del ajuste (a la izquierda, en `--tinta`). Sin nombre, la fila es solo control. */
  nombre?: string;
  /** `id` del control al que apunta el `<label>` del nombre. Sin `id`, el nombre es un `<span>`. */
  idControl?: string;
  /** Parrafos de ayuda, debajo del nombre (en `--tinta-2`, chica). */
  ayudas?: HTMLElement[];
  /** Lo que va a la derecha de la fila. */
  controles: HTMLElement[];
  /** El control ocupa todo el ancho debajo del texto (teclas, skin) en vez de ir a la derecha. */
  apilada?: boolean;
}

/**
 * Fila de ajuste consistente (T-023): texto a la izquierda (nombre y ayuda)
 * y control(es) a la derecha, con el mismo alto de control en todas.
 */
function crearFila(opciones: OpcionesFila): HTMLElement {
  const fila = document.createElement('div');
  fila.className = opciones.apilada
    ? 'tetra-ajustes-fila tetra-ajustes-fila-apilada'
    : 'tetra-ajustes-fila';

  const ayudas = opciones.ayudas ?? [];
  if (opciones.nombre !== undefined || ayudas.length > 0) {
    const texto = document.createElement('div');
    texto.className = 'tetra-ajustes-fila-texto';
    if (opciones.nombre !== undefined) {
      const nombre = document.createElement(opciones.idControl !== undefined ? 'label' : 'span');
      nombre.className = 'tetra-ajustes-fila-nombre';
      nombre.textContent = opciones.nombre;
      if (nombre instanceof HTMLLabelElement && opciones.idControl !== undefined) {
        nombre.htmlFor = opciones.idControl;
      }
      texto.appendChild(nombre);
    }
    for (const ayuda of ayudas) {
      texto.appendChild(ayuda);
    }
    fila.appendChild(texto);
  }

  const controles = document.createElement('div');
  controles.className = 'tetra-ajustes-fila-control';
  for (const control of opciones.controles) {
    controles.appendChild(control);
  }
  fila.appendChild(controles);
  return fila;
}

/** Botones de mas y menos pegados al input numerico: un solo control segmentado. */
function crearSegmentado(
  botonMenos: HTMLElement,
  entrada: HTMLElement,
  botonMas: HTMLElement,
): HTMLElement {
  const grupo = document.createElement('div');
  grupo.className = 'tetra-ajustes-segmentado';
  grupo.appendChild(botonMenos);
  grupo.appendChild(entrada);
  grupo.appendChild(botonMas);
  return grupo;
}

const PASO_OFFSET_MS = 1;

/**
 * Control de calibracion de offset (T-007, "Parte B"): numero editable en
 * ms mas botones de +-1ms. Se lee de localStorage al armar el control y se
 * guarda ahi mismo en cada cambio; game.ts lo vuelve a leer al arrancar la
 * proxima partida y se lo pasa al reloj como `ClockOptions.userOffset`.
 *
 * El signo lo define el reloj (packages/audio/src/clock.ts) y el motor de
 * juicio: subir el offset mueve los golpes hacia temprano (puntos mas abajo
 * en el grafico de resultados), bajarlo hacia tarde. Lo mas comodo es el
 * boton "corregir segun esta partida" de la pantalla de resultados, que
 * hace justo eso a partir de la media medida.
 */
function crearControlDeOffset(): HTMLElement {
  const botonMenos = document.createElement('button');
  botonMenos.type = 'button';
  botonMenos.textContent = `-${PASO_OFFSET_MS} ms`;

  const entrada = document.createElement('input');
  entrada.type = 'number';
  entrada.id = 'tetra-offset-valor';
  entrada.className = 'tetra-ajustes-numero';
  entrada.step = String(PASO_OFFSET_MS);
  entrada.value = String(leerOffset());

  const botonMas = document.createElement('button');
  botonMas.type = 'button';
  botonMas.textContent = `+${PASO_OFFSET_MS} ms`;

  const ayuda = document.createElement('p');
  ayuda.className = 'tetra-ajustes-ayuda';
  ayuda.textContent =
    'Si en los resultados pegas temprano (puntos abajo), baja el offset; si pegas tarde (arriba), subilo.';

  function fijarOffset(valor: number): void {
    entrada.value = String(valor);
    guardarOffset(valor);
  }

  botonMenos.addEventListener('click', () => {
    fijarOffset((Number(entrada.value) || 0) - PASO_OFFSET_MS);
  });
  botonMas.addEventListener('click', () => {
    fijarOffset((Number(entrada.value) || 0) + PASO_OFFSET_MS);
  });
  entrada.addEventListener('change', () => {
    const valor = Number(entrada.value);
    fijarOffset(Number.isFinite(valor) ? valor : 0);
  });

  return crearFila({
    nombre: 'Offset (ms)',
    idControl: 'tetra-offset-valor',
    ayudas: [ayuda],
    controles: [crearSegmentado(botonMenos, entrada, botonMas)],
  });
}

const PASO_VELOCIDAD = 1;

/**
 * Control de velocidad de caida (T-008, "Parte A"): numero entero con
 * botones de mas y menos, igual de forma que el control de offset de
 * arriba. Muestra el concepto natural del jugador (mas numero = mas rapido
 * = menos notas en pantalla a la vez), no los ms de `scrollDuration`: ese
 * numero se guarda tal cual en localStorage y game.ts lo convierte a ms
 * recien al arrancar la partida, con `velocidadAScrollDuration`.
 */
function crearControlDeVelocidad(): HTMLElement {
  const botonMenos = document.createElement('button');
  botonMenos.type = 'button';
  botonMenos.textContent = `-${PASO_VELOCIDAD}`;

  const entrada = document.createElement('input');
  entrada.type = 'number';
  entrada.id = 'tetra-velocidad-valor';
  entrada.className = 'tetra-ajustes-numero';
  entrada.step = String(PASO_VELOCIDAD);
  entrada.min = String(VELOCIDAD_MIN);
  entrada.max = String(VELOCIDAD_MAX);
  entrada.value = String(leerVelocidad());

  const botonMas = document.createElement('button');
  botonMas.type = 'button';
  botonMas.textContent = `+${PASO_VELOCIDAD}`;

  const ayuda = document.createElement('p');
  ayuda.className = 'tetra-ajustes-ayuda';

  function actualizarAyuda(velocidad: number): void {
    ayuda.textContent =
      `Mas alto, las notas caen mas rapido y hay menos en pantalla a la vez ` +
      `(rango ${VELOCIDAD_MIN} a ${VELOCIDAD_MAX}; ahora mismo: ${velocidadAScrollDuration(velocidad)}ms por nota).`;
  }
  actualizarAyuda(leerVelocidad());

  function fijarVelocidad(valor: number): void {
    const recortado = clampVelocidad(valor);
    entrada.value = String(recortado);
    guardarVelocidad(recortado);
    actualizarAyuda(recortado);
  }

  botonMenos.addEventListener('click', () => {
    fijarVelocidad((Number(entrada.value) || VELOCIDAD_MIN) - PASO_VELOCIDAD);
  });
  botonMas.addEventListener('click', () => {
    fijarVelocidad((Number(entrada.value) || VELOCIDAD_MIN) + PASO_VELOCIDAD);
  });
  entrada.addEventListener('change', () => {
    const valor = Number(entrada.value);
    fijarVelocidad(Number.isFinite(valor) ? valor : VELOCIDAD_MIN);
  });

  return crearFila({
    nombre: 'Velocidad',
    idControl: 'tetra-velocidad-valor',
    ayudas: [ayuda],
    controles: [crearSegmentado(botonMenos, entrada, botonMas)],
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
        onError(`Esa tecla ya esta asignada a ${nombreColumnaExistente}.`);
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
  botonReset.textContent = 'Volver a D, F, J, K';
  botonReset.addEventListener('click', () => {
    if (columnaCapturando !== null) terminarCaptura();
    mapa = CODIGOS_TECLAS_POR_DEFECTO;
    guardarKeyMap(mapa);
    onError('');
    actualizarBotones();
  });

  const ayuda = document.createElement('p');
  ayuda.className = 'tetra-ajustes-ayuda';
  ayuda.textContent = 'Clic en una columna y pulsa la tecla nueva. Escape cancela sin guardar.';

  actualizarBotones();

  const pie = document.createElement('div');
  pie.className = 'tetra-ajustes-teclas-pie';
  pie.appendChild(ayuda);
  pie.appendChild(botonReset);

  return crearFila({ controles: [grilla, pie], apilada: true });
}

/**
 * Interruptor de FPS/ms (T-012, "Parte C"). Un solo checkbox restilado
 * como interruptor (ver style.css, `.tetra-toggle`): no hay ningun otro
 * control de graficos a proposito (ver el ticket: nada de opciones de
 * "multithreading", el render del navegador corre en un solo hilo).
 */
function crearControlDeFps(): HTMLElement {
  const etiqueta = document.createElement('label');
  etiqueta.className = 'tetra-toggle';

  const casilla = document.createElement('input');
  casilla.type = 'checkbox';
  casilla.id = 'tetra-fps-casilla';
  casilla.checked = leerMostrarFps();
  casilla.addEventListener('change', () => {
    guardarMostrarFps(casilla.checked);
  });
  etiqueta.appendChild(casilla);

  const ayuda = document.createElement('p');
  ayuda.className = 'tetra-ajustes-ayuda';
  ayuda.textContent = 'Muestra los cuadros por segundo y los ms por cuadro durante la partida.';

  return crearFila({
    nombre: 'Mostrar FPS y ms',
    idControl: casilla.id,
    ayudas: [ayuda],
    controles: [etiqueta],
  });
}

/** Valor de `<option>` para "sin skin, rectangulos" (el default): no puede ser un SkinId real (crypto.randomUUID() nunca da string vacio). */
const OPCION_SIN_SKIN = '';

/**
 * Control de skins (T-009): elegir un `.osk` y un `<select>` para elegir
 * entre "sin skin (rectangulos)" y las skins ya importadas. La skin
 * elegida se persiste con apps/web/src/skin.ts; song-select.ts la vuelve a
 * leer al resolver las texturas antes de arrancar una partida.
 *
 * T-012 "Parte D": el `<input type=file>` nativo queda oculto (ver
 * style.css, `.tetra-input-archivo-oculto`) y se dispara con
 * `entradaArchivo.click()` desde un boton restilado: el "Choose File" gris
 * del navegador era justo lo que Arnold señalo que desentonaba.
 */
function crearControlDeSkin(onError: (mensaje: string) => void): HTMLElement {
  const select = document.createElement('select');
  select.id = 'tetra-skin-select';

  const entradaArchivo = document.createElement('input');
  entradaArchivo.type = 'file';
  entradaArchivo.accept = '.osk';
  entradaArchivo.id = 'tetra-skin-archivo';
  entradaArchivo.className = 'tetra-input-archivo-oculto';

  const botonImportar = document.createElement('button');
  botonImportar.type = 'button';
  botonImportar.textContent = 'Importar .osk...';
  botonImportar.addEventListener('click', () => entradaArchivo.click());

  const ayuda = document.createElement('p');
  ayuda.className = 'tetra-ajustes-ayuda';
  ayuda.textContent =
    'Opcional: importar un archivo .osk de skin de osu!mania. Sin skin (o si le ' +
    'falta alguna imagen), se ven los rectangulos de siempre.';

  // Nombre de la skin activa, visible debajo de la ayuda (T-023). Se lee
  // del <select>, que es lo que el jugador ve elegido.
  const activa = document.createElement('p');
  activa.className = 'tetra-ajustes-ayuda tetra-ajustes-skin-activa';

  function actualizarActiva(): void {
    const nombre = select.selectedOptions[0]?.textContent ?? '';
    activa.textContent = nombre === '' ? '' : 'Activa: ';
    if (nombre === '') return;
    const valor = document.createElement('span');
    valor.className = 'tetra-ajustes-valor';
    valor.textContent = nombre;
    activa.appendChild(valor);
  }

  // Repuebla el <select> con "sin skin" + las skins guardadas, y deja
  // seleccionada la que esta activa. Se llama al armar el control y de
  // nuevo cada vez que se importa una skin nueva: es la unica forma de que
  // el <select> refleje lo que hay en IndexedDB, que no tiene
  // notificaciones de cambio.
  async function refrescarLista(): Promise<void> {
    const skins: SkinGuardada[] = await listarSkins();
    const idActiva = leerSkinActiva();

    select.innerHTML = '';
    const opcionSinSkin = document.createElement('option');
    opcionSinSkin.value = OPCION_SIN_SKIN;
    opcionSinSkin.textContent = 'Sin skin (rectangulos)';
    select.appendChild(opcionSinSkin);

    for (const skin of skins) {
      const opcion = document.createElement('option');
      opcion.value = skin.id;
      opcion.textContent = skin.nombre;
      select.appendChild(opcion);
    }

    // Si la skin activa guardada ya no aparece entre las opciones (por
    // ejemplo, se borro la base de IndexedDB a mano entre una carga y la
    // otra), el <select> cae solo a la primera opcion ("sin skin"): no
    // hace falta un caso aparte para eso.
    select.value = idActiva ?? OPCION_SIN_SKIN;
    actualizarActiva();
  }
  void refrescarLista();

  select.addEventListener('change', () => {
    guardarSkinActiva(select.value === OPCION_SIN_SKIN ? null : select.value);
    actualizarActiva();
  });

  entradaArchivo.addEventListener('change', () => {
    const archivo = entradaArchivo.files?.[0];
    entradaArchivo.value = '';
    if (!archivo) return;
    void (async () => {
      try {
        const id = await importarOsk(archivo);
        await refrescarLista();
        select.value = id;
        guardarSkinActiva(id);
        actualizarActiva();
      } catch (error) {
        onError(mensajeDeErrorDeCarga(error));
      }
    })();
  });

  const controles = document.createElement('div');
  controles.className = 'tetra-ajustes-skin-controles';
  controles.appendChild(select);
  controles.appendChild(botonImportar);
  controles.appendChild(entradaArchivo);

  return crearFila({
    nombre: 'Skin',
    idControl: select.id,
    ayudas: [ayuda, activa],
    controles: [controles],
    apilada: true,
  });
}

/** Gancho de navegacion que le pasa el router (ver router.ts). */
export interface OpcionesAjustes {
  /** Volver al menu. Es la unica salida de esta pantalla (ver el ticket, "Cada pantalla tiene como volver"). */
  aMenu: () => void;
}

/**
 * Muestra la pantalla de ajustes dentro de `contenedor`, reemplazando lo
 * que hubiera. T-012 la organiza en secciones (ver el ticket, "Parte D"):
 * Juego (offset, velocidad), Teclas, Graficos (FPS), Apariencia (skin).
 * T-023 las presenta como cuatro tarjetas numeradas en una rejilla.
 */
export function mostrarAjustes(contenedor: HTMLElement, opciones: OpcionesAjustes): void {
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
  botonVolver.textContent = '← Menu';
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
    crearSeccion(1, 'Juego', 'juego', crearControlDeOffset(), crearControlDeVelocidad()),
  );
  rejilla.appendChild(crearSeccion(2, 'Teclas', 'teclas', crearControlDeTeclas(mostrarError)));
  rejilla.appendChild(crearSeccion(3, 'Graficos', 'graficos', crearControlDeFps()));
  rejilla.appendChild(crearSeccion(4, 'Apariencia', 'apariencia', crearControlDeSkin(mostrarError)));
  panel.appendChild(rejilla);

  contenedor.appendChild(panel);
}
