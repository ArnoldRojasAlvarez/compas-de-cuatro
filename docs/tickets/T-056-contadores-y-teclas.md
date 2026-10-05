# T-056 · Contadores en partida, pulsaciones por tecla y atajos

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Rama** | `feat/contadores` (worktree) |
| **Depende de** | T-019, T-021, T-026, T-053 |

## Contexto

Arnold pidio ver, mientras juega y al terminar, cuantas notas de cada juicio
lleva (10 perfect, 2 miss) y cuantas veces pulso cada tecla. Ademas faltan
mejoras chicas que cualquier jugador de mania espera: barra de error de
timing, reintento rapido y saltar una intro larga.

Siempre minimalista: todo chico, pegado a la pista, en mono, sin etiquetas
largas. Cada elemento se puede apagar en ajustes.

## Contrato

### `game.ts`

```ts
export type ResultadoPartida =
  | {
      readonly estado: 'completado';
      readonly score: ScoreState;
      /** Pulsaciones (keydown) por columna en toda la partida, 4 numeros. */
      readonly pulsaciones: readonly number[];
      /** Las mismas que recibe resultados (tiempo, error, juicio). */
      readonly desviaciones: readonly Desviacion[];
    }
  | { readonly estado: 'abortado' }
  | { readonly estado: 'reintentar' };
```

Quien hoy lee `resultado.score` sigue funcionando.

### En partida (HUD, DOM, mismo patron de T-019: se crea una vez, solo se escribe lo que cambio)

1. **Contador de teclas**: debajo de cada carril, a la altura de los
   receptores o justo debajo de la pista, una cajita por columna con la tecla
   asignada (`D`, `F`...) y el numero de pulsaciones en mono. Se ilumina
   (borde `--acento`) mientras la tecla esta apretada. Cuenta keydown reales
   (incluye pulsaciones sin nota), no repeticiones de tecla mantenida.
2. **Contador de juicios**: columna chica al costado derecho de la pista (bajo
   la precision o pegada a la vida): seis numeros en mono con el color de cada
   juicio (MAX, 300, 200, 100, 50, MISS). Sin titulo.
3. **Barra de error** (hit error bar): centrada bajo la linea de juicio, ancha
   como la pista, con las ventanas de juicio del OD como franjas tenues de
   color, una marca central, y una rayita por golpe en su desviacion que se
   desvanece en ~2 s (de tiempo de juego, con el reloj). Una flechita marca
   la media movil de los ultimos ~20 golpes. Pool fijo de rayitas (sin
   allocaciones por golpe). Puede ser DOM o Pixi; elegi y justifica.

### Atajos

- **Reintento rapido**: mantener `` ` `` (Backquote) 0,5 s reintenta (mismo
  camino que "Reintentar" de la pausa). El tiempo se mide con `clock.now()` o
  con `event.timeStamp`, nunca con `setTimeout`. Mientras se mantiene, un
  aro o barra chica se llena en una esquina.
- **Saltar intro**: si la primera nota esta a mas de 5 s, aparece abajo a la
  derecha "Espacio para saltar" (chico, tenue) y `Space` hace `clock.seek` a
  2 s antes de la primera nota. Desaparece al pasar ese punto. El video (T-053)
  sigue al reloj solo.

### Resultados (`results.ts`)

- Junto a los conteos por juicio (que ya existen): una fila con las
  pulsaciones por tecla (`D 412 · F 398 · J 401 · K 405`) y el **UR**
  (unstable rate = 10 x desviacion estandar en ms, sin miss) en mono, con
  `title` explicando que es.
- `mostrarResultados` recibe `pulsaciones` opcional (el e2e y otros llamadores
  siguen funcionando sin pasarlo).

### Ajustes (`ajustes.ts`)

En la fila de Apariencia (junto a "Mostrar FPS"), tres interruptores mas:
"Teclas", "Juicios", "Barra de error", todos encendidos por defecto. Mismo
patron de preferencias que `apariencia.ts` (localStorage inyectable, tests).

## Criterios de aceptacion

- [ ] Las cajitas cuentan una pulsacion por keydown y se iluminan al apretar.
- [ ] El contador de juicios coincide con los conteos de resultados al final.
- [ ] La barra de error muestra cada golpe en su desviacion real (golpear
      tarde a proposito corre las marcas a un lado).
- [ ] Mantener ` medio segundo reintenta; soltar antes no.
- [ ] En un mapa con intro de mas de 5 s, Espacio salta y el reloj sigue
      sincronizado (sin desfase de notas).
- [ ] Con los tres interruptores apagados el HUD queda como antes.
- [ ] Sin allocaciones por frame nuevas; a 60 fps.
- [ ] Los cuatro checks y el e2e (`--workers=1`) en verde; agregar e2e de
      pulsaciones por tecla y del salto de intro si es viable.

## Tests

Logica pura en un `*-logica.ts` con tests: posicion de una marca en la barra
segun error y ventana maxima, alpha de la marca segun edad, media movil, UR,
progreso del reintento segun ms mantenidos, decision de mostrar el salto y el
destino del seek.

## Fuera de alcance

`song-select.ts`, `song-select.css`, `menu.ts`, storage y core (T-055 trabaja
ahi en paralelo). Guardar los records (T-055).
