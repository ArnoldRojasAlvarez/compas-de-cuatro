# T-060 · LN que desaparecen y offset sin terminar la cancion

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Prioridad** | Alta: reporte de Arnold jugando, 8 de octubre |
| **Depende de** | T-004, T-007, T-056, T-057, T-026 |

## Contexto

Arnold jugo una cancion suya (2518 notas) y reporto:

1. **Las LN desaparecen mientras las mantiene.**
2. **Cuesta mucho acertar.** Sus resultados: media **+61 ms tarde** (estable de
   principio a fin, no es deriva), desviacion 49 ms, 148 MAX contra 1005 Great.
   Las ventanas son las de osu!mania (revisado), asi que lo que pasa es un
   offset de 61 ms entre lo que oye y lo que el juego juzga (de esa cancion o de
   su cadena de audio).
3. **No hay forma de medir el offset sin terminar la cancion entera.**

## 1. Cuerpo de las LN (bug desde T-004)

En `packages/engine/src/playfield.ts`, el cuerpo de una LN se dibuja solo si la
cabeza **o** la cola estan dentro de [-0.1, 1.1] de progreso. Una LN mas larga
que la pista, con la cabeza ya debajo del receptor y la cola todavia arriba de
la pantalla, no cumple ninguna de las dos y el cuerpo desaparece justo mientras
se mantiene.

- Funcion pura en `position.ts`: `tramoVisible(progresoInicio, progresoFin): boolean`
  (true si el intervalo toca [-0.1, 1.1]). El cuerpo usa eso. La cabeza y la
  cola como marcadores siguen igual.
- Tests: LN que cruza toda la pista con los dos extremos afuera (el caso del
  bug, tiene que fallar con la condicion vieja), LN entera arriba, entera
  abajo, y los bordes exactos.
- Mientras se mantiene, el cuerpo sigue recortado al receptor como hoy.

## 2. Offset en vivo, sin terminar la cancion

- **Media en vivo**: junto a la barra de error (T-056), un numero chico en mono
  con la media movil de los ultimos ~30 golpes juzgados: `+61 ms` (o nada
  hasta tener 10 golpes). Se apaga con el interruptor de la barra de error.
- **Ajustar mientras se juega**: teclas `-` y `=` (tambien `+` y las del
  teclado numerico) cambian el **offset de esta cancion** (T-057) de a 1 ms
  (Shift 5 ms) con efecto inmediato: `clock.userOffset` es mutable a proposito
  (ver HANDOFF, leccion 2: se escribe `userOffset`, nunca `offset`). Se guarda
  con `guardarOffsetLocal`. Aviso chico como el de F3/F4: `Offset de la
  canción +12 ms`, que se desvanece con el reloj de juego. Una tecla asignada a
  una columna manda sobre el atajo (como con F3/F4). En replay/auto no aplica.
  Cuidado con el signo: con la media en +61 (tarde), subir el offset tiene que
  acercar la media a 0; un e2e lo comprueba.
- **En la pausa**: si ya hay al menos 20 golpes juzgados, un boton
  `Ajustar offset (+61 ms)` que aplica la media de lo jugado hasta ahi al offset
  de la cancion (misma cuenta que "Corregir offset" de resultados,
  `calcularOffsetCorregido`) y reinicia la media en vivo. Despues se puede
  Continuar o Reintentar.
- **Calibrar sin cancion**: en Ajustes, junto a la barra de Offset, un boton
  chico "Calibrar". Abre una pantalla minima: suena el click track (o un
  metronomo sintetizado a 120 BPM), el jugador pulsa cualquier tecla de
  columna al compas durante 16 a 32 pulsos; se muestra cada golpe en una
  barra como la de error y la media en grande; al terminar, "Usar +N ms" guarda
  el **offset global** (`calcularOffsetCorregido` sobre el global). Los primeros
  4 pulsos no cuentan (entrar en tiempo). Reloj: todo con el reloj de audio de
  esa pantalla y `event.timeStamp` convertido, como en la partida.
- Que "Calibrar el offset de audio" de la lista "Antes de presentar" (T-037)
  apunte a esta pantalla si es facil.

## Criterios de aceptacion

- [ ] Una LN mas larga que la pista se ve entera mientras se mantiene.
- [ ] Con un desfase simulado de +60 ms (e2e que pulsa 60 ms tarde en el click
      track), la media en vivo muestra ~+60, `=` repetido la lleva hacia 0 y el
      offset local queda guardado; el boton de la pausa hace lo mismo de una vez.
- [ ] La calibracion sin cancion devuelve la media de los golpes (e2e con
      pulsaciones simuladas a +40 ms da ~+40) y guarda el offset global.
- [ ] Ajustes sigue entrando en 1280x800 sin scroll.
- [ ] Los cuatro checks y el e2e completo en verde.

## Fuera de alcance

Suavizar el dibujo entre actualizaciones del reloj de audio (ticket aparte si
hace falta, ver T-059). Cambiar las ventanas de juicio (son las de osu!mania).

## Decisiones al fusionar (13 de octubre, sobre T-063)

- **El offset que se ajusta en vivo es el GLOBAL**, no el de la cancion (cambio
  de contrato respecto de la seccion 2, a pedido de Arnold): el retraso del
  equipo (teclado, audio, pantalla) es uno solo y vale para todas las canciones,
  como en osu! lazer. Las teclas `-`/`=`, el boton de la pausa y "Corregir
  offset" de los resultados corrigen el global; en resultados queda "Solo esta
  canción" como opcion chica para un mapa mal sincronizado. El aviso dice
  `Offset +12 ms`. El offset por cancion se mueve en el song select.
- **Los 95 ms de Xevel**: "Corregir offset" muestra el offset TOTAL que queda
  (`actual + media`), no el delta. Con 68 ya puestos (de una partida anterior,
  con render por software) y media +27, 95 es correcto; el test
  "caso de Arnold" en estadisticas.test.ts lo fija y comprueba que no se
  acumula al repetir. El boton ahora dice "de +68 ms pasa a +95 ms".
- **Song select**: el control `- +68 ms +` se reemplaza por la barra de T-058
  (barra.ts, compacta): -150 a +150, arrastre, rueda, flechas (Shift 5 ms),
  doble clic a 0, teclas `-`/`=`; el titulo aclara que es el ajuste fino que
  se suma al global.
- **Calibrar** fecha cada golpe con el mapa de tiempo de T-063
  (`crearMapaDeTiempo`), igual que la partida; ya no lee `performance.now()`.
- **Cuerpo de LN**: `packages/engine/src/playfield-ln-larga.test.ts` reproduce
  el reporte (LN mas larga que la pista, cabeza pasada del receptor y cola
  arriba): falla en el codigo viejo y pasa con `tramoVisible`.
- Criterios: una LN mas larga que la pista se ve entera (test); e2e de offset
  en vivo y de la pausa sobre el global; calibracion con tolerancia por el
  fechado de T-063 (la media sale hasta ~14 ms mas temprano que
  `currentTime - outputLatency`); ajustes entra en 1280x800 (e2e de partida).
