# T-051 · Cancion demo incluida

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Rama** | `feat/cancion-demo` (worktree) |
| **Depende de** | T-049 (`EntradaOsz.fondo`), T-025 (core del mapeador) |

## Contexto

Un juego recien abierto tiene la biblioteca vacia: el menu suena con un click
track y el song select muestra un estado vacio. Para un **estado demo** el
juego tiene que traer una cancion propia, jugable, con fondo y varias
dificultades, sin depender de contenido de terceros (los `.osz` de osu! no se
pueden empaquetar, ver HANDOFF, "Decisiones de producto").

La solucion: una pieza corta **compuesta por codigo** (determinista), sintetizada
en el navegador con `OfflineAudioContext`, con sus mapas derivados de la propia
partitura (cada nota del mapa cae sobre un evento musical real) y un fondo
generativo dibujado con Canvas. Se siembra en la biblioteca la primera vez.

No es la cancion de Arnold para el curso; es material de demo.

## Contrato

Todo nuevo en `apps/web/src/demo/`, mas una linea en `main.ts`.

```ts
// demo/composicion.ts (pura, con tests)
export interface EventoMusical {
  /** ms desde el inicio de la pieza. */
  tiempo: number;
  /** ms; 0 para golpes de percusion. */
  duracion: number;
  voz: 'bombo' | 'caja' | 'hat' | 'bajo' | 'acorde' | 'melodia';
  /** Nota MIDI (percusion: cualquier valor fijo). */
  nota: number;
  /** 0 a 1. */
  intensidad: number;
}
export interface Composicion {
  bpm: number;
  /** ms totales, incluida la cola final. */
  duracion: number;
  /** ms de la seccion que mejor representa la pieza (para PreviewTime). */
  preview: number;
  eventos: EventoMusical[]; // ordenados por tiempo
}
export function componerDemo(): Composicion;

// demo/mapas.ts (pura, con tests)
export type NivelDemo = 'Facil' | 'Normal' | 'Dificil';
export function mapearDemo(composicion: Composicion, nivel: NivelDemo): Chart; // de @tetra/core

// demo/sintesis.ts (navegador)
export function sintetizarDemo(composicion: Composicion): Promise<AudioBuffer>; // OfflineAudioContext
export function codificarWav(buffer: AudioBuffer): Uint8Array; // PCM 16 bits

// demo/fondo.ts (navegador)
export function dibujarFondoDemo(ancho: number, alto: number): Promise<Blob>; // image/jpeg

// demo/index.ts
export const TITULO_DEMO = 'Primer Compas';
/**
 * Si la demo no se sembro nunca en este navegador (marca en localStorage
 * 'tetra:demo-sembrada') y la biblioteca no tiene una cancion con ese
 * titulo, la genera y la guarda con guardarCancionCreada (con fondo).
 * Al terminar dispara `window.dispatchEvent(new CustomEvent('tetra:biblioteca-cambio'))`.
 * Nunca lanza: un fallo se loguea con console.warn y la app sigue.
 * Si el usuario borra la demo, no vuelve (la marca ya esta puesta).
 */
export function asegurarCancionDemo(): Promise<void>;
```

`main.ts` llama `void asegurarCancionDemo()` despues de iniciar el router (no
bloquea el arranque).

## La musica

- 4/4, 128 BPM, unos 80 a 95 segundos. Tonalidad menor (por ejemplo la menor
  o re dorico). Estructura con forma: intro (solo hats y acordes), A (entra
  bombo, caja, bajo), B (melodia arriba, mas densidad), quiebre corto (sin
  bombo), A' final mas lleno, cola con el acorde final.
- Sintesis con nodos de Web Audio (osciladores, ruido para caja y hats,
  envolventes con `setValueAtTime`/`exponentialRampToValueAtTime`, un filtro
  pasabajos en los acordes, algo de eco simple con `DelayNode` en la melodia).
  Mezcla sin saturar: pico por debajo de -1 dBFS (normalizar al final).
  Mono o estereo, 44100 Hz.
- Tiene que sonar musical y agradable, no a prueba tecnica: progresion de
  acordes con sentido (por ejemplo i-VI-III-VII), melodia que respira.
- Determinista: sin `Math.random`; si hace falta azar, un PRNG con semilla.

## Los mapas

- Cada nota de cada mapa cae exactamente en el `tiempo` de un evento de la
  composicion (redondeado a ms entero).
- **Facil**: solo bombo y caja en negras, una nota a la vez, ~1.5 estrellas.
- **Normal**: corcheas, algunos dobles en los acentos, melodia en las partes B,
  ~2.5 estrellas.
- **Dificil**: semicorcheas de hats en las partes llenas, acordes como jumps y
  hands, LN en notas largas de melodia o acordes, ~3.5 a 4 estrellas.
- Columnas: la melodia se reparte por altura (grave a la izquierda); la
  percusion alterna para no generar jacks feos en Facil/Normal.
- Sin notas superpuestas en una misma columna (una LN ocupa su columna hasta
  `endTime` + 60 ms).
- `metadata`: titulo `TITULO_DEMO`, artista `Tetra`, creador `Tetra`,
  `difficultyName` el nivel, `audioFile` `audio.wav`, `previewTime`
  `composicion.preview`, `backgroundFile` `fondo.jpg`. OD 7, HP 7. Un timing
  point al bpm.
- Para guardarla: `guardarCancionCreada` de `@tetra/storage` con
  `escribirOsu` de `@tetra/core` por dificultad y `fondo: { nombre: 'fondo.jpg', bytes }`.

## El fondo

1920x1080, oscuro (paleta de `docs/DISENO.md`): gradiente profundo, una figura
geometrica de cuatro cuadrantes (anillos, arcos o lineas de onda en teal y un
toque ambar), grano sutil. Tiene que verse bien detras del song select con
blur y detras de la pista atenuado al 80 %. Determinista.

## Criterios de aceptacion

- [ ] Primera carga con biblioteca vacia: a los pocos segundos aparece "Primer
      Compas" con tres dificultades y fondo, sin bloquear el menu.
- [ ] Recargar no la duplica. Borrarla no la hace volver.
- [ ] Las estrellas calculadas (`calcularDificultad` de core) quedan
      ordenadas Facil < Normal < Dificil (test).
- [ ] La sintesis tarda menos de 3 s en una maquina normal (medir y reportar).
- [ ] Los cuatro checks en verde; e2e existentes siguen pasando.

## Tests

- `composicion.test.ts`: determinismo (dos llamadas iguales), eventos
  ordenados, dentro de `duracion`, bpm 128, preview dentro de la pieza.
- `mapas.test.ts`: notas ordenadas; cada nota coincide con un evento; sin
  superposicion por columna; densidad Facil < Normal < Dificil; estrellas
  ordenadas; `parseOsu(escribirOsu(chart))` da las mismas notas.
- `codificarWav` se puede testear con un objeto con la forma de AudioBuffer
  (numberOfChannels, sampleRate, length, getChannelData): cabecera RIFF correcta.

## Fuera de alcance

Menu y song select (T-052), partida (T-053). Mas de una cancion demo.

## Terminado cuando

Los cuatro checks en verde y el reporte incluye cuanto tarda la sintesis y las
estrellas de cada dificultad.
