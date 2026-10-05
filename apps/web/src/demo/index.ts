// T-051: la cancion demo "Primer Compas". Se compone, se sintetiza y se
// dibuja en el navegador, y se siembra una sola vez en la biblioteca para que
// un juego recien abierto tenga algo que jugar.

import { escribirOsu } from '@tetra/core';
import { guardarCancionCreada, listarCanciones } from '@tetra/storage';
import { componerDemo } from './composicion.js';
import { ARCHIVO_AUDIO, ARCHIVO_FONDO, TITULO_DEMO } from './constantes.js';
import { dibujarFondoDemo } from './fondo.js';
import { mapearDemo, NIVELES_DEMO } from './mapas.js';
import { codificarWav, sintetizarDemo } from './sintesis.js';

export { TITULO_DEMO };

/** Marca en localStorage: una vez puesta, la demo no vuelve a sembrarse en este navegador. */
const MARCA_SEMBRADA = 'tetra:demo-sembrada';

function leerMarca(): boolean {
  try {
    return localStorage.getItem(MARCA_SEMBRADA) !== null;
  } catch {
    // Sin localStorage (modo privado, bloqueado): se trata como no sembrada; el
    // titulo en la biblioteca evita duplicar mientras la demo siga ahi.
    return false;
  }
}

function ponerMarca(): void {
  try {
    localStorage.setItem(MARCA_SEMBRADA, '1');
  } catch {
    // Si no se puede guardar, la demo puede volver a sembrarse tras borrarla: no es grave.
  }
}

let enCurso: Promise<void> | null = null;

async function sembrar(): Promise<void> {
  if (leerMarca()) return;
  const existentes = await listarCanciones();
  if (existentes.some((c) => c.titulo === TITULO_DEMO)) {
    // Ya esta (otra pestana, una importacion): no se duplica y se deja la marca.
    ponerMarca();
    return;
  }

  const composicion = componerDemo();
  const [buffer, fondo] = await Promise.all([sintetizarDemo(composicion), dibujarFondoDemo(1920, 1080)]);
  const audio = codificarWav(buffer);
  const bytesFondo = new Uint8Array(await fondo.arrayBuffer());

  await guardarCancionCreada({
    titulo: TITULO_DEMO,
    artista: 'Tetra',
    creador: 'Tetra',
    audioNombre: ARCHIVO_AUDIO,
    audio,
    fondo: { nombre: ARCHIVO_FONDO, bytes: bytesFondo },
    dificultades: NIVELES_DEMO.map((nivel) => ({
      version: nivel,
      texto: escribirOsu(mapearDemo(composicion, nivel)),
    })),
  });

  ponerMarca();
  window.dispatchEvent(new CustomEvent('tetra:biblioteca-cambio'));
}

/**
 * Si la demo no se sembro nunca en este navegador (marca en localStorage
 * 'tetra:demo-sembrada') y la biblioteca no tiene una cancion con ese titulo,
 * la genera y la guarda con guardarCancionCreada (con fondo). Al terminar
 * dispara `tetra:biblioteca-cambio` en `window`. Nunca lanza: un fallo se
 * loguea con console.warn y la app sigue. Si el usuario borra la demo no
 * vuelve (la marca ya esta puesta).
 */
export function asegurarCancionDemo(): Promise<void> {
  // Dos llamadas seguidas comparten el mismo trabajo en vez de sembrar dos veces.
  enCurso ??= sembrar()
    .catch((error: unknown) => {
      console.warn('No se pudo sembrar la cancion demo:', error);
    })
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}
