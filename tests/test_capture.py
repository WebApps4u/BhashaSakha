"""Tests for audio capture ring buffer and VAD integration."""

import pytest
import numpy as np
from src.audio.capture import RingBuffer, AudioCapture


class TestRingBuffer:
    def test_create_buffer(self):
        buf = RingBuffer(duration_sec=5, sample_rate=16000)
        assert buf._size == 80000

    def test_write_and_read(self):
        buf = RingBuffer(duration_sec=1, sample_rate=16000)
        data = np.ones(480, dtype=np.float32)  # 30ms frame
        buf.write(data)
        result = buf.read_last(480)
        np.testing.assert_array_equal(result, data)

    def test_read_last_after_multiple_writes(self):
        buf = RingBuffer(duration_sec=1, sample_rate=16000)

        # Write 3 frames
        for i in range(3):
            data = np.full(480, float(i + 1), dtype=np.float32)
            buf.write(data)

        # Read last frame (should be the 3rd)
        result = buf.read_last(480)
        np.testing.assert_array_equal(result, np.full(480, 3.0, dtype=np.float32))

    def test_wrap_around(self):
        buf = RingBuffer(duration_sec=1, sample_rate=16000)
        # Write more than buffer size
        for i in range(40):  # 40 × 480 = 19200 > 16000
            data = np.full(480, float(i), dtype=np.float32)
            buf.write(data)

        # Should still be able to read the last frame
        result = buf.read_last(480)
        np.testing.assert_array_equal(result, np.full(480, 39.0, dtype=np.float32))

    def test_read_more_than_buffer(self):
        buf = RingBuffer(duration_sec=1, sample_rate=16000)
        data = np.ones(480, dtype=np.float32)
        buf.write(data)

        # Request more than available — should cap at buffer size
        result = buf.read_last(20000)
        assert len(result) == 16000

    def test_concurrent_write_read(self):
        """Test thread safety of ring buffer."""
        import threading
        buf = RingBuffer(duration_sec=2, sample_rate=16000)
        errors = []

        def writer():
            for i in range(100):
                data = np.full(480, float(i), dtype=np.float32)
                try:
                    buf.write(data)
                except Exception as e:
                    errors.append(str(e))

        def reader():
            for _ in range(100):
                try:
                    buf.read_last(480)
                except Exception as e:
                    errors.append(str(e))

        t1 = threading.Thread(target=writer)
        t2 = threading.Thread(target=reader)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert len(errors) == 0


class TestAudioCapture:
    def test_create_capture(self):
        cap = AudioCapture(sample_rate=16000, buffer_duration=5)
        assert cap.sample_rate == 16000
        assert cap.frame_samples == 480

    def test_speech_queue_exists(self):
        cap = AudioCapture()
        assert cap.speech_queue is not None
        assert cap.speech_queue.maxsize == 3

    def test_set_vad_callback(self):
        cap = AudioCapture()
        called = []
        cap.set_vad_callback(lambda frame: called.append(True) or False)
        assert cap._vad_callback is not None
