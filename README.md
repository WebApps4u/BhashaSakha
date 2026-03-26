# BhashaSakha — Offline Voice Translation Kiosk

> 🎤 Real-time voice translation between **English**, **Hindi**, and **Marathi** — 100% offline, designed for banking kiosks.

---

## ✨ Features

- **Push-to-talk voice translation** — hold mic, speak, release to translate
- **3-language support** — English ↔ Hindi ↔ Marathi (any direction)
- **Natural TTS** — Piper VITS for Hindi/English, MMS-TTS VITS for Marathi
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
git clone <repo-url>
cd bhashasakha

# 2. Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Download models (first run only)
python scripts/download_models.py

# 5. Run
python ui/server.py
```

Open **http://localhost:8080** in your browser.

## 📁 Project Structure

```
bhashasakha/
├── config/
│   └── banking_glossary.yaml      # Banking term corrections
├── models/
│   ├── stt/
│   │   └── whisper-small-int8/    # Whisper STT model
│   ├── translation/
│   │   └── nllb-200-...-ct2-int8/ # NLLB translation model
│   └── piper/
│       ├── hi_IN-rohan-medium.*   # Hindi TTS voice
│       └── en_US-amy-medium.*     # English TTS voice
├── src/
│   └── translation/
│       ├── nllb_engine.py         # NLLB translation engine
│       ├── glossary.py            # Banking glossary
│       └── cache.py               # Translation cache
├── ui/
│   ├── server.py                  # FastAPI server (main)
│   └── static/
│       ├── index.html             # App HTML
│       ├── style.css              # Premium CSS
│       └── app.js                 # Client JS
├── docs/
│   ├── ARCHITECTURE.md            # System architecture
│   └── SETUP.md                   # Detailed setup guide
├── requirements.txt               # Python dependencies
├── .gitignore                     # Git ignore rules
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
| **STT** | Whisper-small (int8) | ~400MB | Speech-to-text, forced language |
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
- `OMP_NUM_THREADS=2` — CPU threads for inference

## 📱 Target Hardware

Designed for **Raspberry Pi 5** (8GB RAM) with:
- ~2-3s STT on ARM64
- ~1-2s translation
- ~2-3s TTS
- **Total: ~5-8s per translation** (vs ~15-20s on dev x86 CPU)

## 📄 License

MIT License — see [LICENSE](LICENSE).
