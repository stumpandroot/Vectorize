"""Fine-tuning one shape or one layer changes only that shape or layer."""
import asyncio, sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
UI = str(ROOT / "ui" / "index.html")
OK = []
def check(name, cond, info=""):
    OK.append(bool(cond)); print(("PASS" if cond else "FAIL"), name, info)

async def done(pg):
    await pg.wait_for_timeout(600)   # the dials wait up to 300 ms before retracing
    await pg.wait_for_function("document.querySelector('#status').dataset.s!=='working' && document.querySelector('#busy').hidden", timeout=60000)

# Each traced part's outline path, keyed by layer color and rounded box, so parts can be compared across retraces.
SNAP = """(() => { const out = {}; result.layers.forEach(L => L.items.forEach(it => { const b = bboxOf(it.outer.q).map(v => Math.round(v / 6)); out[L.hex + ':' + b.join(',')] = itemD(it); })); return out; })()"""
AREA = """(hex => { const L = result.layers.find(L => L.hex === hex); return L.items.reduce((s, it) => s + Math.abs(VZ.area(it.outer.q)), 0); })"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width": 1320, "height": 860})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + UI); await done(pg)
        await pg.evaluate("S.textMode = 'off'; convert()"); await done(pg)
        coral = await pg.evaluate("result.layers.find(L => colorName(L.hex) === 'Coral').hex")
        navy = await pg.evaluate("result.layers.find(L => colorName(L.hex) === 'Navy').hex")
        star_area0 = await pg.evaluate(AREA, coral); navy_area0 = await pg.evaluate(AREA, navy)

        # Select the star and tune just it.
        await pg.evaluate("(hex => { const li = result.layers.findIndex(L => L.hex === hex); setSelection([{ li, ii: 0 }]); drawSelection(); })", coral)
        await pg.click('[data-sel="tune"]'); await pg.wait_for_timeout(200)
        check("scope bar names the selection", "1 selected shape" in await pg.inner_text("#scopeBar"))
        await pg.click("#growPlus"); await pg.click("#growPlus"); await pg.click("#growPlus"); await pg.click("#growPlus"); await done(pg)
        star_area1 = await pg.evaluate(AREA, coral); navy_area1 = await pg.evaluate(AREA, navy)
        check("the tuned star grows", star_area1 > star_area0 * 1.05, f"{star_area0:.0f} -> {star_area1:.0f}")
        check("other layers don't change", abs(navy_area1 - navy_area0) < 1, f"{navy_area0:.0f} -> {navy_area1:.0f}")
        check("the dial shows it's changed", "changed" in await pg.inner_text("#growOut"))

        # Back to all: the global dial still reads its own value.
        await pg.click("#scopeBack")
        check("global grow is untouched", await pg.inner_text("#growOut") == "0 px" and await pg.evaluate("S.grow") == 0)
        # A global change keeps the star's own tune.
        await pg.fill("#smooth", "55"); await pg.dispatch_event("#smooth", "input"); await done(pg)
        check("tune survives a global change", await pg.evaluate(AREA, coral) > star_area0 * 1.05)

        # Tune the Navy layer only, from the Layers tab.
        before = await pg.evaluate(SNAP)
        await pg.click("#t-layers"); await pg.click(f'[data-more="{navy}"]'); await pg.click(f'[data-ltune="{navy}"]'); await pg.wait_for_timeout(200)
        check("layer scope from the Layers tab", "Navy layer" in await pg.inner_text("#scopeBar") and not await pg.evaluate("$('#pane-setup').hidden"))
        await pg.fill("#straight", "100"); await pg.dispatch_event("#straight", "input"); await done(pg)
        after = await pg.evaluate(SNAP)
        changed = [k for k in after if k in before and after[k] != before[k]]
        check("only Navy outlines change", changed and all(k.startswith(navy) for k in changed), f"{len(changed)} changed")
        await pg.click("#t-layers")
        check("Layers marks it fine-tuned", "fine-tuned" in await pg.inner_text(f'.layer[data-layer="{navy}"]'))

        # Undo takes back the layer tune; Match the rest clears the star's.
        await pg.keyboard.press("Control+z"); await done(pg)
        check("undo removes the layer tune", await pg.evaluate(f"!tunes.some(t => t.kind === 'layer')"))
        await pg.evaluate("(hex => { const li = result.layers.findIndex(L => L.hex === hex); setSelection([{ li, ii: 0 }]); drawSelection(); })", coral)
        await pg.click('[data-sel="tune"]'); await pg.wait_for_timeout(100); await pg.click("#tuneReset"); await done(pg)
        check("reset clears the shape tune", await pg.evaluate("tunes.length") == 0 and abs(await pg.evaluate(AREA, coral) - star_area0) < star_area0 * 0.03)
        check("no page errors", not errs, errs)

        # The dials do something you can see (1.8.0): the ends of each slider change the trace a lot, and the
        # middle gives the same trace as before.
        pg = await b.new_page(viewport={"width": 1400, "height": 900}); errs2 = []; pg.on("pageerror", lambda e: errs2.append(str(e)))
        await pg.goto("file://" + UI); await done(pg)
        pts = "anchorCount(buildSVG(false, { part: 'all' }))"
        base = await pg.evaluate(pts)
        P = await pg.evaluate("tuneParams({ detail: 70, straight: 50, smooth: 50, corners: 50 }, 2)")
        check("the middle of every dial keeps the tuned defaults", abs(P["sigma"] - 0.9) < 1e-9 and abs(P["tol"] - 1.1) < 1e-9 and abs(P["lineSrc"] - 1.2) < 1e-9 and P["cornerDeg"] == 40 and abs(P["speckArea"] - 19.36) < 1e-9 and P["fitSigma"] == 1.6 and P["lineMin"] == 1 and P["snapDeg"] == 3, P)
        async def at(dial, v):
            await pg.evaluate(f"(() => {{ const i = $('#{dial}'); i.value = {v}; i.dispatchEvent(new Event('input', {{ bubbles: true }})); }})()"); await done(pg)
            return await pg.evaluate(pts)
        lo, hi = await at("smooth", 0), await at("smooth", 100); await at("smooth", 50)
        check("Curves: Tight keeps far more points than Smooth", lo > hi * 1.4, f"{lo} vs {hi} (default {base})")
        lo, hi = await at("corners", 0), await at("corners", 100); await at("corners", 50)
        check("Corners: Sharper keeps more corner points than Rounder", hi > lo * 1.15, f"{lo} vs {hi}")
        # Points while dragging.
        await pg.click("#v-vector")
        await pg.evaluate("$('#smooth').scrollIntoView({ block: 'center' })"); await pg.wait_for_timeout(200)
        r = await pg.evaluate("(r => [r.left, r.top + r.height / 2, r.width])($('#smooth').getBoundingClientRect())")
        await pg.mouse.move(r[0] + r[2] * 0.5, r[1]); await pg.mouse.down(); await pg.mouse.move(r[0] + 2, r[1], steps=6); await done(pg)
        held = await pg.evaluate("[$('#vec').classList.contains('tuning'), document.querySelectorAll('#vec .anchors rect').length, anchorCount(buildSVG(false, { part: 'all' })), $('#smooth').closest('.dial').classList.contains('tuning')]")
        check("dragging a dial shows outlines and every anchor point", held[0] and held[3] and held[1] == held[2] and held[1] > 0, held)
        check("the footer counts points", f"{held[2]} points" in await pg.inner_text("#stats"))
        await pg.mouse.up(); await pg.wait_for_timeout(300)
        check("the points stay up just after you let go", await pg.evaluate("$('#vec').classList.contains('tuning')"))
        await pg.wait_for_timeout(2600)
        check("then the vector returns to normal", await pg.evaluate("!$('#vec').classList.contains('tuning') && !document.querySelector('#vec .anchors')"))
        await pg.focus("#corners"); await pg.keyboard.press("ArrowRight"); await pg.wait_for_timeout(100)
        check("arrow keys on a dial show the points too", await pg.evaluate("$('#vec').classList.contains('tuning')"))
        await done(pg); await pg.wait_for_timeout(1600)
        check("and they clear on their own", await pg.evaluate("!$('#vec').classList.contains('tuning')"))
        # Small details at 0 removes specks on a noisy JPEG.
        import base64 as _b
        data = _b.b64encode((ROOT / "bench/testset/images/serif-wordmark.jpg").read_bytes()).decode()
        await pg.evaluate(f"openImage('data:image/jpeg;base64,{data}', 'serif', 'test')"); await done(pg)
        n70 = await pg.evaluate("visibleLayers().reduce((s, L) => s + L.items.length, 0)")
        await at("detail", 0)
        n0 = await pg.evaluate("visibleLayers().reduce((s, L) => s + L.items.length, 0)")
        check("Small details at 0 drops small pieces", n0 < n70, f"{n70} -> {n0}")
        check("no page errors (dial ranges)", not errs2, errs2)
        await pg.close()
        await b.close()
    print(f"{sum(OK)}/{len(OK)} passed")
    if not all(OK): sys.exit(1)

asyncio.run(main())
