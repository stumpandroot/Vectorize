"""Lettering engine parts that need no font downloads: the web reader (tesseract.js), lettering on a circle,
the font index shortlist, and the custom-lettering cleanup tools. Uses images from bench/textset."""
import asyncio, base64, json, sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "bench"))
import text_score as ts  # noqa: E402

OK = []
def check(name, cond, info=""):
    OK.append(bool(cond)); print(("PASS" if cond else "FAIL"), name, info)

def data_url(name):
    p = ts.SET / "images" / name
    return ("data:image/png;base64," if p.suffix == ".png" else "data:image/jpeg;base64,") + base64.b64encode(p.read_bytes()).decode()

async def open_image(pg, name):
    await pg.evaluate("([d, n]) => openImage(d, n, 'test')", [data_url(name), name])
    await pg.wait_for_timeout(300)
    await pg.wait_for_function("document.querySelector('#status').dataset.s==='done' && !!result", timeout=120000)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1280, "height": 800})
        pg = await ctx.new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        # No font downloads in this test: fitting is covered by test_autofont and bench/text_score.py.
        await pg.add_init_script("window.__VZ_FONT_FETCH = async () => null;")
        await pg.goto(await ts.route_app(ctx))
        await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=120000)
        check("the web reader can run", await pg.evaluate("canReadText()"))

        # The reader: sparse words, and a lone letter through the one-word fallback.
        r = await pg.evaluate("async u => (await webReadText({ srcURL: u })).map(l => l.text)", data_url("tiny-tagline.png"))
        check("reads a name and its small tagline", "NORTHWIND" in r and any("Roasters" in l for l in r), r)
        r = await pg.evaluate("async u => (await webReadText({ srcURL: u })).map(l => l.text)", data_url("one-letter-mark.png"))
        check("reads a one-letter mark", r == ["K"], r)
        w = await pg.evaluate("async u => (await webReadText({ srcURL: u }))[0].words[0]", data_url("two-letter-mark.png"))
        check("gives a box for each letter", len(w.get("chars", [])) == 2 and all(0 <= c["box"][0] <= 1 for c in w["chars"]), w)

        # The font index loads and is consistent.
        n = await pg.evaluate("loadFontIndex().then(ok => ok ? FX.faces.length : 0)")
        check("the font index loads", n > 3000, f"{n} faces")

        # Lettering on a circle: two runs, over the top and along the bottom, read from straightened strips.
        await open_image(pg, "lower-arc.png")
        await pg.wait_for_function("result.wordsDone === true", timeout=180000)
        arcs = await pg.evaluate("result.texts.filter(t => !t.removed && t.arc).map(t => ({ text: t.ocrText, upper: t.arc.upper, n: t.items.length }))")
        got = {a["text"]: a for a in arcs}
        check("finds both runs on the circle", set(got) == {"MAPLE COFFEE", "SINCE 1920"}, arcs)
        check("knows which run is over the top", got.get("MAPLE COFFEE", {}).get("upper") is True and got.get("SINCE 1920", {}).get("upper") is False, arcs)
        check("the ring itself isn't text", all(a["n"] <= 12 for a in arcs), arcs)
        short = await pg.evaluate("""(async () => { const T = result.texts.find(t => !t.removed && t.arc && !t.arc.upper);
          const list = await indexShortlist({ ...T, chars: null }, 'SINCE 1920', ARC_STRIPS.get(T)); return list.slice(0, 6).map(c => c.fam); })()""")
        check("the index shortlists the arc's font from the straightened strip", "Oswald" in short, short)

        # Straight text isn't mistaken for an arc.
        await open_image(pg, "tiny-tagline.png")
        await pg.wait_for_function("result.wordsDone === true", timeout=180000)
        t = await pg.evaluate("result.texts.filter(t => !t.removed).map(t => ({ text: t.ocrText, arc: !!t.arc }))")
        check("a straight tagline stays straight and whole", {"text": "Coffee Roasters Since 1998", "arc": False} in t, t)

        # Cleanup tools on a word with repeated letters.
        await open_image(pg, "stacked-lines.png")
        await pg.wait_for_function("result.wordsDone === true", timeout=180000)
        res = await pg.evaluate("""(async () => { const T = result.texts.find(t => !t.removed && /ROOT/.test(t.ocrText || ''));
          if (!T) return null; T.text = '& ROOT'; let base = await cleanLetters(T);
          // Slant the second O, the way a hand-drawn copy differs.
          const g0 = letterGroups(base), o2 = g0[3], cy = (o2.b[1] + o2.b[3]) / 2, k = 0.1;
          base = base.map((it, j) => !o2.idx.includes(j) ? it : { ...it, outer: slant(it.outer), holes: it.holes.map(slant) });
          function slant(r) { const f = q => [q[0] + (cy - q[1]) * k, q[1]], hv = h => [h[0] - h[1] * k, h[1]]; return { outline: { ...r.outline, V: r.outline.V.map(f), segs: r.outline.segs.map(s => s[0] === 'C' ? ['C', hv(s[1]), hv(s[2])] : s) }, shape: null, q: r.q.map(f) }; }
          const before = (() => { const gs = letterGroups(base), ms = gs.map(g => groupMask(base, g)); return iouMasks(ms[2], ms[3]); })();
          T.tidy = { match: true }; const out = applyTidy(T, base), gs = letterGroups(out), ms = gs.map(g => groupMask(out, g));
          return { groups: gs.length, before, after: iouMasks(ms[2], ms[3]), note: T.tidyNote, items: out.length, base: base.length }; })()""")
        check("repeated letters match", res and res["groups"] == 5 and res["note"] == "" and res["after"] > 0.97 and res["after"] > res["before"] and res["items"] == res["base"], res)

        check("no page errors", not errs, errs)
        await b.close()
    print(f"{sum(OK)}/{len(OK)} passed")
    if not all(OK): sys.exit(1)

asyncio.run(main())
