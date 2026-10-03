# T-040: Pruebas e2e del flujo completo y CI real

Prioridad: alta. Tamano: M. Modelo: Sonnet. Archivos: `apps/web/e2e/`, `apps/web/playwright.config.ts`, `.github/workflows/ci.yml`, tests de rendimiento de `packages/core`.

## Contexto

Solo existe un e2e (sincronia del reloj). Nada prueba el recorrido que un usuario hace: menu, song select, partida, resultados, mapeador. La CI nunca corrio de verdad (solo localmente) porque el repositorio no esta en GitHub (decision pendiente de Arnold). Y los tests "3500 notas en menos de 50 ms" de `core/judge` y `core/difficulty` fallaron mas de una vez cuando la maquina estaba cargada: un test flaky no se fusiona (HANDOFF, leccion 5).

## Alcance

1. **E2E del recorrido principal:** importar el `.osz` de fixtures, entrar a la partida con el click track, pulsar las teclas, llegar a los resultados y ver el rango y la precision; volver al song select.
2. **E2E del mapeador:** cargar `click-120.wav`, comprobar que se detectan ~120 golpes y BPM 120, generar un mapa, poner una nota a mano, guardar en la biblioteca y encontrarla en el song select.
3. **Sin sonido en los e2e:** inyectar el silenciador de dev (`localStorage['tetra:mudo']='1'` via `addInitScript`) para que la suite no suene.
4. **Tests de rendimiento no flaky:** medir la mediana de varias repeticiones con un margen amplio, o comparar contra una linea base calculada en la misma corrida (relativa), en vez de un limite absoluto de ms.
5. **CI:** el workflow corre typecheck, lint, test, build y los e2e en Chromium con `npx playwright install --with-deps chromium`. Se valida en local con `act` o ejecutando los mismos comandos; la primera corrida real espera a la decision del repositorio remoto.

## Criterios de aceptacion

- [ ] `cd apps/web && npx playwright test` pasa 3 veces seguidas sin fallos intermitentes.
- [ ] Los tests de rendimiento pasan 10 veces seguidas con la maquina cargada (por ejemplo corriendo dos suites a la vez).
- [ ] El workflow de CI esta actualizado y documentado en `docs/HANDOFF.md`.

## Tests

Son tests. Para cada e2e se escribe que implementacion rota lo haria fallar (por ejemplo, un guardado que no escriba en IndexedDB rompe el e2e del mapeador).

## Fuera de alcance

Pruebas visuales por captura (diffs de imagen), pruebas en Firefox y Safari.

## Terminado cuando

Los e2e pasan estables, la CI esta lista para correr en cuanto exista el repositorio remoto.
