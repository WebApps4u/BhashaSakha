"""Pipeline profiler for BhashaSakha.

Provides per-stage timing, percentile analysis, and
thermal-aware performance tracking for RPi5 optimization.
"""

import time
import logging
import statistics
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from collections import defaultdict

logger = logging.getLogger(__name__)


@dataclass
class StageMetrics:
    """Timing metrics for a single pipeline stage."""
    name: str
    times_ms: List[float] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.times_ms)

    @property
    def mean_ms(self) -> float:
        return statistics.mean(self.times_ms) if self.times_ms else 0

    @property
    def p50_ms(self) -> float:
        return statistics.median(self.times_ms) if self.times_ms else 0

    @property
    def p90_ms(self) -> float:
        if len(self.times_ms) < 2:
            return self.mean_ms
        sorted_t = sorted(self.times_ms)
        idx = int(len(sorted_t) * 0.9)
        return sorted_t[min(idx, len(sorted_t) - 1)]

    @property
    def p99_ms(self) -> float:
        if len(self.times_ms) < 2:
            return self.mean_ms
        sorted_t = sorted(self.times_ms)
        idx = int(len(sorted_t) * 0.99)
        return sorted_t[min(idx, len(sorted_t) - 1)]

    @property
    def min_ms(self) -> float:
        return min(self.times_ms) if self.times_ms else 0

    @property
    def max_ms(self) -> float:
        return max(self.times_ms) if self.times_ms else 0

    def summary(self) -> str:
        if not self.times_ms:
            return f"{self.name}: no data"
        return (
            f"{self.name}: "
            f"n={self.count} "
            f"mean={self.mean_ms:.0f}ms "
            f"p50={self.p50_ms:.0f}ms "
            f"p90={self.p90_ms:.0f}ms "
            f"p99={self.p99_ms:.0f}ms "
            f"min={self.min_ms:.0f}ms "
            f"max={self.max_ms:.0f}ms"
        )


class PipelineProfiler:
    """Profiles BhashaSakha pipeline stages.

    Usage:
        profiler = PipelineProfiler()

        with profiler.stage("stt"):
            result = whisper.transcribe(audio)

        with profiler.stage("translation"):
            translated = nllb.translate(text, src, tgt)

        profiler.print_summary()
    """

    def __init__(self, max_history: int = 1000):
        """
        Args:
            max_history: Max number of timings to keep per stage
        """
        self._stages: Dict[str, StageMetrics] = {}
        self._max_history = max_history
        self._pipeline_times: List[float] = []
        self._current_pipeline_start: Optional[float] = None
        self._utterance_count: int = 0

    def stage(self, name: str):
        """Context manager for timing a pipeline stage.

        Usage:
            with profiler.stage("stt"):
                result = engine.transcribe(audio)
        """
        return _StageTimer(self, name)

    def record_stage(self, name: str, elapsed_ms: float):
        """Record a stage timing directly."""
        if name not in self._stages:
            self._stages[name] = StageMetrics(name=name)

        metrics = self._stages[name]
        metrics.times_ms.append(elapsed_ms)

        # Cap history
        if len(metrics.times_ms) > self._max_history:
            metrics.times_ms = metrics.times_ms[-self._max_history:]

    def start_pipeline(self):
        """Mark the start of a full pipeline execution."""
        self._current_pipeline_start = time.monotonic()

    def end_pipeline(self):
        """Mark the end of a full pipeline execution."""
        if self._current_pipeline_start:
            elapsed = (time.monotonic() - self._current_pipeline_start) * 1000
            self._pipeline_times.append(elapsed)
            self._utterance_count += 1

            if len(self._pipeline_times) > self._max_history:
                self._pipeline_times = self._pipeline_times[-self._max_history:]

            self._current_pipeline_start = None
            return elapsed
        return 0

    def get_stage_metrics(self, name: str) -> Optional[StageMetrics]:
        return self._stages.get(name)

    def get_pipeline_metrics(self) -> StageMetrics:
        m = StageMetrics(name="total_pipeline")
        m.times_ms = self._pipeline_times.copy()
        return m

    def print_summary(self):
        """Print a detailed performance summary."""
        print("\n" + "=" * 70)
        print("BhashaSakha Pipeline Performance Summary")
        print("=" * 70)
        print(f"Total utterances processed: {self._utterance_count}")
        print()

        # Per-stage breakdown
        print("Per-Stage Breakdown:")
        print("-" * 70)

        stage_order = ["vad", "preprocessing", "stt", "glossary_stt",
                       "language_route", "translation", "glossary_post",
                       "tts", "playback"]

        for name in stage_order:
            if name in self._stages:
                print(f"  {self._stages[name].summary()}")

        # Any remaining stages not in the predefined order
        for name, metrics in self._stages.items():
            if name not in stage_order:
                print(f"  {metrics.summary()}")

        # Total pipeline
        print()
        print("End-to-End Pipeline:")
        print("-" * 70)
        pipeline = self.get_pipeline_metrics()
        if pipeline.times_ms:
            print(f"  {pipeline.summary()}")

            # Latency budget analysis
            print()
            print("Latency Budget Analysis:")
            print("-" * 70)
            total_mean = pipeline.mean_ms
            for name in stage_order:
                if name in self._stages:
                    stage_mean = self._stages[name].mean_ms
                    pct = (stage_mean / total_mean * 100) if total_mean > 0 else 0
                    bar = "█" * int(pct / 2)
                    print(f"  {name:20s} {stage_mean:8.0f}ms ({pct:5.1f}%) {bar}")

        print("=" * 70)

    def to_dict(self) -> dict:
        """Export metrics as dictionary for logging/serialization."""
        result = {
            "utterance_count": self._utterance_count,
            "stages": {},
            "pipeline": {},
        }

        for name, metrics in self._stages.items():
            result["stages"][name] = {
                "count": metrics.count,
                "mean_ms": round(metrics.mean_ms, 1),
                "p50_ms": round(metrics.p50_ms, 1),
                "p90_ms": round(metrics.p90_ms, 1),
                "p99_ms": round(metrics.p99_ms, 1),
            }

        pipeline = self.get_pipeline_metrics()
        if pipeline.times_ms:
            result["pipeline"] = {
                "count": pipeline.count,
                "mean_ms": round(pipeline.mean_ms, 1),
                "p50_ms": round(pipeline.p50_ms, 1),
                "p90_ms": round(pipeline.p90_ms, 1),
            }

        return result

    def reset(self):
        """Reset all metrics."""
        self._stages.clear()
        self._pipeline_times.clear()
        self._utterance_count = 0


class _StageTimer:
    """Context manager for timing a pipeline stage."""

    def __init__(self, profiler: PipelineProfiler, name: str):
        self._profiler = profiler
        self._name = name
        self._start = 0

    def __enter__(self):
        self._start = time.monotonic()
        return self

    def __exit__(self, *args):
        elapsed_ms = (time.monotonic() - self._start) * 1000
        self._profiler.record_stage(self._name, elapsed_ms)


# Global profiler instance
_global_profiler = PipelineProfiler()


def get_profiler() -> PipelineProfiler:
    """Get the global profiler instance."""
    return _global_profiler
