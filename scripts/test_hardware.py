#!/usr/bin/env python3
"""Hardware test script for BhashaSakha.

Verifies microphone, speaker, and proximity sensor are working.
Run before first deployment or after hardware changes.
"""

import sys
import os
import argparse
import time

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_microphone(duration=3):
    """Test USB microphone capture."""
    print("\n[1/4] Testing microphone...")
    try:
        import sounddevice as sd
        import numpy as np

        devices = sd.query_devices()
        default_input = sd.query_devices(kind='input')
        print(f"  Default input device: {default_input['name']}")
        print(f"  Max channels: {default_input['max_input_channels']}")
        print(f"  Default sample rate: {default_input['default_samplerate']}")

        print(f"  Recording {duration}s of audio...")
        audio = sd.rec(
            int(duration * 16000),
            samplerate=16000,
            channels=1,
            dtype='float32',
        )
        sd.wait()

        rms = float(np.sqrt(np.mean(audio ** 2)))
        peak = float(np.abs(audio).max())
        print(f"  RMS level: {rms:.4f}")
        print(f"  Peak level: {peak:.4f}")

        if rms < 0.001:
            print("  ⚠ WARNING: Very low audio level — check mic connection")
            return False
        else:
            print("  ✓ Microphone working")
            return True

    except Exception as e:
        print(f"  ✗ Microphone FAILED: {e}")
        return False


def test_speaker():
    """Test speaker output with a test tone."""
    print("\n[2/4] Testing speaker...")
    try:
        import sounddevice as sd
        import numpy as np

        default_output = sd.query_devices(kind='output')
        print(f"  Default output device: {default_output['name']}")

        # Generate 440Hz test tone (1 second)
        sr = 22050
        t = np.linspace(0, 1, sr, dtype=np.float32)
        tone = 0.3 * np.sin(2 * np.pi * 440 * t)

        # Fade in/out
        fade = int(sr * 0.05)
        tone[:fade] *= np.linspace(0, 1, fade)
        tone[-fade:] *= np.linspace(1, 0, fade)

        print("  Playing 440Hz test tone (1 second)...")
        sd.play(tone, samplerate=sr)
        sd.wait()
        print("  ✓ Speaker working (did you hear the tone?)")
        return True

    except Exception as e:
        print(f"  ✗ Speaker FAILED: {e}")
        return False


def test_proximity():
    """Test HC-SR04 proximity sensor."""
    print("\n[3/4] Testing proximity sensor...")
    try:
        from gpiozero import DistanceSensor

        sensor = DistanceSensor(echo=24, trigger=23, max_distance=4.0)
        print("  Taking 5 distance readings...")

        for i in range(5):
            distance_cm = sensor.distance * 100
            print(f"  Reading {i+1}: {distance_cm:.1f} cm")
            time.sleep(0.5)

        sensor.close()
        print("  ✓ Proximity sensor working")
        return True

    except ImportError:
        print("  ⚠ gpiozero not available — skipping (OK for non-RPi)")
        return True  # Not a failure on non-RPi hardware

    except Exception as e:
        print(f"  ✗ Proximity sensor FAILED: {e}")
        print("  Check wiring: TRIG=GPIO23, ECHO=GPIO24 (via voltage divider)")
        return False


def test_models():
    """Check if model files exist."""
    print("\n[4/4] Checking model files...")
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    models = {
        "VAD": "models/vad/silero_vad.onnx",
        "STT": "models/stt/whisper-small-int8/model.bin",
        "Translation": "models/translation/nllb-200-distilled-600M-ct2-int8/model.bin",
        "TTS (Hindi)": "models/tts/hi_IN-rohan-medium.onnx",
        "TTS (English)": "models/tts/en_US-lessac-medium.onnx",
    }

    all_ok = True
    for name, path in models.items():
        full_path = os.path.join(base_dir, path)
        if os.path.exists(full_path):
            size_mb = os.path.getsize(full_path) / (1024 * 1024)
            print(f"  ✓ {name}: {size_mb:.1f}MB")
        else:
            print(f"  ✗ {name}: NOT FOUND ({path})")
            all_ok = False

    if not all_ok:
        print("  ⚠ Run: bash scripts/download_models.sh")

    return all_ok


def main():
    parser = argparse.ArgumentParser(description="BhashaSakha Hardware Test")
    parser.add_argument("--quick", action="store_true",
                        help="Quick test (models only)")
    args = parser.parse_args()

    print("╔══════════════════════════════════════════════════╗")
    print("║  BhashaSakha Hardware Test                      ║")
    print("╚══════════════════════════════════════════════════╝")

    results = {}

    if not args.quick:
        results["Microphone"] = test_microphone()
        results["Speaker"] = test_speaker()
        results["Proximity"] = test_proximity()

    results["Models"] = test_models()

    # Summary
    print("\n" + "=" * 50)
    print("RESULTS:")
    all_pass = True
    for name, passed in results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {status}  {name}")
        if not passed:
            all_pass = False

    print("=" * 50)

    if all_pass:
        print("\n✓ All tests passed — system ready!")
        sys.exit(0)
    else:
        print("\n✗ Some tests failed — check logs above")
        sys.exit(1)


if __name__ == "__main__":
    main()
