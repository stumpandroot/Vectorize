"""Draws the generated test logos: shapes with known answers, saved as small PNG and JPEG files.

Usage:
    python3 bench/make_testset.py FONTS_DIR [OUT_DIR]

FONTS_DIR holds the six open-license Google Fonts files listed in FONTS below
(download them from github.com/google/fonts). OUT_DIR defaults to bench/testset.

For each design it writes:
- truth/NAME.svg: the exact artwork, every letter converted to paths
- truth/NAME.json: its colors, background, and sharp corners (in SVG units)
- images/NAME-small.png (240 px wide), NAME.png (480 px), and NAME.jpg (480 px, quality 50)

The output is fixed for a given set of fonts, so the files are committed and the
scorer doesn't need the fonts.
"""
from __future__ import annotations

import io
import json
import math
import sys
from pathlib import Path

import cairosvg
from fontTools.pens.recordingPen import DecomposingRecordingPen, RecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.removeOverlaps import removeOverlaps
from fontTools.varLib import instancer
from PIL import Image

W = 1000                      # design width in SVG units; height varies per design
SIZES = [("small", 240, "png"), ("", 480, "png"), ("", 480, "jpg")]
CORNER_DEG = 40               # a turn sharper than this is a corner

FONTS = {
    "montserrat": "Montserrat[wght].ttf",
    "nunito": "Nunito[wght].ttf",
    "playfair": "PlayfairDisplay[wght].ttf",
    "pacifico": "Pacifico-Regular.ttf",
    "oswald": "Oswald[wght].ttf",
    "slab": "RobotoSlab[wght].ttf",
}


class Fonts:
    def __init__(self, folder: Path):
        self.folder, self.cache = folder, {}

    def get(self, name: str, wght: int | None) -> TTFont:
        key = (name, wght)
        if key not in self.cache:
            f = TTFont(self.folder / FONTS[name])
            if "fvar" in f and wght:
                f = instancer.instantiateVariableFont(f, {"wght": wght}, overlap=instancer.OverlapMode.REMOVE)
            else:
                removeOverlaps(f)   # outlines must not cross, or crossings count as corners
            self.cache[key] = f
        return self.cache[key]


def turn_corners(rec: RecordingPen) -> list[list[float]]:
    """On-curve points where the outline turns sharper than CORNER_DEG."""
    out = []
    contour: list[tuple[str, tuple]] = []

    def flush():
        # contour: [("moveTo", (p,)), ("lineTo", (p,)), ("qCurveTo"/"curveTo", (c..., p)), ...]
        if len(contour) < 2:
            return
        start = contour[0][1][0]
        segs = []                       # (from, controls, to)
        prev = start
        for op, pts in contour[1:]:
            segs.append((prev, list(pts[:-1]), pts[-1]))
            prev = pts[-1]
        if prev != start:
            segs.append((prev, [], start))
        n = len(segs)
        for i in range(n):
            a, b = segs[i], segs[(i + 1) % n]
            p = a[2]
            pin = a[1][-1] if a[1] else a[0]
            pout = b[1][0] if b[1] else b[2]
            v1 = (p[0] - pin[0], p[1] - pin[1])
            v2 = (pout[0] - p[0], pout[1] - p[1])
            l1, l2 = math.hypot(*v1), math.hypot(*v2)
            if l1 < 1e-6 or l2 < 1e-6:
                continue
            c = max(-1, min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)))
            if math.degrees(math.acos(c)) > CORNER_DEG:
                out.append([round(p[0], 2), round(p[1], 2)])

    for op, pts in rec.value:
        if op == "moveTo":
            flush(); contour = [(op, pts)]
        elif op in ("closePath", "endPath"):
            flush(); contour = []
        else:
            if op == "qCurveTo" and len(pts) > 2:
                # Split implied on-curve points so each piece has one control point.
                ctrl = list(pts[:-1])
                for j in range(len(ctrl) - 1):
                    mid = ((ctrl[j][0] + ctrl[j + 1][0]) / 2, (ctrl[j][1] + ctrl[j + 1][1]) / 2)
                    contour.append((op, (ctrl[j], mid)))
                contour.append((op, (ctrl[-1], pts[-1])))
            else:
                contour.append((op, pts))
    flush()
    return out


