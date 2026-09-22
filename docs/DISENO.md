# Sistema de diseno de Tetra

Identidad visual propia, deliberadamente distinta de osu!. Esta es la referencia
para toda la UI de la fase 3 en adelante. Si una pantalla nueva no sale de aca,
es un bug de diseno.

## El concepto: instrumento de precision

osu! es rosado, energico, redondeado, con mascotas. Tetra es lo contrario:
calmo, exacto, tecnico. La referencia mental es un metronomo, un osciloscopio,
un afinador. La emocion no es "fiesta", es "precision". El jugador viene a medir
su timing al milisegundo, y la interfaz respeta eso.

El hilo conductor es el numero **cuatro**: cuatro carriles, compas de 4/4, la
simetria de cuatro cuadrantes del logo. Donde haya que elegir una estructura,
que rime con el cuatro.

## Paleta

La paleta de marca **sale del propio juego**: son los colores de juicio de la
pista, no una eleccion arbitraria. Eso la hace propia por construccion.

Fondo oscuro primero, porque un juego de ritmo se juega en la oscuridad.

```
--fondo:        #0B0E11   /* casi negro, con sesgo azul-verdoso, no gris puro */
--superficie:   #131A1F   /* paneles */
--superficie-2: #1C252B   /* elementos elevados */
--linea:        #263139   /* bordes, divisores */
--tinta:        #E7EEF0   /* texto principal */
--tinta-2:      #9DAAB2   /* texto secundario */
--tinta-3:      #5F6E77   /* texto tenue, etiquetas */

--acento:       #3FD8C2   /* teal electrico. El color de marca. Es el MAX del juego */
--acento-2:     #E8B84A   /* ambar. Segundo acento. Es el 300 del juego */

/* El espectro de juicio, que es tambien la paleta de datos del juego */
--j-max:   #3FD8C2
--j-300:   #E8B84A
--j-200:   #5FC46A
--j-100:   #4F93D8
--j-50:    #9A78D8
--j-miss:  #D8544E
```

Un solo acento manda (el teal). El ambar es apoyo. Nada de rosa osu!. El resto
son neutros con un sesgo frio, elegidos, no grises de fabrica.

## Tipografia

Tres roles, tres familias, todas de Google Fonts (el unico host que admite el
CSP de artifacts, y aca simplemente por consistencia y disponibilidad):

- **Display**: `Sora`. Geometrica, moderna, con caracter, para titulos y el
  logotipo. No es la Exo 2 del documento de propuesta ni la Inter de siempre.
- **Cuerpo**: `IBM Plex Sans`. Limpia, neutral, legible en tamanos chicos.
- **Datos**: `JetBrains Mono`. Para todo lo que es numero y se lee al vuelo o se
  alinea en columna: BPM, ms, estrellas, score, precision, fps. Es el corazon
  del juego (medir), asi que los numeros tienen su propia voz monoespaciada, con
  `font-variant-numeric: tabular-nums`.

Escala de tipo definida y respetada. Titulos con `text-wrap: balance`.
Mayusculas con letter-spacing en etiquetas.

## El logotipo

Lo que Arnold describio de osu!, hecho propio:

- Un **anillo** con la palabra o marca en el centro, en la face Display.
- **Respira**: escala sutilmente con el beat de la musica del menu (un pulso
  rapido en cada golpe, no una animacion constante).
- Alrededor de toda su circunferencia, las **barras del espectro** de audio.
- El espectro esta **partido en cuatro cuadrantes espejados** que giran en
  sentido horario, para una figura siempre simetrica. El cuatro otra vez.
- Se dibuja en Canvas o WebGL, no con SVG hecho a mano (es generativo y cambia
  cada frame). Lee el audio con un `AnalyserNode`.
- Colores: el anillo y las barras en `--acento`, con la intensidad de cada barra
  modulando el brillo. Nada de arcoiris.

## Layout y principios

- **Oscuro, espacioso, alineado a una grilla.** El aire es parte del diseno.
- **Los datos se lucen.** BPM, estrellas, ms, precision: en mono, tratados como
  instrumentos de medicion, no como texto decorativo.
- **Una sola cosa brilla por pantalla.** El acento se gasta en el elemento que
  importa (el logo en el menu, la cancion en foco en el select), no en todo.
- **Movimiento con proposito.** La respiracion del logo, el foco que se expande
  en la lista, el fundido del preview. Nada de animacion por decorar.
- **Tema unico, oscuro, asumido.** A diferencia de un documento, el juego
  compromete un solo look. No hace falta modo claro.

## Que evitar (para no recaer en osu! ni en lo generico)

- Rosa magenta como acento.
- Todo redondeado con la misma esquina. El radio se gasta por rol.
- Mascotas, emoji como iconos, gradientes morado-a-azul.
- Centrar todo. La grilla y la alineacion a la izquierda dan estructura.
