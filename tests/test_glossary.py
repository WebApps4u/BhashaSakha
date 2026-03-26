"""Tests for banking glossary."""

import pytest
from src.translation.glossary import BankingGlossary


class TestBankingGlossary:
    @pytest.fixture
    def glossary(self, glossary_path):
        return BankingGlossary(glossary_path, fuzzy_threshold=2)

    def test_load_glossary(self, glossary):
        assert glossary.is_loaded is True

    def test_stt_correction_exact_alias(self, glossary):
        # "case Y C" should be corrected to "KYC"
        result = glossary.correct_stt("I need case Y C documents", "en")
        assert "KYC" in result

    def test_stt_correction_spaced_abbreviation(self, glossary):
        result = glossary.correct_stt("Please check my E M I status", "en")
        assert "EMI" in result

    def test_stt_no_false_correction(self, glossary):
        # Normal text should not be changed
        result = glossary.correct_stt("I want to open a new account", "en")
        assert result == "I want to open a new account"

    def test_detect_confusion_hindi(self, glossary):
        assert glossary.detect_confusion("समझ नहीं आया", "hi") is True
        assert glossary.detect_confusion("फिर से बोलो", "hi") is True

    def test_detect_confusion_english(self, glossary):
        assert glossary.detect_confusion("can you repeat that", "en") is True
        assert glossary.detect_confusion("say again please", "en") is True

    def test_detect_confusion_marathi(self, glossary):
        assert glossary.detect_confusion("परत सांगा", "mr") is True

    def test_no_confusion_normal_speech(self, glossary):
        assert glossary.detect_confusion("I want to check my balance", "en") is False

    def test_detect_slowdown_english(self, glossary):
        assert glossary.detect_slowdown("please slow down", "en") is True
        assert glossary.detect_slowdown("you are too fast", "en") is True

    def test_detect_slowdown_hindi(self, glossary):
        assert glossary.detect_slowdown("धीरे बोलो", "hi") is True

    def test_no_slowdown_normal_speech(self, glossary):
        assert glossary.detect_slowdown("hello how are you", "en") is False

    def test_disabled_glossary(self, glossary_path):
        glossary = BankingGlossary(glossary_path, enabled=False)
        result = glossary.correct_stt("case Y C", "en")
        assert result == "case Y C"  # No correction when disabled

    def test_missing_glossary_file(self):
        glossary = BankingGlossary("/nonexistent/path.yaml")
        assert glossary.is_loaded is False
        # Should not crash on correction
        result = glossary.correct_stt("hello", "en")
        assert result == "hello"


class TestLanguageRouter:
    def test_whisper_to_nllb(self):
        from src.translation.language_router import LanguageRouter
        router = LanguageRouter()
        assert router.whisper_to_nllb("hi") == "hin_Deva"
        assert router.whisper_to_nllb("mr") == "mar_Deva"
        assert router.whisper_to_nllb("en") == "eng_Latn"

    def test_nllb_to_whisper(self):
        from src.translation.language_router import LanguageRouter
        router = LanguageRouter()
        assert router.nllb_to_whisper("hin_Deva") == "hi"
        assert router.nllb_to_whisper("mar_Deva") == "mr"

    def test_whisper_to_piper(self):
        from src.translation.language_router import LanguageRouter
        router = LanguageRouter()
        assert "hi_IN" in router.whisper_to_piper("hi")
        assert "en_US" in router.whisper_to_piper("en")

    def test_validate_language_high_confidence(self):
        from src.translation.language_router import LanguageRouter
        router = LanguageRouter()
        result = router.validate_language("hi", 0.95)
        assert result == "hi"

    def test_validate_language_low_confidence_fallback(self):
        from src.translation.language_router import LanguageRouter
        router = LanguageRouter(min_confidence=0.5)
        # First set a reliable language
        router.validate_language("hi", 0.95)
        # Now a low-confidence detection should fall back
        result = router.validate_language("mr", 0.3)
        assert result == "hi"

    def test_get_all_targets(self):
        from src.translation.language_router import LanguageRouter
        router = LanguageRouter()
        targets = router.get_all_targets("hi")
        assert "en" in targets
        assert "mr" in targets
        assert "hi" not in targets

    def test_is_supported(self):
        from src.translation.language_router import LanguageRouter
        router = LanguageRouter()
        assert router.is_supported("hi") is True
        assert router.is_supported("fr") is False

    def test_unsupported_language_defaults(self):
        from src.translation.language_router import LanguageRouter
        router = LanguageRouter()
        assert router.whisper_to_nllb("xx") == "eng_Latn"
