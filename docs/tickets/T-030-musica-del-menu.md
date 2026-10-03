# T-030: Musica del menu elegible

Prioridad: media. Tamano: M. Modelo: Sonnet. Archivos: `apps/web/src/logo.ts` (solo la fuente de audio), nuevo `apps/web/src/musica-menu.ts`, `apps/web/src/ajustes.ts`.

## Contexto

La musica del menu es el click track en bucle (`docs/ESTADO.md`, "Deuda declarada"): sirve para probar el reloj, no para recibir al jugador. Con el mapeador, Arnold va a tener su propia cancion en la biblioteca; que suene en el menu hace la presentacion mucho mas redonda, y el logo ya reacciona al audio.

## Contrato

```ts
export type FuenteMusicaMenu =
  | { tipo: 'click-track' }
  | { tipo: 'cancion'; songId: string }
  | { tipo: 'silencio' };

export function leerFuenteMusicaMenu(storage?: Storage): FuenteMusicaMenu;
export function guardarFuenteMusicaMenu(f: FuenteMusicaMenu, storage?: Storage): void;

// Resuelve el AudioBuffer a reproducir. Cae al click track si la cancion ya no existe.
export function resolverBufferDeMenu(
  fuente: FuenteMusicaMenu,
  deps: { cargarCancion(id: string): Promise<AudioBuffer | undefined>; clickTrack(): Promise<AudioBuffer> },
): Promise<AudioBuffer | null>; // null = silencio
```

## Comportamiento

- Ajustes: seccion "Menu" con un selector (Click track, Silencio, y cada cancion de la biblioteca por nombre).
- El menu reproduce el fragmento desde `previewTime` de la primera dificultad, en bucle suave (fade de 1 s al reiniciar).
- Respeta el volumen de musica de T-027 (si ya esta hecho; si no, volumen fijo actual).
- El logo sigue pulsando con el espectro del audio elegido; con "Silencio" queda quieto y respirando.

## Criterios de aceptacion

- [ ] Elegir una cancion en ajustes hace que suene al volver al menu.
- [ ] Borrar esa cancion de la biblioteca no rompe el menu: cae al click track.
- [ ] El audio del menu se detiene al entrar al song select, ajustes, mapeador o una partida (nada de audios colgados, como ya exige `menu.ts`).

## Tests

- `leerFuenteMusicaMenu`: default, corrupto, cancion inexistente.
- `resolverBufferDeMenu`: cancion existente, inexistente (cae a click track), silencio devuelve null.
- Que implementacion incorrecta los haria fallar: una que devuelva siempre el click track debe fallar el caso "cancion existente".

## Fuera de alcance

Listas de reproduccion, visualizadores nuevos, musica distinta por pantalla.

## Terminado cuando

Checks en verde y se vio sonar la cancion elegida en el menu (con el volumen de musica bajo, no con el silenciador de dev).
