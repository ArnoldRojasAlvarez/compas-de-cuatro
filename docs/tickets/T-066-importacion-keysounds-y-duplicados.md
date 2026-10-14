# T-066 · Importación: errores claros, sin duplicados y sets con audio virtual (keysounds)

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet (un despacho por paso) |
| **Ramas** | `fix/importacion-errores-y-duplicados` (paso 1), `feat/sets-multi-cancion` (paso 2), `feat/audio-virtual` (paso 3) |
| **Depende de** | T-005, T-011, T-042, T-049, T-054, T-055, T-057, T-063, T-065 |

## Contexto

Arnold reportó tres problemas al importar `.osz`:

**A. Un set de piano no se importa.** `332673 Collection - Piano Beatmap Set.osz`
(20 MB) falla con "No se pudo importar 332673 Collection - Piano Beat...".
Inspección del archivo (solo lectura, no está en el repo):

- 359 entradas: 114 `.osu`, 244 `.ogg` (estéreo, 44,1 kHz, de 1,2 a 6,5 s,
  mediana 2,4 s; 20 MB en total) y un `.jpg` de fondo.
- Los 114 `.osu` son `Mode: 3`. Por teclas: 15 de 4K, 15 de 5K, 15 de 7K y 69
  de 10K. Todos con `BeatmapSetID:332673` y su propio `BeatmapID`.
- Cada dificultad es una **pieza distinta** dentro del mismo set:
  `[Canon - 4K EX]`, `[La Campanella - 4K Full]`, `[Turkish March - 4K EX]`,
  `[4K HELL CIRCUS]`... Todas con `Title:Piano Beatmap Set`,
  `Artist:Collection`. Entre las 15 de 4K hay 14 piezas con el formato
  `<pieza> - 4K <nivel>` y una sin separador (`4K HELL CIRCUS`).
- Todas declaran `AudioFilename: virtual`: **no hay pista de música**. El
  sonido sale de dos fuentes, que hay que mezclar juntas:
  1. **Keysounds por nota**: el último campo del hitSample de cada hit object.
     Tap: `192,192,4800,5,0,0:0:0:0:l_045.ogg`; LN:
     `192,192,100850,128,0,105600:0:0:0:0:l_033.ogg` (el `endTime` va antes).
     En las 15 dificultades de 4K, el 100 % de las notas trae archivo y el
     campo volumen del hitSample es `0` (usar el volumen del punto de tiempo).
  2. **Samples del storyboard** en `[Events]`:
     `Sample,4800,0,"l_029.ogg",100` (tiempo, capa, archivo, volumen). Son el
     acompañamiento que no se toca. Hay de 36 (`Fantaisie Impromptu - 4K EX`)
     a 12 644 (`4K HELL CIRCUS`) por dificultad, todos en la capa 0 con
     volumen 100.
- Todos los archivos referenciados existen en el zip. Duración de las piezas de
  4K: de 88 s a 249 s. Peor caso (`4K HELL CIRCUS`): 17 327 eventos, 166
  muestras distintas, 239 s.

**Causa del fallo:** las 15 de 4K parsean bien, pero `extraerCancionDeOsz`
busca el archivo `virtual` en el zip, no lo encuentra y lanza "El .osz no trae
el archivo de audio declarado (AudioFilename:virtual)". El song select muestra
solo "No se pudo importar <nombre>" y deja el detalle en el `title` (T-054),
así que Arnold nunca lo vio. Aunque el audio existiera, hoy las 15 piezas
quedarían como **una sola canción** con 15 "dificultades" que en realidad son
obras distintas.

**B. Mensajes de error inútiles.** El texto visible nunca dice la causa. Y
varias causas ni siquiera se distinguen: un `.osz` solo de 7K y uno de osu!
standard dan el mismo "ninguna dificultad de mania 4K válida"; un zip dañado
muestra el error crudo de fflate en el `title`.

**C. Reimportar duplica.** `importarOsz` crea siempre un id nuevo
(`crypto.randomUUID()`). Arnold importó un `.osz` dos veces a propósito y
tiene dos canciones iguales. Los records, replays y recientes no se pierden
(se indexan por `hashMapa`, que es igual en las dos copias) pero el offset por
canción (T-057, clave `tetra:offset-local:<songId>`) queda en una sola de las
dos, y la lista muestra la canción dos veces. Ojo: el comentario de
`offset-local.ts` dice "reimportar el mismo .osz da el mismo id", y hoy es
falso; después del paso 1 pasa a ser cierto.

## Decisiones de diseño

### D1. Tres pasos que se fusionan por separado

Cada paso deja `main` en verde y jugable:

1. **Errores claros + deduplicación + fusión de duplicados existentes.** Sin
   cambio de base. Con este paso el set de piano falla con un mensaje que dice
   exactamente por qué ("usa audio virtual y Tetra todavía no lo soporta").
2. **Un `.osz` puede dar varias canciones.** Agrupación de dificultades en
   canciones (por archivo de audio, o por pieza en los sets de audio virtual).
   El audio virtual sigue rechazado: el paso solo cambia la forma del
   resultado y se prueba con sets sintéticos de audio real.
3. **Audio virtual.** Parseo de keysounds y samples del storyboard, tienda de
   muestras compartidas (base v9), render al cargar, integración con partida,
   preview, música del menú, exportar y respaldo. Con este paso el set de
   piano entra como 15 canciones.

### D2. Identidad de una dificultad (para deduplicar)

Una dificultad tiene una o dos **claves de identidad**:

- `id:<BeatmapID>` si el `.osu` trae `BeatmapID` mayor que 0 (los no
  publicados traen 0 o -1: se ignoran). Requiere que `parseOsu` lea
  `BeatmapID` y `BeatmapSetID` de `[Metadata]` (campos nuevos, opcionales).
- `contenido:<hashMapa>|<titulo>|<artista>`, siempre. `hashMapa` es el mismo
  hash de notas y OD que ya indexa records, replays y recientes (T-055, T-044,
  T-065); título y artista se normalizan (recorte, minúsculas, espacios
  colapsados). **No** entra el `difficultyName`: dos dificultades con las
  mismas notas y el mismo OD dentro de la misma canción no tienen sentido, y
  dejarlo afuera evita que un renombre rompa la identidad.

Por qué no un hash del texto del `.osu`: las canciones ya guardadas no
conservan el texto, y la fusión de los duplicados existentes (lo que pidió
Arnold) tiene que funcionar con lo que hay en la base. `hashMapa` sí se puede
calcular sobre lo guardado, y además es justo la clave de los records: dos
dificultades con la misma identidad de contenido comparten records por
construcción, así que fusionarlas no pierde nada.

