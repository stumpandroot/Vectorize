/* ==========================================================================
   Editor: layers, selection, undo, zoom, export formats, separations, batch,
   output presets, and the Mac app's native features. The same file runs in
   the web preview; native features switch on when the Mac app is detected.
   ========================================================================== */
const BUY_URL = "https://greenlaunch.co";
let NATIVE = null, APP = null, LIC = { enabled: false, licensed: true };
let downloads = null;

/* ---------- Document state ---------- */
let drawOrder = null;          // layer hexes, bottom to top, once you reorder
let deletedLayers = new Set(); // layer hexes
let objEdits = [];             // hidden or deleted parts: { hex, box, act: "hide" | "delete" }
let selection = [];            // [{ li, ii }]
let partMode = "all";          // "all" | "art" (icon) | "text" (words)
let expanded = new Set();      // layer hexes open in the Layers list
let outlines = false, tool = "select", spaceDown = false;
let pendingUseShape = null;

function resetDoc() {
  drawOrder = null; deletedLayers = new Set(); objEdits = []; selection = []; partMode = "all"; expanded = new Set();
  pendingUseShape = null; undoStack = []; undoKey = null;
}
const itemBox = it => it.box || (it.box = bboxOf(it.outer.q));
function setSelection(list) { selection = list; sel = list.length === 1 ? list[0] : null; }

// After every trace: carry edits over to the new colors, then hide and delete parts again.
function afterTrace() {
  const hexes = result.layers.map(L => L.hex), labs = hexes.map(h => rgb2lab(...fromHex(h)));
  const near = h => {
    if (hexes.includes(h)) return h;
    const a = rgb2lab(...fromHex(h)); let best = null, bd = 12 * 12;
    labs.forEach((l, i) => { const d = d2(a, l); if (d < bd) { bd = d; best = hexes[i]; } });
    return best;
  };
  const rec = {}; for (const [k, v] of Object.entries(recolor)) { const n = near(k); if (n && !(n in rec)) rec[n] = v; } recolor = rec;
  const mapSet = s => new Set([...s].map(near).filter(Boolean));
  hidden = mapSet(hidden); deletedLayers = mapSet(deletedLayers); expanded = mapSet(expanded);
  if (drawOrder) drawOrder = [...new Set(drawOrder.map(near).filter(Boolean))];
  for (const e of objEdits) e.hex = near(e.hex) || e.hex;
  if (pendingUseShape) { for (const k of Object.keys(pendingUseShape)) if (k in useShape) useShape[k] = pendingUseShape[k]; pendingUseShape = null; }
  applyObjEdits();
  autoFonts();
}

/* ---------- Words: read them on the Mac and set them in the matching font ---------- */
// A font swaps in on its own only when its letters cover the word this closely (intersection over union).
const AUTO_FONT_MIN = 0.86;
let ocrSeq = 0;
async function autoFonts() {
  if (!NATIVE || !APP || !APP.ocr || !result || S.textMode === "off") return;
  const res = result, seq = ++ocrSeq;
  const swapped = await matchWords(res, job, () => seq !== ocrSeq || result !== res);
  if (swapped === null || seq !== ocrSeq || result !== res) return;
  render();
  if (swapped.length) toast(`Set ${swapped.length === 1 ? swapped[0] : swapped.length + " words in matching fonts"}. Choose Traced in the Text tab to undo.`);
}
// Reads the words in job j with Apple Vision and sets each one in its matching font when the match is
// strong. Words you've already changed are left alone. Returns what it swapped, or null when cancelled.
async function matchWords(res, j, stale = () => false) {
  const todo = (res.texts || []).filter(T => !T.removed && !memFor(T));
  if (!todo.length) return [];
  if (!j.ocr) {
    let r = null; try { r = await NATIVE.recognize_text(j.srcURL); } catch (e) { console.error(e); }
    j.ocr = r && r.lines ? r.lines : [];
  }
  if (stale()) return null;
  const words = j.ocr.flatMap(l => l.words.map(w => ({ text: w.text, x0: w.box[0] * res.w, x: (w.box[0] + w.box[2] / 2) * res.w, y: (w.box[1] + w.box[3] / 2) * res.h })));
  const swapped = [];
  for (const T of todo) {
    const pad = 0.35 * (T.box[3] - T.box[1]);
    const mine = words.filter(w => w.x >= T.box[0] - pad && w.x <= T.box[2] + pad && w.y >= T.box[1] - pad && w.y <= T.box[3] + pad).sort((a, b) => a.x0 - b.x0);
    if (!mine.length) continue;
    T.text = mine.map(w => w.text).join(" ");
    try {
      const { results } = await matchFonts(T, T.text);
      if (stale()) return null;
      T.results = results;
      const c = results[0];
      if (c && c.iou >= AUTO_FONT_MIN) { T.pick = c; T.repl = fontText(T, c); T.mode = "font"; T.auto = true; swapped.push(`${T.text} in ${fontLabel(c)}`); }
    } catch (e) { console.error(e); }
    remember(T);
  }
  return swapped;
}
function applyObjEdits() {
  if (!result) return;
  const tol = 0.02 * Math.max(result.w, result.h);
  for (const L of result.layers) for (const it of L.items) it.off = null;
  for (const e of objEdits) {
    let best = null, bd = Infinity;
    for (const L of result.layers) for (const it of L.items) {
      const b = itemBox(it); let d = 0; for (let i = 0; i < 4; i++) d = Math.max(d, Math.abs(b[i] - e.box[i]));
      if (d < tol) { const dd = d + (L.hex === e.hex ? 0 : tol); if (dd < bd) { bd = dd; best = it; } }
    }
    if (best) best.off = e.act;
  }
}
function setItemOff(li, ii, act) {
  const L = result.layers[li], it = L.items[ii], b = itemBox(it);
  objEdits = objEdits.filter(e => !e.box.every((v, i) => Math.abs(v - b[i]) < 0.5));
  if (act) objEdits.push({ hex: L.hex, box: b.slice(), act });
  it.off = act || null;
}

/* ---------- Undo ---------- */
let undoStack = [], undoKey = null, undoAt = 0;
function tracingS() { const o = { ...S }; delete o.exportFormat; return o; }
const settingsKey = () => JSON.stringify([tracingS(), locked]);
function editState() {
  return JSON.parse(JSON.stringify({ recolor, hidden: [...hidden], useShape, manualSnaps, textMemory, objEdits, drawOrder, deletedLayers: [...deletedLayers], partMode }));
}
function applyEditState(st) {
  recolor = { ...st.recolor }; hidden = new Set(st.hidden); manualSnaps = st.manualSnaps.map(m => ({ ...m }));
  textMemory = st.textMemory.map(m => ({ ...m })); objEdits = st.objEdits.map(e => ({ ...e }));
  drawOrder = st.drawOrder ? st.drawOrder.slice() : null; deletedLayers = new Set(st.deletedLayers); partMode = st.partMode || "all";
}
function pushUndo(key) {
  if (!result) return;
  const now = Date.now();
  // Repeated changes to one control (a slider drag, typing a hex) make one undo step.
  if (key && key === undoKey && now - undoAt < 1500) { undoAt = now; return; }
  undoKey = key || null; undoAt = now;
  undoStack.push({ S: tracingS(), locked: locked.slice(), ...editState() });
  if (undoStack.length > 60) undoStack.shift();
}
function undo() {
  const st = undoStack.pop();
  if (!st) { toast("Nothing to undo."); return; }
  undoKey = null;
  const retrace = JSON.stringify([st.S, st.locked, st.manualSnaps, st.textMemory]) !== JSON.stringify([tracingS(), locked, manualSnaps, textMemory]);
  Object.assign(S, st.S); locked.splice(0, locked.length, ...st.locked);
  applyEditState(st); setSelection([]); syncControls();
  if (retrace) { pendingUseShape = st.useShape; convert(); }
  else { useShape = { ...st.useShape }; applyObjEdits(); render(); }
  toast("Undone.");
}

