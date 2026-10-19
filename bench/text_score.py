"""Scores how Vectorize handles lettering, against the answers in bench/textset.

Usage:
    python3 bench/text_score.py [--limit N] [--only NAME,...] [--out DIR] [--check BASELINE] [--save-baseline]

For every truth word it reports:
- found: a detected word covers it
- read: the word Vectorize read (OCR), when it has one, matches (case-insensitive)
- font_rank: where the true family lands in the font suggestions (0 = first, -1 = missing)
- traced: how close the traced letters are to the true outlines (IoU, worst letter, edge error, thin strokes)
- fitted: the same for the true font fitted by Vectorize (when the engine can place it)
- auto: whether Vectorize would swap in a font on its own. A swap to another family is "misnamed"; it's "wrong"
  when its letters also match the true artwork visibly worse than the true font does (see looks_right)
The page is served over http inside the browser (like the Mac app's local server), so the font index and the web
reader load.
Fonts come from a local google/fonts checkout when VZ_GFONTS points at one (fast, repeatable); otherwise from
Google Fonts over the network, like they do for users. --net forces the network.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import statistics
import sys
import time
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "ui" / "index.html"
SET = ROOT / "bench" / "textset"
OCR = ROOT / "ui-src" / "vendor" / "ocr"


APP_ORIGIN = "http://vectorize.test"
TYPES = {".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".bin": "application/octet-stream",
         ".gz": "application/gzip", ".wasm": "application/wasm"}


async def route_app(ctx) -> str:
    """Serves ui/ (and ocr/ from the vendored reader) at APP_ORIGIN inside the browser, with no local server, so
    it works the same with or without a network proxy. Returns the page URL."""
    async def handle(route):
        path = route.request.url[len(APP_ORIGIN):].split("?", 1)[0] or "/index.html"
        f = OCR / Path(path).name if path.startswith("/ocr/") else UI.parent / path.lstrip("/")
        if not f.is_file():
            await route.fulfill(status=404, body="not found"); return
        await route.fulfill(status=200, body=f.read_bytes(), headers={"Content-Type": TYPES.get(f.suffix, "application/octet-stream")})
    await ctx.route(APP_ORIGIN + "/**", handle)
    return APP_ORIGIN + "/index.html"


def local_fonts():
    """A font fetcher backed by the google/fonts checkout, or None when there isn't one."""
    root = Path(os.environ.get("VZ_GFONTS", "/home/claude/gf/gfonts"))
    if not (root / "ofl").is_dir():
        return None
    sys.path.insert(0, str(ROOT / "bench" / "fonts"))
    import gfonts

    def fetch(fam, w, wd):
        if fam not in gfonts.catalog():
            return None
        try:
            return base64.b64encode(gfonts.instance_bytes(fam, int(w), float(wd) if wd else None, overlaps=False)).decode()
        except Exception as e:
            print("font", fam, w, wd, e)
            return None
    return fetch

