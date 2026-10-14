# T-063: reloj interpolado (la pulsacion no debe heredar el bloque de audio)

## Contexto

Arnold (jugador experto, en osu! lazer saca casi A en Xevel Expert) reporta
que en Tetra "presionar las teclas esta como con lag": la media de error queda
centrada, pero casi todos sus golpes caen en PERFECT/GREAT y casi ningun MAX
(ventana de +-16,5 ms). Con la GPU activada el render ya va limpio (p99 17 ms)
y la dispersion sigue en 32 ms de desvio, cuando en lazer anda en 12 a 18.

### Diagnostico (tools/medir-reloj.mjs, Chromium real)

`ctx.currentTime` no avanza continuo. Chromium rinde el audio en rafagas de
cuatro cuantos de 128 muestras (2,67 ms a 48 kHz) cada ~10 ms (`baseLatency`
0,01, el mismo valor que reporta el Opera de Arnold): entre dos rafagas el
valor se queda quieto. La conversion de una pulsacion era

    toGameTime(ts) = clock.now() - (performance.now() - ts)

y `clock.now()` leia `currentTime` en el instante del handler, asi que cada
pulsacion heredaba un error al azar de 0 a un bloque. Medido con pulsaciones
sinteticas (ts conocido, conversion 0 a 20 ms despues, error contra la recta
ajustada):

| Conversion | std | rango |
|---|---|---|
| cruda (antes) | 2,9 ms | 12,0 ms |
| ancla `getOutputTimestamp` sin filtro | 0,15 ms | 0,8 ms |
| mapa filtrado (esta implementacion) | 0,03 ms | 0,2 ms |

Doce milisegundos de rango sobre una ventana de MAX de 33 ms de ancho:
suficiente para que la media quede en cero y los MAX desaparezcan. Ademas
`currentTime - contextTime` mide 44 a 54 ms mientras `outputLatency` reporta
40: el reloj viejo quedaba en promedio ~4 ms adelantado respecto de lo que se
oye (sesgo "tarde" chico), y la pista se dibujaba a saltos de un bloque.

## Contrato

`packages/audio/src/mapa-de-tiempo.ts`:

```ts
export interface MapaDeTiempo {
  ahora(): number;               // posicion de salida (s) que se oye ahora, interpolada, monotona
  aContexto(perfMs: number): number; // posicion (s) que se oia en ese instante de performance
  reanclar(): void;
  readonly anclado: boolean;
}
export function crearMapaDeTiempoDesde(fuente: FuenteDeTiempo): MapaDeTiempo; // puro, para tests
export function crearMapaDeTiempo(ctx: AudioContext, opciones: OpcionesDeMapa): MapaDeTiempo;
```

`AudioClock` suma `desdeTimeStamp(perfMs): Ms` (tiempo de juego del instante
de un `event.timeStamp`) e `interpolando: boolean` (diagnostico). `now()` pasa
por `mapa.ahora()`. `ClockOptions.ahoraPerf` solo para tests.

Como funciona: `desfase = contextTime * 1000 - performanceTime` (ms) de cada
muestra de `ctx.getOutputTimestamp()`. Se filtra (ganancia 0,1, paso maximo
0,5 ms por muestra; si la muestra difiere en mas de 20 ms se salta de una:
pausa, cambio de dispositivo). `aContexto(perf) = (perf + desfase) / 1000`.
Sin ancla (navegador sin `getOutputTimestamp`, contexto suspendido, antes de
la primera rafaga) cae al camino crudo de antes: `currentTime - outputLatency`.

El audio manda, con limite duro: el interpolado nunca se aleja mas de 30 ms
(`TOLERANCIA_CRUDA_MS`) de la lectura cruda tomada en el mismo instante, y un
ancla que contradiga a la cruda por mas que eso se descarta. Asi, pase lo que
pase con `getOutputTimestamp` (dato raro bajo carga, hilo de audio atascado
mientras `performance` sigue), el reloj de juego queda a lo sumo a 30 ms del
reloj de antes, nunca disparado.