class Art:
    """Collects layers of path data with their colors and sharp corners."""

    def __init__(self, h: int, bg: str | None):
        self.h, self.bg, self.items, self.corners = h, bg, [], []

    def path(self, d: str, fill: str, corners=()):
        self.items.append(f'<path d="{d}" fill="{fill}" fill-rule="evenodd"/>')
        self.corners += [[round(x, 2), round(y, 2)] for x, y in corners]

    def poly(self, pts, fill: str):
        d = "M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in pts) + " Z"
        cs = []
        n = len(pts)
        for i in range(n):
            a, p, b = pts[i - 1], pts[i], pts[(i + 1) % n]
            v1, v2 = (p[0] - a[0], p[1] - a[1]), (b[0] - p[0], b[1] - p[1])
            c = (v1[0] * v2[0] + v1[1] * v2[1]) / (math.hypot(*v1) * math.hypot(*v2))
            if math.degrees(math.acos(max(-1, min(1, c)))) > CORNER_DEG:
                cs.append(p)
        self.path(d, fill, cs)

    def rect(self, x, y, w, h, fill):
        self.poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], fill)

    def circle(self, cx, cy, r, fill, hole: float = 0):
        d = f"M{cx - r} {cy}a{r} {r} 0 1 0 {2 * r} 0a{r} {r} 0 1 0 {-2 * r} 0Z"
        if hole:
            d += f"M{cx - hole} {cy}a{hole} {hole} 0 1 0 {2 * hole} 0a{hole} {hole} 0 1 0 {-2 * hole} 0Z"
        self.path(d, fill)

    def rrect(self, x, y, w, h, r, fill):
        d = (f"M{x + r} {y}H{x + w - r}A{r} {r} 0 0 1 {x + w} {y + r}V{y + h - r}A{r} {r} 0 0 1 {x + w - r} {y + h}"
             f"H{x + r}A{r} {r} 0 0 1 {x} {y + h - r}V{y + r}A{r} {r} 0 0 1 {x + r} {y}Z")
        self.path(d, fill)

    def star(self, cx, cy, r1, r2, n, fill, rot=-90):
        pts = []
        for i in range(2 * n):
            r = r1 if i % 2 == 0 else r2
            a = math.radians(rot + i * 180 / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        self.poly(pts, fill)

    def text(self, fonts: Fonts, font: str, wght, s: str, size: float, x: float, y: float, fill: str,
             anchor="middle", tracking=0.0, max_w=900):
        f = fonts.get(font, wght)
        gs, cmap, hmtx = f.getGlyphSet(), f.getBestCmap(), f["hmtx"]
        upm = f["head"].unitsPerEm
        k = size / upm
        names = [cmap.get(ord(ch), ".notdef") for ch in s]
        width = sum(hmtx[g][0] for g in names) * k + tracking * size * (len(names) - 1)
        if width > max_w:                     # shrink to fit, keeping the baseline
            size *= max_w / width; k = size / upm; width = max_w
        x0 = x - width / 2 if anchor == "middle" else x
        svg = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}")
        rec = DecomposingRecordingPen(gs)
        cx = x0
        for g in names:
            t = (k, 0, 0, -k, cx, y)
            gs[g].draw(TransformPen(svg, t))
            gs[g].draw(TransformPen(rec, t))
            cx += hmtx[g][0] * k + tracking * size
        self.path(svg.getCommands(), fill, turn_corners(rec))

    def svg(self) -> str:
        bg = f'<rect width="{W}" height="{self.h}" fill="{self.bg}"/>' if self.bg else ""
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{self.h}" viewBox="0 0 {W} {self.h}">'
                + bg + "".join(self.items) + "</svg>")


NAVY, GOLD, CORAL, GREEN, CREAM, WHITE = "#1E2340", "#E8C25A", "#E07A5F", "#4F7A5A", "#F6F0DC", "#FFFFFF"


