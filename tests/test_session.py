"""Tests for session manager."""

import pytest
import time
from src.core.session import SessionManager, TranslationRecord


class TestSessionManager:
    def test_create_session(self):
        sm = SessionManager()
        session = sm.create_session()
        assert sm.active is True
        assert session.id != ""
        assert session.mode == "single_user"

    def test_destroy_session(self):
        sm = SessionManager()
        sm.create_session()
        sm.destroy_session()
        assert sm.active is False
        assert sm.session is None

    def test_single_user_mode(self):
        sm = SessionManager()
        sm.create_session()
        sm.record_language("hi")
        assert sm.session.mode == "single_user"
        assert sm.session.speaker_a_lang == "hi"

    def test_two_party_detection(self):
        sm = SessionManager()
        sm.create_session()
        sm.record_language("hi")
        sm.record_language("en")
        assert sm.session.mode == "two_party"
        assert sm.session.speaker_a_lang == "hi"
        assert sm.session.speaker_b_lang == "en"

    def test_same_language_stays_single_user(self):
        sm = SessionManager()
        sm.create_session()
        sm.record_language("hi")
        sm.record_language("hi")
        sm.record_language("hi")
        assert sm.session.mode == "single_user"

    def test_target_languages_single_user(self):
        sm = SessionManager()
        sm.create_session()
        sm.record_language("hi")
        targets = sm.get_target_languages("hi")
        assert "en" in targets
        assert "mr" in targets
        assert "hi" not in targets

    def test_target_languages_two_party(self):
        sm = SessionManager()
        sm.create_session()
        sm.record_language("hi")
        sm.record_language("en")

        # Speaker A (hindi) should translate to English
        targets = sm.get_target_languages("hi")
        assert targets == ["en"]

        # Speaker B (english) should translate to Hindi
        targets = sm.get_target_languages("en")
        assert targets == ["hi"]

    def test_idle_timeout(self):
        sm = SessionManager(idle_timeout=1)
        sm.create_session()
        assert sm.is_expired() is False
        time.sleep(1.2)
        assert sm.is_expired() is True

    def test_touch_resets_idle(self):
        sm = SessionManager(idle_timeout=1)
        sm.create_session()
        time.sleep(0.5)
        sm.touch()
        time.sleep(0.5)
        assert sm.is_expired() is False

    def test_confusion_tracking(self):
        sm = SessionManager(confusion_threshold=2, slow_speed=0.8)
        sm.create_session()

        sm.record_confusion()
        assert sm.get_tts_speed() == 1.0  # Not yet

        sm.record_confusion()
        assert sm.get_tts_speed() == 0.8  # Threshold reached

    def test_translation_record(self):
        sm = SessionManager()
        sm.create_session()

        record = TranslationRecord(
            source_text="hello",
            source_lang="en",
            translated_text="नमस्ते",
            target_lang="hi",
        )
        sm.record_translation(record)

        last = sm.get_last_translation()
        assert last is not None
        assert last.translated_text == "नमस्ते"

    def test_no_translation_when_no_session(self):
        sm = SessionManager()
        assert sm.get_last_translation() is None

    def test_utterance_count(self):
        sm = SessionManager()
        sm.create_session()
        sm.record_language("hi")
        sm.record_language("en")
        sm.record_language("hi")
        assert sm.session.utterance_count == 3

    def test_replace_session(self):
        sm = SessionManager()
        s1 = sm.create_session()
        s2 = sm.create_session()
        assert s1.id != s2.id
        assert sm.session.id == s2.id
