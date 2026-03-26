#!/bin/bash
# BhashaSakha — Model Download Script
# Downloads all required models for offline operation
# Total download: ~1.8GB
#
# Target: Raspberry Pi 5 (ARM64) or any x86_64 Linux
# Run once with internet, then operate fully offline.
#
# Usage: bash scripts/download_models.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODELS_DIR="${PROJECT_DIR}/models"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  BhashaSakha — Model Download                       ║"
echo "║  Total download: ~1.8GB                             ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Ensure we're in the venv
if [ -z "${VIRTUAL_ENV:-}" ]; then
    if [ -d "${PROJECT_DIR}/.venv" ]; then
        echo "Activating virtual environment..."
        source "${PROJECT_DIR}/.venv/bin/activate"
    else
        echo "ERROR: No virtual environment found. Run: python3 -m venv .venv && source .venv/bin/activate"
        exit 1
    fi
fi

# ─── 1. Silero VAD (~2MB) ─────────────────────────────────
echo "[1/5] Downloading Silero VAD..."
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

# ─── 2. Whisper-small int8 (~150MB) ──────────────────────
echo ""
echo "[2/5] Downloading Whisper Small (int8)..."
STT_DIR="${MODELS_DIR}/stt/whisper-small-int8"
mkdir -p "$STT_DIR"

if [ ! -f "${STT_DIR}/model.bin" ]; then
    python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'Systran/faster-whisper-small',
    local_dir='${STT_DIR}',
    local_dir_use_symlinks=False,
)
print('  ✓ Whisper Small downloaded (~150MB)')
"
else
    echo "  ✓ Whisper Small already exists"
fi

# ─── 3. NLLB-200-distilled-600M int8 (~1.06GB) ──────────
echo ""
echo "[3/5] Downloading NLLB-200-distilled-600M (int8 CTranslate2)..."
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
print('  ✓ NLLB-200 downloaded (~1.06GB)')
"
else
    echo "  ✓ NLLB-200 already exists"
fi

# ─── 4. Piper TTS Voices (~120MB) ───────────────────────
# NOTE: Server expects files at models/piper/ (not models/tts/)
echo ""
echo "[4/5] Downloading Piper TTS voices..."
PIPER_DIR="${MODELS_DIR}/piper"
mkdir -p "$PIPER_DIR"

PIPER_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main"

# Hindi voice: hi_IN-rohan-medium
if [ ! -f "${PIPER_DIR}/hi_IN-rohan-medium.onnx" ]; then
    echo "  Downloading Hindi voice (hi_IN-rohan-medium)..."
    wget -q --show-progress \
        "${PIPER_URL}/hi/hi_IN/rohan/medium/hi_IN-rohan-medium.onnx?download=true" \
        -O "${PIPER_DIR}/hi_IN-rohan-medium.onnx"
    wget -q --show-progress \
        "${PIPER_URL}/hi/hi_IN/rohan/medium/hi_IN-rohan-medium.onnx.json?download=true" \
        -O "${PIPER_DIR}/hi_IN-rohan-medium.onnx.json"
    echo "  ✓ Hindi voice downloaded"
else
    echo "  ✓ Hindi voice already exists"
fi

# English voice: en_US-amy-medium
if [ ! -f "${PIPER_DIR}/en_US-amy-medium.onnx" ]; then
    echo "  Downloading English voice (en_US-amy-medium)..."
    wget -q --show-progress \
        "${PIPER_URL}/en/en_US/amy/medium/en_US-amy-medium.onnx?download=true" \
        -O "${PIPER_DIR}/en_US-amy-medium.onnx"
    wget -q --show-progress \
        "${PIPER_URL}/en/en_US/amy/medium/en_US-amy-medium.onnx.json?download=true" \
        -O "${PIPER_DIR}/en_US-amy-medium.onnx.json"
    echo "  ✓ English voice downloaded"
else
    echo "  ✓ English voice already exists"
fi

# ─── 5. MMS-TTS Marathi (auto-cached by HuggingFace) ────
echo ""
echo "[5/5] Pre-downloading MMS-TTS Marathi model..."
python3 -c "
from transformers import VitsModel, AutoTokenizer
print('  Downloading facebook/mms-tts-mar...')
model = VitsModel.from_pretrained('facebook/mms-tts-mar')
tokenizer = AutoTokenizer.from_pretrained('facebook/mms-tts-mar')
print('  ✓ MMS-TTS Marathi cached for offline use')
" 2>/dev/null || echo "  ⚠ MMS-TTS download failed (will use espeak-ng fallback for Marathi)"

# ─── 6. Cache NLLB tokenizer for offline ─────────────────
echo ""
echo "[Bonus] Caching NLLB tokenizer for offline use..."
python3 -c "
from transformers import AutoTokenizer
tokenizer = AutoTokenizer.from_pretrained('facebook/nllb-200-distilled-600M')
print('  ✓ NLLB tokenizer cached for offline use')
" 2>/dev/null || echo "  ⚠ Tokenizer caching failed (will download on first run)"

# ─── Summary ─────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✓ Download Complete!                               ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  VAD:         $(du -sh ${VAD_DIR} 2>/dev/null | cut -f1 || echo 'N/A')                               ║"
echo "║  STT:         $(du -sh ${STT_DIR} 2>/dev/null | cut -f1 || echo 'N/A')                               ║"
echo "║  Translation: $(du -sh ${TRANS_DIR} 2>/dev/null | cut -f1 || echo 'N/A')                               ║"
echo "║  Piper TTS:   $(du -sh ${PIPER_DIR} 2>/dev/null | cut -f1 || echo 'N/A')                               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "All models downloaded! Run the app with:"
echo "  python ui/server.py"
echo ""
echo "Then open http://localhost:8080 in your browser."
