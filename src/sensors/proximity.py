"""HC-SR04 Proximity sensor driver for BhashaSakha.

Polls ultrasonic distance sensor to detect user presence.
Implements hysteresis to prevent false activation/deactivation.
Gracefully degrades if sensor is not connected (fail-open).
"""

import time
import threading
import logging
from typing import Optional, Callable

logger = logging.getLogger(__name__)

# Try importing GPIO libraries
try:
    from gpiozero import DistanceSensor
    HAS_GPIO = True
except (ImportError, RuntimeError):
    HAS_GPIO = False
    logger.info("gpiozero not available — proximity sensor disabled (fail-open)")


class ProximitySensor:
    """HC-SR04 ultrasonic proximity sensor driver.

    GPIO wiring (RPi5):
      Pin 2  (5V)   → VCC
      Pin 6  (GND)  → GND
      GPIO 23 (out) → TRIG
      GPIO 24 (in)  → ECHO (via 1kΩ + 2kΩ voltage divider)

    Hysteresis zones:
      < activation_cm:    Activate session
      activation_cm - deactivation_cm: No change (hysteresis band)
      > deactivation_cm:  Start deactivation countdown
    """

    def __init__(self, trigger_pin: int = 23, echo_pin: int = 24,
                 activation_cm: int = 100, deactivation_cm: int = 200,
                 deactivation_delay: int = 30, poll_interval_ms: int = 500,
                 enabled: bool = True):
        self.enabled = enabled and HAS_GPIO
        self.activation_cm = activation_cm
        self.deactivation_cm = deactivation_cm
        self.deactivation_delay = deactivation_delay
        self.poll_interval = poll_interval_ms / 1000.0

        self._sensor: Optional[DistanceSensor] = None
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._on_user_detected: Optional[Callable] = None
        self._on_user_left: Optional[Callable] = None

        # State tracking
        self._user_present = False
        self._deactivation_start: Optional[float] = None
        self._last_distance: float = 999.0

        if self.enabled:
            try:
                self._sensor = DistanceSensor(
                    echo=echo_pin,
                    trigger=trigger_pin,
                    max_distance=4.0,  # 4 meters max range
                    threshold_distance=activation_cm / 100.0,
                )
                logger.info(
                    f"Proximity sensor initialized: TRIG=GPIO{trigger_pin} "
                    f"ECHO=GPIO{echo_pin}"
                )
            except Exception as e:
                logger.warning(f"Failed to initialize proximity sensor: {e}")
                self.enabled = False

    def set_callbacks(self, on_detected: Callable = None,
                      on_left: Callable = None):
        """Set callbacks for user presence changes.

        Args:
            on_detected: Called when user enters activation zone
            on_left: Called when user leaves for > deactivation_delay
        """
        self._on_user_detected = on_detected
        self._on_user_left = on_left

    def get_distance(self) -> float:
        """Get current distance reading in centimeters.

        Returns:
            Distance in cm, or 999.0 if sensor unavailable
        """
        if not self.enabled or self._sensor is None:
            return 0.0  # Fail-open: report user is present

        try:
            distance_m = self._sensor.distance
            distance_cm = distance_m * 100
            self._last_distance = distance_cm
            return distance_cm
        except Exception as e:
            logger.error(f"Distance read error: {e}")
            return 0.0  # Fail-open on error

    @property
    def user_present(self) -> bool:
        """Whether a user is currently detected."""
        if not self.enabled:
            return True  # Fail-open: always assume user present
        return self._user_present

    @property
    def last_distance(self) -> float:
        return self._last_distance

    def start(self):
        """Start proximity polling thread (Thread 2)."""
        if not self.enabled:
            self._user_present = True  # Fail-open
            logger.info("Proximity sensor disabled — assuming user present")
            return

        self._running = True
        self._thread = threading.Thread(
            target=self._poll_loop,
            name="proximity-sensor",
            daemon=True,
        )
        self._thread.start()
        logger.info(f"Proximity polling started (interval={self.poll_interval*1000:.0f}ms)")

    def stop(self):
        """Stop polling thread."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None

        if self._sensor:
            try:
                self._sensor.close()
            except Exception:
                pass

    def _poll_loop(self):
        """Background distance polling with hysteresis logic."""
        while self._running:
            try:
                distance = self.get_distance()
                self._process_distance(distance)
            except Exception as e:
                logger.error(f"Proximity poll error: {e}")

            time.sleep(self.poll_interval)

    def _process_distance(self, distance_cm: float):
        """Apply hysteresis logic to distance readings.

        Activation zone:   < activation_cm → activate immediately
        Hysteresis band:   activation_cm - deactivation_cm → no change
        Deactivation zone: > deactivation_cm → start countdown
        """
        if distance_cm < self.activation_cm:
            # User is close — activate
            if not self._user_present:
                self._user_present = True
                self._deactivation_start = None
                logger.info(f"User detected at {distance_cm:.0f}cm")
                if self._on_user_detected:
                    try:
                        self._on_user_detected()
                    except Exception as e:
                        logger.error(f"User detected callback error: {e}")

        elif distance_cm > self.deactivation_cm:
            # User is far — start deactivation countdown
            if self._user_present:
                if self._deactivation_start is None:
                    self._deactivation_start = time.monotonic()
                    logger.debug(
                        f"User at {distance_cm:.0f}cm — "
                        f"deactivation countdown started"
                    )
                elif time.monotonic() - self._deactivation_start > self.deactivation_delay:
                    # Sustained absence — deactivate
                    self._user_present = False
                    self._deactivation_start = None
                    logger.info(f"User left (>{self.deactivation_delay}s at >{self.deactivation_cm}cm)")
                    if self._on_user_left:
                        try:
                            self._on_user_left()
                        except Exception as e:
                            logger.error(f"User left callback error: {e}")
        else:
            # In hysteresis band — reset deactivation countdown
            self._deactivation_start = None
