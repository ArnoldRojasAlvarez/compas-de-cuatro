// T-006: la parte del cargador de desarrollo que no depende del DOM, para
// poder testearla sin navegador (ver docs/tickets/T-006-cargador-dev.md,
// "Sobre los tests": la pantalla en si es UI de navegador y no vale la pena
// testearla en unit, pero esta logica si).

/**
 * Lo minimo que hace falta de AudioContext para decodificar un Blob: separa
 * la firma para poder pasar un doble de prueba en el test, en vez de
 * depender de un AudioContext real (que no existe en el entorno de vitest).
 */
export interface DecodificadorDeAudio {
  decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer>;
}

/**
 * Convierte el Blob de audio que guarda @tetra/storage en el AudioBuffer
 * que pide runGame (ver docs/tickets/T-006-cargador-dev.md, "Decodificar el
 * audio"). Quien llama es responsable del AudioContext (crearlo y
 * cerrarlo): esta funcion solo hace el Blob -> ArrayBuffer -> AudioBuffer.
 */
export async function decodificarBlobDeAudio(
  blob: Blob,
  decodificador: DecodificadorDeAudio,
): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  return decodificador.decodeAudioData(arrayBuffer);
}

/**
 * Traduce un error atrapado durante la importacion o la decodificacion (que
 * puede venir de @tetra/storage, de fflate, del parser de core o del propio
 * decodeAudioData del navegador) a un mensaje para mostrar en pantalla. Ver
 * criterio de aceptacion "Un .osz invalido o que no sea mania 4K muestra un
 * mensaje de error y no rompe la pantalla".
 */
export function mensajeDeErrorDeCarga(error: unknown): string {
  if (error instanceof Error) return error.message;
  return `Error inesperado: ${String(error)}`;
}
