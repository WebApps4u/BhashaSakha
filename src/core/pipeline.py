"""Pipeline orchestrator for BhashaSakha.

Thread 3: Core processing pipeline that chains STT → Translation → Glossary → TTS.
Coordinates all ML engines and manages data flow between components.
"""

import time
import threading
import queue
import logging
import gc
import numpy as np
from typing import Optional, List
from dataclasses import dataclass

from src.core.state_machine import StateMachine, SystemState
from src.core.session import SessionManager, TranslationRecord
from src.stt.whisper_engine import WhisperEngine, STTResult
from src.translation.nllb_engine import NLLBEngine
from src.translation.language_router import LanguageRouter
from src.translation.glossary import BankingGlossary
from src.tts.piper_engine import PiperEngine
from src.audio.playback import AudioPlayback
from src.audio.preprocessing import prepare_for_whisper
from src.display.text_display import TextDisplay, DisplayUpdate
from src.utils.logger import LatencyTracker
from src.utils.health import HealthMonitor
from src.utils.profiler import PipelineProfiler, get_profiler
from src.translation.cache import TranslationCache

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    """Result of processing a single utterance through the pipeline."""
    source_text: str = ""
    source_lang: str = ""           # Whisper code
    translations: list = None       # List of (text, lang) tuples
    total_ms: float = 0.0
    stt_ms: float = 0.0
    translate_ms: float = 0.0
    tts_ms: float = 0.0
    action: str = "translate"       # "translate", "repeat", "slowdown"

    def __post_init__(self):
        if self.translations is None:
            self.translations = []