Nota sobre el e2e: Playwright corre los archivos en paralelo (un navegador por
worker, varios jugando a la vez). En la maquina de Arnold eso hace fallar
tests de timing (sincronia, saltar intro, diagnostico, hitsound) TAMBIEN en
`main`, por carga. Se verifico con `--workers=1`. Si se vuelve a ver, poner
`workers: 1` en playwright.config.ts o correr menos archivos a la vez.

El reloj sigue siendo el audio: el desfase se reancla al contexto a cada
rafaga (no acumula deriva: test con cristal 200 ppm mas lento durante 10 min,
error < 0,5 ms) y `performance.now()` solo interpola dentro del bloque. Es el
esquema del reloj interpolado de osu! (`InterpolatingFramedClock`). La unica
lectura de `performance.now()` del repo se muda de `game.ts` a
`mapa-de-tiempo.ts`; CLAUDE.md y eslint.config.js lo documentan.

## Criterios de aceptacion

- [x] `desdeTimeStamp(ts)` no depende del bloque en que corre el handler (test).
- [x] `now()` avanza suave entre bloques y nunca retrocede (test de monotonia
      con ancla que se corrige hacia atras).
- [x] Sin deriva a largo plazo con cristales distintos (test de 10 minutos).
- [x] Pausa (`ctx.suspend`) congela, reanudar reancla sin salto hacia atras;
      `stop()` congela; `seek()` hacia atras mueve `now()` hacia atras.
- [x] Sin `getOutputTimestamp` el reloj se comporta exactamente como antes
      (los 14 tests de T-001 pasan sin cambios).
- [x] `game.ts` no lee `performance.now()`; el lint sigue prohibiendolo en
      todos lados salvo el mapa.
- [x] e2e de sincronia: promedia la diferencia sobre ~10 bloques (ahora
      `clock.now()` es suave y `currentTime` a saltos) y sigue exigiendo < 5 ms
      de deriva en 50 s.
- [x] El replay determinista (T-044) no cambia: el motor recibe los mismos
      `time` que se graban.

## Sobre el sesgo de +27 ms tarde de Arnold

La cuantizacion NO lo explica (al contrario: sesga ~4 ms hacia "tarde", lo
demas es jitter simetrico). Lo que queda, con el render ya fluido, es la
cadena visual: rAF dibuja la nota donde esta en `t`, el frame se presenta en
el siguiente vsync (16,7 ms a 60 Hz) y la pantalla lo muestra algo despues:
unos 20 a 30 ms entre el `t` dibujado y el instante en que se ve. Un jugador
que lee (y en Xevel se lee) pulsa cuando VE la nota en la linea, o sea 20 a
30 ms despues del `t`. En lazer a 240+ fps sin vsync esa cadena es de unos
pocos ms; por eso ahi no lo nota. Mas la latencia del teclado (USB + SO, 1 a 8
ms). Es exactamente lo que compensa el offset global: con el reloj nuevo se
espera que el sesgo baje unos 4 ms (de 27 a ~23) y que la dispersion baje
mucho; el offset hay que recalibrarlo DESPUES del cambio, jugando dos o tres
veces y usando "Corregir offset" (global) con la media que salga.

## Fuera de alcance

- Anticipar el dibujo un vsync (dibujar en `t + 16,7 ms` para que la nota se
  vea donde corresponde al presentarse). Reduciria el sesgo visual sin tocar
  el juicio; queda como idea para probar con Arnold (prueba de feel).
- Latencia de salida real (44 vs 40 ms): la resuelve el ancla sola.

## Terminado cuando

Los cuatro checks y el e2e de sincronia en verde, `tools/medir-reloj.mjs`
reporta la conversion filtrada con rango < 1 ms, y Arnold juega Xevel con el
desvio por debajo de 20 ms.
