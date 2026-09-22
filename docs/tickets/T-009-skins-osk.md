# T-009 · Skins: cargar una .osk y usarla

| | |
|---|---|
| **Fase** | 3 · La cascara (adelantado) |
| **Modelo** | Sonnet |
| **Rama** | `feat/skins` |
| **Depende de** | T-006 (cargador), `@tetra/storage` (unzip) |

## Por que este ticket

Arnold pidio poder usar su skin de osu! (la comparte como `.osk`, que es un zip
con imagenes y un `skin.ini`). En vez de empaquetar una skin ajena en el juego,
que tiene el mismo problema de derechos que los mapas, el juego **carga una
`.osk` que el usuario suelte**, igual que carga un `.osz`. De paso queda el
soporte de "varias skins" que el mismo menciono.

## Alcance de esta primera version

Una `.osk` de osu!mania trae muchisimo (posiciones por columna, anchos, columnas
especiales, imagenes por combo, sonidos). **No hay que soportar todo.** Esta
primera version cubre lo que hace que el skin de Arnold se vea como el suyo:

- Las **notas** de cada columna, con la convencion 4K estandar de osu!mania:
  columnas exteriores usan `mania-note1`, interiores usan `mania-note2` (en 4K:
  col 0 y 3 -> note1, col 1 y 2 -> note2). Si el skin trae `noteS` se ignora en
  4K (es para el carril central de modos impares).
- Los **cuerpos y colas de LN**: `note1H`/`note2H` (cuerpo, "hold") y
  `note1L`/`note2L` (cola, "tail").
- Los **receptores**: `mania-key1`/`mania-key2` (sin pulsar) y `key1D`/`key2D`
  (pulsado), con la misma convencion de columnas.

Todo lo demas (imagenes de juicio, piezas del escenario, layout desde
`skin.ini`) queda **fuera de esta version**. Documentar eso.

## Fallback

Si no hay skin cargada, o si a la skin le falta alguna de esas imagenes, se usa
lo que hay hoy: los rectangulos de color. La skin es aditiva, nunca un requisito.
Una `.osk` a la que le falten imagenes no debe romper el juego, solo caer al
fallback para lo que falte.

## Donde va cada parte

- **Descompresion y guardado** en `@tetra/storage`, al lado de lo de `.osz`:
  `importarOsk(file): Promise<SkinId>` que descomprime, extrae las imagenes
  necesarias como Blobs y las guarda en IndexedDB. Reusar el unzip que ya existe.
- **Carga de texturas y render** en `packages/engine`: el `Playfield` recibe un
  objeto de skin opcional (texturas ya resueltas) y, si viene, dibuja sprites en
  vez de rectangulos. La resolucion de Blob a textura de Pixi vive en engine o
  en apps/web, no en core ni en storage (storage no conoce Pixi).
- **UI en el cargador**: un control para soltar una `.osk` y elegir "skin por
  defecto (rectangulos)" o la skin cargada. Persistir cual esta activa.

## Cuidado con la convencion de columnas

El bug facil aca es mapear mal las columnas. En 4K de osu!mania el orden es
note1, note2, note2, note1 (exterior, interior, interior, exterior). Escribir
una funcion pura que dada la columna (0 a 3) devuelva cual imagen le toca, y
testearla. No hardcodear el mapeo disperso por el render.

## Rendimiento

No romper el pooling de T-004. Las texturas de skin se cargan una vez al
iniciar la partida, no por nota. Los sprites siguen viniendo del pool; lo unico
que cambia es su textura.

## Criterios de aceptacion

- [ ] Soltar la `.osk` de Arnold (`- !Sad Cookie.osk`) la importa sin error
- [ ] Con la skin activa, las notas y los receptores se dibujan con las imagenes
      del skin, con las columnas exteriores e interiores en el lugar correcto
- [ ] Las notas largas muestran cuerpo y cola del skin
- [ ] Sin skin, o con una skin incompleta, el juego cae a los rectangulos y no
      se rompe
- [ ] La skin activa se recuerda al recargar
- [ ] La funcion de mapeo de columna a imagen esta testeada
- [ ] El pooling sigue: los sprites vivos no crecen con el largo del mapa
- [ ] El e2e de sincronia sigue pasando
- [ ] Los cuatro checks en verde

## Nota de derechos

La `.osk` de Arnold es contenido de terceros (la skin "Sad Cookie" tiene autor).
Cargarla para uso propio esta bien; **no se empaqueta ni se publica con el
juego.** No agregar el archivo `.osk` al repositorio. Para tests, generar un
`.osk` minimo de prueba con imagenes de 1x1, como se hizo con el `.osz`.

## Terminado cuando

Los cuatro checks en verde, el e2e pasando, un `.osk` de prueba cubriendo el
flujo, revision de Opus, Arnold confirma que ve su skin, y squash merge a `main`.