/* ---------- Layers panel ---------- */
const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.3 9.3a1 1 0 0 1 1.4 0L12 11.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-3 3a1 1 0 0 1-1.4 0l-3-3a1 1 0 0 1 0-1.4z"/></svg>';
const TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4a1 1 0 0 1 0-2h4V4a1 1 0 0 1 1-1zm-1.9 4 .9 12h8l.9-12z"/></svg>';
const OBJ_LIMIT = 120;
function wordOf(li, ii) { return (result.texts || []).find(T => !T.removed && T.li === li && T.items.includes(ii)); }
function itemLabel(li, ii) {
  const it = result.layers[li].items[ii], T = wordOf(li, ii);
  if (T) return T.text.trim() ? `Letter in “${T.text.trim()}”` : "Letter";
  const s = it.outer.shape; return s && useShape[s.id] ? s.label : "Outline";
}
function renderPalette() {
  const top = orderedLayers(true).slice().reverse(), byHex = new Map(result.palette.map(p => [p.hex, p]));
  const rows = top.filter(L => !deletedLayers.has(L.hex)).map(L => {
    const li = result.layers.indexOf(L), p = byHex.get(L.hex) || { hex: L.hex }, now = recolor[L.hex] || L.hex, off = hidden.has(L.hex), open = expanded.has(L.hex);
    const live = L.items.filter(it => it.off !== "delete"), nHid = live.filter(it => it.off === "hide").length, nDel = L.items.length - live.length;
    const sub = recolor[L.hex] ? `was ${L.hex} · <button type="button" data-reset="${L.hex}">Reset</button>` : p.lock ? "Locked brand color" : `${colorName(now)} · ${live.length} ${live.length === 1 ? "part" : "parts"}${nHid ? ` · ${nHid} hidden` : ""}`;
    let more = "";
    if (open) {
      const objs = []; L.items.forEach((it, ii) => { if (it.off !== "delete") objs.push(ii); });
      const n = {}; const rowsO = objs.slice(0, OBJ_LIMIT).map(ii => {
        const lab = itemLabel(li, ii); n[lab] = (n[lab] || 0) + 1; const it = L.items[ii], k = `${li}:${ii}`, hid = it.off === "hide", on = selection.some(s => s.li === li && s.ii === ii);
        return `<div class="obj-row${hid ? " off" : ""}${on ? " on" : ""}" data-obj="${k}"><span>${esc(lab)} ${n[lab]}</span>
          <button type="button" class="pal-act sm" data-oeye="${k}" aria-pressed="${!hid}" aria-label="${hid ? "Show" : "Hide"} ${esc(lab)} ${n[lab]}">${hid ? EYE_OFF : EYE}</button>
          <button type="button" class="pal-act sm" data-odel="${k}" aria-label="Delete ${esc(lab)} ${n[lab]}">${TRASH}</button></div>`;
      });
      more = `<div class="pal-more">
        <div class="row wrap"><button type="button" class="link-btn" data-pickfor="${L.hex}">Take color from image</button><button type="button" class="link-btn" data-lsel="${li}">Select all ${live.length}</button>
        ${nHid ? `<button type="button" class="link-btn" data-lshow="${li}">Show ${nHid} hidden</button>` : ""}${nDel ? `<button type="button" class="link-btn" data-lrestore="${li}">Restore ${nDel} deleted</button>` : ""}
        <button type="button" class="link-btn danger" data-ldel="${L.hex}">Delete layer</button></div>
        <div class="obj-list">${rowsO.join("")}${objs.length > OBJ_LIMIT ? `<p class="help">And ${objs.length - OBJ_LIMIT} more. Drag a box around parts in the vector to select them.</p>` : ""}${!objs.length ? '<p class="help">Every part of this layer is deleted.</p>' : ""}</div></div>`;
    }
    return `<div class="layer${open ? " open" : ""}" data-layer="${L.hex}"><div class="pal-row${off ? " off" : ""}" data-c="${L.hex}">
      <button type="button" class="pal-grip" data-grip="${L.hex}" title="Drag to reorder" aria-label="Move the ${esc(colorName(now))} layer. Use the up and down arrow keys.">${GRIP}</button>
      <label class="pal-sw" style="background:${now}" title="Choose a color"><input type="color" value="${now.toLowerCase()}" data-c="${L.hex}" aria-label="Choose a new color for ${now}"></label>
      <span class="pal-txt"><input class="pal-hex" id="hex-${L.hex.slice(1)}" value="${now}" data-c="${L.hex}" maxlength="7" spellcheck="false" aria-label="Hex value for ${now}"><small>${sub}</small></span>
      <button type="button" class="pal-act" data-eye="${L.hex}" aria-pressed="${!off}" title="${off ? "Show" : "Hide"}" aria-label="${off ? "Show" : "Hide"} ${now}">${off ? EYE_OFF : EYE}</button>
      <button type="button" class="pal-act chev" data-more="${L.hex}" aria-expanded="${open}" title="Parts and actions" aria-label="${open ? "Close" : "Open"} the ${esc(colorName(now))} layer">${CHEVRON}</button></div>${more}</div>`;
  });
  const bg = result.palette.find(p => p.bg && S.bg === "remove");
  if (bg) rows.push(`<div class="layer"><div class="pal-row off"><span class="pal-grip" aria-hidden="true"></span><span class="pal-sw" style="background:${bg.hex}"></span><span class="pal-txt"><input class="pal-hex" value="${bg.hex}" readonly aria-label="Background color ${bg.hex}"><small>Background, removed</small></span></div></div>`);
  const del = top.filter(L => deletedLayers.has(L.hex));
  if (del.length) rows.push(`<div class="deleted-row"><span class="help">Deleted:</span>${del.map(L => `<button type="button" class="lock-chip restore" data-lundel="${L.hex}" title="Restore"><i style="background:${recolor[L.hex] || L.hex}"></i>${esc(colorName(recolor[L.hex] || L.hex))} ↺</button>`).join("")}</div>`);
  $("#palette").innerHTML = rows.join("") || '<p class="help">Convert an image to see its layers.</p>';
  $("#lockList").innerHTML = locked.map(c => `<span class="lock-chip"><i style="background:${c}"></i>${c}<button type="button" data-unlock="${c}" aria-label="Unlock ${c}">×</button></span>`).join("") || '<span class="help">No locked colors.</span>';
}
function renderParts() {
  const words = (result.texts || []).some(T => !T.removed);
  if (!words && partMode !== "all") partMode = "all";
  $("#partsGroup").hidden = !words;
  document.querySelectorAll("[data-part]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.part === partMode)));
}
document.querySelectorAll("[data-part]").forEach(b => b.addEventListener("click", () => { if (partMode === b.dataset.part) return; pushUndo(); partMode = b.dataset.part; setSelection([]); render(); }));

function topHexes() { return orderedLayers(true).map(L => L.hex).reverse(); }
function moveLayer(hex, toIdx) {
  const list = topHexes(), from = list.indexOf(hex); if (from < 0) return;
  toIdx = Math.max(0, Math.min(list.length - 1, toIdx)); if (toIdx === from) return;
  pushUndo(); list.splice(from, 1); list.splice(toIdx, 0, hex); drawOrder = list.reverse(); render();
  const g = $(`[data-grip="${hex}"]`); if (g) g.focus();
}
$("#palette").addEventListener("click", e => {
  const mo = e.target.closest("[data-more]"); if (mo) { const h = mo.dataset.more; expanded.has(h) ? expanded.delete(h) : expanded.add(h); renderPalette(); return; }
  const ld = e.target.closest("[data-ldel]"); if (ld) { pushUndo(); deletedLayers.add(ld.dataset.ldel); expanded.delete(ld.dataset.ldel); setSelection([]); render(); toast(`Deleted the ${colorName(recolor[ld.dataset.ldel] || ld.dataset.ldel)} layer. Undo or restore it below the list.`); return; }
  const lu = e.target.closest("[data-lundel]"); if (lu) { pushUndo(); deletedLayers.delete(lu.dataset.lundel); render(); return; }
  const ls = e.target.closest("[data-lsel]"); if (ls) { const li = +ls.dataset.lsel; setSelection(result.layers[li].items.map((it, ii) => ({ li, ii })).filter(k => !result.layers[li].items[k.ii].off)); if (view === "original") setView("vector"); drawSelection(); renderPalette(); return; }
  const sh = e.target.closest("[data-lshow]"); if (sh) { pushUndo(); const li = +sh.dataset.lshow; result.layers[li].items.forEach((it, ii) => { if (it.off === "hide") setItemOff(li, ii, null); }); render(); return; }
  const lr = e.target.closest("[data-lrestore]"); if (lr) { pushUndo(); const li = +lr.dataset.lrestore; result.layers[li].items.forEach((it, ii) => { if (it.off === "delete") setItemOff(li, ii, null); }); render(); return; }
  const oe = e.target.closest("[data-oeye]"); if (oe) { pushUndo(); const [li, ii] = oe.dataset.oeye.split(":").map(Number), it = result.layers[li].items[ii]; setItemOff(li, ii, it.off === "hide" ? null : "hide"); render(); return; }
  const od = e.target.closest("[data-odel]"); if (od) { pushUndo(); const [li, ii] = od.dataset.odel.split(":").map(Number); setItemOff(li, ii, "delete"); render(); return; }
  const or = e.target.closest("[data-obj]"); if (or) { const [li, ii] = or.dataset.obj.split(":").map(Number); if (result.layers[li].items[ii].off) return; setSelection([{ li, ii }]); if (view === "original") setView("vector"); drawSelection(); renderPalette(); }
});
$("#palette").addEventListener("mouseover", e => { const o = e.target.closest("[data-obj]"); outlineHover(o ? o.dataset.obj : null); });
$("#palette").addEventListener("mouseleave", () => outlineHover(null));
function outlineHover(k) {
  const svg = $("#vec svg"); if (!svg) return; const old = svg.querySelector(".ohl"); if (old) old.remove(); if (!k) return;
  const [li, ii] = k.split(":").map(Number), it = result.layers[li] && result.layers[li].items[ii]; if (!it || it.off) return;
  svg.appendChild(hlPath("ohl", itemD(it), 2.5));
}
// Reorder by dragging the grip, or with the arrow keys.
(() => {
  let drag = null;
  const pal = $("#palette");
  const clear = () => pal.querySelectorAll(".drop-before,.drop-after").forEach(n => n.classList.remove("drop-before", "drop-after"));
  const target = y => {
    const rows = [...pal.querySelectorAll(".layer[data-layer]")];
    for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return { i, el: rows[i], before: true }; }
    return rows.length ? { i: rows.length - 1, el: rows[rows.length - 1], before: false } : null;
  };
  pal.addEventListener("pointerdown", e => { const g = e.target.closest("[data-grip]"); if (!g || e.button !== 0) return; e.preventDefault(); drag = { hex: g.dataset.grip, id: e.pointerId, moved: false }; try { g.setPointerCapture(e.pointerId); } catch { /* synthetic events */ } g.closest(".layer").classList.add("dragging"); });
  pal.addEventListener("pointermove", e => { if (!drag || e.pointerId !== drag.id) return; drag.moved = true; clear(); const t = target(e.clientY); if (t) t.el.classList.add(t.before ? "drop-before" : "drop-after"); });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; clear(); pal.querySelectorAll(".dragging").forEach(n => n.classList.remove("dragging"));
    if (!d.moved || e.type === "pointercancel") return;
    const t = target(e.clientY); if (!t) return;
    const list = topHexes(), from = list.indexOf(d.hex); let to = t.before ? t.i : t.i + 1; if (from < to) to--;
    moveLayer(d.hex, to);
  };
  pal.addEventListener("pointerup", end); pal.addEventListener("pointercancel", end);
  pal.addEventListener("keydown", e => {
    const g = e.target.closest("[data-grip]"); if (!g || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault(); const list = topHexes(); moveLayer(g.dataset.grip, list.indexOf(g.dataset.grip) + (e.key === "ArrowUp" ? -1 : 1));
  });
})();

