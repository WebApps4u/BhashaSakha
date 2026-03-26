"""Translation cache for BhashaSakha.

LRU cache for repeated banking phrases, avoiding redundant NLLB inference.
Typical banking conversations involve ~10-15 unique phrases repeated frequently.
"""

import logging
import threading
from collections import OrderedDict
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


class TranslationCache:
    """Thread-safe LRU cache for translations.

    Caches text→translation pairs to avoid re-translating
    frequently repeated banking phrases.

    Key: (source_text_lowercase, src_lang, tgt_lang)
    Value: translated_text

    Memory: ~50KB for 200 entries (avg 50 chars each)
    """

    def __init__(self, max_size: int = 200):
        """
        Args:
            max_size: Maximum cache entries (200 = ~50 common phrases × 4 directions)
        """
        self._cache: OrderedDict[Tuple[str, str, str], str] = OrderedDict()
        self._max_size = max_size
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0

    def get(self, text: str, src_lang: str, tgt_lang: str) -> Optional[str]:
        """Look up a cached translation.

        Args:
            text: Source text
            src_lang: NLLB source language code
            tgt_lang: NLLB target language code

        Returns:
            Cached translation or None
        """
        key = (text.strip().lower(), src_lang, tgt_lang)

        with self._lock:
            if key in self._cache:
                # Move to end (most recently used)
                self._cache.move_to_end(key)
                self._hits += 1
                return self._cache[key]

            self._misses += 1
            return None

    def put(self, text: str, src_lang: str, tgt_lang: str,
            translated: str):
        """Cache a translation result.

        Args:
            text: Source text
            src_lang: NLLB source language code
            tgt_lang: NLLB target language code
            translated: Translated text
        """
        key = (text.strip().lower(), src_lang, tgt_lang)

        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                self._cache[key] = translated
            else:
                self._cache[key] = translated
                # Evict oldest if over capacity
                if len(self._cache) > self._max_size:
                    self._cache.popitem(last=False)

    def clear(self):
        """Clear all cached translations."""
        with self._lock:
            self._cache.clear()
            self._hits = 0
            self._misses = 0

    @property
    def size(self) -> int:
        return len(self._cache)

    @property
    def hit_rate(self) -> float:
        total = self._hits + self._misses
        return (self._hits / total * 100) if total > 0 else 0.0

    @property
    def stats(self) -> dict:
        return {
            "size": self.size,
            "max_size": self._max_size,
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": f"{self.hit_rate:.1f}%",
        }
