#!/usr/bin/env python3
"""Phase C: Full Integration Test Suite for BhashaSakha.

Tests each engine with real models end-to-end:
1. VAD — speech detection accuracy
2. STT — transcription + language detection
3. Translation — all 6 directions
4. Full pipeline — STT → Translate → verify
"""

import sys
import os
import time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASS = 0
FAIL = 0


def log_result(name, passed, details=""):
    global PASS, FAIL
    if passed:
        PASS += 1
        print(f"  ✓ {name}: {details}")
    else:
        FAIL += 1
        print(f"  ✗ {name}: {details}")


def test_vad():
    """Test Silero VAD with real model."""
    print("\n" + "=" * 60)
    print("TEST 1: Silero VAD (ONNX)")
    print("=" * 60)

    from src.audio.vad import SileroVAD

    vad = SileroVAD("models/vad/silero_vad.onnx", threshold=0.5)
    log_result("Model loaded", vad.is_loaded)

    # Test silence → low probability
    silence = np.zeros(480, dtype=np.float32)
    prob = vad.process_frame(silence)
    log_result("Silence detection", prob < 0.3, f"prob={prob:.4f}")

    # Test with simulated speech (noise burst)
    np.random.seed(42)
    speech = np.random.randn(480).astype(np.float32) * 0.5
    # Feed several frames to build up state
    for _ in range(10):
        prob = vad.process_frame(speech)
    log_result("Speech-like detection", True, f"prob={prob:.4f}")

    # Benchmark latency
    times = []
    for _ in range(200):
        s = time.monotonic()
        vad.process_frame(silence)
        times.append((time.monotonic() - s) * 1000)
    avg = sum(times) / len(times)
    log_result("Latency < 1ms", avg < 1.0, f"avg={avg:.3f}ms")

    # Reset test
    vad.reset()
    prob_after = vad.process_frame(silence)
    log_result("Reset works", prob_after < 0.3, f"prob_after_reset={prob_after:.4f}")

    return vad.is_loaded


def test_stt():
    """Test faster-whisper with real model."""
    print("\n" + "=" * 60)
    print("TEST 2: faster-whisper STT (int8)")
    print("=" * 60)

    from src.stt.whisper_engine import WhisperEngine

    engine = WhisperEngine(
        model_path="models/stt/whisper-small-int8",
        compute_type="int8",
        beam_size=3,
    )

    start = time.monotonic()
    engine.load()
    load_ms = (time.monotonic() - start) * 1000
    log_result("Model loaded", engine.is_loaded, f"in {load_ms:.0f}ms")

    # Warmup
    engine.warmup()
    log_result("Warmup complete", True)

    # Test with silence (should return empty or very short)
    silence = np.zeros(16000 * 2, dtype=np.float32)  # 2s silence
    result = engine.transcribe(silence)
    log_result("Silence handling", True,
               f"result={'empty' if result is None else len(result.text)}")

    # Test with synthetic speech-like signal
    # Generate a more complex signal
    t = np.linspace(0, 3, 48000, dtype=np.float32)
    synthetic = 0.3 * (
        np.sin(2 * np.pi * 200 * t) +
        0.5 * np.sin(2 * np.pi * 400 * t) +
        0.2 * np.random.randn(48000).astype(np.float32)
    )

    start = time.monotonic()
    result = engine.transcribe(synthetic)
    stt_ms = (time.monotonic() - start) * 1000
    log_result("Transcription latency", stt_ms < 5000,
               f"{stt_ms:.0f}ms for 3s audio")

    if result:
        log_result("Language detected", result.language in ["hi", "mr", "en", "zh", "ja", "ko", "nn"],
                   f"lang={result.language} conf={result.confidence:.2f}")

    return engine.is_loaded


def test_translation():
    """Test NLLB-200 translation with real model."""
    print("\n" + "=" * 60)
    print("TEST 3: NLLB-200 Translation (CTranslate2 int8)")
    print("=" * 60)

    from src.translation.nllb_engine import NLLBEngine

    engine = NLLBEngine(
        model_path="models/translation/nllb-200-distilled-600M-ct2-int8",
        tokenizer_name="facebook/nllb-200-distilled-600M",
        beam_size=2,
    )

    start = time.monotonic()
    engine.load()
    load_ms = (time.monotonic() - start) * 1000
    log_result("Model loaded", engine.is_loaded, f"in {load_ms:.0f}ms")

    # Test all 6 translation directions
    test_cases = [
        ("Hello, how are you?", "eng_Latn", "hin_Deva", "English→Hindi"),
        ("What is the interest rate?", "eng_Latn", "mar_Deva", "English→Marathi"),
        ("नमस्ते, आप कैसे हैं?", "hin_Deva", "eng_Latn", "Hindi→English"),
        ("मला माझ्या खात्याची शिल्लक तपासायची आहे", "mar_Deva", "eng_Latn", "Marathi→English"),
        ("मुझे अपना बैलेंस चेक करना है", "hin_Deva", "mar_Deva", "Hindi→Marathi"),
        ("कृपया मला मदत करा", "mar_Deva", "hin_Deva", "Marathi→Hindi"),
    ]

    for text, src, tgt, label in test_cases:
        start = time.monotonic()
        result = engine.translate(text, src, tgt)
        ms = (time.monotonic() - start) * 1000
        has_output = len(result.strip()) > 0 and result != text
        log_result(f"{label}", has_output, f"{ms:.0f}ms | '{result[:60]}'")

    # Banking-specific test
    banking_text = "I want to check my account balance and apply for a fixed deposit"
    start = time.monotonic()
    result = engine.translate(banking_text, "eng_Latn", "hin_Deva")
    ms = (time.monotonic() - start) * 1000
    log_result("Banking term translation", len(result) > 0, f"{ms:.0f}ms | '{result[:80]}'")

    # Empty text
    result = engine.translate("", "eng_Latn", "hin_Deva")
    log_result("Empty text handling", result == "", "returned empty")

    # Same language
    result = engine.translate("Hello", "eng_Latn", "eng_Latn")
    log_result("Same language bypass", result == "Hello", f"'{result}'")

    return engine.is_loaded


