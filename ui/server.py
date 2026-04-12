"""BhashaSakha v6.1 — Optimized Offline Voice Translation Kiosk.

Pipeline: Whisper-small (forced language, VAD) → NLLB-200 → Piper/MMS-TTS.
Languages: English, Hindi, Marathi. Push-to-talk.
Optimizations: silence trimming, 15s max audio, persistent TTS, stage progress.
"""

import os, sys, io, time, json, base64, logging, subprocess, asyncio, gc
import numpy as np
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["OMP_NUM_THREADS"] = "2"
os.environ["OPENBLAS_NUM_THREADS"] = "2"

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="BhashaSakha")

_engines = {}
_ready = False
_loading = False
_piper_voices = {}  # Cached Piper voice objects

# Thread pool for pipeline stages
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="bs")

MAX_AUDIO_SEC = 15  # Max recording duration
MAX_AUDIO_SAMPLES = MAX_AUDIO_SEC * 16000

PIPER = {
    "hi": {
        "male": str(ROOT / "models/piper/hi_IN-rohan-medium.onnx"),
        "female": str(ROOT / "models/piper/hi_IN-swara-medium.onnx"),
    },
    "en": {
        "female": str(ROOT / "models/piper/en_US-amy-medium.onnx"),
        "male": str(ROOT / "models/piper/en_US-amy-medium.onnx"),
    }
}
PIPER_BIN = str(ROOT / ".venv/bin/piper")

NLLB = {"en": "eng_Latn", "hi": "hin_Deva", "mr": "mar_Deva"}
LANG_NAMES = {"en": "English", "hi": "Hindi", "mr": "Marathi"}


# ─── Engine Loading ───────────────────────────────────────

def load_engines():
    global _engines, _ready, _loading
    if _ready or _loading:
        return _engines if _ready else None
    _loading = True
    log.info("Loading engines...")

    from faster_whisper import WhisperModel
    t0 = time.monotonic()
    whisper = WhisperModel(
        "models/stt/whisper-small-int8",
        device="cpu", compute_type="int8", cpu_threads=2,
    )
    log.info(f"✓ Whisper-small: {(time.monotonic()-t0)*1000:.0f}ms")

    # Warmup with forced language (faster path)
    dummy = np.zeros(16000, dtype=np.float32)
    segs, _ = whisper.transcribe(dummy, beam_size=1, language="en", without_timestamps=True)
    for _ in segs: pass
    log.info("✓ Whisper warmed up")

    from src.translation.nllb_engine import NLLBEngine
    from src.translation.glossary import BankingGlossary
    from src.translation.cache import TranslationCache

    nllb = NLLBEngine(
        model_path="models/translation/nllb-200-distilled-600M-ct2-int8",
        tokenizer_name="facebook/nllb-200-distilled-600M",
    )
    nllb.load()
    nllb.warmup()
    log.info("✓ NLLB ready")

    # MMS-TTS for Marathi (VITS neural voice)
    mr_tts_model = None
    mr_tts_tokenizer = None
    mr_tts_sr = 16000
    try:
        from transformers import VitsModel, AutoTokenizer
        import torch
        t0 = time.monotonic()
        # Try offline first (kiosk mode), fall back to online
        try:
            mr_tts_model = VitsModel.from_pretrained("facebook/mms-tts-mar", local_files_only=True)
            mr_tts_tokenizer = AutoTokenizer.from_pretrained("facebook/mms-tts-mar", local_files_only=True)
        except Exception:
            log.info("MMS-TTS not cached locally, downloading...")
            mr_tts_model = VitsModel.from_pretrained("facebook/mms-tts-mar")
            mr_tts_tokenizer = AutoTokenizer.from_pretrained("facebook/mms-tts-mar")
        mr_tts_sr = mr_tts_model.config.sampling_rate
        log.info(f"✓ MMS-TTS Marathi: {(time.monotonic()-t0)*1000:.0f}ms")
    except Exception as e:
        log.warning(f"MMS-TTS Marathi failed: {e}")

    # Pre-load Piper voice objects for zero-latency TTS
    _load_piper_voices()

    _engines = {
        "whisper": whisper,
        "nllb": nllb,
        "glossary": BankingGlossary("config/banking_glossary.yaml"),
        "cache": TranslationCache(max_size=200),
        "mr_tts_model": mr_tts_model,
        "mr_tts_tokenizer": mr_tts_tokenizer,
        "mr_tts_sr": mr_tts_sr,
    }
    _ready = True
    _loading = False
    gc.collect()
    log.info("All engines ready!")
    return _engines


