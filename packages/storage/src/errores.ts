// T-066: error de importacion con causa. `message` es el texto exacto que se
// muestra al usuario (tabla "Errores" del ticket); `codigo` lo distingue sin
// tener que comparar textos.

export type CodigoErrorImportacion =
  | 'es-skin'
  | 'no-es-osz'
  | 'muy-grande'
  | 'lectura'
  | 'zip-danado'
  | 'sin-osu'
  | 'sin-mania'
  | 'sin-4k'
  | 'osu-invalido'
  | 'audio-faltante'
  | 'muestras-faltantes'
  | 'virtual-fuera-de-limite'
  | 'sin-espacio'
  | 'base';

/** Error de importacion con causa. `message` es el texto exacto para mostrar. */
export class ErrorDeImportacion extends Error {
  readonly codigo: CodigoErrorImportacion;

  constructor(codigo: CodigoErrorImportacion, mensaje: string, options?: { cause?: unknown }) {
    super(mensaje, options);
    this.name = 'ErrorDeImportacion';
    this.codigo = codigo;
  }
}
