"""Reads a google/fonts checkout's METADATA.pb files into a catalog of Latin families.

Usage: python3 bench/fonts/catalog.py GOOGLE_FONTS_DIR > catalog.json
Only OFL and Apache families with the latin subset and an upright style are kept; UFL is left
out until its terms are reviewed (see DESIGN.md and the lettering research).
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

def parse(text: str) -> dict:
    fam = {"fonts": [], "axes": [], "subsets": [], "classifications": []}
    for key in ("name", "license", "category", "stroke", "date_added", "designer"):
        m = re.search(rf'^{key}: "([^"]*)"', text, re.M)
        fam[key] = m.group(1) if m else ""
    for block in re.findall(r"^fonts \{(.*?)^\}", text, re.M | re.S):
        g = lambda k: (re.search(rf'{k}: "?([^"\n]*)"?', block) or [None, ""])[1]
        fam["fonts"].append({"style": g("style"), "weight": int(g("weight") or 400), "filename": g("filename")})
    for block in re.findall(r"^axes \{(.*?)^\}", text, re.M | re.S):
        t = re.search(r'tag: "(\w+)"', block).group(1)
        lo = float(re.search(r"min_value: ([\d.\-]+)", block).group(1)); hi = float(re.search(r"max_value: ([\d.\-]+)", block).group(1))
        fam["axes"].append({"tag": t, "min": lo, "max": hi})
    fam["subsets"] = re.findall(r'^subsets: "([^"]+)"', text, re.M)
    fam["classifications"] = re.findall(r'^classifications: "([^"]+)"', text, re.M)
    return fam

def main(root: Path):
    out = []
    for lic in ("ofl", "apache"):
        for md in sorted((root / lic).glob("*/METADATA.pb")):
            f = parse(md.read_text())
            if "latin" not in f["subsets"]: continue
            upright = [x for x in f["fonts"] if x["style"] == "normal"]
            if not upright: continue
            f["dir"] = f"{lic}/{md.parent.name}"
            f["fonts"] = upright
            out.append(f)
    json.dump(out, sys.stdout, indent=0)

if __name__ == "__main__":
    main(Path(sys.argv[1]))
