"""Builds Vectorize's offline font pack: the popular Google Fonts families, Latin only, one file per weight.

Usage:
    VZ_GFONTS=/path/to/google/fonts python3 bench/fonts/make_pack.py [OUT_DIR]

OUT_DIR defaults to packaging/fonts. The app looks for "<family-slug>-<weight>.ttf" there (app/fonts.py) before
its download cache and Google Fonts, so these families swap in with no network. Each family's license file
(OFL.txt or LICENSE.txt) is copied to OUT_DIR/licenses/<family-slug>.txt, and NOTICE.txt lists them all.
The families and weights are the FONTS list in ui-src/app.js.
"""
from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import gfonts  # noqa: E402

# Basic Latin, Latin-1, Latin Extended-A, and common punctuation (curly quotes, dashes, bullet, ellipsis, euro).
UNICODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x180)) + [0x131, 0x152, 0x153, 0x2C6, 0x2DA, 0x2DC] + \
    list(range(0x2010, 0x2028)) + [0x2030, 0x2039, 0x203A, 0x20AC, 0x2122, 0x2212]


def slug(family: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", family.lower()).strip("-")


def popular() -> list[tuple[str, list[int]]]:
    """The FONTS list from ui-src/app.js."""
    src = (ROOT / "ui-src" / "app.js").read_text()
    block = src[src.index("let FONTS = ["):src.index("];", src.index("let FONTS = ["))]
    return [(m.group(1), [int(w) for w in m.group(2).split(",")]) for m in re.finditer(r'\["([^"]+)", \[([\d, ]+)\]\]', block)]


def latin(data: bytes) -> bytes:
    f = TTFont(io.BytesIO(data))
    opts = subset.Options()
    opts.layout_features = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk"]
    opts.hinting = False
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    s = subset.Subsetter(opts)
    s.populate(unicodes=UNICODES)
    s.subset(f)
    out = io.BytesIO()
    f.save(out)
    return out.getvalue()


def license_file(fam: dict) -> Path | None:
    d = gfonts.ROOT / fam["dir"]
    for name in ("OFL.txt", "LICENSE.txt", "UFL.txt"):
        if (d / name).exists():
            return d / name
    return None


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    (out / "licenses").mkdir(exist_ok=True)
    cat = gfonts.catalog()
    notice, total = [], 0
    for family, ws in popular():
        fam = cat.get(family)
        if not fam:
            print("not in the catalog:", family)
            continue
        for w in ws:
            if gfonts.nearest_weight(fam, w) != w:
                print("no weight", w, "for", family)
                continue
            data = latin(gfonts.instance_bytes(family, w, None, overlaps=True))
            (out / f"{slug(family)}-{w}.ttf").write_bytes(data)
            total += len(data)
        lic = license_file(fam)
        if lic:
            (out / "licenses" / f"{slug(family)}.txt").write_bytes(lic.read_bytes())
        notice.append(f"{family}: {fam['license']}, weights {', '.join(map(str, ws))}, from github.com/google/fonts/tree/main/{fam['dir']}"
                      + (f"; license in licenses/{slug(family)}.txt" if lic else ""))
    (out / "NOTICE.txt").write_text(
        "Fonts bundled with Vectorize for offline font matching. Each is subset to Latin and redistributed under its\n"
        "own license (SIL Open Font License 1.1 or Apache License 2.0); the license texts are in licenses/.\n\n"
        + "\n".join(notice) + "\n")
    (out / "pack.json").write_text(json.dumps({"families": [f for f, _ in popular()]}, indent=1))
    print(f"{len(notice)} families, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "packaging" / "fonts")
