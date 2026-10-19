"""Compares text readers on the lettering test set: tesseract.js (what the web page uses) and PP-OCR (RapidOCR,
ONNX Runtime). Apple Vision runs only on a Mac; its numbers come from the Mac self-test, not from here.

Usage:
    python3 bench/ocr_bakeoff.py [--limit N] [--out FILE]

For every truth word it checks whether the reader returned each of its tokens (case-insensitive, punctuation
ignored), and reports token recall, exact-word recall, extra tokens (things read that aren't there), and time.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bench"))
import text_score as ts  # noqa: E402

norm = lambda s: re.sub(r"[^0-9a-z&]+", "", s.lower())


def tokens(s: str) -> list[str]:
    return [t for t in (norm(x) for x in s.split()) if t]


def score(truth_words, read_lines):
    want = [t for w in truth_words for t in tokens(w["text"])]
    got = [t for l in read_lines for t in tokens(l)]
    pool, hit = list(got), 0
    for t in want:
        if t in pool:
            pool.remove(t); hit += 1
    words_ok = sum(1 for w in truth_words if all(t in got for t in tokens(w["text"])))
    return {"tokens": len(want), "hit": hit, "extra": len(pool), "words": len(truth_words), "words_ok": words_ok}


def rapid_reader():
    from rapidocr_onnxruntime import RapidOCR
    eng = RapidOCR()

    def read(path: Path):
        res, _ = eng(str(path))
        return [r[1] for r in (res or [])]
    return read


async def tesseract_reads(cases):
    from playwright.async_api import async_playwright
    out = {}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(); pg = await ctx.new_page()
        await pg.goto(await ts.route_app(ctx))
        await pg.wait_for_function("typeof webReadText === 'function'")
        for c in cases:
            path = ts.SET / "images" / c["image"]
            mime = "image/png" if path.suffix == ".png" else "image/jpeg"
            d = f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()
            t0 = time.time()
            lines = await pg.evaluate("async u => (await webReadText({ srcURL: u })).map(l => l.text)", d)
            out[c["name"]] = (lines, time.time() - t0)
        await b.close()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=60, help="synthetic cases to include")
    ap.add_argument("--out", default=str(ROOT / "bench" / "ocr_bakeoff.json"))
    a = ap.parse_args()
    index = json.loads((ts.SET / "index.json").read_text())
    cases = [c for c in index if c["kind"] != "synthetic"] + [c for c in index if c["kind"] == "synthetic"][: a.limit]
    truth = {c["name"]: json.loads((ts.SET / "truth" / f'{c["name"]}.json').read_text())["words"] for c in cases}
    results = {}
    tess = asyncio.run(tesseract_reads(cases))
    rapid = rapid_reader()
    rr = {}
    for c in cases:
        t0 = time.time(); lines = rapid(ts.SET / "images" / c["image"]); rr[c["name"]] = (lines, time.time() - t0)
    for name, reads in (("tesseract.js", tess), ("PP-OCR (RapidOCR)", rr)):
        tot = {"tokens": 0, "hit": 0, "extra": 0, "words": 0, "words_ok": 0}
        per = {}
        for c in cases:
            s = score(truth[c["name"]], reads[c["name"]][0]); per[c["name"]] = {**s, "read": reads[c["name"]][0]}
            for k in tot: tot[k] += s[k]
        secs = sum(v[1] for v in reads.values())
        results[name] = {"token_recall": round(tot["hit"] / tot["tokens"], 3), "word_recall": round(tot["words_ok"] / tot["words"], 3),
                         "extra_per_image": round(tot["extra"] / len(cases), 2), "seconds_per_image": round(secs / len(cases), 2),
                         "protected_word_recall": round(sum(per[c["name"]]["words_ok"] for c in cases if c["kind"] != "synthetic") / sum(per[c["name"]]["words"] for c in cases if c["kind"] != "synthetic"), 3),
                         "per_case": per}
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(results, indent=1))
    for k, v in results.items():
        print(k, {x: y for x, y in v.items() if x != "per_case"})


if __name__ == "__main__":
    main()
