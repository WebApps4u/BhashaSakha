"""Tests for audio preprocessing."""

import pytest
import numpy as np
from src.audio.preprocessing import (
    normalize_audio,
    ensure_float32,
    ensure_mono,
    resample,
    prepare_for_whisper,
    calculate_rms,
    trim_silence,
)


class TestNormalize:
    def test_normalize_scales_to_one(self):
        audio = np.array([0.5, -0.25, 0.1], dtype=np.float32)
        result = normalize_audio(audio)
        assert abs(np.abs(result).max() - 1.0) < 1e-6

    def test_normalize_silence(self):
        audio = np.zeros(100, dtype=np.float32)
        result = normalize_audio(audio)
        assert np.all(result == 0)

    def test_normalize_already_normalized(self):
        audio = np.array([1.0, -1.0, 0.5], dtype=np.float32)
        result = normalize_audio(audio)
        np.testing.assert_array_almost_equal(result, audio)


class TestEnsureFloat32:
    def test_int16_conversion(self):
        audio = np.array([16384, -16384, 0], dtype=np.int16)
        result = ensure_float32(audio)
        assert result.dtype == np.float32
        assert abs(result[0] - 0.5) < 0.01

    def test_float32_passthrough(self):
        audio = np.array([0.5, -0.5], dtype=np.float32)
        result = ensure_float32(audio)
        assert result.dtype == np.float32
        np.testing.assert_array_equal(result, audio)

    def test_float64_conversion(self):
        audio = np.array([0.5, -0.5], dtype=np.float64)
        result = ensure_float32(audio)
        assert result.dtype == np.float32


class TestEnsureMono:
    def test_stereo_to_mono(self):
        stereo = np.array([[0.5, 0.3], [-0.5, -0.3]], dtype=np.float32)
        mono = ensure_mono(stereo)
        assert mono.ndim == 1
        assert len(mono) == 2
        assert abs(mono[0] - 0.4) < 0.01

    def test_mono_passthrough(self):
        mono = np.array([0.5, -0.5], dtype=np.float32)
        result = ensure_mono(mono)
        assert result.ndim == 1
        np.testing.assert_array_equal(result, mono)


class TestResample:
    def test_same_rate(self):
        audio = np.array([1, 2, 3, 4], dtype=np.float32)
        result = resample(audio, 16000, 16000)
        np.testing.assert_array_equal(result, audio)

    def test_upsample(self):
        audio = np.ones(16000, dtype=np.float32)
        result = resample(audio, 16000, 22050)
        assert len(result) == 22050

    def test_downsample(self):
        audio = np.ones(48000, dtype=np.float32)
        result = resample(audio, 48000, 16000)
        assert len(result) == 16000


class TestPrepareForWhisper:
    def test_output_format(self, sample_audio_1s):
        result = prepare_for_whisper(sample_audio_1s, 16000)
        assert result.dtype == np.float32
        assert result.ndim == 1
        assert len(result) == 16000

    def test_from_int16(self):
        audio = np.random.randint(-32768, 32767, 16000, dtype=np.int16)
        result = prepare_for_whisper(audio, 16000)
        assert result.dtype == np.float32
        assert np.abs(result).max() <= 1.0


class TestRMS:
    def test_silence_rms_zero(self):
        silence = np.zeros(1000, dtype=np.float32)
        assert calculate_rms(silence) == 0.0

    def test_sine_rms(self):
        t = np.linspace(0, 1, 16000, dtype=np.float32)
        sine = np.sin(2 * np.pi * 440 * t)
        rms = calculate_rms(sine)
        assert 0.5 < rms < 0.8  # RMS of sine ~ 0.707


class TestTrimSilence:
    def test_trim_leading_silence(self):
        silence = np.zeros(8000, dtype=np.float32)
        speech = np.random.randn(8000).astype(np.float32) * 0.5
        audio = np.concatenate([silence, speech])
        trimmed = trim_silence(audio)
        assert len(trimmed) < len(audio)

    def test_all_silence(self):
        silence = np.zeros(16000, dtype=np.float32)
        trimmed = trim_silence(silence)
        assert len(trimmed) > 0  # Should return something