/* ---------- Selection ---------- */
function hlPath(cls, d, w) {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "path");
  g.setAttribute("class", cls); g.setAttribute("d", d); g.setAttribute("fill", "none"); g.setAttribute("fill-rule", "evenodd"); g.setAttribute("stroke", "#E0218A");
  g.setAttribute("stroke-width", String(w)); g.setAttribute("vector-effect", "non-scaling-stroke"); g.setAttribute("pointer-events", "none");
  return g;
}
function liveItem(k) { const L = result && result.layers[k.li], it = L && L.items[k.ii]; return it && !it.off && !hidden.has(L.hex) && !deletedLayers.has(L.hex) ? it : null; }
function drawSelection() {
  const svg = $("#vec svg"); if (svg) svg.querySelectorAll(".sel").forEach(n => n.remove());
  setSelection(selection.filter(liveItem));
  const bar = $("#snapBar"), n = selection.length;
  bar.hidden = !n || view === "original";
  if (!n) return;
  if (svg) svg.appendChild(hlPath("sel", selection.slice(0, 400).map(k => itemD(liveItem(k))).join(""), 3));
  const single = n === 1, it = single && selItem();
  $("#snapChips").hidden = !single; $("#selText").hidden = !(single && wordOf(sel.li, sel.ii));
  if (single) {
    const L = result.layers[sel.li], s = it.outer.shape, on = s && useShape[s.id];
    $("#snapTitle").textContent = `${colorName(recolor[L.hex] || L.hex)} ${wordOf(sel.li, sel.ii) ? "letter" : "outline"}`;
    $("#snapNote").textContent = on ? `${s.label} · ${s.match.toFixed(1)}% match` : "Traced. Snap it to a shape:";
    $("#snapChips").innerHTML = SNAPS.filter(([k]) => k !== "ring" || it.holes.length).map(([k, label]) =>
      `<button type="button" class="snap-chip" data-snap="${k}" aria-pressed="${!!(on && (s.kind === k || (k === "pill" && s.label === "Pill") || (k === "rounded_rect" && s.kind === k && s.label !== "Pill")))}"><svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH[k]}</svg>${label}</button>`).join("")
      + `<button type="button" class="snap-chip" data-snap="traced" aria-pressed="${!on}">Traced</button>`
      + `<button type="button" class="snap-chip" data-snap="text"><svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH.text}</svg>Text</button>`;
  } else {
    const cols = new Set(selection.map(k => result.layers[k.li].hex));
    $("#snapTitle").textContent = `${n.toLocaleString()} parts`;
    $("#snapNote").textContent = `${cols.size} ${cols.size === 1 ? "color" : "colors"}. Shift-click to add or remove parts.`;
  }
}
function selectAll() {
  if (!result || view === "original") return;
  const out = []; for (const L of visibleLayers()) { const li = result.layers.indexOf(L); L.items.forEach((it, ii) => { if (!it.off) out.push({ li, ii }); }); }
  setSelection(out); drawSelection(); renderPalette();
}
function clearSelection() { setSelection([]); drawSelection(); renderPalette(); }
$("#snapClose").onclick = clearSelection;
function selAct(act) {
  if (!selection.length) { toast("Select parts first: click one, Shift-click more, or drag a box around them."); return; }
  if (act === "export") { exportSelection(); return; }
  if (act === "text") { const T = wordOf(sel.li, sel.ii); if (T) { textSel = T.id; openTab("text"); renderTexts(); highlightText(T.id); const i = $(`#tx-${T.id}`); if (i) i.focus(); } return; }
  pushUndo();
  const n = selection.length;
  if (act === "keep") {
    const keep = new Set(selection.map(k => k.li + ":" + k.ii)); let c = 0;
    for (const L of visibleLayers()) { const li = result.layers.indexOf(L); L.items.forEach((it, ii) => { if (!it.off && !keep.has(li + ":" + ii)) { setItemOff(li, ii, "hide"); c++; } }); }
    render(); toast(`Hid ${c.toLocaleString()} other ${c === 1 ? "part" : "parts"}. Show them again in Layers.`); return;
  }
  for (const k of selection) setItemOff(k.li, k.ii, act === "hide" ? "hide" : "delete");
  setSelection([]); render();
  toast(`${act === "hide" ? "Hid" : "Deleted"} ${n.toLocaleString()} ${n === 1 ? "part" : "parts"}.${act === "hide" ? " Show them again in Layers." : " Press ⌘Z to undo."}`);
}
$("#snapBar").addEventListener("click", e => { const b = e.target.closest("[data-sel]"); if (b) selAct(b.dataset.sel); });

