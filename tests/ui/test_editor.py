"""Editor features in the web build: selection, hide/delete, layers, undo, zoom, export formats, separations, batch."""
import asyncio, sys, io, zipfile
from playwright.async_api import async_playwright

import os, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
UI = str(ROOT / "ui" / "index.html")
FIX = str(ROOT / "tests" / "fixtures")
OUT = os.environ.get("VZ_TEST_OUT") or tempfile.mkdtemp()
OK = []
def check(name, cond, info=""):
    OK.append(bool(cond)); print(("PASS" if cond else "FAIL"), name, info)

async def done(pg, t=60000):
    await pg.wait_for_timeout(150)
    await pg.wait_for_function("document.querySelector('#status').dataset.s!=='working' && document.querySelector('#busy').hidden", timeout=t)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1280, "height": 800}, accept_downloads=True)
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + UI + "?sample=sunny"); await done(pg)
        await pg.click("#v-vector")
        n0 = await pg.evaluate("visibleLayers().reduce((s,L)=>s+L.items.filter(it=>!it.off).length,0)")

        # Marquee around the words (bottom band of the image)
        box = await pg.locator("#sheet").bounding_box()
        x0, y0 = box["x"] + box["width"] * 0.05, box["y"] + box["height"] * 0.74
        x1, y1 = box["x"] + box["width"] * 0.95, box["y"] + box["height"] * 0.89
        await pg.mouse.move(x0, y0); await pg.mouse.down(); await pg.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, steps=4); await pg.mouse.move(x1, y1, steps=4); await pg.mouse.up()
        nsel = await pg.evaluate("selection.length")
        check("marquee selects the letters", nsel == 7, f"selected {nsel}")
        check("selection bar shows count", "7 parts" in await pg.inner_text("#snapTitle"))
        check("snap chips hidden for many", await pg.evaluate("$('#snapChips').hidden"))

        # Hide them, then undo
        await pg.click('[data-sel="hide"]'); await pg.wait_for_timeout(200)
        n1 = await pg.evaluate("visibleLayers().reduce((s,L)=>s+L.items.filter(it=>!it.off).length,0)")
        check("hide removes parts from the vector", n1 == n0 - 7, f"{n0} -> {n1}")
        svg = await pg.evaluate("buildSVG()")
        check("hidden letters are not exported", "data-text" not in svg)
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(300)
        n2 = await pg.evaluate("visibleLayers().reduce((s,L)=>s+L.items.filter(it=>!it.off).length,0)")
        check("undo brings them back", n2 == n0, f"{n2}")

        # Click one part, shift-click another, delete with the key
        k = await pg.evaluate("[...document.querySelectorAll('#vec [data-k]')].map(e=>e.dataset.k)")
        await pg.locator(f'[data-k="{k[0]}"]').dispatch_event("pointerdown", {"pointerId": 1, "button": 0, "bubbles": True})
        await pg.locator(f'[data-k="{k[0]}"]').dispatch_event("pointerup", {"pointerId": 1, "button": 0, "bubbles": True})
        check("click selects one", await pg.evaluate("selection.length") == 1)
        await pg.locator(f'[data-k="{k[1]}"]').dispatch_event("pointerdown", {"pointerId": 1, "button": 0, "bubbles": True, "shiftKey": True})
        await pg.locator(f'[data-k="{k[1]}"]').dispatch_event("pointerup", {"pointerId": 1, "button": 0, "bubbles": True, "shiftKey": True})
        check("shift-click adds", await pg.evaluate("selection.length") == 2)
        await pg.keyboard.press("Delete"); await pg.wait_for_timeout(200)
        check("Delete key deletes", await pg.evaluate("objEdits.filter(e=>e.act==='delete').length") == 2)
        # Deleted parts survive a settings change
        await pg.click("#t-setup"); await pg.fill("#smooth", "55"); await pg.dispatch_event("#smooth", "input"); await done(pg)
        check("deletions survive a retrace", await pg.evaluate("result.layers.reduce((s,L)=>s+L.items.filter(it=>it.off==='delete').length,0)") == 2)
        await pg.keyboard.press("Control+z"); await done(pg)
        check("undo a slider change restores the value", await pg.evaluate("S.smooth") == 50)
        await pg.keyboard.press("Control+z"); await done(pg)
        check("undo the delete", await pg.evaluate("objEdits.length") == 0)

        # Layers panel: delete a layer, restore it, reorder with the keyboard
        await pg.click("#t-layers")
        order0 = await pg.evaluate("topHexes()")
        await pg.focus(f'[data-grip="{order0[0]}"]'); await pg.keyboard.press("ArrowDown"); await pg.wait_for_timeout(200)
        order1 = await pg.evaluate("topHexes()")
        check("arrow key moves a layer down", order1[1] == order0[0] and order1[0] == order0[1], f"{order0} -> {order1}")
        gids = await pg.evaluate("[...document.querySelectorAll('#vec svg g[data-l]')].map(g=>result.layers[+g.dataset.l].hex)")
        check("SVG draws in the new order", gids[::-1][:2] == order1[:2], f"{gids}")
        await pg.click(f'[data-more="{order0[2]}"]'); await pg.wait_for_timeout(100)
        rows = await pg.evaluate("document.querySelectorAll('.obj-row').length")
        check("open layer lists its parts", rows >= 1, f"{rows} rows")
        await pg.click(f'[data-ldel="{order0[2]}"]'); await pg.wait_for_timeout(200)
        check("delete layer", order0[2] not in await pg.evaluate("visibleLayers().map(L=>L.hex)"))
        await pg.click(f'[data-lundel="{order0[2]}"]'); await pg.wait_for_timeout(200)
        check("restore layer", order0[2] in await pg.evaluate("visibleLayers().map(L=>L.hex)"))

        # Parts: icon only
        await pg.click('[data-part="art"]'); await pg.wait_for_timeout(200)
        svg = await pg.evaluate("buildSVG(false,{part:partMode})")
        check("Icon view drops the words", "data-text" not in svg and svg.count("<path") + svg.count("<circle") >= 2)
        await pg.click('[data-part="all"]')

        # Zoom and outlines
        z0 = await pg.inner_text("#zoomPct"); await pg.click("#zoomIn"); z1 = await pg.inner_text("#zoomPct")
        check("zoom in", int(z1[:-1]) > int(z0[:-1]), f"{z0} -> {z1}")
        await pg.mouse.move(box["x"] + 100, box["y"] + 100); await pg.mouse.wheel(0, 120); await pg.wait_for_timeout(100)
        check("scroll pans when zoomed", await pg.evaluate("pan[1]") != 0)
        await pg.keyboard.press("Control+0"); await pg.wait_for_timeout(100)
        check("⌘0 fits", await pg.inner_text("#zoomPct") == z0)
        await pg.click("#outlinesBtn")
        check("outlines view", await pg.evaluate("$('#vec').classList.contains('outlines')"))
        await pg.screenshot(path=OUT + "/ed-outlines.png")
        await pg.click("#outlinesBtn")

        # Export menu and formats
        await pg.click("#exportMenuBtn")
        check("PDF disabled on the web", await pg.evaluate("$('[data-fmt=pdf]').disabled"))
        await pg.screenshot(path=OUT + "/ed-menu.png")
        await pg.click('[data-fmt="png"]')
        check("label follows format", await pg.inner_text("#exportLabel") == "Export PNG")
        async with pg.expect_download() as d:
            await pg.click("#exportBtn")
        dl = await d.value; path = await dl.path(); data = open(path, "rb").read()
        check("PNG export", data[:8] == b"\x89PNG\r\n\x1a\n" and dl.suggested_filename.endswith(".png"), dl.suggested_filename)
        import struct
        w, h = struct.unpack(">II", data[16:24]); check("PNG is 2,000 px", max(w, h) == 2000, f"{w}x{h}")
        await pg.click("#exportMenuBtn"); await pg.click('[data-fmt="svg"]')

        # Export selection
        await pg.evaluate("setSelection([{li:result.layers.indexOf(visibleLayers()[0]),ii:0}]); drawSelection()")
        async with pg.expect_download() as d:
            await pg.click('[data-sel="export"]')
        dl = await d.value; s = open(await dl.path()).read()
        check("selection export is cropped", 'viewBox="0 0' not in s and s.count("<g ") == 1, dl.suggested_filename)

        # Separations
        async with pg.expect_download() as d:
            await pg.click("#exportMenuBtn"); await pg.click('[data-xact="separations"]')
        dl = await d.value; zf = zipfile.ZipFile(await dl.path())
        names = zf.namelist(); nl = await pg.evaluate("visibleLayers().length")
        check("separations: one file per color", len(names) == nl and all(n.endswith(".svg") for n in names), f"{names}")
        check("separations switched to cut out", await pg.evaluate("S.layering") == "cutout")
        first = zf.read(names[0]).decode()
        check("separations keep the full canvas", 'viewBox="0 0 ' in first and first.count("<g ") == 1)

        # Output preset
        await pg.click("#t-setup"); await pg.click('[data-output="laser"]'); await done(pg)
        check("laser preset: black and white", await pg.evaluate("S.cmode") == "bw" and "laser" in (await pg.inner_text("#outHelp")).lower() or await pg.evaluate("S.cmode") == "bw")

        # Batch
        await pg.set_input_files("#file", [FIX + "/shapes.jpg", FIX + "/lockup.jpg"]); await pg.wait_for_timeout(500); await done(pg)
        check("batch strip shows 2", await pg.evaluate("document.querySelectorAll('.batch-item').length") == 2)
        await pg.click('[data-bi="1"]'); await pg.wait_for_timeout(300); await done(pg)
        check("switch image", await pg.inner_text("#fileName") == "lockup.jpg")
        async with pg.expect_download(timeout=120000) as d:
            await pg.click("#batchExport")
        dl = await d.value; zf = zipfile.ZipFile(await dl.path())
        check("export all", sorted(n.split("/")[-1] for n in zf.namelist()) == ["lockup.svg", "shapes.svg"], f"{zf.namelist()}")
        await pg.screenshot(path=OUT + "/ed-batch.png")
        # Canvas background: checkerboard, white, or black behind transparent art; the choice is kept, exports aren't changed.
        svg0 = await pg.evaluate("buildSVG()")
        seen = {}
        for v in ("white", "black", "checks"):
            await pg.click(f'[data-canvasbg="{v}"]'); await pg.wait_for_timeout(100)
            seen[v] = await pg.evaluate("v => [getComputedStyle($('#sheet')).backgroundColor, getComputedStyle($('#sheet')).backgroundImage !== 'none', document.querySelector(`[data-canvasbg=${v}]`).getAttribute('aria-pressed')]", v)
        check("background buttons switch the canvas", seen["white"] == ["rgb(255, 255, 255)", False, "true"] and seen["black"] == ["rgb(0, 0, 0)", False, "true"] and seen["checks"][1:] == [True, "true"], seen)
        check("the background doesn't change the export", await pg.evaluate("buildSVG()") == svg0)
        await pg.click('[data-canvasbg="black"]')
        check("the background choice is kept", await pg.evaluate("localStorage.getItem('vz-canvas-bg')") == "black")
        await pg.click('[data-canvasbg="checks"]')
        check("no page errors", not errs, f"{errs}")
        await b.close()
    print(f"{sum(OK)}/{len(OK)} passed")
    if not all(OK): sys.exit(1)

asyncio.run(main())
