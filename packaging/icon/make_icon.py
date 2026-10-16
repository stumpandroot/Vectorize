"""Draws Vectorize's app icon in the family construction (DESIGN.md, family doc "App icons").

One flat family color behind one bold ink glyph: the mascot, half pixels and half curves, which is
what the app does. Face features are cut out of the glyph. Writes the three variants (butter, ink,
paper), the two layers for Icon Composer, the toolbar mark, and packaging/AppIcon.icns.

Run from the repository root: python3 packaging/icon/make_icon.py
"""
import io
import re
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "packaging" / "icon"
SRC = ROOT / "ui-src" / "assets" / "vectorize-mark.svg"
INK, PAPER, BUTTER = "#26352E", "#F5F0E6", "#F4C76B"

s = SRC.read_text()
groups = {m.group(1): re.findall(r' d="([^"]+)"', m.group(2)) for m in re.finditer(r'<g fill="(#[0-9A-Fa-f]+)"[^>]*>(.*?)</g>', s, re.S)}
BODY, FACE = groups["#FFC24B"][0], groups["#1E2340"][0]
VB = (3.05, 8.25, 1820.69, 1966.4)   # the mark's viewBox
OFFSET = 10 / 620                     # the visible body sits this far left of the viewBox center, per unit of height


def glyph(color, h, cx=512, cy=512):
    cx += OFFSET * h                  # center what you see, not the viewBox
    k = h / VB[3]
    tx, ty = cx - (VB[0] + VB[2] / 2) * k, cy - (VB[1] + VB[3] / 2) * k
    return f'<g transform="translate({tx:.2f} {ty:.2f}) scale({k:.5f})"><path d="{BODY}{FACE}" fill="{color}" fill-rule="evenodd"/></g>'


def icon(bg, fg):
    # macOS grid: an 824 pt rounded square centered on 1024, about 185 pt corners, a soft contact shadow.
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs>'
            '<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#26352E" flood-opacity=".22"/></filter></defs>'
            f'<rect x="100" y="100" width="824" height="824" rx="185" fill="{bg}" filter="url(#s)"/>' + glyph(fg, 560) + "</svg>")


variants = {"butter": (BUTTER, INK), "ink": (INK, PAPER), "paper": (PAPER, INK)}
for name, (bg, fg) in variants.items():
    (OUT / f"AppIcon-{name}.svg").write_text(icon(bg, fg))
(OUT / "layer-background.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="{BUTTER}"/></svg>')
(OUT / "layer-glyph.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">' + glyph(INK, 620) + "</svg>")
(ROOT / "ui-src" / "assets" / "app-icon.svg").write_text(
    f'<svg class="app-icon" xmlns="http://www.w3.org/2000/svg" viewBox="100 100 824 824" width="824" height="824"><rect x="100" y="100" width="824" height="824" rx="185" fill="{BUTTER}"/>' + glyph(INK, 560) + "</svg>")

png = cairosvg.svg2png(url=str(OUT / "AppIcon-butter.svg"), output_width=1024, output_height=1024)
Image.open(io.BytesIO(png)).convert("RGBA").save(ROOT / "packaging" / "AppIcon.icns", sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)])
print("wrote", ", ".join(sorted(p.name for p in OUT.glob("*.svg"))), "and AppIcon.icns")
