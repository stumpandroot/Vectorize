"""Source presets (What is it?) and destination presets (Made for), with their checks and the sticker cut line."""
import asyncio, base64, json, re, sys
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
    await pg.wait_for_timeout(450)
    await pg.wait_for_function("document.querySelector('#status').dataset.s!=='working' && document.querySelector('#busy').hidden", timeout=60000)

async def checks_done(pg):
    await pg.wait_for_timeout(450)
    await pg.wait_for_function("document.querySelector('#checks').dataset.done==='1'", timeout=60000)
    return await pg.evaluate("[...document.querySelectorAll('#checks li')].map(l => l.className.replace('check ', '') + ': ' + l.querySelector('.txt').textContent)")

async def open_file(pg, name):
    url = "data:image/png;base64," + base64.b64encode((IMAGES / name).read_bytes()).decode()
    await pg.evaluate("async u => { const d = convertDone(); await openImage(u, 'test.png', ''); await d; }", url)

# Paper that darkens from left to right, with black pen strokes on it.
SKETCH = """(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 300; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 600, 0); gr.addColorStop(0, '#F4F2EC'); gr.addColorStop(1, '#8C8A84'); g.fillStyle = gr; g.fillRect(0, 0, 600, 300);
  g.strokeStyle = '#151515'; g.lineWidth = 7; g.lineCap = 'round';
  for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(40 + i * 110, 60); g.lineTo(90 + i * 110, 240); g.stroke(); }
  return c.toDataURL('image/png'); })()"""
