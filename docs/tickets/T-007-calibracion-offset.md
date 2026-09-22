# T-007 · Calibracion de offset y resultados cuantificados

| | |
|---|---|
| **Fase** | 2 · Contenido (adelantado desde el T-010 previsto) |
| **Modelo** | Sonnet |
| **Rama** | `feat/calibracion` |
| **Depende de** | T-004 (reloj y resultados), T-006 (cargador) |

## Por que este ticket ahora

Arnold hizo la prueba de feel. Resultado: en el click track pego todo temprano
(anticipacion de metronomo, algo humano y esperable), y en una cancion real los
golpes salieron centrados en cero. Eso confirma que el motor no tiene offset
sistematico: la sincronia esta bien.

Lo que falta es lo que tiene osu! y Tetra no: poder **calibrar un offset** a
gusto del jugador y su hardware, y **medir** la desviacion con numeros en vez de
mirar la nube de puntos. Como Arnold es top 40 mil del mundo, darle el numero
exacto de su desviacion promedio vale mas que cualquier grafico.

## Parte A: resultados cuantificados

En `apps/web/src/results.ts`, ademas de la nube de puntos que ya existe, agregar:

- **Desviacion media** en ms, con signo y con la palabra: por ejemplo
  "media: -24 ms (temprano)". Es el promedio de `error` de todos los golpes que
  no fueron miss.
- **Desviacion estandar** en ms: que tan disperso pega. Un valor bajo es un
  jugador consistente.
- **Cuenta temprano contra tarde**: cuantos golpes de cada lado del cero.
- **Etiquetas en el grafico**: la linea de cero rotulada "0", y arriba y abajo
  rotular el limite con su valor (por ejemplo "+80 ms tarde" arriba,
  "-80 ms temprano" abajo). Hoy el grafico no tiene ninguna referencia numerica.

**Ojo, hay un comentario al reves que corregir:** en `results.ts`, la linea que
dice "arriba temprano, abajo tarde" esta invertida. La matematica de `yDeError`
pone el error positivo (tarde) arriba y el negativo (temprano) abajo. Corregir
el comentario para que diga "arriba tarde, abajo temprano".

## Parte B: ajuste de offset

El reloj (`packages/audio/src/clock.ts`) ya expone `userOffset` mutable. Falta
la parte de arriba: guardarlo y aplicarlo.

- **Persistencia**: guardar el offset del usuario en `localStorage` (esto va en
  `apps/web`, no en core). Al arrancar una partida, leerlo y pasarlo al reloj
  via `ClockOptions.userOffset`.
- **Control en el cargador**: en la pantalla de `cargador.ts`, un control para
  ver y cambiar el offset en ms. Numero editable mas botones de mas y menos de
  1 ms. Con un texto corto que explique: "positivo si sentis que las notas van
  adelantadas".
- **Aplicar la media como offset, al estilo osu!**: en la pantalla de
  resultados, si la media de desviacion es distinta de cero, un boton que diga
  algo como "corregir offset segun esta partida (media -24 ms)" que ajuste el
  offset guardado para centrar los proximos golpes. Pensar bien el signo: si
  pego temprano (media negativa), hay que retrasar el juicio, y hay que dejar
  documentado en el codigo hacia que lado va la correccion, porque es facil
  equivocarse.

## El signo, que es donde esto se rompe

`userOffset` positivo retrasa las notas (ver el JSDoc del reloj). Si el jugador
pega temprano (error medio negativo), el objetivo es que sus proximos golpes
caigan mas cerca del cero. Escribir un test que fije la relacion: dada una media
de error negativa, la correccion sugerida mueve el offset en la direccion que la
acerca a cero, no que la aleja. Este test es el que evita el clasico bug de
signo invertido.

## Criterios de aceptacion

- [ ] La pantalla de resultados muestra media, desviacion estandar y cuenta
      temprano/tarde, con numeros correctos verificados a mano en un test
- [ ] El grafico tiene la linea de cero rotulada y los limites con su valor en ms
- [ ] El comentario invertido de `results.ts` queda corregido
- [ ] El offset se guarda en localStorage y sobrevive recargar la pagina
- [ ] Al empezar una partida, el offset guardado se pasa al reloj
- [ ] Subir el offset mueve la nube de puntos de la siguiente partida hacia
      temprano (abajo), bajarlo hacia tarde (arriba). NOTA: la version original
      de este criterio decia lo contrario y estaba mal; contradecia la
      matematica ya probada del reloj (clock.test.ts H4). La direccion correcta
      es la de aca. Verificable a mano por Arnold
- [ ] El boton de "corregir segun esta partida" mueve el offset en la direccion
      correcta, cubierto por un test de signo
- [ ] El e2e de sincronia de T-004 sigue pasando
- [ ] Los cuatro checks en verde

## Como probar el calculo sin navegador

La media, la desviacion estandar y la logica de correccion de offset son
funciones puras sobre un array de errores. Sacalas a un modulo testeable (puede
ser `apps/web/src/estadisticas.ts` o dentro de `core` si te parece que es
dominio puro, a tu criterio, pero si va en core respeta que no toque el
navegador) y testealas con valores calculados a mano.

## Fuera de alcance

- Un asistente de calibracion interactivo tipo osu! con audio de prueba. Esto es
  el ajuste manual mas la correccion por media, que ya resuelve el caso de
  Arnold. El asistente completo, si se quiere, es otro ticket.

## Terminado cuando

Los cuatro checks en verde, el e2e de T-004 pasando, revision de Opus aprobada,
Arnold confirma que puede centrar sus golpes con el ajuste, y squash merge a
`main`.
