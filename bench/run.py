"""Head-to-head tracing benchmark: the current Vectorize engine against VTracer 1.0.

Usage:
    python3 bench/run.py IMAGES_DIR OUT_DIR

For each PNG or JPEG in IMAGES_DIR it saves every engine's SVG, renders each one
back to pixels, scores it against the original, and writes OUT_DIR/report.html
plus OUT_DIR/results.json.

Scores (lower is better except where noted):
- mismatch: share of all pixels whose color differs visibly from the original.
- edge error: the same, counted only in a thin band along the original's edges.
  Letters and fine detail live here, so it's the best single number for text.
- nodes: path points in the SVG, a proxy for how hard the file is to edit.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import cairosvg
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "ui" / "index.html"
VT = Path(__file__).with_name("vt.js")

# Engines to compare: (key, label, how)
VT_CONFIGS = [
    ("vt_default", "VTracer, defaults", {}, None),
    ("vt_poster", "VTracer, poster + simplify", {"preset": "poster", "simplify": 1.5}, None),
    ("vt_poster_up", "VTracer, poster + simplify, enlarged to 1,600 px", {"preset": "poster", "simplify": 1.5}, 1600),
]
ENGINES = [("vz", "Vectorize (current)")] + [(k, l) for k, l, _, _ in VT_CONFIGS]


def load_original(p: Path) -> Image.Image:
    im = Image.open(p)
    im = im.convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    return Image.alpha_composite(bg, im).convert("RGB")


def render_svg(svg: str, w: int, h: int) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=w, output_height=h, background_color="white")
    return Image.open(io.BytesIO(png)).convert("RGB")


def edge_band(orig: Image.Image, radius: int) -> np.ndarray:
    g = orig.convert("L")
    e = np.asarray(g.filter(ImageFilter.FIND_EDGES), float) > 24
    band = Image.fromarray((e * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * radius + 1))
    return np.asarray(band) > 0


def score(orig: Image.Image, rend: Image.Image, band: np.ndarray) -> dict:
    a = np.asarray(orig, float)
    b = np.asarray(rend.resize(orig.size), float)
    bad = np.abs(a - b).max(axis=2) > 48
    return {
        "mismatch": round(float(bad.mean()) * 100, 2),
        "edge_error": round(float(bad[band].mean()) * 100, 2) if band.any() else 0.0,
    }


def svg_stats(svg: str) -> dict:
    shapes = len(re.findall(r"<(path|circle|ellipse|rect|polygon)\b", svg))
    nodes = 0
    for d in re.findall(r'\sd="([^"]*)"', svg):
        nodes += len(re.findall(r"[MLHVCSQTAmlhvcsqta]", d))
    nodes += 4 * len(re.findall(r"<(circle|ellipse|rect)\b", svg))
    nodes += sum(len(p.split()) for p in re.findall(r'points="([^"]*)"', svg))
    return {"shapes": shapes, "nodes": nodes, "kb": round(len(svg.encode()) / 1024, 1)}


def busiest_crop(orig: Image.Image, frac: float = 0.34) -> tuple[int, int, int, int]:
    """The square window with the most edges: usually the lettering."""
    w, h = orig.size
    s = max(32, int(min(w, h) * frac))
    e = np.asarray(orig.convert("L").filter(ImageFilter.FIND_EDGES), float) > 24
    ii = e.cumsum(0).cumsum(1)
    best, bx, by = -1, 0, 0
    step = max(4, s // 8)
    for y in range(0, h - s + 1, step):
        for x in range(0, w - s + 1, step):
            v = ii[y + s - 1, x + s - 1] - (ii[y - 1, x + s - 1] if y else 0) - (ii[y + s - 1, x - 1] if x else 0) + (ii[y - 1, x - 1] if x and y else 0)
            if v > best:
                best, bx, by = v, x, y
    return bx, by, bx + s, by + s


def webp(im: Image.Image, maxw: int) -> str:
    if im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "WEBP", quality=82)
    return "data:image/webp;base64," + base64.b64encode(b.getvalue()).decode()


async def trace_vectorize(images: list[Path]) -> dict:
    """Runs the app's own engine in a headless browser, with the Logo preset and the background kept."""
    from playwright.async_api import async_playwright
    out = {}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1280, "height": 800})
        await pg.goto("file://" + str(UI))
        await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=120000)
        for img in images:
            mime = "image/png" if img.suffix.lower() == ".png" else "image/jpeg"
            url = f"data:{mime};base64," + base64.b64encode(img.read_bytes()).decode()
            t0 = time.time()
            svg = await pg.evaluate("""async url => {
                Object.assign(S, PRESETS.logo, { preset: 'logo', bg: 'keep', textMode: 'auto' }); syncControls();
                const done = convertDone(); await openImage(url, 'bench', ''); await done;
                return result ? buildSVG() : null;
            }""", url)
            out[img.name] = {"svg": svg, "seconds": round(time.time() - t0, 2)}
            print(f"  vectorize  {img.name}: {out[img.name]['seconds']} s", flush=True)
        await b.close()
    return out


