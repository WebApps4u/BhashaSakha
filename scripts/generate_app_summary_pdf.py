#!/usr/bin/env python3

from __future__ import annotations

import os
from pathlib import Path


PAGE_W = 595
PAGE_H = 842


def fmt_num(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def text_width(text: str, size: float, bold: bool = False) -> float:
    narrow = set("fijltI.,:;!'| ")
    wide = set("MWmwQ@#%&")
    digits = set("0123456789")
    total = 0.0
    for ch in text:
        if ch in narrow:
            total += 0.32
        elif ch in wide:
            total += 0.90
        elif ch in digits:
            total += 0.56
        elif ch.isupper():
            total += 0.67
        else:
            total += 0.53
    if bold:
        total *= 1.03
    return total * size


def wrap_text(text: str, max_width: float, size: float, bold: bool = False) -> list[str]:
    words = text.split()
    if not words:
        return []

    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        if text_width(trial, size, bold=bold) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


class PDFCanvas:
    def __init__(self) -> None:
        self.commands: list[str] = []

    def _y(self, top: float, height: float = 0.0) -> float:
        return PAGE_H - top - height

    def rect(
        self,
        x: float,
        top: float,
        width: float,
        height: float,
        *,
        fill: tuple[float, float, float] | None = None,
        stroke: tuple[float, float, float] | None = None,
        line_width: float = 1.0,
    ) -> None:
        pieces = ["q", f"{fmt_num(line_width)} w"]
        if fill is not None:
            pieces.append(f"{fmt_num(fill[0])} {fmt_num(fill[1])} {fmt_num(fill[2])} rg")
        if stroke is not None:
            pieces.append(f"{fmt_num(stroke[0])} {fmt_num(stroke[1])} {fmt_num(stroke[2])} RG")
        pieces.append(
            f"{fmt_num(x)} {fmt_num(self._y(top, height))} {fmt_num(width)} {fmt_num(height)} re"
        )
        if fill is not None and stroke is not None:
            pieces.append("B")
        elif fill is not None:
            pieces.append("f")
        else:
            pieces.append("S")
        pieces.append("Q")
        self.commands.append("\n".join(pieces))

    def line(
        self,
        x1: float,
        y1_top: float,
        x2: float,
        y2_top: float,
        *,
        color: tuple[float, float, float],
        width: float = 1.0,
    ) -> None:
        self.commands.append(
            "\n".join(
                [
                    "q",
                    f"{fmt_num(width)} w",
                    f"{fmt_num(color[0])} {fmt_num(color[1])} {fmt_num(color[2])} RG",
                    f"{fmt_num(x1)} {fmt_num(self._y(y1_top))} m",
                    f"{fmt_num(x2)} {fmt_num(self._y(y2_top))} l",
                    "S",
                    "Q",
                ]
            )
        )

    def text(
        self,
        x: float,
        top: float,
        text: str,
        *,
        font: str,
        size: float,
        color: tuple[float, float, float],
    ) -> None:
        baseline = PAGE_H - top - size
        self.commands.append(
            "\n".join(
                [
                    "BT",
                    f"/{font} {fmt_num(size)} Tf",
                    f"{fmt_num(color[0])} {fmt_num(color[1])} {fmt_num(color[2])} rg",
                    f"1 0 0 1 {fmt_num(x)} {fmt_num(baseline)} Tm",
                    f"({pdf_escape(text)}) Tj",
                    "ET",
                ]
            )
        )

    def paragraph(
        self,
        x: float,
        top: float,
        width: float,
        text: str,
        *,
        font: str,
        size: float,
        leading: float,
        color: tuple[float, float, float],
        bold: bool = False,
    ) -> float:
        y = top
        for line in wrap_text(text, width, size, bold=bold):
            self.text(x, y, line, font=font, size=size, color=color)
            y += leading
        return y

    def bullet_list(
        self,
        x: float,
        top: float,
        width: float,
        items: list[str],
        *,
        font: str,
        size: float,
        leading: float,
        color: tuple[float, float, float],
    ) -> float:
        y = top
        bullet_gap = 12
        for item in items:
            lines = wrap_text(item, width - bullet_gap, size)
            if not lines:
                continue
            self.text(x, y, "-", font=font, size=size, color=color)
            self.text(x + bullet_gap, y, lines[0], font=font, size=size, color=color)
            y += leading
            for line in lines[1:]:
                self.text(x + bullet_gap, y, line, font=font, size=size, color=color)
                y += leading
            y += 2
        return y

    def to_stream(self) -> str:
        return "\n".join(self.commands) + "\n"


def build_summary_pdf(output_path: Path) -> None:
    slate_950 = (0.07, 0.10, 0.16)
    slate_900 = (0.12, 0.16, 0.24)
    slate_700 = (0.35, 0.40, 0.49)
    slate_600 = (0.43, 0.49, 0.57)
    slate_500 = (0.52, 0.58, 0.66)
    slate_200 = (0.89, 0.91, 0.94)
    slate_100 = (0.95, 0.96, 0.98)
    white = (1.0, 1.0, 1.0)
    teal = (0.10, 0.62, 0.58)
    blue = (0.16, 0.36, 0.74)

    canvas = PDFCanvas()

    margin = 34
    gap = 16
    page_inner = PAGE_W - margin * 2
    left_w = (page_inner - gap) / 2
    right_x = margin + left_w + gap

    header_h = 106
    canvas.rect(0, 0, PAGE_W, header_h, fill=slate_950)
    canvas.rect(margin, 88, 118, 4, fill=teal)
    canvas.text(margin, 24, "APPLICATION SUMMARY", font="F2", size=10, color=(0.72, 0.79, 0.88))
    canvas.text(margin, 42, "BhashaSakha", font="F2", size=26, color=white)
    canvas.text(
        margin,
        73,
        "Live speech capture, translation, playback, and session intelligence",
        font="F1",
        size=11.5,
        color=(0.86, 0.89, 0.94),
    )

    chip_y = 31
    chip_h = 24
    chip_gap = 10
    chip_x = PAGE_W - margin - 120
    chips = [
        ("React + Vite", 86),
        ("Express API", 82),
        ("Supabase + AI", 94),
    ]
    current_x = PAGE_W - margin
    for label, width in reversed(chips):
        current_x -= width
        canvas.rect(current_x, chip_y, width, chip_h, fill=slate_900, stroke=(0.28, 0.34, 0.44), line_width=0.8)
        text_x = current_x + (width - text_width(label, 9.5, bold=True)) / 2
        canvas.text(text_x, chip_y + 7, label, font="F2", size=9.5, color=white)
        current_x -= chip_gap

    row1_top = 126
    card_h = 164
    canvas.rect(margin, row1_top, left_w, card_h, fill=slate_100, stroke=slate_200, line_width=1)
    canvas.rect(right_x, row1_top, left_w, card_h, fill=slate_100, stroke=slate_200, line_width=1)

    canvas.text(margin + 16, row1_top + 16, "Purpose", font="F2", size=13, color=slate_950)
    purpose_text = (
        "BhashaSakha is a web application that turns live speech into readable captions, "
        "translated text, and optional translated audio. It saves every conversation as a "
        "session, supports shareable live links, and gives teams a post-session workspace "
        "for review, editing, and export."
    )
    next_y = canvas.paragraph(
        margin + 16,
        row1_top + 40,
        left_w - 32,
        purpose_text,
        font="F1",
        size=10.8,
        leading=14,
        color=slate_700,
    )
    canvas.text(margin + 16, next_y + 8, "Workflow fit", font="F2", size=10.2, color=blue)
    canvas.text(
        margin + 16,
        next_y + 25,
        "General conversations, interviews, and banking-focused service flows",
        font="F1",
        size=10.2,
        color=slate_700,
    )

    canvas.text(right_x + 16, row1_top + 16, "Key Value Proposition", font="F2", size=13, color=slate_950)
    value_items = [
        "Reduces language friction in live conversations without requiring separate capture, translation, and note-taking tools.",
        "Combines real-time viewing, saved session history, editing, export, and audio playback in one workflow.",
        "Adds governance layers such as subscriptions, model selection, quotas, routing, and audit-friendly domain workflows.",
    ]
    canvas.bullet_list(
        right_x + 16,
        row1_top + 42,
        left_w - 32,
        value_items,
        font="F1",
        size=9.8,
        leading=13,
        color=slate_700,
    )

    features_top = row1_top + card_h + 16
    features_h = 186
    canvas.rect(margin, features_top, page_inner, features_h, fill=white, stroke=slate_200, line_width=1)
    canvas.text(margin + 16, features_top + 16, "Core Features", font="F2", size=13, color=slate_950)
    canvas.line(margin + 16, features_top + 38, PAGE_W - margin - 16, features_top + 38, color=slate_200, width=1)

    left_feature_items = [
        "Browser speech recognition with interim captions, phrase-based segment saving, and optional automatic source-language detection.",
        "Real-time translation into multiple target languages with per-line text-to-speech playback and voice preferences.",
        "Saved session dashboard, live canvas, public viewer mode, transcript editing, and TXT or VTT export.",
    ]
    right_feature_items = [
        "Session modes for general, interview, and banking scenarios.",
        "Banking workflow detects sensitive entities, stores redacted risk items, and can generate a structured AI case form from the transcript.",
        "Usage, plan, and model-selection pages plus an admin console for AI providers, models, routing, entitlements, settings, flags, and logs.",
    ]
    canvas.bullet_list(
        margin + 16,
        features_top + 54,
        (page_inner - 48) / 2,
        left_feature_items,
        font="F1",
        size=10.0,
        leading=13,
        color=slate_700,
    )
    canvas.bullet_list(
        margin + page_inner / 2 + 8,
        features_top + 54,
        (page_inner - 48) / 2,
        right_feature_items,
        font="F1",
        size=10.0,
        leading=13,
        color=slate_700,
    )

    arch_top = features_top + features_h + 16
    arch_h = 188
    canvas.rect(margin, arch_top, page_inner, arch_h, fill=slate_100, stroke=slate_200, line_width=1)
    canvas.text(margin + 16, arch_top + 16, "Architecture", font="F2", size=13, color=slate_950)
    arch_intro = (
        "The current repo implements a browser-first frontend, an Express API layer, a "
        "Supabase-backed data plane, and a provider-routed AI layer for translation, "
        "text generation, and TTS."
    )
    canvas.paragraph(
        margin + 16,
        arch_top + 39,
        page_inner - 32,
        arch_intro,
        font="F1",
        size=10.1,
        leading=13,
        color=slate_700,
    )

    diagram_top = arch_top + 92
    box_gap = 10
    box_w = (page_inner - 32 - box_gap * 4) / 5
    box_h = 60
    box_x = margin + 16
    diagram_titles = [
        ("Capture UI", "React, Vite, Zustand, i18n, browser speech APIs"),
        ("Live Control", "Session state, segment queueing, sharing, playback"),
        ("API Layer", "Express routes for live, translate, TTS, models, admin"),
        ("Data Plane", "Supabase Auth, Postgres, storage cache, realtime"),
        ("AI Control", "Provider keys, routing, fallbacks, quotas, metering"),
    ]
    for idx, (title, body) in enumerate(diagram_titles):
        x = box_x + idx * (box_w + box_gap)
        fill = white if idx % 2 == 0 else (0.98, 0.99, 1.0)
        canvas.rect(x, diagram_top, box_w, box_h, fill=fill, stroke=(0.80, 0.84, 0.90), line_width=0.9)
        canvas.text(x + 8, diagram_top + 9, title, font="F2", size=9.8, color=slate_950)
        body_lines = wrap_text(body, box_w - 16, 8.1)
        body_y = diagram_top + 24
        for line in body_lines[:4]:
            canvas.text(x + 8, body_y, line, font="F1", size=8.1, color=slate_600)
            body_y += 10
        if idx < len(diagram_titles) - 1:
            x1 = x + box_w
            x2 = x + box_w + box_gap
            mid_y = diagram_top + box_h / 2
            canvas.line(x1 + 2, mid_y, x2 - 2, mid_y, color=slate_500, width=1)
            canvas.line(x2 - 8, mid_y - 4, x2 - 2, mid_y, color=slate_500, width=1)
            canvas.line(x2 - 8, mid_y + 4, x2 - 2, mid_y, color=slate_500, width=1)

    canvas.text(
        margin + 16,
        arch_top + 150,
        "Realtime subscriptions power the shared viewer and session editor so transcript and translation updates appear live.",
        font="F1",
        size=9.6,
        color=blue,
    )

    footer_top = PAGE_H - 22
    canvas.text(
        margin,
        footer_top,
        "Based on the current repository structure and routes in the BhashaSakha codebase.",
        font="F1",
        size=8.8,
        color=slate_600,
    )

    content_stream = canvas.to_stream()
    content_bytes = content_stream.encode("latin-1")

    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            "/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> "
            "/Contents 4 0 R >>"
        ),
        f"<< /Length {len(content_bytes)} >>\nstream\n{content_stream}endstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]

    pdf = bytearray()
    pdf.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{idx} 0 obj\n".encode("ascii"))
        pdf.extend(obj.encode("latin-1"))
        pdf.extend(b"\nendobj\n")

    xref_start = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        (
            "trailer\n"
            f"<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            "startxref\n"
            f"{xref_start}\n"
            "%%EOF\n"
        ).encode("ascii")
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(pdf)


def main() -> None:
    default_output = Path("docs/BhashaSakha_Application_Summary.pdf")
    output = Path(os.environ.get("BHASHA_SAKHA_SUMMARY_PDF", str(default_output)))
    build_summary_pdf(output)
    print(output)


if __name__ == "__main__":
    main()
