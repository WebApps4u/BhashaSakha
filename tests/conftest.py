"""Shared test fixtures for BhashaSakha test suite."""

import os
import sys
import pytest
import numpy as np

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def sample_audio_1s():
    """1 second of random audio at 16kHz (simulates speech)."""
    np.random.seed(42)
    return np.random.randn(16000).astype(np.float32) * 0.1


@pytest.fixture
def sample_audio_3s():
    """3 seconds of random audio at 16kHz."""
    np.random.seed(42)
    return np.random.randn(48000).astype(np.float32) * 0.1


@pytest.fixture
def silence_audio():
    """3 seconds of silence."""
    return np.zeros(48000, dtype=np.float32)


@pytest.fixture
def speech_like_audio():
    """3 seconds of sine wave (440Hz) simulating voiced speech."""
    t = np.linspace(0, 3, 48000, dtype=np.float32)
    return 0.5 * np.sin(2 * np.pi * 440 * t)


@pytest.fixture
def config_path():
    """Path to test configuration file."""
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "config", "config.yaml"
    )


@pytest.fixture
def glossary_path():
    """Path to banking glossary file."""
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "config", "banking_glossary.yaml"
    )