/* ---------- Pointer on the canvas: select, marquee, and pan ---------- */
(() => {
  const stage = $("#stage"); let ptr = null;
  const toWork = (cx, cy) => { const r = $("#sheet").getBoundingClientRect(); return [(cx - r.left) / r.width * result.w, (cy - r.top) / r.height * result.h]; };
  stage.addEventListener("pointerdown", e => {
    if (!job || picking || (e.button !== 0 && e.button !== 1)) return;
    if (e.target.closest(".snapbar, .split, .pick-hint, .busy, button, input, a")) return;
    const panning = tool === "hand" || spaceDown || e.button === 1;
    ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, panning, start: pan.slice(), moved: false, shift: e.shiftKey, target: e.target };
    try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    if (panning) { stage.classList.add("panning"); e.preventDefault(); }
  });
  stage.addEventListener("pointermove", e => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
    if (!ptr.moved && Math.hypot(dx, dy) < 4) return;
    ptr.moved = true;
    if (ptr.panning) { pan = [ptr.start[0] + dx, ptr.start[1] + dy]; applyZoom(); return; }
    if (!result || view === "original") return;
    const sr = stage.getBoundingClientRect(), m = $("#marquee");
    m.hidden = false; m.style.left = (Math.min(e.clientX, ptr.x) - sr.left) + "px"; m.style.top = (Math.min(e.clientY, ptr.y) - sr.top) + "px";
    m.style.width = Math.abs(dx) + "px"; m.style.height = Math.abs(dy) + "px";
  });
  const end = e => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const p = ptr; ptr = null; stage.classList.remove("panning"); $("#marquee").hidden = true;
    if (p.panning || e.type === "pointercancel" || !result) return;
    if (p.moved) {
      if (view === "original") return;
      // Parts fully inside the box are selected.
      const a = toWork(Math.min(p.x, e.clientX), Math.min(p.y, e.clientY)), b = toWork(Math.max(p.x, e.clientX), Math.max(p.y, e.clientY));
      const found = []; for (const L of visibleLayers()) { const li = result.layers.indexOf(L); L.items.forEach((it, ii) => { if (it.off) return; const q = itemBox(it); if (q[0] >= a[0] && q[1] >= a[1] && q[2] <= b[0] && q[3] <= b[1]) found.push({ li, ii }); }); }
      const keys = new Set(selection.map(k => k.li + ":" + k.ii));
      setSelection(p.shift ? selection.concat(found.filter(k => !keys.has(k.li + ":" + k.ii))) : found);
      drawSelection(); renderPalette(); return;
    }
    if (view === "original") return;
    const tw = p.target.closest && p.target.closest("[data-t]");
    if (tw && !p.shift) { setSelection([]); drawSelection(); textSel = +tw.dataset.t; openTab("text"); renderTexts(); highlightText(textSel); const c = $(`.text-card[data-tid="${textSel}"]`); if (c) c.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
    const t = p.target.closest && p.target.closest("[data-k]");
    if (!t) { if (!p.shift) clearSelection(); return; }
    const [li, ii] = t.dataset.k.split(":").map(Number);
    if (p.shift) { const i = selection.findIndex(k => k.li === li && k.ii === ii); setSelection(i >= 0 ? selection.filter((_, j) => j !== i) : selection.concat([{ li, ii }])); }
    else setSelection([{ li, ii }]);
    drawSelection(); renderPalette();
  };
  stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
})();