# Rasterizes truth glyphs and Vectorize's output for one word, 4 px per image pixel, and compares them.
EVAL_JS = r"""
async ({ truth, scale, mode }) => {
  const P = 4, wb = truth.box, pad = 3, x0 = wb[0] - pad, y0 = wb[1] - pad;
  const W = Math.ceil((wb[2] - wb[0] + 2 * pad) * P), H = Math.ceil((wb[3] - wb[1] + 2 * pad) * P);
  const mask = (draw) => { const c = new OffscreenCanvas(W, H), g = c.getContext('2d'); g.fillStyle = '#000'; draw(g); const d = g.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0; return m; };
  const tm = mask(g => { g.setTransform(P, 0, 0, P, -x0 * P, -y0 * P); for (const gl of truth.glyphs) g.fill(new Path2D(gl.d), 'nonzero'); });
  // Vectorize output for this word in image pixels: the word's own paths when replaced, else its traced letters.
  const out = window.__vzWordPaths(truth, scale, mode); if (!out) return null;
  const om = mask(g => { g.setTransform(P / scale, 0, 0, P / scale, -x0 * P, -y0 * P); for (const [d, rule] of out) g.fill(new Path2D(d), rule); });
  const iouIn = (a, b, r) => { let i = 0, u = 0; const [rx0, ry0, rx1, ry1] = r; for (let y = Math.max(0, ry0); y < Math.min(H, ry1); y++) for (let x = Math.max(0, rx0); x < Math.min(W, rx1); x++) { const k = y * W + x, p = a[k], q = b[k]; if (p || q) u++; if (p && q) i++; } return u ? i / u : 1; };
  const all = [0, 0, W, H], iou = iouIn(tm, om, all);
  // Per letter, inside each true glyph's box (plus a pixel).
  const per = truth.glyphs.map(gl => { const b = gl.box; return iouIn(tm, om, [Math.floor((b[0] - x0 - 1) * P), Math.floor((b[1] - y0 - 1) * P), Math.ceil((b[2] - x0 + 1) * P), Math.ceil((b[3] - y0 + 1) * P)]); });
  // Edge distance: chamfer distance transform from each mask's edge, in image pixels.
  const edges = m => { const e = new Uint8Array(W * H); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const k = y * W + x; if (m[k] && (!m[k - 1] || !m[k + 1] || !m[k - W] || !m[k + W])) e[k] = 1; } return e; };
  const dist = e => { const D = new Float32Array(W * H).fill(1e9); for (let k = 0; k < D.length; k++) if (e[k]) D[k] = 0; const a = 1, b = 1.4142;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y * W + x; let v = D[k]; if (x > 0) v = Math.min(v, D[k - 1] + a); if (y > 0) { v = Math.min(v, D[k - W] + a); if (x > 0) v = Math.min(v, D[k - W - 1] + b); if (x < W - 1) v = Math.min(v, D[k - W + 1] + b); } D[k] = v; }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const k = y * W + x; let v = D[k]; if (x < W - 1) v = Math.min(v, D[k + 1] + a); if (y < H - 1) { v = Math.min(v, D[k + W] + a); if (x < W - 1) v = Math.min(v, D[k + W + 1] + b); if (x > 0) v = Math.min(v, D[k + W - 1] + b); } D[k] = v; } return D; };
  const te = edges(tm), oe = edges(om), dt = dist(te), dO = dist(oe), ds = [];
  for (let k = 0; k < te.length; k++) { if (te[k]) ds.push(Math.min(99, dO[k] / P)); if (oe[k]) ds.push(Math.min(99, dt[k] / P)); }
  ds.sort((p, q) => p - q);
  const mean = ds.length ? ds.reduce((s, v) => s + v, 0) / ds.length : 99, p95 = ds.length ? ds[Math.floor(0.95 * (ds.length - 1))] : 99;
  // Thin strokes: true ink within 1 image pixel of both sides (a stroke 2 px or thinner) that the output covers.
  const inside = dist(edges(tm.map(v => 1 - v)));   // distance from background edge, for ink pixels
  let thin = 0, kept = 0; for (let k = 0; k < tm.length; k++) if (tm[k] && inside[k] / P <= 1.0) { // near an edge
    const x = k % W, y = (k / W) | 0; let w = 0; for (let r = 1; r <= 2 * P; r++) { if (x + r < W && tm[k + r]) w++; else break; } for (let r = 1; r <= 2 * P; r++) { if (x - r >= 0 && tm[k - r]) w++; else break; }
    let h = 0; for (let r = 1; r <= 2 * P; r++) { if (y + r < H && tm[k + r * W]) h++; else break; } for (let r = 1; r <= 2 * P; r++) { if (y - r >= 0 && tm[k - r * W]) h++; else break; }
    if (Math.min(w, h) < 2 * P) { thin++; if (om[k]) kept++; } }
  return { iou, worst: Math.min(...per), per, edge_mean: mean, edge_p95: p95, thin: thin ? kept / thin : null };
}
"""