def _load_piper_voices():
    """Pre-load Piper voice objects for instant TTS (no subprocess)."""
    global _piper_voices
    try:
        from piper import PiperVoice
        loaded = set()
        for lang, variants in PIPER.items():
            for role, model_path in variants.items():
                if os.path.exists(model_path) and model_path not in loaded:
                    config_path = model_path + ".json"
                    try:
                        t0 = time.monotonic()
                        voice = PiperVoice.load(model_path, config_path=config_path, use_cuda=False)
                        _piper_voices[model_path] = voice
                        loaded.add(model_path)
                        log.info(f"✓ Piper {lang}/{role}: {(time.monotonic()-t0)*1000:.0f}ms")
                    except Exception as e:
                        log.warning(f"Piper load failed {lang}/{role}: {e}")
    except ImportError:
        log.warning("piper-tts library not available, will use subprocess fallback")


# ─── Audio Processing ────────────────────────────────────

def trim_silence_fast(audio: np.ndarray, threshold: float = 0.01) -> np.ndarray:
    """Fast silence trimming — remove leading/trailing silence."""
    frame_size = 480  # 30ms at 16kHz
    n_frames = len(audio) // frame_size
    if n_frames < 2:
        return audio

    # Find first non-silent frame
    start = 0
    for i in range(n_frames):
        chunk = audio[i * frame_size:(i + 1) * frame_size]
        if np.sqrt(np.mean(chunk ** 2)) > threshold:
            start = max(0, (i - 1) * frame_size)
            break

    # Find last non-silent frame
    end = len(audio)
    for i in range(n_frames - 1, -1, -1):
        chunk = audio[i * frame_size:(i + 1) * frame_size]
        if np.sqrt(np.mean(chunk ** 2)) > threshold:
            end = min(len(audio), (i + 2) * frame_size)
            break

    trimmed = audio[start:end]
    if len(trimmed) < 8000:  # < 0.5s after trim = probably silence
        return audio  # Return original, let Whisper handle it

    if len(trimmed) < len(audio) * 0.9:
        log.info(f"  Trimmed silence: {len(audio)/16000:.1f}s → {len(trimmed)/16000:.1f}s")

    return trimmed


def decode_audio(audio_bytes: bytes) -> np.ndarray:
    """Decode, resample, trim, and cap audio."""
    import soundfile as sf

    audio, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
    if audio.ndim > 1:
        audio = audio[:, 0]
    if sr != 16000:
        ratio = 16000 / sr
        n = int(len(audio) * ratio)
        audio = np.interp(np.linspace(0, len(audio)-1, n), np.arange(len(audio)), audio).astype(np.float32)

    # Trim leading/trailing silence
    audio = trim_silence_fast(audio)

    # Cap to MAX_AUDIO_SEC (safety net — client also limits)
    if len(audio) > MAX_AUDIO_SAMPLES:
        log.info(f"  Audio capped: {len(audio)/16000:.1f}s → {MAX_AUDIO_SEC}s")
        audio = audio[:MAX_AUDIO_SAMPLES]

    return audio


# ─── Pipeline Stages ─────────────────────────────────────

def do_stt(audio: np.ndarray, src_lang: str) -> dict:
    """STT stage — Whisper transcription with VAD."""
    engines = _engines
    dur = len(audio) / 16000

    if dur < 0.5:
        return {"type": "silence"}

    t0 = time.monotonic()
    segs, info = engines["whisper"].transcribe(
        audio, language=src_lang, beam_size=1,
        without_timestamps=True, condition_on_previous_text=False,
        vad_filter=True,  # Skip silence segments automatically
        vad_parameters={"min_silence_duration_ms": 300},
    )
    text = " ".join(s.text.strip() for s in segs).strip()
    stt_ms = round((time.monotonic() - t0) * 1000)

    if not text or len(text) < 2:
        return {"type": "silence"}

    log.info(f"STT [{src_lang}] ({stt_ms}ms, {dur:.1f}s): \"{text}\"")

    # Glossary correction
    text = engines["glossary"].correct_stt(text, src_lang)

    return {"type": "stt_done", "text": text, "stt_ms": stt_ms}


