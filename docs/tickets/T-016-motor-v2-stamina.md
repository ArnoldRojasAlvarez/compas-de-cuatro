# T-016 · Motor de dificultad v2: stamina sostenida y exponente de estrellas

| | |
|---|---|
| **Fase** | 4 · Motor de dificultad |
| **Modelo** | Sonnet |
| **Rama** | `feat/motor-v2` |
| **Depende de** | T-013, T-014 |
| **Toca** | solo `packages/core/src/difficulty/` (no `core/index.ts`) |

## Por que

Los primeros mapas reales de Arnold (tabla en T-015) mostraron dos defectos que
los tests sinteticos no ven:

1. **Stamina domina los mapas faciles y largos.** El Normal de FREEDOM DiVE sale
   como "mapa de stamina" solo porque dura cuatro minutos. Causa: stamina suma
   todas las notas (`A_stam * size`) mientras que cada skillset de patron solo
   cuenta sus filas.
2. **Falta un exponente.** La escala lineal duplica a osu! arriba. La
   calibracion (T-015) va a ajustar `estrella = a * valor^p`, y el modelo
   necesita el parametro `p` para recibirlo.

## Cambio 1: stamina como media movil de la dificultad de patron

Stamina deja de acumular notas. Nuevo calculo por fila, **despues** de actualizar
los seis strains de pico:

```
m = max(stream, jumpstream, handstream, jackspeed, chordjack, technical)   // strain instantaneo
f = exp(-decaimientoStamina * dt / 1000)
S_stamina = S_stamina * f + m * (1 - f)
```

Es una media movil exponencial en el tiempo de la dificultad de patron. En
regimen sostenido tiende a `m`; en un mapa corto no llega a subir. Mide "cuanto
tiempo estuviste sosteniendo dificultad", no "cuantas notas hubo". Un mapa
facil y largo tiene `m` bajo, y por lo tanto stamina baja. `A_stam` desaparece.

Mantener la vida media de 35 s y re-anclar `ESCALA_stamina` con la regla 3 de
T-013 (en el stream de referencia de 60 s, stamina aproximadamente igual a
stream). Documentar el nuevo numero y como se obtuvo.

## Cambio 2: exponente de estrellas

Agregar `exponenteEstrellas` a `PARAMETROS_DIFICULTAD`, **valor 1** por ahora:

```
estrella_k = ESCALA_k * valor_k ^ exponenteEstrellas
```

Con 1 no cambia nada. No elegir otro valor "a ojo": lo fija T-015 con datos.

## Version del modelo

Subir `VERSION_MODELO_DIFICULTAD` a **2**. Eso invalida la cache de T-014. Es
exactamente para lo que existe la version.

## Tests

- Las diez propiedades de T-013 siguen pasando. La 5 (stamina crece con la
  duracion mas que stream) tiene que seguir valiendo con el modelo nuevo:
  deberia, porque la media movil tarda en subir; verificalo, no lo asumas.
- **Propiedad nueva:** un mapa largo (240 s) y facil (unas 5 notas por segundo),
  con patrones mezclados (filas de 1 y de 2, sin jacks, en un orden fijo y
  determinista), **no** tiene stamina como skillset maximo. Con el modelo viejo
  este test tiene que fallar: comprobalo corriendolo contra la version vieja.
- **Propiedad nueva:** el mismo stream denso de 15 s y de 180 s. En el de 180 s
  stamina es mayor que en el de 15 s, y el `overall` del de 180 s es mayor o
  igual al del de 15 s.
- `exponenteEstrellas = 1` da exactamente los mismos valores de los skillsets de
  pico que antes (stamina cambio a proposito, los otros seis no).

## Verificacion contra mapas reales (obligatoria, fuera de los tests)

Hay un script en
`C:\Users\Arnold\AppData\Local\Temp\claude\C--Users-Arnold-Desktop-Musica\d3546429-2d3f-4f3a-9262-41aa0a376f52\scratchpad\medir-mapas-reales.mjs`
que corre el motor contra los tres `.osz` de Arnold en `C:\Users\Arnold\Downloads`.
Copialo, apuntá `RAIZ` a tu worktree, compila (`npm run typecheck`) y correlo
antes y despues del cambio. **No copies los `.osz` al repo.** Criterios:

- El orden dentro de cada set sigue siendo 10 de 10.
- Las dificultades faciles (AVEL'S EASY, NORMAL, 4K Normal, 4K Hyper) ya no
  tienen stamina como dominante.

Si alguno falla, parar y reportar los numeros, no forzar constantes.

## Terminado cuando

Cuatro checks en verde, las propiedades nuevas cubiertas, la tabla de mapas
reales antes y despues en el reporte, revision de Opus y squash merge.
