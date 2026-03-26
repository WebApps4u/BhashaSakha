"""Tests for health monitor."""

import pytest
from src.utils.health import HealthMonitor


class TestHealthMonitor:
    def test_create_monitor(self):
        hm = HealthMonitor()
        assert hm.cpu_temp == 0.0

    def test_get_memory_info(self):
        hm = HealthMonitor()
        used_mb, percent = hm.get_memory_info()
        assert used_mb > 0
        assert 0 < percent < 100

    def test_get_disk_usage(self):
        hm = HealthMonitor()
        usage = hm.get_disk_usage()
        assert 0 < usage < 100

    def test_check_health_returns_dict(self):
        hm = HealthMonitor()
        result = hm.check_health()
        assert "cpu_temp_c" in result
        assert "ram_used_mb" in result
        assert "ram_percent" in result
        assert "disk_percent" in result
        assert "uptime_hours" in result

    def test_should_throttle_cold(self):
        hm = HealthMonitor()
        hm.cpu_temp = 50.0
        assert hm.should_throttle() is False

    def test_should_throttle_hot(self):
        hm = HealthMonitor()
        hm.cpu_temp = 78.0
        assert hm.should_throttle() is True

    def test_should_emergency_throttle(self):
        hm = HealthMonitor(max_temp_c=80)
        hm.cpu_temp = 82.0
        assert hm.should_emergency_throttle() is True

    def test_start_stop_monitoring(self):
        hm = HealthMonitor(check_interval=1)
        hm.start_monitoring()
        assert hm._running is True
        hm.stop_monitoring()
        assert hm._running is False


class TestLatencyTracker:
    def test_track_stages(self):
        from src.utils.logger import LatencyTracker
        tracker = LatencyTracker("test")
        tracker.start("stage1")
        import time
        time.sleep(0.01)
        elapsed = tracker.stop("stage1")
        assert elapsed >= 10  # At least 10ms

    def test_total_time(self):
        from src.utils.logger import LatencyTracker
        tracker = LatencyTracker("test")
        tracker.start_total()
        import time
        time.sleep(0.05)
        total = tracker.get_total_ms()
        assert total >= 50

    def test_reset(self):
        from src.utils.logger import LatencyTracker
        tracker = LatencyTracker("test")
        tracker.start("x")
        tracker.stop("x")
        tracker.reset()
        assert len(tracker._stages) == 0
