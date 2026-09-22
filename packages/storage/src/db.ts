// T-005: capa fina sobre IndexedDB para guardar y listar mapas importados.
// Vive fuera de core (core no puede tocar el navegador, ver CLAUDE.md,
// "packages/core no toca el navegador"). Un solo object store ('mapas'),
// sin indices: listarMapas() trae todo con getAll(), que alcanza para la
// cantidad de mapas que un usuario real va a tener en desarrollo (el song
// select con busqueda/orden es fase 3, fuera de alcance de T-005).

import type { Chart } from '@tetra/core';

const NOMBRE_BASE = 'tetra-mapas';
const VERSION_BASE = 1;
const NOMBRE_TIENDA = 'mapas';

export type ChartId = string;

/** Un mapa importado, tal cual se guarda y se lee de IndexedDB. */
export interface MapaGuardado {
  id: ChartId;
  chart: Chart;
  audio: Blob;
  background?: Blob;
}

function abrirBaseDeDatos(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const peticion = indexedDB.open(NOMBRE_BASE, VERSION_BASE);

    peticion.onupgradeneeded = () => {
      const db = peticion.result;
      if (!db.objectStoreNames.contains(NOMBRE_TIENDA)) {
        db.createObjectStore(NOMBRE_TIENDA, { keyPath: 'id' });
      }
    };

    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => {
      reject(peticion.error ?? new Error('No se pudo abrir la base de datos de mapas.'));
    };
  });
}

/** Guarda (o reemplaza si el id ya existia) un mapa completo. */
export async function guardarMapa(mapa: MapaGuardado): Promise<void> {
  const db = await abrirBaseDeDatos();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA, 'readwrite');
      tx.objectStore(NOMBRE_TIENDA).put(mapa);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar el mapa.'));
      tx.onabort = () => reject(tx.error ?? new Error('Se aborto el guardado del mapa.'));
    });
  } finally {
    db.close();
  }
}

/** Devuelve todos los mapas guardados, sin ningun orden garantizado. */
export async function listarMapasDeLaBase(): Promise<MapaGuardado[]> {
  const db = await abrirBaseDeDatos();
  try {
    return await new Promise<MapaGuardado[]>((resolve, reject) => {
      const tx = db.transaction(NOMBRE_TIENDA, 'readonly');
      const peticion = tx.objectStore(NOMBRE_TIENDA).getAll();
      peticion.onsuccess = () => resolve(peticion.result as MapaGuardado[]);
      peticion.onerror = () => reject(peticion.error ?? new Error('No se pudieron listar los mapas.'));
    });
  } finally {
    db.close();
  }
}
