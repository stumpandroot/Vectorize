"""Words are read on the Mac, matched to a font, checked letter by letter, and swapped in. Uses a stand-in for
Apple Vision, and the bridge's font_file answers with a font file from the test machine instead of Google Fonts."""
import asyncio, base64, json, sys, os, tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
UI = str(ROOT / "ui" / "index.html")
OK = []
def check(name, cond, info=""):
    OK.append(bool(cond)); print(("PASS" if cond else "FAIL"), name, info)

# The sample logo's "SUNNY CO", as Apple Vision would report it (fractions of the image, top left origin).
OCR = {"lines": [{"text": "SUNNY CO", "confidence": 0.98, "box": [0.22, 0.775, 0.56, 0.095],
                  "words": [{"text": "SUNNY", "box": [0.22, 0.775, 0.33, 0.095]}, {"text": "CO", "box": [0.6, 0.775, 0.18, 0.095]}]}]}

# Font files on the test machine: one that matches the sample (drawn in the same font) and one that doesn't.
def _font(*names):
    for n in names:
        for d in ("/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/liberation", "/Library/Fonts", "/System/Library/Fonts/Supplemental"):
            f = Path(d) / n
            if f.exists():
                return base64.b64encode(f.read_bytes()).decode()
    return None
SANS = _font("DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf", "Arial Bold.ttf")
SERIF = _font("DejaVuSerif-Bold.ttf", "LiberationSerif-Bold.ttf", "Georgia Bold.ttf")

MOCK = """
window.__calls = [];
const rec = (name, args, out) => { window.__calls.push({ name, args }); return Promise.resolve(typeof out === 'function' ? out(...args) : out); };
window.pywebview = { api: {
  app_info: (...a) => rec('app_info', a, { version: '1.0.0', native: true, macos: '14.5', cutout: false, ocr: true, licensing: false, settings: {} }),
  remember: (...a) => rec('remember', a, true),
  license_status: (...a) => rec('license_status', a, { enabled: false, licensed: true }),
  recognize_text: (...a) => rec('recognize_text', a, %s),
  font_families: (...a) => rec('font_families', a, []),
  font_file: (...a) => rec('font_file', a, (fam, w) => fam === 'Nunito' && w === 800 ? { b64: %s } : fam === 'Lora' && w === 700 ? { b64: %s } : { missing: true }),
  save_file: (...a) => rec('save_file', a, it => ({ name: it.name + '.' + it.format, path: '/x' })),
  choose_folder: (...a) => rec('choose_folder', a, '/x'),
  save_many: (...a) => rec('save_many', a, (f, items, sub) => ({ folder: f + '/' + sub, count: items.length, files: [] })),
  reveal: (...a) => rec('reveal', a, true),
} };
""" % (json.dumps(OCR), json.dumps(SANS), json.dumps(SERIF))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1280, "height": 800})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.add_init_script(MOCK)
        # Draw the sample with an installed bold sans standing in for Nunito, and compare against that
        # same font instead of Google Fonts, which tests can't reach. A strong match is expected.
        await pg.add_init_script("""
          const f = new FontFace('Nunito', "local('DejaVu Sans Bold'), local('DejaVuSans-Bold'), local('Liberation Sans Bold'), local('LiberationSans-Bold'), local('Arial Bold'), local('Helvetica Bold')", { weight: '800' });
          document.fonts.add(f); window.__fontLoad = f.load().then(() => true, () => false);
          window.addEventListener('DOMContentLoaded', () => { FONTS = [['Nunito', [800]]]; fontsReady = null; });
        """)
        await pg.goto("file://" + UI)
        await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=120000)
        await pg.wait_for_function("typeof NATIVE !== 'undefined' && NATIVE !== null")
        check("a test font is installed", await pg.evaluate("window.__fontLoad"))
        # The first trace finished before the app knew it was on a Mac; trace again so words are read.
        await pg.evaluate("convert()")
        await pg.wait_for_function("window.__calls.some(c => c.name === 'recognize_text')", timeout=60000)
        await pg.wait_for_function("result.texts.length && result.wordsDone === true", timeout=120000)
        T = await pg.evaluate("(() => { const T = result.texts.find(t => !t.removed); const r = (T.results || [])[0] || {}; return { text: T.text, mode: T.mode, auto: !!T.auto, iou: r.iou, fam: r.fam, verdict: r.verdict, label: verdictLabel(r.verdict), fill: T.fillRule }; })()")
        check("the word is read", T["text"] == "SUNNY CO", T)
        check("the font is fitted from its real outlines", T["fam"] == "Nunito" and (T["iou"] or 0) > 0.85, f"best {T['fam']} {T['iou']}")
        strong = bool(T["verdict"] and T["verdict"]["pass"])
        check("every letter passes the check", strong, T["verdict"])
        check("the check says so", T["label"] == "Exact match", T["label"])
        check("a passing font swaps in on its own", T["mode"] == "font" and T["auto"], f"mode {T['mode']}")
        check("font letters export with the nonzero fill rule", T["fill"] == "nonzero", T["fill"])
        # A different design must not swap in: the letter check catches it, and it's left as a suggestion.
        wrong = await pg.evaluate("""(async () => { FONTS = [['Lora', [700]]]; const T = result.texts.find(t => !t.removed);
          const d = await autoDecide(T, 'SUNNY CO'); return { swap: d.swap, fam: d.best && d.best.fam, bad: d.verdict && d.verdict.bad.map(b => b.why) }; })()""")
        check("a font that doesn't match isn't swapped in", wrong["swap"] is False and wrong["fam"] == "Lora", wrong)
        await pg.evaluate("FONTS = [['Nunito', [800]]]")
        # Compare draws the font's outline over the original.
        await pg.click("#t-text"); await pg.wait_for_timeout(200)
        await pg.click('[data-compare]'); await pg.wait_for_timeout(400)
        drawn = await pg.evaluate("(() => { const c = document.querySelector('canvas.cmp'); if (!c || !c.width) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()")
        check("Compare shows the outline over the original", drawn > 100, f"{drawn} pixels")
        await pg.click('[data-compare]'); await pg.wait_for_timeout(100)
        if strong:
            svg = await pg.evaluate("buildSVG()")
            check("export carries the font", 'data-font="' in svg and 'data-text="SUNNY CO"' in svg)
            check("toast says how to undo", "Choose Traced" in await pg.inner_text("#toast"))
            tid = await pg.evaluate("result.texts.find(t => !t.removed).id")
            # Cleaned letters offer the lettering cleanup switches.
            await pg.click(f'[data-tmode="clean"][data-t="{tid}"]'); await pg.wait_for_timeout(300)
            check("Cleaned offers the cleanup switches", await pg.locator(f"#tm-{tid}").count() == 1 and await pg.locator(f"#ts-{tid}").count() == 1)
            await pg.click(f'[data-tmode="original"][data-t="{tid}"]'); await pg.wait_for_timeout(200)
            await pg.evaluate("convert()"); await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=60000); await pg.wait_for_timeout(800)
            check("Traced sticks after a retrace", await pg.evaluate("result.texts.find(t => !t.removed).mode") == "original")
        # One reading pass per image: the original plus each color of the trace on its own; a retrace doesn't read again.
        n = await pg.evaluate("window.__calls.filter(c => c.name === 'recognize_text').length")
        want = await pg.evaluate("1 + layerImages(result).length")
        check("text is read once per image", n == want, f"{n} calls, {want} images")
        check("no page errors", not errs, errs)
        await b.close()
    print(f"{sum(OK)}/{len(OK)} passed")
    if not all(OK): sys.exit(1)

asyncio.run(main())
