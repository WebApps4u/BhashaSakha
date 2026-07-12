"""NLLB-200 translation engine for BhashaSakha.

Uses CTranslate2 for efficient int8 inference on RPi5 ARM64.
Single model handles all 6 translation directions (hi↔mr↔en).
"""

import logging
import re
import time
from typing import List, Optional

logger = logging.getLogger(__name__)

# Sentence boundaries: Latin punctuation + Devanagari danda/double-danda
_SENT_SPLIT = re.compile(r"(?<=[।॥.!?])\s+")
_CLAUSE_SPLIT = re.compile(r"(?<=[,;:])\s+")


def split_sentences(text: str, max_chars: int = 140) -> List[str]:
    """Split text into sentence-sized pieces for NLLB.

    NLLB is a sentence-level model — feeding it multi-sentence input
    makes it compress or drop content, so callers should translate
    piece-by-piece.

    Splits on ।, ॥, ., !, ? first; but Whisper's Hindi/Marathi output
    is often a long run-on with no punctuation at all, so anything
    still longer than max_chars is split on clause marks (, ; :) and
    finally on word windows.
    """
    pieces = []
    for sent in _SENT_SPLIT.split(text):
        sent = sent.strip()
        if not sent:
            continue
        if len(sent) <= max_chars:
            pieces.append(sent)
            continue
        for clause in _CLAUSE_SPLIT.split(sent):
            clause = clause.strip()
            if not clause:
                continue
            if len(clause) <= max_chars:
                pieces.append(clause)
                continue
            words = clause.split()
            n_parts = len(clause) // max_chars + 1
            step = max(8, (len(words) + n_parts - 1) // n_parts)
            for i in range(0, len(words), step):
                pieces.append(" ".join(words[i:i + step]))
    return pieces


class NLLBEngine:
    """NLLB-200-distilled-600M via CTranslate2.

    Key features:
    - Single model for ALL language pairs (no pivot needed)
    - int8 quantization via CTranslate2 Ruy backend (ARM NEON)
    - ~60-100ms per sentence on RPi5
    - ~1.2GB RAM loaded
    """

    def __init__(self, model_path: str, tokenizer_name: str,
                 beam_size: int = 2, max_decoding_length: int = 256,
                 intra_threads: int = 2):
        """
        Args:
            model_path: Path to CTranslate2 model directory
            tokenizer_name: HuggingFace tokenizer name for NLLB
            beam_size: Beam size for translation (2 = fast)
            max_decoding_length: Max output tokens per sentence
            intra_threads: CPU threads for inference
        """
        self.model_path = model_path
        self.tokenizer_name = tokenizer_name
        self.beam_size = beam_size
        self.max_decoding_length = max_decoding_length
        self.intra_threads = intra_threads
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
                intra_threads=self.intra_threads,
            )

            # Load tokenizer (HuggingFace — for tokenization only)
            # Try offline first (kiosk mode), fall back to online
            try:
                self._tokenizer = AutoTokenizer.from_pretrained(
                    self.tokenizer_name,
                    local_files_only=True,
                )
            except Exception:
                logger.info("NLLB tokenizer not cached locally, downloading...")
                self._tokenizer = AutoTokenizer.from_pretrained(
                    self.tokenizer_name,
                    local_files_only=False,
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

        Multi-sentence input is split and translated as a batch —
        NLLB drops/compresses content when given whole paragraphs.

        Args:
            text: Source text to translate
            src_lang: NLLB source language code (e.g., "hin_Deva")
            tgt_lang: NLLB target language code (e.g., "eng_Latn")

        Returns:
            Translated text, or original text on failure
        """
        if not text or not text.strip():
            return ""
        if src_lang == tgt_lang:
            return text

        sentences = split_sentences(text)
        results = self.translate_batch(sentences, src_lang, tgt_lang)
        return " ".join(r for r in results if r).strip()

    def translate_batch(self, texts: List[str], src_lang: str,
                        tgt_lang: str) -> List[str]:
        """Translate a list of sentences in one CTranslate2 batch call.

        Args:
            texts: Source sentences (one sentence each for best quality)
            src_lang: NLLB source language code
            tgt_lang: NLLB target language code

        Returns:
            List of translations, same order/length as input.
            On failure an entry falls back to its source text.
        """
        if not texts:
            return []

        if self._translator is None or self._tokenizer is None:
            logger.error("NLLB model not loaded")
            return list(texts)

        start = time.monotonic()

        try:
            # Tokenize each sentence with source language
            self._tokenizer.src_lang = src_lang
            source = []
            for text in texts:
                input_ids = self._tokenizer(text, return_tensors=None)["input_ids"]
                source.append(self._tokenizer.convert_ids_to_tokens(input_ids))

            results = self._translator.translate_batch(
                source=source,
                target_prefix=[[tgt_lang]] * len(source),
                beam_size=self.beam_size,
                max_decoding_length=self.max_decoding_length,
                replace_unknowns=True,
            )

            translated = []
            for res in results:
                output_tokens = res.hypotheses[0]
                if output_tokens and output_tokens[0] == tgt_lang:
                    output_tokens = output_tokens[1:]
                output_ids = self._tokenizer.convert_tokens_to_ids(output_tokens)
                translated.append(self._tokenizer.decode(
                    output_ids,
                    skip_special_tokens=True,
                    clean_up_tokenization_spaces=True,
                ).strip())

            elapsed_ms = (time.monotonic() - start) * 1000

            # Log latency and direction (NOT the text — privacy)
            in_chars = sum(len(t) for t in texts)
            out_chars = sum(len(t) for t in translated)
            logger.info(
                f"Translation: {src_lang}→{tgt_lang} sents={len(texts)} "
                f"in_chars={in_chars} out_chars={out_chars} "
                f"time={elapsed_ms:.0f}ms"
            )

            return translated

        except Exception as e:
            elapsed_ms = (time.monotonic() - start) * 1000
            logger.error(f"Translation error ({src_lang}→{tgt_lang}): {e}")
            return list(texts)  # Return originals on failure

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
