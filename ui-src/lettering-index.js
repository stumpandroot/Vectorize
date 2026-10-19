/* ---------- Font index: shortlist faces from the whole Google Fonts library ---------- */
// font-index.json and font-index.bin are built by bench/fonts/build_index.py: for every indexed face, a shape
// descriptor per letter (an 8 x 8 ink grid over the letter's ink box, plus its top, bottom, and width in ems).
// The page builds the same descriptor from the word's own letters and ranks every face, then identifyWord fits
// the closest few for real. Without the index (an offline web page), the popular-font list stands in.

const FX = { meta: null, data: null, loading: null, avgW: null };
function loadFontIndex() {
  if (FX.loading) return FX.loading;
  FX.loading = (async () => {
    try {
      const [m, b] = await Promise.all([fetch("font-index.json"), fetch("font-index.bin")]);
      if (!m.ok || !b.ok) return false;
      FX.meta = await m.json(); FX.data = new Uint8Array(await b.arrayBuffer());
      FX.faces = []; FX.ws = new Map(); for (const f of FX.meta.families) { FX.ws.set(f.n, f.ws || f.i.map(x => x[0])); for (const [w, wd] of f.i) FX.faces.push({ fam: f.n, cat: f.c, w, wd }); }
      FX.chars = FX.meta.chars; FX.rec = FX.meta.record; FX.stride = FX.rec * FX.chars.length;
      if (FX.data.length !== FX.faces.length * FX.stride) { console.warn("font index size mismatch"); FX.meta = null; return false; }
      // Average ink width per letter across the library, for splitting touching letters.
      FX.avgW = new Float32Array(FX.chars.length);
      for (let c = 0; c < FX.chars.length; c++) { let s = 0, n = 0; for (let f = 0; f < FX.faces.length; f += 7) { const o = f * FX.stride + c * FX.rec, w = FX.data[o + FX.rec - 1]; if (w) { s += w; n++; } } FX.avgW[c] = n ? s / n / 100 : 0.5; }
      return true;
    } catch (e) { return false; }
  })();
  return FX.loading;
}
// 8 x 8 cell means of a binary mask's region r = [x0, y0, x1, y1] (fractional cells, like the index).
function gridOf(m, W, r) {
  const [x0, y0, x1, y1] = r, w = x1 - x0, h = y1 - y0, G = 8, out = new Float32Array(G * G);
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += m[(y + y0) * W + x + x0]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const S = (y, x) => { const ya = Math.floor(y), xa = Math.floor(x), yb = Math.min(h, ya + 1), xb = Math.min(w, xa + 1), fy = y - ya, fx = x - xa, at = (yy, xx) => I[yy * (w + 1) + xx];
    return at(ya, xa) * (1 - fy) * (1 - fx) + at(yb, xa) * fy * (1 - fx) + at(ya, xb) * (1 - fy) * fx + at(yb, xb) * fy * fx; };
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const ya = j * h / G, yb = (j + 1) * h / G, xa = i * w / G, xb = (i + 1) * w / G, area = (yb - ya) * (xb - xa);
    out[j * G + i] = area > 0 ? (S(yb, xb) - S(ya, xb) - S(yb, xa) + S(ya, xa)) / area : 0;
  }
  return out;
}
// The word's letters as boxes in reading order: connected pieces (dots and accents join the letter below them);
// when the count doesn't match the text, the ink is cut at the thinnest columns near where each letter should end.
function letterBoxes(m, W, H, chars) {
  const cc = components8(m, W, H), ext = new Map();
  for (let i = 0; i < m.length; i++) if (cc[i]) { const x = i % W, y = (i / W) | 0; let e = ext.get(cc[i]); if (!e) ext.set(cc[i], e = [x, y, x + 1, y + 1, 0]); e[0] = Math.min(e[0], x); e[1] = Math.min(e[1], y); e[2] = Math.max(e[2], x + 1); e[3] = Math.max(e[3], y + 1); e[4]++; }
  let parts = [...ext.values()].filter(e => e[4] > 3).sort((a, b) => a[0] - b[0]);
  if (!parts.length) return [];
  const maxH = Math.max(...parts.map(e => e[3] - e[1]));
  // Join small pieces into the letter they sit over or under (i, j, accents).
  const groups = [];
  for (const e of parts.sort((a, b) => (b[3] - b[1]) - (a[3] - a[1]))) {
    const g = groups.find(g => (e[3] - e[1]) < 0.45 * maxH && Math.min(e[2], g[2]) - Math.max(e[0], g[0]) > 0.5 * (e[2] - e[0]));
    if (g) { g[0] = Math.min(g[0], e[0]); g[1] = Math.min(g[1], e[1]); g[2] = Math.max(g[2], e[2]); g[3] = Math.max(g[3], e[3]); } else groups.push(e.slice(0, 4));
  }
  groups.sort((a, b) => a[0] - b[0]);
  if (groups.length === chars.length) return groups;
  // Cut by expected widths (library average), at the thinnest column within a quarter letter of each cut.
  const x0 = Math.min(...groups.map(g => g[0])), x1 = Math.max(...groups.map(g => g[2])), y0 = Math.min(...groups.map(g => g[1])), y1 = Math.max(...groups.map(g => g[3]));
  const ws = [...chars].map(ch => { const i = FX.chars ? FX.chars.indexOf(ch) : -1; return i >= 0 && FX.avgW ? FX.avgW[i] : 0.55; }), tot = ws.reduce((a, b) => a + b, 0);
  const col = new Float32Array(W); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) col[x] += m[y * W + x];
  const cuts = [x0]; let acc = 0;
  for (let i = 0; i < ws.length - 1; i++) {
    acc += ws[i]; const want = x0 + (x1 - x0) * acc / tot, span = 0.25 * (x1 - x0) * ws[i] / tot;
    let best = Math.round(want), bv = Infinity; for (let x = Math.max(cuts[cuts.length - 1] + 1, Math.round(want - span)); x <= Math.min(x1 - 1, Math.round(want + span)); x++) { const v = col[x] + 0.02 * Math.abs(x - want); if (v < bv) { bv = v; best = x; } }
    cuts.push(best);
  }
  cuts.push(x1);
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let y = y0; y < y1; y++) for (let x = cuts[i]; x < cuts[i + 1]; x++) if (m[y * W + x]) { b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x + 1), Math.max(b[3], y + 1)]; }
    out.push(isFinite(b[0]) ? b : null);
  }
  return out;
}
// The reader's letter boxes (when it gave one per letter), as ink boxes on the fitting canvas. Touching letters
// (a kerned AV, a connected script) can't be split by connected pieces, but the reader saw each letter.
function readerBoxes(T, chars, F) {
  if (!T.chars || T.chars.length !== chars.length) return null;
  const out = [];
  for (const c of T.chars) {
    const bx = [(c.box[0] * result.w - F.ox) * F.S, (c.box[1] * result.h - F.oy) * F.S, ((c.box[0] + c.box[2]) * result.w - F.ox) * F.S, ((c.box[1] + c.box[3]) * result.h - F.oy) * F.S];
    const x0 = Math.max(0, Math.floor(bx[0])), y0 = Math.max(0, Math.floor(bx[1]) - 2), x1 = Math.min(F.W, Math.ceil(bx[2])), y1 = Math.min(F.H, Math.ceil(bx[3]) + 2);
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (F.tgt[y * F.W + x]) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x + 1), Math.max(b[3], y + 1)];
    out.push(isFinite(b[0]) ? b : null);
  }
  return out.filter(Boolean).length >= Math.ceil(0.7 * chars.length) ? out : null;
}
// Distance from the word's letters to face f. Lower is closer.
function faceDistance(f, obs) {
  const base = f * FX.stride; let n = 0, gsum = 0;
  // Fit the em size and baseline: observed y (down) = b - s * face y (up), over every letter's top and bottom.
  let sxx = 0, sx = 0, sy = 0, sxy = 0, cnt = 0;
  const recs = [];
  for (const o of obs) {
    const r = base + o.ci * FX.rec, d = FX.data;
    const top = (d[r + FX.rec - 3] << 24 >> 24) / 100, bot = (d[r + FX.rec - 2] << 24 >> 24) / 100, wid = d[r + FX.rec - 1] / 100;
    if (!wid) { recs.push(null); continue; }
    recs.push({ r, top, bot, wid });
    for (const [u, v] of [[top, o.b[1]], [bot, o.b[3]]]) { sxx += u * u; sx += u; sy += v; sxy += u * v; cnt++; }
  }
  if (cnt < 2) return Infinity;
  const den = cnt * sxx - sx * sx; if (Math.abs(den) < 1e-9) return Infinity;
  const s = -(cnt * sxy - sx * sy) / den, b = (sy + s * sx) / cnt; if (!(s > 0)) return Infinity;
  let vert = 0, wide = 0;
  obs.forEach((o, j) => {
    const R = recs[j]; if (!R) { gsum += 1; vert += 0.3; wide += 0.3; n++; return; }
    let g = 0; for (let k = 0; k < 32; k++) { const byte = FX.data[R.r + k]; g += Math.abs((byte >> 4) / 15 - o.g[2 * k]) + Math.abs((byte & 15) / 15 - o.g[2 * k + 1]); }
    gsum += g / 64;
    vert += (Math.abs((b - s * R.top - o.b[1]) / s) + Math.abs((b - s * R.bot - o.b[3]) / s)) / 2;
    wide += Math.abs((o.b[2] - o.b[0]) / s - R.wid);
    n++;
  });
  return (gsum + 1.5 * vert + 1.5 * wide) / n;
}
// The closest faces for word T reading text: { fam, w, wd }[] best first, a few weights per family.
async function indexShortlist(T, text, F, opts = {}) {
  if (!(await loadFontIndex())) return [];
  const variants = [...new Set([text, text.toUpperCase()])], best = new Map();
  for (const v of variants) {
    const chars = [...v].filter(ch => !/\s/.test(ch)), boxes = readerBoxes(T, chars, F) || letterBoxes(F.tgt, F.W, F.H, chars);
    const obs = [];
    chars.forEach((ch, i) => { const ci = FX.chars.indexOf(ch), b = boxes[i]; if (ci < 0 || !b || b[2] - b[0] < 2 || b[3] - b[1] < 2) return; obs.push({ ci, b, g: gridOf(F.tgt, F.W, b) }); });
    if (obs.length < Math.min(2, chars.length)) continue;
    for (let f = 0; f < FX.faces.length; f++) { const d = faceDistance(f, obs); if (d < (best.get(f) ?? Infinity)) best.set(f, d); }
  }
  const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]);
  const perFam = new Map(), out = [];
  for (const [f, d] of ranked) {
    const x = FX.faces[f], k = perFam.get(x.fam) || 0; if (k >= (opts.perFamily || 2)) continue;
    if (!perFam.has(x.fam) && perFam.size >= (opts.families || 14)) continue;
    perFam.set(x.fam, k + 1); out.push({ fam: x.fam, w: x.w, wd: x.wd, dist: d, src: "google" });
  }
  // Popular families (the FONTS list) ranked within the closest 150 families come along as extras, best face each (up to 10).
  const pop = new Set((typeof FONTS !== "undefined" ? FONTS : []).map(f => f[0])), famRank = new Map();
  for (const [f] of ranked) { const fam = FX.faces[f].fam; if (!famRank.has(fam)) famRank.set(fam, famRank.size); }
  const seenX = new Set(); out.extra = [];
  for (const [f, d] of ranked) { const x = FX.faces[f]; if (!pop.has(x.fam) || seenX.has(x.fam) || perFam.has(x.fam) || famRank.get(x.fam) >= 150) continue; seenX.add(x.fam); out.extra.push({ fam: x.fam, w: x.w, wd: x.wd, dist: d, src: "google" }); if (out.extra.length >= 10) break; }
  return out;
}
// Every weight family fam can draw: from the index, else the popular list.
function familyWeights(fam) {
  if (FX.ws && FX.ws.has(fam)) return FX.ws.get(fam);
  const f = (typeof FONTS !== "undefined" ? FONTS : []).find(x => x[0] === fam); return f ? f[1] : [];
}
