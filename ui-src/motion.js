/* ---------- Interaction and motion pass (family 2.1, matching Verbatim) ---------- */
// What it adds, all on the family motion tokens with no bounce:
// - Segmented controls: the selected pill slides to the new segment (motion.snappy).
// - Inspector tabs: the new pane comes in from the side of the tab you picked, its sections staggered 30 ms apart.
// - Menus pop in from where they open; the selection bar rises; the Align and batch bars drop in. Everything leaves at once.
// - The window's first paint rises in, top to bottom.
// - Right-click (Control-click) options on Export, Choose image, the zoom level, batch images, and parts on the canvas.
// Changes started from the keyboard or a menu command never animate: `html.kbd` turns motion off until the next click.
// Reduce Motion keeps the fades and drops the movement (CSS handles that).

(() => {
  const root = document.documentElement;
  const keyish = () => root.classList.add("kbd");
  document.addEventListener("keydown", e => { if (!["Shift", "Meta", "Control", "Alt", "CapsLock"].includes(e.key)) keyish(); }, true);
  document.addEventListener("pointerdown", () => root.classList.remove("kbd"), true);
  const menuCmd = window.VZ_MENU;
  window.VZ_MENU = cmd => { keyish(); menuCmd(cmd); };
})();

function root() { return document.documentElement; }

/* Limit animation (Verbatim's motion.limited): on when the system's Reduce Motion is on or you turn on the
   setting. html.limit is the one switch the CSS and card motion read, so both behave the same. */
const MOTION_SYS = matchMedia("(prefers-reduced-motion: reduce)");
let limitPref = false;
try { limitPref = localStorage.getItem("vz-limit-motion") === "1"; } catch { /* storage off */ }
function syncLimit() {
  root().classList.toggle("limit", MOTION_SYS.matches || limitPref);
  const sw = $("#limitMotion"); if (sw) sw.checked = limitPref;
}
function setLimitMotion(on, fromNative) {
  limitPref = !!on; syncLimit();
  if (fromNative) return;
  try { if (NATIVE) { NATIVE.remember("limitMotion", limitPref); if (APP && APP.settings) APP.settings.limitMotion = limitPref; } else localStorage.setItem("vz-limit-motion", limitPref ? "1" : "0"); } catch { /* storage off */ }
}
MOTION_SYS.addEventListener("change", syncLimit);
syncLimit();
$("#limitMotion").addEventListener("change", e => setLimitMotion(e.target.checked));

/* Segmented controls: one pill that slides between segments. */
const SEG_SEL = ".seg, .tools";
function segPill(seg) {
  let p = seg.querySelector(":scope > .seg-pill");
  if (!p) { p = document.createElement("i"); p.className = "seg-pill"; p.setAttribute("aria-hidden", "true"); seg.prepend(p); seg.classList.add("has-pill"); }
  return p;
}
function placePill(seg, glide) {
  const p = segPill(seg), on = seg.querySelector(':scope > button[aria-selected="true"], :scope > button[aria-pressed="true"]');
  if (!on || on.hidden || !on.offsetWidth) { p.style.opacity = "0"; p.dataset.at = ""; return; }
  const at = `${on.offsetLeft},${on.offsetTop},${on.offsetWidth},${on.offsetHeight}`;
  if (p.dataset.at === at) return;
  const first = !p.dataset.at; p.dataset.at = at;
  if (!glide || first) p.style.transition = "none";
  p.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
  p.style.width = on.offsetWidth + "px"; p.style.height = on.offsetHeight + "px"; p.style.opacity = "1";
  if (!glide || first) { void p.offsetWidth; p.style.transition = ""; }
}
const segSize = new ResizeObserver(list => { for (const r of list) { const s = r.target.closest(SEG_SEL); if (s) placePill(s, false); } });
function watchSeg(seg) {
  if (seg.dataset.pill) return; seg.dataset.pill = "1";
  segSize.observe(seg); seg.querySelectorAll(":scope > button").forEach(b => segSize.observe(b));
  placePill(seg, false);
}

