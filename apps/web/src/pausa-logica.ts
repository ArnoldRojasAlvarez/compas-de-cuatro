// T-026: logica pura de la pausa (sin DOM ni audio), para poder probarla en
// vitest. La partida pasa por tres fases:
//
//   jugando --pausar--> pausado --continuar--> cuenta --cuentaTerminada--> jugando
//                          ^                      |
//                          +------ volver --------+
//
// El tiempo de la pausa nunca se mide con un temporizador: al pausar se
// suspende el AudioContext del juego y su reloj (`currentTime`) se congela
// solo. La cuenta regresiva se mide con el reloj de OTRO AudioContext, ver
// `numeroDeCuenta`.

export type FasePausa = 'jugando' | 'pausado' | 'cuenta';

export type AccionPausa = 'pausar' | 'continuar' | 'volver' | 'cuentaTerminada';

/** Pasos de la cuenta regresiva (3, 2, 1). */
export const PASOS_DE_CUENTA = 3;

/**
 * Fase siguiente, o `null` si la accion no vale en la fase actual (por
 * ejemplo "continuar" estando jugando: no hace nada y quien llama lo ignora).
 */
export function transicionPausa(fase: FasePausa, accion: AccionPausa): FasePausa | null {
  switch (fase) {
    case 'jugando':
      return accion === 'pausar' ? 'pausado' : null;
    case 'pausado':
      return accion === 'continuar' ? 'cuenta' : null;
    case 'cuenta':
      if (accion === 'cuentaTerminada') return 'jugando';
      if (accion === 'volver') return 'pausado';
      return null;
  }
}

/**
 * Numero que se muestra en la cuenta regresiva, a partir de los segundos
 * transcurridos desde que empezo (leidos de `AudioContext.currentTime`):
 * 3 durante el primer segundo, 2 durante el segundo, 1 durante el tercero y
 * 0 cuando termino (momento de reanudar). Un tiempo negativo o NaN cuenta como
 * recien empezada.
 */
export function numeroDeCuenta(transcurridoS: number, pasos = PASOS_DE_CUENTA): number {
  const t = Number.isFinite(transcurridoS) && transcurridoS > 0 ? transcurridoS : 0;
  return Math.max(0, pasos - Math.floor(t));
}
