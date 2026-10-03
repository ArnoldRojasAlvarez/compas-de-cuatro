# T-029: Bono por combo en el score

Prioridad: media. Tamano: S. Modelo: Opus escribe el contrato, Sonnet implementa. Archivos: `packages/core/src/judge/engine.ts` y su test. **Cambia un contrato de `core`: por eso lleva ticket de arquitectura.**

## Contexto

Hoy el score es proporcional a la precision (ver `docs/ESTADO.md`, "Deuda declarada"): mantener el combo no vale nada. Esto vuelve plano el final de una cancion y no premia al jugador que no falla. osu!mania usa un score donde el combo y la precision pesan por separado.

## Decision de diseno (a confirmar con Arnold antes de implementar)

Formula propuesta (ScoreV2 simplificado, maximo 1 000 000):

```
score = 1_000_000 * ( 0.7 * (precision ponderada) + 0.3 * (bono de combo) )
bonoCombo = suma de min(combo, TOPE) / (notas * TOPE)   // TOPE = 100
```

Alternativas: ScoreV1 de osu!mania (bono acumulativo por golpe) o dejar el score como esta. El ticket NO se implementa hasta que Arnold elija.

## Contrato

`ScoreState.score` sigue siendo `number` entero. Se agrega `ScoreState.maxScore` (el puntaje maximo posible del mapa, para mostrar porcentaje) sin quitar nada existente. `HP_DELTAS` no cambia.

## Criterios de aceptacion

- [ ] Un mapa jugado con todo MAX da exactamente 1 000 000.
- [ ] Un miss a mitad del mapa baja el score mas que un miss al final (el combo se corta antes).
- [ ] Los tests existentes de score se actualizan solo donde cambia la formula, con el motivo escrito.
- [ ] La barra de HUD y los resultados siguen mostrando score y precision sin cambios de firma.

## Tests

- Todo MAX = 1 000 000; todo miss = 0; un miss al inicio vs al final; notas largas cuentan como una nota para el combo.
- Que implementacion incorrecta los haria fallar: un bono que ignore el orden de los golpes pasaria "todo MAX" pero debe fallar "miss al inicio vs al final".

## Fuera de alcance

Mods que multipliquen el score. Records historicos ya guardados (T-028 guarda score: si cambia la formula, se versiona el record).

## Terminado cuando

Arnold eligio la formula, checks en verde y los records viejos se invalidan o migran de forma explicita.
