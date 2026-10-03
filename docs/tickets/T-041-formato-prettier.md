# T-041: Deuda de formato con Prettier

Prioridad: baja. Tamano: S. Modelo: Haiku (es mecanico, sin logica de juego). Archivos: todo el repo, un solo commit aparte.

## Contexto

El QA de la pasada grafica encontro que `header.ts` y `style.css` ya no cumplian el formato de `.prettierrc` antes de esa pasada, y varios archivos nuevos se escribieron a mano sin pasar por Prettier (`mapeador.ts` tiene lineas largas). `npm run format` existe pero no esta en los checks, asi que la deuda crece sin que nada avise.

## Alcance

1. Un commit que SOLO formatea (`npx prettier --write .` acotado a `apps/`, `packages/`, `docs/`, `tools/`), sin ningun cambio de logica. Revisar que el diff sea puramente de espacios y saltos de linea (comparar con `git diff -w --stat`).
2. Agregar `npm run format:check` (`prettier --check .`) y ejecutarlo en el workflow de CI como paso aparte.
3. Archivo `.prettierignore` con `dist`, `.tsbuild`, `node_modules`, `.claude` y los `.osz` o binarios de fixtures.
4. Cuidado con los finales de linea: el repo tiene `.gitattributes` y avisa de CRLF a LF en Windows; confirmar que Prettier use `endOfLine: 'lf'` para no generar diffs eternos.

## Criterios de aceptacion

- [ ] `npm run format:check` pasa.
- [ ] `git diff -w` del commit de formato no muestra cambios de contenido.
- [ ] Los cuatro checks en verde antes y despues, con el mismo numero de tests.

## Tests

Ninguno nuevo: la prueba es que el numero de tests y su resultado no cambian.

## Fuera de alcance

Reglas de estilo nuevas, renombrados, reorganizar archivos.

## Terminado cuando

Un commit de formato aparte, la comprobacion de formato en CI, y ningun cambio de comportamiento.
