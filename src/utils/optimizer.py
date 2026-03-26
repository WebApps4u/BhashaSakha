"""Model warmup and optimization utilities for BhashaSakha.

Pre-warms all ML models during BOOT phase to eliminate
cold-start latency on the first real utterance.
"""

import time
import logging
import gc
import os
import numpy as np
from typing import Optional

logger = logging.getLogger(__name__)


def set_cpu_affinity():
    """Set CPU thread limits for RPi5 optimization.

    Enforces OMP_NUM_THREADS=2 to prevent any single model
    from saturating all 4 ARM Cortex-A76 cores.
    """
    os.environ["OMP_NUM_THREADS"] = "2"
    os.environ["OPENBLAS_NUM_THREADS"] = "2"
    os.environ["MKL_NUM_THREADS"] = "2"
    os.environ["ONNXRUNTIME_GLOBAL_THREAD_POOL_SIZE"] = "2"

    logger.info("CPU thread limits set: OMP=2, OPENBLAS=2")


def warmup_all_models(whisper, translator, vad=None, tts=None):
    """Warm up all ML models with dummy inference.

    First inference on ARM is ~2x slower due to JIT compilation
    and cache cold-start. This eliminates that penalty before
    the first real user interaction.

    Args:
        whisper: WhisperEngine instance
        translator: NLLBEngine instance
        vad: Optional SileroVAD instance
        tts: Optional PiperEngine instance
    """
    total_start = time.monotonic()

    # 1. VAD warmup — very fast
    if vad and vad.is_loaded:
        logger.info("Warming up VAD...")
        dummy = np.zeros(480, dtype=np.float32)
        for _ in range(5):
            vad.process_frame(dummy)
        vad.reset()
        logger.info("VAD warmup complete")

    # 2. Whisper warmup — generates JIT cache
    if whisper and whisper.is_loaded:
        logger.info("Warming up Whisper...")
        whisper.warmup()

    # 3. NLLB warmup — generates CT2 cache
    if translator and translator.is_loaded:
        logger.info("Warming up NLLB...")
        translator.warmup()

    # 4. TTS warmup
    if tts:
        logger.info("Warming up TTS...")
        try:
            tts.warmup()
        except Exception as e:
            logger.warning(f"TTS warmup skipped: {e}")

    # 5. Force GC after warmup to reclaim temp allocations
    gc.collect()

    total_ms = (time.monotonic() - total_start) * 1000
    logger.info(f"All models warmed up in {total_ms:.0f}ms")


def optimize_memory():
    """Perform memory optimization during idle periods.

    Call during STANDBY when no session is active.
    Collects garbage and trims process memory.
    """
    before = _get_rss_mb()
    gc.collect()
    gc.collect()  # Second pass for cyclic refs
    after = _get_rss_mb()

    freed = before - after
    if freed > 1:
        logger.info(f"Memory optimized: freed {freed:.0f}MB (now {after:.0f}MB)")


def _get_rss_mb() -> float:
    """Get current process RSS in megabytes."""
    try:
        import psutil
        process = psutil.Process()
        return process.memory_info().rss / (1024 * 1024)
    except Exception:
        return 0.0


def get_system_info() -> dict:
    """Collect system information for diagnostics."""
    info = {
        "python": "",
        "platform": "",
        "cpu_count": os.cpu_count(),
        "rss_mb": round(_get_rss_mb(), 1),
    }

    try:
        import sys
        info["python"] = sys.version.split()[0]
    except Exception:
        pass

    try:
        import platform
        info["platform"] = platform.machine()
    except Exception:
        pass

    try:
        import ctranslate2
        info["ctranslate2"] = ctranslate2.__version__
    except Exception:
        pass

    try:
        import onnxruntime
        info["onnxruntime"] = onnxruntime.__version__
    except Exception:
        pass

    return info
