# T-008 · Velocidad de caida y salir de la cancion

| | |
|---|---|
| **Fase** | 2 · Contenido |
| **Modelo** | Sonnet |
| **Rama** | `feat/velocidad` |
| **Depende de** | T-007 (usa el mismo patron de settings persistidos) |

## Por que este ticket

Feedback directo de Arnold, jugador top del mundo, despues de probar:

1. **La velocidad de caida es critica.** Ahora `scrollDuration` esta fija y es
   lenta, entonces las notas se amontonan y la pantalla se satura. El juega a
   mas velocidad de caida, donde las notas bajan mas rapido y hay menos en
   pantalla a la vez. Sin esto el juego no es jugable para alguien de su nivel.
2. **No se puede salir de una cancion hasta que termina.** Hace falta abandonar
   a mitad y volver al cargador.

## Parte A: velocidad de caida

La pista (`packages/engine/src/playfield.ts`) ya recibe `scrollDuration` en ms
en `PlayfieldOptions`. Es el tiempo que tarda una nota desde que entra por
arriba hasta el receptor. **Menos ms = cae mas rapido = menos notas en
pantalla.** Falta exponerlo.

- **Setting persistido**, con el mismo patron que el offset de T-007
  (localStorage, leido al arrancar la partida). No inventar un mecanismo nuevo:
  reusar el de T-007.
- **Control en el cargador**: un numero de velocidad con botones de mas y menos.
  Pensar bien como presentarlo. En osu!mania la velocidad se siente como "que
  tan rapido bajan", donde mas es mas rapido. Si internamente es `scrollDuration`
  en ms (donde mas rapido es menos ms), la UI debe mostrar el concepto natural
  para el jugador (mas = mas rapido), aunque por dentro reduzca los ms.
  Documentar el mapeo entre el numero que ve el usuario y los ms reales.
- Rango razonable: que permita desde bastante lento hasta bastante rapido. Un
  jugador top usa velocidades altas. Elegir min y max sensatos y decir cuales.

## Parte B: salir de la cancion

- Una tecla (Escape) durante la partida aborta: detiene el audio, limpia la
  pista y los listeners de entrada, y vuelve a la pantalla del cargador.
- La limpieza tiene que ser completa: el reloj se detiene, `playfield.destroy()`
  se llama, el `InputSource` se destruye. Nada de listeners ni sprites colgados
  ni audio sonando despues de salir.
- Volver al cargador, no a resultados: una partida abandonada no tiene un
  resultado que valga la pena mostrar.

## El contrato de runGame

Hoy `runGame(chart, audio)` devuelve una promesa que resuelve con el
`ScoreState` al terminar. Salir a mitad cambia eso: la partida puede terminar
sin un resultado.

Decidir e implementar una de estas, y documentarla:

- Que la promesa resuelva con algo que distinga "termino" de "se abandono" (por
  ejemplo `{ estado: 'completado', score } | { estado: 'abortado' }`).
- O una devolucion de llamada / senal de aborto aparte.

**Si cambias la firma de `runGame`, el e2e de T-004 la usa. Actualiza el e2e si
hace falta y confirma que sigue pasando.** No lo rompas en silencio.

## Cuidado con lo que ya funciona

- El e2e `apps/web/e2e/sincronia.spec.ts` corre el click track completo. Tiene
  que seguir pasando: `cd apps/web && npx playwright test`.
- El offset de T-007 y el click track siguen funcionando.
- Cambiar la velocidad no debe afectar el juicio: una nota se juzga por su
  tiempo, no por donde se dibuja. La velocidad es puramente visual. Esto es
  clave: verificar que subir la velocidad no cambia el score de una misma
  ejecucion.

## Criterios de aceptacion

- [ ] La velocidad se guarda en localStorage y sobrevive recargar
- [ ] Subir la velocidad hace que las notas caigan mas rapido y haya menos en
      pantalla a la vez. Verificable por Arnold
- [ ] La velocidad es solo visual: no cambia el juicio ni el score de una misma
      secuencia de pulsaciones. Cubierto por un test sobre el calculo de posicion
- [ ] Escape durante la partida vuelve al cargador
- [ ] Al salir no queda audio sonando, ni listeners, ni sprites vivos
- [ ] El e2e de T-004 sigue pasando
- [ ] Los cuatro checks en verde

## Fuera de alcance

- Skins (es otro ticket).
- Pausa con reanudacion. Aca es abandonar, no pausar. Si sale, sale.

## Terminado cuando

Los cuatro checks en verde, el e2e pasando, revision de Opus, Arnold confirma que
puede jugar a su velocidad y salir de una cancion, y squash merge a `main`.
