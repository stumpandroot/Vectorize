"""Google Fonts files for the lettering test set, the font index, and the test font server.

Reads a google/fonts checkout (set VZ_GFONTS, default /home/claude/gf/gfonts) through the catalog in
bench/fonts/catalog.json (built by catalog.py). Instances are cut with fontTools, overlaps removed, and
cached as TTF bytes in VZ_GFONTS_CACHE (default /tmp/vz-gfonts-cache).
"""
from __future__ import annotations

import hashlib
import io
import json
import os
from functools import lru_cache
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.ttLib.removeOverlaps import removeOverlaps
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("VZ_GFONTS", "/home/claude/gf/gfonts"))
CACHE = Path(os.environ.get("VZ_GFONTS_CACHE", "/tmp/vz-gfonts-cache"))


@lru_cache(maxsize=1)
def catalog() -> dict:
    return {f["name"]: f for f in json.loads((HERE / "catalog.json").read_text())}


def axis(fam: dict, tag: str):
    return next((a for a in fam.get("axes", []) if a["tag"] == tag), None)


def weights(fam: dict) -> list[int]:
    """The weights a family can draw: its static files, or 100-steps across its wght axis."""
    a = axis(fam, "wght")
    if a:
        return [w for w in range(100, 1000, 100) if a["min"] - 1e-6 <= w <= a["max"] + 1e-6] or [int(a["min"])]
    return sorted({x["weight"] for x in _static_files(fam)})


def _static_files(fam: dict) -> list[dict]:
    """Upright static files: the catalog's picks plus any other upright file present in the checkout."""
    return [x for x in fam["fonts"] if x["filename"] in fam["pick"]
            or (x.get("style", "normal") in (None, "normal") and "Italic" not in x["filename"] and (ROOT / fam["dir"] / x["filename"]).exists())]


def nearest_weight(fam: dict, w: int) -> int:
    ws = weights(fam)
    return min(ws, key=lambda x: (abs(x - w), x))


def font_path(fam: dict, w: int) -> Path:
    if fam.get("axes"):
        return ROOT / fam["dir"] / fam["pick"][0]
    files = _static_files(fam)
    best = min(files, key=lambda x: abs(x["weight"] - w))
    return ROOT / fam["dir"] / best["filename"]


def instance_bytes(name: str, w: int = 400, wdth: float | None = None, overlaps: bool = True) -> bytes:
    """TTF bytes for one family at one weight (and width), upright. overlaps=True removes overlapping contours
    (for exact vector truth); False is much faster and fine for rasterizing."""
    fam = catalog()[name]
    w = nearest_weight(fam, w)
    if not overlaps and not fam.get("axes"):
        return font_path(fam, w).read_bytes()
    key = hashlib.sha1(f"{name}|{w}|{wdth}|{overlaps}".encode()).hexdigest()[:16]
    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / f"{key}.ttf"
    if out.exists():
        return out.read_bytes()
    f = TTFont(font_path(fam, w))
    if "fvar" in f:
        loc = {}
        for a in f["fvar"].axes:
            if a.axisTag == "wght":
                loc["wght"] = max(a.minValue, min(a.maxValue, w))
            elif a.axisTag == "wdth" and wdth is not None:
                loc["wdth"] = max(a.minValue, min(a.maxValue, wdth))
            else:
                loc[a.axisTag] = a.defaultValue
        f = instancer.instantiateVariableFont(f, loc, overlap=instancer.OverlapMode.REMOVE if overlaps else instancer.OverlapMode.KEEP_AND_SET_FLAGS)
    elif overlaps:
        try:
            removeOverlaps(f)
        except Exception:
            pass
    buf = io.BytesIO()
    f.save(buf)
    out.write_bytes(buf.getvalue())
    return buf.getvalue()


def ttfont(name: str, w: int = 400, wdth: float | None = None) -> TTFont:
    return TTFont(io.BytesIO(instance_bytes(name, w, wdth)))