# Hooks the page exposes for scoring: the paths Vectorize would export for the word that covers a truth word.
HOOK_JS = r"""
window.__vzWordFor = (truth, scale) => {
  const b = truth.box.map(v => v * scale);
  let best = null, bo = 0;
  for (const T of result.texts || []) { if (T.removed) continue;
    const ix = Math.max(0, Math.min(b[2], T.box[2]) - Math.max(b[0], T.box[0])), iy = Math.max(0, Math.min(b[3], T.box[3]) - Math.max(b[1], T.box[1]));
    const o = ix * iy / ((b[2] - b[0]) * (b[3] - b[1])); if (o > bo) { bo = o; best = T; } }
  return bo >= 0.5 ? best : null;
};
window.__vzWordPaths = (truth, scale, mode) => {
  const b = truth.box.map(v => v * scale), out = [];
  const T = window.__vzWordFor(truth, scale);
  if (mode !== 'traced' && T && T.repl) {
    for (const it of T.repl) out.push([[it.outer, ...it.holes].map(r => VZ.outlineD(r.outline)).join(''), T.fillRule || 'evenodd']);
    return out;
  }
  // Traced letters: every visible part whose box sits mostly inside the word.
  for (const L of visibleLayers()) for (const it of L.items) { if (it.off) continue; const q = bboxOf(it.outer.q), cx = (q[0] + q[2]) / 2, cy = (q[1] + q[3]) / 2;
    if (cx >= b[0] - 2 && cx <= b[2] + 2 && cy >= b[1] - 2 && cy <= b[3] + 2 && (q[2] - q[0]) < 1.6 * (b[2] - b[0] + 4)) out.push([itemD(it), 'evenodd']); }
  return out;
};
// Engines without the scoring API (before 1.9.0): the old 48-font matcher and its 0.86 rule.
if (!window.vzEngine) window.vzEngine = {
  async rank(T, text, fam) { const { results } = await matchFonts(T, text); const i = results.findIndex(r => r.fam === fam); return i; },
  async auto(T, text) { const { results } = await matchFonts(T, text); const c = results[0]; return c && c.iou >= 0.86 ? { swapped: true, family: c.fam } : { swapped: false }; },
  async fitTrue(T, text, fam, w) { if (!FONTS.some(f => f[0] === fam)) return false; const c = await matchOne(T, { fam, w }); if (!c) return false; T.text = text; T.pick = c; T.repl = fontText(T, c); T.mode = 'font'; return true; },
};
window.__vzAuto = async id => { const T = result.texts[id]; const text = T.text || window.__vzTruthText; return text ? vzEngine.auto(T, text) : null; };
// Applies the automatic pick (when it would swap) so its outlines can be compared with the true artwork.
window.__vzApplyAuto = async id => { const T = result.texts[id]; const d = await autoDecide(T, T.text || window.__vzTruthText); if (!d || !d.swap) return false; useFontResult(T, d.best); return true; };
window.__vzRank = async (id, text, fam) => vzEngine.rank(result.texts[id], text, fam);
window.__vzFitTrue = async (id, text, fam, w) => vzEngine.fitTrue(result.texts[id], text, fam, w);
"""


