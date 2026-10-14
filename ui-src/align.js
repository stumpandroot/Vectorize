/* ==========================================================================
   Align view: put every part exactly where it is in the original.
   The original sits under the vector (onion skin) or mismatches show in red
   (difference). Drag parts, nudge them with the arrow keys, or let Align to
   original find the best fit. Rulers, guides, align buttons, and snap lines
   help place things exactly. Offsets are stored per part (moves) and go into
   every export.
   ========================================================================== */
// var, not let: app.js and editor.js call these hooks while the page is still loading, before this file runs.
var alignReady = false, alignMode = "onion", vecOpacity = 0.6, diffTimer = 0, diffSeq = 0, alignBusy = false;
const SNAP_SCREEN_PX = 6;                                    // how close an edge must come to snap, on screen
const workPerOrig = () => result.w / job.origW;              // work pixels per original pixel
const fmtPx = v => { const r = Math.round(v * 100) / 100; return (Object.is(r, -0) ? 0 : r).toFixed(2).replace(/\.?0+$/, "") || "0"; };

/* ---------- Units: a letter in a font-swapped word moves with its word ---------- */
function unitsOf(keys) {
  const seen = new Set(), out = [];
  for (const k of keys) {
    if (seen.has(k.li + ":" + k.ii)) continue;
    const T = wordOf(k.li, k.ii), word = T && T.mode !== "original" && T.repl ? T : null;
    const ks = (word ? word.items.map(ii => ({ li: word.li, ii })) : [k]).filter(x => liveItem(x));
    ks.forEach(x => seen.add(x.li + ":" + x.ii));
    if (ks.length) out.push({ keys: ks, word });
  }
  return out;
}
const itemOf = k => result.layers[k.li].items[k.ii];
function unitBox(u) {
  if (u.word) {
    const [dx, dy] = offOf(itemOf(u.keys[0])), b = bboxOf(u.word.repl.flatMap(it => it.outer.q));
    return [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
  }
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const k of u.keys) { const q = movedBox(itemOf(k)); b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[2]); b[3] = Math.max(b[3], q[3]); }
  return b;
}
const unionBox = bs => bs.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
function allUnits() { const keys = []; for (const L of visibleLayers()) { const li = result.layers.indexOf(L); L.items.forEach((it, ii) => { if (!it.off) keys.push({ li, ii }); }); } return unitsOf(keys); }

/* ---------- Offsets ---------- */
function setOffset(k, dx, dy) {
  const L = result.layers[k.li], it = L.items[k.ii], b = itemBox(it), eps = 1e-3;
  dx = Math.round(dx * 1000) / 1000; dy = Math.round(dy * 1000) / 1000;
  moves = moves.filter(m => !(m.hex === L.hex && m.box.every((v, i) => Math.abs(v - b[i]) < 0.5)));
  if (Math.abs(dx) > eps || Math.abs(dy) > eps) moves.push({ hex: L.hex, box: b.slice(), dx, dy });
  it.dx = Math.abs(dx) > eps ? dx : 0; it.dy = Math.abs(dy) > eps ? dy : 0;
}
// Moves whole units by (ddx, ddy) work pixels; a word's letters all take the first letter's offset.
function moveUnits(units, ddx, ddy) {
  for (const u of units) { const [x, y] = offOf(itemOf(u.keys[0])); for (const k of u.keys) setOffset(k, x + ddx, y + ddy); }
}
function setUnitOffset(u, dx, dy) { for (const k of u.keys) setOffset(k, dx, dy); }

