"""System health monitor for BhashaSakha.

Monitors CPU temperature, RAM usage, and disk space on Raspberry Pi 5.
Provides thermal throttling decisions and alerts.
"""

import os
import logging
import psutil
import time
import threading
from typing import Optional, Callable

logger = logging.getLogger(__name__)


class HealthMonitor:
    """Background health monitor for RPi5.

    Reads CPU temperature from sysfs thermal zone.
    Monitors RAM and disk usage via psutil.
    Runs in a background thread with configurable interval.
    """

    # RPi5 thermal zone path
    THERMAL_PATH = "/sys/class/thermal/thermal_zone0/temp"

    def __init__(self, check_interval: int = 30, max_temp_c: int = 80,
                 max_memory_pct: int = 85, on_alert: Optional[Callable] = None):
        """
        Args:
            check_interval: Seconds between health checks
            max_temp_c: CPU temperature alert threshold
            max_memory_pct: RAM usage alert threshold (percent)
            on_alert: Callback function(alert_type: str, message: str)
        """
        self._interval = check_interval
        self._max_temp = max_temp_c
        self._max_mem_pct = max_memory_pct
        self._on_alert = on_alert
        self._running = False
        self._thread: Optional[threading.Thread] = None

        # Current readings
        self.cpu_temp: float = 0.0
        self.ram_used_mb: float = 0.0
        self.ram_percent: float = 0.0
        self.disk_percent: float = 0.0
        self.uptime_seconds: float = 0.0
        self._start_time = time.monotonic()

    def get_cpu_temperature(self) -> float:
        """Read CPU temperature from sysfs (Raspberry Pi).

        Returns:
            Temperature in Celsius, or -1 if unavailable.
        """
        try:
            if os.path.exists(self.THERMAL_PATH):
                with open(self.THERMAL_PATH, "r") as f:
                    # Value is in millidegrees: 52000 = 52.0°C
                    return int(f.read().strip()) / 1000.0
        except (IOError, ValueError):
            pass

        # Fallback: try psutil
        try:
            temps = psutil.sensors_temperatures()
            if temps:
                for name, entries in temps.items():
                    if entries:
                        return entries[0].current
        except (AttributeError, KeyError):
            pass

        return -1.0

    def get_memory_info(self) -> tuple:
        """Get RAM usage.

        Returns:
            (used_mb, percent)
        """
        mem = psutil.virtual_memory()
        used_mb = mem.used / (1024 * 1024)
        return used_mb, mem.percent

    def get_disk_usage(self) -> float:
        """Get root filesystem usage percent."""
        try:
            disk = psutil.disk_usage("/")
            return disk.percent
        except OSError:
            return 0.0

    def check_health(self) -> dict:
        """Perform a single health check.

        Returns:
            Dict with all health metrics
        """
        self.cpu_temp = self.get_cpu_temperature()
        self.ram_used_mb, self.ram_percent = self.get_memory_info()
        self.disk_percent = self.get_disk_usage()
        self.uptime_seconds = time.monotonic() - self._start_time

        result = {
            "cpu_temp_c": self.cpu_temp,
            "ram_used_mb": round(self.ram_used_mb, 1),
            "ram_percent": round(self.ram_percent, 1),
            "disk_percent": round(self.disk_percent, 1),
            "uptime_hours": round(self.uptime_seconds / 3600, 2),
        }

        # Check thresholds
        alerts = []
        if self.cpu_temp > self._max_temp:
            alerts.append(f"CPU temp {self.cpu_temp:.1f}°C exceeds {self._max_temp}°C")
        if self.ram_percent > self._max_mem_pct:
            alerts.append(f"RAM {self.ram_percent:.1f}% exceeds {self._max_mem_pct}%")
        if self.disk_percent > 90:
            alerts.append(f"Disk {self.disk_percent:.1f}% nearly full")

        if alerts:
            for alert in alerts:
                logger.warning(f"HEALTH ALERT: {alert}")
                if self._on_alert:
                    self._on_alert("health", alert)

        return result

    def should_throttle(self) -> bool:
        """Check if pipeline should be throttled due to thermal pressure.

        Returns:
            True if CPU temperature is in the danger zone (>75°C)
        """
        return self.cpu_temp > 75

    def should_emergency_throttle(self) -> bool:
        """Check if system should enter minimal mode.

        Returns:
            True if CPU temperature is critical (>80°C)
        """
        return self.cpu_temp > self._max_temp

    def start_monitoring(self):
        """Start background health monitoring thread."""
        if self._running:
            return

        self._running = True
        self._thread = threading.Thread(
            target=self._monitor_loop,
            name="health-monitor",
            daemon=True,
        )
        self._thread.start()
        logger.info(f"Health monitor started (interval={self._interval}s)")

    def stop_monitoring(self):
        """Stop background monitoring."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None

    def _monitor_loop(self):
        """Background monitoring loop."""
        while self._running:
            try:
                result = self.check_health()
                logger.debug(
                    f"Health: temp={result['cpu_temp_c']:.1f}°C "
                    f"ram={result['ram_used_mb']:.0f}MB({result['ram_percent']:.0f}%) "
                    f"disk={result['disk_percent']:.0f}% "
                    f"uptime={result['uptime_hours']:.1f}h"
                )
            except Exception as e:
                logger.error(f"Health check error: {e}")

            # Sleep in small increments for responsive shutdown
            for _ in range(self._interval * 2):
                if not self._running:
                    break
                time.sleep(0.5)

    def log_startup_info(self):
        """Log system information at startup."""
        import platform

        cpu_count = os.cpu_count() or 0
        mem = psutil.virtual_memory()
        total_ram_gb = mem.total / (1024 ** 3)

        logger.info("=" * 60)
        logger.info(f"System: {platform.machine()} | "
                     f"CPUs: {cpu_count} | "
                     f"RAM: {total_ram_gb:.1f}GB | "
                     f"Python: {platform.python_version()}")
        logger.info(f"CPU Temp: {self.get_cpu_temperature():.1f}°C")
        logger.info("=" * 60)
