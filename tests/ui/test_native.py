"""The Mac build's interface against a mock pywebview bridge, then the captured calls run through the real Python bridge."""
import asyncio, sys, json, base64, io, zipfile, tempfile, pathlib
from playwright.async_api import async_playwright

import os, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
UI = str(ROOT / "ui" / "index.html")
FIX = str(ROOT / "tests" / "fixtures")
OUT = os.environ.get("VZ_TEST_OUT") or tempfile.mkdtemp()
REPO = str(ROOT)
OK = []
def check(name, cond, info=""):
    OK.append(bool(cond)); print(("PASS" if cond else "FAIL"), name, info)

MOCK = r"""
window.__calls = [];
window.__lic = { enabled: true, licensed: false };
const rec = (name, args, out) => { window.__calls.push({ name, args }); return Promise.resolve(typeof out === "function" ? out(...args) : out); };
window.pywebview = { api: {
  app_info: (...a) => rec("app_info", a, { version: "1.0.0", native: true, macos: "14.5", cutout: true, licensing: true, settings: { exportFormat: "pdf", lastPreset: null } }),
  remember: (...a) => rec("remember", a, true),
  open_images: (...a) => rec("open_images", a, () => window.__openResult || []),
  save_file: (...a) => rec("save_file", a, it => ({ path: "/Users/tim/Desktop/" + it.name + "." + it.format, name: it.name + "." + it.format })),
  choose_folder: (...a) => rec("choose_folder", a, "/Users/tim/Desktop"),
  save_many: (...a) => rec("save_many", a, (f, items, sub) => ({ folder: f + "/" + sub, count: items.length, files: items.map(i => i.name) })),
  reveal: (...a) => rec("reveal", a, true),
  open_url: (...a) => rec("open_url", a, true),
  font_families: (...a) => rec("font_families", a, ["Avenir Next", "Futura", "Helvetica Neue", "Nunito"]),
  send_to_versa: (...a) => rec("send_to_versa", a, { opened: true, path: "/tmp/x.zip" }),
  license_status: (...a) => rec("license_status", a, () => ({ ...window.__lic })),
  activate: (...a) => rec("activate", a, key => key === "GOOD-KEY" ? (window.__lic = { enabled: true, licensed: true, email: "tim@example.com" }, { ok: true, message: "Activated. Thanks for supporting GreenLaunch." }) : { ok: false, message: "That license key wasn't found. Check it against your purchase email." }),
  deactivate: (...a) => rec("deactivate", a, () => (window.__lic = { enabled: true, licensed: false }, { ok: true, message: "This Mac's license slot is free." })),
  remove_background: (...a) => rec("remove_background", a, async src => {
    // Stand-in for Apple Vision: clear every pixel close to the corner color.
    const im = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext("2d"); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data, r0 = p[0], g0 = p[1], b0 = p[2];
    for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - r0) + Math.abs(p[i + 1] - g0) + Math.abs(p[i + 2] - b0) < 40) p[i + 3] = 0;
    x.putImageData(d, 0, 0); return { dataUrl: c.toDataURL("image/png") };
  }),
} };
"""

async def done(pg, t=60000):
    await pg.wait_for_timeout(150)
    await pg.wait_for_function("document.querySelector('#status').dataset.s!=='working' && document.querySelector('#busy').hidden", timeout=t)

