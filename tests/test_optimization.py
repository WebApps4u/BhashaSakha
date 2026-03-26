"""Tests for translation cache and profiler."""

import pytest
import time
import threading
from src.translation.cache import TranslationCache
from src.utils.profiler import PipelineProfiler


class TestTranslationCache:
    def test_put_and_get(self):
        cache = TranslationCache(max_size=10)
        cache.put("hello", "eng_Latn", "hin_Deva", "नमस्ते")
        result = cache.get("hello", "eng_Latn", "hin_Deva")
        assert result == "नमस्ते"

    def test_cache_miss(self):
        cache = TranslationCache(max_size=10)
        result = cache.get("hello", "eng_Latn", "hin_Deva")
        assert result is None

    def test_case_insensitive(self):
        cache = TranslationCache()
        cache.put("Hello World", "eng_Latn", "hin_Deva", "result")
        assert cache.get("hello world", "eng_Latn", "hin_Deva") == "result"
        assert cache.get("HELLO WORLD", "eng_Latn", "hin_Deva") == "result"

    def test_different_directions(self):
        cache = TranslationCache()
        cache.put("hello", "eng_Latn", "hin_Deva", "हैलो")
        cache.put("hello", "eng_Latn", "mar_Deva", "हॅलो")
        assert cache.get("hello", "eng_Latn", "hin_Deva") == "हैलो"
        assert cache.get("hello", "eng_Latn", "mar_Deva") == "हॅलो"

    def test_lru_eviction(self):
        cache = TranslationCache(max_size=3)
        cache.put("a", "en", "hi", "1")
        cache.put("b", "en", "hi", "2")
        cache.put("c", "en", "hi", "3")
        cache.put("d", "en", "hi", "4")  # Evicts "a"
        assert cache.get("a", "en", "hi") is None
        assert cache.get("b", "en", "hi") == "2"
        assert cache.size == 3

    def test_lru_access_refreshes(self):
        cache = TranslationCache(max_size=3)
        cache.put("a", "en", "hi", "1")
        cache.put("b", "en", "hi", "2")
        cache.put("c", "en", "hi", "3")
        cache.get("a", "en", "hi")  # Access refreshes "a"
        cache.put("d", "en", "hi", "4")  # Evicts "b" (oldest untouched)
        assert cache.get("a", "en", "hi") == "1"
        assert cache.get("b", "en", "hi") is None

    def test_hit_rate(self):
        cache = TranslationCache()
        cache.put("x", "en", "hi", "y")
        cache.get("x", "en", "hi")  # Hit
        cache.get("x", "en", "hi")  # Hit
        cache.get("z", "en", "hi")  # Miss
        assert cache.hit_rate == pytest.approx(66.67, abs=0.1)

    def test_clear(self):
        cache = TranslationCache()
        cache.put("x", "en", "hi", "y")
        cache.clear()
        assert cache.size == 0
        assert cache.get("x", "en", "hi") is None

    def test_stats(self):
        cache = TranslationCache(max_size=100)
        cache.put("x", "en", "hi", "y")
        stats = cache.stats
        assert stats["size"] == 1
        assert stats["max_size"] == 100

    def test_thread_safety(self):
        cache = TranslationCache(max_size=50)
        errors = []

        def writer(n):
            for i in range(100):
                try:
                    cache.put(f"key_{n}_{i}", "en", "hi", f"val_{i}")
                except Exception as e:
                    errors.append(str(e))

        def reader(n):
            for i in range(100):
                try:
                    cache.get(f"key_{n}_{i}", "en", "hi")
                except Exception as e:
                    errors.append(str(e))

        threads = [threading.Thread(target=writer, args=(i,)) for i in range(4)]
        threads += [threading.Thread(target=reader, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len(errors) == 0


class TestPipelineProfiler:
    def test_stage_timing(self):
        profiler = PipelineProfiler()
        with profiler.stage("test"):
            time.sleep(0.01)
        metrics = profiler.get_stage_metrics("test")
        assert metrics is not None
        assert metrics.count == 1
        assert metrics.mean_ms >= 10

    def test_multiple_stages(self):
        profiler = PipelineProfiler()
        for _ in range(5):
            with profiler.stage("stt"):
                time.sleep(0.005)
            with profiler.stage("translation"):
                time.sleep(0.003)

        stt = profiler.get_stage_metrics("stt")
        trans = profiler.get_stage_metrics("translation")
        assert stt.count == 5
        assert trans.count == 5
        assert stt.mean_ms > trans.mean_ms

    def test_pipeline_timing(self):
        profiler = PipelineProfiler()
        profiler.start_pipeline()
        time.sleep(0.02)
        elapsed = profiler.end_pipeline()
        assert elapsed >= 20
        pipeline = profiler.get_pipeline_metrics()
        assert pipeline.count == 1

    def test_percentiles(self):
        profiler = PipelineProfiler()
        for i in range(100):
            profiler.record_stage("test", float(i))
        m = profiler.get_stage_metrics("test")
        assert m.p50_ms == pytest.approx(49.5, abs=1)
        assert m.p90_ms >= 89
        assert m.min_ms == 0
        assert m.max_ms == 99

    def test_reset(self):
        profiler = PipelineProfiler()
        profiler.record_stage("stt", 100)
        profiler.reset()
        assert profiler.get_stage_metrics("stt") is None

    def test_to_dict(self):
        profiler = PipelineProfiler()
        profiler.record_stage("stt", 100)
        profiler.record_stage("stt", 200)
        d = profiler.to_dict()
        assert d["stages"]["stt"]["count"] == 2
        assert d["stages"]["stt"]["mean_ms"] == 150.0

    def test_max_history(self):
        profiler = PipelineProfiler(max_history=10)
        for i in range(20):
            profiler.record_stage("test", float(i))
        m = profiler.get_stage_metrics("test")
        assert m.count == 10  # Capped at 10
