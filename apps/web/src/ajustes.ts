// T-011: pantalla de ajustes propia. Los controles (offset, velocidad,
// skin) existian desde T-007/T-008/T-009 pero vivian sueltos dentro del
// cargador de desarrollo (ver el ticket, "el problema que resuelve": todo
// aplastado en un solo lugar); esta pantalla es simplemente esos mismos
// tres controles, con la misma logica de persistencia (offset.ts,
// velocidad.ts, skin.ts) y el mismo comportamiento de siempre, movidos a
// su propio lugar en la navegacion. El pulido fino (remapeo de teclas,
// opciones de graficos) es T-012, fuera de alcance aca (ver el ticket,
// "Fuera de alcance").

import { importarOsk, listarSkins, type SkinGuardada } from '@tetra/storage';
import { mensajeDeErrorDeCarga } from './cargador-logica.js';
import { guardarOffset, leerOffset } from './offset.js';
import { guardarSkinActiva, leerSkinActiva } from './skin.js';
import {
  VELOCIDAD_MAX,
  VELOCIDAD_MIN,
  clampVelocidad,
  guardarVelocidad,
  leerVelocidad,
  velocidadAScrollDuration,
} from './velocidad.js';

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
  seccion.className = 'tetra-ajustes-offset';

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
  seccion.className = 'tetra-ajustes-velocidad';

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

/** Valor de `<option>` para "sin skin, rectangulos" (el default): no puede ser un SkinId real (crypto.randomUUID() nunca da string vacio). */
const OPCION_SIN_SKIN = '';

/**
 * Control de skins (T-009): soltar/elegir un `.osk` y un `<select>` para
 * elegir entre "sin skin (rectangulos)" y las skins ya importadas. La skin
 * elegida se persiste con apps/web/src/skin.ts; song-select.ts la vuelve a
 * leer al resolver las texturas antes de arrancar una partida.
 */
function crearControlDeSkin(onError: (mensaje: string) => void): HTMLElement {
  const seccion = document.createElement('div');
  seccion.className = 'tetra-ajustes-skin';

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
  entradaArchivo.className = 'tetra-ajustes-skin-input';
  seccion.appendChild(entradaArchivo);

  const ayuda = document.createElement('p');
  ayuda.className = 'tetra-ajustes-ayuda';
  ayuda.textContent =
    'Opcional: soltar un archivo .osk de skin de osu!mania. Sin skin (o si le ' +
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
 * que hubiera. Estructura basica a proposito (ver el ticket, "ajustes"): el
 * pulido fino y las opciones nuevas son T-012.
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

  panel.appendChild(crearControlDeOffset());
  panel.appendChild(crearControlDeVelocidad());
  panel.appendChild(crearControlDeSkin(mostrarError));
  panel.appendChild(mensajeError);

  contenedor.appendChild(panel);
}
