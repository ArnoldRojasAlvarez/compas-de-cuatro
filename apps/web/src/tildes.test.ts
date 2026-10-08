// T-048: la interfaz se escribe con tildes y enie. Este test recorre las
// cadenas del codigo (literales de texto y de plantilla, no los comentarios) y
// falla si alguna trae una palabra comun sin su tilde. Tambien vigila que no
// aparezca una raya larga (U+2014), que el dueno del proyecto no quiere.
//
// Los identificadores, clases CSS, ids, claves de almacenamiento y datos que
// viven guardados (los nombres 'Facil' y 'Dificil' de la demo, que estan dentro
// de los .osu y del hash de los records) siguen sin tilde a proposito: o bien
// el literal parece un identificador (minusculas con guiones, puntos o dos
// puntos), o bien esta en la lista explicita de excepciones de abajo.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');

/** Palabras que en pantalla llevan tilde (o enie) y que es facil dejar sin ella. */
const PALABRAS = [
  'cancion',
  'musica',
  'precision',
  'estadistica',
  'estadisticas',
  'configuracion',
  'sesion',
  'tamano',
  'dificil',
  'facil',
  'numero',
  'menu',
  'titulo',
  'posicion',
  'seleccion',
  'desviacion',
  'calibracion',
  'presentacion',
  'proxima',
  'despues',
  'ultima',
  'ultimo',
  'tambien',
];

const PATRON = new RegExp(`(?<![\\p{L}])(${PALABRAS.join('|')})(?![\\p{L}])`, 'iu');

/** Una cadena de puro identificador: minusculas, digitos y separadores, con al menos un separador. */
const PARECE_IDENTIFICADOR = /^[a-z0-9_.:#@/-]+( [a-z0-9_.:#@/-]+)*$/;
const TIENE_SEPARADOR = /[-_.:#@/]/;

/**
 * Cadenas sin tilde que son datos o identificadores y no se tocan. Se
 * identifican por archivo (relativo a la raiz del repo) y texto exacto.
 */
const EXCEPCIONES: Record<string, readonly string[]> = {
  // Nombres de dificultad guardados dentro de los .osu de la demo y de los
  // mapas viejos: cambiarlos cambia el hash y deja huerfanos los records.
  'apps/web/src/demo/mapas.ts': ['Facil', 'Dificil'],
  'apps/web/src/song-select-logica.ts': ['Facil', 'Dificil', 'facil', 'dificil', 'titulo'],
  // Ids de logica (no se muestran).
  'apps/web/src/presentacion.ts': ['cancion'],
  'apps/web/src/game.ts': ['precision'],
  'apps/web/src/ajustes.ts': ['presentacion'],
  'apps/web/src/calibracion.ts': ['calibracion'],
  'apps/web/src/song-select.ts': ['titulo'],
  'packages/engine/src/skins-propias.ts': ['circulos'],
  'packages/core/src/mapeador/automapa.ts': ['facil', 'dificil'],
  'packages/storage/src/osz-escritor.ts': ['titulo'],
  'packages/storage/src/records-validacion.ts': ['ultima'], // clave guardada del record
  'apps/web/src/mapeador.ts': ['Cancion'], // parte del nombre de archivo que se descarga
};

function archivosDe(directorio: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name === 'dist' || entrada.name === '.tsbuild') continue;
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) archivosDe(ruta, salida);
    else if (entrada.name.endsWith('.ts') && !entrada.name.endsWith('.test.ts')) salida.push(ruta);
  }
  return salida;
}

interface Cadena {
  archivo: string;
  linea: number;
  texto: string;
}

function cadenasDe(ruta: string): Cadena[] {
  const archivo = relative(RAIZ, ruta).split('\\').join('/');
  const fuente = readFileSync(ruta, 'utf8');
  const sf = ts.createSourceFile(ruta, fuente, ts.ScriptTarget.Latest, true);
  const salida: Cadena[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (
      ts.isStringLiteral(nodo) ||
      ts.isNoSubstitutionTemplateLiteral(nodo) ||
      ts.isTemplateHead(nodo) ||
      ts.isTemplateMiddle(nodo) ||
      ts.isTemplateTail(nodo)
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(nodo.getStart());
      salida.push({ archivo, linea: line + 1, texto: nodo.text });
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return salida;
}

function todasLasCadenas(): Cadena[] {
  const directorios = [
    join(RAIZ, 'apps', 'web', 'src'),
    join(RAIZ, 'packages', 'core', 'src'),
    join(RAIZ, 'packages', 'engine', 'src'),
    join(RAIZ, 'packages', 'storage', 'src'),
  ];
  return directorios.flatMap((d) => archivosDe(d)).flatMap(cadenasDe);
}

function esExcepcion(c: Cadena): boolean {
  return EXCEPCIONES[c.archivo]?.includes(c.texto) ?? false;
}

function esIdentificador(texto: string): boolean {
  return PARECE_IDENTIFICADOR.test(texto) && TIENE_SEPARADOR.test(texto);
}

describe('T-048: tildes y enie en las cadenas de la interfaz', () => {
  const cadenas = todasLasCadenas();

  it('recorre las cadenas de web, core, engine y storage', () => {
    expect(cadenas.length).toBeGreaterThan(1000);
  });

  it('ninguna cadena visible trae una palabra comun sin su tilde', () => {
    const faltas = cadenas
      .filter((c) => !esIdentificador(c.texto) && !esExcepcion(c))
      .filter((c) => PATRON.test(c.texto))
      .map((c) => `${c.archivo}:${c.linea} ${JSON.stringify(c.texto)}`);
    expect(faltas).toEqual([]);
  });

  it('ninguna cadena lleva una raya larga', () => {
    const rayas = cadenas.filter((c) => c.texto.includes('\u2014')).map((c) => `${c.archivo}:${c.linea}`);
    expect(rayas).toEqual([]);
  });

  it('las excepciones siguen existiendo (si una deja de usarse, se saca de la lista)', () => {
    const presentes = new Set(cadenas.map((c) => `${c.archivo}\u0000${c.texto}`));
    const sobrantes: string[] = [];
    for (const [archivo, textos] of Object.entries(EXCEPCIONES)) {
      for (const texto of textos) {
        if (!presentes.has(`${archivo}\u0000${texto}`)) sobrantes.push(`${archivo} ${JSON.stringify(texto)}`);
      }
    }
    expect(sobrantes).toEqual([]);
  });

  it('reconoce los errores que tiene que atrapar', () => {
    for (const mala of ['Elegir cancion', 'La musica suena', 'Precision media', 'Tamano', 'Es dificil', 'Un numero']) {
      expect(PATRON.test(mala)).toBe(true);
    }
    for (const buena of ['Elegir canción', 'La música suena', 'Precisión media', 'Tamaño', 'Es difícil', 'Un número']) {
      expect(PATRON.test(buena)).toBe(false);
    }
  });
});
