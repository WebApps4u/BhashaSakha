"""Optional text display for BhashaSakha.

Shows transcription and translation on HDMI display if connected.
Operates as Thread 5 — receives updates via display_queue.
"""

import threading
import queue
import logging
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class DisplayUpdate:
    """Data to display on screen."""
    source_text: str = ""
    source_lang: str = ""
    translated_text: str = ""
    target_lang: str = ""
    status: str = ""  # "listening", "processing", "speaking"


class TextDisplay:
    """Simple text display for HDMI/console output.

    In production, this could be replaced with a GUI framework.
    For now, outputs formatted text to the console.
    """

    def __init__(self, enabled: bool = False):
        self.enabled = enabled
        self._queue: queue.Queue = queue.Queue(maxsize=5)
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        """Start display thread."""
        if not self.enabled:
            return

        self._running = True
        self._thread = threading.Thread(
            target=self._display_loop,
            name="display",
            daemon=True,
        )
        self._thread.start()
        logger.info("Display thread started")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)

    def update(self, display_data: DisplayUpdate):
        """Queue a display update."""
        if not self.enabled:
            return

        try:
            self._queue.put_nowait(display_data)
        except queue.Full:
            pass

    def _display_loop(self):
        """Background display update loop (Thread 5)."""
        while self._running:
            try:
                data = self._queue.get(timeout=0.5)
                self._render(data)
            except queue.Empty:
                continue

    def _render(self, data: DisplayUpdate):
        """Render display data to console."""
        lang_icons = {"hi": "🇮🇳", "mr": "🇮🇳", "en": "🇬🇧"}

        src_icon = lang_icons.get(data.source_lang, "🌐")
        tgt_icon = lang_icons.get(data.target_lang, "🌐")

        print("\n" + "=" * 50)
        if data.status:
            status_icons = {
                "listening": "🎤 Listening...",
                "processing": "⚙️  Processing...",
                "speaking": "🔊 Speaking...",
            }
            print(f"  {status_icons.get(data.status, data.status)}")

        if data.source_text:
            print(f"\n  {src_icon} [{data.source_lang.upper()}] {data.source_text}")

        if data.translated_text:
            print(f"  {tgt_icon} [{data.target_lang.upper()}] {data.translated_text}")

        print("=" * 50)