async def score_case(pg, truth, img_path):
    data = base64.b64encode(img_path.read_bytes()).decode()
    mime = "image/png" if img_path.suffix == ".png" else "image/jpeg"
    await pg.evaluate("([d, n]) => openImage(d, n, 'test')", [f"data:{mime};base64,{data}", truth["name"]])
    await pg.wait_for_timeout(300)
    await pg.wait_for_function("document.querySelector('#status').dataset.s==='done' && !!result", timeout=120000)
    # Reading and automatic swaps run after the trace; wait for them (1.9.0 and later mark the result).
    await pg.wait_for_function("!canReadText() || result.wordsDone !== false", timeout=300000)
    scale = await pg.evaluate("result.w") / truth["size"][0]
    rows = []
    for tw in truth["words"]:
        r = {"case": truth["name"], "kind": truth["kind"], "text": tw["text"], "family": tw["family"], "abstain": tw["abstain"],
             "cap_px": round(tw["box"][3] - tw["box"][1], 1)}
        found = await pg.evaluate("([t, s]) => { const T = __vzWordFor(t, s); return T ? { id: T.id, text: T.text || '' } : null; }", [tw, scale])
        r["found"] = bool(found)
        r["read"] = bool(found and found["text"] and found["text"].strip().lower() == tw["text"].strip().lower())
        r["traced"] = await pg.evaluate(EVAL_JS, {"truth": tw, "scale": scale, "mode": "traced"})
        if found:
            # What the engine does on its own (automatic swap), then what it can do with the true text.
            await pg.evaluate("t => { window.__vzTruthText = t; }", tw["text"])
            auto = await pg.evaluate("t => (window.__vzAuto ? window.__vzAuto(t) : null)", found["id"])
            r["auto"] = auto
            # What a swap looks like next to the true artwork: a different family with the same letters (a
            # Noto Sans script family's Latin is Noto Sans) is a misnamed swap, not a visible one.
            if auto and auto.get("swapped") and await pg.evaluate("id => window.__vzApplyAuto ? window.__vzApplyAuto(id) : false", found["id"]):
                r["auto_eval"] = await pg.evaluate(EVAL_JS, {"truth": tw, "scale": scale, "mode": "replaced"})
            fam = await pg.evaluate("([id, text, fam]) => window.__vzRank ? window.__vzRank(id, text, fam) : null", [found["id"], tw["text"], tw["family"]])
            r["font_rank"] = fam
            fitted = None
            if tw["family"]:   # abstain cases have no true family to fit
                fitted = await pg.evaluate("([id, text, fam, w]) => window.__vzFitTrue ? window.__vzFitTrue(id, text, fam, w) : null", [found["id"], tw["text"], tw["family"], tw["weight"]])
            r["fit_ok"] = fitted
            r["fitted"] = await pg.evaluate(EVAL_JS, {"truth": tw, "scale": scale, "mode": "replaced"}) if fitted else None
        rows.append(r)
    return rows


def misnamed(r) -> bool:
    """Swapped on its own to a family other than the true one (or swapped when it should have abstained)."""
    a = r.get("auto") or {}
    return bool(a.get("swapped")) and (r["abstain"] or r["family"] not in [a.get("family"), *(a.get("same") or [])])


def looks_right(r) -> bool:
    """The swapped letters match the true artwork as well as the true font fitted by Vectorize does (within 0.01
    overall and 0.03 for the worst letter), or, without that fit, at 0.95 overall and 0.9 per letter."""
    e, f = r.get("auto_eval"), r.get("fitted")
    if not e or r["abstain"]:
        return False
    if f:
        return e["iou"] >= f["iou"] - 0.01 and e["worst"] >= f["worst"] - 0.03 and e["edge_p95"] <= max(1.0, f["edge_p95"] + 0.5)
    return e["iou"] >= 0.95 and e["worst"] >= 0.9 and e["edge_p95"] <= 1.0


