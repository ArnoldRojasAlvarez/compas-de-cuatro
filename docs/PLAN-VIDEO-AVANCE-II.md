# Plan del video del Avance II

Entrega: **28 de octubre de 2026**, por TECDigital. Lo que pide el curso es un
video con la grabacion de pantalla de Arnold haciendo la cancion. La cancion la
compone Arnold; el codigo y los agentes no la tocan.

## Idea central

El video cuenta el proyecto completo en el orden del Avance I: **componer,
transcribir, tocar**. Asi muestra en un solo video tres de los cinco objetivos
especificos (1, 2 y 3) y parte del 4 (la clasificacion de dificultad), cuando
el cronograma del Avance I prometia en octubre solo la composicion y el
programa. Eso va adelantado y hay que decirlo en el video.

## Estructura (4 a 6 minutos ya editado)

| Parte | Duracion | Que se ve | Que se dice (texto en pantalla o voz) |
|---|---|---|---|
| 1. Apertura | 15 s | Titulo "Compas de Cuatro", nombre, curso | Que es el proyecto en una frase |
| 2. Decisiones | 30 s | El DAW vacio: tempo, compas 4/4, metronomo, marcadores de secciones | Tempo elegido y por que, compas de cuatro tiempos, forma (por ejemplo intro, A, B, A, final) |
| 3. Composicion | 2 min | Grabacion acelerada: primero la bateria, despues el bajo, despues la melodia | Por que se empieza por el ritmo (la justificacion del Avance I); corcheas, semicorcheas y sincopas cuando aparezcan |
| 4. Transcripcion | 1 min | Editor de osu! lazer poniendo notas sobre el pulso, con la division 1/4 | Mapear es transcribir: cada acento pasa a una tecla en un momento exacto |
| 5. Ejecucion | 1 min | Tetra: importar la cancion, el perfil de dificultad, jugarla entera | La precision se mide en milisegundos; el juego es propio |
| 6. Cierre | 15 s | Pantalla de resultados | Que falta para la semana 17 |

## Cronograma (4 semanas)

| Semana | Fechas | Arnold | Opus y agentes |
|---|---|---|---|
| 1 | 29 set a 5 oct | Elegir DAW, tempo y estructura. Probar OBS con una grabacion corta. Primer boceto de ritmo | Dejar Tetra "listo para grabar" (ver abajo) |
| 2 | 6 a 12 oct | Componer bateria, bajo y melodia. **Grabar cada sesion** | Seguir con el juego sin tocar nada visible |
| 3 | 13 a 19 oct | Terminar y mezclar. Exportar a mp3 u ogg. Mapear en osu! lazer, grabando | Probar el `.osz` de Arnold en Tetra apenas exista |
| 4 | 20 a 26 oct | Grabar la partida en Tetra. Editar el video | Guion de textos en pantalla si Arnold lo pide; borrador del documento del Avance II |
| | 27 oct | Colchon | |
| | 28 oct | Entregar | |

## Herramientas (todas gratis)

- **Grabar:** OBS Studio. Salida 1920x1080 a 30 fps, grabar en `.mkv` (no se
  pierde si se cae la compu) y despues "Remux a MP4". Capturar el audio del
  escritorio, no el microfono, salvo que haya voz.
- **Componer:** si nunca uso un DAW, BandLab (en el navegador, guarda en la
  nube). **Evitar la version de prueba de FL Studio:** no deja reabrir
  proyectos guardados. LMMS tambien sirve y es gratis.
- **Mapear:** el editor de osu! lazer, exportando a `.osz`. Sin cambios de
  velocidad (SV): Tetra todavia no los dibuja.
- **Editar:** Clipchamp (viene con Windows) o DaVinci Resolve. Acelerar las
  sesiones largas (x4 a x8) y dejar a velocidad normal los momentos clave.

## Reglas para no perder el trabajo

- Grabar **todas** las sesiones aunque parezcan aburridas. Se recorta despues;
  lo que no se grabo no se puede recuperar.
- Guardar las grabaciones crudas en una carpeta aparte, con fecha en el nombre.
- Si TECDigital no acepta el tamano del archivo, subirlo a YouTube como "no
  listado" o a Google Drive y entregar el enlace. Revisar el limite antes del
  27.

## Tetra "listo para grabar" (trabajo de Opus, antes del 20 de octubre)

1. Que `npm run dev` funcione siempre, sin compilar antes (la trampa de la
   `dist`). Para grabar no puede fallar.
2. Probar de punta a punta un `.osz` exportado por osu! lazer: importar,
   estrellas, jugar, resultados.
3. Revisar que el song select, la partida y los resultados se vean bien en
   1920x1080, que es lo que graba OBS.
4. Opcional: que la musica del menu sea la cancion de Arnold en vez del click
   track.

## Video corto de esta semana (completa el Avance I)

Arnold necesita un video esta semana para completar el Avance I. La cancion no
esta hecha, asi que el video muestra **el punto de partida**: el programa que ya
existe y la primera sesion de composicion. De 2 a 3 minutos.

| Parte | Duracion | Que se graba |
|---|---|---|
| 1. El programa | 45 s | Tetra en pantalla completa (F11): menu, song select con el perfil de skillsets, una partida corta con el click track o el mapa de prueba, resultados con la desviacion en ms |
| 2. Primera sesion | 1 a 1.5 min | El DAW: fijar tempo y compas 4/4, prender el metronomo y armar el primer ritmo de bateria (bombo en 1 y 3, caja en 2 y 4, hi-hat en corcheas). Acelerado donde sea repetitivo |
| 3. Cierre | 15 s | Texto: que sigue (terminar la pieza en octubre, mapearla, tocarla en vivo en la semana 17) |

Extra si alcanza el tiempo: mapear 8 compases de ese ritmo en osu! lazer,
exportar el `.osz` y tocarlo en Tetra. Es el proyecto entero en miniatura.

Tetra ya esta listo para grabar: `npm run dev` funciona sin compilar antes
(desde el 29 de setiembre).
