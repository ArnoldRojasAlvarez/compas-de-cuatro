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
 * Envuelve `titulo` + `hijos` en un `<section>` con su `<h2>` (ver el
 * ticket, "Parte D": "Ajustes queda organizado en secciones con titulo").
 * `claseModificador` da a cada seccion su propia clase (por ejemplo
 * `tetra-ajustes-seccion-teclas`) para que style.css pueda ajustar el
 * layout interno de cada una sin depender del orden de los hijos.
 */
function crearSeccion(titulo: string, claseModificador: string, ...hijos: HTMLElement[]): HTMLElement {
  const seccion = document.createElement('section');
  seccion.className = `tetra-ajustes-seccion tetra-ajustes-seccion-${claseModificador}`;

  const encabezado = document.createElement('h2');
  encabezado.className = 'tetra-ajustes-seccion-titulo';
  encabezado.textContent = titulo;
  seccion.appendChild(encabezado);

  for (const hijo of hijos) {
    seccion.appendChild(hijo);
  }
  return seccion;
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
  const seccion = document.createElement('div');
  seccion.className = 'tetra-ajustes-offset tetra-ajustes-control';

  const etiqueta = document.createElement('label');
  etiqueta.textContent = 'Offset (ms):';
  etiqueta.htmlFor = 'tetra-offset-valor';
  seccion.appendChild(etiqueta);

  const botonMenos = document.createElement('button');
  botonMenos.type = 'button';
  botonMenos.textContent = `-${PASO_OFFSET_MS} ms`;
  seccion.appendChild(botonMenos);

  const entrada = document.createElement('input');
  entrada.type = 'number';
  entrada.id = 'tetra-offset-valor';
  entrada.step = String(PASO_OFFSET_MS);
  entrada.value = String(leerOffset());
  seccion.appendChild(entrada);

  const botonMas = document.createElement('button');
  botonMas.type = 'button';
  botonMas.textContent = `+${PASO_OFFSET_MS} ms`;
  seccion.appendChild(botonMas);

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

  const envoltorio = document.createElement('div');
  envoltorio.className = 'tetra-ajustes-fila';
  envoltorio.appendChild(seccion);
  envoltorio.appendChild(ayuda);
  return envoltorio;
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
  const seccion = document.createElement('div');
  seccion.className = 'tetra-ajustes-velocidad tetra-ajustes-control';

  const etiqueta = document.createElement('label');
  etiqueta.textContent = 'Velocidad:';
  etiqueta.htmlFor = 'tetra-velocidad-valor';
  seccion.appendChild(etiqueta);

  const botonMenos = document.createElement('button');
  botonMenos.type = 'button';
  botonMenos.textContent = `-${PASO_VELOCIDAD}`;
  seccion.appendChild(botonMenos);

  const entrada = document.createElement('input');
  entrada.type = 'number';
  entrada.id = 'tetra-velocidad-valor';
  entrada.step = String(PASO_VELOCIDAD);
  entrada.min = String(VELOCIDAD_MIN);
  entrada.max = String(VELOCIDAD_MAX);
  entrada.value = String(leerVelocidad());
  seccion.appendChild(entrada);

  const botonMas = document.createElement('button');
  botonMas.type = 'button';
  botonMas.textContent = `+${PASO_VELOCIDAD}`;
  seccion.appendChild(botonMas);

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

  const envoltorio = document.createElement('div');
  envoltorio.className = 'tetra-ajustes-fila';
  envoltorio.appendChild(seccion);
  envoltorio.appendChild(ayuda);
  return envoltorio;
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
  const seccion = document.createElement('div');
  seccion.className = 'tetra-ajustes-teclas';

  const grilla = document.createElement('div');
  grilla.className = 'tetra-ajustes-teclas-grilla';
  seccion.appendChild(grilla);

  let mapa: KeyMap = leerKeyMap();
  let columnaCapturando: number | null = null;

  const botones: HTMLButtonElement[] = NOMBRES_COLUMNA.map((nombre, indice) => {
    const casillero = document.createElement('div');
    casillero.className = 'tetra-tecla-casillero';

    const etiqueta = document.createElement('span');
    etiqueta.className = 'tetra-tecla-etiqueta';
    etiqueta.textContent = nombre;
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
      boton.textContent = capturandoEsta ? 'Pulsa una tecla...' : nombreLegibleDeCodigo(mapa[indice]!);
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
  seccion.appendChild(botonReset);

  const ayuda = document.createElement('p');
  ayuda.className = 'tetra-ajustes-ayuda';
  ayuda.textContent = 'Clic en una columna y pulsa la tecla nueva. Escape cancela sin guardar.';
  seccion.appendChild(ayuda);

  actualizarBotones();

  const envoltorio = document.createElement('div');
  envoltorio.className = 'tetra-ajustes-fila';
  envoltorio.appendChild(seccion);
  return envoltorio;
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
  casilla.checked = leerMostrarFps();
  casilla.addEventListener('change', () => {
    guardarMostrarFps(casilla.checked);
  });
  etiqueta.appendChild(casilla);

  const texto = document.createElement('span');
  texto.textContent = 'Mostrar FPS y ms';
  etiqueta.appendChild(texto);

  const envoltorio = document.createElement('div');
  envoltorio.className = 'tetra-ajustes-fila';
  envoltorio.appendChild(etiqueta);
  return envoltorio;
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
  const seccion = document.createElement('div');
  seccion.className = 'tetra-ajustes-skin tetra-ajustes-control';

  const etiqueta = document.createElement('label');
  etiqueta.textContent = 'Skin:';
  etiqueta.htmlFor = 'tetra-skin-select';
  seccion.appendChild(etiqueta);

  const select = document.createElement('select');
  select.id = 'tetra-skin-select';
  seccion.appendChild(select);

  const entradaArchivo = document.createElement('input');
  entradaArchivo.type = 'file';
  entradaArchivo.accept = '.osk';
  entradaArchivo.id = 'tetra-skin-archivo';
  entradaArchivo.className = 'tetra-input-archivo-oculto';
  seccion.appendChild(entradaArchivo);

  const botonImportar = document.createElement('button');
  botonImportar.type = 'button';
  botonImportar.textContent = 'Importar .osk...';
  botonImportar.addEventListener('click', () => entradaArchivo.click());
  seccion.appendChild(botonImportar);

  const ayuda = document.createElement('p');
  ayuda.className = 'tetra-ajustes-ayuda';
  ayuda.textContent =
    'Opcional: importar un archivo .osk de skin de osu!mania. Sin skin (o si le ' +
    'falta alguna imagen), se ven los rectangulos de siempre.';

  // Repuebla el <select> con "sin skin" + las skins guardadas, y deja
  // seleccionada la que esta activa. Se llama al armar el control y de
  // nuevo cada vez que se importa una skin nueva: es la unica forma de que
  // el <select> refleje lo que hay en IndexedDB, que no tiene
  // notificaciones de cambio.
  async function refrescarLista(): Promise<void> {
    const skins: SkinGuardada[] = await listarSkins();
    const activa = leerSkinActiva();

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
    select.value = activa ?? OPCION_SIN_SKIN;
  }
  void refrescarLista();

  select.addEventListener('change', () => {
    guardarSkinActiva(select.value === OPCION_SIN_SKIN ? null : select.value);
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
      } catch (error) {
        onError(mensajeDeErrorDeCarga(error));
      }
    })();
  });

  const envoltorio = document.createElement('div');
  envoltorio.className = 'tetra-ajustes-fila';
  envoltorio.appendChild(seccion);
  envoltorio.appendChild(ayuda);
  return envoltorio;
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
 */
