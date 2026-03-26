#!/usr/bin/env python3
"""BhashaSakha Live Voice Test — Record & Translate.

Records your voice from microphone (if available) or accepts
a pre-recorded audio file, then runs the full translation pipeline.

Usage:
    # Record from microphone (if available):
    python scripts/voice_test.py --record 5          # Record 5 seconds

    # Use a pre-recorded file:
    python scripts/voice_test.py --file myaudio.wav

    # Interactive mode — keeps listening:
    python scripts/voice_test.py --interactive
"""

import os
import sys
import time
import argparse
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load_engines():
    """Load all ML engines."""
    from src.stt.whisper_engine import WhisperEngine
    from src.translation.nllb_engine import NLLBEngine
    from src.translation.language_router import LanguageRouter
    from src.translation.glossary import BankingGlossary
    from src.translation.cache import TranslationCache

    print("Loading models (this takes ~20 seconds)...", flush=True)

    whisper = WhisperEngine(
        model_path="models/stt/whisper-small-int8",
        compute_type="int8", beam_size=3,
    )
    whisper.load()
    whisper.warmup()
    print("  ✓ STT loaded", flush=True)

    translator = NLLBEngine(
        model_path="models/translation/nllb-200-distilled-600M-ct2-int8",
        tokenizer_name="facebook/nllb-200-distilled-600M",
    )
    translator.load()
    translator.warmup()
    print("  ✓ Translation loaded", flush=True)

    router = LanguageRouter()
    glossary = BankingGlossary("config/banking_glossary.yaml")
    cache = TranslationCache(max_size=200)

    return whisper, translator, router, glossary, cache


