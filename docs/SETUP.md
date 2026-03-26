# Setup Guide

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **OS** | Ubuntu 22.04+ / Raspbian Bookworm | Ubuntu 24.04 / Raspbian Bookworm |
| **Python** | 3.10 | 3.11+ |
| **RAM** | 4GB | 8GB |
| **Storage** | 3GB (for models) | 5GB |
| **CPU** | ARM64 / x86_64 | Raspberry Pi 5 (8GB) |

## Step 1: System Dependencies

```bash
# Ubuntu / Debian / Raspberry Pi OS
sudo apt update
sudo apt install -y espeak-ng python3-venv python3-pip git wget
```

## Step 2: Clone Repository

```bash
git clone https://github.com/WebApps4u/BhashaSakha.git
cd BhashaSakha
git checkout pi
```

## Step 3: Python Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
```

## Step 4: Install Dependencies

```bash
# Install PyTorch (CPU-only) — must be done BEFORE requirements.txt
pip install torch --index-url https://download.pytorch.org/whl/cpu

# Install all other dependencies
pip install -r requirements.txt
```

## Step 5: Download Models

The easiest way — run the automated download script:

```bash
bash scripts/download_models.sh
```

This downloads all 5 models (~1.8GB total):

| Model | Size | Path |
|-------|------|------|
| Silero VAD | ~2MB | `models/vad/silero_vad.onnx` |
| Whisper-small (int8) | ~150MB | `models/stt/whisper-small-int8/` |
| NLLB-200 (int8) | ~1.06GB | `models/translation/nllb-200-distilled-600M-ct2-int8/` |
| Piper Hindi + English | ~120MB | `models/piper/hi_IN-rohan-medium.onnx` + `en_US-amy-medium.onnx` |
| MMS-TTS Marathi | ~75MB | Auto-cached by HuggingFace in `~/.cache/` |

### Manual Download (if script fails)

#### STT — Whisper-small (int8)
```bash
python3 -c "
from huggingface_hub import snapshot_download
snapshot_download('Systran/faster-whisper-small',
    local_dir='models/stt/whisper-small-int8',
    local_dir_use_symlinks=False)
"
```

#### Translation — NLLB-200 (int8, CTranslate2)
```bash
python3 -c "
from huggingface_hub import snapshot_download
snapshot_download('JustFrederik/nllb-200-distilled-600M-ct2-int8',
    local_dir='models/translation/nllb-200-distilled-600M-ct2-int8',
    local_dir_use_symlinks=False)
"
```

#### TTS — Piper voices
```bash
mkdir -p models/piper

# Hindi: hi_IN-rohan-medium
wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/rohan/medium/hi_IN-rohan-medium.onnx?download=true" \
    -O models/piper/hi_IN-rohan-medium.onnx
wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/rohan/medium/hi_IN-rohan-medium.onnx.json?download=true" \
    -O models/piper/hi_IN-rohan-medium.onnx.json

# English: en_US-amy-medium
wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx?download=true" \
    -O models/piper/en_US-amy-medium.onnx
wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json?download=true" \
    -O models/piper/en_US-amy-medium.onnx.json
```

#### TTS — Marathi (MMS-TTS)
```bash
# Auto-downloads on first run, or pre-cache:
python3 -c "
from transformers import VitsModel, AutoTokenizer
VitsModel.from_pretrained('facebook/mms-tts-mar')
AutoTokenizer.from_pretrained('facebook/mms-tts-mar')
print('Marathi TTS cached')
"
```

## Step 6: Run

```bash
source .venv/bin/activate
python ui/server.py
```

Open **http://localhost:8080** in a Chromium-based browser.

## Step 7: Verify

1. Page loads → splash screen → "Ready!"
2. Select **English → Hindi** in the language bar
3. Hold the mic button, say "Hello, I want to check my balance"
4. Release → see unified translation card with ▶ Original and ▶ Translation buttons
5. Click ▶ Original to hear your recorded voice
6. Click ▶ Translation to hear the Hindi TTS
7. Open Settings (⚙) → verify CPU/RAM stats display
8. Open sidebar (☰) → see your conversation in history

## Raspberry Pi 5 — Auto-start

### 1. Create systemd service
```bash
sudo tee /etc/systemd/system/bhashasakha.service << 'EOF'
[Unit]
Description=BhashaSakha Voice Translator
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/BhashaSakha
ExecStart=/home/pi/BhashaSakha/.venv/bin/python ui/server.py
Restart=always
RestartSec=5
Environment=OMP_NUM_THREADS=2

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable bhashasakha
sudo systemctl start bhashasakha
```

### 2. Kiosk Mode (Chromium fullscreen)
```bash
mkdir -p ~/.config/autostart
tee ~/.config/autostart/bhashasakha-kiosk.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=BhashaSakha Kiosk
Exec=chromium-browser --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required http://localhost:8080
EOF
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Mic access denied" | Must use `localhost` or HTTPS; check browser permissions |
| Hindi STT outputs English | Ensure `whisper-small` (not tiny) model is at `models/stt/whisper-small-int8/` |
| Marathi TTS robotic/silent | Check `torch` and `transformers` are installed; MMS-TTS needs both |
| `torch` install fails | Use `pip install torch --index-url https://download.pytorch.org/whl/cpu` |
| Slow processing (~20s) | Normal on x86 dev machines; RPi5 ARM will be 3-4x faster |
| WebSocket disconnects | Check firewall; ensure port 8080 is open |
| `piper` command not found | Run `pip install piper-tts`; ensure `.venv/bin/piper` exists |
| Models not found | Run `bash scripts/download_models.sh`; check paths match `models/` directory |
| `NLLB tokenizer` download | Needs internet on first run to cache tokenizer; pre-cache with download script |
