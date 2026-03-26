"""Tests for system state machine."""

import pytest
import threading
import time
from src.core.state_machine import StateMachine, SystemState


class TestStateMachine:
    def test_initial_state_is_boot(self):
        sm = StateMachine()
        assert sm.state == SystemState.BOOT

    def test_valid_transition_boot_to_standby(self):
        sm = StateMachine()
        assert sm.transition(SystemState.STANDBY) is True
        assert sm.state == SystemState.STANDBY

    def test_valid_transition_standby_to_listening(self):
        sm = StateMachine()
        sm.transition(SystemState.STANDBY)
        assert sm.transition(SystemState.LISTENING) is True
        assert sm.state == SystemState.LISTENING

    def test_invalid_transition_boot_to_listening(self):
        sm = StateMachine()
        assert sm.transition(SystemState.LISTENING) is False
        assert sm.state == SystemState.BOOT

    def test_invalid_transition_standby_to_speaking(self):
        sm = StateMachine()
        sm.transition(SystemState.STANDBY)
        assert sm.transition(SystemState.SPEAKING) is False
        assert sm.state == SystemState.STANDBY

    def test_full_pipeline_flow(self):
        sm = StateMachine()
        sm.transition(SystemState.STANDBY)
        sm.transition(SystemState.LISTENING)
        sm.transition(SystemState.PROCESSING)
        sm.transition(SystemState.SPEAKING)
        sm.transition(SystemState.LISTENING)
        assert sm.state == SystemState.LISTENING

    def test_error_recovery(self):
        sm = StateMachine()
        sm.transition(SystemState.STANDBY)
        sm.transition(SystemState.LISTENING)
        sm.transition(SystemState.ERROR, error_msg="test error")
        assert sm.state == SystemState.ERROR
        assert sm.error_message == "test error"
        sm.transition(SystemState.STANDBY)
        assert sm.state == SystemState.STANDBY
        assert sm.error_message is None

    def test_observer_notification(self):
        sm = StateMachine()
        transitions = []

        def observer(old, new):
            transitions.append((old, new))

        sm.add_observer(observer)
        sm.transition(SystemState.STANDBY)
        sm.transition(SystemState.LISTENING)

        assert len(transitions) == 2
        assert transitions[0] == (SystemState.BOOT, SystemState.STANDBY)
        assert transitions[1] == (SystemState.STANDBY, SystemState.LISTENING)

    def test_is_active(self):
        sm = StateMachine()
        assert sm.is_active() is False
        sm.transition(SystemState.STANDBY)
        assert sm.is_active() is False
        sm.transition(SystemState.LISTENING)
        assert sm.is_active() is True

    def test_is_ready(self):
        sm = StateMachine()
        sm.transition(SystemState.STANDBY)
        assert sm.is_ready() is False
        sm.transition(SystemState.LISTENING)
        assert sm.is_ready() is True

    def test_time_in_state(self):
        sm = StateMachine()
        time.sleep(0.1)
        assert sm.time_in_state >= 0.1
        sm.transition(SystemState.STANDBY)
        assert sm.time_in_state < 0.1

    def test_thread_safety(self):
        sm = StateMachine()
        sm.transition(SystemState.STANDBY)
        sm.transition(SystemState.LISTENING)

        errors = []

        def toggle():
            for _ in range(50):
                try:
                    sm.transition(SystemState.PROCESSING)
                    sm.transition(SystemState.LISTENING)
                except Exception as e:
                    errors.append(str(e))

        threads = [threading.Thread(target=toggle) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Should not crash — state may vary but no exceptions
        assert len(errors) == 0