def process_audio(audio, sr, whisper, translator, router, glossary, cache):
    """Process audio through the full pipeline."""
    # Resample to 16kHz if needed
    if sr != 16000:
        from src.audio.preprocessing import resample
        audio = resample(audio, sr, 16000)

    duration = len(audio) / 16000
    print(f"\n🎤 Processing {duration:.1f}s of audio...", flush=True)

    # STT
    total_start = time.monotonic()
    stt_result = whisper.transcribe(audio)
    stt_ms = (time.monotonic() - total_start) * 1000

    if not stt_result or not stt_result.text.strip():
        print(f"  ✗ Could not recognize speech ({stt_ms:.0f}ms)")
        print("  Try speaking louder or closer to the microphone")
        return

    text = stt_result.text
    lang = stt_result.language
    conf = stt_result.confidence

    print(f"\n  📝 You said ({stt_ms:.0f}ms):")
    print(f"     Language: {lang} (confidence: {conf:.0%})")
    print(f"     Text: \"{text}\"")

    # Glossary correction
    corrected = glossary.correct_stt(text, lang)
    if corrected != text:
        print(f"     Corrected: \"{corrected}\"")
        text = corrected

    # Translate to other languages
    src_nllb = router.whisper_to_nllb(lang)
    targets = router.get_all_targets(lang)

    if not targets:
        print(f"\n  ℹ No translation needed (already in target language)")
        return

    print(f"\n  🌐 Translations:", flush=True)
    for tgt in targets:
        tgt_nllb = router.whisper_to_nllb(tgt)

        t_start = time.monotonic()
        cached = cache.get(text, src_nllb, tgt_nllb)
        if cached:
            translated = cached
            t_ms = (time.monotonic() - t_start) * 1000
            print(f"     → {tgt.upper()} ({t_ms:.0f}ms, cached): \"{translated}\"")
        else:
            translated = translator.translate(text, src_nllb, tgt_nllb)
            cache.put(text, src_nllb, tgt_nllb, translated)
            t_ms = (time.monotonic() - t_start) * 1000
            print(f"     → {tgt.upper()} ({t_ms:.0f}ms): \"{translated}\"")

        # Try to speak the translation
        try:
            import subprocess
            voice_map = {"hi": "hi", "mr": "mr", "en": "en"}
            voice = voice_map.get(tgt, "en")
            subprocess.Popen(
                ["espeak-ng", "-v", voice, "-s", "140", translated],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass

    total_ms = (time.monotonic() - total_start) * 1000
    print(f"\n  ✓ Total time: {total_ms:.0f}ms")


def record_audio(duration_sec):
    """Record audio from microphone."""
    try:
        import sounddevice as sd
    except (ImportError, OSError):
        print("✗ No microphone available (sounddevice/PortAudio not found)")
        print("  Use --file option instead: python scripts/voice_test.py --file audio.wav")
        return None, None

    print(f"\n🎙️  Recording {duration_sec} seconds... SPEAK NOW!", flush=True)

    try:
        audio = sd.rec(
            int(duration_sec * 16000),
            samplerate=16000,
            channels=1,
            dtype="float32",
        )
        sd.wait()
        print("  ✓ Recording complete", flush=True)
        return audio.flatten(), 16000
    except Exception as e:
        print(f"  ✗ Recording failed: {e}")
        print("  Use --file option instead")
        return None, None


def load_audio_file(filepath):
    """Load audio from a WAV file."""
    try:
        import soundfile as sf
        audio, sr = sf.read(filepath, dtype="float32")
        if audio.ndim > 1:
            audio = audio[:, 0]  # Take first channel
        print(f"  ✓ Loaded: {filepath} ({len(audio)/sr:.1f}s at {sr}Hz)")
        return audio, sr
    except Exception as e:
        print(f"  ✗ Failed to load audio: {e}")
        return None, None


def interactive_mode(whisper, translator, router, glossary, cache):
    """Keep recording and translating in a loop."""
    print("\n" + "=" * 60)
    print("  BhashaSakha INTERACTIVE MODE")
    print("  Speak in Hindi, English, or Marathi")
    print("  Press Ctrl+C to exit")
    print("=" * 60)

    try:
        import sounddevice as sd
        has_mic = True
        # Check if input device exists
        try:
            sd.check_input_settings()
        except Exception:
            has_mic = False
    except (ImportError, OSError):
        has_mic = False

    if not has_mic:
        print("\n⚠ No microphone detected!")
        print("  Options to test with your voice:")
        print("")
        print("  1. Record on your phone → transfer the .wav file → run:")
        print("     python scripts/voice_test.py --file yourfile.wav")
        print("")
        print("  2. Record with arecord (if ALSA mic available):")
        print("     arecord -d 5 -r 16000 -f S16_LE test.wav")
        print("     python scripts/voice_test.py --file test.wav")
        print("")
        print("  3. Connect a USB microphone and re-run:")
        print("     python scripts/voice_test.py --interactive")
        return

    round_num = 0
    while True:
        round_num += 1
        print(f"\n{'─' * 60}")
        input(f"  [{round_num}] Press ENTER to start recording (5s)...")
        audio, sr = record_audio(5)
        if audio is not None:
            process_audio(audio, sr, whisper, translator, router, glossary, cache)


def main():
    parser = argparse.ArgumentParser(
        description="BhashaSakha Voice Test — Test with your real voice"
    )
    parser.add_argument("--record", type=int, metavar="SECONDS",
                        help="Record from microphone for N seconds")
    parser.add_argument("--file", type=str, metavar="PATH",
                        help="Process an audio file (.wav)")
    parser.add_argument("--interactive", action="store_true",
                        help="Interactive mode — keep listening")
    args = parser.parse_args()

    # Load engines
    whisper, translator, router, glossary, cache = load_engines()

    if args.file:
        audio, sr = load_audio_file(args.file)
        if audio is not None:
            process_audio(audio, sr, whisper, translator, router, glossary, cache)

    elif args.record:
        audio, sr = record_audio(args.record)
        if audio is not None:
            process_audio(audio, sr, whisper, translator, router, glossary, cache)

    elif args.interactive:
        interactive_mode(whisper, translator, router, glossary, cache)

    else:
        # Default: try interactive, fall back to instructions
        interactive_mode(whisper, translator, router, glossary, cache)


if __name__ == "__main__":
    main()
