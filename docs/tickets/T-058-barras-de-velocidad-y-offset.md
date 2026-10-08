# T-058 · Velocidad y offset con barra, como el volumen

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Rama** | `feat/barras-ajustes` (worktree) |
| **Depende de** | T-023, T-053, T-027 |

## Contexto

Arnold pidio que la velocidad y el offset se ajusten con una barra (slider)
como el volumen y los efectos: le resulta mas comodo que los botones `-1`/`+1`
con el numero en el medio.

## Que cambia (solo `apps/web/src/ajustes.ts` y `ajustes.css`)

- **Velocidad**: barra de 1 a 12, paso 1, con el mismo estilo que Volumen
  (mismo componente si ya existe uno). A la derecha, en mono, el valor y los ms:
  `7 · 514 ms`. Guarda al mover (`guardarVelocidad`), igual que el volumen.
- **Offset**: barra de -150 a +150 ms, paso 1, con el 0 marcado en el centro
  del riel (una rayita). A la derecha el valor con signo en mono (`+12 ms`,
  `0 ms`, `-8 ms`). Como arrastrar no alcanza para ajustar de a 1 ms, dos
  botones-icono chicos `−` y `+` a los costados de la barra mueven de a 1 ms
  (Shift+clic de a 5). Doble clic sobre la barra vuelve a 0. Si el offset
  guardado esta fuera de ±150 (el de calibracion admite mas), la barra queda
  en el tope y el numero muestra el valor real; mover la barra lo reemplaza.
- Teclado: con la barra enfocada, las flechas mueven un paso (nativo de
  `input[type=range]`), Shift+flecha 5 ms en el offset.
- Las explicaciones largas siguen en `title`.
- Ajustes tiene que seguir entrando en 1280x800 sin scroll de pagina (el e2e
  `partida.spec.ts` lo mide). Hoy la tarjeta Juego va en pares: Offset junto a
  Golpe, Velocidad sola, Volumen junto a Efectos. Reacomoda lo que haga falta
  sin perder ningun control y sin que nada quede apretado.
- Que las cuatro barras (offset, velocidad, volumen, efectos) y la de atenuar
  fondo se vean iguales: mismo largo de riel, misma columna para el valor.

## Criterios de aceptacion

- [ ] Velocidad y offset se ajustan con barra, guardan al mover y la partida
      siguiente los usa.
- [ ] `−`/`+` del offset mueven 1 ms; Shift 5; doble clic vuelve a 0.
- [ ] Ajustes entra en 1280x800 sin scroll.
- [ ] Los cuatro checks y el e2e (`--workers=1`) en verde; actualizar los e2e
      que usaban los botones `-1`/`+1` de velocidad u offset si los hay.

## Tests

Logica pura en `*-logica.ts`: formateo `7 · 514 ms`, formateo del offset con
signo, recorte del offset a la barra sin perder el valor real.

## Fuera de alcance

El control de offset por cancion del song select (T-057) y el aviso de F3/F4
(quedan como estan). `game.ts`, `song-select.ts`, `results.ts`, `mapeador.ts`,
`packages/*` (T-044 trabaja ahi en paralelo).
