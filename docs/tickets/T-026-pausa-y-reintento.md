# T-026: Pausa en partida y reintento rapido

Prioridad: alta. Tamano: M. Modelo: Sonnet. Archivos: `apps/web/src/game.ts`, nuevo `apps/web/src/pausa.ts` y `pausa.css`, `apps/web/src/song-select.ts` (solo el manejo del resultado).

## Contexto

Hoy Escape abandona la partida sin preguntar (T-008) y no hay forma de pausar ni de reintentar. En una presentacion en vivo un Escape accidental pierde la partida entera. Los juegos del genero resuelven esto con una pausa que no cuenta como abandono y con un reintento instantaneo.

## Contrato

```ts
// game.ts: el resultado gana un tercer estado.
export type ResultadoPartida =
  | { readonly estado: 'completado'; readonly score: ScoreState }
  | { readonly estado: 'abortado' }
  | { readonly estado: 'reintentar' };

// pausa.ts (DOM plano, nada de React dentro del loop)
export interface MenuPausa {
  destruir(): void;
}
export function mostrarMenuPausa(
  contenedor: HTMLElement,
  acciones: { continuar(): void; reintentar(): void; salir(): void },
): MenuPausa;
```

## Comportamiento

- Escape durante la partida PAUSA (antes abortaba). Aparece el menu: Continuar, Reintentar, Salir al song select. Escape de nuevo continua.
- Al pausar se suspende el `AudioContext` del juego (`ctx.suspend()`): el reloj de audio se congela solo, `clock.now()` no avanza. No se usa ningun temporizador para medir la pausa.
- Continuar: cuenta regresiva visible de 3 segundos antes de reanudar. La cuenta se mide con un `AudioContext` auxiliar o con el mismo reloj tras `resume()`, nunca con `setTimeout` de gameplay; si hace falta un temporizador solo para pintar los numeros, lleva su `eslint-disable` justificado como en `header.ts`.
- Reintentar: limpia todo (igual que `abortar()`) y resuelve `{ estado: 'reintentar' }`; song-select vuelve a llamar a `runGame` con el mismo chart y audio.
- Salir: igual que el abortar de hoy.
- Las pulsaciones durante la pausa no llegan al motor de juicio.
- El tiempo jugado del header (`sumarTiempoJugado`) cuenta solo lo reproducido, no la pausa.

## Criterios de aceptacion

- [ ] Escape pausa y el audio se detiene; Continuar reanuda en el mismo punto (la desviacion medida en `clock.now()` antes y despues de la pausa es 0 mas la cuenta regresiva).
- [ ] Reintentar reinicia la partida sin volver a decodificar el audio.
- [ ] Una nota que cae durante la pausa no genera un miss (el reloj esta congelado).
- [ ] Sin `performance.now()`, `Date.now()` ni `setInterval` para medir tiempo.
- [ ] `prefers-reduced-motion` respetado en la cuenta regresiva.

## Tests

- Logica pura de la maquina de estados de pausa (`jugando -> pausado -> cuenta -> jugando`) en un archivo `pausa-logica.ts` testeable sin DOM: transiciones validas e invalidas (continuar estando jugando no hace nada).
- Que implementacion incorrecta los haria fallar: una que avance el reloj durante `pausado` debe romper el test de "tiempo congelado".
- e2e (ver T-041): pausar a los 2 s, esperar, continuar, y comprobar que `clock.now()` no salto.

## Fuera de alcance

Guardar la partida pausada entre sesiones. Pausar el mapeador (ya tiene su propio play/pausa).

## Terminado cuando

Los cuatro checks en verde, el e2e de sincronia sigue pasando, y se vio pausar y reintentar en el navegador con el audio silenciado.
