"""Family design system checks: token contrast in light and dark, the accessibility modes, and no old brand leftovers."""
import asyncio, re, sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
UI = str(ROOT / "ui" / "index.html")
OK = []
def check(name, cond, info=""):
    OK.append(bool(cond)); print(("PASS" if cond else "FAIL"), name, info)

def parse(c, under=(255, 255, 255)):
    c = c.strip()
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", c)
    if m: return tuple(int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4))
    m = re.fullmatch(r"rgba?\(([^)]+)\)", c)
    if m:
        v = [float(x) for x in m.group(1).replace("/", ",").split(",")]
        a = v[3] if len(v) > 3 else 1
        return tuple(v[i] * a + under[i] * (1 - a) for i in range(3))
    raise ValueError(c)

def lum(rgb):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)

# Text token on surface token, and the minimum ratio (WCAG AA: 4.5 for text, 3 for large text and UI marks).
PAIRS = [
    ("ink", "paper", 4.5), ("ink", "card", 4.5), ("ink", "bar", 4.5),
    ("text2", "paper", 4.5), ("text2", "card", 4.5), ("text2", "bar", 4.5),
    ("text3", "paper", 4.5), ("text3", "card", 4.5),
    ("on-interactive", "interactive", 4.5),
    ("ink", "accent-wash", 4.5), ("accent-text", "accent-wash", 4.5), ("accent-text", "paper", 4.5),
    ("ok-text", "ok-wash", 4.5), ("warn-text", "warn-wash", 4.5), ("danger", "card", 4.5),
    ("fixed-ink", "accent", 4.5),        # glyphs on a butter tile are always the family's dark ink
]

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for scheme in ("light", "dark"):
            pg = await b.new_page(viewport={"width": 1400, "height": 900}, color_scheme=scheme)
            await pg.goto("file://" + UI)
            await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=60000)
            tok = await pg.evaluate("(names => { const cs = getComputedStyle(document.documentElement); return Object.fromEntries(names.map(n => [n, cs.getPropertyValue('--' + n).trim()])); })", sorted({x for a, bb, _ in PAIRS for x in (a, bb)} - {"fixed-ink"}))
            tok["fixed-ink"] = "#26352E"
            bad = []
            for fg, bg, need in PAIRS:
                surf = parse(tok[bg])
                r = ratio(parse(tok[fg], surf), surf)
                if r < need: bad.append(f"{fg} on {bg} {r:.2f}")
            check(f"{scheme}: every token pair meets WCAG AA", not bad, bad)
            # Glass text: ink on the toolbar's glass over paper.
            glass = await pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--glass').trim()")
            r = ratio(parse(tok["ink"]), parse(glass, parse(tok["paper"])))
            check(f"{scheme}: text on glass stays legible", r >= 7, f"{r:.1f}:1")
            await pg.close()

        pg = await b.new_page(viewport={"width": 1400, "height": 900})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + UI)
        await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=60000)
        css = await pg.evaluate("[...document.styleSheets].flatMap(s => [...s.cssRules].map(r => r.cssText)).join('\\n')")
        leftovers = [x for x in ("#917dff", "#4b3fc4", "#b8aeff", "#1e2340", "caveat", "nunito", "avenir", "fonts.googleapis") if x in css.lower()]
        check("no old purple, old navy, or old fonts in the styles", not leftovers, leftovers)
        check("no web font requests", await pg.evaluate("!document.querySelector('link[href*=\"fonts.googleapis\"]')"))
        check("UI font is the system font (SF Pro on a Mac)", "-apple-system" in await pg.evaluate("getComputedStyle(document.body).fontFamily"))

        # Primary button: raised ink; selected segment: ink.
        btn = await pg.evaluate("(s => [s.backgroundColor, s.boxShadow])(getComputedStyle($('#exportBtn')))")
        check("Export is a raised ink button", "38, 53, 46" in btn[0] and "inset" in btn[1], btn)
        seg = await pg.evaluate("getComputedStyle($('#v-compare')).backgroundColor")
        check("the selected view segment is ink", "38, 53, 46" in seg, seg)
        # Selection never relies on color alone: the selected preset has an outline and a check.
        sel = await pg.evaluate("(el => [getComputedStyle(el).boxShadow, getComputedStyle(el, '::after').content])($('[data-preset=logo]'))")
        check("the selected preset has an ink outline and a check", "1.5px" in sel[0] and sel[1] not in ("none", "normal"), sel)

        # One primary per view, including Align view.
        await pg.click("#v-align"); await pg.wait_for_timeout(300)
        prim = await pg.evaluate("[...document.querySelectorAll('button')].filter(b => b.offsetParent && getComputedStyle(b).backgroundColor === getComputedStyle($('#exportBtn')).backgroundColor && !b.closest('.seg, .tools, .seg.mini, .export-split')).map(b => b.id || b.textContent.trim())")
        check("Align view has one primary button", prim == [], prim)
        await pg.click("#v-compare")
        # Section headers: diamond, label, dotted rule, index.
        hdr = await pg.evaluate("(el => [!!el.querySelector('.gt-rule'), el.querySelector('.gt-rule').getBoundingClientRect().width, getComputedStyle(el, '::after').content])($('#pane-setup .group-title'))")
        check("section headers have a dotted rule and an index", hdr[0] and hdr[1] > 20 and hdr[2].startswith("counter("), hdr)
        # Error chip and stale banner text meet AA as drawn.
        err = await pg.evaluate("(() => { const s = $('#status'); s.dataset.s = 'error'; const cs = getComputedStyle(s), card = getComputedStyle(document.documentElement).getPropertyValue('--card').trim(); return [cs.color, card]; })()")
        rr = ratio(parse(err[0]), parse(err[1]))
        check("error chip text meets AA", rr >= 4.5, f"{rr:.2f}:1")
        await pg.evaluate("$('#status').dataset.s = 'done'")
        # Toast stays 4.5 s.
        await pg.evaluate("toast('Test')"); await pg.wait_for_timeout(3500)
        check("toasts stay up for 4.5 s", await pg.evaluate("$('#toast').classList.contains('show')"))

        # Card motion: hovering a tile tilts and lifts it.
        r = await pg.evaluate("(r => [r.left + r.width * 0.85, r.top + r.height * 0.2])($('[data-preset=detailed]').getBoundingClientRect())")
        await pg.mouse.move(*r); await pg.wait_for_timeout(400)
        t = await pg.evaluate("(el => [getComputedStyle(el).transform, el.classList.contains('hot'), !!el.querySelector('.card-rim')])($('[data-preset=detailed]'))")
        check("card motion tilts and lights a hovered tile", t[0] not in ("none", "matrix(1, 0, 0, 1, 0, 0)") and t[1] and t[2], t)
        await pg.mouse.move(5, 5); await pg.wait_for_timeout(400)
        check("the tile settles when the pointer leaves", await pg.evaluate("!$('[data-preset=detailed]').classList.contains('hot')"))

        # Floating zoom controls are glass over the canvas.
        fz = await pg.evaluate("(el => [el.closest('#stage') !== null, getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter])($('#floatZoom'))")
        check("zoom controls float on glass over the canvas", fz[0] and "blur" in (fz[1] or ""), fz)

        # Reduce Transparency: glass becomes the opaque bar.
        await pg.evaluate("document.documentElement.classList.add('rt')")
        rt = await pg.evaluate("[getComputedStyle($('.toolbar')).backdropFilter, getComputedStyle($('.toolbar')).backgroundColor, getComputedStyle(document.documentElement).getPropertyValue('--bar').trim()]")
        check("Reduce Transparency makes the toolbar opaque", rt[0] == "none" and tuple(round(x) for x in parse(rt[1])) == parse(rt[2]), rt)
        await pg.evaluate("document.documentElement.classList.remove('rt')")
        # Increase Contrast: secondary text moves to ink.
        await pg.evaluate("document.documentElement.classList.add('contrast')")
        hc = await pg.evaluate("(cs => [cs.getPropertyValue('--text2').trim(), cs.getPropertyValue('--ink').trim()])(getComputedStyle(document.documentElement))")
        check("Increase Contrast moves secondary text to ink", hc[0] == hc[1] or hc[0] == "var(--ink)" or "--ink" in hc[0], hc)
        await pg.evaluate("document.documentElement.classList.remove('contrast')")
        check("no page errors", not errs, errs)
        await pg.close()

        # Reduce Motion: no tilt or lift, but the edge light stays.
        pg = await b.new_page(viewport={"width": 1400, "height": 900}, reduced_motion="reduce")
        await pg.goto("file://" + UI)
        await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=60000)
        r = await pg.evaluate("(r => [r.left + r.width * 0.85, r.top + r.height * 0.2])($('[data-preset=detailed]').getBoundingClientRect())")
        await pg.mouse.move(*r); await pg.wait_for_timeout(300)
        t = await pg.evaluate("(el => [getComputedStyle(el).transform, el.classList.contains('hot')])($('[data-preset=detailed]'))")
        check("Reduce Motion: cards light up but don't tilt", t[0] == "none" and t[1], t)
        dur = await pg.evaluate("(cs => [cs.transitionDuration, cs.transitionProperty])(getComputedStyle($('[data-preset=detailed]')))")
        check("Reduce Motion keeps fades at their normal length", "0.3s" in dur[0] and "transform" not in dur[1], dur)
        await pg.close()
        await b.close()
    print(f"{sum(OK)}/{len(OK)} passed")
    sys.exit(0 if all(OK) else 1)

asyncio.run(main())
