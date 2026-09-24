# T-014 · Estrellas y perfil de skillsets en el song select

| | |
|---|---|
| **Fase** | 4 · Motor de dificultad |
| **Modelo** | Sonnet |
| **Rama** | `feat/estrellas` |
| **Depende de** | T-013 (`calcularDificultad`), T-011 (song select) |

## Contexto

T-013 deja el motor en `core`: dado un `Chart`, devuelve el vector de siete
skillsets y la estrella global. Este ticket lo lleva a la pantalla: que el song
select muestre las estrellas de cada dificultad y, de la dificultad en foco, el
perfil completo. Ese perfil es la idea de Arnold hecha visible: no un numero,
sino que habilidades pide el mapa.

## Parte A: calculo en un Web Worker

Calcular la dificultad de una biblioteca entera en el hilo principal trabaria
la interfaz. Va en un **Web Worker** (este es el "multithreading" real del
proyecto, el que Arnold pidio en su lista original).

- Un worker que recibe `Chart` y devuelve `DifficultyResult`, usando
  `calcularDificultad` de `@tetra/core` tal cual (el worker importa core; core
  sigue sin saber que existe el worker).
- Vite soporta workers con `new Worker(new URL('./x.worker.ts', import.meta.url),
  { type: 'module' })`.
- Una cola: si se piden muchas dificultades, se procesan en orden sin bloquear.
  La dificultad en foco tiene prioridad sobre las demas.

## Parte B: cache con version de modelo

Recalcular cada vez que se abre el song select es desperdicio. Se cachea.

- **Clave:** un hash del contenido del mapa (tiempos y columnas de las notas,
  mas OD). Funcion pura en `core`, por ejemplo FNV-1a sobre esos numeros.
  Testeada: dos mapas iguales dan el mismo hash, un cambio de una nota lo cambia.
- **La trampa que hay que evitar:** los parametros del motor van a cambiar con la
  calibracion (T-015). Si la cache no se entera, el song select mostraria
  estrellas viejas sin que nadie lo note. Por eso: agregar
  `VERSION_MODELO_DIFICULTAD` en core junto a `PARAMETROS_DIFICULTAD`, y la
  clave de cache incluye esa version. Cambiar cualquier parametro obliga a subir
  la version (dejarlo dicho en un comentario al lado de los parametros).
- Guardar en IndexedDB (`@tetra/storage`, tienda nueva, migracion no
  destructiva como en T-009 y T-011).

## Parte C: la UI

Con la identidad de `docs/DISENO.md` (los numeros en JetBrains Mono, tratados
como instrumentos de medicion):

- **En la lista**, cada dificultad muestra su estrella global con un decimal
  (`5.3★` o como se decida). Mientras se calcula, un estado de "calculando" que
  no salte el layout.
- **Color por dificultad:** una escala de color para la estrella, derivada de la
  paleta de juicio (tokens), no un arcoiris nuevo.
- **En el panel de detalle**, el **perfil de siete skillsets** de la dificultad
  en foco: siete barras horizontales con su nombre y su valor en mono, la del
  maximo destacada con el acento. Barras, no grafico de radar: se leen mejor y
  se comparan en una sola escala.
- **Ordenar por estrellas** y **filtrar por rango de estrellas** (estaba en la
  lista original de Arnold).
- **Marca de provisional.** Las escalas de T-013 no estan calibradas y tienen un
  sesgo conocido (subestiman los jacks, ver el JSDoc de `PARAMETROS_DIFICULTAD`).
  Agregar en core `MODELO_CALIBRADO = false` junto a los parametros, y mientras
  sea `false` la UI muestra las estrellas con una marca discreta de
  "provisional" (un tooltip o una etiqueta chica que diga que el modelo todavia
  no se calibro contra osu!). T-015 la pone en `true`. Mostrar un numero sin
  avisar que es provisional seria enganar al jugador.
- Quitar la densidad "provisional" de T-011 si ya no hace falta.

## Fuera de alcance

- Calibrar los parametros: T-015.
- Estrellas en la pantalla de resultados.

## Criterios de aceptacion

- [ ] El calculo corre en un worker; abrir un song select con muchas canciones
      no traba la interfaz
- [ ] La cache evita recalcular; cambiar `VERSION_MODELO_DIFICULTAD` invalida
      todo lo cacheado (con test)
- [ ] El hash del mapa esta testeado (iguales coinciden, una nota distinta cambia)
- [ ] La lista muestra estrellas con color; el detalle muestra las siete barras
- [ ] Ordenar por estrellas y filtrar por rango funcionan
- [ ] La migracion de IndexedDB no borra datos
- [ ] El e2e pasa
- [ ] Los cuatro checks en verde

## Terminado cuando

Los cuatro checks en verde, el e2e pasando, revision de Opus mirando la app
corriendo, y squash merge a `main`.
