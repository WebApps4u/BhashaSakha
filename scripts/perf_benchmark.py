#!/usr/bin/env python3
"""BhashaSakha Optimized Performance Benchmark.

Profiles the real pipeline with actual models, measures latency
percentiles, cache effectiveness, and memory usage.

Usage:
    python scripts/perf_benchmark.py --mode quick     # 5 test phrases
    python scripts/perf_benchmark.py --mode full      # 20 test phrases, all directions
    python scripts/perf_benchmark.py --mode stress     # Continuous loop
"""

import os
import sys
import time
import gc
import argparse
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.stt.whisper_engine import WhisperEngine
from src.translation.nllb_engine import NLLBEngine
from src.translation.language_router import LanguageRouter
from src.translation.glossary import BankingGlossary
from src.translation.cache import TranslationCache
from src.audio.vad import SileroVAD
from src.utils.profiler import PipelineProfiler
from src.utils.optimizer import set_cpu_affinity, get_system_info


def generate_test_audio(text: str, lang: str = "en") -> np.ndarray:
    """Generate test audio using espeak-ng."""
    try:
        import subprocess
        import soundfile as sf
        import io

        voice = {"en": "en", "hi": "hi", "mr": "mr"}.get(lang, "en")
        cmd = ["espeak-ng", "-v", voice, "--stdout", text]
        result = subprocess.run(cmd, capture_output=True, timeout=10)

        if result.returncode == 0 and result.stdout:
            audio, sr = sf.read(io.BytesIO(result.stdout), dtype="float32")
            if sr != 16000:
                from src.audio.preprocessing import resample
                audio = resample(audio, sr, 16000)
            return audio
    except Exception as e:
        print(f"  ⚠ espeak-ng failed: {e}")

    # Fallback: generate sine wave
    t = np.linspace(0, 2, 32000, dtype=np.float32)
    return 0.3 * np.sin(2 * np.pi * 300 * t)


def run_benchmark(mode: str = "quick"):
    """Run pipeline benchmark with real models."""

    # CPU optimization
    set_cpu_affinity()

    print("╔══════════════════════════════════════════════════════════╗")
    print("║  BhashaSakha Performance Benchmark                      ║")
    print("╚══════════════════════════════════════════════════════════╝")

    # System info
    info = get_system_info()
    print(f"\nSystem: Python {info.get('python', '?')} | "
          f"{info.get('platform', '?')} | "
          f"{info.get('cpu_count', '?')} CPUs | "
          f"{info.get('rss_mb', 0):.0f}MB RSS")
    if "ctranslate2" in info:
        print(f"CT2: {info['ctranslate2']} | ONNX: {info.get('onnxruntime', '?')}")

    # Load models
    print("\n--- Loading Models ---")
    profiler = PipelineProfiler()
    router = LanguageRouter()
    glossary = BankingGlossary("config/banking_glossary.yaml")
    cache = TranslationCache(max_size=200)

    # VAD
    t0 = time.monotonic()
    vad = SileroVAD("models/vad/silero_vad.onnx")
    print(f"  VAD loaded: {(time.monotonic()-t0)*1000:.0f}ms")

    # STT
    t0 = time.monotonic()
    whisper = WhisperEngine(model_path="models/stt/whisper-small-int8",
                            compute_type="int8", beam_size=3)
    whisper.load()
    print(f"  Whisper loaded: {(time.monotonic()-t0)*1000:.0f}ms")

    # Translation
    t0 = time.monotonic()
    translator = NLLBEngine(
        model_path="models/translation/nllb-200-distilled-600M-ct2-int8",
        tokenizer_name="facebook/nllb-200-distilled-600M",
    )
    translator.load()
    print(f"  NLLB loaded: {(time.monotonic()-t0)*1000:.0f}ms")

    # Warmup
    print("\n--- Warmup ---")
    whisper.warmup()
    translator.warmup()
    gc.collect()

    ram_after_load = info.get("rss_mb", 0)
    try:
        import psutil
        ram_after_load = psutil.Process().memory_info().rss / (1024**2)
    except Exception:
        pass
    print(f"  RAM after load: {ram_after_load:.0f}MB")

    # Test phrases
    if mode == "quick":
        test_phrases = [
            ("I want to check my account balance", "en"),
            ("Please help me with KYC documents", "en"),
            ("What is the interest rate on fixed deposit", "en"),
            ("I need to transfer money via NEFT", "en"),
            ("How do I apply for a loan", "en"),
        ]
    else:  # full
        test_phrases = [
            ("I want to check my account balance", "en"),
            ("Please help me with KYC documents", "en"),
            ("What is the interest rate on fixed deposit", "en"),
            ("I need to transfer money via NEFT", "en"),
            ("How do I apply for a loan", "en"),
            ("My ATM card is not working", "en"),
            ("I want to open a savings account", "en"),
            ("What is my EMI amount", "en"),
            ("Please update my Aadhaar details", "en"),
            ("I want to close my account", "en"),
            # Repeat some to test cache
            ("I want to check my account balance", "en"),
            ("Please help me with KYC documents", "en"),
            ("What is the interest rate on fixed deposit", "en"),
            ("I need to transfer money via NEFT", "en"),
            ("How do I apply for a loan", "en"),
        ]

    # Run benchmarks
    print(f"\n--- Benchmark ({len(test_phrases)} phrases, mode={mode}) ---")

    for i, (phrase, lang) in enumerate(test_phrases):
        print(f"\n[{i+1}/{len(test_phrases)}] \"{phrase[:50]}...\"")

        # Generate audio
        audio = generate_test_audio(phrase, lang)
        audio_dur = len(audio) / 16000
        print(f"  Audio: {audio_dur:.1f}s")

        profiler.start_pipeline()

        # STT
        with profiler.stage("stt"):
            stt_result = whisper.transcribe(audio)

        if stt_result and stt_result.text.strip():
            text = stt_result.text
            det_lang = stt_result.language
            print(f"  STT: [{det_lang}] \"{text[:60]}\"")

            # Glossary
            with profiler.stage("glossary_stt"):
                corrected = glossary.correct_stt(text, det_lang)

            # Translation (all targets)
            src_nllb = router.whisper_to_nllb(det_lang)
            targets = router.get_all_targets(det_lang)

            for tgt in targets:
                tgt_nllb = router.whisper_to_nllb(tgt)

                # Cache check
                cached = cache.get(corrected, src_nllb, tgt_nllb)
                if cached:
                    with profiler.stage("translation"):
                        translated = cached  # ~0ms
                    print(f"  → [{tgt}] (CACHED): \"{translated[:50]}\"")
                else:
                    with profiler.stage("translation"):
                        translated = translator.translate(corrected, src_nllb, tgt_nllb)
                    cache.put(corrected, src_nllb, tgt_nllb, translated)
                    print(f"  → [{tgt}]: \"{translated[:50]}\"")

        total_ms = profiler.end_pipeline()
        print(f"  Total: {total_ms:.0f}ms")

    # Print summary
    profiler.print_summary()

    # Cache stats
    print(f"\nCache Stats: {cache.stats}")

    # Memory after benchmark
    try:
        import psutil
        ram_after = psutil.Process().memory_info().rss / (1024**2)
        print(f"RAM after benchmark: {ram_after:.0f}MB (delta: {ram_after - ram_after_load:+.0f}MB)")
    except Exception:
        pass


