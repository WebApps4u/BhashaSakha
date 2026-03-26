"""Configuration loader with validation for BhashaSakha.

Loads YAML config and provides typed access to all settings.
Designed for Raspberry Pi 5 constraints — validates memory budgets
and hardware availability at startup.
"""

import os
import yaml
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from pathlib import Path


@dataclass
class AudioConfig:
    input_device: Optional[int] = None
    output_device: Optional[int] = None
    sample_rate: int = 16000
    channels: int = 1
    buffer_duration_sec: int = 30
    frame_duration_ms: int = 30

    @property
    def frame_samples(self) -> int:
        """Number of samples per VAD frame."""
        return int(self.sample_rate * self.frame_duration_ms / 1000)

    @property
    def buffer_samples(self) -> int:
        """Total samples in ring buffer."""
        return self.sample_rate * self.buffer_duration_sec


@dataclass
class VADConfig:
    model_path: str = "models/vad/silero_vad.onnx"
    threshold: float = 0.5
    min_speech_ms: int = 500
    max_speech_ms: int = 30000
    silence_endpoint_ms: int = 600
    pre_speech_pad_ms: int = 300
    post_speech_pad_ms: int = 100


@dataclass
class STTConfig:
    model_path: str = "models/stt/whisper-small-int8"
    compute_type: str = "int8"
    beam_size: int = 3
    best_of: int = 1
    without_timestamps: bool = True
    condition_on_previous_text: bool = False
    language: Optional[str] = None
    min_confidence: float = 0.5


@dataclass
class LanguageInfo:
    code: str            # NLLB code e.g. "hin_Deva"
    whisper_code: str    # Whisper code e.g. "hi"
    name: str            # Display name e.g. "Hindi"
    piper_voice: str = ""  # Piper voice ID


@dataclass
class TranslationConfig:
    model_path: str = "models/translation/nllb-200-distilled-600M-ct2-int8"
    tokenizer_name: str = "facebook/nllb-200-distilled-600M"
    beam_size: int = 2
    max_decoding_length: int = 128
    supported_languages: List[LanguageInfo] = field(default_factory=list)


@dataclass
class VoiceConfig:
    model: str
    config: str


@dataclass
class TTSConfig:
    voices: Dict[str, VoiceConfig] = field(default_factory=dict)
    default_speed: float = 1.0
    slow_speed: float = 0.8


@dataclass
class ProximityConfig:
    enabled: bool = True
    trigger_pin: int = 23
    echo_pin: int = 24
    activation_cm: int = 100
    deactivation_cm: int = 200
    deactivation_delay_sec: int = 30
    poll_interval_ms: int = 500


@dataclass
class SessionConfig:
    idle_timeout_sec: int = 120
    max_duration_sec: int = 1800
    confusion_threshold: int = 2


@dataclass
class GlossaryConfig:
    path: str = "config/banking_glossary.yaml"
    fuzzy_match_threshold: int = 2
    enabled: bool = True


@dataclass
class HealthConfig:
    monitor_interval_sec: int = 30
    max_cpu_temp_c: int = 80
    max_memory_percent: int = 85
    auto_restart_on_oom: bool = True


@dataclass
class PerformanceConfig:
    omp_num_threads: int = 2
    preload_all_models: bool = True
    warmup_on_boot: bool = True


@dataclass
class SystemConfig:
    name: str = "BhashaSakha"
    version: str = "1.0.0"
    log_level: str = "INFO"
    log_to_file: bool = False
    display_enabled: bool = False


@dataclass
class AppConfig:
    """Root configuration container."""
    system: SystemConfig = field(default_factory=SystemConfig)
    audio: AudioConfig = field(default_factory=AudioConfig)
    vad: VADConfig = field(default_factory=VADConfig)
    stt: STTConfig = field(default_factory=STTConfig)
    translation: TranslationConfig = field(default_factory=TranslationConfig)
    tts: TTSConfig = field(default_factory=TTSConfig)
    proximity: ProximityConfig = field(default_factory=ProximityConfig)
    session: SessionConfig = field(default_factory=SessionConfig)
    glossary: GlossaryConfig = field(default_factory=GlossaryConfig)
    health: HealthConfig = field(default_factory=HealthConfig)
    performance: PerformanceConfig = field(default_factory=PerformanceConfig)

    # Runtime paths
    base_dir: str = ""

    def resolve_path(self, relative_path: str) -> str:
        """Resolve a relative path against the project base directory."""
        if os.path.isabs(relative_path):
            return relative_path
        return os.path.join(self.base_dir, relative_path)


def _parse_languages(raw_langs: list) -> List[LanguageInfo]:
    """Parse language configuration entries."""
    languages = []
    for entry in raw_langs:
        languages.append(LanguageInfo(
            code=entry["code"],
            whisper_code=entry["whisper_code"],
            name=entry["name"],
            piper_voice=entry.get("piper_voice", ""),
        ))
    return languages


def _parse_voices(raw_voices: dict) -> Dict[str, VoiceConfig]:
    """Parse TTS voice configuration."""
    voices = {}
    for lang_code, voice_data in raw_voices.items():
        voices[lang_code] = VoiceConfig(
            model=voice_data["model"],
            config=voice_data["config"],
        )
    return voices


