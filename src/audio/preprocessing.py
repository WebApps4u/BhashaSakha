"""Audio preprocessing for BhashaSakha.

Normalization, resampling, and format conversion.
All operations use pre-allocated numpy arrays for RPi5 efficiency.
"""

import numpy as np
import logging

logger = logging.getLogger(__name__)


def normalize_audio(audio: np.ndarray) -> np.ndarray:
    """Peak-normalize audio to [-1.0, 1.0] range.

    Args:
        audio: Float32 audio samples

    Returns:
        Normalized audio (same array modified in-place if possible)
    """
    peak = np.abs(audio).max()
    if peak > 0 and peak != 1.0:
        audio = audio / peak
    return audio


def ensure_float32(audio: np.ndarray) -> np.ndarray:
    """Convert audio to float32 format.

    Handles int16 (common from WAV files) and other formats.
    """
    if audio.dtype == np.float32:
        return audio
    elif audio.dtype == np.int16:
        return audio.astype(np.float32) / 32768.0
    elif audio.dtype == np.float64:
        return audio.astype(np.float32)
    else:
        return audio.astype(np.float32)


def ensure_mono(audio: np.ndarray) -> np.ndarray:
    """Convert stereo to mono by averaging channels."""
    if audio.ndim == 2:
        return audio.mean(axis=1).astype(np.float32)
    return audio


def resample(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """Simple linear interpolation resampling.

    For RPi5 efficiency, uses numpy interpolation rather than
    librosa/scipy (avoids large dependencies).

    Args:
        audio: Input audio samples
        orig_sr: Original sample rate
        target_sr: Target sample rate

    Returns:
        Resampled audio
    """
    if orig_sr == target_sr:
        return audio

    duration = len(audio) / orig_sr
    target_length = int(duration * target_sr)
    indices = np.linspace(0, len(audio) - 1, target_length)
    resampled = np.interp(indices, np.arange(len(audio)), audio)
    return resampled.astype(np.float32)


def prepare_for_whisper(audio: np.ndarray, sample_rate: int = 16000) -> np.ndarray:
    """Prepare audio segment for Whisper STT.

    Ensures: float32, mono, 16kHz, normalized.

    Args:
        audio: Raw audio data
        sample_rate: Current sample rate of the audio

    Returns:
        Whisper-ready audio (float32, mono, 16kHz)
    """
    audio = ensure_float32(audio)
    audio = ensure_mono(audio)

    if sample_rate != 16000:
        audio = resample(audio, sample_rate, 16000)

    # Normalize to prevent clipping issues
    audio = normalize_audio(audio)

    return audio


def calculate_rms(audio: np.ndarray) -> float:
    """Calculate Root Mean Square energy level.

    Useful for detecting very quiet/noisy segments.
    """
    return float(np.sqrt(np.mean(audio ** 2)))


def trim_silence(audio: np.ndarray, threshold: float = 0.01,
                 frame_ms: int = 30, sample_rate: int = 16000) -> np.ndarray:
    """Trim leading and trailing silence from audio.

    Args:
        audio: Audio samples
        threshold: RMS threshold below which is considered silence
        frame_ms: Frame size for analysis
        sample_rate: Sample rate

    Returns:
        Trimmed audio
    """
    frame_size = int(sample_rate * frame_ms / 1000)
    num_frames = len(audio) // frame_size

    if num_frames == 0:
        return audio

    # Find first non-silent frame
    start_frame = 0
    for i in range(num_frames):
        frame = audio[i * frame_size:(i + 1) * frame_size]
        if calculate_rms(frame) > threshold:
            start_frame = max(0, i - 1)  # Keep 1 frame before speech
            break

    # Find last non-silent frame
    end_frame = num_frames
    for i in range(num_frames - 1, -1, -1):
        frame = audio[i * frame_size:(i + 1) * frame_size]
        if calculate_rms(frame) > threshold:
            end_frame = min(num_frames, i + 2)  # Keep 1 frame after speech
            break

    start_sample = start_frame * frame_size
    end_sample = min(end_frame * frame_size, len(audio))

    return audio[start_sample:end_sample]