/* Inspector panes: come in from the side of the chosen tab. */
const PANES = ["setup", "shapes", "text", "layers"];
let paneShown = "setup";
function paneEnter(pane) {
  const k = pane.id.slice(5), from = PANES.indexOf(paneShown), to = PANES.indexOf(k); paneShown = k;
  if (from === to || root().classList.contains("kbd")) return;
  pane.style.setProperty("--dx", (to > from ? 12 : -12) + "px");
  [...pane.children].forEach((c, i) => c.style.setProperty("--i", String(Math.min(i, 7))));
  pane.classList.remove("pane-enter"); void pane.offsetWidth; pane.classList.add("pane-enter");
  clearTimeout(pane._enterT); pane._enterT = setTimeout(() => pane.classList.remove("pane-enter"), 700);
}

// One observer: selection changes slide pills, panes coming into view enter, new segmented controls get a pill.
new MutationObserver(list => {
  const segs = new Set();
  for (const m of list) {
    if (m.type === "attributes") {
      const t = m.target;
      if (m.attributeName === "hidden" && t.id && t.id.startsWith("pane-") && !t.hidden) paneEnter(t);
      const s = t.parentElement && t.parentElement.closest(SEG_SEL); if (s && t.parentElement === s) segs.add(s);
    } else for (const n of m.addedNodes) if (n.nodeType === 1) {
      if (n.matches(SEG_SEL)) watchSeg(n); n.querySelectorAll && n.querySelectorAll(SEG_SEL).forEach(watchSeg);
      const s = n.parentElement && n.parentElement.matches(SEG_SEL) ? n.parentElement : null; if (s && n.tagName === "BUTTON") { segSize.observe(n); segs.add(s); }
    }
  }
  const glide = !root().classList.contains("kbd");
  segs.forEach(s => { if (s.dataset.pill) placePill(s, glide); });
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected", "aria-pressed", "hidden"] });
document.querySelectorAll(SEG_SEL).forEach(watchSeg);

/* The first paint rises in: toolbar, canvas, then the inspector's sections, 30 ms apart. */
(() => {
  const parts = [$(".toolbar"), $(".canvas-col"), $(".insp-head"), ...$("#pane-setup").children].filter(Boolean);
  parts.forEach((el, i) => el.style.setProperty("--i", String(Math.min(i, 9))));
  root().classList.add("intro");
  setTimeout(() => { root().classList.remove("intro"); parts.forEach(el => el.style.removeProperty("--i")); }, 900);
})();

/* ---------- Right-click options ---------- */
// The control's main action first, then its options with a check on the current one. Every item is also
// reachable without right-click (the control itself, its menu, the selection bar, or the menu bar).
let ctx = null, ctxFrom = null;
function closeCtx(refocus) {
  if (!ctx) return; ctx.remove(); ctx = null;
  if (refocus && ctxFrom && ctxFrom.isConnected) ctxFrom.focus({ preventScroll: true });
  ctxFrom = null;
}
function openCtx(e, items) {
  e.preventDefault(); e.stopPropagation(); closeCtx();
  ctxFrom = document.activeElement !== document.body ? document.activeElement : null;
  items = items.filter(Boolean);
  while (items.length && items[items.length - 1] === "-") items.pop();
  if (!items.length) return;
  const m = document.createElement("div"); m.className = "menu ctx"; m.setAttribute("role", "menu"); m.id = "ctxMenu";
  m.innerHTML = items.map((it, i) => it === "-" ? "<hr>" : it.title ? `<div class="menu-title">${esc(it.title)}</div>`
    : `<button type="button" role="${it.checked != null ? "menuitemradio" : "menuitem"}" data-ci="${i}"${it.checked != null ? ` aria-checked="${!!it.checked}"` : ""}${it.disabled ? " disabled" : ""}${it.danger ? ' class="danger"' : ""}>${esc(it.label)}${it.key ? `<kbd>${esc(it.key)}</kbd>` : ""}${it.note ? `<small>${esc(it.note)}</small>` : ""}</button>`).join("");
  document.body.appendChild(m); ctx = m;
  let x = e.clientX, y = e.clientY;
  if (!x && !y && e.target.getBoundingClientRect) { const r = e.target.getBoundingClientRect(); x = r.left + 8; y = r.bottom; }   // opened from the keyboard
  const w = m.offsetWidth, h = m.offsetHeight, flipX = x + w > innerWidth - 8, flipY = y + h > innerHeight - 8;
  m.style.left = Math.max(8, flipX ? x - w : x) + "px"; m.style.top = Math.max(8, flipY ? y - h : y) + "px";
  m.style.transformOrigin = `${flipX ? "right" : "left"} ${flipY ? "bottom" : "top"}`;
  m.addEventListener("click", ev => {
    const b = ev.target.closest("[data-ci]"); if (!b || b.disabled) return;
    const it = items[+b.dataset.ci]; closeCtx(); it.act && it.act();
  });
  m.addEventListener("keydown", ev => {
    const bs = [...m.querySelectorAll("button:not(:disabled)")], i = bs.indexOf(document.activeElement);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); bs[(i + (ev.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length].focus(); }
    else if (ev.key === "Escape" || ev.key === "Tab") { ev.preventDefault(); ev.stopPropagation(); closeCtx(true); }
  });
  const first = m.querySelector('button[aria-checked="true"]:not(:disabled)') || m.querySelector("button:not(:disabled)");
  if (first) first.focus({ preventScroll: true });
}
document.addEventListener("pointerdown", e => { if (ctx && !e.target.closest("#ctxMenu")) closeCtx(); }, true);
window.addEventListener("blur", () => closeCtx()); window.addEventListener("resize", () => closeCtx());
document.addEventListener("scroll", e => { if (ctx && !ctx.contains(e.target)) closeCtx(); }, true);

const sel1 = (on, label, act, extra) => Object.assign({ label, act, checked: on }, extra || {});
function exportItems() {
  const fmts = Object.keys(FORMATS), cur = fmtNow(), none = !result || !visibleLayers().length;
  return [
    { label: `Export ${FORMATS[cur]}`, key: "⌘E", act: doExport, disabled: none },
    "-", { title: "Format" },
    ...fmts.map(f => {
      const b = $(`#exportMenu [data-fmt="${f}"]`);
      return sel1(cur === f, FORMATS[f], () => { S.exportFormat = f; if (NATIVE) NATIVE.remember("exportFormat", f); syncEditorControls(); }, { disabled: b && b.disabled });
    }),
    "-",
    { label: "Export selection", key: "⇧⌘E", act: exportSelection, disabled: none || !selection.length },
    { label: "Export color separations…", act: exportSeparations, disabled: none },
    { label: "Send to Versa", act: sendToVersa, disabled: none },
  ];
}
$(".export-split").addEventListener("contextmenu", e => { if (!$("#exportBtn").disabled) { openExportMenu(false); openCtx(e, exportItems()); } else e.preventDefault(); });
$("#addBtn").addEventListener("contextmenu", e => openCtx(e, [
  { label: "Choose images…", key: "⌘O", act: chooseImages },
  { label: "Open the sample logo", act: async () => { if (batch) leaveBatch(); openImage(await makeSample(), "Sample logo", "Example image · 360 × 360 JPEG"); } },
  batch && "-", batch && { label: "Close the batch", act: () => { leaveBatch(); toast("Closed the batch. The open image stays."); } },
]));
$("#floatZoom").addEventListener("contextmenu", e => {
  if (!job) { e.preventDefault(); return; }
  const pct = Math.round(fitScale * zoom * 100), at = p => () => zoomTo(p / 100 / fitScale);
  openCtx(e, [
    { label: "Zoom to fit", key: "⌘0", act: fitView, checked: Math.abs(zoom - 1) < 1e-3 },
    "-",
    ...[50, 100, 200, 400].map(p => ({ label: `${p}%`, key: p === 100 ? "⌘1" : "", act: at(p), checked: pct === p && Math.abs(zoom - 1) >= 1e-3 })),
    "-", { label: "Outlines", act: toggleOutlines, checked: outlines },
  ]);
});
$("#batchList").addEventListener("contextmenu", e => {
  const b = e.target.closest("[data-bi]"); if (!b || !batch) return;
  const i = +b.dataset.bi, it = batch.items[i];
  openCtx(e, [
    { label: i === batch.cur ? "Open now" : `Open ${it.name}`, act: () => showBatchItem(i), disabled: i === batch.cur },
    "-",
    { label: "Export all", act: () => $("#batchExport").click() },
    { label: "Close the batch", act: () => { leaveBatch(); toast("Closed the batch. The open image stays."); } },
  ]);
});
// Parts on the canvas: right-click selects the part (keeping a selection it's already in), then offers the selection bar's actions.
$("#stage").addEventListener("contextmenu", e => {
  if (e.target.closest(".snapbar, .float-zoom, .alignbar, .ruler, .split, .pick-hint, button, input")) return;
  if (!job || !result || picking || view === "original") { e.preventDefault(); return; }
  const t = e.target.closest && e.target.closest("[data-k]");
  if (t) {
    const [li, ii] = t.dataset.k.split(":").map(Number);
    if (!selection.some(k => k.li === li && k.ii === ii)) { setSelection([{ li, ii }]); drawSelection(); renderPalette(); }
  }
  const n = selection.length, word = n === 1 && sel && wordOf(sel.li, sel.ii);
  openCtx(e, n ? [
    { label: "Keep only", act: () => selAct("keep") },
    { label: "Hide", act: () => selAct("hide") },
    { label: "Delete", key: "⌫", act: () => selAct("delete"), danger: true },
    "-",
    { label: "Fine-tune", act: () => selAct("tune") },
    word && { label: "Edit text", act: () => selAct("text") },
    { label: "Export selection", key: "⇧⌘E", act: exportSelection },
    "-",
    { label: "Select all", key: "⌘A", act: selectAll },
    { label: "Deselect", key: "esc", act: clearSelection },
  ] : [
    { label: "Select all", key: "⌘A", act: selectAll },
    "-",
    { label: "Zoom to fit", key: "⌘0", act: fitView },
    { label: "Actual size", key: "⌘1", act: () => zoomTo(1 / fitScale) },
    { label: "Outlines", act: toggleOutlines, checked: outlines },
  ]);
});

/* ---------- Welcome tour (Verbatim's pattern, four steps) ---------- */
// Shown once (until TOUR_VERSION goes up), and from Help > Welcome Tour or "Show the welcome tour" in Setup.
// Skipping or finishing marks it seen. Never shown to automated test browsers.
const TOUR_VERSION = 1;
const TOUR_ICONS = {
  trace: '<path d="M4 18C7 7 17 7 20 18"/><path d="M4 18 9.5 7.5"/><circle cx="9.5" cy="7.5" r="1.4"/><rect x="2.6" y="16.6" width="2.8" height="2.8" rx=".4"/><rect x="18.6" y="16.6" width="2.8" height="2.8" rx=".4"/>',
  tune: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  export: '<path d="M12 4v11M7.5 8.5 12 4l4.5 4.5M5 14v5h14v-5"/>',
  shapes: '<circle cx="9" cy="10" r="5"/><rect x="11" y="11" width="8" height="8" rx="1.2"/>',
  text: '<path d="M5 6h14M12 6v13M9.5 19h5"/>',
  align: '<path d="M4 4v16M8 7h10v4H8zM8 14h6v4H8z"/>',
  click: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 3v6M7 9h10"/><path d="M12.6 3.8a4.4 4.4 0 0 1 3.6 4.4" stroke-width="2.4"/>',
};
const tsvg = (k, cls) => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ""}>${TOUR_ICONS[k]}</svg>`;
let tourStep = 0;
const TOUR_LABELS = ["Welcome to Vectorize", "What you're tracing", "Fine-tune", "Last step"];
function tourSeen() {
  if (navigator.webdriver) return true;
  try { return NATIVE ? (APP && APP.settings && +APP.settings.tourSeen >= TOUR_VERSION) : +localStorage.getItem("vz-tour") >= TOUR_VERSION; } catch { return true; }
}
function markTourSeen() {
  try { if (NATIVE) { NATIVE.remember("tourSeen", TOUR_VERSION); if (APP && APP.settings) APP.settings.tourSeen = TOUR_VERSION; } else localStorage.setItem("vz-tour", String(TOUR_VERSION)); } catch { /* storage off */ }
}
function maybeShowTour() { if (!tourSeen() && !$("#tour")) openTour(); }
function tourBody(step) {
  const where = NATIVE ? "on this Mac" : "in your browser";
  if (step === 0) return `<h3 id="tourTitle">Drop an image. Get a vector.</h3>
    <p class="lead">Drop in a PNG or JPEG. Vectorize traces it into shapes you can edit and export, and it all stays ${where}.</p>
    <div class="tour-pillars">
      <div class="pillar" style="background:var(--fill-sage)"><div class="top"><span>01</span>${tsvg("trace")}</div><b>Trace</b><small>Presets for logos, sketches, and more</small></div>
      <div class="pillar" style="background:var(--fill-butter)"><div class="top"><span>02</span>${tsvg("tune")}</div><b>Refine</b><small>True shapes, real fonts, exact alignment</small></div>
      <div class="pillar" style="background:var(--fill-petal)"><div class="top"><span>03</span>${tsvg("export")}</div><b>Export</b><small>SVG, PDF, EPS, and PNG</small></div>
    </div>`;
  if (step === 1) return `<h3 id="tourTitle">Tell it what it is.</h3>
    <p class="lead">A preset sets up the trace for that kind of art. Pick one now; you can change it anytime in Setup.</p>
    <div class="tour-grid" role="radiogroup" aria-label="Preset">${["onecolor", "logo", "detailed", "silhouette", "sketch", "gray"].map(k => {
      const name = $(`.preset[data-preset="${k}"]`).textContent.trim();
      return `<button type="button" class="tour-opt" role="radio" data-tp="${k}" aria-checked="${S.preset === k}"><b>${esc(name)}</b><span>${esc(PRESET_HELP[k])}</span></button>`; }).join("")}</div>`;
  if (step === 2) return `<h3 id="tourTitle">Make it exact.</h3>
    <p class="lead">Traces are close. These get them the rest of the way.</p>
    <div class="tour-list">
      <div class="tour-row"><span class="tile" style="background:var(--fill-butter)">${tsvg("shapes")}</span><div><b>Snap to true shapes</b><span>Click an outline to make it a perfect circle, star, heart, and more</span></div></div>
      <div class="tour-row"><span class="tile" style="background:var(--fill-sage)">${tsvg("text")}</span><div><b>Match the font</b><span>Traced words become real type in the Text tab</span></div></div>
      <div class="tour-row"><span class="tile" style="background:var(--fill-petal)">${tsvg("align")}</span><div><b>Line it up</b><span>Align view lays the original under the vector so you can nudge parts into place</span></div></div>
      <div class="tour-row"><span class="tile" style="background:var(--track-strong)">${tsvg("click")}</span><div><b>Right-click for options</b><span>On Export, the canvas, a part, or the zoom level</span></div></div>
    </div>`;
  return `<h3 id="tourTitle">Ready when you are.</h3>
    <p class="lead">Pick the format Export uses. You can change it later from the menu beside Export.</p>
    <div class="tour-list" role="radiogroup" aria-label="Export format">${Object.keys(FORMATS).map(f => {
      const off = !NATIVE && (f === "pdf" || f === "eps"), b = $(`#exportMenu [data-fmt="${f}"] small`);
      return `<button type="button" class="tour-opt" role="radio" data-tf="${f}" aria-checked="${fmtNow() === f}"${off ? " disabled" : ""}><b>${FORMATS[f]}${f === "svg" ? '<span class="rec">Recommended</span>' : ""}</b><span>${esc(off ? "In the Mac app" : (b ? b.textContent.replace(/ In the Mac app\.$/, "") : ""))}</span></button>`; }).join("")}</div>`;
}
function renderTour(dir) {
  const t = $("#tour"); if (!t) return;
  $("#tourLabel").textContent = TOUR_LABELS[tourStep];
  $("#tourCount").textContent = `${String(tourStep + 1).padStart(2, "0")} / ${String(TOUR_LABELS.length).padStart(2, "0")}`;
  const body = $("#tourBody"); body.innerHTML = `<div class="tour-step">${tourBody(tourStep)}</div>`;
  body.firstElementChild.style.setProperty("--dx", (dir < 0 ? -24 : 24) + "px");
  $("#tourBack").textContent = tourStep === 0 ? "Skip the tour" : "Back";
  $("#tourNext").querySelector(".inner").textContent = tourStep === 0 ? "Get started" : tourStep === TOUR_LABELS.length - 1 ? "Start using Vectorize" : "Continue";
  t.setAttribute("aria-labelledby", "tourTitle");
}
function openTour() {
  closeCtx(); if (!$("#exportMenu").hidden) openExportMenu(false);
  let t = $("#tour"); if (t) t.remove();
  t = document.createElement("div"); t.className = "modal tour"; t.id = "tour"; t.setAttribute("role", "dialog"); t.setAttribute("aria-modal", "true");
  t.innerHTML = `<div class="tour-card">
    <div class="tour-head"><i class="dia" aria-hidden="true"></i><span id="tourLabel"></span><i class="gt-rule" aria-hidden="true"></i><span id="tourCount"></span></div>
    <div class="tour-body" id="tourBody"></div>
    <div class="tour-foot"><button type="button" class="link-btn" id="tourBack"></button><span class="spacer"></span><button type="button" class="btn btn-dark" id="tourNext" data-press><span class="inner"></span></button></div></div>`;
  document.body.appendChild(t);
  tourStep = 0; renderTour(1);
  t._back = document.activeElement;
  $("#tourNext").focus({ preventScroll: true });
  $("#tourNext").onclick = () => { if (tourStep === TOUR_LABELS.length - 1) closeTour(); else { tourStep++; renderTour(1); } };
  $("#tourBack").onclick = () => { if (tourStep === 0) closeTour(); else { tourStep--; renderTour(-1); } };
  t.addEventListener("click", e => {
    const p = e.target.closest("[data-tp]"), f = e.target.closest("[data-tf]");
    if (p) { const b = $(`.preset[data-preset="${p.dataset.tp}"]`); if (b && S.preset !== p.dataset.tp) b.click(); t.querySelectorAll("[data-tp]").forEach(x => x.setAttribute("aria-checked", String(x === p))); }
    if (f && !f.disabled) { S.exportFormat = f.dataset.tf; if (NATIVE) NATIVE.remember("exportFormat", S.exportFormat); syncEditorControls(); t.querySelectorAll("[data-tf]").forEach(x => x.setAttribute("aria-checked", String(x === f))); }
  });
  t.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeTour(); return; }
    if (e.key === "Tab") {                                   // keep focus inside the tour
      const f = [...t.querySelectorAll("button:not(:disabled)")], i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
    e.stopPropagation();                                     // the editor's shortcuts stay off while the tour is open
  });
}
function closeTour() {
  const t = $("#tour"); if (!t) return;
  markTourSeen(); const back = t._back; t.remove();
  if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
}
$("#showTour").onclick = openTour;
// The web preview decides after the first paint; the Mac app decides once it has read its settings (initNative).
setTimeout(() => { if (!window.pywebview) maybeShowTour(); }, 900);

/* ---------- Fine-tune: show points while a dial moves ---------- */
// While you drag a Fine-tune dial (or step it from the keyboard, or press Grow or Shrink), the vector switches to
// thin outlines with every anchor point marked, so Curves, Corners, and Straight edges show their effect as
// points appearing and disappearing. It returns to normal a moment after the new trace lands.
const ANCHOR_ARGS = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
// The anchor points of a path's d: the end point of every segment (a closing Z adds none).
function anchorsOf(d, out, cap) {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0;
  while (i < toks.length && out.length < cap) {
    if (/[a-zA-Z]/.test(toks[i])) { cmd = toks[i++]; if (cmd === "Z" || cmd === "z") { x = sx; y = sy; continue; } }
    const U = cmd.toUpperCase(), n = ANCHOR_ARGS[U]; if (!n) { i++; continue; }
    const a = toks.slice(i, i + n).map(Number); i += n; if (a.length < n) break;
    const rel = cmd !== U;
    if (U === "H") x = rel ? x + a[0] : a[0];
    else if (U === "V") y = rel ? y + a[0] : a[0];
    else { x = rel ? x + a[n - 2] : a[n - 2]; y = rel ? y + a[n - 1] : a[n - 1]; }
    if (U === "M") { sx = x; sy = y; cmd = rel ? "l" : "L"; }   // more pairs after M are line-tos
    out.push([x, y]);
  }
  return out;
}
// Points in an SVG string (the footer count): path end points, plus 4 for each circle, ellipse, or rect.
function anchorCount(svg) {
  let n = 0;
  for (const m of svg.matchAll(/\sd="([^"]*)"/g)) n += anchorsOf(m[1], [], 1e7).length;
  n += 4 * ((svg.match(/<(circle|ellipse|rect)\b/g) || []).length);
  for (const m of svg.matchAll(/<poly(?:gon|line)\b[^>]*\spoints="([^"]*)"/g)) n += Math.floor(m[1].trim().split(/[\s,]+/).length / 2);
  return n;
}
function drawAnchors() {
  const svg = $("#vec svg"); if (!svg) return;
  svg.querySelectorAll(".anchors").forEach(g => g.remove());
  const vb = svg.viewBox.baseVal, px = svg.getBoundingClientRect().width; if (!px || !vb || !vb.width) return;
  const u = vb.width / px, r = 2.25 * u, pts = [];
  const num = (el, k) => +el.getAttribute(k) || 0;
  for (const p of svg.querySelectorAll(":is(path,polygon,polyline,circle,ellipse,rect):not(.sel):not(.hl):not(.thl):not(.ohl)")) {
    if (p.closest("defs, clipPath, mask, .anchors")) continue;
    const tag = p.tagName.toLowerCase(); let loc;
    if (tag === "path") { const d = p.getAttribute("d"); if (!d) continue; loc = anchorsOf(d, [], 20000 - pts.length); }
    else if (tag === "polygon" || tag === "polyline") { const v = (p.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number); loc = []; for (let k = 0; k + 1 < v.length; k += 2) loc.push([v[k], v[k + 1]]); }
    else if (tag === "rect") { const x = num(p, "x"), y = num(p, "y"), w = num(p, "width"), h = num(p, "height"); if (!w || !h) continue; loc = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
    else { const cx = num(p, "cx"), cy = num(p, "cy"), rx = tag === "circle" ? num(p, "r") : num(p, "rx"), ry = tag === "circle" ? rx : num(p, "ry"); loc = [[cx + rx, cy], [cx, cy + ry], [cx - rx, cy], [cx, cy - ry]]; }
    const m = p.transform && p.transform.baseVal.consolidate();   // parts moved in Align or drawn with a transform
    for (const q of loc) pts.push(m ? [m.matrix.a * q[0] + m.matrix.c * q[1] + m.matrix.e, m.matrix.b * q[0] + m.matrix.d * q[1] + m.matrix.f] : q);
    if (pts.length >= 20000) break;
  }
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.setAttribute("class", "anchors"); g.setAttribute("aria-hidden", "true");
  g.innerHTML = pts.map(q => `<rect x="${(q[0] - r).toFixed(2)}" y="${(q[1] - r).toFixed(2)}" width="${(2 * r).toFixed(2)}" height="${(2 * r).toFixed(2)}"/>`).join("");
  svg.appendChild(g);
}
let tuneShow = null;   // { dial, held, until }
function tuneStart(dial) {
  clearTimeout(tuneShow && tuneShow.t);
  document.querySelectorAll(".dial.tuning").forEach(d => d.classList.remove("tuning"));
  tuneShow = { dial, held: true, t: 0 };
  if (dial) dial.classList.add("tuning");
  $("#vec").classList.add("tuning"); drawAnchors();
}
function tuneRelease(delay) {
  if (!tuneShow) return;
  tuneShow.held = false; clearTimeout(tuneShow.t);
  tuneShow.t = setTimeout(tuneEnd, delay);                 // a retrace landing restarts this (afterTuneRender)
}
function tuneEnd() {
  if (!tuneShow || tuneShow.held) return;
  clearTimeout(tuneShow.t); if (tuneShow.dial) tuneShow.dial.classList.remove("tuning"); tuneShow = null;
  $("#vec").classList.remove("tuning"); const svg = $("#vec svg"); if (svg) svg.querySelectorAll(".anchors").forEach(g => g.remove());
}
function afterTuneRender() {
  if (!tuneShow) return;
  drawAnchors();
  if (!tuneShow.held) { clearTimeout(tuneShow.t); tuneShow.t = setTimeout(tuneEnd, 1200); }
}
const DIAL_IDS = ["detail", "straight", "smooth", "corners"];
for (const id of DIAL_IDS) {
  const el = $("#" + id), dial = el.closest(".dial");
  el.addEventListener("pointerdown", () => tuneStart(dial));
  el.addEventListener("keydown", e => { if (/^(Arrow|Page|Home|End)/.test(e.key)) { tuneStart(dial); tuneRelease(1600); } });
}
for (const id of ["growMinus", "growPlus"]) $("#" + id).addEventListener("click", () => { tuneStart($("#" + id).closest(".dial")); tuneRelease(1600); });
document.addEventListener("pointerup", () => { if (tuneShow && tuneShow.held) tuneRelease(1600); });
document.addEventListener("pointercancel", () => { if (tuneShow && tuneShow.held) tuneRelease(400); });
window.addEventListener("resize", () => { if (tuneShow) drawAnchors(); });