def trace_vtracer(img: Path, svg_out: Path, opts: dict, up) -> float:
    args = ["node", str(VT), str(img), str(svg_out), json.dumps(opts)] + ([str(up)] if up else [])
    r = subprocess.run(args, capture_output=True, text=True, timeout=600)
    if r.returncode:
        raise RuntimeError(r.stderr.strip())
    return round(int(r.stdout.strip()) / 1000, 2)


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    images = sorted(p for p in src.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg"))
    if not images:
        sys.exit(f"No PNG or JPEG files in {src}")
    print(f"{len(images)} images")
    vz = asyncio.run(trace_vectorize(images))
    results = []
    for img in images:
        orig = load_original(img)
        w, h = orig.size
        band = edge_band(orig, max(1, round(max(w, h) / 400)))
        crop = busiest_crop(orig)
        row = {"name": img.name, "size": [w, h], "crop": crop, "engines": {}}
        svgs = {"vz": (vz[img.name]["svg"], vz[img.name]["seconds"])}
        for key, label, opts, up in VT_CONFIGS:
            p = out / f"{img.stem}.{key}.svg"
            try:
                secs = trace_vtracer(img, p, opts, up)
                svgs[key] = (p.read_text(), secs)
            except Exception as e:
                svgs[key] = (None, 0)
                print(f"  {key} {img.name}: failed: {e}")
        for key, (svg, secs) in svgs.items():
            if not svg:
                row["engines"][key] = {"error": True}
                continue
            (out / f"{img.stem}.{key}.svg").write_text(svg)
            big = render_svg(svg, w * 2, h * 2)
            rend = big.resize((w, h), Image.LANCZOS)
            row["engines"][key] = {**score(orig, rend, band), **svg_stats(svg), "seconds": secs,
                                   "img": webp(big, 900), "zoom": webp(big.crop(tuple(2 * v for v in crop)), 700)}
        row["orig"] = webp(orig, 900)
        row["orig_zoom"] = webp(orig.crop(crop).resize(((crop[2] - crop[0]) * 2, (crop[3] - crop[1]) * 2), Image.NEAREST), 700)
        results.append(row)
        e = row["engines"]
        print(f"  {img.name}: " + "  ".join(f"{k} edge {e[k].get('edge_error', '-')}%" for k, _ in ENGINES))
    slim = [{k: v for k, v in r.items() if k not in ("orig", "orig_zoom")} | {"engines": {k: {m: x for m, x in v.items() if m not in ("img", "zoom")} for k, v in r["engines"].items()}} for r in results]
    (out / "results.json").write_text(json.dumps(slim, indent=2))
    (out / "report.html").write_text(report(results))
    print("wrote", out / "report.html")


def report(results) -> str:
    def med(key, metric):
        v = sorted(r["engines"][key][metric] for r in results if metric in r["engines"].get(key, {}))
        return v[len(v) // 2] if v else None

    def wins(key):
        n = 0
        for r in results:
            vals = {k: r["engines"][k].get("edge_error") for k, _ in ENGINES if "edge_error" in r["engines"].get(k, {})}
            if vals and min(vals, key=vals.get) == key:
                n += 1
        return n

    summary = "".join(
        f"<tr><th scope='row'>{label}</th><td>{wins(k)}</td><td>{med(k, 'edge_error')}%</td><td>{med(k, 'mismatch')}%</td>"
        f"<td>{med(k, 'nodes'):,}</td><td>{med(k, 'kb')} KB</td><td>{med(k, 'seconds')} s</td></tr>" for k, label in ENGINES)
    cards = []
    for r in results:
        cells = [f"<figure><figcaption><b>Original</b><span>{r['size'][0]} × {r['size'][1]} px</span></figcaption>"
                 f"<img src='{r['orig']}' alt=''><img class='zoom' src='{r['orig_zoom']}' alt='Original, close-up'></figure>"]
        best = min((k for k, _ in ENGINES if "edge_error" in r["engines"].get(k, {})), key=lambda k: r["engines"][k]["edge_error"], default=None)
        for k, label in ENGINES:
            e = r["engines"].get(k, {})
            if e.get("error"):
                cells.append(f"<figure><figcaption><b>{label}</b><span>Failed</span></figcaption></figure>")
                continue
            cells.append(f"<figure{' class=best' if k == best else ''}><figcaption><b>{label}</b>"
                         f"<span>Edge error {e['edge_error']}% · mismatch {e['mismatch']}% · {e['nodes']:,} nodes · {e['kb']} KB · {e['seconds']} s</span></figcaption>"
                         f"<img src='{e['img']}' alt=''><img class='zoom' src='{e['zoom']}' alt='{label}, close-up'></figure>")
        cards.append(f"<section><h2>{r['name']}</h2><div class='grid'>{''.join(cells)}</div></section>")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tracing Benchmark</title><style>
:root{{--bg:#FAF8F2;--ink:#1E2340;--muted:#5F5F74;--line:#ECEAE3;--card:#fff;--sun:#FFC24B;--sun-tint:#FFF1CC}}
@media (prefers-color-scheme:dark){{:root:not([data-theme=light]){{--bg:#14172A;--ink:#FAF8F2;--muted:#B4B3C6;--line:#2C3150;--card:#1E2340;--sun-tint:#3A3220}}}}
:root[data-theme=dark]{{--bg:#14172A;--ink:#FAF8F2;--muted:#B4B3C6;--line:#2C3150;--card:#1E2340;--sun-tint:#3A3220}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Avenir Next",Nunito,-apple-system,sans-serif;padding:24px 16px 64px}}
main{{max-width:1500px;margin:0 auto}}h1{{font-size:28px;letter-spacing:-.02em;margin:0 0 6px}}h2{{font-size:17px;margin:32px 0 10px}}
p{{color:var(--muted);max-width:75ch}}table{{border-collapse:collapse;background:var(--card);border-radius:14px;overflow:hidden;margin:16px 0;width:100%;max-width:900px}}
th,td{{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;font-variant-numeric:tabular-nums}}thead th{{font-size:12.5px;color:var(--muted)}}
.wrap{{overflow-x:auto}}.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}}
figure{{margin:0;background:var(--card);border-radius:14px;padding:10px;box-shadow:inset 0 0 0 1px var(--line)}}figure.best{{box-shadow:inset 0 0 0 3px var(--sun);background:var(--sun-tint)}}
figcaption{{display:flex;flex-direction:column;gap:2px;margin-bottom:8px}}figcaption span{{font-size:12px;color:var(--muted)}}
figure img{{display:block;width:100%;height:auto;background:#fff;border-radius:8px}}img.zoom{{margin-top:8px;image-rendering:auto}}
</style></head><body><main>
<h1>Tracing benchmark</h1>
<p>Each image traced by the current Vectorize engine (Logo preset, background kept) and by VTracer 1.0.0-alpha.4 in three setups. Every SVG is rendered back to pixels and compared with the original. The lower image in each card is a close-up of the busiest area, usually the lettering. The highlighted card has the lowest edge error for that image.</p>
<p><b>Edge error</b> counts wrong pixels along the original's edges, where letters and fine detail live. <b>Mismatch</b> counts wrong pixels everywhere. <b>Nodes</b> are the points in the paths: fewer is easier to edit.</p>
<div class="wrap"><table><thead><tr><th>Engine</th><th>Best edge error (images)</th><th>Median edge error</th><th>Median mismatch</th><th>Median nodes</th><th>Median size</th><th>Median time</th></tr></thead><tbody>{summary}</tbody></table></div>
{''.join(cards)}
</main></body></html>"""


if __name__ == "__main__":
    main()