async def calls(pg, name):
    return await pg.evaluate(f"window.__calls.filter(c=>c.name==={json.dumps(name)}).map(c=>c.args)")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1280, "height": 800})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.add_init_script(MOCK)
        await pg.goto("file://" + UI); await done(pg)
        await pg.wait_for_function("NATIVE !== null")

        check("native mode: Web badge hidden", await pg.evaluate("$('#badge').hidden"))
        check("native mode: AI cutout offered", not await pg.evaluate("$('#bg-ai').hidden"))
        check("remembered format is PDF", await pg.inner_text("#exportLabel") == "Export PDF")
        check("license window opens when unlicensed", not await pg.evaluate("$('#licModal').hidden"))
        await pg.screenshot(path=OUT + "/nat-license.png")
        await pg.click("#licClose")

        # Export is gated
        await pg.click("#exportBtn"); await pg.wait_for_timeout(200)
        check("export asks for a license first", not await pg.evaluate("$('#licModal').hidden") and not await calls(pg, "save_file"))
        await pg.fill("#licKey", "WRONG"); await pg.click("#licGo"); await pg.wait_for_timeout(200)
        check("wrong key shows the server's message", "wasn't found" in await pg.inner_text("#licMsg"))
        await pg.fill("#licKey", "GOOD-KEY"); await pg.press("#licKey", "Enter"); await pg.wait_for_timeout(300)
        check("good key activates and closes", await pg.evaluate("$('#licModal').hidden && LIC.licensed"))

        # PDF export goes through save_file with the SVG
        await pg.click("#exportBtn"); await pg.wait_for_timeout(300)
        sf = await calls(pg, "save_file")
        check("PDF export calls save_file", sf and sf[-1][0]["format"] == "pdf" and sf[-1][0]["svg"].startswith("<svg"), sf and sf[-1][0]["name"])
        pdf_item = sf[-1][0]

        # EPS and PNG items too
        await pg.click("#exportMenuBtn"); await pg.click('[data-fmt="eps"]'); await pg.click("#exportBtn"); await pg.wait_for_timeout(300)
        eps_item = (await calls(pg, "save_file"))[-1][0]
        await pg.click("#exportMenuBtn"); await pg.click('[data-fmt="png"]'); await pg.click("#exportBtn"); await pg.wait_for_timeout(800)
        png_item = (await calls(pg, "save_file"))[-1][0]
        check("format choice is remembered", ["exportFormat", "png"] in await calls(pg, "remember"))
        await pg.click("#exportMenuBtn"); await pg.click('[data-fmt="svg"]')

        # Separations through choose_folder + save_many
        await pg.click("#exportMenuBtn"); await pg.click('[data-xact="separations"]'); await done(pg); await pg.wait_for_timeout(300)
        sm = await calls(pg, "save_many")
        n_layers = await pg.evaluate("visibleLayers().length")
        check("separations save one file per color into a subfolder", sm and len(sm[-1][1]) == n_layers and sm[-1][2].endswith("separations"), f"{sm and [i['name'] for i in sm[-1][1]]}")
        check("folder is revealed in Finder", await calls(pg, "reveal"))
        many_items = sm[-1][1]

        # Versa
        await pg.click("#versaBtn"); await pg.wait_for_timeout(400)
        sv = await calls(pg, "send_to_versa")
        zf = zipfile.ZipFile(io.BytesIO(base64.b64decode(sv[-1][1]))) if sv else None
        man = json.loads(zf.read("versa.json")) if zf else {}
        check("Send to Versa passes the package", zf and man.get("from", {}).get("app") == "Vectorize", sv and sv[-1][0])
        check("toast says Versa opened", "Opened in Versa" in await pg.inner_text("#toast"))

        # Installed fonts come from the Mac
        await pg.click("#t-text"); await pg.fill("#tx-0", "SUNNY CO")
        await pg.evaluate("result.texts[0].ownOpen=true; renderTexts()")
        await pg.click('[data-fbrowse="0"]'); await pg.wait_for_timeout(200)
        check("Browse installed fonts uses the Mac's list", await calls(pg, "font_families") and await pg.evaluate("document.querySelectorAll('#localFonts option').length") == 4)

        # AI cutout
        await pg.click("#t-setup"); await pg.click("#bg-ai"); await done(pg)
        check("AI cutout calls Vision", await calls(pg, "remove_background"))
        check("AI cutout traces the cut image", await pg.evaluate("!!job.cutImgd && result.transparent && !result.palette.some(p=>p.bg)"), await pg.inner_text("#stats"))
        await pg.screenshot(path=OUT + "/nat-ai.png")

        # Menu commands
        await pg.evaluate("VZ_MENU('selectAll')")
        check("menu Select All", await pg.evaluate("selection.length") > 0)
        await pg.evaluate("VZ_MENU('deselect'); VZ_MENU('view:original')")
        check("menu view", await pg.evaluate("view") == "original")
        await pg.evaluate("VZ_MENU('view:compare'); VZ_MENU('undo')"); await done(pg)
        check("menu Undo reverses AI cutout", await pg.evaluate("S.bg") == "remove")
        await pg.evaluate("VZ_MENU('license')")
        check("license window shows activated state", not await pg.evaluate("$('#licDone').hidden"))
        await pg.click("#licClose2")

        # Open two images through the native dialog: batch
        def data_url(f):
            return "data:image/jpeg;base64," + base64.b64encode(open(FIX + "/" + f, "rb").read()).decode()
        await pg.evaluate(f"window.__openResult = [{{name:'shapes.jpg', path:'/x/shapes.jpg', dataUrl:{json.dumps(data_url('shapes.jpg'))}}}, {{name:'lockup.jpg', path:'/x/lockup.jpg', dataUrl:{json.dumps(data_url('lockup.jpg'))}}}]")
        await pg.keyboard.press("Meta+o"); await pg.wait_for_timeout(600); await done(pg)
        check("⌘O opens the native dialog and starts a batch", await calls(pg, "open_images") and await pg.evaluate("batch && batch.items.length") == 2)
        await pg.click("#batchExport"); await pg.wait_for_function("window.__calls.filter(c=>c.name==='save_many').length>=2", timeout=120000)
        last = (await calls(pg, "save_many"))[-1]
        check("Export all saves both", [i["name"] for i in last[1]] == ["shapes", "lockup"], f"{[i['name'] for i in last[1]]}")
        check("no page errors", not errs, f"{errs}")
        await b.close()

    # Run the captured payloads through the real Python bridge.
    sys.path.insert(0, REPO)
    from app.bridge import Bridge, Settings
    tmp = pathlib.Path(tempfile.mkdtemp())
    class D:
        def open_files(self, types, directory=""): return []
        def save_file(self, name, directory=""): return str(tmp / name)
        def choose_folder(self, directory=""): return str(tmp)
    br = Bridge(D(), None, Settings(tmp / "settings.json"))
    r = br.save_file(pdf_item); check("bridge writes the PDF", r and (tmp / r["name"]).read_bytes()[:5] == b"%PDF-", r)
    r = br.save_file(eps_item); check("bridge writes the EPS", r and (tmp / r["name"]).read_bytes()[:10] == b"%!PS-Adobe", r)
    r = br.save_file(png_item); check("bridge writes the PNG", r and (tmp / r["name"]).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n", r)
    r = br.save_many(str(tmp), many_items, "Sample logo separations")
    check("bridge writes the separations", r.get("count") == len(many_items) and len(list(pathlib.Path(r["folder"]).iterdir())) == len(many_items), r)
    print(f"{sum(OK)}/{len(OK)} passed")
    if not all(OK): sys.exit(1)

asyncio.run(main())