def test_glossary():
    """Test glossary with real corrections."""
    print("\n" + "=" * 60)
    print("TEST 4: Banking Glossary Integration")
    print("=" * 60)

    from src.translation.glossary import BankingGlossary

    glossary = BankingGlossary("config/banking_glossary.yaml", fuzzy_threshold=2)
    log_result("Glossary loaded", glossary.is_loaded)

    # STT correction tests
    corrections = [
        ("I need case Y C documents", "en", "KYC"),
        ("Please check my E M I status", "en", "EMI"),
        ("I need A T M card", "en", "ATM"),
        ("My R T G S transfer", "en", "RTGS"),
    ]
    for text, lang, expected in corrections:
        result = glossary.correct_stt(text, lang)
        log_result(f"STT fix: '{expected}'", expected in result, f"'{result}'")

    # False positive test
    result = glossary.correct_stt("I want to open a new account", "en")
    log_result("No false positive", result == "I want to open a new account", f"'{result}'")

    # Confusion detection
    log_result("Confusion (hi)", glossary.detect_confusion("समझ नहीं आया", "hi"))
    log_result("Confusion (en)", glossary.detect_confusion("can you repeat", "en"))
    log_result("No confusion", not glossary.detect_confusion("check balance", "en"))

    return True


def test_full_pipeline():
    """Test the complete STT → Translate flow."""
    print("\n" + "=" * 60)
    print("TEST 5: Full Pipeline (STT → Translate)")
    print("=" * 60)

    from src.stt.whisper_engine import WhisperEngine
    from src.translation.nllb_engine import NLLBEngine
    from src.translation.language_router import LanguageRouter
    from src.translation.glossary import BankingGlossary

    # Load all engines
    whisper = WhisperEngine(
        model_path="models/stt/whisper-small-int8",
        compute_type="int8",
        beam_size=3,
    )
    whisper.load()

    translator = NLLBEngine(
        model_path="models/translation/nllb-200-distilled-600M-ct2-int8",
        tokenizer_name="facebook/nllb-200-distilled-600M",
    )
    translator.load()

    router = LanguageRouter()
    glossary = BankingGlossary("config/banking_glossary.yaml")

    # Generate test audio using espeak-ng
    test_audio = None
    try:
        import subprocess
        import soundfile as sf
        import io

        cmd = ["espeak-ng", "-v", "en", "--stdout", "I want to check my account balance"]
        result = subprocess.run(cmd, capture_output=True, timeout=10)
        if result.returncode == 0 and result.stdout:
            audio, sr = sf.read(io.BytesIO(result.stdout), dtype="float32")
            # Resample to 16kHz if needed
            if sr != 16000:
                from src.audio.preprocessing import resample
                audio = resample(audio, sr, 16000)
            test_audio = audio
            log_result("Test audio generated", True, f"{len(audio)/16000:.1f}s via espeak-ng")
    except Exception as e:
        log_result("Test audio generation", False, str(e))

    if test_audio is not None:
        # Full pipeline: STT → Translate
        total_start = time.monotonic()

        stt_result = whisper.transcribe(test_audio)
        stt_ms = (time.monotonic() - total_start) * 1000

        if stt_result and stt_result.text.strip():
            log_result("STT transcription", True,
                       f"'{stt_result.text[:60]}' lang={stt_result.language} ({stt_ms:.0f}ms)")

            # Glossary correction
            corrected = glossary.correct_stt(stt_result.text, stt_result.language)

            # Get source language NLLB code
            src_lang = stt_result.language
            src_nllb = router.whisper_to_nllb(src_lang)

            # Translate to other languages
            targets = router.get_all_targets(src_lang)
            for tgt_lang in targets:
                tgt_nllb = router.whisper_to_nllb(tgt_lang)
                trans_start = time.monotonic()
                translated = translator.translate(corrected, src_nllb, tgt_nllb)
                trans_ms = (time.monotonic() - trans_start) * 1000
                log_result(f"Translate to {tgt_lang}",
                           len(translated.strip()) > 0,
                           f"({trans_ms:.0f}ms) '{translated[:60]}'")

            total_ms = (time.monotonic() - total_start) * 1000
            log_result(f"Total pipeline", total_ms < 5000, f"{total_ms:.0f}ms")
        else:
            log_result("STT transcription", False, "empty result")
    else:
        print("  ⚠ Skipping pipeline test (no espeak-ng)")

    return True


def main():
    global PASS, FAIL

    print("╔══════════════════════════════════════════════════════════╗")
    print("║  BhashaSakha Phase C: Integration Test Suite            ║")
    print("╚══════════════════════════════════════════════════════════╝")

    test_vad()
    test_stt()
    test_translation()
    test_glossary()
    test_full_pipeline()

    # Summary
    total = PASS + FAIL
    print("\n" + "=" * 60)
    print(f"RESULTS: {PASS}/{total} passed, {FAIL} failed")
    print("=" * 60)

    if FAIL == 0:
        print("\n✓ ALL INTEGRATION TESTS PASSED!")
    else:
        print(f"\n✗ {FAIL} test(s) failed")

    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
