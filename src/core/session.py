"""Session manager for BhashaSakha.

Tracks conversation state, language history, and speaker modes.
All data is in-memory only — NEVER persisted to disk (privacy).
"""

import time
import uuid
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from collections import deque

logger = logging.getLogger(__name__)


@dataclass
class TranslationRecord:
    """Record of a single translation (kept in-memory for repeat feature)."""
    source_text: str
    source_lang: str
    translated_text: str
    target_lang: str
    audio_data: Optional[bytes] = None
    timestamp: float = 0.0

    def __post_init__(self):
        if self.timestamp == 0.0:
            self.timestamp = time.monotonic()


@dataclass
class Session:
    """Active conversation session.

    Created when user approaches, destroyed when user leaves.
    All data is volatile — never written to disk.
    """
    id: str = ""
    created_at: float = 0.0
    last_activity: float = 0.0
    mode: str = "single_user"       # "single_user" or "two_party"
    speaker_a_lang: Optional[str] = None  # Whisper code: "hi", "mr", "en"
    speaker_b_lang: Optional[str] = None
    language_history: deque = field(default_factory=lambda: deque(maxlen=20))
    last_translations: deque = field(default_factory=lambda: deque(maxlen=5))
    confusion_count: int = 0
    tts_speed: float = 1.0
    utterance_count: int = 0

    def __post_init__(self):
        if not self.id:
            self.id = str(uuid.uuid4())[:8]
        now = time.monotonic()
        if self.created_at == 0.0:
            self.created_at = now
        if self.last_activity == 0.0:
            self.last_activity = now


class SessionManager:
    """Manages conversation sessions with language tracking.

    Handles:
    - Session lifecycle (create, touch, destroy)
    - Speaker mode detection (single vs two-party)
    - Target language determination
    - Repeat/slow-down requests
    - Idle timeout detection
    """

    def __init__(self, idle_timeout: int = 120, max_duration: int = 1800,
                 confusion_threshold: int = 2, slow_speed: float = 0.8):
        self._session: Optional[Session] = None
        self._idle_timeout = idle_timeout
        self._max_duration = max_duration
        self._confusion_threshold = confusion_threshold
        self._slow_speed = slow_speed
        # All supported language codes
        self._all_languages = {"hi", "mr", "en"}

    @property
    def active(self) -> bool:
        """Whether a session is currently active."""
        return self._session is not None

    @property
    def session(self) -> Optional[Session]:
        return self._session

    def create_session(self) -> Session:
        """Create a new conversation session."""
        if self._session:
            self.destroy_session()

        self._session = Session()
        logger.info(f"Session created: {self._session.id}")
        return self._session

    def destroy_session(self):
        """Destroy current session, clearing all in-memory data."""
        if self._session:
            sid = self._session.id
            # Clear audio data references for GC
            for record in self._session.last_translations:
                record.audio_data = None
            self._session = None
            logger.info(f"Session destroyed: {sid}")

    def touch(self):
        """Update last activity timestamp."""
        if self._session:
            self._session.last_activity = time.monotonic()

    def is_expired(self) -> bool:
        """Check if session has expired due to idle or max duration."""
        if not self._session:
            return True

        now = time.monotonic()
        idle_time = now - self._session.last_activity
        total_time = now - self._session.created_at

        if idle_time > self._idle_timeout:
            logger.info(f"Session {self._session.id} expired: idle {idle_time:.0f}s")
            return True
        if total_time > self._max_duration:
            logger.info(f"Session {self._session.id} expired: max duration {total_time:.0f}s")
            return True
        return False

    def record_language(self, lang: str):
        """Record a detected language and update speaker mode.

        Args:
            lang: Whisper language code ("hi", "mr", "en")
        """
        if not self._session:
            return

        self._session.language_history.append(lang)
        self._session.utterance_count += 1
        self.touch()

        # Set speaker A language on first utterance
        if self._session.speaker_a_lang is None:
            self._session.speaker_a_lang = lang
            logger.info(f"Speaker A language: {lang}")
            return

        # If a different language is detected, set speaker B and enter two-party mode
        if (lang != self._session.speaker_a_lang and
                self._session.speaker_b_lang is None):
            self._session.speaker_b_lang = lang
            self._session.mode = "two_party"
            logger.info(f"Two-party mode: {self._session.speaker_a_lang} ↔ {lang}")

    def get_target_languages(self, source_lang: str) -> List[str]:
        """Determine which language(s) to translate into.

        In single-user mode: translate to all other languages.
        In two-party mode: translate to the other speaker's language.

        Args:
            source_lang: Whisper code of detected source language

        Returns:
            List of target Whisper language codes
        """
        if not self._session:
            # Default: translate to all other languages
            return sorted(self._all_languages - {source_lang})

        if self._session.mode == "two_party":
            # In two-party mode, translate to the other speaker's language
            if source_lang == self._session.speaker_a_lang:
                target = self._session.speaker_b_lang
            else:
                target = self._session.speaker_a_lang

            if target and target != source_lang:
                return [target]

        # Single user or fallback: translate to all other languages
        targets = sorted(self._all_languages - {source_lang})
        return targets

    def record_translation(self, record: TranslationRecord):
        """Store a translation record for repeat feature."""
        if self._session:
            self._session.last_translations.append(record)

    def get_last_translation(self) -> Optional[TranslationRecord]:
        """Get the most recent translation (for repeat requests)."""
        if self._session and self._session.last_translations:
            return self._session.last_translations[-1]
        return None

    def record_confusion(self):
        """Record a user confusion event (repeat/didn't understand).

        After threshold, automatically slows down TTS speed.
        """
        if not self._session:
            return

        self._session.confusion_count += 1
        logger.info(f"Confusion count: {self._session.confusion_count}")

        if self._session.confusion_count >= self._confusion_threshold:
            self._session.tts_speed = self._slow_speed
            logger.info(f"TTS speed reduced to {self._slow_speed}x due to confusion")

    def get_tts_speed(self) -> float:
        """Get current TTS speed for the session."""
        if self._session:
            return self._session.tts_speed
        return 1.0

    def force_language(self, lang: str):
        """Force a language for the current speaker (language switch command)."""
        if not self._session:
            return

        # Determine which speaker this is based on recent history
        recent_langs = list(self._session.language_history)[-3:]
        if recent_langs and recent_langs[-1] == self._session.speaker_a_lang:
            self._session.speaker_a_lang = lang
        elif self._session.speaker_b_lang:
            self._session.speaker_b_lang = lang

        logger.info(f"Language forced to: {lang}")
