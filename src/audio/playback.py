"""Audio playback engine for BhashaSakha.

Non-blocking audio output via sounddevice.
Supports fade-in to prevent clicks, and ducking for interrupts.
"""

import numpy as np
import threading
import logging
import queue
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import sounddevice as sd
except OSError:
    sd = None


class AudioPlayback:
    """Non-blocking audio playback manager.

    Plays PCM audio through the speaker without blocking the pipeline.
    Supports:
    - Queue-based playback (Thread 4)
    - Soft fade-in to prevent click artifacts
    - Playback completion callback
    - Interrupt/duck current playback
    """

    def __init__(self, sample_rate: int = 22050, device: Optional[int] = None):
        """
        Args:
            sample_rate: Output sample rate (22050 for Piper TTS)
            device: Audio output device index (None = default)
        """
        self.sample_rate = sample_rate
        self.device = device
        self._play_queue: queue.Queue = queue.Queue(maxsize=2)
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._current_stream: Optional[object] = None
        self._on_complete = None
        self._is_playing = False
        self._lock = threading.Lock()

    def start(self):
        """Start playback thread."""
        self._running = True
        self._thread = threading.Thread(
            target=self._playback_loop,
            name="audio-playback",
            daemon=True,
        )
        self._thread.start()
        logger.info("Audio playback thread started")

    def stop(self):
        """Stop playback thread and any active playback."""
        self._running = False
        self.interrupt()
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None

    def play(self, audio: np.ndarray, sample_rate: int = None,
             on_complete=None):
        """Queue audio for playback.

        Args:
            audio: PCM audio (int16 or float32)
            sample_rate: Override sample rate
            on_complete: Callback when playback finishes
        """
        sr = sample_rate or self.sample_rate
        self._on_complete = on_complete

        try:
            self._play_queue.put_nowait((audio, sr))
        except queue.Full:
            logger.warning("Playback queue full — dropping audio")

    def interrupt(self):
        """Stop current playback immediately."""
        with self._lock:
            if self._current_stream:
                try:
                    sd.stop()
                except Exception:
                    pass
                self._is_playing = False

    @property
    def is_playing(self) -> bool:
        return self._is_playing

    def _playback_loop(self):
        """Background playback thread (Thread 4)."""
        while self._running:
            try:
                audio, sr = self._play_queue.get(timeout=0.5)
                self._play_audio(audio, sr)
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"Playback error: {e}")

    def _play_audio(self, audio: np.ndarray, sample_rate: int):
        """Play audio synchronously (within playback thread)."""
        if sd is None:
            logger.warning("sounddevice not available — skipping playback")
            return

        # Convert int16 to float32 if needed
        if audio.dtype == np.int16:
            audio = audio.astype(np.float32) / 32768.0
        elif audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        # Apply soft fade-in (10ms) to prevent click
        fade_samples = min(int(sample_rate * 0.01), len(audio))
        if fade_samples > 0:
            fade = np.linspace(0, 1, fade_samples, dtype=np.float32)
            audio[:fade_samples] *= fade

        # Apply fade-out (10ms)
        if fade_samples > 0 and len(audio) > fade_samples:
            fade_out = np.linspace(1, 0, fade_samples, dtype=np.float32)
            audio[-fade_samples:] *= fade_out

        self._is_playing = True
        try:
            sd.play(audio, samplerate=sample_rate, device=self.device)
            sd.wait()  # Block until playback complete
        except Exception as e:
            logger.error(f"Audio output error: {e}")
        finally:
            self._is_playing = False

            if self._on_complete:
                try:
                    self._on_complete()
                except Exception as e:
                    logger.error(f"Playback completion callback error: {e}")