Dos canciones son **la misma** si alguna dificultad de una comparte alguna
clave de identidad con alguna de la otra. Es una relación de equivalencia por
clausura (unión y búsqueda).

### D3. Reimportar: "ya estaba" o "actualizada", nunca duplicar

Al importar, cada canción candidata (un grupo del paso 2; en el paso 1, el
`.osz` entero) se compara con la biblioteca:

- **Sin coincidencia:** canción nueva (id nuevo), estado `nueva`.
- **Coincide con una canción existente** (si coincidiera con varias, gana la
  de `importadaEn` menor; las demás se fusionan al próximo arranque):
  - Cada dificultad entrante cuya identidad de contenido ya esté: no se toca.
  - Entrante con el mismo `BeatmapID` que una existente pero `hashMapa`
    distinto (el mapa se actualizó en osu!): **reemplaza** a la existente en
    su misma posición. Su record viejo queda en la base, huérfano (mismo
    criterio que una dificultad editada en el mapeador, T-055); no se borra.
  - Entrante sin coincidencia: se **agrega** al final. Si su `difficultyName`
    choca con uno existente, se le agrega ` (2)`, ` (3)`... (los nombres son
    la clave de `ponerDificultad`, T-032).
  - Las dificultades existentes que no vienen en el `.osz` **se conservan**
    (pueden ser del mapeador).
  - Fondo, video y `videoOffset`: si la existente no los tiene y el `.osz`
    sí, se completan. Esto además resuelve la deuda "canciones viejas sin
    fondo: hay que reimportarlas": reimportar ahora completa el fondo en vez
    de duplicar.
  - Audio: se conserva el existente.
  - Se conserva el **id**, así que el offset por canción, la lista de
    recientes y todo lo indexado por `hashMapa` siguen en su lugar.
  - Estado `ya-estaba` si no cambió nada; `actualizada` si se agregó o
    reemplazó alguna dificultad o se completó fondo o video.

### D4. Fusionar los duplicados que ya existen, al abrir la app

`fusionarDuplicados()` corre una vez al arrancar (en `main.ts`, junto a
`purgarReplaysRecientes`) y también después de restaurar un respaldo (T-042
restaura por id, así que un respaldo de otra computadora puede traer la misma
canción con otro id).

- Agrupa con la regla de D2. En cada grupo de dos o más:
  - **Sobreviviente:** la de `importadaEn` menor (ausente cuenta como la más
    vieja), desempate por `id` ascendente. Conserva id, título, artista,
    audio e `importadaEn`.
  - Se le suman las dificultades de las absorbidas que no comparten
    identidad, con la misma regla de nombres de D3.
  - Fondo, video, `videoOffset`, `conjunto` (paso 2) y `keysounds` (paso 3):
    los de la sobreviviente; si no tiene, los de la primera absorbida que los
    tenga.
  - Las absorbidas se borran **sin** tocar records, replays ni recientes (todas
    sus claves `hashMapa` están en la sobreviviente). No se usa
    `borrarCancionDeLaBase`: es un `put` y varios `delete` en una sola
    transacción sobre `canciones`.
- **Offset por canción:** vive en localStorage (apps/web), así que storage
  devuelve el plan y apps/web migra: si la sobreviviente tiene offset 0, toma
  el primero distinto de 0 entre las absorbidas, ordenadas de la importación
  más nueva a la más vieja (la que Arnold probablemente estuvo jugando).
  Después borra las claves de las absorbidas.
- Si hubo alguna fusión, se emite `EVENTO_BIBLIOTECA_CAMBIO` para que el song
  select se recargue (ya lo escucha, T-051).
- Es idempotente: una segunda corrida no hace nada.

### D5. Un `.osz` con varias piezas da varias canciones (paso 2)

Solo se agrupan las dificultades de mania 4K que parsean. La clave de grupo:

