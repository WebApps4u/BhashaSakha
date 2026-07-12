# BhashaSakha — Offline Voice Translation Kiosk

> 🎤 Real-time voice translation between **English**, **Hindi**, and **Marathi** — 100% offline, designed for banking kiosks.

---

## ✨ Features

- **Push-to-talk voice translation** — hold mic, speak (up to 30s), release to translate
- **Typed text translation** — type instead of speaking, same pipeline
- **Live streaming results** — recognized words appear as Whisper decodes, translation shows before TTS, and speech playback starts on the first sentence while the rest is still synthesizing
- **3-language support** — English ↔ Hindi ↔ Marathi (any direction)
- **Sentence-batch translation** — long speech is split into sentences and batch-translated (NLLB compresses/drops content if fed whole paragraphs)
- **Natural TTS** — Piper VITS for Hindi/English; Marathi uses the Hindi Piper voice by default for speed (set `BS_MR_TTS=mms` for the neural Marathi voice, better pronunciation but far slower on Pi)
- **Conversation history** — saved locally, ChatGPT-style sidebar
- **Original voice playback** — replay your recorded speech alongside translation
- **System monitoring** — live CPU/RAM stats in settings panel
- **100% offline** — no internet required after setup
- **Copy to clipboard** — one-click copy of translations
- **Premium dark UI** — Zara-inspired minimal design with smooth animations

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Browser (Push-to-Talk WebSocket)                       │
├──────────────────────────────────────────────────────────┤
│  FastAPI Server (Python)                                │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Whisper-small   │  │ NLLB-200     │  │ Piper /     │ │
│  │ (STT, int8)     │→│ (Translation)│→│ MMS-TTS     │ │
│  │ forced language │  │ 600M, int8   │  │ (TTS)       │ │
│  └────────────────┘  └──────────────┘  └─────────────┘ │
└──────────────────────────────────────────────────────────┘
```

## 📋 Prerequisites

- **Python 3.10+**
- **espeak-ng** (fallback TTS): `sudo apt install espeak-ng`
- **~4GB RAM** minimum
- **x86_64 or ARM64** (Raspberry Pi 5 supported)

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/WebApps4u/BhashaSakha.git
cd BhashaSakha

# 2. Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install dependencies
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt

# 4. Download models (first run only)
bash scripts/download_models.sh

# 5. Run
python ui/server.py
```

Open **http://localhost:8080** in your browser.

## 📁 Project Structure

```
bhashasakha/
├── config/
│   ├── banking_glossary.yaml      # Banking term corrections
│   └── config.yaml                # App configuration
├── deployment/
│   ├── bhashasakha.service        # systemd service file
│   ├── install.sh                 # Automated installer
│   ├── logrotate.conf             # Log rotation config
│   └── update.sh                  # Update script
├── docs/
│   ├── ARCHITECTURE.md            # System architecture
│   └── SETUP.md                   # Detailed setup guide
├── models/                        # Downloaded separately (gitignored)
│   ├── stt/whisper-small-int8/    # Whisper STT model
│   ├── translation/nllb-...-int8/ # NLLB translation model
│   ├── piper/                     # Piper TTS voices (hi/en)
│   └── vad/silero_vad.onnx        # Voice activity detection
├── scripts/
│   ├── download_models.sh         # Model download script
│   ├── benchmark.py               # Performance benchmarks
│   ├── integration_test.py        # Integration tests
│   └── monitor.py                 # System monitor
├── src/
│   ├── audio/                     # Audio capture & processing
│   ├── core/                      # Pipeline, session, state machine
│   ├── stt/                       # Whisper STT engine
│   ├── translation/               # NLLB engine, glossary, cache
│   ├── tts/                       # Piper TTS engine
│   ├── display/                   # Text display utilities
│   ├── sensors/                   # Proximity sensor support
│   └── utils/                     # Health, logging, profiler
├── tests/                         # Unit & integration tests
├── ui/
│   ├── server.py                  # FastAPI server (main entry)
│   └── static/
│       ├── index.html             # App HTML
│       ├── style.css              # Premium dark CSS
│       └── app.js                 # Client JavaScript
├── requirements.txt               # Python dependencies
├── setup.py                       # Package setup
├── .gitignore                     # Git ignore rules
├── LICENSE                        # MIT License
└── README.md                      # This file
```

## 🎯 Usage

1. **Select languages** — choose source and target from the top bar
2. **Hold the mic** — press and hold the purple microphone button
3. **Speak clearly** — say your sentence in the selected source language
4. **Release** — the system will recognize, translate, and speak the result
5. **Play back** — use `▶ Original` to hear your voice, `▶ Translation` to hear TTS

## ⚙️ AI Models

| Component | Model | Size | Purpose |
|-----------|-------|------|---------|
| **STT (hi/mr)** | Whisper-small (int8) | ~400MB | Speech-to-text, forced language |
| **STT (en)** | Whisper-base (int8) | ~75MB | ~3x faster; English-only (base garbles Hindi/Marathi) |
| **Translation** | NLLB-200-distilled-600M (int8) | ~600MB | Multilingual translation |
| **TTS (Hindi)** | Piper VITS hi_IN-rohan | ~60MB | Natural Hindi speech |
| **TTS (English)** | Piper VITS en_US-amy | ~60MB | Natural English speech |
| **TTS (Marathi)** | facebook/mms-tts-mar | ~75MB | Natural Marathi speech |

## 🔧 Configuration

### Banking Glossary
Edit `config/banking_glossary.yaml` to add domain-specific term corrections:

```yaml
terms:
  - canonical: "account balance"
    aliases: ["account parlance", "a/c balance"]
    translations:
      hi: "खाता शेष"
      mr: "खाते शिल्लक"
```

### Server Settings
Environment variables:
- `BS_STT_MODEL` — override the Whisper model (default: local `whisper-small-int8`; do **not** use `tiny`/`base` for Hindi/Marathi — tiny hallucinates and base falls back to Urdu script)

## 📱 Target Hardware

Designed for **Raspberry Pi 5** (4 cores, all used per pipeline stage):
- STT (whisper-small int8): ~1.5–2x realtime, streamed word-by-word
- Translation (NLLB, sentence batch): ~1-2s per sentence
- TTS: first sentence plays while the rest synthesizes
- The UI shows recognized text and translation as soon as each stage finishes, so perceived wait is the STT time, not the whole pipeline

## 📄 License

MIT License — see [LICENSE](LICENSE).
