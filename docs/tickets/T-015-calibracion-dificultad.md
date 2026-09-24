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

## Meta de la calibracion (no de este ticket)

Correlacion de Spearman mayor a 0.85 contra osu!, y los diez casos que mas
discrepan revisados por Arnold. Ese era el criterio de cierre de la fase 4 en el
plan original.

## Terminado cuando

La herramienta funciona y esta fusionada. La calibracion en si se hace despues,
con los datos de Arnold.