def summarize(rows):
    def mean(v):
        v = [x for x in v if x is not None]
        return round(statistics.mean(v), 4) if v else None
    words = [r for r in rows if not r["abstain"]]
    out = {
        "words": len(rows),
        "found": mean([1.0 if r["found"] else 0.0 for r in rows]),
        "read": mean([1.0 if r["read"] else 0.0 for r in rows if r["found"]]),
        "traced_iou": mean([r["traced"]["iou"] for r in rows if r["traced"]]),
        "traced_worst": mean([r["traced"]["worst"] for r in rows if r["traced"]]),
        "traced_edge_p95": mean([r["traced"]["edge_p95"] for r in rows if r["traced"]]),
        "traced_thin": mean([r["traced"]["thin"] for r in rows if r["traced"] and r["traced"]["thin"] is not None]),
        "font_top1": mean([1.0 if r.get("font_rank") == 0 else 0.0 for r in words if r["found"] and r.get("font_rank") is not None]),
        "font_top5": mean([1.0 if r.get("font_rank") is not None and 0 <= r["font_rank"] < 5 else 0.0 for r in words if r["found"] and r.get("font_rank") is not None]),
        "fitted_iou": mean([r["fitted"]["iou"] for r in words if r.get("fitted")]),
        "fitted_worst": mean([r["fitted"]["worst"] for r in words if r.get("fitted")]),
        "fitted_edge_p95": mean([r["fitted"]["edge_p95"] for r in words if r.get("fitted")]),
        "auto_swaps": sum(1 for r in rows if r.get("auto") and r["auto"].get("swapped")),
        "misnamed_swaps": sum(1 for r in rows if misnamed(r)),
        "wrong_swaps": sum(1 for r in rows if misnamed(r) and not looks_right(r)),
    }
    return out


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="synthetic cases to include (0 = all)")
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default=str(ROOT / "bench-out" / "text"))
    ap.add_argument("--check", default="")
    ap.add_argument("--save-baseline", action="store_true")
    ap.add_argument("--net", action="store_true", help="load fonts from Google Fonts even when a local checkout exists")
    a = ap.parse_args()
    index = json.loads((SET / "index.json").read_text())
    if a.only:
        keep = set(a.only.split(","))
        index = [c for c in index if c["name"] in keep]
    elif a.limit:
        prot = [c for c in index if c["kind"] != "synthetic"]
        index = prot + [c for c in index if c["kind"] == "synthetic"][: a.limit]
    rows, t0 = [], time.time()
    async with async_playwright() as p:
        fetch = None if a.net else local_fonts()
        # Fonts from the network need the sandbox's proxy; local fonts don't. (Chromium sends loopback requests
        # through an explicit proxy too, so the proxy is only set when it's needed.)
        kw = {"proxy": {"server": os.environ["HTTPS_PROXY"]}} if (not fetch and os.environ.get("HTTPS_PROXY")) else {}
        b = await p.chromium.launch(**kw)
        ctx = await b.new_context(viewport={"width": 1400, "height": 900}, ignore_https_errors=True)
        pg = await ctx.new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        if fetch:
            await pg.expose_function("__VZ_FONT_FETCH", fetch)
        url = await route_app(ctx)
        await pg.goto(url)
        await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=60000)
        await pg.evaluate(HOOK_JS)
        for c in index:
            truth = json.loads((SET / "truth" / f'{c["name"]}.json').read_text())
            try:
                rr = await score_case(pg, truth, SET / "images" / c["image"])
            except Exception as e:
                print("FAIL", c["name"], e)
                rr = [{"case": c["name"], "kind": c["kind"], "text": w["text"], "family": w["family"], "abstain": w["abstain"], "found": False, "read": False, "traced": None, "error": str(e)} for w in truth["words"]]
            rows += rr
            for r in rr:
                t = r.get("traced") or {}
                f = r.get("fitted") or {}
                print(f'{r["case"]:22s} {r["text"][:22]:22s} found={int(r["found"])} rank={r.get("font_rank")} traced={t.get("iou", 0):.3f}/{t.get("worst", 0):.3f} thin={t.get("thin")} fitted={f.get("iou", 0):.3f} auto={r.get("auto")}')
        await b.close()
    by_kind = {}
    for r in rows:
        by_kind.setdefault("synthetic" if r["kind"] == "synthetic" else "protected", []).append(r)
    summary = {"all": summarize(rows), **{k: summarize(v) for k, v in by_kind.items()}, "seconds": round(time.time() - t0), "page_errors": errs[:5]}
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    (out / "rows.json").write_text(json.dumps(rows, indent=1))
    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    if a.save_baseline:
        (ROOT / "bench" / "text_baseline.json").write_text(json.dumps(summary, indent=1))
    if a.check:
        base = json.loads(Path(a.check).read_text())
        bad = []
        for grp in ("protected", "synthetic"):
            for k, better in (("found", "high"), ("read", "high"), ("traced_iou", "high"), ("traced_thin", "high"), ("font_top5", "high"), ("fitted_iou", "high")):
                b0, b1 = (base.get(grp) or {}).get(k), (summary.get(grp) or {}).get(k)
                if b0 is not None and b1 is not None and b1 < b0 - 0.02:
                    bad.append(f"{grp} {k}: {b0} -> {b1}")
            if (summary.get(grp) or {}).get("wrong_swaps", 0) > (base.get(grp) or {}).get("wrong_swaps", 0):
                bad.append(f"{grp} wrong_swaps rose")
        if bad:
            print("WORSE THAN BASELINE:\n  " + "\n  ".join(bad)); sys.exit(1)
        print("No lettering score is worse than the baseline.")


if __name__ == "__main__":
    asyncio.run(main())
