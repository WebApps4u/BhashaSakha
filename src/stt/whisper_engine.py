"""faster-whisper STT engine for BhashaSakha.

Speech-to-Text using faster-whisper (CTranslate2 backend).
Optimized for RPi5 ARM64 with int8 quantization.
"""

import numpy as np
import logging
import time
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class STTResult:
    """Result from speech-to-text transcription."""
    text: str
    language: str           # Whisper language code: "hi", "mr", "en"
    confidence: float       # Language detection confidence (0-1)
    duration_ms: float = 0  # Processing time


class WhisperEngine:
    """faster-whisper STT wrapper optimized for RPi5.

    Uses CTranslate2 backend with int8 quantization for
    ~2x speed improvement on ARM64 via Ruy/NEON.

    Parameters are tuned for banking domain:
    - beam_size=3 (faster than default 5)
    - without_timestamps=True (no need, saves compute)
    - condition_on_previous_text=False (prevents hallucination loops)
    """

    def __init__(self, model_path: str, compute_type: str = "int8",
                 beam_size: int = 3, best_of: int = 1,
                 without_timestamps: bool = True,
                 condition_on_previous_text: bool = False,
                 language: Optional[str] = None,
                 min_confidence: float = 0.5):
        self.model_path = model_path
        self.compute_type = compute_type
        self.beam_size = beam_size
        self.best_of = best_of
        self.without_timestamps = without_timestamps
        self.condition_on_previous_text = condition_on_previous_text
        self.language = language
        self.min_confidence = min_confidence
        self._model = None

    def load(self):
        """Load the Whisper model.

        This takes ~5 seconds on RPi5 for whisper-small.
        Should be called during BOOT phase.
        """
        try:
            from faster_whisper import WhisperModel

            start = time.monotonic()

            self._model = WhisperModel(
                self.model_path,
                device="cpu",
                compute_type=self.compute_type,
                cpu_threads=2,  # Limit to 2 cores on RPi5
            )

            elapsed = (time.monotonic() - start) * 1000
            logger.info(
                f"Whisper loaded: {self.model_path} "
                f"({self.compute_type}) in {elapsed:.0f}ms"
            )

        except Exception as e:
            logger.error(f"Failed to load Whisper model: {e}")
            raise

    def transcribe(self, audio: np.ndarray) -> Optional[STTResult]:
        """Transcribe audio and detect language.

        Args:
            audio: Float32 audio at 16kHz mono

        Returns:
            STTResult with text, language, confidence, or None on failure
        """
        if self._model is None:
            logger.error("Whisper model not loaded")
            return None

        start = time.monotonic()

        try:
            segments, info = self._model.transcribe(
                audio,
                language=self.language,
                beam_size=self.beam_size,
                best_of=self.best_of,
                without_timestamps=self.without_timestamps,
                condition_on_previous_text=self.condition_on_previous_text,
                vad_filter=False,  # We handle VAD externally
            )

            # Collect all segment texts
            text_parts = []
            for segment in segments:
                text_parts.append(segment.text.strip())

            text = " ".join(text_parts).strip()
            elapsed_ms = (time.monotonic() - start) * 1000

            if not text:
                logger.debug(f"Empty transcription ({elapsed_ms:.0f}ms)")
                return None

            result = STTResult(
                text=text,
                language=info.language,
                confidence=info.language_probability,
                duration_ms=elapsed_ms,
            )

            # Log latency and language (NOT the text — privacy)
            logger.info(
                f"STT: lang={result.language} conf={result.confidence:.2f} "
                f"chars={len(text)} time={elapsed_ms:.0f}ms"
            )

            return result

        except Exception as e:
            elapsed_ms = (time.monotonic() - start) * 1000
            logger.error(f"Transcription error after {elapsed_ms:.0f}ms: {e}")
            return None

    def warmup(self):
        """Run dummy inference to warm up JIT caches.

        Important for RPi5: first inference is ~2x slower than subsequent.
        """
        if self._model is None:
            return

        logger.info("Warming up Whisper...")
        dummy = np.zeros(16000, dtype=np.float32)  # 1 second of silence
        try:
            segments, _ = self._model.transcribe(
                dummy,
                beam_size=1,
                best_of=1,
                without_timestamps=True,
            )
            # Force iteration to complete inference
            for _ in segments:
                pass
            logger.info("Whisper warmup complete")
        except Exception as e:
            logger.warning(f"Whisper warmup failed: {e}")

    @property
    def is_loaded(self) -> bool:
        return self._model is not None
