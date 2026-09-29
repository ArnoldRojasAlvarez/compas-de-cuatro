# T-015 · Calibracion del motor de dificultad contra osu!

| | |
|---|---|
| **Fase** | 4 · Motor de dificultad |
| **Modelo** | Sonnet (herramienta) + Arnold (datos y arbitraje) + Opus (ajuste) |
| **Rama** | `feat/calibracion-dificultad` |
| **Depende de** | T-013, T-014 |

## Contexto

Las escalas de T-013 son provisionales: estan ancladas a patrones sinteticos.
Para que las estrellas signifiquen algo hay que compararlas con mapas reales
cuya dificultad ya se conoce. osu! le pone star rating a cada mapa rankeado, y
Arnold, top 40 mil del mundo, sabe cuando un mapa esta mal calificado. Las dos
fuentes juntas son la verdad de referencia.

Este ticket es **la herramienta**, no la calibracion en si. La calibracion es un
proceso en tres pasos con tres responsables distintos.

## El proceso

1. **Arnold** importa entre 30 y 50 mapas de mania 4K rankeados, variados en
   dificultad (de 1 a 7 estrellas) y en estilo (stream, jumpstream, jacks,
   chordjack, tech, maratones). Para cada uno anota el star rating que muestra
   osu!, y si quiere, una etiqueta propia ("esto es jacks puro", "esta
   sobrecalificado").
2. **La herramienta** calcula el vector de Tetra para cada mapa y compara.
3. **Opus** lee el informe, ajusta `PARAMETROS_DIFICULTAD` y sube
   `VERSION_MODELO_DIFICULTAD`. Arnold arbitra los casos donde Tetra y osu! no
   coinciden: a veces el que esta mal es osu!, y ahi Tetra no tiene que
   copiarlo. Esa es justamente la tesis del proyecto.

## La herramienta

Una pantalla de desarrollo, fuera de la navegacion normal (por ejemplo accesible
con `#calibracion` en la URL). No es para jugadores.

- Lista de todas las dificultades de la biblioteca, con un campo para escribir
  el star rating de osu! y uno de notas libres. Persistido en IndexedDB o
  localStorage.
- Para cada fila: el overall de Tetra, el vector completo y la diferencia.
- **Correlacion de Spearman** entre el overall de Tetra y el SR de osu! (de
  rangos, porque importa el orden, no la escala). Funcion pura, testeada con un
  caso calculado a mano.
- **Ajuste de escala global** por minimos cuadrados: el factor que mejor lleva
  el overall de Tetra a los valores de osu!. Sugerencia, no se aplica sola.
- **Las diez peores discrepancias** ordenadas, con su vector completo, para que
  Arnold las revise una por una.
- **Exportar** todo a JSON, que es lo que Opus lee para ajustar parametros.

## Criterios de aceptacion

- [ ] Se accede con `#calibracion` y no aparece en la navegacion normal
- [ ] Se puede anotar el SR de osu! y notas por dificultad, y persiste
- [ ] Spearman testeado contra un caso calculado a mano
- [ ] El ajuste de escala esta testeado
- [ ] Muestra las diez peores discrepancias con el vector
- [ ] Exporta JSON
- [ ] Los cuatro checks en verde

## Primer objetivo conocido: los jacks

La revision de T-013 ya encontro un sesgo antes de tener datos: la escala
provisional ("a igual notas por segundo, igual estrella") subestima los jacks,
porque un jack concentra todos los golpes en un dedo. Por eso los mapas de
calibracion tienen que incluir **varios mapas de jacks y de chordjacks** con SR
conocido, y lo primero a revisar en el informe es `ESCALA_jackspeed` (la parte
de chordjack quedo en duda con la segunda tanda de datos, ver abajo). Al cerrar la calibracion, poner `MODELO_CALIBRADO = true` y
subir `VERSION_MODELO_DIFICULTAD`.

## Primeros datos reales (24 de setiembre, antes de calibrar)

Arnold aporto tres mapas. Se midieron con el motor de T-013 tal cual, desde un
script fuera del repo (los `.osz` son de terceros y no se versionan):

| Mapa | Dificultad | NPS | Overall | Dominante |
|---|---|---|---|---|
| FRAGMENT. | AVEL'S EASY | 3.6 | 1.28 | stamina |
| FRAGMENT. | NORMAL | 6.8 | 2.42 | stamina |
| FRAGMENT. | HARD | 9.7 | 3.52 | jumpstream |
| FRAGMENT. | MIGHTY'S HYPER | 12.8 | 4.87 | jumpstream |
| FRAGMENT. | UCITYSM VS. JOHNO'S INSANE | 16.8 | 8.75 | jumpstream |
| FRAGMENT. | FATE | 21.2 | 9.23 | jumpstream |
| FREEDOM DiVE | 4K Normal | 5.1 | 2.68 | stamina |
| FREEDOM DiVE | 4K Hyper | 8.0 | 4.26 | stamina |
| FREEDOM DiVE | 4K Another | 11.9 | 6.40 | stamina |
| FREEDOM DiVE | Fullerene's 4K DIMENSIONS | 21.6 | 15.58 | jumpstream |
| Galaxy Collapse | Cataclysmic Hypernova | 14.7 | 14.35 | jumpstream |

Lo que dicen:

1. **El orden es correcto.** Dentro de cada set, el orden de Tetra coincide
   exactamente con la escalera de los mapeadores (10 de 10). La senal de fondo
   funciona. Estas escaleras son verdad de referencia gratis: no necesitan el
   SR de osu!, y la herramienta deberia usarlas como criterio extra (Spearman
   dentro de cada set).
2. **La escala lineal se dispara arriba.** Los mapas mas densos dan 14 y 15,
   aproximadamente el doble de lo que les da osu!. La dificultad percibida
   crece mas lento que la densidad. **El ajuste no puede ser solo un factor:**
   hay que ajustar una ley de potencia, `estrella = a * valor^p` con `p < 1`,
   por minimos cuadrados en escala log-log. Eso agrega un parametro global
   (`EXPONENTE_ESTRELLAS`, hoy implicitamente 1) al modelo de T-013.
3. **Stamina domina los mapas faciles y largos, y es engañoso.** Un Normal de
   cuatro minutos no es "un mapa de stamina". Causa estructural: stamina suma
   todas las notas (`A_stam * size`), mientras que cada skillset de patron solo
   cuenta las filas que le tocan. En los patrones puros de la escala
   provisional la diferencia no aparecia; en mapas reales, que mezclan todo,
   stamina queda inflada. **Arreglo propuesto para probar contra los datos:**
   que stamina deje de acumular notas y pase a medir cuanto tiempo se sostiene
   la dificultad de patron, por ejemplo un promedio de decaimiento lento sobre
   el maximo instantaneo de los seis strains de pico. Asi un mapa facil y largo
   tiene stamina baja, y una maraton de jumpstream la tiene alta.
4. **Faltan mapas de jacks.** Ninguno de los tres tiene jacks relevantes (jack
   menor a 1 en todos), asi que el sesgo de jacks no se puede medir todavia.

## Segunda tanda de datos (28 de setiembre): jacks y chordjacks

Arnold aporto Jacks Practice (escalera Lv.1 a Lv.5), Tachyon Anime Chordjacks 2
(40 dificultades, con variantes de velocidad 1.1 a 1.4) y Las Avispas (1.0x a
1.3x). Resultados con el motor de T-014:

- **Todas las variantes de velocidad salen en orden** (cada una mas rapida,
  estrictamente mas dificil) y la escalera de Jacks Practice tambien. Las
  variantes de velocidad son verdad de referencia gratis: sirven para validar
  sin necesitar el SR de osu!.
- **Jackspeed da menos de 0.8 en todos**, incluido Jacks Practice. Es un defecto
  de definicion, no de calibracion: ver T-017.
- **Correccion a lo dicho arriba:** los chordjacks no parecen subestimados. Los
  mas densos dan entre 18 y 22 (Keikan no Senritsu 1.2: 22.18), igual de
  inflados que todo lo de arriba. El sesgo que se sostiene es el de los jacks de
  un dedo (jackspeed). El SR de osu! lo confirmara o no.

## Meta de la calibracion (no de este ticket)

Correlacion de Spearman mayor a 0.85 contra osu!, y los diez casos que mas
discrepan revisados por Arnold. Ese era el criterio de cierre de la fase 4 en el
plan original.

## Terminado cuando

La herramienta funciona y esta fusionada. La calibracion en si se hace despues,
con los datos de Arnold.

## Tercera tanda (28 de setiembre): primer SR real de osu!

Arnold paso capturas de osu! lazer con el SR de 32 dificultades de Tachyon Anime
Chordjacks 2 (rango 4.22 a 6.28; faltan Keikan, Last Stardust 1.2 y 1.3, Over
The Galaxy 1.3 y My Sweet Maiden 1.4, que no salian en pantalla). Contra el
modelo v3 (`scratchpad/sr-tachyon.mjs`):

- **Spearman 0.913** en las 32, y 0.905 solo en las 8 versiones base. La meta
  de la fase era mayor a 0.85: el orden ya la cumple en chordjack.
- **Ajuste log-log:** `a = 2.29`, `p = 0.38`, R² = 0.83. Confirma que hace
  falta un exponente bastante menor a 1, pero **no se aplica todavia**: el rango
  de SR es angosto (4 a 6) y un p ajustado ahi no vale para los extremos (con
  esos numeros, el EASY de FRAGMENT daria 1.8). Hace falta el SR de mapas
  faciles y de otros estilos para fijar la curva.
- **Discrepancias sistematicas** (con el ajuste aplicado):
  - Endou - Coolest, el unico donde domina jumpstream, sale sobrevaluado en
    todas sus variantes (+0.03 a +0.53). Jumpstream pesa demasiado frente a
    chordjack.
  - Akino - MIIRO sale subvaluado en todas (-0.14 a -0.51). Hay algo en ese
    mapa que el modelo no ve; pedirle a Arnold que diga que patron tiene.
- Ojo: es el SR de lazer, no el de stable. Usar siempre la misma fuente.

Siguiente dato que falta: el SR de FRAGMENT, FREEDOM DiVE, Jacks Practice y
Las Avispas, para cubrir de 1 a 4 estrellas y los jacks.

## Cuarta tanda y calibracion v1 (28 de setiembre)

Arnold agrego el SR de FRAGMENT, FREEDOM DiVE 4K, Las Avispas y Jacks Practice:
54 dificultades en total, en `docs/calibracion/sr-osu-lazer.json`. Con eso se
hizo T-018 (pesos por skillset y curva `1.757 * lineal^0.436`): Spearman 0.962,
error medio 0.21 estrellas sin re-ajustar. Falta cobertura de jacks de un dedo,
tech y mapas de mas de 6.3.
