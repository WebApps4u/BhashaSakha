"""System state machine for BhashaSakha.

Manages 6 states: BOOT, STANDBY, LISTENING, PROCESSING, SPEAKING, ERROR.
Thread-safe state transitions with observer pattern for notifications.
"""

import enum
import threading
import time
import logging
from typing import Callable, List, Optional

logger = logging.getLogger(__name__)


class SystemState(enum.Enum):
    """All possible system states."""
    BOOT = "boot"
    STANDBY = "standby"
    LISTENING = "listening"
    PROCESSING = "processing"
    SPEAKING = "speaking"
    ERROR = "error"


# Valid state transitions
_VALID_TRANSITIONS = {
    SystemState.BOOT: {SystemState.STANDBY, SystemState.ERROR},
    SystemState.STANDBY: {SystemState.LISTENING, SystemState.STANDBY},
    SystemState.LISTENING: {
        SystemState.PROCESSING,
        SystemState.SPEAKING,
        SystemState.STANDBY,
        SystemState.ERROR,
    },
    SystemState.PROCESSING: {
        SystemState.SPEAKING,
        SystemState.LISTENING,
        SystemState.ERROR,
        SystemState.STANDBY,
    },
    SystemState.SPEAKING: {
        SystemState.LISTENING,
        SystemState.STANDBY,
        SystemState.ERROR,
    },
    SystemState.ERROR: {
        SystemState.STANDBY,
        SystemState.BOOT,
    },
}


class StateMachine:
    """Thread-safe finite state machine.

    Enforces valid transitions and notifies observers on state change.
    Designed for the 5-thread architecture of BhashaSakha.
    """

    def __init__(self):
        self._state = SystemState.BOOT
        self._lock = threading.RLock()
        self._observers: List[Callable[[SystemState, SystemState], None]] = []
        self._state_event = threading.Event()
        self._last_transition_time = time.monotonic()
        self._error_message: Optional[str] = None

    @property
    def state(self) -> SystemState:
        """Current system state (thread-safe read)."""
        with self._lock:
            return self._state

    @property
    def error_message(self) -> Optional[str]:
        """Last error message if in ERROR state."""
        with self._lock:
            return self._error_message

    @property
    def time_in_state(self) -> float:
        """Seconds spent in current state."""
        return time.monotonic() - self._last_transition_time

    def add_observer(self, callback: Callable[[SystemState, SystemState], None]):
        """Register a state change observer.

        Args:
            callback: Function(old_state, new_state) called on transition.
        """
        with self._lock:
            self._observers.append(callback)

    def transition(self, new_state: SystemState, error_msg: Optional[str] = None) -> bool:
        """Attempt a state transition.

        Args:
            new_state: Target state
            error_msg: Error message (only for ERROR transitions)

        Returns:
            True if transition succeeded, False if invalid
        """
        with self._lock:
            old_state = self._state

            if new_state not in _VALID_TRANSITIONS.get(old_state, set()):
                logger.warning(
                    f"Invalid state transition: {old_state.value} → {new_state.value}"
                )
                return False

            self._state = new_state
            self._last_transition_time = time.monotonic()

            if new_state == SystemState.ERROR:
                self._error_message = error_msg
            else:
                self._error_message = None

            logger.info(f"State: {old_state.value} → {new_state.value}")

            # Notify observers (outside lock would be better but kept simple)
            for observer in self._observers:
                try:
                    observer(old_state, new_state)
                except Exception as e:
                    logger.error(f"Observer error during transition: {e}")

            # Signal any threads waiting on state changes
            self._state_event.set()
            self._state_event.clear()

            return True

    def wait_for_state(self, target: SystemState, timeout: float = None) -> bool:
        """Block until system reaches target state.

        Args:
            target: State to wait for
            timeout: Max seconds to wait (None = forever)

        Returns:
            True if target state reached, False if timeout
        """
        deadline = time.monotonic() + timeout if timeout else None

        while True:
            if self.state == target:
                return True

            remaining = None
            if deadline:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False

            self._state_event.wait(timeout=min(remaining or 0.5, 0.5))

    def is_active(self) -> bool:
        """Check if system is in an active processing state."""
        return self.state in {
            SystemState.LISTENING,
            SystemState.PROCESSING,
            SystemState.SPEAKING,
        }

    def is_ready(self) -> bool:
        """Check if system is ready to receive input."""
        return self.state == SystemState.LISTENING
