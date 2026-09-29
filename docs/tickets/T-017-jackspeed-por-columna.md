# T-017 · Jackspeed por columna, sin importar el tamano de la fila

| | |
|---|---|
| **Fase** | 4 · Motor de dificultad |
| **Modelo** | Sonnet |
| **Rama** | `feat/jackspeed` |
| **Depende de** | T-016 (mismo archivo; se lanza despues de que T-016 este fusionado) |
| **Toca** | solo `packages/core/src/difficulty/` |

## El hallazgo

Con 52 dificultades reales de packs de jacks y chordjacks que aporto Arnold
(Jacks Practice, Tachyon Anime Chordjacks 2, Las Avispas), **jackspeed dio menos
de 0.8 en todas**, incluido el pack llamado "Jacks Practice". El skillset esta
practicamente muerto.

Causa: en T-013 jackspeed solo aporta en filas de **una sola nota** que repiten
columna. En mapas reales casi ningun jack viene solo: `[12][2][23]` repite la
columna 2, pero como las filas tienen dos notas, hoy todo eso cae en chordjack.
Para la mano es un jack de un dedo, no un acorde repetido.

## Nueva definicion

Por fila, con `columnasJack` = columnas de esta fila que estaban en la anterior:

- **jackspeed**: aporta si hay al menos una columna jackeada, **sin importar el
  tamano de la fila**. Aporte `A_jack * (1000 / dcMinimo)`: la repeticion mas
  rapida de un dedo en esta fila.
- **chordjack**: aporta solo si **dos o mas columnas** se repiten juntas
  (`popcount(maskJack) >= 2`). Aporte proporcional a cuantas columnas se
  repiten: `A_cjack * (1000 / dcMinimo) * (columnasRepetidas / 2)`.
- stream, jumpstream y handstream siguen aportando solo en filas sin jack.

Consecuencia buscada: `[12][12][12]` alimenta chordjack (y tambien jackspeed,
porque cada dedo esta jackeando); `[12][2][23]` alimenta jackspeed y no
chordjack; un jack de una columna sola sigue siendo jackspeed.

Re-anclar `ESCALA_jackspeed` y `ESCALA_chordjack` con la regla 1 de T-013
(patrones canonicos a igual notas por segundo) y documentar los numeros. Subir
`VERSION_MODELO_DIFICULTAD`.

## Tests nuevos

- `[12][2][23]...` repetido: jackspeed mayor que chordjack, y chordjack igual a 0.
  Con el modelo de T-016 este test falla (comprobarlo).
- `[12][12][12]...`: chordjack es el maximo del vector.
- Las propiedades de T-013 y T-016 siguen pasando.

## Verificacion contra mapas reales (obligatoria)

Con el script de medicion (ver T-016) sobre los seis `.osz` de Arnold en
`C:\Users\Arnold\Downloads` (FRAGMENT, FREEDOM DiVE, Galaxy Collapse, Jacks
Practice, Tachyon Anime Chordjacks 2, Las Avispas). Criterios:

- Jackspeed deja de ser ~0 en Jacks Practice.
- Siguen en orden las escaleras (FRAGMENT, FREEDOM DiVE, Jacks Practice Lv.1 a
  Lv.5) y **todas las variantes de velocidad** (1.05x a 1.3x en Las Avispas, 1.1
  a 1.4 en Tachyon): cada variante mas rapida, estrictamente mas dificil.

Si algo no se cumple, parar y reportar los numeros.
