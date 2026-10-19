"""Builds Vectorize's font index: a shape descriptor for every letter of every Google Fonts face it can match.

Usage:
    VZ_GFONTS=/path/to/google/fonts python3 bench/fonts/build_index.py [OUT_DIR]

Writes OUT_DIR/font-index.json (families, their faces, the letters) and OUT_DIR/font-index.bin
(RECORD bytes per letter per face, faces in the JSON's order). OUT_DIR defaults to ui-src/assets.

A letter's record:
    32 bytes  8 x 8 grid of how much of each cell is ink, 4 bits each, over the letter's ink box
    1 byte    ink top above the baseline, in hundredths of the em (signed)
    1 byte    ink bottom (signed, negative below the baseline)
    1 byte    ink width in hundredths of the em
Each family also lists every weight it can draw ("ws"), so the page can try weights between the indexed ones.
A letter the face lacks is all zeros. The page computes the same descriptor from the traced letters
(lettering-index.js) and ranks faces by distance, then fits the closest few for real.
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import freetype
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gfonts  # noqa: E402

CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&"
GRID = 8
EM = 160          # render size in pixels per em
RECORD = GRID * GRID // 2 + 3
CAT = {"SANS_SERIF": "s", "SERIF": "r", "DISPLAY": "d", "HANDWRITING": "h", "MONOSPACE": "m"}


def faces_for(fam: dict) -> list[tuple[int, int]]:
    """The (weight, width) faces to index: up to four weights, plus narrow and wide cuts when the family has them."""
    ws = gfonts.weights(fam)
    want = []
    for t in (400, 700, 900, 300, 500):
        w = min(ws, key=lambda x: (abs(x - t), x))
        if w not in want:
            want.append(w)
        if len(want) >= 4:
            break
    out = [(w, 0) for w in sorted(want)]
    a = gfonts.axis(fam, "wdth")
    if a:
        for wd in (75, 125):
            if a["min"] <= wd <= a["max"] and wd != 100:
                for w in (min(ws, key=lambda x: abs(x - 400)), min(ws, key=lambda x: abs(x - 700))):
                    if (w, wd) not in out:
                        out.append((w, wd))
    return out


def descriptor(face: freetype.Face, ch: str) -> bytes:
    gi = face.get_char_index(ord(ch))
    if not gi:
        return bytes(RECORD)
    face.load_glyph(gi, freetype.FT_LOAD_RENDER | freetype.FT_LOAD_NO_HINTING)
    g = face.glyph
    bm = g.bitmap
    if bm.width == 0 or bm.rows == 0:
        return bytes(RECORD)
    a = np.array(bm.buffer, dtype=np.uint8).reshape(bm.rows, bm.pitch)[:, : bm.width] >= 128
    ys, xs = np.nonzero(a)
    if not len(xs):
        return bytes(RECORD)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    a = a[y0:y1, x0:x1].astype(np.float32)
    grid = cell_means(a)
    q = np.clip(np.round(grid * 15), 0, 15).astype(np.uint8).ravel()
    packed = bytes((int(q[i]) << 4) | int(q[i + 1]) for i in range(0, len(q), 2))
    top = (g.bitmap_top - y0) / EM
    bottom = (g.bitmap_top - y1) / EM
    width = (x1 - x0) / EM
    c = lambda v: max(-128, min(127, int(round(v * 100))))
    return packed + struct.pack("bbB", c(top), c(bottom), max(0, min(255, int(round(width * 100)))))


def cell_means(a: np.ndarray) -> np.ndarray:
    """Fraction of ink in each cell of a GRID x GRID split of a (by area, cells may be fractional)."""
    h, w = a.shape
    out = np.zeros((GRID, GRID), dtype=np.float32)
    ys = np.linspace(0, h, GRID + 1)
    xs = np.linspace(0, w, GRID + 1)
    # Integral image for fractional cell sums.
    I = np.zeros((h + 1, w + 1), dtype=np.float64)
    I[1:, 1:] = np.cumsum(np.cumsum(a, 0), 1)

    def S(y, x):  # bilinear lookup of the integral image at fractional coords
        y0, x0 = int(np.floor(y)), int(np.floor(x)); y1, x1 = min(h, y0 + 1), min(w, x0 + 1)
        fy, fx = y - y0, x - x0
        return (I[y0, x0] * (1 - fy) * (1 - fx) + I[y1, x0] * fy * (1 - fx) + I[y0, x1] * (1 - fy) * fx + I[y1, x1] * fy * fx)
    for j in range(GRID):
        for i in range(GRID):
            area = (ys[j + 1] - ys[j]) * (xs[i + 1] - xs[i])
            s = S(ys[j + 1], xs[i + 1]) - S(ys[j], xs[i + 1]) - S(ys[j + 1], xs[i]) + S(ys[j], xs[i])
            out[j, i] = s / area if area > 0 else 0
    return out


def family_records(name: str):
    """(name, [[w, wd], ...], bytes) for one family, or None when it isn't a Latin text family."""
    fam = gfonts.catalog()[name]
    inst, blob = [], bytearray()
    for w, wd in faces_for(fam):
        try:
            if fam.get("axes"):
                # Variable fonts: FreeType sets the axes directly, much faster than cutting an instance.
                face = freetype.Face(str(gfonts.font_path(fam, w)))
                vi = face.get_variation_info()
                coords = []
                for ax in vi.axes:
                    t = ax.tag
                    v = w if t == "wght" else (wd if t == "wdth" and wd else ax.default)
                    coords.append(max(ax.minimum, min(ax.maximum, v)))
                face.set_var_design_coords(coords)
            else:
                face = freetype.Face(_mem(gfonts.instance_bytes(name, w, None, overlaps=False)))
            face.set_pixel_sizes(EM, EM)
            recs = [descriptor(face, ch) for ch in CHARS]
        except Exception as e:
            print("skip", name, w, wd, e)
            continue
        if sum(1 for r in recs[:52] if any(r)) < 40:      # not a Latin text face (symbols, icons)
            return None
        blob += b"".join(recs)
        inst.append([w, wd])
    return (name, inst, bytes(blob)) if inst else None


def main(out: Path):
    from multiprocessing import Pool
    cat = gfonts.catalog()
    fams, blob = [], bytearray()
    names = sorted(cat)
    with Pool() as pool:
        for n, r in enumerate(pool.imap(family_records, names, chunksize=4)):
            if r:
                name, inst, b = r
                fams.append({"n": name, "c": CAT.get(cat[name]["category"], "s"), "l": cat[name]["license"], "i": inst, "ws": gfonts.weights(cat[name])})
                blob += b
            if n % 100 == 0:
                print(n, names[n], len(blob) // (RECORD * len(CHARS)), "faces", flush=True)
    out.mkdir(parents=True, exist_ok=True)
    (out / "font-index.bin").write_bytes(bytes(blob))
    (out / "font-index.json").write_text(json.dumps({"version": 1, "chars": CHARS, "grid": GRID, "record": RECORD,
                                                     "source": "github.com/google/fonts", "families": fams}, separators=(",", ":")))
    print(f"{len(fams)} families, {len(blob) // (RECORD * len(CHARS))} faces, {len(blob) / 1e6:.1f} MB")


_tmp = []


def _mem(data: bytes):
    """freetype-py opens files or file objects; hand it an in-memory file."""
    import io
    b = io.BytesIO(data); _tmp.append(b)
    return b


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "ui-src" / "assets")