def designs(F: Fonts):
    out = {}

    a = Art(260, WHITE)
    a.text(F, "montserrat", 700, "NORTHFIELD", 150, 500, 185, NAVY, tracking=0.02)
    out["sans-wordmark"] = (a, "Geometric sans caps: straight stems and sharp corners")

    a = Art(1000, CREAM)
    a.circle(500, 400, 330, NAVY, hole=280)
    a.circle(500, 400, 280, GOLD)
    a.star(500, 410, 230, 100, 5, CORAL)
    a.text(F, "nunito", 800, "SUNNY CO", 140, 500, 900, NAVY)
    a.rect(330, 935, 340, 30, GREEN)
    out["rounded-badge"] = (a, "Badge: ring, disc, star, rounded sans, and a thin bar")

    a = Art(300, CREAM)
    a.text(F, "playfair", 700, "Harbor & Pine", 150, 500, 200, "#2D4A3A")
    out["serif-wordmark"] = (a, "High-contrast serif: hairlines and pointed serifs")

    a = Art(380, WHITE)
    a.text(F, "pacifico", None, "Sweet Mabel", 170, 500, 250, "#C2457A")
    out["script-wordmark"] = (a, "Connected script: long smooth curves")

    a = Art(320, WHITE)
    a.rect(40, 40, 920, 240, "#26262B")
    a.text(F, "oswald", 600, "IRONWORKS", 190, 500, 238, WHITE, tracking=0.03)
    out["reversed-condensed"] = (a, "White condensed caps knocked out of a dark bar")

    a = Art(900, WHITE)
    hexa = [(500 + 380 * math.cos(math.radians(30 + 60 * i)), 450 + 380 * math.sin(math.radians(30 + 60 * i))) for i in range(6)]
    inner = [(500 + 330 * math.cos(math.radians(30 + 60 * i)), 450 + 330 * math.sin(math.radians(30 + 60 * i))) for i in range(6)]
    d = "M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in hexa) + " Z M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in inner) + " Z"
    a.path(d, "#7A4E2D", hexa + inner)
    a.text(F, "slab", 700, "OAK", 190, 500, 520, "#7A4E2D", max_w=480)
    out["slab-hexagon"] = (a, "Hexagon frame with slab serif letters")

    a = Art(800, WHITE)
    a.circle(640, 260, 110, GOLD)
    a.poly([(180, 560), (430, 200), (680, 560)], NAVY)
    a.poly([(480, 560), (660, 320), (840, 560)], "#3B5BA0")
    a.text(F, "montserrat", 800, "SUMMIT", 140, 510, 730, NAVY, tracking=0.08)
    out["mountain"] = (a, "Overlapping triangles and a sun: sharp peaks, three colors")

    a = Art(1000, WHITE)
    shield = [(220, 120), (780, 120), (780, 520), (500, 900), (220, 520)]
    a.poly(shield, "#1F4D2B")
    for i in range(2):
        y = 260 + i * 150
        a.poly([(320, y), (500, y + 100), (680, y), (680, y + 60), (500, y + 160), (320, y + 60)], WHITE)
    out["shield-chevrons"] = (a, "Shield with white chevrons: acute and obtuse corners")

    a = Art(500, WHITE)
    for i, t in enumerate([2.1, 4.2, 6.3, 8.4]):          # 0.5, 1, 1.5, 2 px at 240 px wide
        a.rect(80, 60 + i * 40, 840, t, NAVY)
    for i in range(12):
        a.circle(120 + i * 70, 260, 3 + i * 0.9, CORAL)
    a.text(F, "nunito", 300, "minimal studio", 120, 500, 430, NAVY)
    out["thin-lines"] = (a, "Hairlines, small dots, and a light-weight font")

    a = Art(1000, WHITE)
    a.rrect(150, 150, 700, 700, 150, "#1A8C8C")
    a.text(F, "montserrat", 800, "AB", 380, 500, 640, WHITE)
    out["rounded-square"] = (a, "App-icon square with large initials")

    a = Art(420, WHITE)
    a.poly([(50, 150), (200, 150), (200, 90), (320, 210), (200, 330), (200, 270), (50, 270)], CORAL)
    a.text(F, "oswald", 500, "FORWARD", 170, 660, 270, NAVY, max_w=560)
    out["arrow"] = (a, "Arrow mark beside condensed caps")

    a = Art(560, CREAM)
    a.circle(500, 190, 140, NAVY)
    a.text(F, "montserrat", 700, "M", 170, 500, 252, CREAM)
    a.text(F, "montserrat", 600, "MILL & MARKET", 70, 500, 420, NAVY, tracking=0.1)
    a.text(F, "montserrat", 500, "ESTABLISHED 1998", 34, 500, 490, NAVY, tracking=0.2)
    out["small-tagline"] = (a, "Small tagline under a mark: letters 3 to 4 px tall at 240 px")

    a = Art(1000, WHITE)
    a.star(500, 500, 450, 380, 16, "#D62828", rot=0)
    a.circle(500, 500, 330, WHITE)
    a.text(F, "slab", 800, "100%", 190, 500, 570, "#D62828")
    out["starburst-seal"] = (a, "Sixteen-point starburst seal around slab numerals")

    a = Art(800, WHITE)
    a.circle(380, 330, 230, "#2563EB")
    a.circle(620, 330, 230, GOLD)
    a.circle(500, 520, 230, CORAL)
    out["overlap-circles"] = (a, "Three overlapping circles: where colors meet")
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    fonts = Fonts(Path(sys.argv[1]))
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).with_name("testset")
    (out / "truth").mkdir(parents=True, exist_ok=True)
    (out / "images").mkdir(parents=True, exist_ok=True)
    index = []
    for name, (art, about) in designs(fonts).items():
        svg = art.svg()
        (out / "truth" / f"{name}.svg").write_text(svg)
        colors = sorted({c for c in __import__("re").findall(r'fill="(#[0-9A-F]{6})"', svg)})
        bg = art.bg
        (out / "truth" / f"{name}.json").write_text(json.dumps(
            {"name": name, "about": about, "width": W, "height": art.h, "background": bg,
             "colors": colors, "corners": art.corners}, indent=1))
        for tag, w, fmt in SIZES:
            h = round(art.h * w / W)
            png = cairosvg.svg2png(bytestring=svg.encode(), output_width=w, output_height=h)
            im = Image.open(io.BytesIO(png)).convert("RGB")
            stem = f"{name}-{tag}" if tag else name
            if fmt == "jpg":
                im.save(out / "images" / f"{stem}.jpg", "JPEG", quality=50)
            else:
                im.save(out / "images" / f"{stem}.png", optimize=True)
            index.append({"image": f"{stem}.{fmt}", "truth": name, "width": w})
        print(f"{name}: {len(art.corners)} corners")
    (out / "index.json").write_text(json.dumps(index, indent=1))
    print(f"wrote {len(index)} images to {out}")


if __name__ == "__main__":
    main()
