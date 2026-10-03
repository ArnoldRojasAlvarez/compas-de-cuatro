# T-047: Primera ejecucion guiada

Prioridad: baja. Tamano: M. Modelo: Sonnet. Archivos: nuevo `apps/web/src/bienvenida.ts` y `.css`, `apps/web/src/router.ts`, `apps/web/src/offset.ts` y `teclas.ts` (solo reutilizar).

## Contexto

Quien abre Tetra por primera vez cae en el menu sin saber que debe calibrar el offset de audio ni elegir sus teclas, y empieza a jugar con timing desfasado y pensando que juega mal. Durante la presentacion otra persona (un companero o el profesor) puede querer probarlo: tiene que poder hacerlo en un minuto.

## Contrato

```ts
export type PasoBienvenida = 'teclas' | 'offset' | 'volumen' | 'listo';
export interface EstadoBienvenida { completada: boolean; paso: PasoBienvenida }
export function leerBienvenida(storage?: Storage): EstadoBienvenida;
export function guardarBienvenida(e: EstadoBienvenida, storage?: Storage): void;
export function siguientePaso(p: PasoBienvenida): PasoBienvenida;
```

## Comportamiento

- Se muestra solo si no hay marca de completada. Cuatro pasos cortos, cada uno con "Omitir":
  1. **Teclas:** confirmar D F J K o remapear (reusa el control de `ajustes.ts`).
  2. **Offset:** una calibracion de unos 10 golpes siguiendo un metronomo visual y sonoro; calcula el offset con la funcion que ya usa T-007 y lo guarda.
  3. **Volumen:** musica y efectos (si T-027 existe).
  4. **Listo:** boton "Jugar la cancion de ejemplo" que abre el click track.
- Se puede relanzar desde ajustes ("Repetir la guia").
- Nada bloquea: omitir todo deja la app en el estado por defecto.

## Criterios de aceptacion

- [ ] Una instalacion limpia muestra la guia; despues de completarla u omitirla no vuelve a aparecer.
- [ ] La calibracion guarda un offset con el signo correcto (verificado con el test que ya cubre la direccion del offset en `offset.test.ts`).
- [ ] El modo presentacion (T-037) y esta guia no se pisan: la guia nunca aparece en modo presentacion.

## Tests

- Maquina de pasos (`siguientePaso`) y persistencia, con valores corruptos.
- Calculo del offset a partir de golpes simulados con un desfase conocido (+30 ms) debe devolver ese desfase con signo.
- Que implementacion incorrecta los haria fallar: una que invierta el signo del offset debe fallar el caso del +30 ms.

## Fuera de alcance

Tutorial de jugabilidad (como funcionan las notas largas, etc.).

## Terminado cuando

Checks en verde y se recorrio la guia completa con un perfil limpio del navegador.
