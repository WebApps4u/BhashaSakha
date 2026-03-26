"""Language router for BhashaSakha.

Maps between Whisper language codes, NLLB codes, and Piper voice IDs.
Handles confidence-based language validation and session context.
"""

import logging
from typing import Dict, List, Optional
from src.core.config_loader import LanguageInfo

logger = logging.getLogger(__name__)


# Language code mapping tables
WHISPER_TO_NLLB = {
    "hi": "hin_Deva",
    "mr": "mar_Deva",
    "en": "eng_Latn",
}

NLLB_TO_WHISPER = {v: k for k, v in WHISPER_TO_NLLB.items()}

WHISPER_TO_PIPER = {
    "hi": "hi_IN-rohan-medium",
    "mr": "mr_IN-medium",
    "en": "en_US-lessac-medium",
}

LANGUAGE_NAMES = {
    "hi": "Hindi",
    "mr": "Marathi",
    "en": "English",
}


class LanguageRouter:
    """Routes between different language code systems.

    Handles:
    - Whisper code → NLLB code → Piper voice ID mapping
    - Language confidence validation
    - Fallback language selection from session context
    """

    def __init__(self, supported_languages: List[LanguageInfo] = None,
                 min_confidence: float = 0.5):
        self._min_confidence = min_confidence
        self._last_reliable_lang: Optional[str] = None

        # Build mapping from config if provided
        if supported_languages:
            for lang in supported_languages:
                WHISPER_TO_NLLB[lang.whisper_code] = lang.code
                NLLB_TO_WHISPER[lang.code] = lang.whisper_code
                if lang.piper_voice:
                    WHISPER_TO_PIPER[lang.whisper_code] = lang.piper_voice

    def whisper_to_nllb(self, whisper_code: str) -> str:
        """Convert Whisper language code to NLLB code.

        Args:
            whisper_code: e.g., "hi"

        Returns:
            NLLB code e.g., "hin_Deva"
        """
        return WHISPER_TO_NLLB.get(whisper_code, "eng_Latn")

    def nllb_to_whisper(self, nllb_code: str) -> str:
        """Convert NLLB code to Whisper code."""
        return NLLB_TO_WHISPER.get(nllb_code, "en")

    def whisper_to_piper(self, whisper_code: str) -> str:
        """Convert Whisper language code to Piper voice ID."""
        return WHISPER_TO_PIPER.get(whisper_code, "en_US-lessac-medium")

    def get_language_name(self, whisper_code: str) -> str:
        """Get human-readable language name."""
        return LANGUAGE_NAMES.get(whisper_code, "Unknown")

    def validate_language(self, detected_lang: str,
                          confidence: float) -> str:
        """Validate detected language against confidence threshold.

        If confidence is too low, falls back to last reliable detection.

        Args:
            detected_lang: Whisper language code
            confidence: Detection confidence (0-1)

        Returns:
            Validated language code (may differ from detected)
        """
        if detected_lang not in WHISPER_TO_NLLB:
            logger.warning(f"Unsupported language: {detected_lang}")
            return self._last_reliable_lang or "en"

        if confidence >= self._min_confidence:
            self._last_reliable_lang = detected_lang
            return detected_lang
        else:
            fallback = self._last_reliable_lang or "en"
            logger.info(
                f"Low confidence {confidence:.2f} for {detected_lang}, "
                f"using fallback: {fallback}"
            )
            return fallback

    def get_all_targets(self, source_lang: str) -> List[str]:
        """Get all possible target languages (excluding source).

        Args:
            source_lang: Whisper code of source language

        Returns:
            List of target Whisper codes
        """
        all_langs = set(WHISPER_TO_NLLB.keys())
        return sorted(all_langs - {source_lang})

    def is_supported(self, whisper_code: str) -> bool:
        """Check if a language is supported."""
        return whisper_code in WHISPER_TO_NLLB

    def reset(self):
        """Reset language tracking state."""
        self._last_reliable_lang = None
