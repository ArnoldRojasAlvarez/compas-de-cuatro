// T-052: logica pura de la musica del menu (musica-menu.ts) y del evento de
// la biblioteca, separada para poder testearla sin navegador.

/** Evento que se dispara sobre `window` cuando cambia la biblioteca (la demo se siembra, entra una cancion). */
export const EVENTO_BIBLIOTECA_CAMBIO = 'tetra:biblioteca-cambio';

/**
 * Elige la proxima cancion del menu entre `ids`, sin repetir `actualId`
 * mientras haya otra para elegir. Con una sola cancion repite esa misma (no
 * hay alternativa); sin canciones da `null` (el menu cae al click track).
 * `aleatorio` es inyectable, igual que en `elegirIndiceAleatorio`: sortea
 * entre los candidatos (todos menos la actual), asi que nunca reintenta ni
 * puede quedar en un bucle.
 */
export function elegirSiguienteId(
  ids: readonly string[],
  actualId: string | null,
  aleatorio: () => number = Math.random,
): string | null {
  if (ids.length === 0) return null;
  const candidatos = ids.filter((id) => id !== actualId);
  if (candidatos.length === 0) return ids[0] ?? null;
  const indice = Math.min(
    candidatos.length - 1,
    Math.max(0, Math.floor(aleatorio() * candidatos.length)),
  );
  return candidatos[indice] ?? null;
}

/** Segundos del final del audio a partir de los cuales un preview no tiene sentido: si el `previewTime` cae mas cerca del final que esto, se arranca de 0. */
const COLCHON_FINAL_PREVIEW_S = 5;

/**
 * Desde donde arrancar un preview o la musica del menu, en segundos. El
 * `previewTime` de un .osu puede ser -1 (sin preview), negativo o caer casi
 * al final del audio: en esos casos arranca desde el principio.
 */
export function inicioDePreviewSegundos(previewMs: number, duracionS: number): number {
  if (!Number.isFinite(previewMs) || !Number.isFinite(duracionS) || previewMs <= 0) return 0;
  const segundos = previewMs / 1000;
  if (segundos > duracionS - COLCHON_FINAL_PREVIEW_S) return 0;
  return segundos;
}

/** "Titulo · Artista" para la linea de "lo que suena"; sin artista, solo el titulo. */
export function textoDeLoQueSuena(titulo: string, artista: string): string {
  const t = titulo.trim();
  const a = artista.trim();
  return a === '' ? t : `${t} · ${a}`;
}