/* ---------- Zoom and pan ---------- */
let zoom = 1, pan = [0, 0], fitScale = 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function maxZoom() { return Math.max(1, Math.min(16 / fitScale, 20000 / (Math.max(job.origW, job.origH) * fitScale))); }
function applyZoom() {
  if (!job) return;
  const sh = $("#sheet"), a = $(".art").getBoundingClientRect(), w = job.origW * fitScale * zoom, h = job.origH * fitScale * zoom;
  sh.style.width = Math.max(1, Math.round(w)) + "px"; sh.style.height = Math.max(1, Math.round(h)) + "px";
  const mx = Math.max(0, (w - a.width) / 2), my = Math.max(0, (h - a.height) / 2);
  pan = [clamp(pan[0], -mx, mx), clamp(pan[1], -my, my)];
  sh.style.transform = `translate(calc(-50% + ${pan[0].toFixed(1)}px), calc(-50% + ${pan[1].toFixed(1)}px))`;
  $("#zoomPct").textContent = Math.round(fitScale * zoom * 100) + "%";
  $("#stage").classList.toggle("zoomed", zoom > 1.001);
}
function fitView() { zoom = 1; pan = [0, 0]; layoutSheet(); }
function zoomAt(f, cx, cy) {
  if (!job) return;
  const a = $(".art").getBoundingClientRect(), c0 = [a.left + a.width / 2, a.top + a.height / 2];
  const z2 = clamp(zoom * f, 0.5, maxZoom()); if (Math.abs(z2 - zoom) < 1e-4) return;
  if (cx == null) { cx = c0[0]; cy = c0[1]; }
  const lx = (cx - c0[0] - pan[0]) / zoom, ly = (cy - c0[1] - pan[1]) / zoom;
  pan = [cx - c0[0] - z2 * lx, cy - c0[1] - z2 * ly]; zoom = z2; applyZoom();
}
const zoomTo = z => zoomAt(z / zoom);
$("#zoomIn").onclick = () => zoomAt(1.5);
$("#zoomOut").onclick = () => zoomAt(1 / 1.5);
$("#zoomFit").onclick = fitView;
$("#zoomPct").onclick = () => zoomTo(1 / fitScale);   // actual size
$("#stage").addEventListener("wheel", e => {
  if (!job) return;
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY); return; }   // pinch, or ⌘-scroll
  if (zoom <= 1.001) return;   // at fit size, scrolling scrolls the page
  e.preventDefault(); pan = [pan[0] - e.deltaX, pan[1] - e.deltaY]; applyZoom();
}, { passive: false });
// Safari and the Mac app report trackpad pinches as gesture events.
let gz = 1;
$("#stage").addEventListener("gesturestart", e => { e.preventDefault(); gz = 1; });
$("#stage").addEventListener("gesturechange", e => { e.preventDefault(); zoomAt(e.scale / gz, e.clientX, e.clientY); gz = e.scale; });
$("#stage").addEventListener("gestureend", e => e.preventDefault());

function setTool(t) { tool = t; $("#stage").classList.toggle("hand", t === "hand"); document.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === t))); }
document.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
function toggleOutlines() { outlines = !outlines; $("#vec").classList.toggle("outlines", outlines); if (outlines && view === "original") setView("vector"); syncEditorControls(); }
$("#outlinesBtn").onclick = toggleOutlines;

/* ---------- Export ---------- */
const FORMATS = { svg: "SVG", pdf: "PDF", eps: "EPS", png: "PNG" };
const fmtNow = () => (!NATIVE && (S.exportFormat === "pdf" || S.exportFormat === "eps")) ? "svg" : (FORMATS[S.exportFormat] ? S.exportFormat : "svg");
const stemOf = name => (name || "").replace(/\.[^.]+$/, "").replace(/[^\w\- ]+/g, "").trim() || "vectorized";
const sleep = ms => new Promise(r => setTimeout(r, ms));
function gate() { if (!LIC.enabled || LIC.licensed) return true; openLicense("Activate Vectorize to export. You can keep converting and editing without a license."); return false; }
async function svgToPng(svg) {
  const m = svg.match(/<svg[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/), w0 = m ? +m[1] : 1024, h0 = m ? +m[2] : 1024;
  // At least 2,000 px on the long side, at most 8,000.
  const k = clamp(2000 / Math.max(w0, h0), 1, 8000 / Math.max(w0, h0)), W = Math.round(w0 * k), H = Math.round(h0 * k);
  const im = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
  const c = document.createElement("canvas"); c.width = W; c.height = H; c.getContext("2d").drawImage(im, 0, 0, W, H);
  return c.toDataURL("image/png");
}
async function makeItem(svg, name, fmt) {
  if (fmt === "png") return { name, format: "png", data: await svgToPng(svg), encoding: "base64" };
  return { name, format: fmt, svg, title: name };
}
function b64ToBytes(d) { const s = atob(d.split(",").pop()), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
async function blobToB64(blob) { const b = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
async function webSave(filename, data) {
  if (downloads) {
    try { await downloads.save({ filename, data }); return "saved"; }
    catch (err) { if (err && err.code === "declined") return "declined"; }
  }
  if (window.top === window) {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data])), a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    return "saved";
  }
  if (typeof data === "string") { try { await navigator.clipboard.writeText(data); return "copied"; } catch { /* fall through */ } }
  return "failed";
}
async function saveItem(item) {
  if (NATIVE) {
    const r = await NATIVE.save_file(item);
    if (!r) return null;
    if (r.error) { toast(r.error); return null; }
    toast(`Saved ${r.name}.`); return r;
  }
  const fn = `${item.name}.${item.format}`, how = await webSave(fn, item.format === "png" ? new Blob([b64ToBytes(item.data)], { type: "image/png" }) : item.svg);
  if (how === "saved") toast(`Saved ${fn}.`);
  else if (how === "copied") toast("Copied the SVG code. Paste it into a file or your design app.");
  else if (how === "failed") toast("This view can't save files. Open the page in your browser to export.");
  return how === "saved" ? { name: fn } : null;
}
async function saveMany(items, folderName) {
  if (NATIVE) {
    const folder = await NATIVE.choose_folder(); if (!folder) return;
    const r = await NATIVE.save_many(folder, items, folderName);
    if (r.error) { toast(r.error); return; }
    toast(`Saved ${r.count} files to the folder “${r.folder.split("/").pop()}”.`); NATIVE.reveal(r.folder); return;
  }
  const used = new Set(), files = items.map(it => {
    let n = `${it.name}.${it.format}`, i = 2; while (used.has(n)) n = `${it.name} ${i++}.${it.format}`; used.add(n);
    return { name: `${folderName}/${n}`, data: it.format === "png" ? b64ToBytes(it.data) : it.svg };
  });
  const how = await webSave(`${folderName}.zip`, makeZip(files));
  if (how === "saved") toast(`Saved ${folderName}.zip with ${items.length} files.`);
  else if (how !== "declined") toast("This view can't save files. Open the page in your browser to export.");
}
async function doExport() {
  if (!result || !visibleLayers().length || !gate()) return;
  const fmt = fmtNow(), svg = buildSVG(false, { part: partMode });
  await saveItem(await makeItem(svg, stemOf(job.name) + (partMode === "art" ? " icon" : partMode === "text" ? " words" : ""), fmt));
  if (batch && batch.cur >= 0) { batch.items[batch.cur].status = "Exported"; renderBatch(); }
}
async function exportSelection() {
  if (!result) return;
  if (!selection.length) { toast("Select parts first: click one, Shift-click more, or drag a box around them."); return; }
  if (!gate()) return;
  const svg = buildSVG(false, { part: partMode, only: new Set(selection.map(k => k.li + ":" + k.ii)), crop: true });
  if (!svg) { toast("Nothing in the selection to export."); return; }
  await saveItem(await makeItem(svg, stemOf(job.name) + " selection", fmtNow()));
}
async function exportSeparations() {
  if (!result || !gate()) return;
  if (S.layering !== "cutout") {
    pushUndo(); S.layering = "cutout"; syncControls(); toast("Switched Layers to Cut out, so no color prints under another.");
    const done = convertDone(); convert(); await done;
  }
  const layers = visibleLayers(); if (!layers.length) return;
  const stem = stemOf(job.name), fmt = fmtNow(), items = [];
  setStatus("working", "Making separations");
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i], fill = recolor[L.hex] || L.hex;
    // Every file keeps the full canvas so the separations line up.
    const svg = buildSVG(false, { part: partMode, layers: [L] }); if (!svg) continue;
    items.push(await makeItem(svg, `${stem} ${String(i + 1).padStart(2, "0")} ${colorName(fill)} ${fill.slice(1)}`, fmt));
  }
  setStatus("done", `${items.length} separations`);
  await saveMany(items, `${stem} separations`);
}
$("#exportBtn").onclick = doExport;
// Format menu
function openExportMenu(open) {
  const m = $("#exportMenu"), b = $("#exportMenuBtn"); open = open == null ? m.hidden : open;
  m.hidden = !open; b.setAttribute("aria-expanded", String(open));
  if (open) { const f = m.querySelector('[aria-checked="true"]') || m.querySelector("button:not(:disabled)"); if (f) f.focus(); }
}
$("#exportMenuBtn").onclick = e => { e.stopPropagation(); openExportMenu(); };
$("#exportMenu").addEventListener("click", e => {
  const f = e.target.closest("[data-fmt]");
  if (f && !f.disabled) { S.exportFormat = f.dataset.fmt; if (NATIVE) NATIVE.remember("exportFormat", S.exportFormat); syncEditorControls(); openExportMenu(false); return; }
  const a = e.target.closest("[data-xact]"); if (!a) return; openExportMenu(false);
  if (a.dataset.xact === "selection") exportSelection(); else if (a.dataset.xact === "separations") exportSeparations();
});
document.addEventListener("pointerdown", e => { if (!$("#exportMenu").hidden && !e.target.closest("#exportMenu, #exportMenuBtn")) openExportMenu(false); });
$("#exportMenu").addEventListener("keydown", e => {
  const items = [...$("#exportMenu").querySelectorAll("button:not(:disabled)")], i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
  if (e.key === "Escape") { openExportMenu(false); $("#exportMenuBtn").focus(); }
});

