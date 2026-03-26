# System Architecture

## Overview

BhashaSakha is a real-time offline voice translation system designed for banking kiosk deployments. It runs entirely on-device with no internet connectivity required after initial model download.

## Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT (Browser)                         │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────────┐  │
│  │ Push-to-  │───▶│  WebM    │───▶│  WAV Encoding        │  │
│  │ Talk Rec  │    │  Chunks  │    │  (16kHz, 16-bit PCM) │  │
│  └──────────┘    └──────────┘    └─────────┬────────────┘  │
│                                            │               │
│                                   [2-byte header + WAV]    │
│                                            │               │
│  ┌──────────────────────────────┐          │               │
│  │  Unified Translation Card   │◀─────────┼──── JSON      │
│  │  + Original Voice Playback  │          │               │
│  │  + TTS Audio (base64 WAV)   │          │               │
│  └──────────────────────────────┘          │               │
└────────────────────────────────────────────┼───────────────┘
                                             │
                              WebSocket (binary + JSON)
                                             │
┌────────────────────────────────────────────┼───────────────┐
│                    SERVER (Python)          │               │
│                                            ▼               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. DECODE: Parse header (src_lang, tgt_lang)       │   │
│  │     WAV bytes → float32 numpy array (16kHz)         │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           ▼                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  2. STT: Whisper-small (int8, CTranslate2)          │   │
│  │     • Forced language (no detection overhead)        │   │
│  │     • beam_size=1 (fastest decoding)                 │   │
│  │     • CPU: 2 threads                                 │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           ▼                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  3. GLOSSARY: Banking term correction                │   │
│  │     • STT output → canonical banking terms           │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           ▼                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  4. TRANSLATE: NLLB-200-distilled-600M (int8)       │   │
│  │     • 200 language support                           │   │
│  │     • LRU cache (200 entries) for repeat queries     │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           ▼                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  5. TTS: Language-specific engine                    │   │
│  │     • Hindi: Piper VITS (hi_IN-rohan-medium)        │   │
│  │     • English: Piper VITS (en_US-amy-medium)        │   │
│  │     • Marathi: MMS-TTS VITS (facebook/mms-tts-mar)  │   │
│  │     • Fallback: espeak-ng                            │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Forced Language STT
Whisper's auto-detect mode often misidentifies Hindi/Marathi speech as other languages on smaller models. By forcing the language parameter, we:
- Skip the language detection pass (30% faster)
- Ensure correct script output (Devanagari for Hindi/Marathi)
- Eliminate false language detections

### 2. Push-to-Talk vs Always-Listening
Previous iterations used Voice Activity Detection (VAD) for always-listening. This was replaced with push-to-talk because:
- Bank environments are noisy (multiple conversations)
- VAD triggers on ambient noise
- Push-to-talk gives precise audio boundaries
- Users know exactly when recording starts/stops

### 3. Global Audio Store (JS)
Original voice playback uses a global `audioStore` map instead of embedding blob URLs in HTML attributes:
- Blob URLs contain `://` which break HTML attribute strings
- Base64 TTS strings are too large for inline onclick handlers
- Map-based approach uses simple string keys for reliable playback

### 4. CTranslate2 Quantization
Both Whisper and NLLB models use int8 quantization via CTranslate2:
- ~3x smaller model files
- ~2x faster inference on CPU
- Minimal quality loss for our use case

## Data Flow

```
1. User holds mic button
2. Browser captures audio via MediaRecorder (WebM/Opus)
3. Client converts to WAV (16kHz, 16-bit PCM) using OfflineAudioContext
4. Client prepends 2-byte header: [src_lang_id, tgt_lang_id]
5. Binary message sent via WebSocket
6. Server decodes WAV, runs Whisper STT with forced language
7. Banking glossary corrects domain-specific terms
8. NLLB translates to target language (with LRU cache check)
9. TTS generates speech audio for translated text
10. JSON response with source text, translation, and base64 WAV audio
11. Client renders unified card with both play buttons
12. Auto-plays TTS if unmuted
```

## Performance (Development x86 CPU)

| Stage | Time | Notes |
|-------|------|-------|
| STT | 8-15s | Whisper-small on CPU without GPU |
| Translation | 2-5s | NLLB-200 int8 |
| TTS | 2-5s | Piper/MMS-TTS |
| **Total** | **12-25s** | **Will be 5-8s on RPi5** |

## Scalability

The system is designed for single-user kiosk operation. For multi-user:
- Each WebSocket connection gets its own processing thread
- Models are shared (read-only inference)
- Translation cache is shared across connections
