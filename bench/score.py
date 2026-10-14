"""Scores the Vectorize engine on the generated test logos, where the right answer is known.

Usage:
    python3 bench/score.py [OUT_DIR] [--preset logo] [--set key=value ...] [--check BASELINE.json] [--save-baseline]

It traces every image in bench/testset/images with the app's own engine (in a
headless browser, from ui/index.html), renders each result and its true artwork
at the same size, and measures:

- shape error: the share of the artwork's pixels that come out the wrong color, in percent
- edge error: how far traced edges sit from the true edges, on average, in pixels of the test image
- worst edge: the 95th-percentile edge distance, which catches blobs and missing pieces
- corner error: how far each true sharp corner sits from the traced outline, in pixels of the
  test image. Rounded corners score high; crisp corners score near 0.
- points: path points in the SVG, a measure of how easy the file is to edit

Lower is better for all of them. Text is scored as traced: the automatic font swap needs the
Mac app's text recognition and doesn't run here.

--check compares the overall averages with a saved baseline and exits with 1 when edge error,
corner error, or shape error gets more than 10 percent worse. --save-baseline writes
bench/baseline.json from this run.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import sys
import time
from pathlib import Path

import cairosvg
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

sys.path.insert(0, str(Path(__file__).parent))
from run import svg_stats, webp  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "ui" / "index.html"
SET = Path(__file__).with_name("testset")
BASELINE = Path(__file__).with_name("baseline.json")
HR = 1200                     # width both renders are compared at
METRICS = ["shape_error", "edge_error", "worst_edge", "corner_error", "points"]
CHECKED = ["shape_error", "edge_error", "corner_error"]
WORSE_BY = 0.10


def hexrgb(h: str) -> np.ndarray:
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)


def render(svg: str, w: int, h: int, bg: str) -> np.ndarray:
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=w, output_height=h, background_color=bg)
    return np.asarray(Image.open(io.BytesIO(png)).convert("RGB"), float)


def labels(img: np.ndarray, pal: np.ndarray) -> np.ndarray:
    d = ((img[:, :, None, :] - pal[None, None, :, :]) ** 2).sum(-1)
    return d.argmin(-1)


def boundary(lab: np.ndarray) -> np.ndarray:
    b = np.zeros(lab.shape, bool)
    b[:, :-1] |= lab[:, :-1] != lab[:, 1:]
    b[:-1, :] |= lab[:-1, :] != lab[1:, :]
    return b


def score_one(truth_svg: str, meta: dict, traced_svg: str, src_w: int) -> tuple[dict, np.ndarray, np.ndarray]:
    w, h = HR, round(HR * meta["height"] / meta["width"])
    bg = meta["background"] or "#FFFFFF"
    pal = np.array([hexrgb(c) for c in meta["colors"]])
    bgi = meta["colors"].index(bg.upper()) if bg.upper() in meta["colors"] else -1
    a = render(truth_svg, w, h, bg)
    b = render(traced_svg, w, h, bg)
    la, lb = labels(a, pal), labels(b, pal)
    ink = (la != bgi) | (lb != bgi)
    k = src_w / w                              # test-image pixels per comparison pixel
    ba, bb = boundary(la), boundary(lb)
    da = distance_transform_edt(~ba)           # distance to the true edge
    db = distance_transform_edt(~bb)           # distance to the traced edge
    e1, e2 = db[ba], da[bb]
    edges = np.concatenate([e1, e2]) if e1.size + e2.size else np.zeros(1)
    s = HR / meta["width"]
    corners = []
    for x, y in meta["corners"]:
        cx, cy = int(round(x * s)), int(round(y * s))
        if 0 <= cx < w and 0 <= cy < h and da[min(cy, h - 1), min(cx, w - 1)] <= 1.5:   # visible corners only
            corners.append(db[cy, cx])
    st = svg_stats(traced_svg)
    return ({
        "shape_error": round(float((la != lb)[ink].mean()) * 100, 2) if ink.any() else 0.0,
        "edge_error": round(float(edges.mean()) * k, 3),
        "worst_edge": round(float(max(np.percentile(e1, 95) if e1.size else 0, np.percentile(e2, 95) if e2.size else 0)) * k, 3),
        "corner_error": round(float(np.mean(corners)) * k, 3) if corners else None,
        "corners": len(corners),
        "points": st["nodes"],
    }, a, b)


async def trace_all(images: list[Path], preset: str, overrides: dict) -> dict:
    from playwright.async_api import async_playwright
    out = {}
    async with async_playwright() as p:
        br = await p.chromium.launch()
        pg = await br.new_page(viewport={"width": 1280, "height": 800})
        await pg.goto("file://" + str(UI))
        await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=120000)
        for img in images:
            mime = "image/png" if img.suffix == ".png" else "image/jpeg"
            url = f"data:{mime};base64," + base64.b64encode(img.read_bytes()).decode()
            t0 = time.time()
            svg = await pg.evaluate("""async ([url, preset, over]) => {
                Object.assign(S, PRESETS[preset], { preset }, over); syncControls();
                const done = convertDone(); await openImage(url, 'score', ''); await done;
                return result ? buildSVG() : null;
            }""", [url, preset, overrides])
            out[img.name] = (svg, round(time.time() - t0, 2))
        await br.close()
    return out


def summarize(rows: list[dict]) -> dict:
    groups = {"all": rows}
    for r in rows:
        groups.setdefault(r["variant"], []).append(r)
    out = {}
    for g, rs in groups.items():
        out[g] = {}
        for m in METRICS:
            v = [r[m] for r in rs if r.get(m) is not None]
            out[g][m] = round(float(np.mean(v)), 3) if v else None
    return out


def variant(name: str) -> str:
    return "JPEG 480 px" if name.endswith(".jpg") else "PNG 240 px" if "-small." in name else "PNG 480 px"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default="bench-out")
    ap.add_argument("--preset", default="logo")
    ap.add_argument("--set", action="append", default=[], help="override a setting, such as smooth=60")
    ap.add_argument("--check", help="baseline JSON to compare against")
    ap.add_argument("--save-baseline", action="store_true")
    args = ap.parse_args()
    over = {}
    for kv in args.set:
        key, val = kv.split("=", 1)
        over[key] = json.loads(val) if val[:1] in "0123456789-tf[{\"" else val
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    index = json.loads((SET / "index.json").read_text())
    images = [SET / "images" / it["image"] for it in index]
    print(f"Tracing {len(images)} test logos with the {args.preset} preset")
    traced = asyncio.run(trace_all(images, args.preset, over))
    rows, cards = [], []
    for it in index:
        name = it["image"]
        meta = json.loads((SET / "truth" / f"{it['truth']}.json").read_text())
        truth = (SET / "truth" / f"{it['truth']}.svg").read_text()
        svg, secs = traced[name]
        if not svg:
            print(f"  {name}: no result"); continue
        (out / (Path(name).stem + "." + Path(name).suffix[1:] + ".svg")).write_text(svg)
        m, a, b = score_one(truth, meta, svg, it["width"])
        row = {"image": name, "truth": it["truth"], "variant": variant(name), **m, "seconds": secs}
        rows.append(row)
        diff = np.where((np.abs(a - b).max(-1) > 60)[..., None], [214, 40, 40], b * 0.35 + 165).astype(np.uint8)
        cards.append((row, meta["about"], webp(Image.open(SET / "images" / name).convert("RGB").resize((a.shape[1] // 2, a.shape[0] // 2), Image.NEAREST), 600),
                      webp(Image.fromarray(b.astype(np.uint8)), 600), webp(Image.fromarray(diff), 600)))
        print(f"  {name:32s} shape {m['shape_error']:6.2f}%  edge {m['edge_error']:.3f}  corner {m['corner_error'] if m['corner_error'] is not None else '-':>6}  points {m['points']}")
    summary = summarize(rows)
    result = {"preset": args.preset, "overrides": over, "summary": summary, "images": rows}
    (out / "results.json").write_text(json.dumps(result, indent=1))
    base = json.loads(Path(args.check).read_text()) if args.check and Path(args.check).exists() else None
    (out / "report.html").write_text(report(result, cards, base))
    print("\nAverages (lower is better):")
    for g, s in summary.items():
        print(f"  {g:12s} " + "  ".join(f"{m} {s[m]}" for m in METRICS))
    print("wrote", out / "report.html")
    if args.save_baseline:
        BASELINE.write_text(json.dumps({"preset": args.preset, "summary": summary}, indent=1) + "\n")
        print("saved", BASELINE)
    if base:
        worse = []
        for m in CHECKED:
            old, new = base["summary"]["all"][m], summary["all"][m]
            if old and new is not None and new > old * (1 + WORSE_BY) + 1e-9:
                worse.append(f"{m} went from {old} to {new}")
        if worse:
            print("WORSE than the baseline: " + "; ".join(worse))
            sys.exit(1)
        print("No score is more than 10 percent worse than the baseline.")


def report(result: dict, cards: list, base: dict | None) -> str:
    names = {"shape_error": "Shape error", "edge_error": "Edge error", "worst_edge": "Worst edge", "corner_error": "Corner error", "points": "Points"}
    units = {"shape_error": "%", "edge_error": " px", "worst_edge": " px", "corner_error": " px", "points": ""}

    def cell(g, m):
        v = result["summary"][g][m]
        s = f"{v}{units[m]}"
        if base and g in base["summary"] and base["summary"][g].get(m):
            old = base["summary"][g][m]
            ch = (v - old) / old * 100
            cls = "better" if ch < -1 else "worse" if ch > 1 else ""
            s += f" <small class='{cls}'>{ch:+.0f}%</small>"
        return f"<td>{s}</td>"
    head = "".join(f"<th>{names[m]}</th>" for m in METRICS)
    rows = "".join(f"<tr><th scope='row'>{g}</th>" + "".join(cell(g, m) for m in METRICS) + "</tr>" for g in result["summary"])
    body = []
    for r, about, src, out, diff in cards:
        body.append(f"<section><h2>{r['image']}</h2><p>{about}. Shape error {r['shape_error']}% · edge error {r['edge_error']} px · "
                    f"worst edge {r['worst_edge']} px · corner error {r['corner_error']} px over {r['corners']} corners · {r['points']:,} points</p>"
                    f"<div class='grid'><figure><figcaption>Test image</figcaption><img src='{src}' alt=''></figure>"
                    f"<figure><figcaption>Traced</figcaption><img src='{out}' alt=''></figure>"
                    f"<figure><figcaption>Wrong pixels in red</figcaption><img src='{diff}' alt=''></figure></div></section>")
    over = ", ".join(f"{k} {v}" for k, v in result["overrides"].items()) or "no changes"
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tracing Scores</title><style>
:root{{--bg:#FAF8F2;--ink:#1E2340;--muted:#5F5F74;--line:#ECEAE3;--card:#fff;--good:#2E7D4F;--bad:#C0392B}}
@media (prefers-color-scheme:dark){{:root:not([data-theme=light]){{--bg:#14172A;--ink:#FAF8F2;--muted:#B4B3C6;--line:#2C3150;--card:#1E2340;--good:#6FCF97;--bad:#FF8A80}}}}
:root[data-theme=dark]{{--bg:#14172A;--ink:#FAF8F2;--muted:#B4B3C6;--line:#2C3150;--card:#1E2340;--good:#6FCF97;--bad:#FF8A80}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Avenir Next",Nunito,-apple-system,sans-serif;padding:24px 16px 64px}}
main{{max-width:1300px;margin:0 auto}}h1{{font-size:28px;margin:0 0 6px}}h2{{font-size:16px;margin:28px 0 4px}}p{{color:var(--muted);max-width:80ch;margin:4px 0 10px}}
.wrap{{overflow-x:auto}}table{{border-collapse:collapse;background:var(--card);margin:16px 0;width:100%}}th,td{{padding:8px 12px;border-bottom:1px solid var(--line);text-align:left;font-variant-numeric:tabular-nums}}
small.better{{color:var(--good);font-weight:700}}small.worse{{color:var(--bad);font-weight:700}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}}figure{{margin:0;background:var(--card);padding:8px;border-radius:10px}}
figcaption{{font-size:12.5px;color:var(--muted);margin-bottom:6px}}figure img{{display:block;width:100%;height:auto;image-rendering:auto}}
</style></head><body><main><h1>Tracing scores</h1>
<p>{len(cards)} generated test logos traced with the {result['preset']} preset ({over}). Each trace is compared with the true artwork. Lower is better everywhere. Edge and corner errors are in pixels of the test image.{' Changes are against the saved baseline.' if base else ''}</p>
<div class="wrap"><table><thead><tr><th>Images</th>{head}</tr></thead><tbody>{rows}</tbody></table></div>
{''.join(body)}</main></body></html>"""


if __name__ == "__main__":
    main()
