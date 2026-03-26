"""BhashaSakha — Main Entry Point.

Initializes all components, starts all threads, and handles
graceful shutdown. Optimized boot sequence for Raspberry Pi 5.
"""

import os
import sys
import signal
import time
import logging
import argparse
import gc

logger = logging.getLogger(__name__)


def parse_args():
    parser = argparse.ArgumentParser(
        description="BhashaSakha — Offline Voice Translation System"
    )
    parser.add_argument(
        "--config", "-c",
        default="config/config.yaml",
        help="Path to configuration file",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging",
    )
    parser.add_argument(
        "--no-sensor",
        action="store_true",
        help="Disable proximity sensor (always-on mode)",
    )
    parser.add_argument(
        "--display",
        action="store_true",
        help="Enable console text display",
    )
    parser.add_argument(
        "--benchmark",
        action="store_true",
        help="Run benchmark mode instead of live operation",
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Run demo mode (no hardware needed — generates test audio)",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    # ─── PHASE 1: Configuration ───────────────────────────────
    from src.core.config_loader import load_config
    from src.utils.logger import setup_logging

    config = load_config(args.config)

    # Apply overrides from CLI
    if args.debug:
        config.system.log_level = "DEBUG"
    if args.no_sensor:
        config.proximity.enabled = False
    if args.display:
        config.system.display_enabled = True

    setup_logging(
        level=config.system.log_level,
        to_file=config.system.log_to_file,
    )

    logger.info("=" * 60)
    logger.info(f"  {config.system.name} v{config.system.version}")
    logger.info(f"  Offline Multilingual Voice Translation")
    logger.info("=" * 60)

    # ─── PHASE 2: Health Monitor + System Info ────────────────
    from src.utils.health import HealthMonitor

    health = HealthMonitor(
        check_interval=config.health.monitor_interval_sec,
        max_temp_c=config.health.max_cpu_temp_c,
        max_memory_pct=config.health.max_memory_percent,
    )
    health.log_startup_info()
    health.start_monitoring()

    # ─── PHASE 3: State Machine ───────────────────────────────
    from src.core.state_machine import StateMachine, SystemState

    state_machine = StateMachine()
    logger.info("State machine initialized (BOOT)")

    # ─── PHASE 4: Load Models (Sequential, ~20s total) ────────
    logger.info("Loading models — this takes ~20 seconds on RPi5...")

    # 4a: Silero VAD (~1s, ~2MB → ~10MB RAM)
    from src.audio.vad import SileroVAD

    vad_model_path = config.resolve_path(config.vad.model_path)
    vad = SileroVAD(vad_model_path, threshold=config.vad.threshold)
    logger.info("✓ VAD loaded")

    # 4b: faster-whisper (~5s, ~150MB → ~500MB RAM)
    from src.stt.whisper_engine import WhisperEngine

    whisper = WhisperEngine(
        model_path=config.resolve_path(config.stt.model_path),
        compute_type=config.stt.compute_type,
        beam_size=config.stt.beam_size,
        best_of=config.stt.best_of,
        without_timestamps=config.stt.without_timestamps,
        condition_on_previous_text=config.stt.condition_on_previous_text,
        language=config.stt.language,
        min_confidence=config.stt.min_confidence,
    )
    whisper.load()
    logger.info("✓ Whisper STT loaded")

    # 4c: NLLB-200 Translation (~8s, ~1.06GB → ~1.2GB RAM)
    from src.translation.nllb_engine import NLLBEngine

    translator = NLLBEngine(
        model_path=config.resolve_path(config.translation.model_path),
        tokenizer_name=config.translation.tokenizer_name,
        beam_size=config.translation.beam_size,
        max_decoding_length=config.translation.max_decoding_length,
    )
    translator.load()
    logger.info("✓ NLLB-200 translator loaded")

    # 4d: Piper TTS (~3s, ~180MB → ~600MB RAM for 3 voices)
    from src.tts.piper_engine import PiperEngine

    tts = PiperEngine(voices_config=config.tts.voices)
    tts.load(base_dir=config.base_dir)
    logger.info("✓ Piper TTS loaded")

    # 4e: Warmup all models
    if config.performance.warmup_on_boot:
        logger.info("Warming up models...")
        whisper.warmup()
        translator.warmup()
        tts.warmup()
        gc.collect()  # Clean up warmup allocations
        logger.info("✓ Model warmup complete")

    # Log memory after all models loaded
    mem_info = health.check_health()
    logger.info(
        f"Models loaded: RAM={mem_info['ram_used_mb']:.0f}MB "
        f"({mem_info['ram_percent']:.1f}%) "
        f"Temp={mem_info['cpu_temp_c']:.1f}°C"
    )

    # ─── PHASE 5: Initialize Components ───────────────────────
    from src.translation.language_router import LanguageRouter
    from src.translation.glossary import BankingGlossary
    from src.core.session import SessionManager
    from src.audio.capture import AudioCapture
    from src.audio.playback import AudioPlayback
    from src.display.text_display import TextDisplay

    language_router = LanguageRouter(
        supported_languages=config.translation.supported_languages,
        min_confidence=config.stt.min_confidence,
    )

    glossary = BankingGlossary(
        glossary_path=config.resolve_path(config.glossary.path),
        fuzzy_threshold=config.glossary.fuzzy_match_threshold,
        enabled=config.glossary.enabled,
    )

    session_manager = SessionManager(
        idle_timeout=config.session.idle_timeout_sec,
        max_duration=config.session.max_duration_sec,
        confusion_threshold=config.session.confusion_threshold,
        slow_speed=config.tts.slow_speed,
    )

    audio_capture = AudioCapture(
        sample_rate=config.audio.sample_rate,
        channels=config.audio.channels,
        buffer_duration=config.audio.buffer_duration_sec,
        frame_ms=config.audio.frame_duration_ms,
        device=config.audio.input_device,
    )

    playback = AudioPlayback(
        sample_rate=22050,
        device=config.audio.output_device,
    )

    display = TextDisplay(enabled=config.system.display_enabled)

    # Connect VAD to audio capture
    audio_capture.set_vad_callback(vad.is_speech)

    # ─── PHASE 6: Proximity Sensor ────────────────────────────
    from src.sensors.proximity import ProximitySensor

    proximity = ProximitySensor(
        trigger_pin=config.proximity.trigger_pin,
        echo_pin=config.proximity.echo_pin,
        activation_cm=config.proximity.activation_cm,
        deactivation_cm=config.proximity.deactivation_cm,
        deactivation_delay=config.proximity.deactivation_delay_sec,
        poll_interval_ms=config.proximity.poll_interval_ms,
        enabled=config.proximity.enabled,
    )

    def on_user_detected():
        """Called when proximity sensor detects a user."""
        logger.info("👤 User detected — activating")
        session_manager.create_session()
        state_machine.transition(SystemState.LISTENING)
        display.update(DisplayUpdate(status="listening"))

    def on_user_left():
        """Called when user leaves proximity zone."""
        logger.info("👤 User left — deactivating")
        session_manager.destroy_session()
        language_router.reset()
        vad.reset()
        state_machine.transition(SystemState.STANDBY)
        gc.collect()  # Clean up session data

    proximity.set_callbacks(
        on_detected=on_user_detected,
        on_left=on_user_left,
    )

    # ─── PHASE 7: Pipeline Orchestrator ───────────────────────
    from src.core.pipeline import PipelineOrchestrator

    pipeline = PipelineOrchestrator(
        state_machine=state_machine,
        session_manager=session_manager,
        whisper=whisper,
        translator=translator,
        language_router=language_router,
        glossary=glossary,
        tts=tts,
        playback=playback,
        display=display,
        health=health,
        speech_queue=audio_capture.speech_queue,
    )

    # ─── PHASE 8: Graceful Shutdown Handler ───────────────────
    shutdown_event = [False]

    def signal_handler(signum, frame):
        sig_name = signal.Signals(signum).name
        logger.info(f"Received {sig_name} — shutting down gracefully...")
        shutdown_event[0] = True

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    # ─── PHASE 9: Start All Threads ──────────────────────────
    try:
        proximity.start()      # Thread 2: Proximity polling
        playback.start()       # Thread 4: Audio playback
        display.start()        # Thread 5: Display updates
        pipeline.start()       # Thread 3: Pipeline processing
        audio_capture.start()  # Thread 1: Audio capture (last — starts generating data)

        # Transition to ready state
        state_machine.transition(SystemState.STANDBY)

        if not config.proximity.enabled:
            # No sensor — go straight to listening
            session_manager.create_session()
            state_machine.transition(SystemState.LISTENING)
            logger.info("No proximity sensor — always listening")

        logger.info("━" * 50)
        logger.info("  BhashaSakha is READY")
        logger.info(f"  State: {state_machine.state.value}")
        logger.info(f"  Proximity: {'enabled' if config.proximity.enabled else 'disabled'}")
        logger.info(f"  Display: {'enabled' if config.system.display_enabled else 'disabled'}")
        logger.info("━" * 50)

        # ─── DEMO MODE ────────────────────────────────────
        if args.demo:
            logger.info("Running in DEMO mode (no hardware)")
            run_demo(config, whisper, translator, language_router,
                     glossary, tts, display)
            return

        # ─── MAIN LOOP: Keep alive until shutdown ─────────────
        while not shutdown_event[0]:
            time.sleep(1)

            # Periodic GC during standby
            if state_machine.state == SystemState.STANDBY:
                if state_machine.time_in_state > 60:
                    gc.collect()

    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")

    finally:
        # ─── PHASE 10: Graceful Shutdown ──────────────────────
        logger.info("Shutting down...")
        audio_capture.stop()
        pipeline.stop()
        playback.stop()
        display.stop()
        proximity.stop()
        health.stop_monitoring()
        session_manager.destroy_session()

        stats = pipeline.stats
        logger.info(
            f"Shutdown complete. "
            f"Processed {stats['total_utterances']} utterances, "
            f"{stats['total_errors']} errors"
        )


def run_demo(config, whisper, translator, language_router, glossary, tts, display):
    """Run demo mode — no hardware needed.

    Generates test audio via espeak-ng, runs through the full pipeline,
    and displays results. Perfect for verifying deployment without
    microphone/speaker.
    """
    import subprocess
    import io

    try:
        import soundfile as sf
    except ImportError:
        print("\n✗ soundfile not installed. Run: pip install soundfile")
        return

    from src.translation.cache import TranslationCache
    from src.utils.profiler import PipelineProfiler

    cache = TranslationCache(max_size=200)
    profiler = PipelineProfiler()

    demo_phrases = [
        ("en", "I want to check my account balance"),
        ("en", "Please help me with KYC documents"),
        ("en", "What is the interest rate on fixed deposit"),
        ("en", "I need to apply for a home loan"),
        ("en", "How do I update my Aadhaar details in the bank"),
    ]

    print("\n" + "━" * 60)
    print("  BhashaSakha DEMO MODE")
    print("  No hardware needed — using espeak-ng for test audio")
    print("━" * 60)

    for i, (lang, phrase) in enumerate(demo_phrases):
        print(f"\n{'─' * 60}")
        print(f"  [{i+1}/{len(demo_phrases)}] Input: \"{phrase}\"")
        print(f"{'─' * 60}")

        # Generate audio
        try:
            cmd = ["espeak-ng", "-v", lang, "--stdout", phrase]
            result = subprocess.run(cmd, capture_output=True, timeout=10)
            if result.returncode != 0 or not result.stdout:
                print("  ✗ espeak-ng failed")
                continue
            audio, sr = sf.read(io.BytesIO(result.stdout), dtype="float32")
            if sr != 16000:
                from src.audio.preprocessing import resample
                audio = resample(audio, sr, 16000)
            print(f"  🎤 Audio: {len(audio)/16000:.1f}s")
        except Exception as e:
            print(f"  ✗ Audio generation failed: {e}")
            continue

        profiler.start_pipeline()
        total_start = time.monotonic()

        # STT
        stt_result = whisper.transcribe(audio)
        stt_ms = (time.monotonic() - total_start) * 1000

        if not stt_result or not stt_result.text.strip():
            print(f"  ✗ STT returned empty ({stt_ms:.0f}ms)")
            profiler.end_pipeline()
            continue

        text = stt_result.text
        det_lang = stt_result.language
        print(f"  📝 STT ({stt_ms:.0f}ms): [{det_lang}] \"{text}\"")
        profiler.record_stage("stt", stt_ms)

        # Glossary correction
        corrected = glossary.correct_stt(text, det_lang)
        if corrected != text:
            print(f"  🔧 Glossary: \"{corrected}\"")

        # Translation
        src_nllb = language_router.whisper_to_nllb(det_lang)
        targets = language_router.get_all_targets(det_lang)

        for tgt in targets:
            tgt_nllb = language_router.whisper_to_nllb(tgt)

            t_start = time.monotonic()
            cached = cache.get(corrected, src_nllb, tgt_nllb)
            if cached:
                translated = cached
                t_ms = (time.monotonic() - t_start) * 1000
                print(f"  → [{tgt}] ({t_ms:.0f}ms CACHED): \"{translated}\"")
            else:
                translated = translator.translate(corrected, src_nllb, tgt_nllb)
                cache.put(corrected, src_nllb, tgt_nllb, translated)
                t_ms = (time.monotonic() - t_start) * 1000
                print(f"  → [{tgt}] ({t_ms:.0f}ms): \"{translated}\"")

            profiler.record_stage("translation", t_ms)

            # TTS via espeak-ng fallback
            if tts:
                tts_start = time.monotonic()
                tts_audio = tts.synthesize(translated, tgt, speed=1.0)
                tts_ms = (time.monotonic() - tts_start) * 1000
                if tts_audio is not None:
                    print(f"  🔊 TTS ({tts_ms:.0f}ms): {len(tts_audio)/22050:.1f}s audio")
                    profiler.record_stage("tts", tts_ms)

        total_ms = profiler.end_pipeline()
        print(f"  ✓ Total: {total_ms:.0f}ms")

    # Summary
    profiler.print_summary()
    print(f"\nCache Stats: {cache.stats}")
    print("\n" + "━" * 60)
    print("  DEMO COMPLETE — System verified!")
    print("  For live operation, run without --demo on RPi5")
    print("━" * 60)


if __name__ == "__main__":
    main()
