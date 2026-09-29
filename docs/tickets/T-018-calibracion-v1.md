# T-018 · Primera calibracion contra el SR de osu!

| | |
|---|---|
| **Fase** | 4 · Motor de dificultad |
| **Modelo** | Sonnet |
| **Rama** | `feat/calibracion-v1` |
| **Depende de** | T-015, T-016, T-017 |
| **Toca** | solo `packages/core/src/difficulty/` |

## Datos

Arnold paso el SR de osu! lazer de 54 dificultades de 5 sets (Tachyon Anime
Chordjacks 2, FREEDOM DiVE 4K, FRAGMENT, Las Avispas, Jacks Practice). Estan en
`docs/calibracion/sr-osu-lazer.json` (set, dificultad, SR). Solo numeros, nada
de contenido de terceros. Rango de SR: 1.32 a 6.28.

Contra el modelo v3:

| | Spearman | RMSE tras ajuste | R² log-log |
|---|---|---|---|
| Modelo v3, solo curva global | 0.943 | 0.289 | 0.956 |
| Con pesos por skillset y curva | **0.962** | **0.208** | 0.975 |

Sesgo por skillset dominante con la curva sola: jumpstream +0.27 (sobrevaluado),
chordjack -0.13 (subvaluado). La busqueda en grilla de pesos da jumpstream x1.15
y chordjack x1.4, relativos a stream. Dejando afuera un set por vez, los pesos
quedan entre 1.15 y 1.3 para jumpstream y entre 1.4 y 1.55 para chordjack:
es estable, no es sobreajuste a un set.

Jackspeed **no se puede identificar** con estos datos (ningun mapa lo tiene de
dominante; el RMSE es igual con peso 1 a 5). Se deja en 1.

## Cambio

Separar la estrella en dos etapas:

```
lineal_k   = PESO_k * ESCALA_k * valor_k          // T-013 intacto, mas el peso
estrella_k = coefEstrellas * lineal_k ^ exponenteEstrellas
```

- `ESCALA_k` no se toca: sigue siendo el anclaje sintetico de T-013 (y T-016
  para stamina).
- Nuevo `pesoCalibracion` en `PARAMETROS_DIFICULTAD`: jumpstream 1.15,
  chordjack 1.4, el resto 1.
- `exponenteEstrellas` pasa de 1 a **0.436** y cambia de significado: ahora se
  aplica a `lineal_k`, no a `valor_k`. Nuevo `coefEstrellas` = **1.757**.
- El `m` de stamina usa `lineal_k` de los seis de pico (con el peso), no la
  estrella con curva. Asi el anclaje de stamina (en regimen, igual a stream)
  sigue valiendo, porque stream tiene peso 1 y la curva es la misma para todos.
  Comprobarlo re-derivando `ESCALA_stamina` con el procedimiento documentado:
  tiene que seguir dando ~1.0.
- `overall` = max de las estrellas (con curva). Como la curva es monotona, es
  lo mismo que aplicar la curva al max lineal.
- `VERSION_MODELO_DIFICULTAD` a 4. `MODELO_CALIBRADO` sigue en `false`: faltan
  mapas de jacks puros, stream y tech con SR. Documentar la cobertura en el
  JSDoc (sets, rango de SR, fuente: lazer).

## Tests

- Con `pesoCalibracion` todo en 1, `coefEstrellas` 1 y `exponenteEstrellas` 1,
  el vector es identico al de v3 (usar parametros inyectados si la funcion los
  acepta; si no, exponer una variante interna testeable).
- La curva es monotona: mas `lineal` da mas estrella, y 0 da 0.
- Las propiedades existentes siguen pasando. Las que comparan valores absolutos
  de estrellas (anclajes de 4 estrellas) tienen que seguir valiendo sobre
  `lineal`; si hay que re-expresarlas, que sea explicito y justificado, sin
  aflojar umbrales.

## Verificacion con datos reales (obligatoria)

1. `npm run typecheck` y despues `RAIZ=<worktree> node medir-lazer.mjs > lazer-v4.txt`,
   en el scratchpad
   `C:/Users/Arnold/AppData/Local/Temp/claude/C--Users-Arnold-Desktop-Musica/d3546429-2d3f-4f3a-9262-41aa0a376f52/scratchpad`.
2. `RAIZ=<worktree> CORTO=1 node sr-todo.mjs lazer-v4.txt` en el mismo lugar.
   Imprime Spearman, RMSE y sesgo por set y skillset. Ojo: ese script re-ajusta
   una curva encima; para el error real del modelo, calcular tambien el RMSE de
   `overall` contra SR **sin re-ajustar** (agregar esa linea al script o hacer
   otro, fuera del repo).
3. Criterios:
   - RMSE sin re-ajustar menor a 0.25.
   - Spearman mayor o igual a 0.96.
   - Siguen en orden estricto todas las escaleras y variantes de velocidad.
   - El EASY de FRAGMENT queda entre 1.0 y 1.6, y FREEDOM DiVE DIMENSIONS
     por debajo de 7.

Si algo no cierra, parar y reportar.
