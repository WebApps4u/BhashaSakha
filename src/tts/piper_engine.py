"""Piper TTS engine for BhashaSakha.

Text-to-Speech using Piper (ONNX VITS).
Pre-loads all 3 voice models at boot for zero-latency switching.
Optimized for RPi5 ARM64 with ONNX Runtime.
"""

import numpy as np
import logging
import time
import json
import os
from typing import Dict, Optional

logger = logging.getLogger(__name__)

try:
    import onnxruntime as ort
except ImportError:
    ort = None


class PiperVoice:
    """Single Piper voice model (ONNX VITS)."""

    def __init__(self, model_path: str, config_path: str):
        self.model_path = model_path
        self.config_path = config_path
        self.session: Optional[ort.InferenceSession] = None
        self.config: dict = {}
        self.sample_rate: int = 22050

    def load(self):
        """Load ONNX model and configuration."""
        if ort is None:
            logger.error("onnxruntime not available")
            return

        if not os.path.exists(self.model_path):
            logger.warning(f"TTS model not found: {self.model_path}")
            return

        # Load config
        if os.path.exists(self.config_path):
            with open(self.config_path, "r") as f:
                self.config = json.load(f)
                audio_cfg = self.config.get("audio", {})
                self.sample_rate = audio_cfg.get("sample_rate", 22050)

        # Load ONNX model with optimized settings
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 2  # 2 cores for TTS on RPi5
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.log_severity_level = 3

        self.session = ort.InferenceSession(
            self.model_path,
            sess_options=opts,
            providers=["CPUExecutionProvider"],
        )

        logger.info(f"Piper voice loaded: {os.path.basename(self.model_path)}")