def do_translate(text: str, src_lang: str, tgt_lang: str) -> dict:
    """Translation stage — NLLB with caching."""
    engines = _engines
    src_code = NLLB[src_lang]
    tgt_code = NLLB[tgt_lang]

    cached = engines["cache"].get(text, src_code, tgt_code)
    if cached:
        log.info(f"  → [{tgt_lang}] (cached): \"{cached}\"")
        return {"type": "trans_done", "translated": cached, "trans_ms": 0}

    t0 = time.monotonic()
    translated = engines["nllb"].translate(text, src_code, tgt_code)
    trans_ms = round((time.monotonic() - t0) * 1000)
    engines["cache"].put(text, src_code, tgt_code, translated)

    log.info(f"  → [{tgt_lang}] ({trans_ms}ms): \"{translated}\"")
    return {"type": "trans_done", "translated": translated, "trans_ms": trans_ms}


def do_tts(text: str, lang: str, gender: str = None, age: int = None) -> dict:
    """TTS stage — Piper/MMS-TTS."""
    t0 = time.monotonic()
    tts_b64 = gen_tts(text, lang, gender, age)
    tts_ms = round((time.monotonic() - t0) * 1000)
    log.info(f"  TTS [{lang}] ({tts_ms}ms)")
    return {"type": "tts_done", "tts": tts_b64, "tts_ms": tts_ms}


def gen_tts(text: str, lang: str, gender: str = None, age: int = None) -> str:
    """TTS: Cached Piper voices for hi/en, MMS-TTS for mr."""
    engines = _engines

    # Marathi: MMS-TTS (neural VITS voice)
    if lang == "mr" and engines.get("mr_tts_model"):
        try:
            import torch
            model = engines["mr_tts_model"]
            tokenizer = engines["mr_tts_tokenizer"]
            sr = engines["mr_tts_sr"]
            inputs = tokenizer(text, return_tensors="pt")
            with torch.no_grad():
                waveform = model(**inputs).waveform
            audio = waveform.squeeze().numpy()
            import scipy
            buf = io.BytesIO()
            scipy.io.wavfile.write(buf, rate=sr, data=audio)
            return base64.b64encode(buf.getvalue()).decode()
        except Exception as e:
            log.error(f"MMS-TTS Marathi error: {e}")

    # Hindi/English: use cached Piper voice objects (no subprocess!)
    if lang in PIPER:
        model_path = PIPER[lang].get(gender, PIPER[lang].get("male") or PIPER[lang].get("female"))
        if model_path and model_path in _piper_voices:
            try:
                import wave
                voice = _piper_voices[model_path]
                buf = io.BytesIO()
                with wave.open(buf, "wb") as wav_file:
                    voice.synthesize_wav(text, wav_file)
                return base64.b64encode(buf.getvalue()).decode()
            except Exception as e:
                log.error(f"Piper voice error: {e}")

        # Fallback: subprocess Piper (if cached voice failed)
        if model_path and os.path.exists(model_path):
            try:
                cmd = [PIPER_BIN, "--model", model_path, "--output_file", "/tmp/bstts.wav"]
                if age and age > 60:
                    cmd.extend(["--length_scale", "1.2"])
                r = subprocess.run(
                    cmd, input=text, capture_output=True, text=True, timeout=20, cwd=str(ROOT),
                )
                if r.returncode == 0 and os.path.exists("/tmp/bstts.wav"):
                    with open("/tmp/bstts.wav", "rb") as f:
                        return base64.b64encode(f.read()).decode()
            except Exception as e:
                log.error(f"Piper subprocess error: {e}")

    # espeak-ng fallback
    try:
        voice_name = {"hi": "hi", "mr": "mr", "en": "en"}.get(lang, "en")
        r = subprocess.run(
            ["espeak-ng", "-v", voice_name, "-s", "130", "-p", "45", "--stdout", text],
            capture_output=True, timeout=10,
        )
        if r.returncode == 0 and r.stdout:
            return base64.b64encode(r.stdout).decode()
    except:
        pass
    return None


# ─── Routes ──────────────────────────────────────────────
static = ROOT / "ui/static"
app.mount("/static", StaticFiles(directory=str(static)), name="static")


@app.get("/", response_class=HTMLResponse)
async def index():
    return (static / "index.html").read_text()


@app.get("/api/status")
async def api_status():
    return {"ready": _ready}


