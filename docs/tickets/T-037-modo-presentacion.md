# T-037: Modo presentacion

Prioridad: alta (la presentacion en vivo es la semana 17). Tamano: S. Modelo: Sonnet. Archivos: nuevo `apps/web/src/presentacion.ts` y `presentacion.css`, `apps/web/src/header.ts` (solo leer la clase), `apps/web/src/ajustes.ts`.

## Contexto

El proyecto se ejecuta en vivo ante publico. En ese momento sobra todo lo que no es el juego: el header con la hora, el cursor, las barras del navegador, y cualquier cosa que distraiga. Tambien hace falta que el audio y el juego arranquen con un gesto del presentador sin sorpresas (politica de autoplay).

## Contrato

```ts
export interface EstadoPresentacion { activo: boolean }
export function leerPresentacion(storage?: Storage): EstadoPresentacion;
export function guardarPresentacion(e: EstadoPresentacion, storage?: Storage): void;
/** Activa o desactiva: pantalla completa, clase `tetra-presentacion` en <body>, cursor oculto tras 2 s sin moverse. */
export function alternarPresentacion(): Promise<void>;
```

## Comportamiento

- Atajo F (fuera de partida) o boton en ajustes: entra y sale de pantalla completa (Fullscreen API) y pone `body.tetra-presentacion`.
- En modo presentacion: header oculto, cursor oculto tras 2 s de inactividad (reaparece al mover el mouse), sin texto de ayuda ni avisos secundarios, escala de la UI un 10 % mas grande.
- Si el usuario sale de pantalla completa con Esc del navegador, el modo se desactiva solo.
- Una lista corta "Antes de presentar" en ajustes: calibrar el offset, probar la cancion, comprobar el volumen, con casillas que solo recuerdan (no bloquean nada).
- El temporizador de ocultar el cursor es solo de interfaz: lleva su `eslint-disable` justificado, nunca toca el reloj de juego.

## Criterios de aceptacion

- [ ] F entra a pantalla completa y oculta el header; F otra vez o Esc lo restaura.
- [ ] En partida el comportamiento no cambia (el header ya se oculta ahi).
- [ ] Funciona con el song select y los resultados sin romper el layout.

## Tests

- Logica pura de lectura y guardado del estado.
- Que implementacion incorrecta los haria fallar: una que no respete el valor corrupto debe fallar el test de default.
- Prueba manual documentada: entrar y salir tres veces seguidas.

## Fuera de alcance

Control remoto, segunda pantalla, grabacion de pantalla integrada.

## Terminado cuando

Checks en verde y se probo en pantalla completa real en el navegador.
