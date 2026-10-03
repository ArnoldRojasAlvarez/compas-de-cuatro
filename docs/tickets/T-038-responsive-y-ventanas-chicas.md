# T-038: Responsive y ventanas chicas

Prioridad: media. Tamano: M. Modelo: Haiku para los ajustes de CSS simples, Sonnet para el HUD. Archivos: `apps/web/src/hud.css`, `song-select.css`, `resultados.css`, `mapeador.css`, `ajustes.css`, `menu.css`.

## Contexto

El QA de la pasada grafica dejo hallazgos sin resolver: con ventanas de menos de unos 830 px de ancho la columna de datos del HUD se recorta; no se vio el song select ni los resultados a 375 px; el mapeador solo tiene una regla de columna unica a 860 px sin revisar. Una ventana chica o un proyector de baja resolucion no deberian romper la interfaz.

## Alcance

Revisar cada pantalla a 375, 768, 1024, 1280 y 1920 px de ancho (y a 480 px de alto en horizontal) y corregir:

- HUD: que la columna de datos no se recorte; bajo cierto ancho pasa debajo de la pista o se superpone con transparencia, sin tapar los carriles.
- Song select: lista y detalle en una columna, portadas con relacion de aspecto estable.
- Resultados: sin scroll horizontal; el grafico se adapta.
- Mapeador: el panel pasa arriba con altura acotada y el canvas conserva el area util; las barras de herramientas hacen wrap sin solaparse.
- Ajustes y menu: sin desbordes.

## Criterios de aceptacion

- [ ] Ninguna pantalla produce scroll horizontal a 375 px.
- [ ] Ningun texto queda recortado a ningun ancho de la lista.
- [ ] La pista de juego mantiene sus 440 px (4 carriles x 110) o escala de forma uniforme, nunca deformada.
- [ ] Se adjunta una verificacion por pantalla y ancho (medida con `getBoundingClientRect`, no solo captura: la vista previa escala dos veces, ver HANDOFF, leccion 9).

## Tests

Es CSS casi en su totalidad: la prueba es la medicion en navegador. Para lo que tenga logica (por ejemplo el ancho logico del grafico de resultados) se agrega un test puro.

## Fuera de alcance

Soporte tactil real para jugar (la entrada es teclado), version movil dedicada.

## Terminado cuando

Hay una tabla pantalla x ancho con el resultado medido, y los cuatro checks en verde.