class PipelineOrchestrator:
    """Main processing pipeline (Thread 3).

    Waits for speech segments from the audio capture queue,
    runs them through STT → Translate → Glossary → TTS,
    and queues audio output for playback.

    Handles:
    - Per-stage latency tracking
    - Thermal throttling
    - Confusion/repeat detection
    - Error recovery per stage
    - Graceful degradation
    """

    def __init__(self, state_machine: StateMachine,
                 session_manager: SessionManager,
                 whisper: WhisperEngine,
                 translator: NLLBEngine,
                 language_router: LanguageRouter,
                 glossary: BankingGlossary,
                 tts: PiperEngine,
                 playback: AudioPlayback,
                 display: TextDisplay,
                 health: HealthMonitor,
                 speech_queue: queue.Queue):
        self._state = state_machine
        self._session = session_manager
        self._whisper = whisper
        self._translator = translator
        self._router = language_router
        self._glossary = glossary
        self._tts = tts
        self._playback = playback
        self._display = display
        self._health = health
        self._speech_queue = speech_queue

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._latency = LatencyTracker("pipeline")
        self._profiler = get_profiler()
        self._cache = TranslationCache(max_size=200)

        # Stats
        self._total_utterances = 0
        self._total_errors = 0
        self._cache_hits = 0

    def start(self):
        """Start pipeline processing thread."""
        self._running = True
        self._thread = threading.Thread(
            target=self._processing_loop,
            name="pipeline",
            daemon=True,
        )
        self._thread.start()
        logger.info("Pipeline orchestrator started")

    def stop(self):
        """Stop pipeline processing."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None

    def _processing_loop(self):
        """Main pipeline loop (Thread 3).

        Continuously waits for speech segments and processes them.
        """
        while self._running:
            try:
                # Wait for speech segment from audio capture
                try:
                    audio_segment = self._speech_queue.get(timeout=0.5)
                except queue.Empty:
                    # Check for session timeout during idle
                    if self._session.active and self._session.is_expired():
                        self._session.destroy_session()
                        self._state.transition(SystemState.STANDBY)
                    continue

                # Process the utterance
                if self._state.state in {SystemState.LISTENING, SystemState.STANDBY}:
                    self._state.transition(SystemState.PROCESSING)

                    # Show processing status
                    self._display.update(DisplayUpdate(status="processing"))

                    result = self._process_utterance(audio_segment)

                    if result:
                        self._total_utterances += 1

                        # Handle special actions
                        if result.action == "repeat":
                            self._handle_repeat()
                        elif result.action == "slowdown":
                            self._handle_slowdown()
                        else:
                            self._handle_translation_output(result)

            except Exception as e:
                self._total_errors += 1
                logger.error(f"Pipeline error: {e}", exc_info=True)
                self._state.transition(SystemState.ERROR,
                                        error_msg=str(e))
                time.sleep(2)
                self._state.transition(SystemState.STANDBY)

    def _process_utterance(self, audio: np.ndarray) -> Optional[PipelineResult]:
        """Process a single speech segment through the full pipeline.

        Args:
            audio: Float32 audio segment (16kHz mono)

        Returns:
            PipelineResult or None on failure
        """
        self._latency.reset()
        self._latency.start_total()
        result = PipelineResult()

        # === STAGE 1: Audio Preprocessing ===
        self._latency.start("preprocess")
        audio = prepare_for_whisper(audio)
        self._latency.stop("preprocess")

        # === STAGE 2: Speech-to-Text ===
        self._latency.start("stt")

        # Thermal check — add delay if CPU is hot
        if self._health.should_throttle():
            logger.warning("Thermal throttle: inserting 100ms delay")
            time.sleep(0.1)

        stt_result = self._whisper.transcribe(audio)
        result.stt_ms = self._latency.stop("stt")

        if stt_result is None or not stt_result.text.strip():
            logger.debug("Empty STT result — returning to listening")
            self._state.transition(SystemState.LISTENING)
            return None

        result.source_text = stt_result.text
        source_lang = self._router.validate_language(
            stt_result.language, stt_result.confidence
        )
        result.source_lang = source_lang

        # === STAGE 3: Post-STT Glossary Correction ===
        self._latency.start("glossary_stt")
        result.source_text = self._glossary.correct_stt(
            result.source_text, source_lang
        )
        self._latency.stop("glossary_stt")

        # === STAGE 4: Confusion/Special Command Detection ===
        if self._glossary.detect_confusion(result.source_text, source_lang):
            result.action = "repeat"
            self._session.record_confusion()
            self._latency.log_summary()
            return result

        if self._glossary.detect_slowdown(result.source_text, source_lang):
            result.action = "slowdown"
            self._latency.log_summary()
            return result

        # === STAGE 5: Record Language in Session ===
        if not self._session.active:
            self._session.create_session()
        self._session.record_language(source_lang)
        self._session.touch()

        # === STAGE 6: Determine Target Languages ===
        target_langs = self._session.get_target_languages(source_lang)

        if not target_langs:
            logger.info("No target languages — source language only")
            self._state.transition(SystemState.LISTENING)
            return None

        # === STAGE 7: Translation (with cache) ===
        self._latency.start("translation")

        for tgt_lang in target_langs:
            src_nllb = self._router.whisper_to_nllb(source_lang)
            tgt_nllb = self._router.whisper_to_nllb(tgt_lang)

            # Check cache first
            cached = self._cache.get(result.source_text, src_nllb, tgt_nllb)
            if cached:
                translated = cached
                self._cache_hits += 1
            else:
                translated = self._translator.translate(
                    result.source_text, src_nllb, tgt_nllb
                )
                self._cache.put(result.source_text, src_nllb, tgt_nllb,
                                translated)

            # Post-translation glossary correction
            translated = self._glossary.correct_translation(
                translated, source_lang, tgt_lang
            )

            result.translations.append((translated, tgt_lang))

        result.translate_ms = self._latency.stop("translation")

        # === STAGE 8: TTS Synthesis ===
        self._latency.start("tts")

        # Synthesize the first (primary) translation
        if result.translations:
            primary_text, primary_lang = result.translations[0]
            tts_speed = self._session.get_tts_speed()

            tts_audio = self._tts.synthesize(
                primary_text, primary_lang, speed=tts_speed
            )

            if tts_audio is not None:
                # Store for repeat
                record = TranslationRecord(
                    source_text=result.source_text,
                    source_lang=source_lang,
                    translated_text=primary_text,
                    target_lang=primary_lang,
                    audio_data=tts_audio.tobytes(),
                )
                self._session.record_translation(record)

                # Queue for playback
                sample_rate = self._tts.get_sample_rate(primary_lang)
                self._playback.play(
                    tts_audio,
                    sample_rate=sample_rate,
                    on_complete=self._on_playback_complete,
                )

        result.tts_ms = self._latency.stop("tts")

        # === DONE ===
        result.total_ms = self._latency.get_total_ms()
        self._latency.log_summary()

        # Record profiler metrics
        self._profiler.record_stage("stt", result.stt_ms)
        self._profiler.record_stage("translation", result.translate_ms)
        self._profiler.record_stage("tts", result.tts_ms)
        self._profiler.record_stage("total", result.total_ms)

        # Update display
        if result.translations:
            primary_text, primary_lang = result.translations[0]
            self._display.update(DisplayUpdate(
                source_text=result.source_text,
                source_lang=result.source_lang,
                translated_text=primary_text,
                target_lang=primary_lang,
                status="speaking",
            ))

        self._state.transition(SystemState.SPEAKING)
        return result

    def _handle_repeat(self):
        """Handle repeat/confusion request — replay last translation."""
        last = self._session.get_last_translation()
        if last and last.audio_data:
            logger.info("Repeating last translation")
            audio = np.frombuffer(last.audio_data, dtype=np.int16)
            sample_rate = self._tts.get_sample_rate(last.target_lang)
            self._playback.play(
                audio,
                sample_rate=sample_rate,
                on_complete=self._on_playback_complete,
            )
            self._state.transition(SystemState.SPEAKING)

            self._display.update(DisplayUpdate(
                source_text=last.source_text,
                source_lang=last.source_lang,
                translated_text=last.translated_text,
                target_lang=last.target_lang,
                status="speaking",
            ))
        else:
            logger.info("No previous translation to repeat")
            self._state.transition(SystemState.LISTENING)

    def _handle_slowdown(self):
        """Handle slow-down request — re-synthesize last translation slowly."""
        self._session.record_confusion()  # Also triggers speed reduction
        last = self._session.get_last_translation()

        if last:
            logger.info("Re-synthesizing at slow speed")
            slow_audio = self._tts.synthesize(
                last.translated_text,
                last.target_lang,
                speed=self._session.get_tts_speed(),
            )
            if slow_audio is not None:
                sample_rate = self._tts.get_sample_rate(last.target_lang)
                self._playback.play(
                    slow_audio,
                    sample_rate=sample_rate,
                    on_complete=self._on_playback_complete,
                )
                self._state.transition(SystemState.SPEAKING)
                return

        self._state.transition(SystemState.LISTENING)

    def _on_playback_complete(self):
        """Called when TTS audio playback finishes."""
        if self._state.state == SystemState.SPEAKING:
            self._state.transition(SystemState.LISTENING)
            self._display.update(DisplayUpdate(status="listening"))

    @property
    def stats(self) -> dict:
        return {
            "total_utterances": self._total_utterances,
            "total_errors": self._total_errors,
            "cache_hits": self._cache_hits,
            "cache_stats": self._cache.stats,
            "profiler": self._profiler.to_dict(),
        }