- **Audio real:** el `AudioFilename` normalizado (minúsculas, `\` a `/`, sin
  `./`). Las dificultades que comparten pista son la misma canción. En el
  `.osz` común (una pista) da un solo grupo: el comportamiento de hoy.
- **Audio virtual** (`AudioFilename` es `virtual`, sin distinguir mayúsculas):
  la **pieza** sacada del `Version`. Si el `Version` contiene ` - `, la pieza
  es lo que está antes del **último** ` - `, recortado (`Pathetique (Medley
  ver.) - 4K EX` da `Pathetique (Medley ver.)`). Si no lo contiene, la pieza
  es vacía y la dificultad va al grupo del set (`4K HELL CIRCUS`). No se
  intenta adivinar más: un set BMS de una sola obra con versiones `7K Normal`,
  `7K Hyper` queda en un único grupo, que es lo correcto.
- Nunca se mezclan en un grupo dificultades de audio real con virtuales.

Título y artista de cada canción:

- Grupo con pieza: `titulo` = la pieza, `conjunto` = el `Title` del set.
  Ejemplo: "Canon", artista "Collection", conjunto "Piano Beatmap Set".
- Grupo sin pieza: `titulo` = `Title` (como hoy).
- Audio real con varios grupos que comparten `Title`: se agrega
  ` (<nombre del audio sin extensión>)` al título para distinguirlos.
- El `difficultyName` de cada `Chart` **no** se toca (el hash, la exportación
  y la identidad dependen del chart tal cual).

`conjunto` entra en la búsqueda del song select (buscar "piano" encuentra las
15 piezas). Mostrarlo en la tarjeta no es parte de este ticket.

El orden de los grupos es el de su primera dificultad en `elegirArchivosOsu`
(alfabético por nombre de archivo). Cada grupo pasa por D3 por separado.

### D6. Audio virtual: renderizar al cargar, no al importar (paso 3)

Hay tres formas de guardar el sonido de un set con keysounds:

| Opción | Disco para las 15 piezas | Problema |
|---|---|---|
| Render a WAV al importar | unos 440 MB (2520 s a 176 KB/s) | Un `.osz` de 20 MB ocupa 22 veces más; el respaldo (T-042, zip en memoria) se vuelve inmanejable |
| Render y codificar (Opus con WebCodecs) al importar | unos 40 MB | Hay que escribir un muxer Ogg a mano, el `pre-skip` del codificador corre el audio unos ms (justo lo que T-063 cuida), y depende del soporte de `AudioEncoder` |
| **Guardar las muestras y una receta; renderizar al cargar** | unos 20 MB (las muestras, una vez) | El render cuesta de 0,5 a 4 s al abrir la canción |

Se elige la tercera. Razones: ocupa lo mismo que el `.osz`, el respaldo y la
exportación viajan con lo original (el `.osz` exportado se puede volver a
importar en osu!), el render es exacto a la muestra (sin retardo de
codificador) y es determinista. El costo de 0,5 a 4 s se paga una vez por
apertura y se esconde con una caché en memoria y un "Preparando el audio...".

**Muestras compartidas:** las 15 piezas reutilizan muestras (`l_024.ogg`
aparece en varias). Guardarlas por canción repetiría unos 158 MB. Se guardan
una sola vez en una tienda nueva `muestras` (base v9), con clave el SHA-256
del contenido (`crypto.subtle.digest`, existe en el navegador y en Node 20).
Cada canción guarda un mapa `nombre normalizado -> hash`.

**La receta** es parte del `Chart` (`chart.audioVirtual`), porque cada
dificultad de un set con keysounds tiene su propio sonido (las versiones EZ,
NM y HD de una misma pieza usan samples distintos). Se arma en `parseOsu`
(core, puro), con los volúmenes ya resueltos. No entra en `hashMapa`.

### D7. Cómo se arma la receta (core)

Solo si `AudioFilename` es `virtual` (recortado, sin distinguir mayúsculas).
Eventos, cada uno `{ tiempo, archivo, volumen }`:

- **De cada hit object** que traiga nombre de archivo en el hitSample. Tap:
  `campos[5]` separado por `:` da `normalSet:additionSet:index:volume:filename`.
  LN: `campos[5]` da `endTime:normalSet:additionSet:index:volume:filename`.
  El evento va en el tiempo de la cabeza. Si el hitSample tiene menos campos o
  el nombre está vacío, la nota no aporta evento (no se reemplaza por un
  hitsound por defecto).
- **De cada línea `Sample,tiempo,capa,"archivo",volumen`** de `[Events]` (y
  su alias numérico `5,`). Capas: 0 (Background), 2 (Pass) y 3 (Foreground)
  entran; la 1 (Fail) no (se asume que el jugador no está fallando). Sin campo
  volumen vale 100.
- **Volumen:** el del hitSample si es mayor que 0. Si es 0, el del último
  punto de tiempo (rojo o verde, campo 5 de la línea, índice 5) con
  `time <= tiempo` de la nota; a igual tiempo gana el que aparece después en
  el archivo; si la nota está antes del primer punto, el del primer punto; si
  ningún punto trae volumen, 100. Se acota a [0, 100].
- **Nombre:** se normaliza como en `buscarEnZip` (quitar comillas, `\` a `/`,
  sin `./` inicial, minúsculas).
- Se descartan eventos con volumen 0 o tiempo negativo.
- Orden: por `tiempo`, después por `archivo` (estable, determinista).
- Para eso `parseTimingPoints` tiene que leer también el volumen de cada
  línea; se usa solo para resolver la receta (no cambia `TimingPoint` ni
  `SpeedPoint`).

### D8. Cómo se renderiza (audio y web)

- **Decodificar** con `ctx.decodeAudioData` de un `BaseAudioContext` cuyo
  `sampleRate` es el del contexto que va a reproducir (así no se remuestrea al
  tocar). No hay `AudioContext` en workers, por eso decodificar es en el hilo
  principal (la decodificación en sí ya corre fuera del hilo).
- **Mezclar a mano, muestra por muestra, no con 17 000 nodos de un
  `OfflineAudioContext`.** Se crea primero el `AudioBuffer` de salida (2
  canales, `ctx.sampleRate`) y se suma directamente sobre
  `getChannelData(c)`. Se recorren las muestras distintas **de a una**:
  decodificar, sumar todos sus eventos, soltarla. Memoria pico: la salida
  (unos 95 MB para 249 s a 48 kHz, lo mismo que decodificar un mp3 de esa
  duración) más una muestra decodificada (pocos MB). Con un
  `OfflineAudioContext` todas las muestras tendrían que estar vivas hasta el
  final del render: hasta 212 MB en `Liebestraum`, más un nodo por evento.
  Además la suma es una función pura de core, testeable en Vitest sin
  navegador. El costo es el mismo orden: unos 3,3 mil millones de sumas en el
  peor caso (`4K HELL CIRCUS`), de 0,3 a 1 s en las piezas comunes.
- **Ceder el hilo** entre muestra y muestra con una función inyectada
  (`ceder`), para que el spinner y la UI sigan vivos. En la web se implementa
  con `MessageChannel` (no `setTimeout`, que el linter prohíbe en apps/web).
- **Posición exacta:** el evento de tiempo `t` ms empieza en el índice
  `Math.round(t * sampleRate / 1000)`. Sin desfase propio: el reloj (T-063)
  sigue leyendo el mismo `AudioBuffer` que hoy, con offset global y por
  canción como siempre.
- **Canales:** muestra mono va a los dos canales; estéreo L a L y R a R; más
  de dos, se usan los dos primeros.
- **Largo:** `max(ultimoEvento + 8000 ms, finDeLaUltimaNota + 2000 ms)`. Una
  muestra que se pasa del final se corta (ninguna de este set dura más de
  6,6 s). La cola de silencio no molesta: la partida termina por
  `engine.finished`.
- **Saturación:** al final se mide el pico; si pasa de 1, se escala todo por
  `0,98 / pico`. Nunca se amplifica.
- **Muestra que no decodifica o falta:** se saltea y se informa en
  `faltantes`; no hace fallar el render.
- **Caché:** una sola entrada en memoria en apps/web, clave
  `<songId>|<hashMapa>|<sampleRate>`. Cubre el caso común: el preview la
  renderiza y "Jugar" la reusa.

### D9. Límites

| Límite | Valor | Qué pasa al pasarlo |
|---|---|---|
| Tamaño del `.osz` | 300 MB | Error `muy-grande` antes de leerlo (fflate descomprime todo en memoria) |
| Último evento de una dificultad virtual | 10 min | Se omite esa dificultad con aviso; error solo si no queda ninguna |
| Eventos por dificultad virtual | 60 000 | Igual que la fila anterior |
| Muestras faltantes | cualquiera | Aviso; esas notas no suenan. Error solo si faltan **todas** |

### D10. Dónde vive cada pieza

```
core      leerCabeceraOsu, beatmapId/beatmapSetId, receta (parseOsu),
          clavesDeIdentidad, agruparEnCanciones, mezclarMuestra, normalizarPico
          (todo puro: sin Blob, sin AudioContext, sin crypto)
audio     renderizarAudioVirtual (decodeAudioData + mezcla de core)
storage   ErrorDeImportacion, analisis del zip, importarArchivoOsz, dedupe,
          planearFusiones/fusionarDuplicados, tienda 'muestras', respaldo,
          exportar (storage no importa de audio: no renderiza nada)
apps/web  mensajes de UI, migrar offsets, caché de render, cablear partida,
          preview, música del menú, mapeador, hitsounds
```

Dirección de dependencias sin cambios: storage y audio importan de core; web
de todos; storage nunca importa de audio.

### D11. Integraciones del paso 3

- **Reloj (T-063):** sin cambios. Se reemplaza la fuente del `AudioBuffer`.
- **Partida, replays, "Ver auto", recientes:** pasan por
  `jugarDificultadEnfocada`; basta con cambiar cómo se obtiene el buffer.
- **Records, replays, recientes, historial:** indexados por `hashMapa`, que no
  incluye la receta. Nada cambia.
- **Hitsounds sintetizados (T-027):** en una dificultad con `audioVirtual`
  **no** se tocan: la nota ya suena en la mezcla, y en osu! un mapa con
  keysounds no suma el hitsound por defecto. Limitación aceptada: como la
  mezcla está pre-renderizada, una nota fallada suena igual. Tocar el keysound
  al pulsar queda fuera de alcance.
- **Preview (T-052) y música del menú (T-030):** usan
  `obtenerAudioDeDificultad` con la dificultad enfocada (preview) o la primera
  de `ordenarDificultades` (menú).
- **Mapeador (T-032):** "Editar en el mapeador" queda deshabilitado en
  canciones con audio virtual, con `title` "El mapeador no abre canciones con
  audio virtual.". Al guardar desde el mapeador se perdería la receta.
- **Exportar `.osz` (T-049):** se exportan las muestras con su nombre
  normalizado y cada `.osu` con `AudioFilename: virtual`, notas **sin**
  nombre en el hitSample y **todos** los eventos de la receta como líneas
  `Sample,<tiempo>,0,"<archivo>",<volumen>` (volumen ya resuelto). Suena igual,
  el hash de notas es el mismo y reimportarlo da `ya-estaba`.
- **Respaldo (T-042):** el manifest gana `muestras` (cada muestra una vez, en
  `muestras/<n>.<ext>`, con su hash) y cada canción virtual lleva `keysounds`
  (nombre y hash) en vez de `audio`. `VERSION_ACTUAL` sigue en 1 (campos
  opcionales). Un respaldo nuevo con canciones virtuales no se puede leer con
  una versión vieja de Tetra; se acepta.
- **Borrar canción:** en la misma transacción, borrar las muestras que ninguna
  otra canción referencia (mismo patrón que records en
  `borrarCancionDeLaBase`). Además, al abrir la app,
  `limpiarMuestrasHuerfanas()` como red de seguridad.
- **Migración de base:** v9 crea la tienda `muestras` (`keyPath: 'hash'`) con
  el guard `contains` de siempre. No se transforma ninguna fila existente.

## Contratos

### Paso 1

#### core (`packages/core/src/types.ts`)

```ts
export interface ChartMetadata {
  // ...lo que ya hay...
  /** [Metadata] BeatmapID, solo si es mayor que 0. */
  beatmapId?: number;
  /** [Metadata] BeatmapSetID, solo si es mayor que 0. */
  beatmapSetId?: number;
}
```

`escribirOsu` escribe `BeatmapID:` y `BeatmapSetID:` si existen; el roundtrip
los conserva.

#### core (`packages/core/src/chart/cabecera.ts`, nuevo)

```ts
/** Lo minimo de un .osu para clasificarlo sin parsearlo entero. Nunca lanza. */
export interface CabeceraOsu {
  /** `Mode` de [General]; undefined si falta o no es un entero. */
  modo?: number;
  /** `CircleSize` de [Difficulty] (en mania, las teclas); undefined si falta o no es numero. */
  teclas?: number;
  /** `AudioFilename` recortado; undefined si falta. */
  audio?: string;
  /** true si `audio` es "virtual" (sin distinguir mayusculas). */
  audioVirtual: boolean;
  titulo?: string;
  artista?: string;
  version?: string;
  beatmapId?: number;
  beatmapSetId?: number;
}
export function leerCabeceraOsu(texto: string): CabeceraOsu;
```

#### core (`packages/core/src/chart/identidad.ts`, nuevo)

```ts
/**
 * Claves de identidad de una dificultad (ver T-066, D2): `id:<beatmapId>` si
 * existe y `contenido:<hashMapa>|<titulo>|<artista>` siempre, con titulo y
 * artista normalizados (recorte, minusculas, espacios colapsados).
 */
export function clavesDeIdentidad(chart: Chart): string[];
```

#### storage (`packages/storage/src/errores.ts`, nuevo)

```ts
export type CodigoErrorImportacion =
  | 'es-skin'
  | 'no-es-osz'
  | 'muy-grande'
  | 'lectura'
  | 'zip-danado'
  | 'sin-osu'
  | 'sin-mania'
  | 'sin-4k'
  | 'osu-invalido'
  | 'audio-faltante'
  | 'audio-virtual'          // solo pasos 1 y 2; el paso 3 lo quita
  | 'muestras-faltantes'     // paso 3
  | 'virtual-fuera-de-limite' // paso 3
  | 'sin-espacio'
  | 'base';

/** Error de importacion con causa. `message` es el texto exacto para mostrar (tabla de abajo). */
export class ErrorDeImportacion extends Error {
  readonly codigo: CodigoErrorImportacion;
  constructor(codigo: CodigoErrorImportacion, mensaje: string, options?: { cause?: unknown });
}
```

#### storage (`packages/storage/src/index.ts`)

```ts
export type EstadoImportacion = 'nueva' | 'ya-estaba' | 'actualizada';

export interface CancionImportadaResumen {
  id: SongId;
  titulo: string;
  estado: EstadoImportacion;
  /** Dificultades agregadas a una cancion que ya estaba (0 si es nueva o ya-estaba). */
  dificultadesAgregadas: number;
  /** Dificultades reemplazadas por una version nueva del mismo BeatmapID. */
  dificultadesActualizadas: number;
  /** true si se completo un fondo o un video que la cancion existente no tenia. */
  archivosCompletados: boolean;
}

export interface ResultadoImportacion {
  /** En el orden de los grupos (paso 1: siempre una). Nunca vacio: si no hay nada que importar, se lanza. */
  canciones: CancionImportadaResumen[];
  /** Title del set (el de la primera dificultad valida). */
  titulo: string;
  /** Lo que se dejo afuera sin hacer fallar la importacion. */
  omitidas: {
    /** Dificultades con Mode distinto de 3. */
    otroModo: number;
    /** Dificultades de mania con otra cantidad de teclas, por teclas: { 7: 15, 10: 69 }. */
    otrasTeclas: Record<number, number>;
    /** Dificultades de mania 4K que no parsearon. */
    invalidas: number;
  };
  /** Avisos ya redactados (tabla de abajo), en el orden en que se generaron. */
  avisos: string[];
}

/**
 * Importa un .osz con deduplicacion (D3). Lanza ErrorDeImportacion si no
 * queda ninguna cancion para importar; nunca lanza otro tipo de error
 * (cualquier otro se envuelve como 'base', o 'sin-espacio' si es
 * QuotaExceededError).
 */
export function importarArchivoOsz(archivo: Blob): Promise<ResultadoImportacion>;

/** Compatibilidad (mapeador, tests): `(await importarArchivoOsz(a)).canciones[0].id`. */
export function importarOsz(archivo: Blob): Promise<SongId>;

export interface FusionDeDuplicados {
  sobreviviente: SongId;
  /** De la importacion mas nueva a la mas vieja (ver D4, offset por cancion). */
  absorbidas: SongId[];
}

/** D4. Idempotente. Devuelve las fusiones hechas (vacio si no habia duplicados). */
export function fusionarDuplicados(): Promise<FusionDeDuplicados[]>;
```

`importarArchivoOsz` toma el nombre de `archivo.name` si es un `File` (para
`es-skin` y `no-es-osz`); si es un `Blob` suelto no chequea la extensión.

`guardarCancionCreada` (mapeador) sigue usando `importarOsz`. Ojo: si el
contenido coincide con una canción existente, ahora devuelve el id de esa
(antes creaba una copia). Es el comportamiento buscado.

#### storage (`packages/storage/src/duplicados.ts`, nuevo, puro sobre datos)

```ts
export interface PlanDeFusion {
  /** La sobreviviente ya fusionada, lista para `put`. */
  resultado: CancionGuardada;
  /** De la importacion mas nueva a la mas vieja. */
  absorbidas: SongId[];
}
/** D4 sin tocar la base: agrupa por identidad y arma cada sobreviviente. */
export function planearFusiones(canciones: readonly CancionGuardada[]): PlanDeFusion[];

/** D3 sin tocar la base: como queda una cancion existente al reimportar. */
export function combinarConExistente(
  existente: CancionGuardada,
  entrante: Pick<CancionGuardada, 'dificultades' | 'background' | 'video' | 'videoOffset'>,
): { cancion: CancionGuardada; resumen: Omit<CancionImportadaResumen, 'id' | 'titulo'> };
```

`db.ts` gana `aplicarFusionesEnLaBase(planes: PlanDeFusion[]): Promise<void>`
(una transacción sobre `canciones`: `put` de cada resultado y `delete` de
cada absorbida; no toca records, replays ni recientes).

#### apps/web

```ts
// offset-local.ts
/** D4: pasa el offset de las absorbidas a la sobreviviente (si no tiene) y borra sus claves. */
export function migrarOffsetsLocales(
  fusiones: readonly FusionDeDuplicados[],
  storage?: Storage,
): void;

// song-select-logica.ts (reemplaza a textoDeImportacionFallida)
export function textoDeImportacionFallida(nombreArchivo: string, error: unknown): string;
export function textoDeImportacion(resultado: ResultadoImportacion): string | null;
```

- `textoDeImportacionFallida`: `No se pudo importar <nombre>. <mensaje>`,
  con `<nombre>` entero si tiene hasta 60 caracteres; si es más largo, sus primeros 59 más `…`. Con un
  `ErrorDeImportacion` el mensaje es su `message`; con cualquier otro error,
  el de `mensajeDeErrorDeCarga`. Sin nombre: `No se pudo importar. <mensaje>`.
- El banner de error del song select tiene que poder ocupar hasta tres
  líneas (hoy corta con puntos suspensivos); el `title` deja de ser el único
  lugar con la causa.
- `textoDeImportacion` devuelve `null` cuando no hay nada que decir (una
  canción nueva y sin avisos: se enfoca y listo). Si no, el texto se muestra
  en el mismo banner con un tono neutro (no de error): agregar
  `mostrarAviso(texto)` en `song-select.ts` junto a `mostrarError`.
- Después de importar se enfoca la primera canción del resultado (nueva, ya
  estaba o actualizada).
- `main.ts`: `fusionarDuplicados()` al arrancar, luego
  `migrarOffsetsLocales` y, si hubo fusiones, `EVENTO_BIBLIOTECA_CAMBIO`.
  Lo mismo al terminar `restaurarRespaldo` en ajustes. Un error se traga con
  `console.warn` (como la purga de recientes): nunca bloquea el arranque.
- Corregir el comentario de `offset-local.ts` sobre reimportar.

### Paso 2

```ts
// core: packages/core/src/chart/agrupar.ts (nuevo)
export interface GrupoDeCancion {
  /** Clave del grupo (D5): 'a|<audio normalizado>' o 'v|<pieza normalizada>'. */
  clave: string;
  /** Titulo para la cancion (D5). */
  titulo: string;
  artista: string;
  /** Title del set, solo si el titulo es una pieza (distinto del Title). */
  conjunto?: string;
  /** Indices en el arreglo de entrada, en su orden. Nunca vacio. */
  indices: number[];
}
/** D5. Puro. `charts` en el orden de elegirArchivosOsu. */
export function agruparEnCanciones(charts: readonly Chart[]): GrupoDeCancion[];
/** D5: la pieza de un Version ('' si no tiene ' - '). */
export function piezaDeVersion(version: string): string;
```

`CancionGuardada` gana `conjunto?: string`. `importarArchivoOsz` arma una
canción por grupo y pasa cada una por D3. Un grupo de audio real cuyo audio
falta se omite con aviso si otro grupo sí entra; error `audio-faltante` solo
si no entra ninguno. Los grupos de audio virtual se omiten con el aviso de
`audio-virtual` en este paso (y si no queda ninguno, error `audio-virtual`).
La búsqueda del song select incluye `conjunto`. El respaldo lleva `conjunto`.

### Paso 3

#### core

```ts
// types.ts
export interface EventoDeMuestra {
  /** ms desde el inicio de la pista virtual. Nunca negativo. */
  tiempo: Ms;
  /** Nombre normalizado (minusculas, '/', sin './'). */
  archivo: string;
  /** 1 a 100, ya resuelto (D7). */
  volumen: number;
}
export interface AudioVirtual {
  /** Ordenados por tiempo y despues por archivo. */
  eventos: EventoDeMuestra[];
}
export interface Chart {
  // ...lo que ya hay...
  /** Solo si AudioFilename es "virtual" (T-066, D7). No entra en hashMapa. */
  audioVirtual?: AudioVirtual;
}

// packages/core/src/audio-virtual/mezcla.ts (nuevo)
/** Normaliza un nombre de archivo de muestra (D7). */
export function normalizarNombreDeMuestra(nombre: string): string;
/**
 * Suma una muestra en la salida, una vez por cada inicio (en muestras de
 * audio) con su ganancia lineal. Mono a los dos canales; corta lo que pasa
 * del final; inicios negativos se ignoran. Muta `salida`.
 */
export function mezclarMuestra(
  salida: readonly Float32Array[],
  muestra: readonly Float32Array[],
  inicios: readonly number[],
  ganancias: readonly number[],
): void;
/** Si el pico pasa de 1, escala todo por techo/pico. Devuelve el factor aplicado (1 si no toco nada). */
export function normalizarPico(salida: readonly Float32Array[], techo?: number): number;
/** Largo en ms de la pista virtual (D8). */
export function duracionDeAudioVirtual(chart: Chart): Ms;
```

`escribirOsu` con `audioVirtual`: notas sin nombre en el hitSample y cada
evento como `Sample,<tiempo>,0,"<archivo>",<volumen>` en `[Events]`.

#### audio (`packages/audio/src/audio-virtual.ts`, nuevo)

```ts
export interface EntradaRenderVirtual {
  chart: Chart; // con audioVirtual
  /** Bytes frescos de una muestra (decodeAudioData los desprende); undefined si falta. */
  leerMuestra: (archivo: string) => Promise<ArrayBuffer | undefined>;
  ctx: BaseAudioContext;
  /** Cede el hilo entre muestras. Por defecto no cede. */
  ceder?: () => Promise<void>;
}
export interface ResultadoRenderVirtual {
  buffer: AudioBuffer;
  /** Muestras que faltaban o no decodificaron, ordenadas. */
  faltantes: string[];
  /** Factor de normalizarPico. */
  ganancia: number;
}
export function renderizarAudioVirtual(entrada: EntradaRenderVirtual): Promise<ResultadoRenderVirtual>;
```

#### storage

```ts
// db.ts
const VERSION_BASE = 9; // + tienda 'muestras', keyPath 'hash'
export interface MuestraGuardada { hash: string; blob: Blob }

export interface CancionGuardada {
  // ...
  /** Pista de musica. Ausente solo si la cancion es de audio virtual. */
  audio?: Blob;
  /** Audio virtual: nombre normalizado -> hash de la tienda 'muestras'. */
  keysounds?: Record<string, string>;
}

// index.ts
export function esCancionVirtual(c: CancionGuardada): boolean; // audio ausente y keysounds presente
/** Blobs de las muestras pedidas, por hash. Las que no esten no aparecen. */
export function leerMuestras(hashes: readonly string[]): Promise<Map<string, Blob>>;
/** Borra las muestras que ninguna cancion referencia. Devuelve cuantas borro. */
export function limpiarMuestrasHuerfanas(): Promise<number>;
```

Al importar un grupo virtual: reunir los nombres de todas sus recetas, buscar
cada uno con `buscarEnZip`, calcular el SHA-256 en hexadecimal, y guardar
canción y muestras nuevas en **una** transacción (`put` de la muestra solo si
el hash no estaba). `combinarConExistente` y `planearFusiones` unen
`keysounds` (gana la sobreviviente si un nombre choca).

Consumidores de `cancion.audio` que hay que adaptar (el compilador los
marca): `mapeador.ts`, `musica-menu.ts`, `preview.ts`, `song-select.ts`,
`exportarCancion`, `respaldo.ts` y sus tests.

#### apps/web (`apps/web/src/audio-de-cancion.ts`, nuevo)

```ts
/**
 * El AudioBuffer de una dificultad: decodifica `cancion.audio` o, si la
 * cancion es virtual, renderiza (con la cache de una entrada, D8).
 */
export function obtenerAudioDeDificultad(
  cancion: CancionGuardada,
  chart: Chart,
  ctx: BaseAudioContext,
): Promise<AudioBuffer>;
/** Cede el hilo con MessageChannel (no setTimeout). */
export function cederAlNavegador(): Promise<void>;
```

Mientras renderiza, el song select muestra "Preparando el audio..." en el
lugar del estado de carga que ya existe.

## Mensajes exactos

### Errores (`ErrorDeImportacion.message`)

| Código | Mensaje |
|---|---|
| `es-skin` | `Es una skin (.osk): se carga desde Ajustes, en Skin.` |
| `no-es-osz` | `No es un mapa de osu!: Tetra importa archivos .osz.` |
| `muy-grande` | `El archivo pesa <N> MB y el máximo es 300 MB.` (N entero, redondeado hacia arriba) |
| `lectura` | `No se pudo leer el archivo. Puede que se haya movido o borrado mientras se importaba.` |
| `zip-danado` | `El archivo está dañado o no es un .osz: no se pudo abrir como zip.` |
| `sin-osu` | `El .osz no trae ningún mapa (.osu).` |
| `sin-mania` | `Ninguna dificultad es de osu!mania: el .osz es de otro modo de juego (osu!, taiko o catch).` |
| `sin-4k` | `Ninguna dificultad es de 4 teclas: el .osz trae solo <lista>.` |
| `osu-invalido` | `Ninguna dificultad de 4 teclas se pudo leer. <error del parser de la primera>` |
| `audio-faltante` | `Falta el audio: el mapa pide "<archivo>" y el .osz no lo trae.` |
| `audio-virtual` | `Este .osz no trae pista de música: usa audio virtual (el sonido sale de muestras por nota) y Tetra todavía no lo soporta.` |
| `muestras-faltantes` | `Falta el audio virtual: ninguna de las <N> muestras de sonido que pide el mapa viene en el .osz.` |
| `virtual-fuera-de-limite` | `Ninguna dificultad entra en el límite del audio virtual (10 minutos y 60 000 sonidos).` |
| `sin-espacio` | `No hay espacio para guardar la canción: el navegador llenó su cuota. Borrá canciones que no uses o exportá un respaldo y liberá espacio.` |
| `base` | `No se pudo guardar en la biblioteca: <message del error original>` |

`<lista>`: por teclas ascendente, `<N>K (<cantidad>)`, separados por coma y
el último con " y ". Ejemplos: `mapas de 7K (3)`; `mapas de 5K (15), 7K (15) y
10K (69)`. La cantidad va siempre, también si es 1.

Orden de clasificación (el primero que aplica): extensión `.osk` (es-skin),
otra extensión que no sea `.osz` ni `.zip` (no-es-osz), tamaño, lectura, zip,
sin `.osu`, ninguno con `Mode` 3, ninguno de 4 teclas, ninguno parsea, audio.
Así el mensaje siempre describe lo más cercano a jugable: un `.osz` con
dificultades de 7K y de 4K sin audio da `audio-faltante`, no `sin-4k`.

### Avisos (`ResultadoImportacion.avisos`)

| Cuándo | Texto |
|---|---|
| Hay dificultades de otras teclas | `Se omitieron <N> dificultades de otras teclas: <lista sin "mapas de">.` |
| Hay dificultades de otro modo | `Se omitieron <N> dificultades que no son de osu!mania.` |
| Hay 4K que no parsean | `Se omitieron <N> dificultades que no se pudieron leer.` |
| Grupo sin audio (paso 2, si entra otro) | `Se omitió "<titulo>": falta el audio "<archivo>".` |
| Grupo virtual (paso 2) | `Se omitió "<titulo>": usa audio virtual, que Tetra todavía no soporta.` |
| Muestras faltantes (paso 3) | `Faltan <N> muestras de sonido en "<titulo>": esas notas no van a sonar.` |
| Dificultad virtual fuera de límite (paso 3) | `Se omitió "<version>": pasa el límite del audio virtual (10 minutos y 60 000 sonidos).` |

Con N = 1 se usa el singular: `Se omitió 1 dificultad de otras teclas: 7K
(1).`, `Se omitió 1 dificultad que no es de osu!mania.`, `Se omitió 1
dificultad que no se pudo leer.`, `Falta 1 muestra de sonido en "<titulo>":
esa nota no va a sonar.`

### Resultado (`textoDeImportacion`)

Primero la frase principal y después los avisos, separados por un espacio:

| Caso | Frase principal |
|---|---|
| Una canción, `nueva`, sin avisos | `null` (no hay banner) |
| Una canción, `nueva`, con avisos | `"<titulo>" importada.` |
| Una canción, `ya-estaba` | `"<titulo>" ya estaba en la biblioteca.` |
| Una canción, `actualizada` | `"<titulo>" ya estaba en la biblioteca: <cambios>.` |
| Varias canciones | `<titulo del set>: <partes>.` |

`<cambios>`: las partes que no sean cero, unidas con ", " y la última con " y
": `se agregaron N dificultades` (`se agregó 1 dificultad`), `se actualizaron
N dificultades` (`se actualizó 1 dificultad`), `se completó el fondo o el
video`. `<partes>`: `N canciones nuevas` (`1 canción nueva`), `N ya estaban`
(`1 ya estaba`), `N actualizadas` (`1 actualizada`), mismas reglas de unión.

Para el set de piano después del paso 3, la primera vez: `Piano Beatmap Set:
15 canciones nuevas. Se omitieron 99 dificultades de otras teclas: 5K (15), 7K
(15) y 10K (69).` La segunda: `Piano Beatmap Set: 15 ya estaban. Se
omitieron...`.

## Plan de tests

Todos los fixtures son sintéticos, chicos y armados en el test (strings `.osu`
y zips con fflate, como `osz.test.ts`). El `.osz` de Arnold no entra al repo.
Las muestras de audio de los e2e son WAV de pocos ms generados en el test.

### Paso 1

- `cabecera.test.ts`: modo, teclas, audio, virtual en mayúsculas y
  minúsculas, ids 0 y -1 ignorados, archivo sin secciones (nunca lanza).
- `osu.test.ts` y `osu-escritor.test.ts`: `beatmapId`/`beatmapSetId` y su
  roundtrip.
- `identidad.test.ts`: con y sin BeatmapID; mismo contenido con distinto
  `difficultyName` da la misma clave de contenido; título con mayúsculas y
  espacios de más da la misma clave.
- `errores` en `osz.test.ts`: un test por código, que chequea `codigo` y el
  `message` exacto de la tabla: bytes basura, zip sin `.osu`, solo Mode 0,
  solo 7K (lista `7K (1)`), 5K + 7K + 10K (lista con " y "), 4K que no
  parsea, 4K sin audio, 4K `virtual`, mezcla de 7K y 4K sin audio (gana
  `audio-faltante`), `.osk` por nombre, archivo de más de 300 MB (un `Blob`
  falso con `size` grande, sin reservar memoria).
- `duplicados.test.ts` (puro): sobreviviente por `importadaEn` y por id;
  unión de dificultades; nombre que choca recibe ` (2)`; fondo completado
  desde una absorbida; clausura transitiva (A comparte con B, B con C: una
  fusión); canciones sin relación no se tocan; segunda corrida sin cambios.
- `index.test.ts` (fake-indexeddb):
  - **Importar dos veces da una sola canción:** `listarCanciones()` tiene
    largo 1, el segundo resultado es `ya-estaba` con el mismo id.
  - Reimportar con una dificultad más: `actualizada`, `dificultadesAgregadas
    = 1`, mismo id.
  - Mismo BeatmapID con notas distintas: reemplaza en su posición,
    `dificultadesActualizadas = 1`, el record viejo sigue en la base.
  - Reimportar sobre una canción sin fondo la completa.
  - Una dificultad agregada desde el mapeador sobrevive a la reimportación.
  - `fusionarDuplicados` con dos copias que tienen record, replay de la mejor
    y recientes: queda una canción y `leerRecords`, `leerReplayGuardado` y
    `listarPartidasRecientes` devuelven lo mismo que antes.
- `offset-local.test.ts`: `migrarOffsetsLocales` respeta el offset de la
  sobreviviente, toma el de la absorbida más nueva si la sobreviviente tiene
  0, y borra las claves absorbidas.
- `song-select-logica.test.ts`: cada fila de las tablas de mensajes,
  singulares y plurales, nombre de 60 caracteres entero y de 61 recortado.
- e2e `importacion.spec.ts` (nuevo): importar el mismo `.osz` dos veces por
  el input: una sola tarjeta y el aviso `ya estaba en la biblioteca`;
  importar un `.osz` solo de 7K: el banner **visible** contiene `Ninguna
  dificultad es de 4 teclas`.

### Paso 2

- `agrupar.test.ts`: los Version reales de este set (`Canon - 4K EX`,
  `La Campanella - 4K Full`, `Pathetique (Medley ver.) - 4K EX`, `4K HELL
  CIRCUS`) dan 4 grupos con títulos `Canon`, `La Campanella`, `Pathetique
  (Medley ver.)` y `Piano Beatmap Set`; `7K Normal` y `7K Hyper` virtuales dan
  un grupo; audio real con dos pistas da dos grupos (y el sufijo del audio si
  comparten Title); audio real con Version `Easy - 4K` y `Hard - 4K` y una
  sola pista da **un** grupo; real y virtual nunca se mezclan.
- `index.test.ts`: un `.osz` sintético con dos pistas da dos canciones;
  reimportarlo da `ya-estaba` en las dos; uno de sus grupos sin audio da
  aviso y el otro entra.
- e2e: importar el `.osz` de dos pistas muestra dos tarjetas y el texto
  `2 canciones nuevas`.

### Paso 3

- `osu.test.ts` (receta): tap y LN con archivo; hitSample sin archivo no
  aporta; volumen 0 toma el del punto de tiempo, con un punto verde que lo
  cambia a mitad; volumen explícito gana; capas 0, 2 y 3 entran y 1 no;
  `Sample` sin volumen vale 100; comillas y `\` en el nombre; nota antes del
  primer punto; mapa no virtual no tiene `audioVirtual`; `hashMapa` igual con
  y sin receta.
- `mezcla.test.ts`: con `sampleRate` 1000, un impulso en 5 ms cae en el
  índice 5 (y un test que falle si se usa `floor` en vez de `round`: evento en
  2,6 ms va al índice 3); mono a dos canales; ganancia 0,5; dos eventos que se
  superponen suman; la cola se corta al final; `normalizarPico` no toca un
  pico de 0,9 y lleva uno de 2 a 0,98.
- `audio-virtual.test.ts` (audio, con un `BaseAudioContext` de prueba cuyo
  `decodeAudioData` arma buffers conocidos desde los bytes): posición y
  volumen de cada evento en el resultado, `faltantes`, que cada muestra se
  decodifica una sola vez aunque tenga muchos eventos, y que `ceder` se llama
  entre muestras.
- `index.test.ts`: dos canciones virtuales que comparten una muestra la
  guardan una sola vez; borrar una conserva la compartida y borra la propia;
  exportar y reimportar una virtual da `ya-estaba`; `respaldo.test.ts`:
  roundtrip con una canción virtual (las muestras viajan una vez).
- e2e: importar un set virtual sintético de dos piezas con WAV de 50 ms: dos
  tarjetas; jugar una con "Ver auto" llega a resultados (el reloj corre sobre
  el buffer renderizado).
- Manual (Arnold, con el archivo real): el set entra como 15 canciones, Canon
  suena en tiempo con las notas, y reimportarlo dice `15 ya estaban`.

## Criterios de aceptación

### Paso 1

- [ ] Importar el set de piano muestra, visible y sin pasar el mouse: `No se
      pudo importar 332673 Collection - Piano Beatmap Set.osz. Este .osz no trae
      pista de música: usa audio virtual (el sonido sale de muestras por nota)
      y Tetra todavía no lo soporta.`
- [ ] Cada código de error tiene su test con el texto exacto de la tabla.
- [ ] Importar el mismo `.osz` dos veces deja una sola canción y avisa `ya
      estaba en la biblioteca`.
- [ ] Reimportar agrega dificultades nuevas y completa fondo o video sin
      cambiar el id.
- [ ] Al abrir la app, los duplicados que Arnold ya tiene quedan en una sola
      canción, con sus records, replays, recientes y offset por canción.
- [ ] `fusionarDuplicados` no borra ningún record, replay ni reciente (test).
- [ ] Después de restaurar un respaldo también se fusiona.
- [ ] Los cuatro checks en verde y el e2e nuevo estable 3 de 3 con
      `--workers=1`.

### Paso 2

- [ ] Un `.osz` con dos pistas da dos canciones; con una pista, una (como hoy).
- [ ] `piezaDeVersion` y `agruparEnCanciones` cumplen los ejemplos de D5.
- [ ] Buscar el título del set encuentra todas sus piezas.
- [ ] Reimportar un set multi-canción no duplica ninguna.
- [ ] Los cuatro checks en verde.

### Paso 3

- [ ] El set de piano entra como 15 canciones (14 piezas más "Piano Beatmap
      Set" con `4K HELL CIRCUS`) con el aviso de las 99 omitidas.
- [ ] Canon se juega con el sonido de piano en tiempo con las notas (prueba de
      oído de Arnold) y sin hitsounds sintetizados encima.
- [ ] El render de `4K HELL CIRCUS` no congela la UI (el spinner sigue
      animando) y termina en menos de 8 s en la máquina de Arnold.
- [ ] El preview y "Jugar" no renderizan dos veces la misma dificultad.
- [ ] Las muestras compartidas se guardan una vez; el uso de almacenamiento
      del set queda cerca de 20 MB (ajustes, tarjeta Biblioteca).
- [ ] Exportar una pieza y reimportarla da `ya estaba`; el `.osz` exportado
      tiene `AudioFilename: virtual` y las muestras.
- [ ] Respaldo y restauración con canciones virtuales.
- [ ] "Editar en el mapeador" deshabilitado en canciones virtuales.
- [ ] Base v9: quien viene de v8 conserva todo.
- [ ] Los cuatro checks en verde, e2e estable 3 de 3 con `--workers=1`.

## Riesgos

- **Memoria del render.** Un buffer de 4 minutos son unos 95 MB, igual que un
  mp3 decodificado; la caché retiene uno. Si el preview y la partida usan
  contextos con distinto `sampleRate`, la clave de caché difiere y se
  renderiza dos veces: usar el `sampleRate` del contexto de la partida también
  para el preview si hace falta.
- **Tiempo de render en máquinas lentas.** El peor caso es de varios
  segundos. Si Arnold lo nota, la mezcla se puede mover a un worker (la
  función de core ya es pura); queda como mejora.
- **Saturación:** normalizar por pico baja el volumen de toda la pieza si un
  acorde fuerte satura. Es preferible a recortar. Si suena bajo, se puede
  agregar un limitador después.
- **Agrupación por pieza** es una heurística sobre el `Version`. Un set con
  otro formato de nombres puede agrupar de más o de menos. El resultado nunca
  pierde dificultades: en el peor caso quedan en una sola canción, como hoy.
- **Notas falladas suenan igual** (D11). Es una diferencia con osu!.
- **Dedupe por contenido:** dos `.osz` distintos con las mismas notas, OD,
  título y artista se consideran el mismo. Es el comportamiento buscado.
- **Reemplazo por BeatmapID:** el record de la versión vieja queda huérfano en
  la base (no se ve en el song select). No se pierde: sigue en la tienda y en
  el historial.
- **`audio` opcional en `CancionGuardada`** toca a varios consumidores; el
  compilador los marca a todos, pero los tests que arman canciones a mano
  pueden necesitar ajustes.
- **Respaldo nuevo en una versión vieja** de Tetra no se lee si trae
  canciones virtuales.

## Fuera de alcance

- Tocar el keysound al pulsar la tecla (estilo BMS) en vez de pre-renderizar.
- Mapas de 5K, 7K o 10K (se omiten con aviso).
- Codificar el audio renderizado para guardarlo.
- Mostrar el `conjunto` en la tarjeta del song select.
- Abrir canciones virtuales en el mapeador.
- Storyboards visuales.
- Deduplicar skins.

## Terminado cuando

Cada paso: los cuatro checks en verde, sus tests y su e2e estables 3 de 3 con
`--workers=1`, revisión de Opus aprobada, squash merge a `main` y
`docs/ESTADO.md` actualizado. El ticket se cierra cuando Arnold importa el set
de piano, juega Canon y lo oye en tiempo.