INK = """(() => { let a = 0; for (const L of result.layers) for (const it of L.items) a += Math.abs(VZ.area(it.outer.q)) - it.holes.reduce((s, h) => s + Math.abs(VZ.area(h.q)), 0); return a / (result.w * result.h); })()"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width": 1400, "height": 1000})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + UI); await done(pg)
        await pg.evaluate("S.textMode = 'off'")

        # ---- Source presets
        tiles = await pg.evaluate("[...document.querySelectorAll('[data-preset]')].map(b => b.dataset.preset)")
        check("seven source presets", tiles == ["onecolor", "logo", "detailed", "silhouette", "sketch", "gray", "photo"], tiles)
        check("Photo is tucked under More", await pg.evaluate("$('#morePresets').hidden"))
        await pg.click("#morePresetsBtn")
        check("More presets shows Photo", not await pg.evaluate("$('#morePresets').hidden") and await pg.get_attribute("#morePresetsBtn", "aria-expanded") == "true")
        await pg.click("#morePresetsBtn")

        await open_file(pg, "rounded-badge.png")
        await pg.click("[data-preset=detailed]"); await done(pg)
        check("help text follows the preset", "16 colors" in await pg.inner_text("#presetHelp"))

        await pg.click("[data-preset=onecolor]"); await done(pg)
        check("One color traces one color", await pg.evaluate("result.layers.length") == 1)

        await pg.click("[data-preset=silhouette]"); await done(pg)
        sil = await pg.evaluate("({ n: result.layers.length, holes: result.layers.reduce((s, L) => s + L.items.reduce((t, it) => t + it.holes.length, 0), 0) })")
        check("Silhouette is one color with no holes", sil["n"] == 1 and sil["holes"] == 0, sil)

        await pg.click("[data-preset=gray]"); await done(pg)
        pal = await pg.evaluate("result.palette.map(p => p.hex)")
        gray = all(abs(int(h[1:3], 16) - int(h[3:5], 16)) <= 2 and abs(int(h[3:5], 16) - int(h[5:7], 16)) <= 2 for h in pal)
        check("Grayscale colors are grays", gray and len(pal) >= 3, pal)
        check("the count says shades of gray", "shades of gray" in await pg.inner_text("#stepper"))
        await pg.click("#cm-auto"); await done(pg)
        check("choosing Auto colors leaves grayscale", not await pg.evaluate("S.gray"))

        sketch = await pg.evaluate(SKETCH)
        await pg.evaluate("S.preset = 'onecolor'; Object.assign(S, PRESETS.onecolor)")
        await pg.evaluate("async u => { const d = convertDone(); await openImage(u, 'sketch.png', ''); await d; }", sketch)
        ink_global = await pg.evaluate(INK)
        await pg.click("[data-preset=sketch]"); await done(pg)
        ink_sketch = await pg.evaluate(INK)
        # The strokes cover about 2 percent of the page; a single threshold also turns the dark paper black.
        check("Sketch ignores the darker paper", ink_sketch < 0.05 and ink_sketch < ink_global, f"one color {ink_global:.3f}, sketch {ink_sketch:.3f}")

        disc = await pg.evaluate("""(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 600; const g = c.getContext('2d');
          g.fillStyle = '#F4F2EC'; g.fillRect(0, 0, 600, 600); g.fillStyle = '#111'; g.beginPath(); g.arc(300, 300, 190, 0, 7); g.fill(); return c.toDataURL('image/png'); })()""")
        await pg.evaluate("async u => { const d = convertDone(); await openImage(u, 'disc.png', ''); await d; }", disc)
        ink_disc = await pg.evaluate(INK)
        check("Sketch keeps a solid fill solid", abs(ink_disc - 3.14159 * 190 ** 2 / 600 ** 2) < 0.02, f"{ink_disc:.3f}")

        # The thin test measures to the pixel: a bar 2r - 1 wide is thin, 2r + 1 is not.
        bars = await pg.evaluate("""(() => { const out = []; for (const r of [2.5, 3, 4, 5.5]) for (const W of [Math.ceil(2 * r) - 1, Math.ceil(2 * r) + 1]) {
            const w = 60, h = 40, m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 20; x < 20 + W; x++) m[y * w + x] = 1;
            const t = thinParts(m, w, h, r); let n = 0; for (let y = 15; y < 25; y++) for (let x = 20; x < 20 + W; x++) n += t[y * w + x];
            out.push([r, W, n > 0]); } return out; })()""")
        check("thin test is exact to the pixel", all(thin == (W < 2 * r) for r, W, thin in bars), bars)

        await pg.evaluate("S.preset = 'art'; syncControls()")
        check("old Flat art maps to Detailed logo", await pg.evaluate("S.preset") == "detailed")

        # ---- Destination presets
        await pg.click("[data-preset=logo]"); await done(pg)
        await open_file(pg, "thin-lines.png")
        chips = await pg.evaluate("[...document.querySelectorAll('[data-output]')].map(b => b.dataset.output)")
        check("six destinations", sorted(chips) == ["brand", "laser", "screen", "sticker", "vinyl", "web"], chips)

        await pg.click("[data-output=vinyl]"); await done(pg)
        st = await pg.evaluate("({ out: S.output, dest: S.dest, lay: S.layering })")
        check("Vinyl sets its minimums", st["out"] == "vinyl" and st["dest"]["minLine"] == 1.8 and st["dest"]["minGap"] == 1.5 and st["lay"] == "cutout", st)
        rows = await pg.evaluate("['#rowLine', '#rowGap', '#rowCut', '#rowBorder'].map(s => !$(s).hidden)")
        check("Vinyl shows line and gap fields", rows == [True, True, False, False], rows)
        items = await checks_done(pg)
        check("thin lines are flagged", any(i.startswith("warn") and "thinner than 1.8 mm" in i for i in items), items)
        await pg.click("#checks [data-check]"); await pg.wait_for_timeout(300)
        check("Show marks the thin spots", await pg.evaluate("!!$('#vec svg #thinMarks')"))

        # A bigger final size clears the warning.
        await pg.fill("#destSize", "40"); await pg.dispatch_event("#destSize", "change")
        items = await checks_done(pg)
        check("40 in wide has no thin lines", any(i.startswith("ok") and "Every line is at least 1.8 mm" in i for i in items), items)
        await pg.select_option("#destUnit", "mm")
        d = await pg.evaluate("S.dest")
        check("switching to mm keeps the size", d["unit"] == "mm" and abs(d["size"] - 1016) < 0.6, d)
        await pg.evaluate("document.activeElement.blur()"); await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(200)
        check("undo restores inches", await pg.evaluate("S.dest.unit") == "in")

        await pg.click("[data-preset=detailed]"); await done(pg)
        check("a source preset keeps the destination", await pg.evaluate("S.output === 'vinyl' && S.layering === 'cutout'"))

        await pg.click("[data-output=screen]"); await done(pg)
        items = await checks_done(pg)
        check("Screen print counts inks", any("ink" in i for i in items), items)
        check("lines are fine at 11 in", any(i.startswith("ok") and "1 pt at 11 in" in i for i in items), items)
        await pg.fill("#destSize", "2"); await pg.dispatch_event("#destSize", "change")
        items = await checks_done(pg)
        check("1 pt is measured: thin at 2 in", any(i.startswith("warn") and "thinner than 1 pt at 2 in" in i for i in items), items)
        await pg.click("[data-output=screen]"); await done(pg)
        check("clicking again turns it off", await pg.evaluate("S.output === '' && $('#destBox').hidden"))

        await pg.click("[data-output=laser]"); await done(pg)
        items = await checks_done(pg)
        check("Laser is one color", await pg.evaluate("S.cmode") == "bw" and any(i == "ok: One color." for i in items), items)

        await pg.click("[data-output=web]"); await done(pg)
        items = await checks_done(pg)
        check("Web icon checks 1 px details", any("1 px at 64 px wide" in i for i in items), items)
        check("Web SVG has no print size", "data-pt-per-unit" not in await pg.evaluate("buildSVG()"))

        # Print and brand: brand colors.
        await pg.click("[data-preset=logo]"); await done(pg)
        await pg.click("[data-output=brand]"); await done(pg)
        items = await checks_done(pg)
        check("asks for brand colors", any(i.startswith("warn") and "No brand colors" in i for i in items), items)
        await pg.click("#t-layers"); await pg.fill("#brandHex", "1e2340"); await pg.click("#addBrandHex"); await done(pg)
        check("a typed brand color is locked", await pg.evaluate("locked.includes('#1E2340')"))
        await pg.click("#t-setup")
        items = await checks_done(pg)
        off = [i for i in items if "isn't a brand color" in i or "aren't a brand color" in i]
        cols = await pg.evaluate("visibleLayers().map(L => (recolor[L.hex] || L.hex))")
        if len(cols) > 1:
            check("names the off-brand colors", off and "#1E2340" not in off[0], off)
        else:
            check("every color is a brand color", any("Every color is a brand color" in i for i in items), items)

        # Sticker: border, cut line, spot color, size.
        await open_file(pg, "sans-wordmark.png")
        await pg.click("[data-output=sticker]"); await done(pg)
        items = await checks_done(pg)
        check("one closed cut line", any(i.startswith("ok") and "One closed cut line" in i for i in items), items)
        svg = await pg.evaluate("buildSVG()")
        groups = re.findall(r'<g id="([^"]+)"', svg)
        check("border first, cut line last", groups[0] == "sticker-border" and groups[-1] == "CutContour", groups)
        check("cut line is a spot color stroke", 'data-spot="CutContour"' in svg and 'fill="none" stroke="#FF00FF"' in svg)
        ppu = float(re.search(r'data-pt-per-unit="([\d.e-]+)"', svg).group(1))
        art_w = await pg.evaluate("(b => b[2] - b[0])(artBox())")
        check("3 in wide in points", abs(ppu * art_w - 3 * 72) < 0.05, f"{ppu * art_w:.3f} pt")
        sw = float(re.search(r'id="CutContour"[^>]*stroke-width="([\d.e-]+)"', svg).group(1))
        check("cut line is 1 pt", abs(sw * ppu - 1) < 0.01, f"{sw * ppu:.3f} pt")
        w, h, vb, shapes = read_svg(svg)
        check("PDF page is the art plus border", abs(w - vb[2] * ppu) < 0.01 and w > 3 * 72, f"{w:.1f} x {h:.1f} pt")
        pdf = svg_to_pdf(svg, "sticker")
        check("PDF has the CutContour separation", b"/Separation /CutContour /DeviceCMYK" in pdf)
        border_box = await pg.evaluate("bboxOf(stickerCache.border.flatMap(o => outlinePoints(o)))")
        art = await pg.evaluate("artBox()")
        per_mm = art_w / (3 * 25.4)
        gap = min(art[0] - border_box[0], border_box[2] - art[2]) / per_mm
        check("border reaches about 4 mm past the art", 3.4 < gap < 4.8, f"{gap:.2f} mm")
        # Undo a size change: the screen shows the cut line for the size in effect.
        await pg.fill("#destSize", "6"); await pg.dispatch_event("#destSize", "change"); await checks_done(pg)
        await pg.evaluate("document.activeElement.blur()"); await pg.keyboard.press("Control+z"); await checks_done(pg); await pg.wait_for_timeout(400)
        same = await pg.evaluate("(() => { const a = $('#vec #CutContour path'), b = buildSVG().match(/id=\"CutContour\"[^>]*>\\s*<path d=\"([^\"]+)/); return !!a && !!b && a.getAttribute('d') === b[1] && S.dest.size === 3; })()")
        check("screen cut line follows undo", same)
        # The Words view can't show a cut line; it must not redraw forever.
        n = await pg.evaluate("""(async () => { let n = 0; const orig = render; window.render = function () { n++; return orig.apply(this, arguments); };
            partMode = 'text'; orig(); await new Promise(r => setTimeout(r, 1500)); window.render = orig; partMode = 'all'; orig(); return n; })()""")
        check("Words view doesn't redraw in a loop", n < 5, f"{n} redraws")
        sel = await pg.evaluate("buildSVG(false, { only: new Set(['0:0']), crop: true })")
        check("a selection export has no cut line", "CutContour" not in sel)
        check("Versa gets the plain logo", "CutContour" not in await pg.evaluate("buildSVG(false, { crop: true, noDest: true })"))

        check("no page errors", not errs, errs)
        await b.close()
    print(f"{sum(OK)}/{len(OK)} passed")
    sys.exit(0 if all(OK) else 1)

asyncio.run(main())