export function mostrarAjustes(contenedor: HTMLElement, opciones: OpcionesAjustes): void {
  contenedor.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'tetra-ajustes';

  const encabezado = document.createElement('div');
  encabezado.className = 'tetra-ajustes-encabezado';

  const botonVolver = document.createElement('button');
  botonVolver.type = 'button';
  botonVolver.className = 'tetra-boton-volver';
  botonVolver.textContent = '← Menu';
  botonVolver.addEventListener('click', () => opciones.aMenu());
  encabezado.appendChild(botonVolver);

  const titulo = document.createElement('h1');
  titulo.textContent = 'Ajustes';
  encabezado.appendChild(titulo);

  panel.appendChild(encabezado);

  const mensajeError = document.createElement('p');
  mensajeError.className = 'tetra-ajustes-error';
  function mostrarError(mensaje: string): void {
    mensajeError.textContent = mensaje;
  }

  panel.appendChild(
    crearSeccion('Juego', 'juego', crearControlDeOffset(), crearControlDeVelocidad()),
  );
  panel.appendChild(crearSeccion('Teclas', 'teclas', crearControlDeTeclas(mostrarError)));
  panel.appendChild(crearSeccion('Graficos', 'graficos', crearControlDeFps()));
  panel.appendChild(crearSeccion('Apariencia', 'apariencia', crearControlDeSkin(mostrarError)));
  panel.appendChild(mensajeError);

  contenedor.appendChild(panel);
}
