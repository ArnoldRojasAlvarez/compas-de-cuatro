# T-062 · Modo practica: calibrar jugando la cancion

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Opus (contrato del ritmo en el reloj) + Sonnet |
| **Prioridad** | Alta: pedido de Arnold, 8 de octubre |
| **Depende de** | T-060 y T-061 (fusionados antes: tocan el mismo bucle), T-057, T-058, T-044 |

## Contexto

Arnold pidio un modo para calibrar "donde tocar", la velocidad y el offset
**dentro de la cancion**, de forma inmersiva, y no en una pantalla de ajustes
con texto. Hoy cada cambio es: salir, ajustar, volver a entrar, jugar.

## La idea

Se entra a una dificultad en **modo practica** y se juega normalmente, con un
panel chico y translucido pegado al costado de la pista. Cada control cambia
la pista **en vivo** mientras las notas caen (o en pausa, viendo como se
reacomodan). Nada de lo que pase en practica cuenta: sin record, sin historial,
sin replay, sin fallar por vida.

## Entrada

- Song select: boton-icono "Practicar" (aria-label exacto) junto a "Ver auto";
  atajo `Shift+Enter`.
- Etiqueta `PRÁCTICA` arriba a la izquierda (como `AUTO`), en `--acento`.

## El panel (lado derecho de la pista, ~220 px, translucido)

Controles en vivo, con el mismo componente de barra de ajustes (T-058):

1. **Velocidad de caida** (1 a 12): las notas se reacomodan al instante.
   Guarda la preferencia global (`guardarVelocidad`).
2. **Offset de esta cancion** (-150 a +150, con `-`/`+` de 1 ms): efecto
   inmediato (`clock.userOffset`). Debajo, la **media en vivo** de los ultimos
   ~30 golpes (de T-060) y un boton `Aplicar +23 ms` que suma esa media al
   offset y reinicia la media. Guarda con `guardarOffsetLocal`.
3. **Posicion de golpe** (altura de la linea de juicio, 8 % a 40 % desde abajo):
   la linea, los receptores y las notas se mueven al instante. Es una
   preferencia **nueva y global** (`apps/web/src/posicion-golpe.ts`, patron de
   `velocidad.ts`); la partida normal tambien la usa en vez del 15 % fijo de
   T-053.
4. **Ritmo** (0,5x a 1,5x en pasos de 0,05; solo practica, no se guarda): la
   cancion suena mas lenta o rapida (cambia el tono, aceptado) y las notas la
   siguen. Ver "Contrato del ritmo".
5. **Tramo en bucle**: sobre la barra de progreso se marcan A y B (teclas `[` y
   `]` en el instante actual, o arrastrando dos marcas). Al pasar B vuelve a
   A - 2 s. `\` lo quita. Las notas antes de A no generan miss.
6. Interruptores rapidos: barra de error, contadores, fondo (atenuacion).

- El panel se pliega con `Tab` (queda una pestanita). Con el mouse sobre el
  panel, las teclas de columna siguen yendo al juego.
- En pausa (Escape) el panel queda activo y la pista sigue dibujando el
  instante pausado: mover velocidad o posicion de golpe se ve en vivo.
- Al salir, resultados de practica sin record ni "Corregir offset" (ya se
  ajusto en vivo), con una linea: `Offset de la canción +23 ms · Velocidad 7 ·
  Golpe 15 %`.

## Contrato del ritmo (lo decide Opus, lo implementa Sonnet)

El tiempo de juego es **tiempo de la cancion** (ms del audio original): las
notas, las ventanas de juicio y los replays no cambian. Solo cambia cuanto
avanza la cancion por segundo real.

```ts
// packages/audio/src/clock.ts
export interface AudioClock {
  // ...lo que hay...
  /** 1 = normal. Cambiarlo re-ancla el reloj en la posicion actual (sin salto) y
   *  pone `playbackRate` al source. `now()` avanza `ritmo` ms de cancion por ms de contexto. */
  ritmo: number;
}
```

- `now() = posicionAnclada + (ctx.currentTime - ctxAnclado) * 1000 * ritmo - offset`.
  El offset (usuario + latencia) se resta en ms **reales** convertidos a ms de
  cancion (`offset * ritmo`), porque la latencia de salida es del mundo real:
  documentarlo y testearlo.
- `seek`, `pause`/`resume` y el cambio de ritmo re-anclan; `playbackRate` del
  source siempre igual a `ritmo`.
- La entrada (`toGameTime(event.timeStamp)`) convierte con el mismo ancla y el
  mismo ritmo: un golpe justo en el beat da error 0 a cualquier ritmo (test).
- Las ventanas de juicio quedan en ms de cancion: a 0,5x son el doble de anchas
  en tiempo real. Es lo esperado en practica.
- El video (T-053) usa `playbackRate` igual al ritmo y sigue sincronizado.
- Hitsounds: sin cambios (suenan en el instante real del golpe).

## Criterios de aceptacion

- [ ] Cambiar velocidad, offset y posicion de golpe durante la cancion se ve en
      el acto, y queda guardado para las partidas normales.
- [ ] "Aplicar" con una media de +60 (e2e que pulsa tarde) lleva la media a ~0.
- [ ] A 0,75x: un golpe justo en la nota da error ~0 (e2e con pulsacion
      simulada) y el audio y las notas no se desfasan en 30 s (como la prueba
      de deriva de T-001, a otro ritmo).
- [ ] El bucle A-B repite sin miss de las notas salteadas.
- [ ] Practica no guarda record, historial ni replay.
- [ ] Los cuatro checks y el e2e completo en verde; `clock.test.ts` cubre ritmo,
      re-anclaje, seek con ritmo y offset con ritmo.

## Fuera de alcance

Ritmo fuera de practica (mods tipo DT/HT con record propio). Mantener el tono al
cambiar el ritmo (time-stretch).