/* ---------- Send to Versa ---------- */
async function sendToVersa() {
  if (!result || !visibleLayers().length || !gate()) return;
  const { name, files } = versaPackage(), zip = makeZip(files), fname = `${name.replace(/[^\w\- ]+/g, "").trim() || "Logo"} for Versa.zip`;
  if (NATIVE) {
    const r = await NATIVE.send_to_versa(fname, await blobToB64(zip));
    if (!r) return;
    if (r.error) toast(r.error);
    else if (r.opened) toast("Opened in Versa.");
    else toast(`Saved ${r.name}. Open it in Versa to make the logo kit.`);
    return;
  }
  const how = await webSave(fname, zip);
  if (how === "saved") toast(`Saved ${fname}. Open it in Versa to make the logo kit.`);
  else if (how !== "declined") toast("This view can't save files. Open the page in your browser to send to Versa.");
}
$("#versaBtn").onclick = sendToVersa;

/* ---------- Files in: one image, or several as a batch ---------- */
function readFile(f) {
  return new Promise(res => { const rd = new FileReader(); rd.onload = () => res({ src: rd.result, name: f.name, meta: `${/png$/i.test(f.type || f.name) ? "PNG" : "JPEG"} · ${(f.size / 1024).toFixed(0)} KB` }); rd.onerror = () => res(null); rd.readAsDataURL(f); });
}
async function takeFiles(list) {
  list = [...(list || [])]; if (!list.length) return;
  const ok = list.filter(f => /^image\/(png|jpeg)$/.test(f.type) || /\.(png|jpe?g)$/i.test(f.name));
  if (!ok.length) { toast("Vectorize opens PNG and JPEG files. Export your image as one of those and try again."); return; }
  if (ok.length < list.length) toast(`Skipped ${list.length - ok.length} ${list.length - ok.length === 1 ? "file that isn't" : "files that aren't"} PNG or JPEG.`);
  openItems((await Promise.all(ok.map(readFile))).filter(Boolean));
}
function openItems(items) {
  if (!items.length) return;
  if (items.length === 1) { openImage(items[0].src, items[0].name, items[0].meta); return; }
  startBatch(items);
}
async function chooseImages() {
  if (!NATIVE) { $("#file").click(); return; }
  const r = await NATIVE.open_images(); if (!r || !r.length) return;
  const bad = r.filter(x => x.error); if (bad.length) toast(bad[0].error);
  openItems(r.filter(x => !x.error).map(x => ({ src: x.dataUrl, name: x.name, meta: `${/\.png$/i.test(x.name) ? "PNG" : "JPEG"} · ${Math.round(x.dataUrl.length * 0.75 / 1024)} KB` })));
}
$("#addBtn").onclick = chooseImages;
$("#file").onchange = e => { takeFiles(e.target.files); e.target.value = ""; };
let dragDepth = 0;
window.addEventListener("dragenter", e => { e.preventDefault(); dragDepth++; $("#stage").classList.add("dragging"); });
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#stage").classList.remove("dragging"); } });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => { e.preventDefault(); dragDepth = 0; $("#stage").classList.remove("dragging"); takeFiles(e.dataTransfer.files); });
window.addEventListener("paste", e => { const it = [...(e.clipboardData?.items || [])].find(i => /^image\/(png|jpeg)$/.test(i.type)); if (it) takeFiles([it.getAsFile()]); });

