"""NLLB-200 translation engine for BhashaSakha.

Uses CTranslate2 for efficient int8 inference on RPi5 ARM64.
Single model handles all 6 translation directions (hi↔mr↔en).
"""

import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)


class NLLBEngine:
    """NLLB-200-distilled-600M via CTranslate2.

    Key features:
    - Single model for ALL language pairs (no pivot needed)
    - int8 quantization via CTranslate2 Ruy backend (ARM NEON)
    - ~60-100ms per sentence on RPi5
    - ~1.2GB RAM loaded
    """

    def __init__(self, model_path: str, tokenizer_name: str,
                 beam_size: int = 2, max_decoding_length: int = 128):
        """
        Args:
            model_path: Path to CTranslate2 model directory
            tokenizer_name: HuggingFace tokenizer name for NLLB
            beam_size: Beam size for translation (2 = fast)
            max_decoding_length: Max output tokens
        """
        self.model_path = model_path
        self.tokenizer_name = tokenizer_name
        self.beam_size = beam_size
        self.max_decoding_length = max_decoding_length
        self._translator = None
        self._tokenizer = None

    def load(self):
        """Load CTranslate2 translator and HuggingFace tokenizer.

        Takes ~8 seconds on RPi5 for NLLB-200-600M int8.
        """
        try:
            import ctranslate2
            from transformers import AutoTokenizer

            start = time.monotonic()

            # Load CTranslate2 translator
            self._translator = ctranslate2.Translator(
                self.model_path,
                device="cpu",
                compute_type="int8",
                inter_threads=1,
                intra_threads=2,  # Use 2 ARM cores
            )

            # Load tokenizer (HuggingFace — for tokenization only)
            self._tokenizer = AutoTokenizer.from_pretrained(
                self.tokenizer_name,
                local_files_only=False,  # Will cache after first download
            )

            elapsed = (time.monotonic() - start) * 1000
            logger.info(
                f"NLLB-200 loaded: {self.model_path} in {elapsed:.0f}ms"
            )

        except Exception as e:
            logger.error(f"Failed to load NLLB model: {e}")
            raise

    def translate(self, text: str, src_lang: str, tgt_lang: str) -> str:
        """Translate text between any supported language pair.

        Args:
            text: Source text to translate
            src_lang: NLLB source language code (e.g., "hin_Deva")
            tgt_lang: NLLB target language code (e.g., "eng_Latn")

        Returns:
            Translated text, or original text on failure
        """
        if not text or not text.strip():
            return ""

        if self._translator is None or self._tokenizer is None:
            logger.error("NLLB model not loaded")
            return text

        if src_lang == tgt_lang:
            return text

        start = time.monotonic()

        try:
            # Tokenize with source language
            self._tokenizer.src_lang = src_lang
            encoded = self._tokenizer(text, return_tensors=None)
            input_ids = encoded["input_ids"]

            # Convert to token strings for CTranslate2
            source_tokens = self._tokenizer.convert_ids_to_tokens(input_ids)

            # Translate with target language prefix
            results = self._translator.translate_batch(
                source=[source_tokens],
                target_prefix=[[tgt_lang]],
                beam_size=self.beam_size,
                max_decoding_length=self.max_decoding_length,
                replace_unknowns=True,
            )

            # Decode output tokens
            output_tokens = results[0].hypotheses[0]

            # Remove the language token prefix if present
            if output_tokens and output_tokens[0] == tgt_lang:
                output_tokens = output_tokens[1:]

            # Convert tokens back to text
            output_ids = self._tokenizer.convert_tokens_to_ids(output_tokens)
            translated = self._tokenizer.decode(
                output_ids,
                skip_special_tokens=True,
                clean_up_tokenization_spaces=True,
            )

            elapsed_ms = (time.monotonic() - start) * 1000

            # Log latency and direction (NOT the text — privacy)
            logger.info(
                f"Translation: {src_lang}→{tgt_lang} "
                f"in_chars={len(text)} out_chars={len(translated)} "
                f"time={elapsed_ms:.0f}ms"
            )

            return translated.strip()

        except Exception as e:
            elapsed_ms = (time.monotonic() - start) * 1000
            logger.error(f"Translation error ({src_lang}→{tgt_lang}): {e}")
            return text  # Return original on failure

    def warmup(self):
        """Run dummy translation to warm up caches."""
        if self._translator is None:
            return

        logger.info("Warming up NLLB translator...")
        try:
            self.translate("Hello", "eng_Latn", "hin_Deva")
            logger.info("NLLB warmup complete")
        except Exception as e:
            logger.warning(f"NLLB warmup failed: {e}")

    @property
    def is_loaded(self) -> bool:
        return self._translator is not None and self._tokenizer is not None
