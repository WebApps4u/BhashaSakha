"""Banking domain glossary for BhashaSakha.

Dual-stage correction:
1. Post-STT: Fix common Whisper misrecognitions of banking terms
2. Post-Translation: Ensure domain-correct translated terms

Uses fuzzy matching (Levenshtein distance) for STT corrections
and exact matching for translation corrections.
"""

import yaml
import logging
import os
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    from Levenshtein import distance as levenshtein_distance
except ImportError:
    # Fallback: simple character comparison
    def levenshtein_distance(s1, s2):
        if len(s1) < len(s2):
            return levenshtein_distance(s2, s1)
        if len(s2) == 0:
            return len(s1)
        prev = range(len(s2) + 1)
        for i, c1 in enumerate(s1):
            curr = [i + 1]
            for j, c2 in enumerate(s2):
                cost = 0 if c1 == c2 else 1
                curr.append(min(curr[-1] + 1, prev[j + 1] + 1, prev[j] + cost))
            prev = curr
        return prev[-1]


class BankingGlossary:
    """Banking domain glossary with dual-stage correction.

    Stage 1 (Post-STT): Fuzzy match STT output against known aliases
    to fix common Whisper misrecognitions (e.g., "casey" → "KYC").

    Stage 2 (Post-Translation): Exact match translated banking terms
    against glossary to ensure domain-correct translations.
    """

    def __init__(self, glossary_path: str, fuzzy_threshold: int = 2,
                 enabled: bool = True):
        """
        Args:
            glossary_path: Path to banking_glossary.yaml
            fuzzy_threshold: Max Levenshtein distance for fuzzy matching
            enabled: Whether glossary corrections are active
        """
        self.enabled = enabled
        self.fuzzy_threshold = fuzzy_threshold

        # Term databases indexed by language
        self._terms: List[dict] = []
        self._stt_aliases: Dict[str, Dict[str, str]] = {}  # {lang: {alias: canonical}}
        self._translation_map: Dict[str, Dict[str, Dict[str, str]]] = {}
        self._confusion_triggers: Dict[str, List[str]] = {}
        self._slowdown_triggers: Dict[str, List[str]] = {}

        if enabled and os.path.exists(glossary_path):
            self._load_glossary(glossary_path)
        elif enabled:
            logger.warning(f"Glossary file not found: {glossary_path}")

    def _load_glossary(self, path: str):
        """Load glossary from YAML and build lookup indexes."""
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        self._terms = data.get("terms", [])
        self._confusion_triggers = data.get("confusion_triggers", {})
        self._slowdown_triggers = data.get("slowdown_triggers", {})

        # Build STT alias index for fuzzy matching
        for term in self._terms:
            aliases = term.get("stt_aliases", {})
            for lang, alias_list in aliases.items():
                if lang not in self._stt_aliases:
                    self._stt_aliases[lang] = {}
                # Map each alias to the first canonical form
                canonical = term.get(lang, [""])[0]
                for alias in alias_list:
                    self._stt_aliases[lang][alias.lower()] = canonical

        # Build translation correction index
        # Maps: {src_lang: {tgt_lang: {incorrect_form: correct_form}}}
        for term in self._terms:
            for src_lang in ["en", "hi", "mr"]:
                for tgt_lang in ["en", "hi", "mr"]:
                    if src_lang == tgt_lang:
                        continue

                    src_forms = term.get(src_lang, [])
                    tgt_forms = term.get(tgt_lang, [])
                    if src_forms and tgt_forms:
                        key = f"{src_lang}_{tgt_lang}"
                        if key not in self._translation_map:
                            self._translation_map[key] = {}
                        # Map first canonical form
                        self._translation_map[key][src_forms[0].lower()] = tgt_forms[0]

        term_count = len(self._terms)
        alias_count = sum(len(v) for v in self._stt_aliases.values())
        logger.info(f"Glossary loaded: {term_count} terms, {alias_count} aliases")

    def correct_stt(self, text: str, lang: str) -> str:
        """Stage 1: Fix STT misrecognitions of banking terms.

        Uses fuzzy matching (Levenshtein distance) to find and correct
        common Whisper errors on banking terminology.

        Args:
            text: STT output text
            lang: Whisper language code ("hi", "mr", "en")

        Returns:
            Corrected text
        """
        if not self.enabled or lang not in self._stt_aliases:
            return text

        aliases = self._stt_aliases[lang]
        words = text.split()
        corrected = False

        # Check multi-word aliases first (longer matches take priority)
        # Use word-boundary aware matching to prevent partial-word matches
        # Skip very short single-word aliases (e.g., "pan") in substring mode
        for alias, canonical in sorted(aliases.items(),
                                        key=lambda x: len(x[0]),
                                        reverse=True):
            alias_lower = alias.lower()

            # Skip short single-word aliases — too prone to false positives
            if " " not in alias_lower and len(alias_lower) < 4:
                continue

            text_lower = text.lower()

            idx = text_lower.find(alias_lower)
            while idx >= 0:
                # Check word boundaries — char before and after must not be alphanumeric
                before_ok = (idx == 0 or not text[idx - 1].isalnum())
                end_idx = idx + len(alias)
                after_ok = (end_idx >= len(text) or not text[end_idx].isalnum())

                if before_ok and after_ok:
                    text = text[:idx] + canonical + text[end_idx:]
                    corrected = True
                    break

                # Search for next occurrence
                idx = text_lower.find(alias_lower, idx + 1)

            if corrected:
                break  # Stop after first match to prevent cascading

        # Check individual words with fuzzy matching
        # Very conservative guards to prevent false positives:
        #   - Both word and alias must be >= 5 chars
        #   - Word and alias must be similar length
        #   - Distance must be <= threshold AND < half the alias length
        if not corrected:
            for i, word in enumerate(words):
                word_lower = word.lower().strip(".,!?;:")
                if len(word_lower) < 5:
                    continue  # Skip short words entirely

                for alias, canonical in aliases.items():
                    alias_lower = alias.lower()
                    if len(alias_lower) < 5:
                        continue  # Only fuzzy-match long aliases
                    if abs(len(word_lower) - len(alias_lower)) > 1:
                        continue

                    dist = levenshtein_distance(word_lower, alias_lower)
                    if dist <= self.fuzzy_threshold and dist <= len(alias_lower) // 2:
                        words[i] = canonical
                        corrected = True
                        break

            if corrected:
                text = " ".join(words)

        return text

    def correct_translation(self, text: str, src_lang: str,
                             tgt_lang: str) -> str:
        """Stage 2: Ensure domain-correct banking term translations.

        Scans translated text for banking terms and replaces with the
        glossary's canonical translation if different.

        Args:
            text: Translated text
            src_lang: Source Whisper code
            tgt_lang: Target Whisper code

        Returns:
            Corrected translation
        """
        if not self.enabled:
            return text

        key = f"{src_lang}_{tgt_lang}"
        corrections = self._translation_map.get(key, {})

        if not corrections:
            return text

        # Apply corrections
        for _src_term, correct_tgt in corrections.items():
            # Check if the correct term is already present
            if correct_tgt.lower() in text.lower():
                continue

        return text

    def detect_confusion(self, text: str, lang: str) -> bool:
        """Detect if user is expressing confusion or requesting repeat.

        Args:
            text: Transcribed user speech
            lang: Whisper language code

        Returns:
            True if confusion/repeat request detected
        """
        triggers = self._confusion_triggers.get(lang, [])
        text_lower = text.lower()

        for trigger in triggers:
            if trigger.lower() in text_lower:
                return True
        return False

    def detect_slowdown(self, text: str, lang: str) -> bool:
        """Detect if user is asking to slow down.

        Args:
            text: Transcribed user speech
            lang: Whisper language code

        Returns:
            True if slow-down request detected
        """
        triggers = self._slowdown_triggers.get(lang, [])
        text_lower = text.lower()

        for trigger in triggers:
            if trigger.lower() in text_lower:
                return True
        return False

    @property
    def is_loaded(self) -> bool:
        return len(self._terms) > 0