/* ---------- Batch: the same settings for many images; edits stay with each image ---------- */
let batch = null;   // { items: [{ src, name, meta, job, state, svgOut, sKey, status }], cur }
async function startBatch(items) {
  batch = { items: items.map(it => ({ ...it, job: null, state: null, svgOut: null, sKey: null, status: "Not opened" })), cur: -1 };
  await showBatchItem(0);
  toast(`${items.length} images open. Settings apply to all of them; edits stay with each image.`);
}
function stashCurrent() {
  if (!batch || batch.cur < 0 || !result) return;
  const it = batch.items[batch.cur]; it.state = editState(); it.svgOut = buildSVG(false, { part: partMode }); it.sKey = settingsKey();
  const st = it.state, edited = Object.keys(st.recolor).length || st.hidden.length || st.objEdits.length || st.manualSnaps.length || st.textMemory.length || st.drawOrder || st.deletedLayers.length || st.partMode !== "all";
  if (it.status !== "Exported") it.status = edited ? "Edited" : "Viewed";
}
async function showBatchItem(i) {
  const it = batch && batch.items[i]; if (!it || i === batch.cur) return;
  stashCurrent();
  if (!it.job) it.job = await makeJob(it.src, it.name, it.meta);
  if (!it.job) { it.status = "Couldn't open"; renderBatch(); toast(`Vectorize couldn't read ${it.name}.`); return; }
  batch.cur = i; showJob(it.job);
  if (it.state) { applyEditState(it.state); pendingUseShape = it.state.useShape; }
  renderBatch();
}
function leaveBatch() { batch = null; renderBatch(); }
function renderBatch() {
  $("#batch").hidden = !batch; if (!batch) return;
  $("#batchCount").textContent = `${batch.items.length} images`;
  $("#batchList").innerHTML = batch.items.map((it, i) => `<button type="button" class="batch-item" data-bi="${i}" aria-current="${i === batch.cur}" title="${esc(it.name)}"><img src="${it.src}" alt=""><span><b>${esc(it.name)}</b><small>${i === batch.cur ? "Open now" : esc(it.status)}</small></span></button>`).join("");
}
$("#batchList").addEventListener("click", e => { const b = e.target.closest("[data-bi]"); if (b) showBatchItem(+b.dataset.bi); });
$("#batchClose").onclick = () => { leaveBatch(); toast("Closed the batch. The open image stays."); };
// Traces another image with the current settings and its own saved edits, sets its words in their
// fonts, runs fn, then puts everything back. The screen doesn't redraw while it runs.
async function withJob(j, st, fn) {
  const keep = { job, result, useShape, recolor, hidden, manualSnaps, textMemory, objEdits, drawOrder, deletedLayers, sel, selection, textSel, partMode };
  renderPaused = true;
  try {
    job = j; useShape = {}; recolor = {}; hidden = new Set(); manualSnaps = []; textMemory = []; objEdits = []; drawOrder = null; deletedLayers = new Set(); selection = []; sel = null; textSel = null; partMode = "all";
    const fontMems = st ? st.textMemory.filter(m => m.mode === "font" && m.pick && m.text) : [];
    // Fonts are applied below and awaited, so setupText leaves those words traced for now.
    if (st) { applyEditState(st); textMemory = textMemory.map(m => m.mode === "font" ? { ...m, mode: "original" } : m); }
    result = traceNow(); if (!result) return null;
    reapplyManual(); setupText();
    if (st) for (const k of Object.keys(st.useShape)) if (k in useShape) useShape[k] = st.useShape[k];
    applyObjEdits();
    for (const T of result.texts || []) {
      const m = fontMems.find(f => boxIoU(f.box, T.box) > 0.6); if (!m || T.removed) continue;
      T.text = m.text;
      try {
        const { results } = await matchFonts(T, T.text);
        const c = results.find(r => r.fam === m.pick.fam && r.w === m.pick.w) || results[0];
        if (c) { T.pick = c; T.repl = fontText(T, c); T.mode = "font"; }
      } catch (e) { console.error(e); }
    }
    if (NATIVE && APP && APP.ocr && S.textMode !== "off") await matchWords(result, j);
    return fn();
  } finally {
    ({ job, result, useShape, recolor, hidden, manualSnaps, textMemory, objEdits, drawOrder, deletedLayers, sel, selection, textSel, partMode } = keep);
    renderPaused = false;
  }
}
async function exportAll() {
  if (!batch) { toast("Open two or more images at once to export them together."); return; }
  if (!gate()) return;
  stashCurrent();
  const fmt = fmtNow(), key = settingsKey(), out = [], n = batch.items.length;
  $("#batchExport").disabled = true;
  try {
    for (let i = 0; i < n; i++) {
      const it = batch.items[i];
      setStatus("working", `Exporting ${i + 1} of ${n}`); await sleep(30);
      let svg = it.svgOut && it.sKey === key ? it.svgOut : null;
      if (!svg) {
        if (!it.job) it.job = await makeJob(it.src, it.name, it.meta);
        if (!it.job) { it.status = "Couldn't open"; continue; }
        if (S.bg === "ai" && !it.job.cutImgd) await makeCutout(it.job);
        svg = await withJob(it.job, it.state, () => buildSVG(false, { part: partMode }));
      }
      if (!svg) continue;
      out.push(await makeItem(svg, stemOf(it.name), fmt)); it.status = "Exported";
    }
    setStatus("done", `Exported ${out.length} of ${n}`);
    await saveMany(out, `Vectorize ${out.length} images`);
  } finally { $("#batchExport").disabled = false; render(); autoFonts(); }
}
$("#batchExport").onclick = exportAll;

/* ---------- Made for: output presets ---------- */
const OUTPUTS = {
  screen: { label: "Screen print", set: { layering: "cutout", bg: "remove", cmode: "auto", maxAuto: 6, detail: 60, smooth: 55, snap: true }, format: "pdf", help: "Cut-out colors, six inks at most. Export color separations for one film per ink." },
  vinyl: { label: "Vinyl cut", set: { layering: "cutout", bg: "remove", cmode: "auto", maxAuto: 6, detail: 45, smooth: 65, snap: true }, format: "eps", help: "Cut-out colors and no tiny specks, so every piece weeds cleanly." },
  laser: { label: "Laser engrave", set: { layering: "cutout", bg: "remove", cmode: "bw", detail: 70, smooth: 55, snap: true }, format: "svg", help: "One color in black, ready for engraving software." },
  web: { label: "Web icon", set: { layering: "stacked", bg: "remove", cmode: "auto", maxAuto: 8, detail: 60, smooth: 60, snap: true, shapes: "auto" }, format: "svg", help: "Stacked colors and smooth curves for a small, clean SVG." },
};
function applyOutput(id, quiet) {
  const o = OUTPUTS[id]; if (!o) return;
  if (!quiet) pushUndo();
  Object.assign(S, o.set, { output: id });
  if (S.bg === "remove" && APP && APP.cutout && S.preset === "photo") S.bg = "ai";
  S.exportFormat = NATIVE || o.format === "svg" ? o.format : "svg";
  if (NATIVE) { NATIVE.remember("lastPreset", id); NATIVE.remember("exportFormat", S.exportFormat); }
  syncControls(); convert();
  if (!quiet) toast(`Set up for ${o.label.toLowerCase()}. Export saves ${FORMATS[S.exportFormat]}.`);
}
document.querySelectorAll("[data-output]").forEach(b => b.addEventListener("click", () => applyOutput(b.dataset.output)));
document.querySelectorAll("[data-layering]").forEach(b => b.addEventListener("click", () => { if (S.layering === b.dataset.layering) return; pushUndo(); S.layering = b.dataset.layering; syncControls(); convert(); }));
document.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", () => { S.output = ""; syncEditorControls(); }));

