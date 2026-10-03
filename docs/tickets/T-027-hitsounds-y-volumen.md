# T-027: Hitsounds y volumenes

Prioridad: alta. Tamano: M. Modelo: Sonnet. Archivos: `packages/audio/src/` (hitsounds), `apps/web/src/game.ts`, `apps/web/src/ajustes.ts`, nuevo `apps/web/src/volumen.ts`.

## Contexto

La partida no hace ningun sonido al golpear una nota y la unica musica de fondo es el click track del menu. Un juego de ritmo necesita el retorno sonoro del golpe, y el jugador necesita balancear musica y efectos. Tampoco hay control de volumen en ninguna parte.

## Contrato

```ts
// packages/audio: generacion de hitsounds sin archivos (no toca el DOM salvo AudioContext inyectado)
export type TipoHitsound = 'normal' | 'suave' | 'seco';
export function crearHitsound(ctx: BaseAudioContext, tipo: TipoHitsound): AudioBuffer;
export function reproducirHitsound(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  cuando: number, // tiempo de ctx, no de pared
  volumen: number, // 0 a 1
): void;

// apps/web/src/volumen.ts (mismo patron que velocidad.ts: storage inyectable)
export interface Volumenes { musica: number; efectos: number } // 0 a 1
export const VOLUMENES_DEFAULT: Volumenes;
export function leerVolumenes(storage?: Storage): Volumenes;
export function guardarVolumenes(v: Volumenes, storage?: Storage): void;
```

## Comportamiento

- Cada golpe valido (no miss) dispara el hitsound en el instante del evento de teclado ya convertido a tiempo de juego (`toGameTime`), programado con `source.start(cuando)`. El miss no suena.
- La musica pasa por un `GainNode` con el volumen de musica; los efectos por otro con el de efectos.
- Ajustes: dos sliders (musica, efectos) con valor numerico visible, y un selector de tipo de hitsound con boton "Probar".
- El menu (logo) y el preview del song select respetan el volumen de musica.

## Criterios de aceptacion

- [ ] Golpear suena sin latencia perceptible y sin allocaciones por golpe (el buffer se crea una vez por partida).
- [ ] Efectos en 0 silencia los golpes; musica en 0 silencia la cancion pero el reloj sigue corriendo.
- [ ] Los volumenes persisten al recargar y un valor corrupto vuelve al default.
- [ ] El gameplay sigue leyendo el tiempo solo de `audioContext.currentTime`.

## Tests

- `leerVolumenes` / `guardarVolumenes`: default, corrupto, fuera de rango (se recorta), ida y vuelta.
- `crearHitsound` con un `OfflineAudioContext` falso: largo, que no sea silencio, que cada tipo difiera.
- Que implementacion incorrecta los haria fallar: un recorte que deje pasar 1.5 debe fallar el test de rango.

## Fuera de alcance

Hitsounds propios cargados desde skins `.osk` (ticket futuro). Hitsounds por nota larga (cola y fin).

## Terminado cuando

Checks en verde y se probo golpeando en el navegador (esta vez con el volumen de musica en 0, no con el silenciador de dev).
