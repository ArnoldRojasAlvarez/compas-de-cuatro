# T-025: Mapeador (editor manual y mapeo automatico)

Ticket escrito despues de la implementacion, en la misma sesion (3 de octubre
de 2026), para que quede el diseno y sus limites por escrito.

## Contexto

Arnold tiene que presentar una cancion propia mapeada. Hasta ahora los mapas
solo se importaban de osu!. El mapeador permite crear el mapa dentro de Tetra,
a mano, con ayuda automatica, o las dos cosas (el automatico es un punto de
partida que se retoca a mano).

## Piezas

- `packages/core/src/chart/osu-escritor.ts`: `escribirOsu(chart)`, inverso de
  `parseOsu`. Un parse del resultado devuelve el mismo mapa.
- `packages/core/src/mapeador/`:
  - `fft.ts`, `onsets.ts`: flujo espectral y picos con umbral adaptativo.
    El paso entre ventanas se redondea a muestras enteras: se usa el paso
    REAL (`pasoRealMs`), no el pedido (con el pedido el BPM salia 0.2% corrido).
  - `tempo.ts`: `estimarTempo`, busqueda gruesa de grilla mas refinamiento por
    minimos cuadrados sobre los onsets fuertes (evita la deriva).
  - `grilla.ts`: tiempo <-> slot, compartido por el automatico y el editor.
  - `automapa.ts`: `generarNotas`, determinista por semilla. Cuatro niveles
    (`PRESETS_AUTO`): densidad por ventana de 2 s, separacion minima, dobles
    en los onsets mas fuertes, alternancia de manos, jacks segun nivel, notas
    largas opcionales sin solapar la misma columna.
- `packages/storage/src/osz-escritor.ts`: `construirOsz`; `guardarCancionCreada`
  pasa por `importarOsz`, asi lo guardado es exactamente lo exportable.
- `apps/web/src/mapeador-logica.ts`: operaciones sobre notas, historial,
  geometria de la vista, borrador en `localStorage`, `construirChart`.
- `apps/web/src/mapeador.ts` y `mapeador.css`: la pantalla. Canvas con las
  cuatro pistas, onda de audio, rejilla, golpes detectados, reproduccion con
  clicks y metronomo programados con `source.start(when)`.
- `apps/web/src/mapeador.worker.ts` y `mapeador-worker-cliente.ts`: el analisis
  corre en un Web Worker (con respaldo en el hilo principal).

## Uso

Menu, Mapeador. Cargar un audio (elegir o soltar): se analiza y se propone BPM
y offset. Ajustar con "Detectar BPM", "Tap tempo" o "Offset = cabezal". Elegir
nivel y "Generar mapa automatico", o poner notas a mano:

- Clic: poner o quitar. Arrastrar: nota larga. Clic derecho: quitar.
- Rueda: mover. Ctrl + rueda: zoom. Espacio: reproducir.
- D F J K (las teclas de los ajustes): poner en el cabezal; mientras suena,
  grabar en vivo con el ajuste de la rejilla.
- Ctrl+Z / Ctrl+Y: deshacer y rehacer. `[` y `]`: cambiar la rejilla.

Salida: "Probar el mapa" (juega el mapa y vuelve al editor), "Guardar en la
biblioteca", descargar `.osz` o `.osu`.

## Verificado

- Tests: escritor (ida y vuelta por el parser), grilla, onsets y tempo sobre
  clicks sinteticos, invariantes del automatico, logica del editor, `.osz`
  leido por el importador real.
- A mano en el navegador (silenciado): cargar audio, analisis en el worker,
  generar, poner/alternar/larga/tecla/deshacer/rehacer, reproducir, probar el
  mapa y volver, guardar y verlo en el song select.

## Limites conocidos

- Solo se probo el automatico con senales sinteticas de click. Con musica real
  hay que revisar de oido el BPM (usar el metronomo) y retocar el mapa: el
  automatico detecta ataques, no entiende la estructura de la cancion.
- Un solo cambio de tempo (un punto rojo): canciones con tempo variable hay que
  mapearlas por tramos o aceptar la deriva.
- La grabacion en vivo no compensa la latencia de salida de audio.
- "Probar" siempre arranca del principio de la cancion.
- Sin seleccion multiple ni copiar y pegar; sin cambios de velocidad (SV).
- Una cancion creada y guardada no se puede volver a abrir en el editor desde
  la biblioteca (se puede reimportar el `.osz` exportado en osu!).
