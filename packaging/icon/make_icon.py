"""Draws Vectorize's app icon in the family construction (DESIGN.md; Verbatim's brand/README.md).

One flat family color behind one one-color glyph: the node ring, a circle with its four anchor points,
on the 120-unit grid Verbatim's bars use. The grid sits on the icon the way Verbatim's does: 120 units
span 560 of the 1024 canvas, centered. Writes the three variants (sage, ink, paper), the two layers for
Icon Composer, the toolbar mark, and packaging/AppIcon.icns.

Run from the repository root: python3 packaging/icon/make_icon.py
"""
import re
from pathlib import Path

import cairosvg

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "packaging" / "icon"
SRC = ROOT / "ui-src" / "assets" / "vectorize-mark.svg"
INK, PAPER, SAGE = "#26352E", "#F5F0E6", "#AFC398"
MARK = re.search(r' d="([^"]+)"', SRC.read_text()).group(1)


def glyph(color, size=560, cx=512, cy=512):
    k = size / 120
    return f'<g transform="translate({cx - 60 * k:.2f} {cy - 60 * k:.2f}) scale({k:.5f})"><path d="{MARK}" fill="{color}" fill-rule="evenodd"/></g>'


def icon(bg, fg):
    # macOS grid: an 824 pt rounded square centered on 1024, about 185 pt corners, a soft contact shadow.
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs>'
            '<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#26352E" flood-opacity=".22"/></filter></defs>'
            f'<rect x="100" y="100" width="824" height="824" rx="185" fill="{bg}" filter="url(#s)"/>' + glyph(fg) + "</svg>")


variants = {"sage": (SAGE, INK), "ink": (INK, PAPER), "paper": (PAPER, INK)}
for old in OUT.glob("AppIcon-*.svg"):
    old.unlink()
for name, (bg, fg) in variants.items():
    (OUT / f"AppIcon-{name}.svg").write_text(icon(bg, fg))
(OUT / "layer-background.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="{SAGE}"/></svg>')
(OUT / "layer-glyph.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">' + glyph(INK) + "</svg>")
# The toolbar mark: the tile at 30 px wants a larger glyph, so the full 120-unit grid fills the tile (as the logo lockups do).
(ROOT / "ui-src" / "assets" / "app-icon.svg").write_text(
    f'<svg class="app-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"><rect width="120" height="120" rx="27" fill="{SAGE}"/><path d="{MARK}" fill="{INK}" fill-rule="evenodd"/></svg>')

# Every macOS slot, @1x and @2x (icnsutil: pip install icnsutil). Each size is rendered from the vector.
import icnsutil
SLOTS = {"icp4": 16, "icp5": 32, "ic11": 32, "ic12": 64, "ic07": 128, "ic13": 256, "ic08": 256, "ic14": 512, "ic09": 512, "ic10": 1024}
icns = icnsutil.IcnsFile()
for key, px in SLOTS.items():
    icns.add_media(key, data=cairosvg.svg2png(url=str(OUT / "AppIcon-sage.svg"), output_width=px, output_height=px))
icns.write(str(ROOT / "packaging" / "AppIcon.icns"))
print("wrote", ", ".join(sorted(p.name for p in OUT.glob("*.svg"))), "and AppIcon.icns")
