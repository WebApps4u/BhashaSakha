"""Silero VAD wrapper for BhashaSakha.

Voice Activity Detection using Silero VAD v5 (ONNX format).
Processes 30ms audio frames in <1ms on RPi5 ARM64.
No PyTorch dependency — pure ONNX Runtime inference.
"""

import numpy as np
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import onnxruntime as ort
except ImportError:
    ort = None
    logger.warning("onnxruntime not available — VAD disabled")


class SileroVAD:
    """Silero Voice Activity Detection using ONNX Runtime.

    Optimized for RPi5:
    - Uses ONNX Runtime (no PyTorch needed)
    - Processes 30ms chunks in <1ms
    - ~10MB RAM footprint
    - Maintains internal state across frames

    Supports Silero VAD v5 ONNX format:
    - Inputs:  input(1,N), state(2,1,128), sr(int64)
    - Outputs: output(1,1), stateN(2,1,128)
    """

    # Silero VAD expects 16kHz audio
    SAMPLE_RATE = 16000

    def __init__(self, model_path: str, threshold: float = 0.5):
        """
        Args:
            model_path: Path to silero_vad.onnx
            threshold: Speech probability threshold (0.0-1.0)
        """
        self.threshold = threshold
        self._session: Optional[ort.InferenceSession] = None

        # Internal state tensor for Silero VAD v5
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._sr = np.array(self.SAMPLE_RATE, dtype=np.int64)

        # Load model
        self._load_model(model_path)

    def _load_model(self, model_path: str):
        """Load ONNX model with optimized session options for RPi5."""
        if ort is None:
            logger.error("onnxruntime not available")
            return

        if not os.path.exists(model_path):
            logger.error(f"VAD model not found: {model_path}")
            return

        # Optimize for single-threaded inference (VAD is tiny)
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.log_severity_level = 3  # Suppress ONNX warnings

        self._session = ort.InferenceSession(
            model_path,
            sess_options=opts,
            providers=["CPUExecutionProvider"],
        )

        logger.info(f"Silero VAD loaded: {model_path} (threshold={self.threshold})")

    def process_frame(self, audio: np.ndarray) -> float:
        """Process a single audio frame and return speech probability.

        Args:
            audio: Float32 audio samples (30ms at 16kHz = 480 samples)

        Returns:
            Speech probability (0.0 - 1.0)
        """
        if self._session is None:
            return 0.0

        # Ensure correct shape: (1, num_samples)
        if audio.ndim == 1:
            audio = audio[np.newaxis, :]

        audio = audio.astype(np.float32)

        # Run inference with Silero VAD v5 interface
        try:
            ort_inputs = {
                "input": audio,
                "state": self._state,
                "sr": self._sr,
            }

            output, new_state = self._session.run(None, ort_inputs)

            # Update internal state for next frame
            self._state = new_state

            # output shape: (1, 1) — speech probability
            probability = float(output[0][0])
            return probability

        except Exception as e:
            logger.error(f"VAD inference error: {e}")
            return 0.0

    def is_speech(self, audio: np.ndarray) -> bool:
        """Check if audio frame contains speech.

        Args:
            audio: Float32 audio samples

        Returns:
            True if speech probability exceeds threshold
        """
        prob = self.process_frame(audio)
        return prob > self.threshold

    def reset(self):
        """Reset internal state.

        Call this at the start of each new session/conversation.
        """
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        logger.debug("VAD state reset")

    @property
    def is_loaded(self) -> bool:
        return self._session is not None
