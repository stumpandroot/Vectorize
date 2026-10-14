"""Align view: move parts, nudge, align to the original, align buttons, guides, and moves in every export."""
import asyncio, base64, re, sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from app.vector_export import read_svg, svg_to_pdf  # noqa: E402

UI = str(ROOT / "ui" / "index.html")
IMAGES = ROOT / "bench" / "testset" / "images"
OK = []
def check(name, cond, info=""):
    OK.append(bool(cond)); print(("PASS" if cond else "FAIL"), name, info)

async def done(pg):
    await pg.wait_for_timeout(400)
    await pg.wait_for_function("document.querySelector('#status').dataset.s!=='working' && document.querySelector('#busy').hidden", timeout=60000)

OFF = "(k => { const it = result.layers[k[0]].items[k[1]], w = workPerOrig(); return [(it.dx || 0) / w, (it.dy || 0) / w]; })"
CENTER = "(k => { const r = document.querySelector(`#vec [data-k=\"${k[0]}:${k[1]}\"]`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width": 1400, "height": 1000})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + UI); await done(pg)
        await pg.evaluate("S.textMode = 'off'")
        url = "data:image/png;base64," + base64.b64encode((IMAGES / "rounded-badge.png").read_bytes()).decode()
        await pg.evaluate("async u => { const d = convertDone(); await openImage(u, 'badge.png', ''); await d; }", url)

        # translateD moves every absolute point and leaves relative ones alone.
        t = await pg.evaluate("[translateD('M1 2L3 4H5V6C1 2 3 4 5 6A7 7 0 0 1 8 9Z', 10, 20), translateD('m1 2l3 4h5z', 10, 20), translateD('M1 2l3 4', 0, 0)]")
        check("translateD", t == ["M11 22L13 24H15V26C11 22 13 24 15 26A7 7 0 0 1 18 29Z", "m11 22l3 4h5z", "M1 2l3 4"], t)

        await pg.click("#v-align"); await pg.wait_for_timeout(400)
        check("Align view shows its bar and rulers", await pg.evaluate("!$('#alignBar').hidden && !$('#rulerX').hidden && !$('#rulerY').hidden"))
        check("the original shows under the vector", await pg.evaluate("!$('#srcImg').hidden && getComputedStyle($('#vec')).backgroundImage === 'none'"))
        star = await pg.evaluate("(() => { const li = result.layers.findIndex(L => colorName(L.hex) === 'Coral'); return [li, 0]; })()")

        # Drag the star 30 screen px right, holding Option so it doesn't snap.
        x, y = await pg.evaluate(CENTER, star)
        await pg.keyboard.down("Alt"); await pg.mouse.move(x, y); await pg.mouse.down(); await pg.mouse.move(x + 15, y, steps=3); await pg.mouse.move(x + 30, y, steps=3); await pg.mouse.up(); await pg.keyboard.up("Alt")
        await pg.wait_for_timeout(300)
        scale = await pg.evaluate("job.origW / $('#sheet').getBoundingClientRect().width")
        off = await pg.evaluate(OFF, star)
        check("dragging moves the part", abs(off[0] - 30 * scale) < 0.2 and abs(off[1]) < 0.01, f"{off} vs {30 * scale:.2f}")
        check("the readout shows the move", "Moved" in await pg.inner_text("#alignNote"))

        # Nudge: arrow 0.1 px, Shift-arrow 1 px.
        await pg.keyboard.press("ArrowDown"); await pg.keyboard.press("Shift+ArrowLeft")
        off2 = await pg.evaluate(OFF, star)
        check("arrow keys nudge 0.1 and 1 px", abs(off2[0] - (off[0] - 1)) < 0.01 and abs(off2[1] - 0.1) < 0.01, off2)

        # The move is in the SVG and the PDF.
        svg0 = await pg.evaluate("(() => { const o = [...moves]; moves = []; applyObjEdits(); const s = buildSVG(); moves = o; applyObjEdits(); return s; })()")
        svg1 = await pg.evaluate("buildSVG()")
        check("export includes the move", svg0 != svg1 and "<polygon" not in re.sub(r"<g id=\"(navy|yellow|forest)\"[\s\S]*?</g>", "", svg1))
        w, h, vb, shapes = read_svg(svg1)
        check("PDF export works with moved parts", svg_to_pdf(svg1).startswith(b"%PDF-") and len(shapes) > 0)

        # Undo steps back through the nudges and the drag.
        await pg.evaluate("document.activeElement.blur()")
        for _ in range(3): await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(150)
        check("undo puts it back", await pg.evaluate(OFF, star) == [0, 0])

        # A move survives a retrace.
        await pg.evaluate(f"(() => {{ setSelection([{{ li: {star[0]}, ii: 0 }}]); moveUnits(unitsOf(selection), 2 * workPerOrig(), 0); render(); }})()")
        await pg.fill("#smooth", "55"); await pg.dispatch_event("#smooth", "input"); await done(pg)
        star2 = await pg.evaluate("(() => { const li = result.layers.findIndex(L => colorName(L.hex) === 'Coral'); return [li, 0]; })()")
        check("a move survives a retrace", abs((await pg.evaluate(OFF, star2))[0] - 2) < 0.01)

        # Align to original brings it back.
        await pg.evaluate(f"(() => {{ setSelection([{{ li: {star2[0]}, ii: 0 }}]); drawSelection(); }})()")
        await pg.click("#alignOrig"); await pg.wait_for_timeout(2500)
        back = await pg.evaluate(OFF, star2)
        check("Align to original finds the original spot", abs(back[0]) < 0.15 and abs(back[1]) < 0.15, back)

        # Align buttons: left edges.
        keys = await pg.evaluate("(() => { const out = []; result.layers.forEach((L, li) => L.items.forEach((it, ii) => out.push([li, ii]))); return out; })()")
        await pg.evaluate("setSelection(result.layers.flatMap((L, li) => L.items.map((it, ii) => ({ li, ii })))); drawSelection(); syncAlignBar()")
        await pg.click('[data-align="left"]'); await pg.wait_for_timeout(200)
        lefts = await pg.evaluate("unitsOf(selection).map(u => unitBox(u)[0])")
        check("Align left lines up left edges", max(lefts) - min(lefts) < 0.01, [round(v, 2) for v in lefts])
        await pg.evaluate("document.activeElement.blur()"); await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(200)
        await pg.evaluate("setSelection([]); drawSelection(); syncAlignBar()")
        await pg.click("#resetPos"); await pg.wait_for_timeout(200)
        check("Reset positions clears every move", await pg.evaluate("moves.length") == 0)

        # Guides: drag from the top ruler, then back onto it.
        rx = await pg.evaluate("(r => [r.left + r.width / 2, r.top + 10])($('#rulerX').getBoundingClientRect())")
        await pg.mouse.move(*rx); await pg.mouse.down(); await pg.mouse.move(rx[0], rx[1] + 120, steps=4); await pg.mouse.up()
        g = await pg.evaluate("guides")
        check("dragging from the ruler adds a guide", len(g) == 1 and g[0]["axis"] == "y", g)
        check("the guide is on screen", await pg.evaluate("$('#guides .guide-line').getBoundingClientRect().width > 100"))
        hit = await pg.evaluate("(l => { const r = l.getBoundingClientRect(); return [$('#sheet').getBoundingClientRect().left + 40, r.top + r.height / 2]; })($('#guides .guide-hit'))")
        await pg.mouse.move(*hit); await pg.mouse.down(); await pg.mouse.move(hit[0], rx[1], steps=4); await pg.mouse.up()
        check("dragging a guide onto the ruler removes it", await pg.evaluate("guides.length") == 0)

        # Dragging near a guide snaps to it.
        await pg.evaluate("guides = [{ axis: 'x', v: 300 }]; drawGuides()")
        x, y = await pg.evaluate(CENTER, star2)
        bx = await pg.evaluate(f"unitBox(unitsOf([{{ li: {star2[0]}, ii: 0 }}])[0])")
        r = await pg.evaluate("$('#sheet').getBoundingClientRect().width / result.w")
        target = x + (300 - bx[0]) * r + 3      # 3 screen px past the guide
        await pg.mouse.move(x, y); await pg.mouse.down(); await pg.mouse.move((x + target) / 2, y, steps=3); await pg.mouse.move(target, y, steps=3)
        lines = await pg.evaluate("$('#guides').querySelectorAll('.snapline').length")
        await pg.mouse.up(); await pg.wait_for_timeout(200)
        nb = await pg.evaluate(f"unitBox(unitsOf([{{ li: {star2[0]}, ii: 0 }}])[0])")
        check("drag snaps to a guide and shows a snap line", abs(nb[0] - 300) < 0.01 and lines >= 1, f"left {nb[0]:.2f}, {lines} lines")

        # A word set in a font that sits 3 px off: Align to original moves the whole word back.
        await pg.evaluate("guides = []; moves = []; applyObjEdits(); S.textMode = 'auto'; setupText(); render()")
        word = await pg.evaluate("""(() => {
          const T = (result.texts || []).find(T => !T.removed && T.items.length > 2); if (!T) return null;
          const L = result.layers[T.li], k = 3 * workPerOrig(), sh = q => q.map(p => [p[0] + k, p[1]]);
          const shift = r => ({ q: sh(r.q), outline: { V: sh(r.outline.V), segs: r.outline.segs } });
          T.repl = T.items.map(ii => { const it = L.items[ii]; return { outer: shift(it.outer), holes: it.holes.map(shift) }; });
          T.mode = 'font'; render(); return [T.li, T.items[0], T.items.length]; })()""")
        if word:
            await pg.evaluate(f"setSelection([{{ li: {word[0]}, ii: {word[1]} }}]); drawSelection(); syncAlignBar()")
            check("a letter in a set word selects the word", await pg.evaluate("unitsOf(selection).length === 1 && unitsOf(selection)[0].keys.length") == word[2])
            await pg.click("#alignOrig"); await pg.wait_for_timeout(2500)
            woff = await pg.evaluate(OFF, [word[0], word[1]])
            same = await pg.evaluate(f"(() => {{ const T = wordOf({word[0]}, {word[1]}); return T.items.every(ii => result.layers[T.li].items[ii].dx === result.layers[T.li].items[T.items[0]].dx); }})()")
            check("Align to original moves the word back 3 px", abs(woff[0] + 3) < 0.2 and abs(woff[1]) < 0.2 and same, woff)
            await pg.evaluate("moves = []; applyObjEdits(); (result.texts || []).forEach(T => T.mode = 'original'); render()")
        else:
            check("test logo has a word", False)
        await pg.evaluate(f"(() => {{ setSelection([{{ li: {star2[0]}, ii: 0 }}]); moveUnits(unitsOf(selection), 2 * workPerOrig(), 0); render(); }})()")

        # Difference view.
        await pg.click('[data-amode="diff"]'); await pg.wait_for_timeout(800)
        red = await pg.evaluate("(() => { const c = $('#diffCanvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 226 && d[i + 1] === 32) n++; return [c.hidden, n]; })()")
        check("difference marks the moved star in red", not red[0] and red[1] > 200, red)
        await pg.click('[data-amode="onion"]')
        await pg.click("#v-vector"); await pg.wait_for_timeout(200)
        check("leaving Align hides its tools", await pg.evaluate("$('#alignBar').hidden && $('#rulerX').hidden && $('#guides').hasAttribute('hidden')"))

        # ---- Findings from review
        await pg.click("#v-align"); await pg.evaluate("moves = []; guides = []; applyObjEdits(); render()")
        # Sub-pixel: a letter nudged 0.3 px comes back to where it fits best, whatever its start.
        url2 = "data:image/png;base64," + base64.b64encode((IMAGES / "sans-wordmark.png").read_bytes()).decode()
        await pg.evaluate("async u => { const d = convertDone(); await openImage(u, 'w.png', ''); await d; }", url2)
        await pg.evaluate("setView('align')")
        fits = await pg.evaluate("""(async () => { const out = []; for (const sh of [0, 0.3, -0.25]) { moves = []; applyObjEdits(); const u = allUnits()[2], k = workPerOrig();
            moveUnits([u], sh * k, sh * k); const d = await bestShift(u), it = itemOf(u.keys[0]); out.push([(it.dx + d[0]) / k, (it.dy + d[1]) / k]); } return out; })()""")
        spread = max(abs(a[i] - fits[0][i]) for a in fits for i in (0, 1))
        check("sub-pixel shifts come back to the same fit", spread < 0.1, [[round(v, 3) for v in f] for f in fits])
        await pg.evaluate("moves = []; applyObjEdits(); render()")
        # A part hidden under another color is left alone.
        await pg.evaluate("async u => { const d = convertDone(); await openImage(u, 'badge.png', ''); await d; }", url)
        await pg.evaluate("setView('align')")
        hid = await pg.evaluate("(async () => { const u = allUnits().find(u => colorName(result.layers[u.keys[0].li].hex) === 'Yellow'); moveUnits([u], 1, 1); return await bestShift(u); })()")
        check("a hidden part isn't moved", hid == [0, 0], hid)
        await pg.evaluate("moves = []; applyObjEdits(); render()")
        # Difference: drawn once per change, and a 0.8 px move shows more red than none.
        calls = await pg.evaluate("""(async () => { alignMode = 'diff'; applyView(); await new Promise(r => setTimeout(r, 300)); let n = 0; const o = drawDiff; window.drawDiff = async function () { n++; return o(); };
            render(); await new Promise(r => setTimeout(r, 500)); window.drawDiff = o; return n; })()""")
        check("difference is drawn once per change", calls == 1, calls)
        RED = "(() => { const c = $('#diffCanvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 226 && d[i + 1] === 32) n++; return n; })()"
        r0 = await pg.evaluate(RED)
        await pg.evaluate("(() => { const u = allUnits().find(u => colorName(result.layers[u.keys[0].li].hex) === 'Coral'); moveUnits([u], 0.8 * workPerOrig(), 0); render(); })()"); await pg.wait_for_timeout(700)
        r1 = await pg.evaluate(RED)
        check("difference shows a 0.8 px move", r1 > r0 + 100, f"{r0} -> {r1}")
        await pg.evaluate("alignMode = 'onion'; moves = []; applyObjEdits(); applyView(); render()")
        # Guides: a click adds no undo step; a double click removes the guide.
        await pg.evaluate("guides = [{ axis: 'x', v: 200 }]; drawGuides()")
        gx = await pg.evaluate("(l => { const r = l.getBoundingClientRect(); return [r.left + r.width / 2, $('#sheet').getBoundingClientRect().top + 60]; })($('#guides .guide-hit'))")
        n0 = await pg.evaluate("undoStack.length")
        await pg.mouse.click(*gx); await pg.wait_for_timeout(500)
        check("clicking a guide adds no undo step", await pg.evaluate("undoStack.length") == n0)
        await pg.mouse.dblclick(*gx); await pg.wait_for_timeout(200)
        check("double-clicking a guide removes it", await pg.evaluate("guides.length") == 0)
        # Shift-drag on a selected part moves it level instead of deselecting it.
        coral = await pg.evaluate("(() => { const li = result.layers.findIndex(L => colorName(L.hex) === 'Coral'); setSelection([{ li, ii: 0 }]); drawSelection(); return [li, 0]; })()")
        x, y = await pg.evaluate(CENTER, coral)
        await pg.keyboard.down("Shift"); await pg.mouse.move(x, y); await pg.mouse.down(); await pg.mouse.move(x + 20, y + 4, steps=4); await pg.mouse.up(); await pg.keyboard.up("Shift")
        o = await pg.evaluate(OFF, coral)
        check("Shift-drag moves a selected part level", o[0] > 1 and o[1] == 0 and await pg.evaluate("selection.length") == 1, o)
        # A set word keeps moving after its first letter is deleted.
        res = await pg.evaluate("""(() => { S.textMode = 'auto'; setupText(); const T = (result.texts || []).find(T => !T.removed && T.items.length > 2); const L = result.layers[T.li];
            T.repl = T.items.map(ii => L.items[ii]).map(it => ({ outer: it.outer, holes: it.holes })); T.mode = 'font';
            setItemOff(T.li, T.items[0], 'delete'); render(); const before = document.querySelector(`#vec [data-t="${T.id}"]`).getAttribute('d');
            setSelection([{ li: T.li, ii: T.items[1] }]); nudge(5, 0); const after = document.querySelector(`#vec [data-t="${T.id}"]`).getAttribute('d'); return before !== after; })()""")
        check("a word moves after its first letter is deleted", res)
        # Reset positions clears a move even when its stored box has drifted.
        left = await pg.evaluate("(() => { moves = []; applyObjEdits(); const u = allUnits()[1]; moveUnits([u], 4, 0); moves[0].box = moves[0].box.map(v => v + 1); applyObjEdits(); setSelection([]); resetPositions(); applyObjEdits(); return [moves.length, itemOf(u.keys[0]).dx]; })()")
        check("Reset positions clears drifted moves", left == [0, 0], left)

        check("no page errors", not errs, errs)
        await b.close()
    print(f"{sum(OK)}/{len(OK)} passed")
    sys.exit(0 if all(OK) else 1)

asyncio.run(main())