def run_stress(duration_sec: int = 3600):
    """Continuous stress test."""
    print(f"Starting stress test for {duration_sec}s...")
    set_cpu_affinity()

    whisper = WhisperEngine(model_path="models/stt/whisper-small-int8",
                            compute_type="int8", beam_size=3)
    whisper.load()
    whisper.warmup()

    translator = NLLBEngine(
        model_path="models/translation/nllb-200-distilled-600M-ct2-int8",
        tokenizer_name="facebook/nllb-200-distilled-600M",
    )
    translator.load()
    translator.warmup()

    cache = TranslationCache(max_size=200)
    router = LanguageRouter()

    phrases = [
        "I want to check my account balance",
        "Help me with KYC",
        "What is the interest rate",
        "Transfer money via NEFT",
        "Apply for a loan",
    ]

    start = time.monotonic()
    count = 0
    errors = 0
    latencies = []

    try:
        while (time.monotonic() - start) < duration_sec:
            phrase = phrases[count % len(phrases)]
            audio = generate_test_audio(phrase, "en")

            t0 = time.monotonic()
            try:
                result = whisper.transcribe(audio)
                if result and result.text.strip():
                    src_nllb = router.whisper_to_nllb(result.language)
                    cached = cache.get(result.text, src_nllb, "hin_Deva")
                    if not cached:
                        translated = translator.translate(result.text, src_nllb, "hin_Deva")
                        cache.put(result.text, src_nllb, "hin_Deva", translated)
            except Exception as e:
                errors += 1
                print(f"  Error: {e}")

            elapsed = (time.monotonic() - t0) * 1000
            latencies.append(elapsed)
            count += 1

            # Print progress every 10 iterations
            if count % 10 == 0:
                elapsed_total = time.monotonic() - start
                avg_lat = sum(latencies[-10:]) / min(len(latencies), 10)
                print(f"  [{elapsed_total:.0f}s] {count} utterances | "
                      f"avg={avg_lat:.0f}ms | errors={errors} | "
                      f"cache={cache.stats['hit_rate']}")

            # GC every 100 iterations
            if count % 100 == 0:
                gc.collect()

    except KeyboardInterrupt:
        print("\nStress test interrupted")

    # Summary
    if latencies:
        latencies.sort()
        print(f"\n--- Stress Test Results ---")
        print(f"Duration: {time.monotonic() - start:.0f}s")
        print(f"Utterances: {count}")
        print(f"Errors: {errors}")
        print(f"Latency P50: {latencies[len(latencies)//2]:.0f}ms")
        print(f"Latency P90: {latencies[int(len(latencies)*0.9)]:.0f}ms")
        print(f"Latency P99: {latencies[int(len(latencies)*0.99)]:.0f}ms")
        print(f"Cache: {cache.stats}")


def main():
    parser = argparse.ArgumentParser(description="BhashaSakha Performance Benchmark")
    parser.add_argument("--mode", choices=["quick", "full", "stress"],
                        default="quick", help="Benchmark mode")
    parser.add_argument("--duration", type=int, default=3600,
                        help="Stress test duration (seconds)")
    args = parser.parse_args()

    if args.mode == "stress":
        run_stress(args.duration)
    else:
        run_benchmark(args.mode)


if __name__ == "__main__":
    main()
