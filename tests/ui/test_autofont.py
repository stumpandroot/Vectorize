"""Words are read on the Mac, matched to a font, and swapped in. Uses a stand-in for Apple Vision
and a font that's installed on the test machine instead of Google Fonts."""
import asyncio, json, sys, os, tempfile
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

MOCK = """
window.__calls = [];
const rec = (name, args, out) => { window.__calls.push({ name, args }); return Promise.resolve(typeof out === 'function' ? out(...args) : out); };
window.pywebview = { api: {
  app_info: (...a) => rec('app_info', a, { version: '1.0.0', native: true, macos: '14.5', cutout: false, ocr: true, licensing: false, settings: {} }),
  remember: (...a) => rec('remember', a, true),
  license_status: (...a) => rec('license_status', a, { enabled: false, licensed: true }),
  recognize_text: (...a) => rec('recognize_text', a, %s),
  font_families: (...a) => rec('font_families', a, []),
  save_file: (...a) => rec('save_file', a, it => ({ name: it.name + '.' + it.format, path: '/x' })),
  choose_folder: (...a) => rec('choose_folder', a, '/x'),
  save_many: (...a) => rec('save_many', a, (f, items, sub) => ({ folder: f + '/' + sub, count: items.length, files: [] })),
  reveal: (...a) => rec('reveal', a, true),
} };
""" % json.dumps(OCR)

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
          window.addEventListener('DOMContentLoaded', () => { FONTS = []; fontsReady = null; customFaces = [['Nunito', 800, 'installed', 'Nunito']]; });
        """)
        await pg.goto("file://" + UI)
        await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=120000)
        await pg.wait_for_function("typeof NATIVE !== 'undefined' && NATIVE !== null")
        check("a test font is installed", await pg.evaluate("window.__fontLoad"))
        # The first trace finished before the app knew it was on a Mac; trace again so words are read.
        await pg.evaluate("convert()")
        await pg.wait_for_function("window.__calls.some(c => c.name === 'recognize_text')", timeout=60000)
        await pg.wait_for_function("result.texts.length && result.texts[0].results !== undefined", timeout=60000)
        T = await pg.evaluate("({ text: result.texts[0].text, mode: result.texts[0].mode, auto: !!result.texts[0].auto, iou: (result.texts[0].results[0] || {}).iou, fam: (result.texts[0].results[0] || {}).fam })")
        check("the word is read", T["text"] == "SUNNY CO", T)
        check("fonts are compared", T["iou"] is not None, f"best {T['fam']} {T['iou']}")
        strong = T["iou"] is not None and T["iou"] >= await pg.evaluate("AUTO_FONT_MIN")
        check("the matching font is strong enough to swap", strong, f"{T['iou']}")
        check("swaps only when the match is strong", (T["mode"] == "font") == strong and T["auto"] == strong, f"mode {T['mode']}")
        if strong:
            svg = await pg.evaluate("buildSVG()")
            check("export carries the font", 'data-font="' in svg and 'data-text="SUNNY CO"' in svg)
            check("toast says how to undo", "Choose Traced" in await pg.inner_text("#toast"))
            await pg.click("#t-text"); await pg.click('[data-tmode="original"][data-t="0"]'); await pg.wait_for_timeout(200)
            await pg.evaluate("convert()"); await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=60000); await pg.wait_for_timeout(800)
            check("Traced sticks after a retrace", await pg.evaluate("result.texts[0].mode") == "original")
        n = await pg.evaluate("window.__calls.filter(c => c.name === 'recognize_text').length")
        check("text is read once per image", n == 1, f"{n} calls")
        check("no page errors", not errs, errs)
        await b.close()
    print(f"{sum(OK)}/{len(OK)} passed")
    if not all(OK): sys.exit(1)

asyncio.run(main())