def load_config(config_path: str) -> AppConfig:
    """Load and validate configuration from YAML file.

    Args:
        config_path: Path to config.yaml

    Returns:
        Fully populated AppConfig instance

    Raises:
        FileNotFoundError: If config file doesn't exist
        ValueError: If required fields are missing or invalid
    """
    config_path = os.path.abspath(config_path)
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config file not found: {config_path}")

    with open(config_path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    # Determine base directory (project root)
    base_dir = str(Path(config_path).parent.parent)

    config = AppConfig(base_dir=base_dir)

    # System
    if "system" in raw:
        s = raw["system"]
        config.system = SystemConfig(
            name=s.get("name", "BhashaSakha"),
            version=s.get("version", "1.0.0"),
            log_level=s.get("log_level", "INFO"),
            log_to_file=s.get("log_to_file", False),
            display_enabled=s.get("display_enabled", False),
        )

    # Audio
    if "audio" in raw:
        a = raw["audio"]
        config.audio = AudioConfig(
            input_device=a.get("input_device"),
            output_device=a.get("output_device"),
            sample_rate=a.get("sample_rate", 16000),
            channels=a.get("channels", 1),
            buffer_duration_sec=a.get("buffer_duration_sec", 30),
            frame_duration_ms=a.get("frame_duration_ms", 30),
        )

    # VAD
    if "vad" in raw:
        v = raw["vad"]
        config.vad = VADConfig(
            model_path=v.get("model_path", "models/vad/silero_vad.onnx"),
            threshold=v.get("threshold", 0.5),
            min_speech_ms=v.get("min_speech_ms", 500),
            max_speech_ms=v.get("max_speech_ms", 30000),
            silence_endpoint_ms=v.get("silence_endpoint_ms", 600),
            pre_speech_pad_ms=v.get("pre_speech_pad_ms", 300),
            post_speech_pad_ms=v.get("post_speech_pad_ms", 100),
        )

    # STT
    if "stt" in raw:
        st = raw["stt"]
        config.stt = STTConfig(
            model_path=st.get("model_path", "models/stt/whisper-small-int8"),
            compute_type=st.get("compute_type", "int8"),
            beam_size=st.get("beam_size", 3),
            best_of=st.get("best_of", 1),
            without_timestamps=st.get("without_timestamps", True),
            condition_on_previous_text=st.get("condition_on_previous_text", False),
            language=st.get("language"),
            min_confidence=st.get("min_confidence", 0.5),
        )

    # Translation
    if "translation" in raw:
        t = raw["translation"]
        config.translation = TranslationConfig(
            model_path=t.get("model_path", config.translation.model_path),
            tokenizer_name=t.get("tokenizer_name", config.translation.tokenizer_name),
            beam_size=t.get("beam_size", 2),
            max_decoding_length=t.get("max_decoding_length", 128),
            supported_languages=_parse_languages(t.get("supported_languages", [])),
        )

    # TTS
    if "tts" in raw:
        tt = raw["tts"]
        config.tts = TTSConfig(
            voices=_parse_voices(tt.get("voices", {})),
            default_speed=tt.get("default_speed", 1.0),
            slow_speed=tt.get("slow_speed", 0.8),
        )

    # Proximity
    if "proximity" in raw:
        p = raw["proximity"]
        config.proximity = ProximityConfig(
            enabled=p.get("enabled", True),
            trigger_pin=p.get("trigger_pin", 23),
            echo_pin=p.get("echo_pin", 24),
            activation_cm=p.get("activation_cm", 100),
            deactivation_cm=p.get("deactivation_cm", 200),
            deactivation_delay_sec=p.get("deactivation_delay_sec", 30),
            poll_interval_ms=p.get("poll_interval_ms", 500),
        )

    # Session
    if "session" in raw:
        se = raw["session"]
        config.session = SessionConfig(
            idle_timeout_sec=se.get("idle_timeout_sec", 120),
            max_duration_sec=se.get("max_duration_sec", 1800),
            confusion_threshold=se.get("confusion_threshold", 2),
        )

    # Glossary
    if "glossary" in raw:
        g = raw["glossary"]
        config.glossary = GlossaryConfig(
            path=g.get("path", "config/banking_glossary.yaml"),
            fuzzy_match_threshold=g.get("fuzzy_match_threshold", 2),
            enabled=g.get("enabled", True),
        )

    # Health
    if "health" in raw:
        h = raw["health"]
        config.health = HealthConfig(
            monitor_interval_sec=h.get("monitor_interval_sec", 30),
            max_cpu_temp_c=h.get("max_cpu_temp_c", 80),
            max_memory_percent=h.get("max_memory_percent", 85),
            auto_restart_on_oom=h.get("auto_restart_on_oom", True),
        )

    # Performance
    if "performance" in raw:
        pe = raw["performance"]
        config.performance = PerformanceConfig(
            omp_num_threads=pe.get("omp_num_threads", 2),
            preload_all_models=pe.get("preload_all_models", True),
            warmup_on_boot=pe.get("warmup_on_boot", True),
        )

    # Apply OMP thread limit (critical for RPi5 — prevent one model from using all 4 cores)
    os.environ["OMP_NUM_THREADS"] = str(config.performance.omp_num_threads)
    os.environ["OPENBLAS_NUM_THREADS"] = str(config.performance.omp_num_threads)

    return config
