# T-001-F1 · Correcciones de la revision de T-001

| | |
|---|---|
| **Fase** | 1 · Nucleo jugable |
| **Modelo** | Sonnet |
| **Rama** | `feat/audio-clock` (la misma, no abrir otra) |
| **Origen** | Revision de Opus sobre el commit de T-001 |

## Resumen de la revision

La implementacion de `clock.ts` esta bien y el contrato se respeto. **Los cuatro
hallazgos son defectos de mi especificacion, no del codigo entregado.** Tres son
de cobertura de tests y uno es un cambio de contrato.

---

## H1 · La prueba de deriva no prueba nada (grave)

En `clock.test.ts`, la prueba de 3 minutos compara:

```
posicionReal = raw.currentTime * 1000
clock.now()  = (ctx.currentTime - startedAt) * 1000 - offset
```

Con `start(0)` sobre un contexto que arranca en `currentTime = 0`, queda
`startedAt = 0` y `offset = 0`. La comparacion es `x` contra `x`: una identidad
algebraica. **Ese test no puede fallar, ni siquiera si la implementacion
estuviera mal.** Da 0 ms porque no esta midiendo nada.

Yo escribi ese criterio en T-001 y estaba mal planteado. La deriva real que el
ticket queria atrapar es la del renderizador contra el audio, y esa solo se
puede medir en un navegador con audio de verdad, no en vitest.

**Qué hacer:**

1. Reemplazar la prueba por una que si pueda fallar: el doble de prueba avanza
   `currentTime` con **jitter**, es decir pasos irregulares (por ejemplo entre
   12 y 20 ms en lugar de 16.67 fijos), simulando frames que no llegan parejos.
   Y ademas se lleva un contador propio, tipo `tiempoAcumulado += paso`, que
   representa lo que haria una implementacion ingenua basada en deltas.
2. La prueba debe verificar dos cosas a la vez:
   - `clock.now()` sigue pegado a la posicion real del audio (menos de 5 ms).
   - El contador ingenuo **si** se despega. Si no se despega, el escenario de
     prueba no es representativo y hay que subirle el jitter.
3. Renombrar el test a algo que diga la verdad de lo que mide, por ejemplo
   `now() sigue al audio aunque los frames lleguen irregulares`.
4. Dejar un comentario arriba del test aclarando que la deriva real contra
   hardware de audio se mide en el navegador y queda para el ticket de e2e.

---

## H2 · El test que lee su propio codigo fuente se elimina

El primer test abre `clock.ts` con `readFileSync` y busca `performance.now` y
compania. Es fragil (se rompe si el archivo se mueve) y solo cubre ese archivo.

Ya puse la verificacion donde corresponde: `eslint.config.js` ahora tiene
`no-restricted-globals` y `no-restricted-properties` para `setTimeout`,
`setInterval`, `requestAnimationFrame`, `performance.now` y `Date.now` en los
tres paquetes, mas las reglas de pureza de `core`.

**Qué hacer:**

1. Borrar ese test y el `import { readFileSync } from 'node:fs'`.
2. Quitar `@types/node` de las devDependencies de la raiz **si ya nada mas lo
   necesita**. Verificalo antes de quitarlo: si `vitest.config.ts` u otro
   archivo lo requiere, dejalo y decilo en el reporte.
3. Comprobar que la regla de lint funciona: meté temporalmente un
   `Date.now()` en `clock.ts`, corré `npm run lint`, confirmá que falla, y
   quitalo. Reportá que lo verificaste.

---

## H3 · `seek()` y `offset` no estan definidos juntos (cambio de contrato)

El criterio de T-001 decia que `seek(30000)` deja `now()` dentro de 5 ms de
30000. Eso solo se cumple con `offset = 0`, que es justo lo que usa el test
actual. Con un offset realista (20 ms de usuario mas 30 ms de latencia de
salida) `now()` devuelve 29950 y el criterio falla.

**El comportamiento actual es el correcto y el criterio estaba mal.** La razon:
`offset` compensa que el sonido que se escucha ahora se programo hace
`outputLatency`. Justo despues de un `seek`, el jugador todavia esta oyendo el
audio anterior, asi que el tiempo de juego debe ir atrasado respecto al buffer.

**Qué hacer:**

1. No cambiar la implementacion de `seek()`.
2. Cambiar el test para que verifique `now() === time - offset`, y correrlo con
   un offset distinto de cero.
3. Documentar la relacion en el JSDoc de `seek()`.

---

## H4 · `offset` mutable pierde la latencia (cambio de contrato)

`offset` es un campo publico que vale `userOffset + latencyOffset`. Cuando la
pantalla de config cambie el offset del usuario, lo natural es escribir
`clock.offset = nuevoValor`, y eso **borra silenciosamente la latencia de
salida**. El contrato invita al error. Es culpa mia, no del codigo.

**Cambio de contrato aprobado:**

```ts
export interface AudioClock {
  // ...
  /** Offset manual del usuario, en ms. Se puede cambiar en caliente. */
  userOffset: Ms;

  /** Latencia de salida detectada, en ms. Solo lectura. */
  readonly outputLatency: Ms;

  /** Compensacion total aplicada a now(). Derivada: userOffset + outputLatency. */
  readonly offset: Ms;
}
```

**Qué hacer:**

1. Aplicar el cambio: `userOffset` mutable, `outputLatency` y `offset` de solo
   lectura, con `offset` calculado como getter.
2. Actualizar `packages/core/src/types.ts` **no hace falta**: esta interfaz vive
   en `packages/audio`.
3. Tests: cambiar `userOffset` en caliente mueve `now()` esa cantidad, y
   `offset` refleja siempre la suma de los dos.
4. Actualizar el contrato dentro de `docs/tickets/T-001-reloj-audio.md` para que
   el ticket quede consistente con lo implementado.

---

## H5 · La rama de `outputLatency` nunca se ejecuta (cobertura)

`crearContextoFalso(outputLatency = 0)` siempre se llama sin argumento, asi que
`calcularOffsetInicial` nunca entra en la rama de latencia.

**Qué hacer:** agregar tests con `outputLatency` de 0.03 (30 ms):

- Con `useOutputLatency: true` (el valor por defecto), `offset` vale
  `userOffset + 30`.
- Con `useOutputLatency: false`, `offset` vale solo `userOffset`.
- Con `outputLatency` en `undefined`, se ignora y no rompe.

---

## Fuera de alcance

No toques `start()`, `stop()`, el manejo de sources ni el clamping de `seek()`.
Las decisiones 1 a 4 que reportaste quedaron aprobadas tal como estan.

## Terminado cuando

Los cuatro checks en verde, la prueba de deriva demostrando que un contador
ingenuo si se despega, y commit en `feat/audio-clock`.