function syncEditorControls() {
  document.querySelectorAll("[data-layering]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.layering === S.layering)));
  $("#layHelp").textContent = S.layering === "cutout" ? "Each color is only its own area, with no overlap. Best for vinyl, screen printing, and separations." : "Colors sit on top of each other with no gaps between them. Best for screens and most design work.";
  document.querySelectorAll("[data-output]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.output === S.output)));
  $("#outHelp").textContent = S.output ? OUTPUTS[S.output].help : "Pick what it's for, and Vectorize sets the options below.";
  $("#bg-ai").hidden = !(APP && APP.cutout);
  const f = fmtNow(); $("#exportLabel").textContent = `Export ${FORMATS[f]}`;
  document.querySelectorAll("[data-fmt]").forEach(b => { b.setAttribute("aria-checked", String(b.dataset.fmt === f)); b.disabled = !NATIVE && (b.dataset.fmt === "pdf" || b.dataset.fmt === "eps"); });
  $("#outlinesBtn").setAttribute("aria-pressed", String(outlines));
}

/* ---------- AI cutout (Mac app, macOS 14 and later) ---------- */
async function makeCutout(j) {
  if (!NATIVE || !APP || !APP.cutout) return false;
  setStatus("working", "Removing background");
  try {
    const r = await NATIVE.remove_background(j.srcURL);
    if (!r || r.error) { console.warn(r && r.error); return false; }
    const im = await loadImage(r.dataUrl);
    j.cutImgd = rasterize(im, j.workW, j.workH, j.scale);
    return true;
  } catch (e) { console.error(e); return false; }
}

/* ---------- License (Mac app) ---------- */
function openLicense(why) {
  const m = $("#licModal"); m.hidden = false;
  const done = LIC.licensed && LIC.enabled;
  $("#licForm").hidden = done; $("#licDone").hidden = !done;
  $("#licText").textContent = done ? "" : why || "Enter the license key from your purchase email. Activating needs the internet once; after that, Vectorize works offline.";
  $("#licEmail").textContent = LIC.email ? `Licensed to ${LIC.email}.` : "This Mac is activated.";
  $("#licMsg").textContent = "";
  setTimeout(() => { const i = done ? $("#licDeact") : $("#licKey"); if (i) i.focus(); }, 30);
}
function closeLicense() { $("#licModal").hidden = true; }
async function activate() {
  const key = $("#licKey").value.trim(); if (!key) { $("#licMsg").textContent = "Paste your license key first."; return; }
  $("#licGo").disabled = true; $("#licMsg").textContent = "Activating…";
  try {
    const r = await NATIVE.activate(key);
    $("#licMsg").textContent = r.message || "";
    if (r.ok) { LIC = await NATIVE.license_status(); toast(r.message); closeLicense(); }
  } finally { $("#licGo").disabled = false; }
}
async function deactivate() {
  if (!NATIVE) return;
  const r = await NATIVE.deactivate(); LIC = await NATIVE.license_status(); toast(r.message || "Deactivated."); closeLicense();
}
$("#licGo").onclick = activate;
$("#licKey").addEventListener("keydown", e => { if (e.key === "Enter") activate(); });
$("#licClose").onclick = closeLicense; $("#licClose2").onclick = closeLicense;
$("#licBuy").onclick = () => { if (NATIVE) NATIVE.open_url(BUY_URL); else window.open(BUY_URL, "_blank", "noopener"); };
$("#licDeact").onclick = deactivate;
$("#licModal").addEventListener("keydown", e => { if (e.key === "Escape") closeLicense(); });
$("#licModal").addEventListener("pointerdown", e => { if (e.target === $("#licModal")) closeLicense(); });

/* ---------- Menu commands and keyboard ---------- */
const typingIn = el => el && el.closest && el.closest("input:not([type=range]):not([type=checkbox]):not([type=color]), textarea, [contenteditable=true]");
// The Mac menus call VZ_MENU. A shortcut the page already handled can also reach the menu,
// so a menu call that repeats the same shortcut within a moment is skipped.
let lastKeyCmd = { cmd: "", t: 0 };
window.VZ_MENU = cmd => {
  if (cmd === lastKeyCmd.cmd && performance.now() - lastKeyCmd.t < 500) return;
  runCommand(cmd);
};
function runCommand(cmd) {
  const typing = typingIn(document.activeElement);
  switch (cmd) {
    case "open": chooseImages(); break;
    case "export": doExport(); break;
    case "exportSelection": exportSelection(); break;
    case "separations": exportSeparations(); break;
    case "exportAll": exportAll(); break;
    case "versa": sendToVersa(); break;
    case "undo": if (typing) document.execCommand("undo"); else undo(); break;
    case "selectAll": if (typing) typing.select && typing.select(); else selectAll(); break;
    case "deselect": clearSelection(); break;
    case "hide": selAct("hide"); break;
    case "delete": selAct("delete"); break;
    case "view:compare": case "view:original": case "view:vector": if (picking) endPick(); setView(cmd.slice(5)); break;
    case "outlines": toggleOutlines(); break;
    case "fit": fitView(); break;
    case "zoomIn": zoomAt(1.5); break;
    case "zoomOut": zoomAt(1 / 1.5); break;
    case "actual": if (job) zoomTo(1 / fitScale); break;
    case "license": openLicense(); break;
    case "deactivate": deactivate(); break;
  }
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (picking) { endPick(); return; }
    if (!$("#exportMenu").hidden) { openExportMenu(false); return; }
    if (!$("#licModal").hidden) return;
    if (!typingIn(e.target) && selection.length) { clearSelection(); return; }
  }
  if (typingIn(e.target) || !$("#licModal").hidden) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  const run = cmd => { e.preventDefault(); lastKeyCmd = { cmd, t: performance.now() }; runCommand(cmd); };
  if (mod && !e.altKey) {
    if (k === "z" && !e.shiftKey) return run("undo");
    if (k === "o") return run("open");
    if (k === "e") return run(e.shiftKey ? "exportSelection" : "export");
    if (k === "a") return run("selectAll");
    if (k === "0") return run("fit");
    if (k === "1") return run("actual");
    if (k === "=" || k === "+") return run("zoomIn");
    if (k === "-") return run("zoomOut");
    return;
  }
  if (e.altKey || e.target.closest && e.target.closest("button, select, [role=slider]") && (k === " " || k === "enter")) return;
  if (k === "v") setTool("select");
  else if (k === "h") setTool("hand");
  else if ((k === "backspace" || k === "delete") && selection.length) { e.preventDefault(); selAct("delete"); }
  else if (k === " " && !e.repeat && job) { e.preventDefault(); spaceDown = true; $("#stage").classList.add("hand"); }
});
document.addEventListener("keyup", e => { if (e.key === " " && spaceDown) { spaceDown = false; $("#stage").classList.toggle("hand", tool === "hand"); } });

/* ---------- The Mac app ---------- */
async function initNative() {
  if (NATIVE || !(window.pywebview && window.pywebview.api && window.pywebview.api.app_info)) return;
  NATIVE = window.pywebview.api;
  try { APP = await NATIVE.app_info(); } catch (e) { APP = { cutout: false, settings: {} }; }
  document.documentElement.classList.add("native");
  document.title = "Vectorize";
  $("#badge").hidden = true;
  $("#setupNote").innerHTML = "<b>Everything runs on this Mac.</b> Your images never leave it. Font matching loads Google Fonts when you're online."
    + `<br><span class="build-tag">Vectorize ${esc(APP.version || "")} (build ${esc(APP.build || "dev")})</span>`;
  $("#file").removeAttribute("accept");
  const st = APP.settings || {};
  if (FORMATS[st.exportFormat]) S.exportFormat = st.exportFormat;
  if (OUTPUTS[st.lastPreset] && !S.output) applyOutput(st.lastPreset, true);
  syncControls(); if (result) renderTexts();
  try { LIC = await NATIVE.license_status(); } catch (e) { LIC = { enabled: false, licensed: true }; }
  if (LIC.enabled && !LIC.licensed) openLicense();
}
window.addEventListener("pywebviewready", initNative);

/* ---------- Start ---------- */
(async function start() {
  syncControls(); applyView(); setTool("select");
  openImage(await makeSample(), "Sample logo", "Example image · 360 × 360 JPEG");
  initNative();
  if (!NATIVE) { try { downloads = await window.claude?.use?.("downloads"); } catch { downloads = null; } }
})();
