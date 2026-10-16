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
