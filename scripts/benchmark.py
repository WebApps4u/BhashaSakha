#!/usr/bin/env python3
"""Benchmark suite for BhashaSakha.

Measures per-stage latency, total pipeline latency, memory usage,
and CPU temperature under different load conditions.

Modes:
  quick:   10 test utterances, basic latency report (~2 min)
  full:    All test cases with accuracy checks (~15 min)
  stress:  Continuous loop for specified duration (~1-24 hours)
  profile: Single utterance with per-function timing
"""

import sys
import os
import time
import argparse
import gc

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def benchmark_stt(whisper, audio_samples: list) -> dict:
    """Benchmark STT engine."""
    import numpy as np

    times = []
    for audio in audio_samples:
        start = time.monotonic()
        result = whisper.transcribe(audio)
        elapsed = (time.monotonic() - start) * 1000
        times.append(elapsed)

    return {
        "count": len(times),
        "mean_ms": sum(times) / len(times) if times else 0,
        "p50_ms": sorted(times)[len(times) // 2] if times else 0,
        "p90_ms": sorted(times)[int(len(times) * 0.9)] if times else 0,
        "max_ms": max(times) if times else 0,
    }


def benchmark_translation(translator, sentences: list) -> dict:
    """Benchmark translation engine."""
    times = []
    directions = [
        ("hin_Deva", "eng_Latn"),
        ("eng_Latn", "hin_Deva"),
        ("hin_Deva", "mar_Deva"),
        ("mar_Deva", "eng_Latn"),
        ("eng_Latn", "mar_Deva"),
        ("mar_Deva", "hin_Deva"),
    ]

    for text in sentences:
        for src, tgt in directions:
            start = time.monotonic()
            translator.translate(text, src, tgt)
            elapsed = (time.monotonic() - start) * 1000
            times.append(elapsed)

    return {
        "count": len(times),
        "mean_ms": sum(times) / len(times) if times else 0,
        "p50_ms": sorted(times)[len(times) // 2] if times else 0,
        "p90_ms": sorted(times)[int(len(times) * 0.9)] if times else 0,
        "max_ms": max(times) if times else 0,
    }


def benchmark_tts(tts, sentences: list) -> dict:
    """Benchmark TTS engine."""
    times = []
    langs = ["en", "hi"]

    for text in sentences:
        for lang in langs:
            start = time.monotonic()
            tts.synthesize(text, lang)
            elapsed = (time.monotonic() - start) * 1000
            times.append(elapsed)

    return {
        "count": len(times),
        "mean_ms": sum(times) / len(times) if times else 0,
        "p50_ms": sorted(times)[len(times) // 2] if times else 0,
        "p90_ms": sorted(times)[int(len(times) * 0.9)] if times else 0,
        "max_ms": max(times) if times else 0,
    }


def run_quick_benchmark(config_path: str):
    """Quick benchmark — ~2 minutes."""
    import numpy as np
    from src.core.config_loader import load_config
    from src.utils.logger import setup_logging
    from src.utils.health import HealthMonitor

    config = load_config(config_path)
    setup_logging(level="WARNING")

    health = HealthMonitor()
    print(f"CPU Temperature: {health.get_cpu_temperature():.1f}°C")
    mem_mb, mem_pct = health.get_memory_info()
    print(f"RAM Usage: {mem_mb:.0f}MB ({mem_pct:.1f}%)")
    print()

    # Load models
    print("Loading models...")
    from src.stt.whisper_engine import WhisperEngine
    from src.translation.nllb_engine import NLLBEngine
    from src.tts.piper_engine import PiperEngine

    whisper = WhisperEngine(
        model_path=config.resolve_path(config.stt.model_path),
        compute_type=config.stt.compute_type,
        beam_size=config.stt.beam_size,
    )
    whisper.load()
    whisper.warmup()

    translator = NLLBEngine(
        model_path=config.resolve_path(config.translation.model_path),
        tokenizer_name=config.translation.tokenizer_name,
    )
    translator.load()
    translator.warmup()

    tts = PiperEngine(voices_config=config.tts.voices)
    tts.load(base_dir=config.base_dir)

    mem_mb, mem_pct = health.get_memory_info()
    print(f"RAM after model load: {mem_mb:.0f}MB ({mem_pct:.1f}%)")
    print()

    # Generate test audio (silence + tone)
    test_audios = [np.random.randn(sr).astype(np.float32) * 0.1
                   for sr in [16000, 32000, 48000, 64000, 80000]]

    test_sentences = [
        "Hello, how are you?",
        "I want to check my account balance",
        "What is the interest rate on fixed deposits?",
        "Please help me with KYC documents",
        "I need to transfer money using NEFT",
    ]

    # Run benchmarks
    print("=" * 50)
    print("BENCHMARK RESULTS")
    print("=" * 50)

    stt_results = benchmark_stt(whisper, test_audios)
    print(f"\nSTT (Whisper small int8):")
    print(f"  Mean: {stt_results['mean_ms']:.0f}ms")
    print(f"  P50:  {stt_results['p50_ms']:.0f}ms")
    print(f"  P90:  {stt_results['p90_ms']:.0f}ms")
    print(f"  Max:  {stt_results['max_ms']:.0f}ms")

    trans_results = benchmark_translation(translator, test_sentences)
    print(f"\nTranslation (NLLB-200 int8, all 6 directions):")
    print(f"  Mean: {trans_results['mean_ms']:.0f}ms")
    print(f"  P50:  {trans_results['p50_ms']:.0f}ms")
    print(f"  P90:  {trans_results['p90_ms']:.0f}ms")
    print(f"  Max:  {trans_results['max_ms']:.0f}ms")

    tts_results = benchmark_tts(tts, test_sentences[:3])
    print(f"\nTTS (Piper VITS):")
    print(f"  Mean: {tts_results['mean_ms']:.0f}ms")
    print(f"  P50:  {tts_results['p50_ms']:.0f}ms")
    print(f"  P90:  {tts_results['p90_ms']:.0f}ms")
    print(f"  Max:  {tts_results['max_ms']:.0f}ms")

    total_est = stt_results['mean_ms'] + trans_results['mean_ms'] + tts_results['mean_ms']
    print(f"\n{'=' * 50}")
    print(f"Estimated End-to-End: {total_est:.0f}ms")
    print(f"Target: <3000ms")
    print(f"Result: {'✓ PASS' if total_est < 3000 else '✗ FAIL'}")
    print(f"{'=' * 50}")

    print(f"\nFinal CPU Temperature: {health.get_cpu_temperature():.1f}°C")


def main():
    parser = argparse.ArgumentParser(description="BhashaSakha Benchmark")
    parser.add_argument("--mode", choices=["quick", "full", "stress", "profile"],
                        default="quick")
    parser.add_argument("--config", default="config/config.yaml")
    parser.add_argument("--duration", type=int, default=3600,
                        help="Duration in seconds (stress mode)")
    args = parser.parse_args()

    print("╔══════════════════════════════════════════════════╗")
    print(f"║  BhashaSakha Benchmark — {args.mode.upper():>8} mode          ║")
    print("╚══════════════════════════════════════════════════╝")

    if args.mode == "quick":
        run_quick_benchmark(args.config)
    else:
        print(f"Mode '{args.mode}' not yet implemented — use 'quick' for now")


if __name__ == "__main__":
    main()
