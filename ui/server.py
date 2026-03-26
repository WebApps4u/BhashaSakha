"""BhashaSakha v6 — Offline Voice Translation Kiosk.

Pipeline: Whisper-small (forced language) → NLLB-200 → Piper/MMS-TTS.
Languages: English, Hindi, Marathi. Push-to-talk.
TTS: Piper VITS (hi/en), MMS-TTS VITS (mr), espeak-ng (fallback).
"""

import os, sys, io, time, json, base64, logging, subprocess, asyncio
import numpy as np
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["OMP_NUM_THREADS"] = "2"

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="BhashaSakha")

_engines = {}
_ready = False
_loading = False

PIPER = {
    "hi": str(ROOT / "models/piper/hi_IN-rohan-medium.onnx"),
    "en": str(ROOT / "models/piper/en_US-amy-medium.onnx"),
}
PIPER_BIN = str(ROOT / ".venv/bin/piper")

NLLB = {"en": "eng_Latn", "hi": "hin_Deva", "mr": "mar_Deva"}
LANG_NAMES = {"en": "English", "hi": "Hindi", "mr": "Marathi"}


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
    try:
        from transformers import VitsModel, AutoTokenizer
        import torch
        t0 = time.monotonic()
        mr_tts_model = VitsModel.from_pretrained("facebook/mms-tts-mar")
        mr_tts_tokenizer = AutoTokenizer.from_pretrained("facebook/mms-tts-mar")
        mr_tts_sr = mr_tts_model.config.sampling_rate
        log.info(f"✓ MMS-TTS Marathi: {(time.monotonic()-t0)*1000:.0f}ms")
    except Exception as e:
        log.warning(f"MMS-TTS Marathi failed: {e}")
        mr_tts_model = None
        mr_tts_tokenizer = None
        mr_tts_sr = 16000

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
    log.info("All engines ready!")
    return _engines


def process(audio_bytes: bytes, src_lang: str, tgt_lang: str) -> dict:
    """Full pipeline: STT → translate → TTS. Single target language."""
    engines = load_engines()
    if not engines:
        return {"type": "error", "msg": "Loading..."}

    import soundfile as sf
    start = time.monotonic()

    # Decode audio
    try:
        audio, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
        if audio.ndim > 1:
            audio = audio[:, 0]
        if sr != 16000:
            ratio = 16000 / sr
            n = int(len(audio) * ratio)
            audio = np.interp(np.linspace(0, len(audio)-1, n), np.arange(len(audio)), audio).astype(np.float32)
    except Exception as e:
        return {"type": "error", "msg": str(e)}

    dur = len(audio) / 16000
    if dur < 0.5:
        return {"type": "silence"}

    # STT — forced language = correct script + faster
    t0 = time.monotonic()
    segs, info = engines["whisper"].transcribe(
        audio, language=src_lang, beam_size=1,
        without_timestamps=True, condition_on_previous_text=False,
    )
    text = " ".join(s.text.strip() for s in segs).strip()
    stt_ms = round((time.monotonic() - t0) * 1000)

    if not text or len(text) < 2:
        return {"type": "silence"}

    log.info(f"STT [{src_lang}] ({stt_ms}ms, {dur:.1f}s): \"{text}\"")

    # Glossary
    text = engines["glossary"].correct_stt(text, src_lang)

    # Translate to target language only
    src_code = NLLB[src_lang]
    tgt_code = NLLB[tgt_lang]

    cached = engines["cache"].get(text, src_code, tgt_code)
    if cached:
        translated = cached
        trans_ms = 0
    else:
        t0 = time.monotonic()
        translated = engines["nllb"].translate(text, src_code, tgt_code)
        trans_ms = round((time.monotonic() - t0) * 1000)
        engines["cache"].put(text, src_code, tgt_code, translated)

    log.info(f"  → [{tgt_lang}] ({trans_ms}ms): \"{translated}\"")

    # TTS for translated text
    t0 = time.monotonic()
    tts_b64 = gen_tts(translated, tgt_lang)
    tts_ms = round((time.monotonic() - t0) * 1000)
    log.info(f"  TTS [{tgt_lang}] ({tts_ms}ms)")

    total = round((time.monotonic() - start) * 1000)
    log.info(f"  TOTAL: {total}ms")

    return {
        "type": "result",
        "src_text": text,
        "src_lang": src_lang,
        "tgt_text": translated,
        "tgt_lang": tgt_lang,
        "tts": tts_b64,
        "stt_ms": stt_ms,
        "trans_ms": trans_ms,
        "total_ms": total,
    }


def gen_tts(text: str, lang: str) -> str:
    """TTS: Piper for hi/en, MMS-TTS for mr."""
    engines = load_engines()

    # Marathi: use MMS-TTS (neural VITS voice)
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
            # Convert to 16-bit WAV
            import scipy
            scipy.io.wavfile.write("/tmp/bstts_mr.wav", rate=sr, data=audio)
            with open("/tmp/bstts_mr.wav", "rb") as f:
                return base64.b64encode(f.read()).decode()
        except Exception as e:
            log.error(f"MMS-TTS Marathi error: {e}")

    # Hindi/English: use Piper (neural VITS voice)
    if lang in PIPER and os.path.exists(PIPER[lang]):
        try:
            r = subprocess.run(
                [PIPER_BIN, "--model", PIPER[lang], "--output_file", "/tmp/bstts.wav"],
                input=text, capture_output=True, text=True, timeout=20, cwd=str(ROOT),
            )
            if r.returncode == 0 and os.path.exists("/tmp/bstts.wav"):
                with open("/tmp/bstts.wav", "rb") as f:
                    return base64.b64encode(f.read()).decode()
        except Exception as e:
            log.error(f"Piper error: {e}")

    # espeak-ng fallback
    try:
        voice = {"hi": "hi", "mr": "mr", "en": "en"}.get(lang, "en")
        r = subprocess.run(
            ["espeak-ng", "-v", voice, "-s", "130", "-p", "45", "--stdout", text],
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
    uptime = time.monotonic()
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


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    log.info("Client connected")

    if not _ready:
        await websocket.send_json({"type": "loading"})
        load_engines()
    await websocket.send_json({"type": "ready"})

    try:
        while True:
            msg = await websocket.receive()
            if "bytes" in msg:
                raw = msg["bytes"]
                # First 2 bytes: src_lang, tgt_lang (0=en, 1=hi, 2=mr)
                src_byte = raw[0]
                tgt_byte = raw[1]
                src = {0:"en", 1:"hi", 2:"mr"}.get(src_byte, "en")
                tgt = {0:"en", 1:"hi", 2:"mr"}.get(tgt_byte, "en")
                audio = raw[2:]

                await websocket.send_json({"type": "processing", "src": src, "tgt": tgt})
                result = await asyncio.get_event_loop().run_in_executor(
                    None, process, audio, src, tgt
                )
                await websocket.send_json(result)
    except WebSocketDisconnect:
        log.info("Client disconnected")
    except Exception as e:
        log.error(f"WS error: {e}")


@app.on_event("startup")
async def startup():
    asyncio.create_task(asyncio.to_thread(load_engines))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080, log_level="info")
