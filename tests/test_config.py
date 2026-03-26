"""Tests for configuration loader."""

import pytest
import os
from src.core.config_loader import load_config


class TestConfigLoader:
    def test_load_config(self, config_path):
        config = load_config(config_path)
        assert config.system.name == "BhashaSakha"
        assert config.system.version == "1.0.0"

    def test_audio_config(self, config_path):
        config = load_config(config_path)
        assert config.audio.sample_rate == 16000
        assert config.audio.channels == 1
        assert config.audio.buffer_duration_sec == 30

    def test_frame_samples(self, config_path):
        config = load_config(config_path)
        # 30ms at 16kHz = 480 samples
        assert config.audio.frame_samples == 480

    def test_buffer_samples(self, config_path):
        config = load_config(config_path)
        # 30s at 16kHz = 480000 samples
        assert config.audio.buffer_samples == 480000

    def test_vad_config(self, config_path):
        config = load_config(config_path)
        assert config.vad.threshold == 0.5
        assert config.vad.silence_endpoint_ms == 600
        assert config.vad.min_speech_ms == 500

    def test_stt_config(self, config_path):
        config = load_config(config_path)
        assert config.stt.compute_type == "int8"
        assert config.stt.beam_size == 3

    def test_translation_languages(self, config_path):
        config = load_config(config_path)
        langs = config.translation.supported_languages
        assert len(langs) == 3
        codes = [l.code for l in langs]
        assert "hin_Deva" in codes
        assert "mar_Deva" in codes
        assert "eng_Latn" in codes

    def test_tts_voices(self, config_path):
        config = load_config(config_path)
        assert "hi" in config.tts.voices
        assert "en" in config.tts.voices

    def test_proximity_config(self, config_path):
        config = load_config(config_path)
        assert config.proximity.activation_cm == 100
        assert config.proximity.deactivation_cm == 200

    def test_performance_config(self, config_path):
        config = load_config(config_path)
        assert config.performance.omp_num_threads == 2

    def test_resolve_path(self, config_path):
        config = load_config(config_path)
        resolved = config.resolve_path("models/vad/silero_vad.onnx")
        assert os.path.isabs(resolved)
        assert resolved.endswith("models/vad/silero_vad.onnx")

    def test_missing_config_raises(self):
        with pytest.raises(FileNotFoundError):
            load_config("/nonexistent/config.yaml")