@app.get("/api/system")
async def api_system():
    import psutil
    vm = psutil.virtual_memory()
    cpu = psutil.cpu_percent(interval=0.5)
    return {
        "cpu_pct": cpu,
        "ram_used_mb": round(vm.used / 1024 / 1024),
        "ram_total_mb": round(vm.total / 1024 / 1024),
        "ram_pct": vm.percent,
        "models": {
            "stt": "Whisper-small (int8)",
            "translation": "NLLB-200 (600M, int8)",
            "tts_hi": "Piper (VITS, hi_IN-rohan)",
            "tts_en": "Piper (VITS, en_US-amy)",
            "tts_mr": "MMS-TTS (VITS, mar)",
        },
        "ready": _ready,
    }


# ─── WebSocket — Stage-by-stage pipeline ────────────────

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    log.info("Client connected")

    if not _ready:
        await websocket.send_json({"type": "loading"})
        load_engines()
    await websocket.send_json({"type": "ready"})

    session_meta = {}
    loop = asyncio.get_event_loop()

    try:
        while True:
            msg = await websocket.receive()
            if "text" in msg:
                try:
                    data = json.loads(msg["text"])
                    if data.get("type") == "meta":
                        session_meta["gender"] = data.get("gender")
                        if data.get("age"):
                            session_meta["age"] = int(data["age"])
                except Exception as e:
                    log.error(f"Meta parse error: {e}")

            if "bytes" in msg:
                raw = msg["bytes"]
                src_byte = raw[0]
                tgt_byte = raw[1]
                src = {0:"en", 1:"hi", 2:"mr"}.get(src_byte, "en")
                tgt = {0:"en", 1:"hi", 2:"mr"}.get(tgt_byte, "en")
                audio_data = raw[2:]

                g = session_meta.get("gender")
                a = session_meta.get("age")
                start = time.monotonic()

                # Stage 1: Decode + trim + cap audio
                try:
                    audio = await loop.run_in_executor(_executor, decode_audio, audio_data)
                except Exception as e:
                    await websocket.send_json({"type": "error", "msg": str(e)})
                    continue

                dur = len(audio) / 16000
                if dur < 0.5:
                    await websocket.send_json({"type": "silence"})
                    continue

                # Stage 2: STT
                await websocket.send_json({
                    "type": "stage", "stage": "stt",
                    "msg": "Recognizing speech...",
                })
                stt_result = await loop.run_in_executor(_executor, do_stt, audio, src)

                if stt_result["type"] == "silence":
                    await websocket.send_json({"type": "silence"})
                    continue

                text = stt_result["text"]
                stt_ms = stt_result["stt_ms"]

                # Stage 3: Translation
                await websocket.send_json({
                    "type": "stage", "stage": "translate",
                    "msg": f"Translating to {LANG_NAMES.get(tgt, tgt)}...",
                })
                trans_result = await loop.run_in_executor(
                    _executor, do_translate, text, src, tgt
                )
                translated = trans_result["translated"]
                trans_ms = trans_result["trans_ms"]

                # Stage 4: TTS
                await websocket.send_json({
                    "type": "stage", "stage": "tts",
                    "msg": "Generating speech...",
                })
                tts_result = await loop.run_in_executor(
                    _executor, do_tts, translated, tgt, g, a
                )
                tts_b64 = tts_result["tts"]
                tts_ms = tts_result.get("tts_ms", 0)

                total = round((time.monotonic() - start) * 1000)
                log.info(f"  TOTAL: {total}ms")

                await websocket.send_json({
                    "type": "result",
                    "src_text": text,
                    "src_lang": src,
                    "tgt_text": translated,
                    "tgt_lang": tgt,
                    "tts": tts_b64,
                    "stt_ms": stt_ms,
                    "trans_ms": trans_ms,
                    "total_ms": total,
                })

                # Cleanup after heavy inference
                gc.collect()

    except WebSocketDisconnect:
        log.info("Client disconnected")
    except Exception as e:
        log.error(f"WS error: {e}")


@app.on_event("startup")
async def startup():
    asyncio.create_task(asyncio.to_thread(load_engines))


if __name__ == "__main__":
    import uvicorn

    cert = str(ROOT / "cert.pem")
    key = str(ROOT / "key.pem")

    kwargs = {"host": "0.0.0.0", "port": 8080, "log_level": "info"}

    if os.path.exists(cert) and os.path.exists(key):
        print("🔒 Starting with SSL/HTTPS...")
        kwargs.update({
            "ssl_keyfile": key,
            "ssl_certfile": cert
        })
    else:
        print("⚠️ Starting without SSL! Mic access will be blocked on non-localhost IPs.")

    uvicorn.run(app, **kwargs)
