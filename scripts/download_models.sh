#!/bin/bash
# BhashaSakha Model Download Script
# Downloads all required models for offline operation
# Total download: ~1.4GB
#
# Target: Raspberry Pi 5 (ARM64)
# Run once with internet, then operate fully offline

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODELS_DIR="${PROJECT_DIR}/models"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  BhashaSakha Model Download                         ║"
echo "║  Total download: ~1.4GB                             ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ─── 1. Silero VAD (~2MB) ─────────────────────────────────
echo "[1/4] Downloading Silero VAD..."
VAD_DIR="${MODELS_DIR}/vad"
mkdir -p "$VAD_DIR"

if [ ! -f "${VAD_DIR}/silero_vad.onnx" ]; then
    wget -q --show-progress \
        "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx" \
        -O "${VAD_DIR}/silero_vad.onnx"
    echo "  ✓ Silero VAD downloaded (~2MB)"
else
    echo "  ✓ Silero VAD already exists"
fi

# ─── 2. faster-whisper small int8 (~150MB) ──────────────
echo ""
echo "[2/4] Downloading Whisper Small (int8 quantized)..."
STT_DIR="${MODELS_DIR}/stt/whisper-small-int8"
mkdir -p "$STT_DIR"

if [ ! -f "${STT_DIR}/model.bin" ]; then
    # Use huggingface-cli or git to download
    if command -v huggingface-cli &> /dev/null; then
        huggingface-cli download \
            Systran/faster-whisper-small \
            --local-dir "$STT_DIR" \
            --local-dir-use-symlinks False
    else
        echo "  Installing huggingface_hub..."
        pip install -q huggingface_hub

        python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'Systran/faster-whisper-small',
    local_dir='${STT_DIR}',
    local_dir_use_symlinks=False,
)
print('  ✓ Whisper Small downloaded')
"
    fi
    echo "  ✓ Whisper Small int8 downloaded (~150MB)"
else
    echo "  ✓ Whisper Small already exists"
fi

# ─── 3. NLLB-200 distilled 600M int8 (~1.06GB) ──────────
echo ""
echo "[3/4] Downloading NLLB-200-distilled-600M (int8 CTranslate2)..."
TRANS_DIR="${MODELS_DIR}/translation/nllb-200-distilled-600M-ct2-int8"
mkdir -p "$TRANS_DIR"

if [ ! -f "${TRANS_DIR}/model.bin" ]; then
    python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'JustFrederik/nllb-200-distilled-600M-ct2-int8',
    local_dir='${TRANS_DIR}',
    local_dir_use_symlinks=False,
)
print('  ✓ NLLB-200 downloaded')
"
    echo "  ✓ NLLB-200 int8 downloaded (~1.06GB)"
else
    echo "  ✓ NLLB-200 already exists"
fi

# ─── 4. Piper TTS Voices (~180MB total) ─────────────────
echo ""
echo "[4/4] Downloading Piper TTS voices..."
TTS_DIR="${MODELS_DIR}/tts"
mkdir -p "$TTS_DIR"

PIPER_BASE="https://github.com/rhasspy/piper/releases/download/2023.11.14-2"

# Hindi voice
if [ ! -f "${TTS_DIR}/hi_IN-rohan-medium.onnx" ]; then
    echo "  Downloading Hindi voice..."
    wget -q --show-progress \
        "${PIPER_BASE}/voice-hi_IN-rohan-medium.tar.gz" \
        -O "/tmp/hi_voice.tar.gz"
    tar -xzf "/tmp/hi_voice.tar.gz" -C "/tmp/"
    cp /tmp/hi_IN-rohan-medium.onnx "${TTS_DIR}/"
    cp /tmp/hi_IN-rohan-medium.onnx.json "${TTS_DIR}/"
    rm -f /tmp/hi_voice.tar.gz /tmp/hi_IN-rohan-medium.*
    echo "  ✓ Hindi voice downloaded"
else
    echo "  ✓ Hindi voice already exists"
fi

# English voice
if [ ! -f "${TTS_DIR}/en_US-lessac-medium.onnx" ]; then
    echo "  Downloading English voice..."
    wget -q --show-progress \
        "${PIPER_BASE}/voice-en_US-lessac-medium.tar.gz" \
        -O "/tmp/en_voice.tar.gz"
    tar -xzf "/tmp/en_voice.tar.gz" -C "/tmp/"
    cp /tmp/en_US-lessac-medium.onnx "${TTS_DIR}/"
    cp /tmp/en_US-lessac-medium.onnx.json "${TTS_DIR}/"
    rm -f /tmp/en_voice.tar.gz /tmp/en_US-lessac-medium.*
    echo "  ✓ English voice downloaded"
else
    echo "  ✓ English voice already exists"
fi

# Marathi voice (may need separate source)
if [ ! -f "${TTS_DIR}/mr_IN-medium.onnx" ]; then
    echo "  ⚠ Marathi voice not available via Piper releases."
    echo "    Will use espeak-ng fallback for Marathi TTS."
    echo "    To add Marathi ONNX voice, place files at:"
    echo "      ${TTS_DIR}/mr_IN-medium.onnx"
    echo "      ${TTS_DIR}/mr_IN-medium.onnx.json"
fi

# ─── 5. Download NLLB tokenizer for offline use ─────────
echo ""
echo "[Bonus] Caching NLLB tokenizer for offline use..."
python3 -c "
from transformers import AutoTokenizer
tokenizer = AutoTokenizer.from_pretrained('facebook/nllb-200-distilled-600M')
print('  ✓ Tokenizer cached for offline use')
" 2>/dev/null || echo "  ⚠ Tokenizer caching failed (will download on first run)"

# ─── Summary ─────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Download Complete!                                 ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  VAD:         $(du -sh ${VAD_DIR} 2>/dev/null | cut -f1 || echo 'N/A')                          ║"
echo "║  STT:         $(du -sh ${STT_DIR} 2>/dev/null | cut -f1 || echo 'N/A')                          ║"
echo "║  Translation: $(du -sh ${TRANS_DIR} 2>/dev/null | cut -f1 || echo 'N/A')                          ║"
echo "║  TTS:         $(du -sh ${TTS_DIR} 2>/dev/null | cut -f1 || echo 'N/A')                          ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Next: python -m src.main --config config/config.yaml"
