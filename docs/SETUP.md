# Setup Guide

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **OS** | Ubuntu 22.04+ / Raspbian Bookworm | Ubuntu 24.04 / Raspbian Bookworm |
| **Python** | 3.10 | 3.11+ |
| **RAM** | 4GB | 8GB |
| **Storage** | 3GB (models) | 5GB |
| **CPU** | ARM64 / x86_64 | Raspberry Pi 5 (8GB) |

## Step 1: System Dependencies

```bash
# Ubuntu / Debian / Raspberry Pi OS
sudo apt update
sudo apt install -y espeak-ng python3-venv python3-pip git wget unzip
```

## Step 2: Clone Repository

```bash
git clone <repo-url>
cd bhashasakha
```

## Step 3: Python Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
```

## Step 4: Install Dependencies

```bash
# For x86_64 (development machine)
pip install -r requirements.txt

# For Raspberry Pi 5 (ARM64) — use CPU-only PyTorch
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

## Step 5: Download Models

### STT Model (Whisper-small, int8)
```bash
mkdir -p models/stt
ct2-opus-mt-download --model Systran/faster-whisper-small \
    --output_dir models/stt/whisper-small-int8 \
    --quantization int8
```

Or download pre-converted:
```bash
pip install huggingface_hub
python3 -c "
from huggingface_hub import snapshot_download
snapshot_download('Systran/faster-whisper-small', local_dir='models/stt/whisper-small-int8')
"
```

### Translation Model (NLLB-200, int8)
```bash
mkdir -p models/translation
python3 -c "
import ctranslate2
ct2.converters.TransformersConverter('facebook/nllb-200-distilled-600M').convert(
    'models/translation/nllb-200-distilled-600M-ct2-int8',
    quantization='int8'
)
"
```

### TTS Models (Piper voices)
```bash
mkdir -p models/piper

# Hindi voice
wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/rohan/medium/hi_IN-rohan-medium.onnx?download=true" \
    -O models/piper/hi_IN-rohan-medium.onnx
wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/rohan/medium/hi_IN-rohan-medium.onnx.json?download=true" \
    -O models/piper/hi_IN-rohan-medium.onnx.json

# English voice
wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx?download=true" \
    -O models/piper/en_US-amy-medium.onnx
wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json?download=true" \
    -O models/piper/en_US-amy-medium.onnx.json
```

### Marathi TTS (auto-downloaded)
The MMS-TTS Marathi model (`facebook/mms-tts-mar`) is automatically downloaded from HuggingFace on first run.

## Step 6: Run

```bash
source .venv/bin/activate
python ui/server.py
```

Open **http://localhost:8080** in a Chromium-based browser.

## Step 7: Verify

1. Page loads → splash screen → "Ready!"
2. Select English → Hindi in the language bar
3. Hold the mic button, say "Hello, I want to check my balance"
4. Release → see translation card with both playback buttons
5. Open Settings (⚙) → verify CPU/RAM stats display

## Raspberry Pi 5 Specific

### Auto-start on boot
Create `/etc/systemd/system/bhashasakha.service`:
```ini
[Unit]
Description=BhashaSakha Voice Translator
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/bhashasakha
ExecStart=/home/pi/bhashasakha/.venv/bin/python ui/server.py
Restart=always
RestartSec=5
Environment=OMP_NUM_THREADS=2

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable bhashasakha
sudo systemctl start bhashasakha
```

### Kiosk Mode (Chromium fullscreen)
```bash
# Add to ~/.config/autostart/kiosk.desktop
chromium-browser --kiosk --noerrdialogs --disable-infobars http://localhost:8080
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Mic access denied" | Use HTTPS or localhost; check browser permissions |
| Hindi STT outputs English | Ensure whisper-small (not tiny) is loaded |
| Marathi TTS robotic | Check that `torch` and `transformers` are installed for MMS-TTS |
| Slow processing | Normal on x86 dev machines; RPi5 ARM is 3-4x faster |
| WebSocket disconnects | Check firewall; ensure port 8080 is open |
