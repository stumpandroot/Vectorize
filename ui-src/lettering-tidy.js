/* ---------- Custom-lettering cleanup (opt-in, in Cleaned mode) ---------- */
// Two tools for hand lettering that no font matches:
// - Make repeated letters match: every copy of a letter takes the shape of the most typical copy, sized and placed
//   where each copy was.
// - Even out stroke weight: letters drawn heavier or lighter than the rest are thinned or thickened to the
//   word's typical stroke.
// Both work on the cleaned letters and are undone by turning them off.

// Items grouped into letters in reading order: small pieces (dots, accents) join the letter they sit over.
function letterGroups(items) {
  const bs = items.map(it => bboxOf(it.outer.q)), maxH = Math.max(...bs.map(b => b[3] - b[1]));
  const order = bs.map((b, i) => i).sort((a, b) => (bs[b][3] - bs[b][1]) - (bs[a][3] - bs[a][1])), groups = [];
  for (const i of order) {
    const b = bs[i], small = (b[3] - b[1]) < 0.45 * maxH;
    const g = small && groups.find(g => Math.min(b[2], g.b[2]) - Math.max(b[0], g.b[0]) > 0.5 * (b[2] - b[0]));
    if (g) { g.idx.push(i); g.b = [Math.min(g.b[0], b[0]), Math.min(g.b[1], b[1]), Math.max(g.b[2], b[2]), Math.max(g.b[3], b[3])]; }
    else groups.push({ idx: [i], b: b.slice() });
  }
  return groups.sort((a, c) => (a.b[0] + a.b[2]) - (c.b[0] + c.b[2]));
}
// A letter's items drawn into a size x size mask over its own box (to compare shapes regardless of size).
function groupMask(items, g, size = 48) {
  const c = new OffscreenCanvas(size, size), x = c.getContext("2d"), b = g.b, sx = size / Math.max(1e-6, b[2] - b[0]), sy = size / Math.max(1e-6, b[3] - b[1]);
  x.setTransform(sx, 0, 0, sy, -b[0] * sx, -b[1] * sy); x.fillStyle = "#000";
  for (const i of g.idx) { const it = items[i]; x.fill(new Path2D([it.outer, ...it.holes].map(r => VZ.outlineD(r.outline)).join("")), "evenodd"); }
  const d = x.getImageData(0, 0, size, size).data, m = new Uint8Array(size * size); for (let k = 0; k < m.length; k++) m[k] = d[k * 4 + 3] > 127 ? 1 : 0; return m;
}
// An outline record moved by uniform scale s about the origin, then by (dx, dy). Circular arcs stay circular.
function moveRec(r, s, dx, dy) {
  const o = r.outline, V = o.V.map(p => [p[0] * s + dx, p[1] * s + dy]);
  const segs = o.segs.map(sg => sg === "L" || sg[0] === "L" ? sg : sg[0] === "C" ? ["C", [sg[1][0] * s, sg[1][1] * s], [sg[2][0] * s, sg[2][1] * s]] : sg[0] === "A" ? ["A", sg[1] * s, sg[2], sg[3]] : sg);
  return { outline: { ...o, V, segs }, shape: null, q: r.q.map(p => [p[0] * s + dx, p[1] * s + dy]) };
}
// Returns { items, matched (letters changed), note }.
function matchRepeatedLetters(T, items) {
  const chars = [...(T.text || "")].filter(ch => !/\s/.test(ch)), groups = letterGroups(items);
  if (!chars.length) return { items, matched: 0, note: "Type what the word says first." };
  if (groups.length !== chars.length) return { items, matched: 0, note: "Some letters touch or are in pieces, so they can't be matched one by one." };
  const out = items.slice(), byChar = new Map(); let matched = 0;
  groups.forEach((g, i) => { const k = chars[i]; if (!byChar.has(k)) byChar.set(k, []); byChar.get(k).push(g); });
  const drop = new Set(), add = [];
  for (const [, gs] of byChar) {
    if (gs.length < 2) continue;
    // The most typical copy: the one that overlaps the others most, compared at the same size.
    const ms = gs.map(g => groupMask(items, g)), score = ms.map((m, i) => ms.reduce((s, n, j) => s + (i === j ? 0 : iouMasks(m, n)), 0));
    const t = score.indexOf(Math.max(...score)), tg = gs[t];
    gs.forEach((g, i) => {
      // A copy that differs a lot (likely a misread letter, or deliberately different) is left alone.
      if (i === t || iouMasks(ms[t], ms[i]) < 0.7) return;
      const s = (g.b[3] - g.b[1]) / (tg.b[3] - tg.b[1]), cx = (g.b[0] + g.b[2]) / 2, tcx = (tg.b[0] + tg.b[2]) / 2;
      const dx = cx - tcx * s, dy = g.b[3] - tg.b[3] * s;   // centered across, standing on the copy's bottom
      for (const j of g.idx) drop.add(j);
      for (const j of tg.idx) { const it = items[j]; add.push({ ...it, outer: moveRec(it.outer, s, dx, dy), holes: it.holes.map(h => moveRec(h, s, dx, dy)) }); }
      matched++;
    });
  }
  return { items: out.filter((_, j) => !drop.has(j)).concat(add), matched, note: matched ? "" : "No repeated letters close enough in shape to match." };
}
// Thickens or thins each letter toward the word's typical stroke width. Returns { items, changed, note }.
function evenStrokeWeight(items) {
  const groups = letterGroups(items); if (groups.length < 2) return { items, changed: 0, note: "Needs at least two letters." };
  const sc = Math.max(job.scale, 1), maxH = Math.max(...groups.map(g => g.b[3] - g.b[1])), U = Math.max(1, Math.min(4, 140 / Math.max(1, maxH)));
  const raster = g => {
    const pad = Math.ceil(0.3 * maxH) + 2, x0 = Math.floor(g.b[0]) - pad, y0 = Math.floor(g.b[1]) - pad, w = Math.ceil((g.b[2] - x0 + pad) * U), h = Math.ceil((g.b[3] - y0 + pad) * U);
    const c = new OffscreenCanvas(w, h), x = c.getContext("2d"); x.setTransform(U, 0, 0, U, -x0 * U, -y0 * U); x.fillStyle = "#000";
    for (const i of g.idx) { const it = items[i]; x.fill(new Path2D([it.outer, ...it.holes].map(r => VZ.outlineD(r.outline)).join("")), "evenodd"); }
    const d = x.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h); for (let k = 0; k < m.length; k++) m[k] = d[k * 4 + 3] > 127 ? 1 : 0;
    return { m, w, h, x0, y0 };
  };
  const R = groups.map(raster), sw = R.map(r => strokeWidth(r.m, r.w, r.h)), target = sw.slice().sort((a, b) => a - b)[sw.length >> 1];
  let changed = 0; const out = [];
  groups.forEach((g, gi) => {
    const delta = (target - sw[gi]) / 2;    // raster px to grow (+) or shrink (-) each edge
    if (Math.abs(delta) < Math.max(0.35 * U, 0.04 * target)) { for (const i of g.idx) out.push(items[i]); return; }
    const r = R[gi], d = chamfer(r.m, r.w, r.h), f = new Float32Array(r.w * r.h);
    for (let k = 0; k < f.length; k++) { const sd = r.m[k] ? d[k] + 0.5 : -(d[k] - 0.5); f[k] = Math.max(0, Math.min(1, 0.5 + sd + delta)); }
    const s = target, fit = { minArea: Math.max(4, (0.7 * sc * U) ** 2), tol: 0.04 * s, k: Math.max(4, Math.round(0.4 * s)), corner: 35, lineTol: 0.02 * s, lineMin: Math.max(16, Math.round(s)), snap: 2, snapTol: 0.08 * s, smooth: Math.max(1.6, 0.25 * s), minSeg: 0.12 * s };
    const traced = traceField(f, r.w, r.h, U, r.x0, r.y0, fit);
    if (!traced.length) { for (const i of g.idx) out.push(items[i]); return; }
    out.push(...traced); changed++;
  });
  return { items: out, changed, note: changed ? "" : "The letters' strokes are already even." };
}
// The cleaned letters with the chosen tools applied. Sets T.tidyNote for the Text tab.
function applyTidy(T, base) {
  let items = base, notes = [];
  if (T.tidy && T.tidy.stems) { const r = evenStrokeWeight(items); items = r.items; if (r.note) notes.push(r.note); }
  if (T.tidy && T.tidy.match) { const r = matchRepeatedLetters(T, items); items = r.items; if (r.note) notes.push(r.note); }
  T.tidyNote = notes.join(" ");
  return items;
}
