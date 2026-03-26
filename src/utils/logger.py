"""Structured logger for BhashaSakha.

Privacy-first: NEVER logs transcribed text, translations, or audio data.
Only logs: latency metrics, language codes, error messages, system health.
"""

import logging
import sys
import time
from typing import Optional


def setup_logging(level: str = "INFO", to_file: bool = False,
                  log_path: Optional[str] = None):
    """Configure structured logging for all BhashaSakha components.

    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR)
        to_file: Whether to also log to file
        log_path: Path for log file (only if to_file=True)
    """
    log_level = getattr(logging, level.upper(), logging.INFO)

    # Format: timestamp | level | module | message
    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-7s | %(name)-25s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Console handler (stdout for systemd journal capture)
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    console.setLevel(log_level)

    # Root logger
    root = logging.getLogger()
    root.setLevel(log_level)
    root.handlers.clear()
    root.addHandler(console)

    # File handler (optional)
    if to_file and log_path:
        file_handler = logging.FileHandler(log_path, mode="a", encoding="utf-8")
        file_handler.setFormatter(formatter)
        file_handler.setLevel(log_level)
        root.addHandler(file_handler)

    # Suppress noisy third-party loggers
    logging.getLogger("faster_whisper").setLevel(logging.WARNING)
    logging.getLogger("ctranslate2").setLevel(logging.WARNING)
    logging.getLogger("onnxruntime").setLevel(logging.WARNING)
    logging.getLogger("transformers").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)


class LatencyTracker:
    """Utility for measuring and logging per-stage pipeline latency.

    Usage:
        tracker = LatencyTracker("pipeline")
        tracker.start("stt")
        # ... do STT ...
        tracker.stop("stt")
        tracker.start("translation")
        # ... do translation ...
        tracker.stop("translation")
        tracker.log_summary()
    """

    def __init__(self, name: str = "pipeline"):
        self._name = name
        self._stages: dict = {}
        self._start_times: dict = {}
        self._total_start: Optional[float] = None
        self._logger = logging.getLogger(f"latency.{name}")

    def start_total(self):
        """Mark the start of the entire pipeline."""
        self._total_start = time.monotonic()

    def start(self, stage: str):
        """Mark the start of a pipeline stage."""
        self._start_times[stage] = time.monotonic()

    def stop(self, stage: str) -> float:
        """Mark the end of a pipeline stage.

        Returns:
            Duration in milliseconds
        """
        if stage not in self._start_times:
            return 0.0

        elapsed_ms = (time.monotonic() - self._start_times[stage]) * 1000
        self._stages[stage] = elapsed_ms
        del self._start_times[stage]
        return elapsed_ms

    def get_total_ms(self) -> float:
        """Get total pipeline duration in milliseconds."""
        if self._total_start:
            return (time.monotonic() - self._total_start) * 1000
        return sum(self._stages.values())

    def log_summary(self):
        """Log a latency summary for this pipeline run."""
        parts = []
        for stage, ms in self._stages.items():
            parts.append(f"{stage}={ms:.0f}ms")

        total_ms = self.get_total_ms()
        summary = " | ".join(parts)
        self._logger.info(f"total={total_ms:.0f}ms | {summary}")

    def reset(self):
        """Reset all measurements for next pipeline run."""
        self._stages.clear()
        self._start_times.clear()
        self._total_start = None
