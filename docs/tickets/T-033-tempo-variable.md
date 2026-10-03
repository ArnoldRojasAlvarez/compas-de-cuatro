# T-033: Tempo variable en el mapeador

Prioridad: media. Tamano: L. Modelo: Opus escribe el contrato de la grilla por tramos, Sonnet implementa. Archivos: `packages/core/src/mapeador/grilla.ts`, `automapa.ts`, `tempo.ts`, `apps/web/src/mapeador*.ts`.

## Contexto

El mapeador asume un unico BPM (T-025, "Limites conocidos"). Una cancion con cambio de tempo, o una grabacion en vivo con deriva, queda desalineada. El escritor `.osu` y el parser ya soportan varios puntos rojos; falta la grilla y el editor.

## Contrato

```ts
// core: la grilla pasa de un tempo a una lista de tramos ordenada por tiempo.
export interface TramoDeTempo { offsetMs: Ms; bpm: number; meter: number }
export interface GrillaVariable { tramos: readonly TramoDeTempo[]; divisor: number }

export function slotMasCercanoV(g: GrillaVariable, time: Ms): { tramo: number; slot: number };
export function tiempoDeSlotV(g: GrillaVariable, tramo: number, slot: number): Ms;
export function ajustarAGrillaV(g: GrillaVariable, time: Ms): Ms;
export function lineasDeGrillaV(g: GrillaVariable, desde: Ms, hasta: Ms): { time: Ms; tipo: 0 | 1 | 2 }[];
```

La grilla de un solo tempo (`Grilla`) se mantiene y se define como el caso de un tramo; `generarNotas` acepta cualquiera de las dos.

## Comportamiento

- Editor: boton "Nuevo tempo aqui" (inserta un punto rojo en el cabezal, ajustado a la grilla del tramo anterior), lista de tramos con BPM editable y borrar.
- La rejilla, el metronomo y el ajuste de notas siguen el tramo vigente en cada instante.
- `estimarTempo` v2: opcion `porTramos` que devuelve una lista cuando el ajuste lineal tiene un residuo alto en alguna zona (sugerencia, no automatico).
- El automatico cuantiza cada onset al tramo que lo contiene.

## Criterios de aceptacion

- [ ] Con un solo tramo, todo el comportamiento actual es identico (tests existentes de grilla siguen pasando sin cambios).
- [ ] Una nota puesta a mano en el segundo tramo cae en un slot del segundo tramo, no del primero.
- [ ] El `.osu` exportado vuelve a parsear con los mismos puntos de tiempo.

## Tests

- Ida y vuelta `slotMasCercanoV` / `tiempoDeSlotV` en los bordes entre tramos.
- Un onset justo en el cambio de tramo se asigna a un solo tramo (sin duplicar).
- Que implementacion incorrecta los haria fallar: una que use siempre el BPM del primer tramo debe fallar el caso del segundo tramo.

## Fuera de alcance

Cambios de compas (meter) que alteren los acentos de la rejilla mas alla de dibujarlos; tempo gradual (rit/accel).

## Terminado cuando

Checks en verde y se mapeo a mano una cancion sintetica con un cambio de 120 a 90 BPM sin desalineacion.
