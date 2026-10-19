"""Draws the lettering test set: logos with words in known Google Fonts, with exact answers.

Usage:
    VZ_GFONTS=/path/to/google/fonts python3 bench/make_textset.py [--synthetic N] [OUT_DIR]

OUT_DIR defaults to bench/textset. For each case it writes images/NAME.png or .jpg and truth/NAME.json:
    {"name", "kind", "size": [w, h], "bg", "words": [{"text", "family", "weight", "colors", "box",
     "layout", "tracking", "sx", "skew", "abstain", "glyphs": [{"char", "box", "d"}]}]}
Boxes and paths are in image pixels. "abstain": true marks lettering no catalog font should claim
(custom or altered letters). Protected cases (kind = the case name) always come first; synthetic
wordmarks follow, seeded so the set is the same on every run.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import random
import sys
from pathlib import Path

import cairosvg
import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent / "fonts"))
import gfonts  # noqa: E402

OUT = Path(__file__).resolve().parent / "textset"


class Face:
    def __init__(self, family, weight, wdth=None):
        self.family, self.weight = family, gfonts.nearest_weight(gfonts.catalog()[family], weight)
        self.data = gfonts.instance_bytes(family, self.weight, wdth)
        self.tt = gfonts.ttfont(family, self.weight, wdth)
        self.upm = self.tt["head"].unitsPerEm
        self.gs = self.tt.getGlyphSet()
        self.hbfont = hb.Font(hb.Face(self.data))

    def shape(self, text):
        buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
        hb.shape(self.hbfont, buf, {"kern": True, "liga": True})
        order = self.tt.getGlyphOrder()
        out = []
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            out.append((order[info.codepoint], info.cluster, pos.x_advance, pos.x_offset, pos.y_offset))
        return out


def glyph_path(face, gname, affine):
    """SVG path data and bounds of one glyph through affine (a, b, c, d, e, f) from font units."""
    pen = SVGPathPen(face.gs)
    face.gs[gname].draw(TransformPen(pen, affine))
    bp = BoundsPen(face.gs)
    face.gs[gname].draw(TransformPen(bp, affine))
    return pen.getCommands(), bp.bounds


def lay_line(face, text, size, x, baseline, tracking=0.0, sx=1.0, skew=0.0, warp=None):
    """Glyphs for one line: size is the em in pixels, tracking in ems, sx a horizontal scale, skew a shear."""
    k = size / face.upm
    glyphs, pen_x = [], 0.0
    shaped = face.shape(text)
    for i, (g, cl, adv, xo, yo) in enumerate(shaped):
        gx = x + (pen_x + xo) * k * sx
        gy = baseline - yo * k
        # font units -> pixels, y flipped, horizontal scale, shear around the baseline
        a, c = (1 + warp.uniform(0.12, 0.22), warp.uniform(-0.18, 0.18)) if warp else (1, 0)
        aff = (k * sx * a, 0, -k * (skew + c), -k, gx, gy)
        d, bounds = glyph_path(face, g, aff)
        ch = text[cl] if cl < len(text) else ""
        if d and bounds and not ch.isspace():
            glyphs.append({"char": ch, "box": [round(v, 2) for v in bounds], "d": d})
        pen_x += adv + tracking * face.upm
    return glyphs, x + pen_x * k * sx


def lay_arc(face, text, size, cx, cy, r, center_deg, upper=True, tracking=0.05):
    """Glyphs on a circle: upper arc reads clockwise on top, lower arc reads left to right along the bottom."""
    k = size / face.upm
    shaped = face.shape(text)
    advs = [adv + tracking * face.upm for (_, _, adv, _, _) in shaped]
    total = sum(advs) * k
    rr = r if upper else r + size * 0.72      # lower arc: baseline sits outside so letters stand upright
    span = total / rr
    glyphs, s = [], 0.0
    for (g, cl, adv, xo, yo), a in zip(shaped, advs):
        mid = (s + a * k / 2) / rr
        if upper:
            th = math.radians(center_deg) - span / 2 + mid          # angle from vertical, clockwise
            px, py = cx + rr * math.sin(th), cy - rr * math.cos(th)
            rot = th
        else:
            th = math.radians(center_deg) + span / 2 - mid
            px, py = cx + rr * math.sin(th), cy - rr * math.cos(th)
            rot = th - math.pi
        c, si = math.cos(rot), math.sin(rot)
        # glyph local: x from -adv/2, baseline at 0 (font units, y up)
        ox = -adv * k / 2
        # map (u, v) font units: X = px + (ox + u*k)*c - (-v*k)*si ; Y = py + (ox + u*k)*si + (-v*k)*c
        aff = (k * c, k * si, k * si, -k * c, px + ox * c, py + ox * si)
        d, bounds = glyph_path(face, g, aff)
        ch = text[cl] if cl < len(text) else ""
        if d and bounds and not ch.isspace():
            glyphs.append({"char": ch, "box": [round(v, 2) for v in bounds], "d": d})
        s += a * k
    return glyphs


def bbox(glyphs):
    xs = [g["box"][0] for g in glyphs] + [g["box"][2] for g in glyphs]
    ys = [g["box"][1] for g in glyphs] + [g["box"][3] for g in glyphs]
    return [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)]


def word(face, text, glyphs, colors, layout="line", tracking=0.0, sx=1.0, skew=0.0, abstain=False):
    return {"text": text, "family": face.family if face else None, "weight": face.weight if face else None,
            "colors": colors, "box": bbox(glyphs), "layout": layout, "tracking": tracking, "sx": sx, "skew": skew,
            "abstain": abstain, "glyphs": glyphs}


def render(case, out, fmt="png", jpeg_q=60, blur=0.0, extra=""):
    w, h = case["size"]
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
             f'<rect width="{w}" height="{h}" fill="{case["bg"]}"/>', extra]
    for wd in case["words"]:
        for i, g in enumerate(wd["glyphs"]):
            col = wd["colors"][i % len(wd["colors"])]
            parts.append(f'<path d="{g["d"]}" fill="{col}"/>')
    parts.append("</svg>")
    png = cairosvg.svg2png(bytestring="".join(parts).encode())
    im = Image.open(io.BytesIO(png)).convert("RGB")
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "truth").mkdir(parents=True, exist_ok=True)
    name = f'{case["name"]}.{fmt}'
    if fmt == "jpg":
        im.save(out / "images" / name, quality=jpeg_q)
    else:
        im.save(out / "images" / name)
    case["image"] = name
    (out / "truth" / f'{case["name"]}.json').write_text(json.dumps(case, separators=(",", ":")))


# ---------- protected cases ----------
def protected(out):
    cases = []

    def case(name, w, h, bg, words, extra="", fmt="png", **kw):
        c = {"name": name, "kind": name.rsplit("-", 1)[0] if name[-1].isdigit() else name, "size": [w, h], "bg": bg, "words": words}
        render(c, out, fmt, extra=extra, **kw)
        cases.append(c)

    INK = "#26352E"
    # 1. High-contrast serif H with a hairline crossbar.
    f = Face("Playfair Display", 900)
    g, _ = lay_line(f, "HARBOR", 64, 24, 92)
    case("h-hairline", 330, 120, "#F6F0E4", [word(f, "HARBOR", g, [INK])])
    case("h-hairline-jpg", 330, 120, "#F6F0E4", [word(f, "HARBOR", g, [INK])], fmt="jpg", jpeg_q=55)
    # 2. Thin serifs.
    f = Face("Bodoni Moda", 700)
    g, _ = lay_line(f, "ELEGANT", 72, 20, 100)
    case("thin-serif", 420, 130, "#FFFFFF", [word(f, "ELEGANT", g, ["#1B1B1B"])])
    # 3. Tight kerning: letters touch.
    f = Face("Montserrat", 800)
    g, _ = lay_line(f, "AVATAR", 70, 18, 96, tracking=-0.09)
    case("tight-av", 360, 120, "#FFFFFF", [word(f, "AVATAR", g, ["#0F2A5C"], tracking=-0.09)])
    # 4. Connected script.
    f = Face("Pacifico", 400)
    g, _ = lay_line(f, "Sunday Brunch", 58, 16, 86)
    case("connected-script", 460, 130, "#FFF7EC", [word(f, "Sunday Brunch", g, ["#B23F24"])])
    # 5. Tiny tagline under a main word.
    f1, f2 = Face("Oswald", 600), Face("Inter", 500)
    g1, _ = lay_line(f1, "NORTHWIND", 74, 20, 86)
    g2, _ = lay_line(f2, "Coffee Roasters Since 1998", 13, 22, 112)
    case("tiny-tagline", 400, 130, "#FFFFFF", [word(f1, "NORTHWIND", g1, [INK]), word(f2, "Coffee Roasters Since 1998", g2, ["#545E56"])])
    # 6. A word with letters in different colors.
    f = Face("Poppins", 700)
    g, _ = lay_line(f, "Rainbow", 72, 18, 92)
    case("multicolor-word", 330, 120, "#FFFFFF", [word(f, "Rainbow", g, ["#E2203C", "#F4A11A", "#2E8B57", "#1E6FD9"])])
    # 7. Badge with an upper and a lower arc.
    f = Face("Oswald", 600)
    gu = lay_arc(f, "MAPLE COFFEE", 34, 200, 200, 128, 0, upper=True)
    gl = lay_arc(f, "SINCE 1920", 30, 200, 200, 128, 180, upper=False)
    ring = '<circle cx="200" cy="200" r="110" fill="none" stroke="#26352E" stroke-width="8"/>'
    case("lower-arc", 400, 400, "#FFFFFF", [word(f, "MAPLE COFFEE", gu, [INK], layout="arc"), word(f, "SINCE 1920", gl, [INK], layout="arc")], extra=ring)
    # 8. Two stacked lines.
    f = Face("Roboto Slab", 800)
    g1, _ = lay_line(f, "STUMP", 70, 30, 84)
    g2, _ = lay_line(f, "& ROOT", 70, 30, 166)
    case("stacked-lines", 300, 190, "#F5F0E6", [word(f, "STUMP", g1, [INK]), word(f, "& ROOT", g2, [INK])])
    # 9. One- and two-letter marks.
    f = Face("Archivo Black", 400)
    g, _ = lay_line(f, "K", 120, 40, 140)
    case("one-letter-mark", 200, 180, "#FFFFFF", [word(f, "K", g, ["#111111"])])
    g, _ = lay_line(f, "JS", 110, 30, 130)
    case("two-letter-mark", 220, 170, "#FFE14D", [word(f, "JS", g, ["#111111"])])
    # 10. Letters no catalog font has: Lora with every glyph reshaped.
    f = Face("Lora", 700)
    g, _ = lay_line(f, "Zephyr", 76, 20, 96, warp=random.Random(7))
    case("unknown-font", 380, 130, "#FFFFFF", [word(f, "Zephyr", g, [INK], abstain=True)])
    # 11. A custom R: Lobster's R in a Lora word.
    f, fr = Face("Lora", 700), Face("Lobster", 400)
    gR, x = lay_line(fr, "R", 82, 20, 96)
    g, _ = lay_line(f, "over", 76, x + 2, 96)
    case("custom-r", 330, 130, "#FFFFFF", [word(f, "Rover", gR + g, ["#5B2A86"], abstain=True)])
    return cases


# ---------- synthetic wordmarks ----------
WORDS = ["Northwind", "SUNNY CO", "Maple & Oak", "Brightline", "KESTREL", "harbor", "Pine Ridge", "QUANTA",
         "Velvet Moon", "Copperleaf", "ZEPHYRA", "Bluebird", "Oxbow", "Lumina", "IRONWOOD", "Fable", "Tidewater",
         "Rook & Raven", "Sprout", "Halcyon", "GRANITE", "Juniper", "Kinfolk", "Wildflower", "Vantage", "Quill",
         "Ember", "Saltbox", "Orchard", "Fjord", "NOVA 21", "Studio 54", "Blue Heron", "Driftwood", "Marigold",
         "Basalt", "Cobalt", "Thistle", "Larkspur", "Gather", "Hearth", "Wolf & Co", "Summit", "Atlas", "Mosaic",
         "Riverbend", "Pinecone", "Paperboat", "Bramble", "Sable", "Crescent", "Lantern", "Meridian", "Waypoint",
         "Foxglove", "Sparrow", "Badger Bros", "Quokka", "Vixen", "Jubilee", "Xylo", "Gizmo", "Tempest", "Zinnia"]
PALETTE = [("#FFFFFF", "#111111"), ("#F5F0E6", "#26352E"), ("#FFFFFF", "#0F2A5C"), ("#111111", "#F4C76B"),
           ("#1E2340", "#FFFFFF"), ("#FFF7EC", "#B23F24"), ("#E9EFE0", "#2E4A38"), ("#FFFFFF", "#7A1F5C")]


def synthetic(out, n, seed=20261019):
    rnd = random.Random(seed)
    cat = gfonts.catalog()
    by_cat = {}
    for f in cat.values():
        by_cat.setdefault(f["category"], []).append(f["name"])
    mix = [("SANS_SERIF", 0.4), ("SERIF", 0.25), ("DISPLAY", 0.2), ("HANDWRITING", 0.1), ("MONOSPACE", 0.05)]
    cases = []
    for i in range(n):
        r = rnd.random(); acc = 0
        for c, p in mix:
            acc += p
            if r <= acc:
                break
        fam = rnd.choice(sorted(by_cat[c]))
        wt = rnd.choice(gfonts.weights(cat[fam]))
        try:
            f = Face(fam, wt)
        except Exception as e:
            print("skip", fam, e); continue
        text = rnd.choice(WORDS)
        case_style = rnd.random()
        if case_style < 0.25:
            text = text.upper()
        elif case_style < 0.35:
            text = text.lower()
        xh = rnd.choice([8, 10, 12, 16, 20, 26, 34, 44])          # target cap height in pixels
        size = xh / 0.7
        tracking = rnd.choice([0, 0, 0, 0.04, 0.1, -0.03])
        sx = rnd.choice([1, 1, 1, 1, 0.88, 1.12])
        skew = rnd.choice([0, 0, 0, 0, 0, 0.18])
        bg, ink = rnd.choice(PALETTE)
        g, x1 = lay_line(f, text, size, 0, 0, tracking, sx, skew)
        if not g:
            continue
        b = bbox(g); pad = max(12, size * 0.4)
        w, h = int(b[2] - b[0] + 2 * pad), int(b[3] - b[1] + 2 * pad)
        g, _ = lay_line(f, text, size, pad - b[0], pad - b[1], tracking, sx, skew)
        fmt = rnd.choice(["png", "png", "jpg"])
        c = {"name": f"syn-{i:03d}", "kind": "synthetic", "size": [w, h], "bg": bg, "cap_px": xh,
             "words": [word(f, text, g, [ink], tracking=tracking, sx=sx, skew=skew)]}
        render(c, out, fmt, jpeg_q=rnd.choice([45, 60, 80]), blur=rnd.choice([0, 0, 0, 0.6]))
        cases.append(c)
    return cases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default=str(OUT))
    ap.add_argument("--synthetic", type=int, default=300)
    a = ap.parse_args()
    out = Path(a.out)
    for sub in ("images", "truth"):
        if (out / sub).exists():
            for p in (out / sub).iterdir():
                p.unlink()
    p = protected(out)
    s = synthetic(out, a.synthetic)
    index = [{"name": c["name"], "kind": c["kind"], "image": c["image"]} for c in p + s]
    (out / "index.json").write_text(json.dumps(index, indent=1))
    print(f"wrote {len(p)} protected and {len(s)} synthetic cases to {out}")


if __name__ == "__main__":
    main()