/* ---------- Align to original ---------- */
// Finds the shift (in work pixels, within 3 original pixels) that best lays the unit over its color in the
// original. Each covered pixel scores +1 on its own color, 0 under a color stacked above it (it's meant to
// hide there), and −1 anywhere else. Coarse grid, then single pixels, then a parabola for the last fraction.
async function bestShift(u) {
  const W = result.w, H = result.h, R = Math.max(2, Math.ceil(3 * workPerOrig()));
  const b = unitBox(u), x0 = Math.floor(b[0]) - 2, y0 = Math.floor(b[1]) - 2, ww = Math.ceil(b[2]) + 2 - x0, wh = Math.ceil(b[3]) + 2 - y0;
  if (ww < 2 || wh < 2) return null;
  const only = new Set(u.keys.map(k => k.li + ":" + k.ii));
  const svg = buildSVG(false, { only, noDest: true }); if (!svg) return null;
  const im = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="${ww}" height="${wh}" viewBox="${x0} ${y0} ${ww} ${wh}">`)));
  const c = document.createElement("canvas"); c.width = ww; c.height = wh; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0, ww, wh);
  const a = g.getImageData(0, 0, ww, wh).data;
  let px = [], py = [], pv = [], total = 0;
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) { const v = a[(y * ww + x) * 4 + 3] / 255; if (v > 0.02) { px.push(x0 + x); py.push(y0 + y); pv.push(v); total += v; } }
  if (!pv.length) return null;
  if (pv.length > 60000) { const st = Math.ceil(pv.length / 60000); px = px.filter((_, i) => i % st === 0); py = py.filter((_, i) => i % st === 0); pv = pv.filter((_, i) => i % st === 0); }
  const L = result.layers[u.keys[0].li], label = L.label, order = orderedLayers(), upper = new Set(S.layering === "cutout" ? [] : order.slice(order.indexOf(L) + 1).map(x => x.label));
  const lab = result.lab, wt = l => l === label ? 1 : upper.has(l) ? 0 : -1;
  const score = (dx, dy) => { let s = 0; for (let i = 0; i < pv.length; i++) { const x = px[i] + dx, y = py[i] + dy; s += pv[i] * (x < 0 || y < 0 || x >= W || y >= H ? -1 : wt(lab[y * W + x])); } return s; };
  const memo = new Map(), sc = (dx, dy) => { const k = dx + "," + dy; if (!memo.has(k)) memo.set(k, score(dx, dy)); return memo.get(k); };
  let best = [0, 0], bs = sc(0, 0); const s0 = bs;
  const step = Math.max(1, Math.floor(R / 3));
  for (let dy = -R; dy <= R; dy += step) for (let dx = -R; dx <= R; dx += step) { const v = sc(dx, dy); if (v > bs) { bs = v; best = [dx, dy]; } }
  for (let pass = 0; pass < 3; pass++) {
    const [cx, cy] = best;
    for (let dy = -step; dy <= step; dy++) for (let dx = -step; dx <= step; dx++) { if (Math.abs(cx + dx) > R || Math.abs(cy + dy) > R) continue; const v = sc(cx + dx, cy + dy); if (v > bs) { bs = v; best = [cx + dx, cy + dy]; } }
    if (best[0] === cx && best[1] === cy) break;
  }
  if (bs - s0 <= 0.003 * total) return [0, 0];              // already as good as it gets
  const para = (m, z, p) => { const den = m - 2 * z + p; return den < 0 ? Math.max(-0.5, Math.min(0.5, (m - p) / (2 * den))) : 0; };
  const [bx, by] = best;
  return [bx + para(sc(bx - 1, by), bs, sc(bx + 1, by)), by + para(sc(bx, by - 1), bs, sc(bx, by + 1))];
}
async function alignToOriginal() {
  if (!result || alignBusy) return;
  const units = selection.length ? unitsOf(selection) : allUnits(); if (!units.length) return;
  alignBusy = true; $("#alignOrig").disabled = true; pushUndo();
  let moved = 0;
  try {
    for (let i = 0; i < units.length; i++) {
      if (units.length > 8) setStatus("working", `Aligning ${i + 1} of ${units.length}`);
      const d = await bestShift(units[i]);
      if (d && (Math.abs(d[0]) > 0.02 || Math.abs(d[1]) > 0.02)) { moveUnits([units[i]], d[0], d[1]); moved++; }
    }
  } finally { alignBusy = false; $("#alignOrig").disabled = false; }
  setStatus("done", "Aligned"); render();
  const n = units.length;
  toast(moved ? `Moved ${moved} of ${n} ${n === 1 ? "part" : "parts"} to match the original. Press ⌘Z to undo.` : `${n === 1 ? "That part already matches" : "Every part already matches"} the original.`);
}

/* ---------- Align buttons ---------- */
function alignUnits(how) {
  const units = unitsOf(selection); if (units.length < 2) return;
  const boxes = units.map(unitBox), U = unionBox(boxes);
  pushUndo();
  units.forEach((u, i) => {
    const b = boxes[i]; let dx = 0, dy = 0;
    if (how === "left") dx = U[0] - b[0]; else if (how === "right") dx = U[2] - b[2]; else if (how === "hcenter") dx = (U[0] + U[2]) / 2 - (b[0] + b[2]) / 2;
    else if (how === "top") dy = U[1] - b[1]; else if (how === "bottom") dy = U[3] - b[3]; else if (how === "vmiddle") dy = (U[1] + U[3]) / 2 - (b[1] + b[3]) / 2;
    moveUnits([u], dx, dy);
  });
  render();
}
function resetPositions() {
  const units = selection.length ? unitsOf(selection) : allUnits();
  if (!units.some(u => u.keys.some(k => { const it = itemOf(k); return it.dx || it.dy; }))) return;
  pushUndo(); units.forEach(u => setUnitOffset(u, 0, 0)); render();
  toast(selection.length ? "Put the selection back where it was traced." : "Put every part back where it was traced.");
}
function nudge(dx, dy) {
  const units = unitsOf(selection); if (!units.length) return;
  pushUndo("nudge"); const k = workPerOrig(); moveUnits(units, dx * k, dy * k); render();
}

/* ---------- Dragging parts, with snap lines ---------- */
var dragAl = null;
function snapTargets(exclude) {
  const xs = [0, result.w / 2, result.w], ys = [0, result.h / 2, result.h];
  for (const u of allUnits()) { if (u.keys.some(k => exclude.has(k.li + ":" + k.ii))) continue; const b = unitBox(u); xs.push(b[0], (b[0] + b[2]) / 2, b[2]); ys.push(b[1], (b[1] + b[3]) / 2, b[3]); }
  for (const g of guides) (g.axis === "x" ? xs : ys).push(g.v);
  return { xs, ys };
}
function snapAxis(edges, targets, tol) {
  let best = null;
  for (const e of edges) for (const t of targets) { const d = t - e; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t }; }
  return best;
}
function drawSnapLines(lines) {
  const g = $("#guides"); g.querySelectorAll(".snapline").forEach(n => n.remove());
  for (const [axis, v] of lines) {
    const l = document.createElementNS("http://www.w3.org/2000/svg", "line"); l.setAttribute("class", "snapline");
    if (axis === "x") { l.setAttribute("x1", v); l.setAttribute("x2", v); l.setAttribute("y1", 0); l.setAttribute("y2", result.h); }
    else { l.setAttribute("y1", v); l.setAttribute("y2", v); l.setAttribute("x1", 0); l.setAttribute("x2", result.w); }
    g.appendChild(l);
  }
}
function partKeysAt(target) {
  const tk = target.closest && target.closest("[data-k]"), tt = target.closest && target.closest("[data-t]");
  if (tk) { const [li, ii] = tk.dataset.k.split(":").map(Number); return [{ li, ii }]; }
  if (tt) { const T = (result.texts || []).find(T => T.id === +tt.dataset.t); if (T) return T.items.map(ii => ({ li: T.li, ii })); }
  return null;
}
$("#stage").addEventListener("pointerdown", e => {
  // Clicking the canvas takes focus off buttons, so the arrow keys nudge parts.
  if (view === "align" && document.activeElement && document.activeElement !== document.body && !e.target.closest(".snapbar")) document.activeElement.blur();
  if (view !== "align" || !result || picking || e.button !== 0 || tool !== "select" || spaceDown) return;
  if (e.target.closest(".snapbar, .alignbar, .ruler, button, input")) return;
  const keys = partKeysAt(e.target); if (!keys) return;               // empty canvas: marquee as usual
  e.stopPropagation(); e.preventDefault();
  const has = k => selection.some(s => s.li === k.li && s.ii === k.ii);
  if (!keys.every(has)) { setSelection(e.shiftKey ? selection.concat(keys.filter(k => !has(k))) : keys); drawSelection(); renderPalette(); }
  else if (e.shiftKey) { setSelection(selection.filter(s => !keys.some(k => k.li === s.li && k.ii === s.ii))); drawSelection(); renderPalette(); return; }
  const units = unitsOf(selection), ex = new Set(units.flatMap(u => u.keys.map(k => k.li + ":" + k.ii)));
  dragAl = { id: e.pointerId, x: e.clientX, y: e.clientY, units, box: unionBox(units.map(unitBox)), targets: snapTargets(ex), d: [0, 0], moved: false };
  try { $("#stage").setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
}, true);
$("#stage").addEventListener("pointermove", e => {
  if (!dragAl || e.pointerId !== dragAl.id) return;
  const r = $("#sheet").getBoundingClientRect(), k = result.w / r.width;
  let dx = (e.clientX - dragAl.x) * k, dy = (e.clientY - dragAl.y) * k;
  if (!dragAl.moved && Math.hypot(e.clientX - dragAl.x, e.clientY - dragAl.y) < 3) return;
  dragAl.moved = true;
  const lines = [];
  if (!e.altKey) {                                           // hold Option to move without snapping
    const b = dragAl.box, tol = SNAP_SCREEN_PX * k;
    const sx = snapAxis([b[0] + dx, (b[0] + b[2]) / 2 + dx, b[2] + dx], dragAl.targets.xs, tol), sy = snapAxis([b[1] + dy, (b[1] + b[3]) / 2 + dy, b[3] + dy], dragAl.targets.ys, tol);
    if (sx) { dx += sx.d; lines.push(["x", sx.at]); }
    if (sy) { dy += sy.d; lines.push(["y", sy.at]); }
  }
  if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }   // Shift keeps the move level or upright
  dragAl.d = [dx, dy];
  drawSnapLines(lines);
  const svg = $("#vec svg"), t = `translate(${dx} ${dy})`;
  for (const u of dragAl.units) {
    for (const kk of u.keys) { const el = svg.querySelector(`[data-k="${kk.li}:${kk.ii}"]`); if (el) el.setAttribute("transform", t); }
    if (u.word) { const el = svg.querySelector(`[data-t="${u.word.id}"]`); if (el) el.setAttribute("transform", t); }
  }
  const hl = svg.querySelector(".sel"); if (hl) hl.setAttribute("transform", t);
  showReadout(dragAl.units, dx, dy);
});
const endAlignDrag = e => {
  if (!dragAl || e.pointerId !== dragAl.id) return;
  const d = dragAl; dragAl = null; drawSnapLines([]);
  if (d.moved && e.type !== "pointercancel" && (d.d[0] || d.d[1])) { pushUndo(); moveUnits(d.units, d.d[0], d.d[1]); }
  render();
};
$("#stage").addEventListener("pointerup", endAlignDrag);
$("#stage").addEventListener("pointercancel", endAlignDrag);

document.addEventListener("keydown", e => {
  if (view !== "align" || !result || !selection.length || typingIn(e.target) || e.metaKey || e.ctrlKey) return;
  if (e.target.closest && e.target.closest(".inspector, [role=slider], select, [role=tab]")) return;
  const step = e.shiftKey ? 1 : 0.1, m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!m) return;
  e.preventDefault(); nudge(...m);
});

/* ---------- The bar: overlay, readout, and buttons ---------- */
function showReadout(units, ddx = 0, ddy = 0) {
  const el = $("#alignNote"); if (!el) return;
  if (!units || !units.length) { el.textContent = alignMode === "diff" ? "Red marks where the vector is off from the original by more than about half a pixel. Select parts to move them." : "Select parts to move them. Drag, or nudge with the arrow keys (Shift for 1 px). Hold Option to drag without snapping."; return; }
  const k = 1 / workPerOrig(), [x, y] = offOf(itemOf(units[0].keys[0])), same = units.every(u => { const o = offOf(itemOf(u.keys[0])); return o[0] === x && o[1] === y; });
  const b = unitBox(units[0]);
  el.textContent = units.length === 1 || same
    ? `${units.length === 1 ? "Moved" : "Each moved"} ${fmtPx((x + ddx) * k)}, ${fmtPx((y + ddy) * k)} px from the trace · left ${fmtPx((b[0] + ddx) * k)}, top ${fmtPx((b[1] + ddy) * k)} px`
    : `${units.length} parts, moved by different amounts`;
}
function syncAlignBar() {
  const on = view === "align" && !!result; $("#alignBar").hidden = !on; if (!on) return;
  document.querySelectorAll("[data-amode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.amode === alignMode)));
  $("#vecOpacityRow").hidden = alignMode !== "onion"; $("#vecOpacity").value = Math.round(vecOpacity * 100); $("#vecOpacityOut").textContent = Math.round(vecOpacity * 100) + "%";
  const units = unitsOf(selection);
  document.querySelectorAll("[data-align]").forEach(b => b.disabled = units.length < 2);
  $("#alignOrig").innerHTML = `<span class="inner">${selection.length ? "Align selection to original" : "Align all to original"}</span>`;
  $("#resetPos").disabled = !moves.length; $("#clearGuides").hidden = !guides.length;
  showReadout(units);
}
document.querySelectorAll("[data-amode]").forEach(b => b.addEventListener("click", () => { alignMode = b.dataset.amode; applyView(); }));
$("#vecOpacity").addEventListener("input", e => { vecOpacity = +e.target.value / 100; $("#stage").style.setProperty("--vec-op", vecOpacity); $("#vecOpacityOut").textContent = e.target.value + "%"; });
$("#alignOrig").onclick = alignToOriginal;
$("#resetPos").onclick = resetPositions;
$("#clearGuides").onclick = () => { if (!guides.length) return; pushUndo(); guides = []; drawGuides(); syncAlignBar(); };
document.querySelectorAll("[data-align]").forEach(b => b.addEventListener("click", () => alignUnits(b.dataset.align)));

/* ---------- Difference overlay ---------- */
// Red where the vector and the original disagree by more than a pixel's worth of anti-aliasing.
async function drawDiff() {
  const c = $("#diffCanvas"); if (view !== "align" || alignMode !== "diff" || !result) return;
  const seq = ++diffSeq, W = result.w, H = result.h, svg = buildSVG(false, { noDest: true }); if (!svg) return;
  const im = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)));
  if (seq !== diffSeq) return;
  const bgp = result.palette.find(p => p.bg), bg = bgp ? fromHex(bgp.hex) : [255, 255, 255];
  const t = document.createElement("canvas"); t.width = W; t.height = H; const g = t.getContext("2d", { willReadFrequently: true });
  g.fillStyle = `rgb(${bg.join(",")})`; g.fillRect(0, 0, W, H); g.drawImage(im, 0, 0, W, H);
  const v = g.getImageData(0, 0, W, H).data, o = sourcePixels().data;
  const op = new Uint8ClampedArray(W * H * 3);   // the original over the same background
  for (let i = 0, j = 0; i < W * H; i++, j += 4) { const a = o[j + 3] / 255; for (let ch = 0; ch < 3; ch++) op[i * 3 + ch] = o[j + ch] * a + bg[ch] * (1 - a); }
  // Colors closer than this (RGB distance) count as the same; logo colors usually sit much farther apart.
  const out = new ImageData(W, H), d = out.data, TH2 = 40 * 40;
  const close = (i, j) => (op[i * 3] - v[j * 4]) ** 2 + (op[i * 3 + 1] - v[j * 4 + 1]) ** 2 + (op[i * 3 + 2] - v[j * 4 + 2]) ** 2 <= TH2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let ok = close(i, i);
    // A pixel only counts as wrong when no vector pixel next to it matches either.
    for (let yy = Math.max(0, y - 1); !ok && yy <= Math.min(H - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); !ok && xx <= Math.min(W - 1, x + 1); xx++) ok = close(i, yy * W + xx);
    const p = i * 4;
    if (ok) { const l = 0.2126 * op[i * 3] + 0.7152 * op[i * 3 + 1] + 0.0722 * op[i * 3 + 2]; const gv = 200 + l * 0.2; d[p] = d[p + 1] = d[p + 2] = gv; d[p + 3] = 255; }
    else { d[p] = 226; d[p + 1] = 32; d[p + 2] = 60; d[p + 3] = 255; }
  }
  c.width = W; c.height = H; c.getContext("2d").putImageData(out, 0, 0);
}

/* ---------- Rulers and guides ---------- */
function niceStep(pxPer) { for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) if (s * pxPer >= 56) return s; return 10000; }
function drawRulers(mouse) {
  if (!alignReady) return;
  const on = view === "align" && !!job && !!result;
  for (const id of ["rulerX", "rulerY", "rulerC"]) $("#" + id).hidden = !on;
  if (!on) return;
  const st = $("#stage").getBoundingClientRect(), sh = $("#sheet").getBoundingClientRect(), per = sh.width / job.origW, dpr = window.devicePixelRatio || 1;
  const step = niceStep(per), minor = step / (step * per >= 100 ? 10 : 5);
  const css = getComputedStyle($("#stage")), ink = css.getPropertyValue("--muted").trim() || "#5F5F74", bg = css.getPropertyValue("--surface").trim() || "#fff";
  const draw = (cv, horiz) => {
    const w = horiz ? st.width : 20, h = horiz ? 20 : st.height; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + "px"; cv.style.height = h + "px";
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 1; g.font = "600 9.5px " + (css.getPropertyValue("--font").trim() || "sans-serif");
    const o = horiz ? sh.left - st.left : sh.top - st.top, len = horiz ? w : h;
    const v0 = Math.floor(-o / per / minor) * minor;
    g.beginPath();
    for (let v = v0; o + v * per <= len; v += minor) {
      const p = Math.round(o + v * per) + 0.5, major = Math.abs(v / step - Math.round(v / step)) < 1e-6, t = major ? 20 : (Math.abs((v * 2 / step) - Math.round(v * 2 / step)) < 1e-6 ? 8 : 4);
      if (horiz) { g.moveTo(p, 20); g.lineTo(p, 20 - t); } else { g.moveTo(20, p); g.lineTo(20 - t, p); }
      if (major) { const lab = String(Math.round(v)); if (horiz) g.fillText(lab, p + 3, 9); else { g.save(); g.translate(9, p + 3); g.rotate(-Math.PI / 2); g.textAlign = "right"; g.fillText(lab, 0, 0); g.restore(); } }
    }
    g.stroke();
    if (mouse) { const p = horiz ? mouse[0] - st.left : mouse[1] - st.top; g.fillStyle = "#E0218A"; g.fillRect(horiz ? p - 0.5 : 0, horiz ? 0 : p - 0.5, horiz ? 1 : 20, horiz ? 20 : 1); }
  };
  draw($("#rulerX"), true); draw($("#rulerY"), false);
}
function drawGuides() {
  const svg = $("#guides"); if (!result) { svg.innerHTML = ""; return; }
  svg.setAttribute("viewBox", `0 0 ${result.w} ${result.h}`);
  svg.querySelectorAll(".guide").forEach(n => n.remove());
  svg.toggleAttribute("hidden", view !== "align");   // an SVG element has no .hidden property
  guides.forEach((gd, i) => {
    const mk = cls => { const l = document.createElementNS("http://www.w3.org/2000/svg", "line"); l.setAttribute("class", cls); l.dataset.guide = i;
      if (gd.axis === "x") { l.setAttribute("x1", gd.v); l.setAttribute("x2", gd.v); l.setAttribute("y1", -1e4); l.setAttribute("y2", 1e4); }
      else { l.setAttribute("y1", gd.v); l.setAttribute("y2", gd.v); l.setAttribute("x1", -1e4); l.setAttribute("x2", 1e4); } return l; };
    svg.appendChild(mk("guide guide-line")); svg.appendChild(mk("guide guide-hit"));
  });
}
// Drag from a ruler to make a guide; drag a guide back onto a ruler (or double-click it) to remove it.
var guideDrag = null;
function guideValue(e, axis) { const r = $("#sheet").getBoundingClientRect(); return axis === "x" ? (e.clientX - r.left) / r.width * result.w : (e.clientY - r.top) / r.height * result.h; }
function overRuler(e) { const st = $("#stage").getBoundingClientRect(); return e.clientY - st.top < 20 || e.clientX - st.left < 20; }
function startGuide(e, axis, idx) {
  e.preventDefault(); e.stopPropagation();
  if (idx == null) { guides.push({ axis, v: guideValue(e, axis) }); idx = guides.length - 1; guideDrag = { idx, isNew: true, before: null }; }
  else guideDrag = { idx, isNew: false, before: { ...guides[idx] } };
  guideDrag.id = e.pointerId; drawGuides();
}
$("#rulerX").addEventListener("pointerdown", e => { if (result) startGuide(e, "y"); });   // the top ruler makes level guides
$("#rulerY").addEventListener("pointerdown", e => { if (result) startGuide(e, "x"); });
$("#guides").addEventListener("pointerdown", e => { const l = e.target.closest(".guide-hit"); if (l) startGuide(e, guides[+l.dataset.guide].axis, +l.dataset.guide); });
$("#guides").addEventListener("dblclick", e => { const l = e.target.closest(".guide-hit"); if (!l) return; pushUndo(); guides.splice(+l.dataset.guide, 1); drawGuides(); syncAlignBar(); });
window.addEventListener("pointermove", e => {
  if (view === "align" && result && !guideDrag) drawRulers([e.clientX, e.clientY]);
  if (!guideDrag || e.pointerId !== guideDrag.id) return;
  const gd = guides[guideDrag.idx]; gd.v = Math.round(guideValue(e, gd.axis) * 100) / 100; drawGuides(); drawRulers([e.clientX, e.clientY]);
  $("#alignNote").textContent = `Guide at ${fmtPx(gd.v / workPerOrig())} px${overRuler(e) ? ". Let go here to remove it." : ""}`;
});
window.addEventListener("pointerup", e => {
  if (!guideDrag || e.pointerId !== guideDrag.id) return;
  const g = guideDrag; guideDrag = null; const now = guides[g.idx];
  const remove = overRuler(e);
  // Record the step for undo as it was before the drag.
  if (g.isNew) { guides.splice(g.idx, 1); if (!remove) { pushUndo(); guides.push(now); } }
  else { guides[g.idx] = g.before; pushUndo(); if (remove) guides.splice(g.idx, 1); else guides[g.idx] = now; }
  drawGuides(); syncAlignBar();
});

/* ---------- Hooks the rest of the app calls ---------- */
function afterAlignRender() {
  if (!alignReady) return;
  if (view !== "align") return;
  drawGuides(); syncAlignBar(); drawRulers();
  clearTimeout(diffTimer); if (alignMode === "diff") diffTimer = setTimeout(drawDiff, 120);
}
function applyAlignView() {
  if (!alignReady) return;
  const on = view === "align", st = $("#stage"), was = st.classList.contains("aligning");
  st.classList.toggle("aligning", on); st.classList.toggle("onion", on && alignMode === "onion"); st.classList.toggle("diff", on && alignMode === "diff");
  st.style.setProperty("--vec-op", vecOpacity);
  $("#diffCanvas").hidden = !(on && alignMode === "diff");
  if (on) { $("#tagL").hidden = true; $("#tagR").hidden = true; }
  drawGuides(); syncAlignBar();
  if (on !== was && job) layoutSheet();          // the bar takes room from the canvas, so fit the image again
  drawRulers();
  if (on && alignMode === "diff") drawDiff();
}
alignReady = true;
