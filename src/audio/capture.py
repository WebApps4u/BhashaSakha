"""Audio capture with ring buffer for BhashaSakha.

Captures audio from USB microphone using sounddevice callback.
Stores in pre-allocated ring buffer (zero-copy for RPi5 efficiency).
Feeds 30ms frames to VAD for speech detection.
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
    logger.warning("sounddevice not available — audio capture disabled")


class RingBuffer:
    """Pre-allocated circular audio buffer.

    Stores audio as float32 samples at 16kHz mono.
    Designed for zero-allocation operation after init (RPi5 friendly).
    """

    def __init__(self, duration_sec: int, sample_rate: int = 16000):
        self._size = duration_sec * sample_rate
        self._buffer = np.zeros(self._size, dtype=np.float32)
        self._write_pos = 0
        self._lock = threading.Lock()

    def write(self, data: np.ndarray):
        """Write audio samples to buffer (wraps around)."""
        n = len(data)
        with self._lock:
            if self._write_pos + n <= self._size:
                self._buffer[self._write_pos:self._write_pos + n] = data
            else:
                # Wrap around
                first_part = self._size - self._write_pos
                self._buffer[self._write_pos:] = data[:first_part]
                self._buffer[:n - first_part] = data[first_part:]
            self._write_pos = (self._write_pos + n) % self._size

    def read_last(self, num_samples: int) -> np.ndarray:
        """Read the most recent N samples from the buffer.

        Returns a contiguous copy (safe for processing).
        """
        with self._lock:
            if num_samples > self._size:
                num_samples = self._size

            end = self._write_pos
            start = end - num_samples

            if start >= 0:
                return self._buffer[start:end].copy()
            else:
                # Wraps around: concatenate end + beginning
                return np.concatenate([
                    self._buffer[start % self._size:],
                    self._buffer[:end]
                ]).copy()


class AudioCapture:
    """Microphone input manager with ring buffer and VAD integration.

    Runs audio capture in sounddevice's callback thread (Thread 1).
    Feeds frames to VAD and emits complete speech segments to a queue.
    """

    def __init__(self, sample_rate: int = 16000, channels: int = 1,
                 buffer_duration: int = 30, frame_ms: int = 30,
                 device: Optional[int] = None):
        """
        Args:
            sample_rate: Audio sample rate (16kHz for Whisper)
            channels: Number of channels (1 = mono)
            buffer_duration: Ring buffer duration in seconds
            frame_ms: Frame size in milliseconds for VAD
            device: Audio device index (None = default)
        """
        self.sample_rate = sample_rate
        self.channels = channels
        self.frame_ms = frame_ms
        self.frame_samples = int(sample_rate * frame_ms / 1000)
        self.device = device

        # Pre-allocated ring buffer
        self.ring_buffer = RingBuffer(buffer_duration, sample_rate)

        # Queue for complete speech segments
        self.speech_queue: queue.Queue = queue.Queue(maxsize=3)

        # Internal state
        self._stream: Optional[object] = None
        self._running = False
        self._frame_buffer = np.zeros(0, dtype=np.float32)

        # VAD callback (set by pipeline)
        self._vad_callback = None

        # Accumulated speech segment
        self._speech_frames: list = []
        self._is_speaking = False
        self._silence_frames = 0
        self._speech_start_pos = 0

    def set_vad_callback(self, callback):
        """Set the VAD processing callback.

        Args:
            callback: Function(frame: np.ndarray) -> bool (True if speech)
        """
        self._vad_callback = callback

    def start(self):
        """Start audio capture stream."""
        if sd is None:
            logger.error("sounddevice not available")
            return

        self._running = True

        try:
            self._stream = sd.InputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype="float32",
                blocksize=self.frame_samples,
                device=self.device,
                callback=self._audio_callback,
                latency="low",
            )
            self._stream.start()
            logger.info(
                f"Audio capture started: {self.sample_rate}Hz, "
                f"frame={self.frame_ms}ms, device={self.device or 'default'}"
            )
        except Exception as e:
            logger.error(f"Failed to start audio capture: {e}")
            self._running = False
            raise

    def stop(self):
        """Stop audio capture stream."""
        self._running = False
        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None
            logger.info("Audio capture stopped")

    def _audio_callback(self, indata: np.ndarray, frames: int,
                        time_info, status):
        """sounddevice callback — runs in audio thread.

        This is called by the audio driver for every frame_ms of audio.
        Must be fast and non-blocking.
        """
        if status:
            if status.input_overflow:
                logger.warning("Audio input overflow")

        if not self._running:
            return

        # Convert to mono float32, flatten
        audio = indata[:, 0] if indata.ndim > 1 else indata.flatten()

        # Write to ring buffer
        self.ring_buffer.write(audio)

        # Feed to VAD if callback is set
        if self._vad_callback:
            try:
                is_speech = self._vad_callback(audio)
                self._process_vad_result(is_speech, len(audio))
            except Exception as e:
                logger.error(f"VAD callback error: {e}")

    def _process_vad_result(self, is_speech: bool, num_samples: int):
        """Process VAD decision and manage speech segment accumulation.

        Args:
            is_speech: Whether current frame contains speech
            num_samples: Number of samples in this frame
        """
        silence_threshold_frames = int(
            600 / self.frame_ms  # 600ms silence = endpoint (configurable via VAD config)
        )
        min_speech_frames = int(500 / self.frame_ms)  # 500ms minimum
        max_speech_frames = int(30000 / self.frame_ms)  # 30s maximum

        if is_speech:
            if not self._is_speaking:
                # Speech onset
                self._is_speaking = True
                self._speech_frames = []
                self._silence_frames = 0
                # Calculate position for pre-speech padding
                pad_samples = int(self.sample_rate * 0.3)  # 300ms padding
                self._speech_start_pos = max(0, num_samples)

            self._speech_frames.append(num_samples)
            self._silence_frames = 0

            # Force process if too long
            if len(self._speech_frames) >= max_speech_frames:
                self._emit_speech_segment()

        else:
            if self._is_speaking:
                self._silence_frames += 1
                self._speech_frames.append(num_samples)  # Include trailing silence

                if self._silence_frames >= silence_threshold_frames:
                    # Endpoint detected
                    if len(self._speech_frames) - self._silence_frames >= min_speech_frames:
                        self._emit_speech_segment()
                    else:
                        # Too short — discard
                        logger.debug("Speech segment too short, discarding")
                        self._is_speaking = False
                        self._speech_frames = []

    def _emit_speech_segment(self):
        """Extract speech segment from ring buffer and push to queue."""
        if not self._speech_frames:
            self._is_speaking = False
            return

        # Calculate total samples to extract (including pre-padding)
        total_speech_samples = sum(self._speech_frames)
        pad_samples = int(self.sample_rate * 0.3)  # 300ms pre-padding
        total_samples = total_speech_samples + pad_samples

        # Extract from ring buffer
        segment = self.ring_buffer.read_last(total_samples)

        # Remove trailing silence (keep 100ms post-padding)
        post_pad = int(self.sample_rate * 0.1)
        silence_samples = self._silence_frames * self.frame_samples
        trim_samples = max(0, silence_samples - post_pad)
        if trim_samples > 0 and trim_samples < len(segment):
            segment = segment[:-trim_samples]

        # Push to processing queue (non-blocking)
        try:
            self.speech_queue.put_nowait(segment)
            duration_ms = len(segment) / self.sample_rate * 1000
            logger.info(f"Speech segment: {duration_ms:.0f}ms, {len(segment)} samples")
        except queue.Full:
            logger.warning("Speech queue full — dropping segment")

        # Reset state
        self._is_speaking = False
        self._speech_frames = []
        self._silence_frames = 0

    def is_active(self) -> bool:
        """Check if audio capture is active."""
        return self._running and self._stream is not None
