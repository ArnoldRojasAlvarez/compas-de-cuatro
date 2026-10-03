# T-043: Accesibilidad y temas de color

Prioridad: media. Tamano: M. Modelo: Sonnet. Archivos: `apps/web/src/tokens.css`, nuevo `apps/web/src/tema.ts`, `apps/web/src/ajustes.ts`, `packages/engine/src/playfield.ts` (colores de notas).

## Contexto

La paleta de juicio (teal, ambar, verde, azul, violeta, rojo) distingue juicios por color, y las notas usan tinta y teal por columna. Un jugador con daltonismo puede confundir verde con ambar o azul con violeta justo en el dato que mas importa. No hay opcion de alto contraste, reduccion de movimiento propia ni tamano de texto. Tambien conviene poder cambiar el acento sin tocar codigo.

## Contrato

```ts
export type Paleta = 'tetra' | 'daltonismo' | 'alto-contraste';
export interface Tema { paleta: Paleta; acento: string /* #rrggbb */; reducirMovimiento: boolean; escalaTexto: number /* 0.9 a 1.3 */ }
export const TEMA_DEFAULT: Tema;
export function leerTema(storage?: Storage): Tema;   // valida cada campo, uno corrupto no invalida los otros
export function guardarTema(t: Tema, storage?: Storage): void;
/** Aplica el tema: variables CSS en :root y un evento para que la pista relea los colores. */
export function aplicarTema(t: Tema, raiz?: HTMLElement): void;
```

## Comportamiento

- Paleta "daltonismo": juicios distinguibles por luminosidad y forma ademas del color (el texto del juicio ya existe; sumar un icono o patron en las barras de resultados), usando una paleta validada para deuteranopia y protanopia.
- "Alto contraste": fondo mas oscuro, lineas y texto mas fuertes, sin transparencias en los bordes.
- `reducirMovimiento` fuerza las mismas reglas que `prefers-reduced-motion` aunque el sistema no lo pida.
- Color de acento elegible con un selector y 6 presets; se valida contraste minimo 4.5:1 del texto sobre el acento (si no cumple se avisa y se usa la tinta oscura).
- La pista de juego relee los colores solo al empezar una partida, nunca por frame.

## Criterios de aceptacion

- [ ] Cambiar la paleta actualiza menu, song select, resultados y pista sin recargar.
- [ ] El contraste del texto principal cumple 7:1 en alto contraste y 4.5:1 en las otras paletas (calculado en un test).
- [ ] Un valor guardado invalido vuelve al default de ese campo.

## Tests

- `leerTema`: default, campo corrupto, `escalaTexto` fuera de rango (se recorta).
- Funcion pura de contraste (`razonDeContraste(a, b)`) con valores conocidos (negro sobre blanco = 21).
- Que implementacion incorrecta los haria fallar: una formula de luminancia sin la correccion gamma debe fallar el caso conocido.

## Fuera de alcance

Lector de pantalla completo para la pista (el juego es visual y de reflejos), subtitulos.

## Terminado cuando

Checks en verde y se miraron las tres paletas en el navegador.
