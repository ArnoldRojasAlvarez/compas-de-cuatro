# Backlog de mejoras

Ultima actualizacion: 3 de octubre de 2026. Los tickets T-026 a T-048 estan escritos y listos para despachar; ninguno esta implementado. Cada uno vive en `docs/tickets/` con el formato de siempre (contexto, contrato, criterios, tests, fuera de alcance, terminado cuando).

## Prioridades

El curso manda sobre el codigo (ver `docs/ESTADO.md`): el avance II es el 28 de octubre y la presentacion en vivo es la semana 17. Por eso el orden favorece lo que protege la presentacion y lo que ayuda a terminar la cancion propia.

| Ticket | Que es | Prioridad | Tamano | Modelo |
|---|---|---|---|---|
| T-026 | Pausa y reintento rapido en partida (**hecho**) | Alta | M | Sonnet |
| T-032 | Reabrir una cancion en el editor y varias dificultades | Alta | M | Sonnet |
| T-034 | Seleccion, copiar, pegar y mover notas | Alta | M | Sonnet |
| T-035 | Probar desde el cabezal y latencia de grabacion | Alta | M | Sonnet |
| T-036 | Mapeo automatico v2, con protocolo de evaluacion | Alta | L | Opus (protocolo) + Sonnet |
| T-037 | Modo presentacion (pantalla completa, sin distracciones) | Alta | S | Sonnet |
| T-040 | E2E del flujo completo y CI real | Alta | M | Sonnet |
| T-027 | Hitsounds y volumenes | Alta | M | Sonnet |
| T-028 | Records por mapa | Alta | M | Sonnet |
| T-030 | Musica del menu elegible | Media | M | Sonnet |
| T-031 | Cambios de velocidad (SV) en pista y editor | Media | L | Opus (contrato) + Sonnet |
| T-033 | Tempo variable en el mapeador | Media | L | Opus (contrato) + Sonnet |
| T-038 | Responsive y ventanas chicas | Media | M | Haiku + Sonnet |
| T-039 | Pista sin allocaciones por frame | Media | S | Sonnet |
| T-042 | Copia de seguridad de la biblioteca | Media | M | Sonnet |
| T-043 | Accesibilidad y temas de color | Media | M | Sonnet |
| T-044 | Replay y modo auto (util para el video) | Media | L | Opus (formato) + Sonnet |
| T-046 | Minimapa y vista general del editor | Media | S | Sonnet |
| T-029 | Bono por combo en el score | Media | S | Opus + Sonnet (**espera decision**) |
| T-045 | Estadisticas globales | Baja | M | Sonnet |
| T-047 | Primera ejecucion guiada | Baja | M | Sonnet |
| T-041 | Deuda de formato con Prettier | Baja | S | Haiku |
| T-048 | Tildes y enie en la interfaz | Baja | S | Haiku (**espera decision**) |

## Dependencias

- T-027 y T-026 tocan `game.ts`: **T-026 primero** (cambia el tipo de resultado y la limpieza), despues T-027.
- T-035 tambien toca `game.ts` (opcion `inicioMs`): despues de T-026.
- T-028 usa el rango de `resultados-logica.ts`; lo mueve a `core` si T-029 o T-045 lo necesitan.
- T-042 (respaldo) incluye los records solo si T-028 ya esta hecho; si no, queda como extension.
- T-044 guarda el replay junto al record: despues de T-028.
- T-033 cambia la grilla en `core`; T-036 y T-034 trabajan sobre `Grilla`: conviene decidir el contrato de T-033 antes de que T-036 crezca, o T-036 escribe contra una interfaz que acepte las dos.
- T-045 y T-047 reutilizan lo de T-027/T-028; sin ellos funcionan con menos datos.

## Que se puede hacer en paralelo (archivos disjuntos)

Mismo criterio que la pasada grafica: se paraleliza solo lo que no comparte archivos.

- **Tanda 1 (partida):** T-026, T-039 y T-040 (game.ts, engine, e2e). T-027 y T-028 despues de T-026.
- **Tanda 2 (mapeador):** todo pasa por `mapeador.ts`, asi que es secuencial en la pantalla: T-032, T-034, T-035, T-046. El lado `core` (T-033 grilla variable, T-036 automapa v2) puede avanzar a la vez porque vive en `packages/core/src/mapeador/`.
- **Tanda 3 (global):** T-037, T-038, T-043, T-030 tocan CSS y ajustes: usar archivos CSS propios (como se hizo en T-019 a T-024) para no chocar en `style.css`.
- **Siempre aparte:** T-041 (formato) va en su propio commit, **cuando no haya otros trabajos en vuelo**, porque toca todo el repo.

## Decisiones que son de Arnold

1. **Formula de score (T-029):** ScoreV2 simplificado, ScoreV1 o dejarlo como esta. No se implementa sin su eleccion.
2. **Tildes en la interfaz (T-048):** ponerlas o mantener el estilo sin tildes.
3. **Repositorio remoto en GitHub:** sigue sin crearse. Sin el, la CI (T-040) nunca corre de verdad.
4. **Que mapas reales usar para evaluar el automatico (T-036):** sus propios `.osz` del almacen de osu! lazer y un par de rankeados; y quien juzga la jugabilidad de las muestras (el, por criterio).
5. **Orden:** si el tiempo aprieta antes del 28 de octubre, el minimo que protege la entrega es T-026, T-037, T-032, T-035 y T-040.

## Lo que no esta en este backlog a proposito

Editor de skins, tienda o multijugador, cuentas y login (el backend queda para el final, ver `docs/HANDOFF.md`), aprendizaje automatico para el automapa (decision de producto aparte, ver T-036), version movil dedicada.
