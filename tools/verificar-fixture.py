#!/usr/bin/env python3
"""
Script de verificación del fixture click-120.

Verifica 6 condiciones:
1. El WAV dura 60.0 s exactos (2646000 muestras)
2. Hay 120 clicks detectados
3. Los clicks caen en múltiplos exactos de 500 ms (tolerancia: 1 muestra)
4. El JSON tiene 150 notas (120 normales + 30 acentos)
5. El array de notas está ordenado por time
6. Todos los columns están en 0..3
7. Cada time del JSON coincide con un inicio de click del WAV
"""

import json
import wave
import struct
from pathlib import Path


def read_wav_samples(wav_path: str) -> tuple[list[float], int]:
    """Lee un archivo WAV y retorna las muestras normalizadas [-1, 1] y el sample rate."""
    with wave.open(wav_path, 'rb') as wav_file:
        sample_rate = wav_file.getframerate()
        n_frames = wav_file.getnframes()
        frames = wav_file.readframes(n_frames)

    # Convertir bytes a muestras int16
    samples_int16 = struct.unpack('<' + 'h' * (len(frames) // 2), frames)

    # Normalizar a [-1, 1]
    samples = [s / 32767.0 for s in samples_int16]

    return samples, sample_rate


def detect_click_starts(samples: list[float], sample_rate: int) -> list[int]:
    """
    Detecta los inicios de clicks buscando transiciones de cero a amplitud alta.
    Retorna una lista de índices de muestra donde comienza cada click.
    """
    THRESHOLD = 0.1  # Amplitud mínima para detectar
    SILENCE_THRESHOLD = 5000  # Mínima distancia entre clicks (en muestras)

    clicks = []
    in_click = False

    for i in range(len(samples)):
        if not in_click and abs(samples[i]) > THRESHOLD:
            # Transición de silencio a sonido
            clicks.append(i)
            in_click = True
        elif in_click and abs(samples[i]) <= THRESHOLD / 2:
            # Transición de sonido a silencio
            in_click = False

    # Filtrar clicks muy cercanos (ruido)
    filtered_clicks = [clicks[0]]
    for click_idx in clicks[1:]:
        if click_idx - filtered_clicks[-1] > SILENCE_THRESHOLD:
            filtered_clicks.append(click_idx)

    return filtered_clicks


def verify_fixture() -> None:
    """Verifica todas las condiciones del fixture."""
    base_dir = Path(__file__).parent.parent
    wav_path = base_dir / "fixtures" / "click-120.wav"
    json_path = base_dir / "fixtures" / "click-120.json"

    print("Verificando fixture click-120...")
    print("=" * 60)

    # 1. Verificar duración del WAV
    print("\n1. Verificando duración del WAV...")
    with wave.open(str(wav_path), 'rb') as wav_file:
        sample_rate = wav_file.getframerate()
        num_frames = wav_file.getnframes()

    duration_s = num_frames / sample_rate
    expected_frames = 2646000

    print(f"   Sample rate: {sample_rate} Hz")
    print(f"   Número de muestras: {num_frames}")
    print(f"   Duración: {duration_s:.1f} segundos")

    if duration_s == 60.0 and num_frames == expected_frames:
        print("   OK: duración y número de muestras correctos")
    else:
        print(f"   FALLO: esperaba {expected_frames} muestras, obtuve {num_frames}")

    # 2 y 3. Detectar clicks y verificar timing
    print("\n2. Detectando clicks del WAV...")
    samples, sr = read_wav_samples(str(wav_path))
    click_starts = detect_click_starts(samples, sr)

    print(f"   Clicks detectados: {len(click_starts)}")

    if len(click_starts) != 120:
        print(f"   FALLO: esperaba 120 clicks, obtuve {len(click_starts)}")
    else:
        print("   OK: 120 clicks detectados")

    # Verificar timing
    print("\n3. Verificando timing de clicks...")
    click_interval_samples = 22050  # 500 ms a 44100 Hz
    max_error_samples = 1

    timing_errors = []
    for i, click_sample in enumerate(click_starts):
        expected_sample = i * click_interval_samples
        error = abs(click_sample - expected_sample)

        if error > max_error_samples:
            timing_errors.append((i, click_sample, expected_sample, error))

    if timing_errors:
        print(f"   FALLO: {len(timing_errors)} clicks con error de timing:")
        for i, actual, expected, error in timing_errors[:5]:
            print(f"      Click {i}: esperado {expected}, obtuve {actual} (error {error})")
    else:
        print("   OK: todos los clicks en múltiplos exactos de 500 ms")

    # 4. Verificar JSON: contar notas
    print("\n4. Verificando cantidad de notas en JSON...")
    with open(str(json_path), 'r', encoding='utf-8') as f:
        chart = json.load(f)

    num_notes = len(chart["notes"])
    print(f"   Notas en JSON: {num_notes}")

    if num_notes == 150:
        print("   OK: 150 notas (120 normales + 30 acentos)")
    else:
        print(f"   FALLO: esperaba 150 notas, obtuve {num_notes}")

    # 5. Verificar que notas estén ordenadas por time
    print("\n5. Verificando orden del array de notas...")
    times = [note["time"] for note in chart["notes"]]
    is_sorted = times == sorted(times)

    if is_sorted:
        print("   OK: notas ordenadas por time")
    else:
        print("   FALLO: notas NO ordenadas")
        # Mostrar primer desorden
        for i in range(len(times) - 1):
            if times[i] > times[i + 1]:
                print(f"      En índice {i}: {times[i]} > {times[i + 1]}")
                break

    # 6. Verificar que columns estén en 0..3
    print("\n6. Verificando columnas...")
    columns = [note["column"] for note in chart["notes"]]
    all_valid = all(0 <= c <= 3 for c in columns)

    if all_valid:
        print("   OK: todos los columns en 0..3")
    else:
        print("   FALLO: columns fuera de rango")
        invalid = [c for c in columns if not (0 <= c <= 3)]
        print(f"      Valores inválidos: {set(invalid)}")

    # 7. Verificar coincidencia entre JSON times y click starts
    print("\n7. Verificando coincidencia JSON vs WAV...")

    # Agrupar notas por time
    times_in_json = sorted(set(note["time"] for note in chart["notes"]))

    # Convertir click starts a milisegundos
    click_times_ms = [click_start / sr * 1000 for click_start in click_starts]

    mismatches = []
    for json_time_ms in times_in_json:
        # Buscar el click más cercano
        closest_click_time = min(click_times_ms, key=lambda t: abs(t - json_time_ms))
        diff = abs(json_time_ms - closest_click_time)

        if diff > 1:  # tolerancia: 1 ms
            mismatches.append((json_time_ms, closest_click_time, diff))

    if mismatches:
        print(f"   FALLO: {len(mismatches)} tiempos sin correspondencia clara")
        for json_time, click_time, diff in mismatches[:5]:
            print(f"      JSON {json_time} ms vs WAV {click_time:.2f} ms (diff {diff:.2f})")
    else:
        print("   OK: todos los times del JSON coinciden con clicks del WAV")

    # Resumen
    print("\n" + "=" * 60)
    print("Verificación completada.")


if __name__ == "__main__":
    verify_fixture()
