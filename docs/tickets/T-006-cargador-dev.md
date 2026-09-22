# T-006 · Cargador de desarrollo: soltar un .osz y jugarlo

| | |
|---|---|
| **Fase** | 2 · Contenido |
| **Modelo** | Sonnet |
| **Rama** | `feat/dev-loader` |
| **Depende de** | T-004 (bucle), T-005 (importador) |

## Contexto

El importador funciona contra IndexedDB, pero todavia no hay forma de jugar un
mapa importado dentro del navegador. Este ticket lo conecta: soltar un archivo
`.osz`, importarlo y jugarlo.

**Es una herramienta de desarrollo, a proposito temporal.** No es el song
select de la fase 3, no lleva animaciones ni diseño. Es la pantalla minima que
hace demostrable el importador y que vuelve util la prueba de feel: con esto
Arnold puede probar con mapas de osu! que ya conoce, en vez del click track.

Cuando llegue el song select de la fase 3, este cargador se reemplaza. Marcalo
en el codigo como provisional.

## Que hay que hacer

En `apps/web`, cambiar el punto de entrada actual (que hoy carga el click track
fijo) por una pantalla chica con dos caminos:

1. **Una zona para soltar un `.osz`** (drag and drop, mas un `<input type=file>`
   de respaldo). Al soltar: `importarOsz(file)` de `@tetra/storage`, tomar el
   mapa guardado, decodificar su audio y arrancar `runGame(chart, audioBuffer)`.
2. **Un boton para el click track de siempre**, para no perder el fixture
   sintetico como prueba de referencia.

Al terminar la partida, volver a esta pantalla.

## Decodificar el audio

El audio guardado es un `Blob`. Para pasarlo a `runGame` hace falta un
`AudioBuffer`:

```
const arrayBuffer = await blob.arrayBuffer();
const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
```

Usar el mismo `AudioContext` que ya usa el juego. Si `runGame` hoy crea su
propio contexto, este es buen momento para que reciba el contexto y el buffer
desde afuera, pero **si eso obliga a cambiar la firma de `runGame`, pará y
reportalo antes**: puede tener efectos en el e2e de T-004, que depende de esa
firma.

## Cuidado con lo que ya funciona

- El e2e `apps/web/e2e/sincronia.spec.ts` carga la pagina y espera el gancho
  `window.__tetraDebug`. Si cambiás el arranque, ese e2e no puede romperse:
  correlo y confirmá que sigue pasando.
- El click track debe seguir jugandose igual que antes.

## Criterios de aceptacion

- [ ] Soltar un `.osz` valido de mania 4K lo importa y arranca la partida
- [ ] El audio del mapa suena sincronizado con las notas
- [ ] Un `.osz` invalido o que no sea mania 4K muestra un mensaje de error y no
      rompe la pantalla
- [ ] El boton del click track sigue funcionando
- [ ] Al terminar una partida se vuelve a la pantalla del cargador
- [ ] El e2e de sincronia de T-004 sigue pasando
- [ ] Los cuatro checks en verde

## Prueba de feel (Arnold)

Esta es la que importa de verdad. Con un mapa real de osu! cargado:

- Las notas caen donde suena la musica?
- El grafico de desviacion de la pantalla de resultados esta centrado en cero,
  o hay un sesgo que delata el offset?

## Fuera de alcance

Song select, biblioteca persistente en pantalla, busqueda, dificultades
multiples. Todo eso es fase 3.

## Terminado cuando

Los cuatro checks en verde, el e2e de T-004 pasando, un `.osz` real jugado en el
navegador, revision de Opus aprobada y squash merge a `main`.
