# Fixtures para Tetra

## Descripción

Los fixtures en este directorio son mapas de prueba que verifican aspectos específicos de Tetra.

## click-120

### Contenido

- **click-120.wav**: Pista de audio de 60 segundos con 120 clicks de metrónomo a 120 BPM
  - Formato: WAV PCM, 16 bits, mono, 44100 Hz
  - Duración exacta: 60.0 segundos (2646000 muestras)
  - Tempo: 120 BPM, un tiempo cada 500 ms
  - Clicks normales: 1000 Hz, amplitud 0.5, duración 30 ms con envolvente exponencial
  - Clicks acentuados: 1500 Hz, amplitud 0.8, cada 2000 ms (primer tiempo de cada compás 4/4)

- **click-120.json**: Mapa de notas sincronizado con los clicks
  - 150 notas totales: 120 tap normales (una cada 500 ms) más 30 acordes en los acentos
  - Las notas ciclan por las columnas 0, 1, 2, 3
  - En cada acento (múltiplos de 2000 ms), se agrega una segunda nota en columna (3 - columna_original)
  - Metadatos: título "Click 120", creado por Tetra, dificultad de prueba

### Propósito

Este fixture sirve para verificar la sincronía entre el motor de juego y la pista de audio. Si las notas no caen exactamente sobre los clicks, se nota de inmediato al oído. Es útil para:

- Verificar que el offset de la pista es correcto
- Validar que la detección de tiempos es precisa
- Testear el judgment con una pista conocida y predecible

### Regeneración

Para regenerar los archivos si es necesario, ejecuta:

```bash
python tools/generar-fixture-click.py
```

El script es determinista: siempre genera exactamente los mismos archivos.
