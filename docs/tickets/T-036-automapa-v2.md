# T-036: Mapeo automatico v2 (calidad con musica real)

Prioridad: alta. Tamano: L. Modelo: Opus escribe el protocolo de evaluacion, Sonnet implementa. Archivos: `packages/core/src/mapeador/` (nuevos `bandas.ts`, `secciones.ts`, `patrones.ts`; cambios en `automapa.ts`), `tools/evaluar-automapa.mjs`, `docs/calibracion/`.

## Contexto

El automatico de T-025 se probo solo con clicks sinteticos. Con musica real detecta ataques pero no distingue un bombo de un hi-hat, no entiende secciones (estrofa, estribillo) y reparte columnas de forma generica. La diferencia entre un mapa "generado" y uno que se siente "mapeado" esta en mapear la intencion musical, no solo los onsets.

## Ideas a implementar (en este orden, cada una medible por separado)

1. **Bandas de frecuencia:** onsets por banda (graves, medios, agudos) con tres envolventes. Los graves (bombo) tienden a acordes o a las columnas externas, los agudos a notas sueltas alternadas.
2. **Secciones por energia:** segmentar con la envolvente de energia suavizada; la densidad objetivo (`nps`) se modula por seccion (mas notas en el estribillo, menos en el puente) en vez de ser constante.
3. **Notas largas por energia sostenida:** una nota larga solo donde la energia de una banda se mantiene tras el ataque, en lugar del criterio actual de "hueco largo".
4. **Plantillas de patron:** streams alternados con direccion, jumpstream y trills como secuencias de columnas elegidas por plantilla y variadas por semilla, evitando patrones injugables (por ejemplo 4 jacks seguidos en niveles bajos).
5. **Simetria musical:** un compas que se repite (similitud de la envolvente) repite el patron, con una variacion pequena.

## Protocolo de evaluacion (obligatorio antes de dar nada por mejor)

Sin evaluacion, "mejor" es una opinion. Con los `.osz` de Arnold (se leen del almacen de osu! lazer, ver T-017) y los mapas rankeados ya usados en `docs/calibracion/`:

- **Precision y recall de onsets** contra las notas de mapas humanos (tolerancia +-35 ms): que fraccion de las notas humanas tiene un onset detectado, y que fraccion de los onsets cae cerca de una nota humana.
- **Distribucion de dificultad:** el motor de estrellas de `core` (T-018) aplicado a los mapas generados en cada nivel: Facil, Normal, Dificil y Experto deben dar estrellas crecientes y razonables (rango objetivo por nivel a fijar con Arnold).
- **Jugabilidad:** proporcion de patrones que un jugador califica de injugables (lo juzga Arnold sobre una muestra de 5 mapas).
- El script imprime una tabla y se guarda el resultado en `docs/calibracion/automapa-vN.md`.

## Criterios de aceptacion

- [ ] El script `tools/evaluar-automapa.mjs` corre sobre una carpeta de `.osz` y produce las tres metricas.
- [ ] Cada idea implementada mejora al menos una metrica sin empeorar las otras mas de un margen declarado.
- [ ] Los tests existentes de `automapa` (determinismo, grilla, sin solapar largas) siguen pasando.
- [ ] Arnold juega 3 mapas generados y los califica; el resultado se anota en el doc.

## Tests

- Unitarios por modulo con senales sinteticas de tres bandas separables (un bombo grave y un hi-hat agudo en instantes distintos).
- Que implementacion incorrecta los haria fallar: una separacion de bandas que mezcle todo debe fallar el test de "el bombo cae en la banda grave y no en la aguda".

## Fuera de alcance

Aprendizaje automatico con modelos entrenados (decision de producto aparte); generar SV.

## Terminado cuando

Hay una tabla de metricas antes y despues, y Arnold dio su veredicto sobre mapas reales.