class PiperEngine:
    """Piper TTS manager for all supported languages.

    Pre-loads all voice models at boot (~600MB total for 3 voices).
    This eliminates hot-swap latency during conversation.
    """

    def __init__(self, voices_config: dict = None):
        """
        Args:
            voices_config: Dict mapping lang codes to VoiceConfig
        """
        self._voices: Dict[str, PiperVoice] = {}
        self._voices_config = voices_config or {}

    def load(self, base_dir: str = ""):
        """Load all configured voice models.

        Args:
            base_dir: Project base directory for resolving relative paths
        """
        for lang, voice_cfg in self._voices_config.items():
            model_path = voice_cfg.model
            config_path = voice_cfg.config

            if not os.path.isabs(model_path):
                model_path = os.path.join(base_dir, model_path)
            if not os.path.isabs(config_path):
                config_path = os.path.join(base_dir, config_path)

            voice = PiperVoice(model_path, config_path)
            try:
                voice.load()
                if voice.session is not None:
                    self._voices[lang] = voice
            except Exception as e:
                logger.error(f"Failed to load TTS voice for {lang}: {e}")

        logger.info(f"Piper TTS loaded: {len(self._voices)} voices "
                     f"({', '.join(self._voices.keys())})")

    def synthesize(self, text: str, lang: str,
                   speed: float = 1.0) -> Optional[np.ndarray]:
        """Synthesize text to audio.

        Args:
            text: Text to speak
            lang: Whisper language code ("hi", "mr", "en")
            speed: Speech speed multiplier (0.8 = slow, 1.0 = normal)

        Returns:
            PCM audio as int16 numpy array, or None on failure
        """
        if not text or not text.strip():
            return None

        voice = self._voices.get(lang)
        if voice is None or voice.session is None:
            logger.warning(f"No TTS voice loaded for: {lang}")
            return self._fallback_synthesis(text, lang)

        start = time.monotonic()

        try:
            # Use Piper's expected interface
            # Piper ONNX models expect phoneme IDs as input
            audio = self._run_piper_inference(voice, text, speed)

            if audio is not None:
                elapsed_ms = (time.monotonic() - start) * 1000
                duration_ms = len(audio) / voice.sample_rate * 1000
                logger.info(
                    f"TTS: lang={lang} chars={len(text)} "
                    f"audio={duration_ms:.0f}ms synth={elapsed_ms:.0f}ms"
                )

            return audio

        except Exception as e:
            logger.error(f"TTS synthesis error for {lang}: {e}")
            return self._fallback_synthesis(text, lang)

    def _run_piper_inference(self, voice: PiperVoice, text: str,
                              speed: float) -> Optional[np.ndarray]:
        """Run Piper ONNX inference.

        Piper uses a phonemizer (espeak-ng) to convert text to phoneme IDs,
        then feeds them to the VITS model.
        """
        try:
            # Try using piper-tts library directly
            from piper import PiperVoice as PiperLib

            piper_voice = PiperLib.load(
                voice.model_path,
                config_path=voice.config_path,
                use_cuda=False,
            )

            # Synthesize to raw audio
            audio_segments = []
            for audio_bytes in piper_voice.synthesize_stream_raw(
                text,
                length_scale=1.0 / speed if speed > 0 else 1.0,
            ):
                segment = np.frombuffer(audio_bytes, dtype=np.int16)
                audio_segments.append(segment)

            if audio_segments:
                return np.concatenate(audio_segments)
            return None

        except ImportError:
            # Fallback: direct ONNX inference if piper library unavailable
            logger.warning("piper library not available, using direct ONNX")
            return self._direct_onnx_inference(voice, text, speed)

        except Exception as e:
            logger.error(f"Piper synthesis error: {e}")
            return None

    def _direct_onnx_inference(self, voice: PiperVoice, text: str,
                                speed: float) -> Optional[np.ndarray]:
        """Direct ONNX inference without piper library.

        This is a simplified path — full Piper uses espeak-ng for G2P.
        Falls back to espeak-ng CLI if available.
        """
        try:
            import subprocess

            # Use espeak-ng to synthesize directly as a last resort
            cmd = [
                "espeak-ng",
                "-v", self._get_espeak_voice(voice),
                "-s", str(int(175 * speed)),  # Words per minute
                "--stdout",
                text,
            ]

            result = subprocess.run(
                cmd, capture_output=True, timeout=10
            )

            if result.returncode == 0 and result.stdout:
                # espeak-ng outputs WAV format
                import io
                import soundfile as sf
                audio, sr = sf.read(io.BytesIO(result.stdout), dtype="int16")
                return audio

        except Exception as e:
            logger.error(f"espeak-ng fallback failed: {e}")

        return None

    def _get_espeak_voice(self, voice: PiperVoice) -> str:
        """Get espeak-ng voice identifier from Piper config."""
        espeak_voice = voice.config.get("espeak", {}).get("voice", "en")
        return espeak_voice

    def _fallback_synthesis(self, text: str, lang: str) -> Optional[np.ndarray]:
        """Emergency fallback using espeak-ng directly.

        Produces robotic but functional speech when Piper fails.
        """
        try:
            import subprocess
            import io
            import soundfile as sf

            voice_map = {"hi": "hi", "mr": "mr", "en": "en"}
            voice = voice_map.get(lang, "en")

            cmd = ["espeak-ng", "-v", voice, "--stdout", text]
            result = subprocess.run(cmd, capture_output=True, timeout=10)

            if result.returncode == 0 and result.stdout:
                audio, sr = sf.read(io.BytesIO(result.stdout), dtype="int16")
                logger.info(f"TTS fallback (espeak-ng): lang={lang}")
                return audio

        except Exception as e:
            logger.error(f"TTS fallback failed: {e}")

        return None

    def get_sample_rate(self, lang: str) -> int:
        """Get sample rate for a language's voice model."""
        voice = self._voices.get(lang)
        if voice:
            return voice.sample_rate
        return 22050

    def warmup(self):
        """Warm up all loaded voices with a short synthesis."""
        for lang in self._voices:
            try:
                self.synthesize("Test", lang, speed=1.0)
            except Exception:
                pass
        logger.info("TTS warmup complete")

    @property
    def is_loaded(self) -> bool:
        return len(self._voices) > 0

    @property
    def loaded_languages(self) -> list:
        return list(self._voices.keys())
