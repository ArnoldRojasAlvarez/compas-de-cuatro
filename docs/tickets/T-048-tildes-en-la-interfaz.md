# T-048: Tildes y enie en la interfaz (decision previa de Arnold)

Prioridad: baja. Tamano: S si se aprueba. Modelo: Haiku (reemplazos de texto, sin logica). Archivos: todos los textos visibles de `apps/web/src/*.ts` y `index.html`.

## Contexto

Todos los textos de la interfaz estan escritos sin tilde ni enie ("Elegir cancion", "Instrumento de precision", "Dificultad" ya sin problema pero "musica", "tamano", "sesion"). Probablemente nacio asi por prudencia con la codificacion, no por decision de diseno. El proyecto es de un curso de Apreciacion Musical, se presenta ante publico y esta en espanol: la falta de tildes se nota en pantalla.

## Decision que hace falta

Arnold tiene que elegir antes de que se toque nada:

1. Poner tildes y enie en todos los textos visibles (recomendado), o
2. Dejar la interfaz sin tildes a proposito (estilo consistente con los comentarios del codigo).

Los comentarios del codigo y los documentos internos no se tocan en ningun caso. La regla de no usar rayas largas se mantiene.

## Alcance (si se aprueba la opcion 1)

- Reemplazar solo cadenas visibles al usuario (etiquetas, avisos, titulos, `title`, `aria-label`, `placeholder`). No nombres de clases CSS, claves de `localStorage`, ids ni identificadores.
- Revisar que las fuentes (Sora, IBM Plex Sans, JetBrains Mono) rendericen bien los caracteres con acento y la enie.
- Los tests que comparan texto de interfaz se actualizan junto con el cambio.

## Criterios de aceptacion

- [ ] Ninguna palabra visible queda sin tilde donde la ortografia la pide (revision completa pantalla por pantalla).
- [ ] No cambia ningun identificador, clave de almacenamiento ni clase CSS.
- [ ] Los cuatro checks en verde con el mismo numero de tests.

## Tests

Los existentes. Un test adicional que recorra los archivos de `apps/web/src` y falle si encuentra en una cadena visible una palabra de una lista corta de errores comunes ("cancion", "musica", "configuracion", "sesion", "tamano", "precision").

## Terminado cuando

Arnold aprobo la opcion 1 y se reviso cada pantalla en el navegador.
