"""Interaction and motion pass: sliding segment pills, pane entrance, popovers, first paint, keyboard stays instant,
right-click options, and the Reduce Motion fallbacks."""
import asyncio, sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
UI = str(ROOT / "ui" / "index.html")
OK = []
def check(name, cond, info=""):
    OK.append(bool(cond)); print(("PASS" if cond else "FAIL"), name, info)

PILL = """(sel => { const b = $(sel), s = b.parentElement, p = s.querySelector(':scope > .seg-pill');
  const br = b.getBoundingClientRect(), pr = p.getBoundingClientRect();
  return { dx: Math.abs(br.left - pr.left), dw: Math.abs(br.width - pr.width), op: getComputedStyle(p).opacity,
           bg: getComputedStyle(p).backgroundColor, btn: getComputedStyle(b).backgroundColor, disp: getComputedStyle(p).display }; })"""

async def ready(pg):
    await pg.goto("file://" + UI)
    await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=60000)
    await pg.wait_for_timeout(1000)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1400, "height": 900})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + UI)
        check("the first paint rises in", await pg.evaluate("document.documentElement.classList.contains('intro') && getComputedStyle($('.toolbar')).animationName === 'rise-in'"))
        await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=60000)
        await pg.wait_for_timeout(1000)
        check("the intro class clears", await pg.evaluate("!document.documentElement.classList.contains('intro')"))

        # Segment pills.
        n = await pg.evaluate("[document.querySelectorAll('.seg, .tools').length, document.querySelectorAll('.seg.has-pill, .tools.has-pill').length]")
        check("every segmented control has a pill", n[0] > 5 and n[0] == n[1], n)
        r = await pg.evaluate(PILL, "#v-compare")
        check("the view pill sits under the selected segment", r["dx"] < 1 and r["dw"] < 1 and r["op"] == "1", r)
        check("the pill is ink and the segment is clear over it", "38, 53, 46" in r["bg"] and r["btn"] == "rgba(0, 0, 0, 0)", r)
        await pg.click("#v-vector"); await pg.wait_for_timeout(60)
        mid = await pg.evaluate(PILL, "#v-vector")
        check("the pill glides to a clicked segment", mid["dx"] > 2, mid)
        await pg.wait_for_timeout(300)
        end = await pg.evaluate(PILL, "#v-vector")
        check("the pill lands on the new segment", end["dx"] < 1 and end["dw"] < 1, end)
        # Keyboard: instant.
        await pg.focus("#v-compare"); await pg.keyboard.press("Enter"); await pg.wait_for_timeout(20)
        kb = await pg.evaluate(PILL, "#v-compare")
        check("a keyboard change moves the pill at once", kb["dx"] < 1 and await pg.evaluate("document.documentElement.classList.contains('kbd')"), kb)
        await pg.mouse.click(5, 450)
        check("a click clears keyboard mode", await pg.evaluate("!document.documentElement.classList.contains('kbd')"))
        # Inspector tab pills too, after a hidden-to-visible change.
        await pg.click("#t-layers"); await pg.wait_for_timeout(400)
        r = await pg.evaluate(PILL, "#t-layers")
        check("the inspector pill follows its tab", r["dx"] < 1 and r["dw"] < 1, r)
        seg_in = await pg.evaluate("(s => { const b = s.querySelector('button[aria-pressed=\"true\"]'), p = s.querySelector('.seg-pill'); return Math.abs(b.getBoundingClientRect().left - p.getBoundingClientRect().left) < 1 && getComputedStyle(p).opacity === '1'; })($('#pane-layers .seg'))")
        check("a pill in a pane that was hidden lands once the pane shows", seg_in)

        # Panes enter from the side of the chosen tab.
        await pg.click("#t-shapes")
        a = await pg.evaluate("(p => [p.classList.contains('pane-enter'), p.style.getPropertyValue('--dx'), getComputedStyle(p.firstElementChild).animationName])($('#pane-shapes'))")
        check("a pane to the left comes in from the left", a[0] and a[1] == "-12px" and a[2] == "enter-x", a)
        await pg.wait_for_timeout(400)
        await pg.click("#t-text")
        a = await pg.evaluate("(p => [p.classList.contains('pane-enter'), p.style.getPropertyValue('--dx')])($('#pane-text'))")
        check("a pane to the right comes in from the right", a[0] and a[1] == "12px", a)
        await pg.wait_for_timeout(800)
        check("the pane settles", await pg.evaluate("!$('#pane-text').classList.contains('pane-enter')"))
        await pg.focus("#t-setup"); await pg.keyboard.press("Enter"); await pg.wait_for_timeout(20)
        check("a tab picked from the keyboard opens at once", await pg.evaluate("!$('#pane-setup').classList.contains('pane-enter') && !$('#pane-setup').hidden"))
        await pg.mouse.click(5, 450)

        # Menus pop in.
        await pg.click("#exportMenuBtn")
        check("the export menu pops in", await pg.evaluate("getComputedStyle($('#exportMenu')).animationName === 'pop-in'"))
        await pg.keyboard.press("Escape")

        # Right-click options: Export.
        await pg.click("#exportBtn", button="right"); await pg.wait_for_timeout(50)
        m = await pg.evaluate("(m => m && [[...m.querySelectorAll('button')].map(b => b.textContent), m.querySelector('[aria-checked=true]') && m.querySelector('[aria-checked=true]').textContent, getComputedStyle(m).position])($('#ctxMenu'))")
        check("right-click Export lists the action first, then formats", m and m[0][0].startswith("Export SVG") and m[1].startswith("SVG") and m[2] == "fixed", m)
        await pg.click("#ctxMenu >> text=PNG")
        check("picking a format from the right-click menu sets it", await pg.evaluate("!$('#ctxMenu') && $('#exportLabel').textContent === 'Export PNG'"))
        await pg.focus("#exportBtn"); await pg.click("#exportBtn", button="right"); await pg.keyboard.press("Escape")
        check("Escape closes a right-click menu and returns focus", await pg.evaluate("!$('#ctxMenu') && document.activeElement === $('#exportBtn')"))
        await pg.click("#exportBtn", button="right"); await pg.click("#ctxMenu >> text=SVG")

        # Right-click a part on the canvas.
        pt = await pg.evaluate("""(() => { for (const e of document.querySelectorAll('#vec [data-k]')) { const r = e.getBoundingClientRect(); if (r.width < 6) continue;
            for (const [fx, fy] of [[.5,.5],[.3,.5],[.5,.3],[.7,.5],[.5,.7]]) { const x = r.left + r.width * fx, y = r.top + r.height * fy, h = document.elementFromPoint(x, y);
              if (h && h.closest('[data-k]') === e) return [x, y, e.dataset.k]; } } return null; })()""")
        check("found a part to right-click", pt is not None, pt)
        if pt:
            await pg.mouse.click(pt[0], pt[1], button="right"); await pg.wait_for_timeout(50)
            m = await pg.evaluate("[selection.length, selection[0] && selection[0].li + ':' + selection[0].ii, [...$('#ctxMenu').querySelectorAll('button')].map(b => b.textContent)]")
            check("right-clicking a part selects it and offers its actions", m[0] == 1 and m[1] == pt[2] and m[2][:3] == ["Keep only", "Hide", "Delete⌫"], m)
            await pg.click("#ctxMenu >> text=Hide"); await pg.wait_for_timeout(100)
            check("Hide from the right-click menu hides the part", await pg.evaluate(f"!document.querySelector('#vec [data-k=\"{pt[2]}\"]') && $('#toast').textContent.startsWith('Hid 1 part')"))
            await pg.keyboard.press("Meta+z"); await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(200)
        # Empty canvas.
        sr = await pg.evaluate("(r => [r.left + 30, r.top + 30])($('#stage').getBoundingClientRect())")
        await pg.mouse.click(sr[0], sr[1], button="right"); await pg.wait_for_timeout(50)
        m = await pg.evaluate("[...$('#ctxMenu').querySelectorAll('button')].map(b => b.textContent)")
        check("right-clicking empty canvas offers select and zoom", m[0].startswith("Select all") and any(x.startswith("Zoom to fit") for x in m), m)
        await pg.mouse.click(5, 450)
        check("clicking elsewhere closes the menu", await pg.evaluate("!$('#ctxMenu')"))
        # Zoom.
        await pg.click("#zoomPct", button="right"); await pg.click("#ctxMenu >> text=200%"); await pg.wait_for_timeout(100)
        check("right-click zoom goes to 200%", await pg.evaluate("$('#zoomPct').textContent") == "200%")
        await pg.click("#zoomPct", button="right")
        check("the zoom menu checks the current level", await pg.evaluate("$('#ctxMenu [aria-checked=true]').textContent.startsWith('200%')"))
        await pg.click("#ctxMenu >> text=Zoom to fit")
        # Choose image.
        await pg.click("#addBtn", button="right")
        check("right-click Choose image offers the sample", await pg.evaluate("[...$('#ctxMenu').querySelectorAll('button')].some(b => b.textContent === 'Open the sample logo')"))
        await pg.keyboard.press("Escape")
        # The browser's own menu never shows over the app.
        prevented = await pg.evaluate("(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }); $('#exportBtn').dispatchEvent(e); const d = e.defaultPrevented; closeCtx(); return d; })()")
        check("right-click menus replace the browser's menu", prevented)
        check("no page errors", not errs, errs)
        await pg.close()

        # Reduce Motion: no pill (the segment fills itself), panes fade without moving.
        pg = await b.new_page(viewport={"width": 1400, "height": 900}, reduced_motion="reduce")
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await ready(pg)
        r = await pg.evaluate(PILL, "#v-compare")
        check("Reduce Motion: no sliding pill; the segment is ink", r["disp"] == "none" and "38, 53, 46" in r["btn"], r)
        await pg.click("#t-shapes"); await pg.wait_for_timeout(60)
        t = await pg.evaluate("(c => [getComputedStyle(c).transform, +getComputedStyle(c).opacity])($('#pane-shapes').firstElementChild)")
        check("Reduce Motion: panes fade in without moving", t[0] == "none" and t[1] < 1, t)
        check("no page errors (Reduce Motion)", not errs, errs)
        await pg.close()

        # Limit animation: the setting does what Reduce Motion does, and it's remembered.
        pg = await b.new_page(viewport={"width": 1400, "height": 900})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await ready(pg)
        check("Limit animation starts off", await pg.evaluate("!document.documentElement.classList.contains('limit') && !$('#limitMotion').checked"))
        await pg.click("#t-layers"); await pg.click("#t-setup"); await pg.wait_for_timeout(400)
        await pg.evaluate("$('#appGroup').scrollIntoView()")
        await pg.click("label[for=limitMotion]")
        await pg.wait_for_timeout(350)                      # the segment's own fill fades in
        r = await pg.evaluate(PILL, "#v-compare")
        check("Limit animation: no sliding pill; the segment is ink", await pg.evaluate("document.documentElement.classList.contains('limit')") and r["disp"] == "none" and "38, 53, 46" in r["btn"], r)
        await pg.click("#t-shapes"); await pg.wait_for_timeout(60)
        t = await pg.evaluate("(c => [getComputedStyle(c).transform, getComputedStyle(c).animationName])($('#pane-shapes').firstElementChild)")
        check("Limit animation: panes fade without moving", t[0] == "none" and t[1] == "fade-in", t)
        box = await pg.evaluate("(r => [r.left + r.width * 0.85, r.top + r.height * 0.2])(($('#t-setup').click(), $('[data-preset=detailed]')).getBoundingClientRect())")
        await pg.wait_for_timeout(400); await pg.mouse.move(*box); await pg.wait_for_timeout(300)
        t = await pg.evaluate("(el => [getComputedStyle(el).transform, el.classList.contains('hot')])($('[data-preset=detailed]'))")
        check("Limit animation: cards light up but don't tilt", t[0] == "none" and t[1], t)
        await pg.reload(); await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=60000)
        check("Limit animation is remembered", await pg.evaluate("document.documentElement.classList.contains('limit') && $('#limitMotion').checked"))
        await pg.evaluate("VZ_MENU('limitMotion')")
        check("View > Limit Animation turns it off again", await pg.evaluate("!document.documentElement.classList.contains('limit') && !$('#limitMotion').checked && $('#toast').textContent === 'Limit animation is off.'"))
        check("no page errors (Limit animation)", not errs, errs)
        await pg.close()

        # Welcome tour: shows once on first open, four steps, choices apply, Escape skips.
        ctxb = await b.new_context(viewport={"width": 1400, "height": 900})
        await ctxb.add_init_script("Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })")
        pg = await ctxb.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + UI)
        await pg.wait_for_selector("#tour", timeout=5000)
        h = await pg.evaluate("[$('#tourLabel').textContent, $('#tourCount').textContent, $('#tourTitle').textContent, document.activeElement.id, $('#tour').getAttribute('aria-modal')]")
        check("the tour opens on first launch with focus on its primary button", h == ["Welcome to Vectorize", "01 / 04", "Clean vectors from any logo.", "tourNext", "true"], h)
        await pg.wait_for_function("document.querySelector('#status').dataset.s==='done'", timeout=60000)
        await pg.click("#tourNext"); await pg.wait_for_timeout(60)
        st = await pg.evaluate("(s => [getComputedStyle(s).animationName, s.style.getPropertyValue('--dx')])($('.tour-step'))")
        check("the next step comes in from the right", st == ["enter-x", "24px"], st)
        await pg.click("[data-tp=sketch]"); await pg.wait_for_timeout(100)
        check("picking a preset in the tour sets it", await pg.evaluate("S.preset === 'sketch' && $('[data-tp=sketch]').getAttribute('aria-checked') === 'true' && $('.preset[data-preset=sketch]').getAttribute('aria-pressed') === 'true'"))
        await pg.click("#tourBack"); await pg.wait_for_timeout(60)
        check("Back comes in from the left", await pg.evaluate("$('.tour-step').style.getPropertyValue('--dx') === '-24px' && $('#tourCount').textContent === '01 / 04'"))
        await pg.click("#tourNext"); await pg.click("#tourNext"); await pg.click("#tourNext")
        f = await pg.evaluate("[$('#tourCount').textContent, $('#tourNext').textContent.trim(), [...document.querySelectorAll('[data-tf]')].map(b => b.dataset.tf + (b.disabled ? '-off' : ''))]")
        check("the last step offers formats (PDF and EPS need the Mac app)", f == ["04 / 04", "Start using Vectorize", ["svg", "pdf-off", "eps-off", "png"]], f)
        await pg.click("[data-tf=png]")
        check("picking a format in the tour sets Export", await pg.evaluate("$('#exportLabel').textContent") == "Export PNG")
        await pg.keyboard.press("Tab"); await pg.keyboard.press("Tab"); await pg.keyboard.press("Tab"); await pg.keyboard.press("Tab"); await pg.keyboard.press("Tab")
        check("focus stays inside the tour", await pg.evaluate("!!document.activeElement.closest('#tour')"))
        await pg.click("#tourNext")
        check("finishing closes the tour", await pg.evaluate("!$('#tour')"))
        await pg.reload(); await pg.wait_for_timeout(1500)
        check("the tour doesn't come back after it's seen", await pg.evaluate("!$('#tour')"))
        await pg.click("#showTour")
        check("Show the welcome tour opens it again", await pg.evaluate("!!$('#tour') && $('#tourCount').textContent === '01 / 04'"))
        await pg.keyboard.press("Escape")
        check("Escape skips the tour and returns focus", await pg.evaluate("!$('#tour') && document.activeElement === $('#showTour')"))
        await pg.evaluate("VZ_MENU('tour')")
        check("Help > Welcome Tour opens it", await pg.evaluate("!!$('#tour')"))
        await pg.keyboard.press("Enter")
        check("the tour's Enter goes to the next step instantly", await pg.evaluate("$('#tourCount').textContent === '02 / 04' && getComputedStyle($('.tour-step')).animationName === 'none'"))
        check("no page errors (tour)", not errs, errs)
        await ctxb.close()
        pg = await b.new_page(viewport={"width": 1400, "height": 900})
        await pg.goto("file://" + UI); await pg.wait_for_timeout(1500)
        check("automated browsers never see the tour", await pg.evaluate("!$('#tour')"))
        await pg.close()
        await b.close()
    print(f"{sum(OK)}/{len(OK)} passed")
    sys.exit(0 if all(OK) else 1)

asyncio.run(main())
