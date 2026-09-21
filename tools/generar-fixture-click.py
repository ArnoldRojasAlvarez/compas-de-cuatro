#!/usr/bin/env python3
"""Generador determinista de fixture click-120 para Tetra."""

import array
import json
import math
import wave
from pathlib import Path


def generate_wav(output_path: str) -> None:
    """Genera WAV de 60s con 120 clicks a 120 BPM."""
    SAMPLE_RATE = 44100
    TOTAL_SAMPLES = 2646000  # 60 segundos

    # Usar array para máxima velocidad
    samples = array.array('f', [0.0] * TOTAL_SAMPLES)

    # Parámetros
    CLICK_INTERVAL = 22050
    CLICK_DUR = 1323
    TAU = 0.015

    # Pregenerar tabla de envolventes
    env = [math.exp(-i / SAMPLE_RATE / TAU) for i in range(CLICK_DUR)]

    # Generar los 120 clicks
    for i in range(120):
        start = i * CLICK_INTERVAL
        is_accent = (i % 4) == 0
        freq = 1500.0 if is_accent else 1000.0
        amp = 0.8 if is_accent else 0.5

        phase_inc = 2 * math.pi * freq / SAMPLE_RATE
        phase = 0.0

        for j in range(CLICK_DUR):
            idx = start + j
            samples[idx] += amp * env[j] * math.sin(phase)
            phase += phase_inc

    # Convertir a int16 y escribir
    with wave.open(output_path, 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)

        # Convertir muestras a int16 eficientemente
        int_samples = array.array('h')
        for sample in samples:
            clipped = max(-1.0, min(1.0, sample))
            int_samples.append(int(clipped * 32767))

        f.writeframes(int_samples)


def generate_json(output_path: str) -> None:
    """Genera JSON con 150 notas."""
    notes = []
    for i in range(120):
        time_ms = i * 500
        column = i % 4
        notes.append({"kind": "tap", "time": time_ms, "column": column})
        if time_ms % 2000 == 0:
            notes.append({"kind": "tap", "time": time_ms, "column": 3 - column})

    notes.sort(key=lambda n: n["time"])

    chart = {
        "metadata": {
            "title": "Click 120",
            "artist": "Tetra",
            "creator": "Tetra",
            "difficultyName": "Test",
            "audioFile": "click-120.wav",
            "previewTime": 0
        },
        "overallDifficulty": 7.3,
        "hpDrain": 7,
        "timingPoints": [{"time": 0, "bpm": 120, "meter": 4}],
        "speedPoints": [{"time": 0, "multiplier": 1}],
        "notes": notes
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(chart, f, indent=2, ensure_ascii=False)


def main() -> None:
    base_dir = Path(__file__).parent.parent
    wav_path = base_dir / "fixtures" / "click-120.wav"
    json_path = base_dir / "fixtures" / "click-120.json"

    print(f"Generando {wav_path}...")
    generate_wav(str(wav_path))
    print(f"OK")

    print(f"Generando {json_path}...")
    generate_json(str(json_path))
    print(f"OK")

    print("Fixture generado exitosamente.")


if __name__ == "__main__":
    main()
