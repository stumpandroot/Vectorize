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
        await b.close()
    print(f"{sum(OK)}/{len(OK)} passed")
    if not all(OK): sys.exit(1)

asyncio.run(main())
