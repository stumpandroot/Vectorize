/* ---------- Lettering engine (1.9.0) ---------- */
// Fonts become real outlines: each matched word is laid out with fontkit (shaping, kerning, ligatures) and its
// glyph curves go straight into the export. Nothing is traced from a picture of the font. Every candidate font is
// fitted (size, position, tracking, width, slant, per-letter nudges, and arcs) and then checked letter by letter
// before Vectorize swaps it in on its own.

const LT = { faces: new Map(), cssDone: new Set() };

/* Font files. Order: test hook, the Mac app's cache (bundled pack, then Google Fonts), then Google Fonts directly. */
function b64Bytes(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
async function fontBytes(fam, w, wd) {
  if (window.__VZ_FONT_FETCH) { const r = await window.__VZ_FONT_FETCH(fam, w, wd || 0); return r ? (typeof r === "string" ? b64Bytes(r) : new Uint8Array(r)) : null; }
  if (NATIVE && NATIVE.font_file) {
    const r = await NATIVE.font_file(fam, w, wd || 0);
    if (r && r.b64) return b64Bytes(r.b64);
    if (r && r.missing) return null;
  }
  const q = encodeURIComponent(fam).replace(/%20/g, "+") + (wd ? `:wdth,wght@${wd},${w}` : `:wght@${w}`);
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${q}&display=block`);
  if (!res.ok) return null;
  const css = await res.text(), blocks = css.split(/\/\*\s*([\w-]+)\s*\*\//);
  let url = null;
  for (let i = 1; i < blocks.length; i += 2) if (blocks[i] === "latin") { const m = blocks[i + 1].match(/url\((https:[^)]+)\)/); if (m) url = m[1]; }
  if (!url) { const m = css.match(/url\((https:[^)]+)\)/); if (m) url = m[1]; }
  if (!url) return null;
  const f = await fetch(url); return f.ok ? new Uint8Array(await f.arrayBuffer()) : null;
}
// A parsed face: { fam, w, wd, fk, upm, glyphCache }. null when the family doesn't have that weight.
function getFace(fam, w, wd = 0) {
  if (!fam || !w) { console.warn("getFace without a family", fam, w, new Error().stack); return Promise.resolve(null); }
  const key = `${fam}|${w}|${wd}`;
  if (!LT.faces.has(key)) LT.faces.set(key, (async () => {
    try {
      const bytes = await fontBytes(fam, w, wd); if (!bytes || !window.fontkit) return null;
      const fk = window.fontkit.create(bytes);
      if (!fk || !fk.unitsPerEm) return null;
      return { fam, w, wd, fk, upm: fk.unitsPerEm, paths: new Map(), src: "google" };
    } catch (e) { console.warn("font", fam, w, e); return null; }
  })());
  return LT.faces.get(key);
}
// Uploaded and installed fonts arrive as bytes.
function faceFromBytes(fam, bytes, label, src, postscript) {
  let fk = window.fontkit.create(bytes, postscript || undefined); if (fk && fk.fonts) fk = fk.fonts[0];   // a collection without a named face
  const face = { fam, w: 400, wd: 0, fk, upm: fk.unitsPerEm, paths: new Map(), src, label };
  LT.faces.set(`${fam}|400|0`, Promise.resolve(face)); return face;
}
// The family's CSS, for the font list previews.
function previewCSS(fam) {
  if (LT.cssDone.has(fam) || window.__VZ_FONT_FETCH) return; LT.cssDone.add(fam);
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}:wght@100..900&display=swap`;
  l.onerror = () => { l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}&display=swap`; l.onerror = null; };
  document.head.appendChild(l);
}

/* Layout: shaped glyphs in font units. */
function shapeWord(face, text) {
  const key = "run:" + text; if (face.paths.has(key)) return face.paths.get(key);
  const run = face.fk.layout(text);
  let pen = 0; const gl = [];
  run.glyphs.forEach((g, i) => {
    const p = run.positions[i], st = run.stringIndices ? run.stringIndices[i] : i;
    // Color fonts (COLR) can throw on bbox; their outline's own box is the same shape.
    let bb; try { bb = g.bbox; } catch (e) { bb = g.path.bbox; }
    const cmds = g.path.commands, ch = text[st] ?? "";
    let d = face.paths.get(g.id);
    if (d === undefined) { d = g.path.toSVG(); face.paths.set(g.id, d); }
    gl.push({ id: g.id, ch, pen: pen + p.xOffset, dy: p.yOffset, adv: p.xAdvance, cmds, d, bb: [bb.minX, bb.minY, bb.maxX, bb.maxY], ink: cmds.length > 0 && !/\s/.test(ch) });
    pen += p.xAdvance;
  });
  const ink = gl.filter(g => g.ink);
  const out = { glyphs: gl, inkGlyphs: ink, width: pen,
    box: ink.length ? [Math.min(...ink.map(g => g.pen + g.bb[0])), Math.min(...ink.map(g => g.bb[1] + g.dy)), Math.max(...ink.map(g => g.pen + g.bb[2])), Math.max(...ink.map(g => g.bb[3] + g.dy))] : [0, 0, 0, 0] };
  face.paths.set(key, out); return out;
}
// Where glyph i sits: an affine map from font units (y up) to work pixels (y down), [a, b, c, d, e, f].
// P: { k (px per unit), x, y (baseline), track (px between letters), sx, skew, offs (per-glyph px), arc }
function glyphMatrix(run, i, P) {
  const g = run.glyphs[i], k = P.k, sx = P.sx || 1, sk = P.skew || 0, o = (P.offs && P.offs[i]) || 0, oy = (P.offy && P.offy[i]) || 0;
  if (P.arc) {
    // Letters stand on a circle of baseline radius r. Upper arcs read clockwise over the top; lower arcs read
    // left to right along the bottom. Each letter's up direction points away from the tangent's left.
    const A = P.arc, R = A.r, tr = P.track || 0;
    const pos = (g.pen + g.adv / 2) * k * sx + i * tr + o, total = run.width * k * sx + (run.glyphs.length - 1) * tr;
    const t = (pos - total / 2) / R, th = A.theta + (A.upper ? t : -t);
    const px = A.cx + R * Math.sin(th), py = A.cy - R * Math.cos(th), rot = A.upper ? th : th - Math.PI;
    const tx = Math.cos(rot), ty = Math.sin(rot), ux = ty, uy = -tx, hx = -g.adv / 2 * k * sx;
    return [k * sx * tx, k * sx * ty, k * ux, k * uy, px + hx * tx, py + hx * ty];
  }
  const x = P.x + g.pen * k * sx + i * (P.track || 0) + o, y = P.y - g.dy * k + oy;
  return [k * sx, 0, sk * k, -k, x, y];
}
const applyM = (m, u, v) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
// The placed word's ink box in work pixels.
function placedBox(run, P) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  run.glyphs.forEach((g, i) => { if (!g.ink) return; const m = glyphMatrix(run, i, P); for (const [u, v] of [[g.bb[0], g.bb[1]], [g.bb[2], g.bb[1]], [g.bb[0], g.bb[3]], [g.bb[2], g.bb[3]]]) { const [x, y] = applyM(m, u, v); b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; } });
  return b;
}
function glyphBox(run, i, P) {
  const g = run.glyphs[i], m = glyphMatrix(run, i, P); let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [u, v] of [[g.bb[0], g.bb[1]], [g.bb[2], g.bb[1]], [g.bb[0], g.bb[3]], [g.bb[2], g.bb[3]]]) { const [x, y] = applyM(m, u, v); b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; }
  return b;
}

/* Vector output: glyph outlines as Vectorize items (cubic segments; quadratics converted exactly). */
function glyphItems(run, P, face) {
  const items = [];
  run.glyphs.forEach((g, i) => {
    if (!g.ink) return;
    const m = glyphMatrix(run, i, P), contours = []; let cur = null, last = null, start = null;
    const close = () => { if (cur && cur.V.length > 1) { const a = cur.V[0], b = cur.V[cur.V.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) { cur.V.pop(); } else cur.segs.push(["L"]); if (cur.segs.length > cur.V.length) cur.segs.length = cur.V.length; while (cur.segs.length < cur.V.length) cur.segs.push(["L"]); contours.push(cur); } cur = null; };
    for (const c of g.cmds) {
      const a = c.args;
      if (c.command === "moveTo") { close(); last = start = applyM(m, a[0], a[1]); cur = { V: [last], segs: [] }; }
      else if (c.command === "lineTo") { const p = applyM(m, a[0], a[1]); cur.segs.push(["L"]); cur.V.push(p); last = p; }
      else if (c.command === "quadraticCurveTo") { const q = applyM(m, a[0], a[1]), p = applyM(m, a[2], a[3]); const c1 = [last[0] + 2 / 3 * (q[0] - last[0]), last[1] + 2 / 3 * (q[1] - last[1])], c2 = [p[0] + 2 / 3 * (q[0] - p[0]), p[1] + 2 / 3 * (q[1] - p[1])]; cur.segs.push(["C", [c1[0] - last[0], c1[1] - last[1]], [c2[0] - p[0], c2[1] - p[1]]]); cur.V.push(p); last = p; }
      else if (c.command === "bezierCurveTo") { const c1 = applyM(m, a[0], a[1]), c2 = applyM(m, a[2], a[3]), p = applyM(m, a[4], a[5]); cur.segs.push(["C", [c1[0] - last[0], c1[1] - last[1]], [c2[0] - p[0], c2[1] - p[1]]]); cur.V.push(p); last = p; }
      else if (c.command === "closePath") close();
    }
    close();
    // When the path ended exactly at its start, the closing curve is already the last segment: fix the count.
    for (const o of contours) { while (o.segs.length > o.V.length) o.segs.pop(); }
    if (!contours.length) return;
    const qs = contours.map(o => flattenOutline(o));
    const big = qs.map(q => Math.abs(VZ.area(q))).reduce((bi, a, j, arr) => a > arr[bi] ? j : bi, 0);
    const rec = j => ({ outline: contours[j], shape: null, q: qs[j] });
    items.push({ outer: rec(big), holes: contours.map((_, j) => j).filter(j => j !== big).map(rec), glyph: i, ch: g.ch });
  });
  return items;
}
function flattenOutline(o) {
  const pts = [], n = o.V.length;
  for (let i = 0; i < n; i++) {
    const a = o.V[i], b = o.V[(i + 1) % n], s = o.segs[i]; pts.push(a);
    if (s && s[0] === "C") { const c1 = [a[0] + s[1][0], a[1] + s[1][1]], c2 = [b[0] + s[2][0], b[1] + s[2][1]]; for (let t = 0.125; t < 1; t += 0.125) { const u = 1 - t; pts.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]); } }
  }
  return pts;
}

/* Raster: draw the placed word into a canvas (scale S, origin ox, oy in work pixels). */
function drawWord(g, run, P, S, ox, oy, only) {
  run.glyphs.forEach((gl, i) => {
    if (!gl.ink || (only && !only.has(i))) return;
    const m = glyphMatrix(run, i, P);
    g.setTransform(S * m[0], S * m[1], S * m[2], S * m[3], S * (m[4] - ox), S * (m[5] - oy));
    let p = gl.p2d; if (!p) p = gl.p2d = new Path2D(gl.d);
    g.fill(p, "nonzero");
  });
  g.setTransform(1, 0, 0, 1, 0, 0);
}
function rasterWord(run, P, S, ox, oy, W, H, only) {
  const c = rasterWord.c || (rasterWord.c = new OffscreenCanvas(8, 8)); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext("2d", { willReadFrequently: true }); g.clearRect(0, 0, W, H); g.fillStyle = "#000";
  drawWord(g, run, P, S, ox, oy, only);
  const d = g.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0; return m;
}

/* The word's own ink, as a target: the original image's coverage of the letter colors (no blur, hairlines kept). */
function rawImageData() {
  if (job.rawImgd) return Promise.resolve(job.rawImgd);
  if (job._rawP) return job._rawP;
  return (job._rawP = (async () => {
    const im = await loadImage(job.cutImgd ? job.srcURL : job.srcURL);
    const c = document.createElement("canvas"); c.width = job.workW; c.height = job.workH;
    const x = c.getContext("2d", { willReadFrequently: true }); x.imageSmoothingQuality = "high"; x.drawImage(im, 0, 0, job.workW, job.workH);
    job.rawImgd = x.getImageData(0, 0, job.workW, job.workH); return job.rawImgd;
  })());
}
// Layers and items that make up word T (a word can span colors: T.parts).
function wordParts(T) { return T.parts || T.items.map(ii => ({ li: T.li, ii })); }
// Coverage field over T's box: 0..1 for how much of each work pixel is letter ink. Pixels far from the word's
// traced letters are zeroed so nearby artwork doesn't leak in. Thin ridges (hairlines) are lifted over 0.5.
async function wordCoverage(T, pad = null) {
  const imgd = await rawImageData(), W = result.w, H = result.h, sc = Math.max(job.scale, 1);
  pad = pad ?? Math.ceil(3 * sc) + 2;
  const x0 = Math.max(0, Math.floor(T.box[0]) - pad), y0 = Math.max(0, Math.floor(T.box[1]) - pad), x1 = Math.min(W, Math.ceil(T.box[2]) + pad), y1 = Math.min(H, Math.ceil(T.box[3]) + pad);
  const w = x1 - x0, h = y1 - y0, f = new Float32Array(w * h), parts = wordParts(T);
  // Letter colors, and the background as the median of the box edge.
  const cols = [...new Set(parts.map(p => p.li))].map(li => fromHex(result.layers[li].hex));
  const ring = []; for (let x = x0; x < x1; x++) for (const y of [y0, y1 - 1]) ring.push(y * W + x); for (let y = y0; y < y1; y++) for (const x of [x0, x1 - 1]) ring.push(y * W + x);
  const D = imgd.data, med = ch => { const v = ring.map(i => D[i * 4 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
  let bg = [med(0), med(1), med(2)];
  // A see-through background: coverage comes from alpha. An image with an alpha channel but an opaque
  // background around the word (common for PNG exports) still uses the color projection, which keeps the
  // anti-aliased edge pixels a color-distance test would drop.
  if ((result.transparent || job.hasAlpha) && med(3) < 128) bg = null;
  // Near the word's traced letters only.
  const near = new Uint8Array(w * h), reach = Math.ceil(2 * sc) + 1;
  for (const p of parts) { const L = result.layers[p.li], it = L.items[p.ii]; if (!it) continue; const b = bboxOf(it.outer.q); for (let y = Math.max(y0, Math.floor(b[1]) - reach); y < Math.min(y1, Math.ceil(b[3]) + reach); y++) for (let x = Math.max(x0, Math.floor(b[0]) - reach); x < Math.min(x1, Math.ceil(b[2]) + reach); x++) near[(y - y0) * w + x - x0] = 1; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x; if (!near[k]) continue; const i = ((y + y0) * W + x + x0) * 4;
    let a = 0;
    if (!bg) a = D[i + 3] / 255 * (cols.length ? Math.max(...cols.map(c => 1 - Math.min(1, Math.hypot(D[i] - c[0], D[i + 1] - c[1], D[i + 2] - c[2]) / 160))) : 1);
    else for (const c of cols) { const vx = c[0] - bg[0], vy = c[1] - bg[1], vz = c[2] - bg[2], n2 = vx * vx + vy * vy + vz * vz; if (n2 < 400) continue; const t = ((D[i] - bg[0]) * vx + (D[i + 1] - bg[1]) * vy + (D[i + 2] - bg[2]) * vz) / n2; a = Math.max(a, Math.min(1, Math.max(0, t))); }
    f[k] = a;
  }
  // Hairlines: a ridge lighter than half coverage across a thin span is still a stroke. Lift a pixel that's a clear
  // local peak across rows or columns, within a run no wider than about 1.5 source pixels.
  const span = Math.max(2, Math.round(1.5 * sc)), lift = new Float32Array(f);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x, v = f[k]; if (v < 0.18 || v >= 0.5) continue;
    const peak = (dx, dy) => { let lo1 = v, lo2 = v; for (let r = 1; r <= span + 1; r++) { const a = f[k + r * (dx + dy * w)] ?? 0; lo1 = Math.min(lo1, a); } for (let r = 1; r <= span + 1; r++) { const a = f[k - r * (dx + dy * w)] ?? 0; lo2 = Math.min(lo2, a); } return v - lo1 > 0.12 && v - lo2 > 0.12; };
    if (peak(0, 1) || peak(1, 0)) lift[k] = Math.max(v, 0.56);
  }
  return { f: lift, w, h, x0, y0 };
}
// Binary target at canvas scale S from a coverage field (sample at pixel centers).
function coverageTarget(C, S, ox, oy, W, H) {
  const t = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { const wy = (y + 0.5) / S + oy - C.y0 - 0.5, iy = Math.floor(wy), fy = wy - iy;
    for (let x = 0; x < W; x++) { const wx = (x + 0.5) / S + ox - C.x0 - 0.5, ix = Math.floor(wx), fx = wx - ix;
      const at = (a, b) => (a >= 0 && b >= 0 && a < C.w && b < C.h) ? C.f[b * C.w + a] : 0;
      const v = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
      t[y * W + x] = v >= 0.5 ? 1 : 0; } }
  return t;
}

/* Fitting a face to a word. */
function iouMasks(a, b) { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { const p = a[k], q = b[k]; if (p | q) { u++; if (p & q) i++; } } return u ? i / u : 0; }
// A scoring frame for word T: target mask at a canvas scale where the word is about 72 px tall.
async function fitFrame(T, hiRes = false) {
  const C = await wordCoverage(T), bh = Math.max(4, T.box[3] - T.box[1]), sc = Math.max(job.scale, 1);
  const S = hiRes ? Math.max(72 / bh, 3 / sc) : 72 / bh, M = 6 / S;
  const ox = T.box[0] - M, oy = T.box[1] - M, W = Math.min(4000, Math.ceil((T.box[2] - T.box[0] + 2 * M) * S)), H = Math.ceil((bh + 2 * M) * S);
  return { C, S, ox, oy, W, H, tgt: coverageTarget(C, S, ox, oy, W, H) };
}
// Starting placement: the word's ink box over T's ink box; width from tracking or from a horizontal scale.
function initialPlacements(run, T, arc) {
  const ib = run.box, iw = ib[2] - ib[0], ih = ib[3] - ib[1]; if (iw <= 0 || ih <= 0) return [];
  const bw = T.box[2] - T.box[0], bh = T.box[3] - T.box[1], k = bh / ih, n = Math.max(1, run.glyphs.length - 1);
  const base = { k, x: T.box[0] - ib[0] * k, y: T.box[1] + ib[3] * k, track: 0, sx: 1, skew: 0 };
  if (arc) {
    // On a circle: the letters' height is the ring's thickness; the baseline sits a cap height in from the
    // outer edge over the top, or out from the inner edge along the bottom.
    const ka = (arc.rOut - arc.rIn) / ih, r = arc.upper ? arc.rOut - ib[3] * ka : arc.rIn + ib[3] * ka;
    const A = { cx: arc.cx, cy: arc.cy, upper: arc.upper, theta: arc.theta, r }, b0 = { ...base, k: ka, arc: A };
    return [b0, { ...b0, track: arc.span ? (arc.span * r - iw * ka) / n : 0 }];
  }
  const out = [base, { ...base, track: (bw - iw * k) / n }, { ...base, sx: Math.max(0.6, Math.min(1.6, bw / (iw * k))) }];
  return out;
}
// Coordinate search over the placement, scored by IoU against the frame's target.
function refinePlacement(run, P0, F, rounds = 4, perGlyph = true) {
  let P = { ...P0, offs: P0.offs ? Float32Array.from(P0.offs) : new Float32Array(run.glyphs.length) };
  const score = Q => iouMasks(F.tgt, rasterWord(run, Q, F.S, F.ox, F.oy, F.W, F.H));
  let best = score(P);
  const em = P.k * 1000 / 1000 * 1, bh = (run.box[3] - run.box[1]) * P.k;
  const steps = [["k", P.k * 0.04, true], ["x", bh * 0.04], ["y", bh * 0.04], ["track", bh * 0.03], ["sx", 0.04], ["skew", 0.04]];
  if (P.arc) steps.push(["arc.r", P.arc.r * 0.04], ["arc.theta", 0.03], ["arc.cx", bh * 0.05], ["arc.cy", bh * 0.05]);
  const get = (Q, k) => k.startsWith("arc.") ? Q.arc[k.slice(4)] : Q[k];
  const set = (Q, k, v) => { if (k.startsWith("arc.")) { Q.arc = { ...Q.arc, [k.slice(4)]: v }; } else Q[k] = v; };
  for (let r = 0; r < rounds; r++) {
    const f = 1 / (1 + r * 0.9);
    for (const [key, st] of steps) {
      if (key === "skew" && P.arc) continue;
      for (const sgn of [1, -1]) {
        let moved = true;
        while (moved) {
          moved = false; const Q = { ...P }; set(Q, key, get(P, key) + sgn * st * f);
          if (key === "sx" && (Q.sx < 0.55 || Q.sx > 1.7)) break; if (key === "skew" && Math.abs(Q.skew) > 0.45) break;
          const v = score(Q); if (v > best + 1e-5) { best = v; P = Q; moved = true; }
        }
      }
    }
  }
  if (perGlyph && run.glyphs.length > 1) {
    // Per-letter nudges, a few percent of the height, for custom spacing.
    for (let r = 0; r < 2; r++) for (let i = 0; i < run.glyphs.length; i++) {
      if (!run.glyphs[i].ink) continue;
      for (const sgn of [1, -1]) { const Q = { ...P, offs: Float32Array.from(P.offs) }; Q.offs[i] += sgn * bh * 0.03 / (r + 1); const v = score(Q); if (v > best + 1e-5) { best = v; P = Q; } }
    }
  }
  return { P, iou: best };
}

/* Letter-by-letter check: is the fitted font safe to swap in without asking? */
function chamfer(m, W, H) {
  const D = new Float32Array(W * H).fill(1e9);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y * W + x; if (m[k] && (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !m[k - 1] || !m[k + 1] || !m[k - W] || !m[k + W])) D[k] = 0; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y * W + x; let v = D[k]; if (x) v = Math.min(v, D[k - 1] + 1); if (y) { v = Math.min(v, D[k - W] + 1); if (x) v = Math.min(v, D[k - W - 1] + 1.414); if (x < W - 1) v = Math.min(v, D[k - W + 1] + 1.414); } D[k] = v; }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const k = y * W + x; let v = D[k]; if (x < W - 1) v = Math.min(v, D[k + 1] + 1); if (y < H - 1) { v = Math.min(v, D[k + W] + 1); if (x < W - 1) v = Math.min(v, D[k + W + 1] + 1.414); if (x) v = Math.min(v, D[k + W - 1] + 1.414); } D[k] = v; }
  return D;
}
function holesIn(m, W, H, r) {
  // Background pieces fully inside region r that don't touch its edge: a letter's counters.
  const [x0, y0, x1, y1] = r, w = x1 - x0, h = y1 - y0; if (w < 3 || h < 3) return 0;
  const seen = new Uint8Array(w * h); let n = 0; const st = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x; if (seen[k] || m[(y + y0) * W + x + x0]) continue;
    let edge = false, size = 0; st.push(k); seen[k] = 1;
    while (st.length) { const c = st.pop(), cx = c % w, cy = (c / w) | 0; size++; if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) edge = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (!seen[q] && !m[(ny + y0) * W + nx + x0]) { seen[q] = 1; st.push(q); } } }
    if (!edge && size > 6) n++;
  }
  return n;
}
// Scores fitted placement P per letter, at a resolution where a source pixel is about 3 canvas pixels.
async function letterCheck(T, run, P) {
  const F = await fitFrame(T, true), rm = rasterWord(run, P, F.S, F.ox, F.oy, F.W, F.H), sc = Math.max(job.scale, 1), px = F.S * sc;   // canvas px per source px
  const dT = chamfer(F.tgt, F.W, F.H), dR = chamfer(rm, F.W, F.H);
  const letters = [];
  // The tips of pointed letters (the apex and feet of an A) are thin for a pixel or two too; only a letter with
  // thin strokes adding up to at least 40% of the cap height is held to the thin check.
  const minThin = 0.4 * (T.box[3] - T.box[1]) * F.S;
  run.glyphs.forEach((g, i) => {
    if (!g.ink) return;
    const b = glyphBox(run, i, P), pad = 2;
    const r = [Math.max(0, Math.floor((b[0] - F.ox) * F.S) - pad), Math.max(0, Math.floor((b[1] - F.oy) * F.S) - pad), Math.min(F.W, Math.ceil((b[2] - F.ox) * F.S) + pad), Math.min(F.H, Math.ceil((b[3] - F.oy) * F.S) + pad)];
    let inter = 0, uni = 0; const ds = []; let thin = 0, thinKept = 0;
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) {
      const k = y * F.W + x, p = F.tgt[k], q = rm[k];
      if (p | q) { uni++; if (p & q) inter++; }
      if (p && dT[k] === 0) ds.push(dR[k] / px); if (q && dR[k] === 0) ds.push(dT[k] / px);
    }
    // Thin strokes in the original: centerline pixels (local maxima of the distance to the ink's edge) where the
    // stroke is no wider than about 2 source pixels. Each counts as kept when the font's ink covers it, or its
    // edge passes within half a source pixel.
    for (let y = Math.max(1, r[1]); y < Math.min(F.H - 1, r[3]); y++) for (let x = Math.max(1, r[0]); x < Math.min(F.W - 1, r[2]); x++) {
      const k = y * F.W + x; if (!F.tgt[k]) continue; const d = dT[k];
      if (d > px || d < dT[k - 1] || d < dT[k + 1] || d < dT[k - F.W] || d < dT[k + F.W]) continue;
      thin++; if (rm[k] || dR[k] <= 0.5 * px) thinKept++;
    }
    ds.sort((a, c) => a - c);
    letters.push({ i, ch: g.ch, iou: uni ? inter / uni : 1, p95: ds.length ? ds[Math.floor(0.95 * (ds.length - 1))] : 0, holesT: holesIn(F.tgt, F.W, F.H, r), holesF: holesIn(rm, F.W, F.H, r), thin: thin > Math.max(3 * px, minThin) ? thinKept / thin : null });
  });
  const word = iouMasks(F.tgt, rm), capPx = (T.box[3] - T.box[1]) / sc;
  // A font that had to be stretched or slanted to fit has more freedom to look right, so it gets no allowance.
  const distorted = Math.abs((P.sx || 1) - 1) > 0.03 || Math.abs(P.skew || 0) > 0.03;
  return { word, letters, capPx, distorted };
}
// The gate: every letter must match on overlap, edges, counters, and thin strokes. Lettering under 14 px tall
// (cap height in the original) is too small to tell similar fonts apart, so it's never swapped automatically.
const GATE = { word: 0.86, wordTight: 0.80, letter: 0.74, edge: 1.6, edgeFrac: 0.07, thin: 0.6, minCap: 14 };
function gateVerdict(check) {
  const bad = [];
  if (check.capPx < GATE.minCap) bad.push({ why: "small" });
  const edgeMax = Math.max(GATE.edge, GATE.edgeFrac * check.capPx);
  // Overlap is harsh on hairline lettering (a half-pixel shift costs a thin stroke much of its area), so when
  // every letter's edges sit within half the allowed distance, the word needs 0.80 overlap instead of 0.86.
  // Only for letters 24 px or taller (below that, every font's edges land within a pixel or so), set as drawn.
  const tightEdges = check.capPx >= 24 && !check.distorted && check.letters.length && check.letters.every(L => L.p95 <= 0.5 * edgeMax);
  if (check.word < (tightEdges ? GATE.wordTight : GATE.word)) bad.push({ why: "word" });
  for (const L of check.letters) {
    if (L.iou < GATE.letter) bad.push({ ch: L.ch, i: L.i, why: "shape" });
    else if (L.p95 > edgeMax) bad.push({ ch: L.ch, i: L.i, why: "edge" });
    else if (L.holesT !== L.holesF) bad.push({ ch: L.ch, i: L.i, why: "counter" });
    else if (L.thin != null && L.thin < GATE.thin) bad.push({ ch: L.ch, i: L.i, why: "thin" });
  }
  return { pass: !bad.length, bad };
}

/* ---------- Candidates and identification ---------- */
// The family a spin-off is named after (Montserrat for Montserrat Underline), when the index has it.
function baseFamily(fam) {
  if (typeof FX === "undefined" || !FX.ws) return null;
  const words = fam.split(" "); for (let n = words.length - 1; n >= 1; n--) { const b = words.slice(0, n).join(" "); if (FX.ws.has(b)) return b; }
  return null;
}
function nearestOf(ws, w) { return ws && ws.length ? ws.reduce((a, b) => Math.abs(b - w) < Math.abs(a - w) ? b : a) : w; }
// Faces to try: the font index's shortlist when it's loaded (lettering-index.js), else the popular list.
async function candidateFaces(T, text, F) {
  let list = [];
  const strip = T.arc && typeof ARC_STRIPS !== "undefined" ? ARC_STRIPS.get(T) : null;
  if (typeof indexShortlist === "function") { try { list = await indexShortlist(strip ? { ...T, chars: null } : T, text, strip || F); } catch (e) { console.warn("index", e); list = []; } }
  const popular = FONTS.flatMap(([fam, ws]) => ws.map(w => ({ fam, w, wd: 0 })));
  if (!list.length) return popular;
  // The most-used families get a second chance: any the index ranks reasonably near also get fitted.
  if (list.extra) for (const x of list.extra) if (!list.some(c => c.fam === x.fam)) list.push(x);
  return list;
}
// Runs f over items with at most n at a time.
async function pool(items, n, f) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const j = i++; out[j] = await f(items[j], j); } })); return out; }
// Fits each candidate face to word T. Returns results best first, one per family: { fam, w, wd, text, P, iou, face, run }.
async function identifyWord(T, text, opts = {}) {
  text = (text || "").trim(); if (!text) return { results: [], faces: 0 };
  const F = await fitFrame(T), arc = T.arc || null;
  const faces = opts.faces || await candidateFaces(T, text, F);
  const variants = [...new Set([text, opts.exactCase ? null : text.toUpperCase()].filter(Boolean))];
  const quick = [];
  await pool(faces, 6, async c => {
    const face = c.face || await getFace(c.fam, c.w, c.wd || 0); if (!face) return;
    for (const v of variants) {
      const run = shapeWord(face, v); if (!run.inkGlyphs.length) continue;
      for (const P of initialPlacements(run, T, arc)) quick.push({ fam: c.fam, w: c.w, wd: c.wd || 0, label: c.label, src: c.src || face.src, text: v, face, run, P, iou: iouMasks(F.tgt, rasterWord(run, P, F.S, F.ox, F.oy, F.W, F.H)) });
    }
  });
  quick.sort((a, b) => b.iou - a.iou);
  // Refine the best few placements (one per family and weight).
  const seen = new Set(), top = [];
  for (const q of quick) { const k = q.fam + "|" + q.w + "|" + q.wd; if (seen.has(k)) continue; seen.add(k); top.push(q); if (top.length >= (opts.refine || 8)) break; }
  for (const q of top) { const r = refinePlacement(q.run, q.P, F, opts.rounds || 3, true); q.P = r.P; q.iou = r.iou; }
  top.sort((a, b) => b.iou - a.iou);
  // Weights between the indexed ones: for the closest five families, try the weights 100 and 200 either side.
  if (!opts.faces && typeof familyWeights === "function") {
    const tried = new Set(quick.map(q => q.fam + "|" + q.w + "|" + q.wd)), more = [], fams3 = [];
    for (const q of top) if (!fams3.some(x => x.fam === q.fam)) { fams3.push(q); if (fams3.length >= 5) break; }
    for (const b of fams3) for (const w of familyWeights(b.fam)) if (Math.abs(w - b.w) <= 200 && !tried.has(b.fam + "|" + w + "|" + b.wd)) { tried.add(b.fam + "|" + w + "|" + b.wd); more.push({ fam: b.fam, w, wd: b.wd, text: b.text, src: b.src, label: b.label }); }
    await pool(more, 4, async c => {
      const face = await getFace(c.fam, c.w, c.wd); if (!face) return;
      const run = shapeWord(face, c.text); if (!run.inkGlyphs.length) return;
      let best = null; for (const P of initialPlacements(run, T, arc)) { const iou = iouMasks(F.tgt, rasterWord(run, P, F.S, F.ox, F.oy, F.W, F.H)); if (!best || iou > best.iou) best = { ...c, face, run, P, iou }; }
      if (!best) return; const r = refinePlacement(run, best.P, F, opts.rounds || 3, true); best.P = r.P; best.iou = r.iou; top.push(best);
    });
    top.sort((a, b) => b.iou - a.iou);
    // Spin-offs (Montserrat Underline, Playfair Display SC): fit the base family at the same weight and spot,
    // so the two can be recognized as one design below and the plain name kept.
    const bases = [];
    for (const q of top.slice(0, 5)) { const base = baseFamily(q.fam); if (!base) continue; const w = nearestOf(familyWeights(base), q.w); if (!tried.has(base + "|" + w + "|0")) { tried.add(base + "|" + w + "|0"); bases.push({ q, base, w }); } }
    await pool(bases, 4, async ({ q, base, w }) => {
      const face = await getFace(base, w, 0); if (!face) return; const run = shapeWord(face, q.text); if (!run.inkGlyphs.length) return;
      const r = refinePlacement(run, { ...q.P, offs: null, offy: null }, F, opts.rounds || 3, true); top.push({ fam: base, w, wd: 0, text: q.text, src: "google", face, run, P: r.P, iou: r.iou });
    });
    top.sort((a, b) => b.iou - a.iou);
  }
  // One result per design: families that draw this word the same way (Playfair Display and Playfair Display SC
  // for capitals, say) count once, under the shorter name, so they can't make a close call with each other.
  const fams = new Set(), results = [], masks = new Map();
  // Twins are compared at the same placement (no per-letter nudges), so only the letter shapes differ.
  const at = (q, P) => rasterWord(q.run, { ...P, offs: null, offy: null }, F.S, F.ox, F.oy, F.W, F.H);
  const twinOf = (r, q) => { if (Math.abs(r.iou - q.iou) > 0.02 || r.text !== q.text) return false; let m = masks.get(r); if (!m) masks.set(r, m = at(r, r.P)); return iouMasks(m, at(q, r.P)) >= 0.97; };
  for (const q of top.concat(quick)) {
    if (fams.has(q.fam)) continue; fams.add(q.fam);
    const twin = results.findIndex(r => twinOf(r, q));
    if (twin >= 0) { const r = results[twin]; (r.same = r.same || []).push(q.fam); if (q.fam.length < r.fam.length && q.iou >= r.iou - 0.002) { q.same = [r.fam, ...r.same.filter(f => f !== q.fam)]; results[twin] = q; } continue; }
    results.push(q); if (results.length >= (opts.keep || 6)) break;
  }
  return { results, faces: faces.length };
}
// Fits one family (all its weights, or one) closely: used when you pick a font or name one.
async function fitFamily(T, text, fam, weights, extra = {}) {
  const ws = weights && weights.length ? weights : [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const faces = (await pool(ws, 4, async w => (await getFace(fam, w, 0)) ? { fam, w, wd: 0 } : null)).filter(Boolean);
  if (!faces.length) return null;
  const { results } = await identifyWord(T, text, { faces, refine: 3, rounds: 4, keep: 1, ...extra });
  return results[0] || null;
}

/* ---------- Applying a font to a word ---------- */
function useFontResult(T, c) {
  T.pick = { fam: c.fam, w: c.w, wd: c.wd || 0, label: c.label, src: c.src, text: c.text, P: { ...c.P, offs: c.P.offs ? Array.from(c.P.offs) : null }, iou: c.iou, verdict: c.verdict || null };
  T.repl = glyphItems(c.run, c.P, c.face); T.fillRule = "nonzero"; T.mode = "font"; T.outlines = "font";
  assignGlyphLayers(T, T.repl);
}
// A multicolor word's letters each take the color of the traced letter under them.
function assignGlyphLayers(T, items) {
  if (!T.parts) return;
  const pb = T.parts.map(p => ({ li: p.li, b: bboxOf(result.layers[p.li].items[p.ii].outer.q) }));
  for (const it of items) { const b = bboxOf(it.outer.q); let best = T.li, bo = 0; for (const p of pb) { const o = Math.max(0, Math.min(b[2], p.b[2]) - Math.max(b[0], p.b[0])) * Math.max(0, Math.min(b[3], p.b[3]) - Math.max(b[1], p.b[1])); if (o > bo) { bo = o; best = p.li; } } it.li = best; }
}
// Re-fits a remembered pick after a retrace (the word's box may move a little).
async function reapplyPick(T, pick) {
  const face = await getFace(pick.fam, pick.w, pick.wd || 0); if (!face) return false;
  const run = shapeWord(face, pick.text || T.text); if (!run.inkGlyphs.length) return false;
  const F = await fitFrame(T);
  let P0 = pick.P ? { ...pick.P, offs: pick.P.offs ? Float32Array.from(pick.P.offs) : null } : initialPlacements(run, T, T.arc)[0];
  const r = refinePlacement(run, P0, F, 2, true);
  useFontResult(T, { ...pick, face, run, P: r.P, iou: r.iou }); return true;
}

/* ---------- Scoring API (bench/text_score.py) ---------- */
window.vzEngine = {
  async rank(T, text, fam) { const { results } = await identifyWord(T, text, { keep: 20 }); return results.findIndex(r => r.fam === fam || (r.same || []).includes(fam)); },
  async auto(T, text) { const d = await autoDecide(T, text); return d ? { swapped: d.swap, family: d.best && d.best.fam, same: d.best && d.best.same, bad: d.verdict && d.verdict.bad } : { swapped: false }; },
  async fitTrue(T, text, fam, w) { const c = await fitFamily(T, text, fam, [w]); if (!c) return false; T.text = text; useFontResult(T, c); return true; },
};

/* ---------- Automatic swaps ---------- */
// Identifies word T, then swaps the font in only when every letter passes the check and the best family
// clearly beats the next one. Otherwise the results stay as suggestions in the Text tab.
const AUTO_MARGIN = 0.015;
async function autoDecide(T, text) {
  const { results } = await identifyWord(T, text);
  T.results = results; if (!results.length) return { swap: false, best: null, verdict: null, results };
  const best = results[0], check = await letterCheck(T, best.run, best.P), verdict = gateVerdict(check);
  const margin = results[1] ? best.iou - results[1].iou : 1;
  if (verdict.pass && margin < AUTO_MARGIN) verdict.bad.push({ why: "close-call" });
  verdict.pass = verdict.bad.length === 0;
  best.verdict = { pass: verdict.pass, bad: verdict.bad, word: check.word };
  return { swap: verdict.pass, best, verdict, results };
}
// A short label for a result's check.
function verdictLabel(v) {
  if (!v) return "";
  if (v.pass) return "Exact match";
  const letters = [...new Set(v.bad.filter(b => b.ch).map(b => b.ch))];
  if (v.bad.some(b => b.why === "small")) return "Too small to confirm";
  if (v.bad.some(b => b.why === "close-call") && !letters.length) return "Another font is just as close";
  return letters.length ? `Check ${letters.slice(0, 4).join(", ")}` : "Close";
}

/* Compare: the original crop with the font's outline drawn over it. */
async function drawCompare(T, cv) {
  const imgd = await rawImageData(), pad = 4, b = T.box, x0 = Math.max(0, Math.floor(b[0] - pad)), y0 = Math.max(0, Math.floor(b[1] - pad)), x1 = Math.min(result.w, Math.ceil(b[2] + pad)), y1 = Math.min(result.h, Math.ceil(b[3] + pad));
  const w = x1 - x0, h = y1 - y0, S = Math.min(1, 560 / w, 160 / h) * (window.devicePixelRatio || 1);
  cv.width = Math.max(1, Math.round(w * S)); cv.height = Math.max(1, Math.round(h * S)); cv.style.width = cv.width / (window.devicePixelRatio || 1) + "px";
  const g = cv.getContext("2d"), tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h;
  const crop = tmp.getContext("2d").createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y + y0) * result.w + x + x0) * 4, o = (y * w + x) * 4, l = 0.3 * imgd.data[i] + 0.59 * imgd.data[i + 1] + 0.11 * imgd.data[i + 2]; crop.data[o] = crop.data[o + 1] = crop.data[o + 2] = 140 + l * 0.45; crop.data[o + 3] = 255; }
  tmp.getContext("2d").putImageData(crop, 0, 0);
  g.imageSmoothingQuality = "high"; g.drawImage(tmp, 0, 0, cv.width, cv.height);
  if (T.repl) {
    g.setTransform(S, 0, 0, S, -x0 * S, -y0 * S);
    const d = T.repl.map(it => [it.outer, ...it.holes].map(r => VZ.outlineD(r.outline)).join("")).join("");
    g.strokeStyle = "#E0218A"; g.lineWidth = 1.4 / S; g.stroke(new Path2D(d));
  }
}
// Checks a result you picked, for its label in the font list.
async function checkPick(T, c) {
  if (!c.run || c.verdict) return;
  try { const ch = await letterCheck(T, c.run, c.P), v = gateVerdict(ch); c.verdict = { pass: v.pass, bad: v.bad, word: ch.word }; if (T.pick) T.pick.verdict = c.verdict; renderTexts(); } catch (e) { console.warn(e); }
}

/* ---------- Words the reader found ---------- */
function canReadText() { return !!((NATIVE && APP && APP.ocr) || (typeof webOCRReady === "function" && webOCRReady())); }
// Words the user typed or confirmed for this image's lettering: the native reader expects them.
function expectedWords() { return [...new Set(textMemory.flatMap(m => (m.text || "").split(/\s+/)).filter(w => w.length > 1))].slice(0, 50); }
// [{ text, box: [x, y, w, h] fractions, words: [{ text, box, chars?: [{ text, box }] }] }]
async function readOne(url) {
  if (NATIVE && APP && APP.ocr) { const r = await NATIVE.recognize_text(url, expectedWords()); return r && r.lines ? r.lines : []; }
  if (typeof webReadText === "function") return await webReadText({ srcURL: url });
  return [];
}
// The traced colors drawn black on white, from each color's own pixels (not its stacked shapes, which also
// cover the colors above it): all the colors together, and each on its own when there are several. Readers do
// much better on these than on the original when it has film grain, texture, a colored or busy background, or
// a 3D shadow behind the letters.
function layerImages(res) {
  const layers = res.layers.filter(L => !hidden.has(L.hex) && !deletedLayers.has(L.hex) && L.items.length);
  if (!layers.length || !res.lab) return [];
  const W = res.w, H = res.h, pad = Math.round(0.04 * Math.max(W, H)), k = Math.min(2, 2000 / Math.max(W, H));
  const draw = labels => {
    const c = document.createElement("canvas"); c.width = W + 2 * pad; c.height = H + 2 * pad;
    const g = c.getContext("2d"), im = g.createImageData(c.width, c.height), d = im.data; d.fill(255);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (labels.has(res.lab[y * W + x])) { const o = ((y + pad) * c.width + x + pad) * 4; d[o] = d[o + 1] = d[o + 2] = 0; }
    g.putImageData(im, 0, 0);
    // Scale to about 2,000 px on the long side with smoothing, so stair steps don't read as serifs.
    const c2 = document.createElement("canvas"); c2.width = Math.round(c.width * k); c2.height = Math.round(c.height * k);
    const g2 = c2.getContext("2d"); g2.imageSmoothingQuality = "high"; g2.drawImage(c, 0, 0, c2.width, c2.height);
    return { url: c2.toDataURL("image/png"), k, pad: pad * k, W: c2.width, H: c2.height };
  };
  const out = [draw(new Set(layers.map(L => L.label)))];
  if (layers.length > 1) for (const L of layers.slice(0, 5)) out.push(draw(new Set([L.label])));
  return out;
}
// [{ text, box: [x, y, w, h] fractions, words: [{ text, box, chars? }] }]: the original and the layer drawings,
// read separately and merged (a word found in several places is kept once, from the read with more letters).
async function readImageText(j, res) {
  const all = [];
  try { all.push(...(await readOne(j.srcURL))); } catch (e) { console.error(e); }
  if (res) for (const im of layerImages(res)) {
    let lines = []; try { lines = await readOne(im.url); } catch (e) { console.warn(e); continue; }
    // Back to fractions of the original image.
    const fx = b => [((b[0] * im.W) - im.pad) / im.k / res.w, ((b[1] * im.H) - im.pad) / im.k / res.h, b[2] * im.W / im.k / res.w, b[3] * im.H / im.k / res.h];
    for (const l of lines) all.push({ ...l, box: fx(l.box), words: (l.words || []).map(w => ({ ...w, box: fx(w.box), chars: w.chars && w.chars.map(c => ({ ...c, box: fx(c.box) })) })) });
  }
  return mergeReads(all);
}
function mergeReads(lines) {
  const iou = (a, b) => { const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])), I = ix * iy; return I / (a[2] * a[3] + b[2] * b[3] - I || 1); };
  const len = l => (l.text || "").replace(/[^\p{L}\p{N}]/gu, "").length;
  // One- and two-character reads much smaller than the real words are usually artwork read as letters (an X
  // mark, a lightning bolt as 4, sprocket holes as "re"); a lone big letter or monogram is kept.
  const real = lines.filter(l => len(l) >= 3), tall = Math.max(0, ...real.map(l => l.box[3]));
  lines = lines.filter(l => len(l) >= 3 || !tall || l.box[3] >= 0.6 * tall);
  // Beside real words, a lone digit or a lowercase scrap in all-capital lettering is artwork too (a whisk or a
  // star read as 4).
  const caps = real.length && real.every(l => !/\p{Ll}/u.test(l.text));
  lines = lines.filter(l => len(l) >= 3 || !real.length || !(/^[\p{N}\p{P}\p{S}\s]+$/u.test(l.text) || (caps && /^[\p{Ll}\p{P}\s]+$/u.test(l.text))));
  const kept = [];
  for (const l of lines.filter(l => len(l)).sort((a, b) => len(b) - len(a))) {
    // A line overlapping one already kept is the same text read twice; keep the fuller one (sorted first).
    if (kept.some(k => iou(k.box, l.box) > 0.3)) continue;
    kept.push(l);
  }
  return kept;
}
// Adds the reader's words to res.texts: matches them to detected words, and makes new words for the ones the
// outline grouping missed (one or two letters, stacked lines, letters in different colors).
// Overlap of two [x0, y0, x1, y1] boxes as a share of the smaller one.
function boxOverlap(a, b) { const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])); return ix * iy / Math.max(1e-9, Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))); }
function mergeReadWords(res, lines) {
  if (!lines || !lines.length) return;
  const W = res.w, H = res.h, used = new Set();
  for (const T of res.texts) if (!T.removed) for (const p of wordParts(T)) used.add(p.li + ":" + p.ii);
  // A word's box is the union of its letters' boxes when the reader gave them: a word box alone can stretch to
  // take in artwork next to it. Quote marks and periods at either end come off (a star in a C reads as a quote).
  const toPx = b => [b[0] * W, b[1] * H, (b[0] + b[2]) * W, (b[1] + b[3]) * H];
  const words = lines.flatMap((l, ln) => (l.words && l.words.length ? l.words : [{ text: l.text, box: l.box }]).map(w => {
    const chars = (w.chars || []).filter(c => /[\p{L}\p{N}&]/u.test(c.text));
    // Letters' boxes, ignoring one that's much taller than the rest (a letter box can swallow a nearby icon).
    const cb = chars.map(c => toPx(c.box)), med = v => v.slice().sort((a, c) => a - c)[v.length >> 1];
    const hm = cb.length ? med(cb.map(c => c[3] - c[1])) : 0, ok = cb.filter(c => c[3] - c[1] <= 1.5 * hm);
    const b = ok.length ? [Math.min(...ok.map(c => c[0])), Math.min(...ok.map(c => c[1])), Math.max(...ok.map(c => c[2])), Math.max(...ok.map(c => c[3]))] : toPx(w.box);
    return { ln, text: w.text.replace(/^[^\p{L}\p{N}&]+|[^\p{L}\p{N}&]+$/gu, ""), chars: chars.length ? chars : w.chars, b };
  })).filter(w => w.text).filter((w, i, all) => !all.some((v, j) => j < i && boxOverlap(v.b, w.b) > 0.5));
  // Each detected word collects the reader's words over it: centered on it and about its height (a small tagline
  // under a big name stays its own word).
  for (const T of res.texts) { if (T.removed || T.arc) continue; const mine = words.filter(w => { const cx = (w.b[0] + w.b[2]) / 2, cy = (w.b[1] + w.b[3]) / 2, th = T.box[3] - T.box[1], pad = 0.35 * th, wh = w.b[3] - w.b[1]; return wh >= 0.4 * th && wh <= 2.5 * th && cx >= T.box[0] - pad && cx <= T.box[2] + pad && cy >= T.box[1] - 0.2 * th && cy <= T.box[3] + 0.2 * th; }).sort((a, b) => a.b[0] - b.b[0]); if (mine.length) {
    // Words on different lines: the outline grouping joined stacked lines (a name over a tagline). Drop the
    // grouping; each line becomes its own word below.
    const lineOf = w => mine.findIndex(v => Math.min(v.b[3], w.b[3]) - Math.max(v.b[1], w.b[1]) > 0.5 * Math.min(v.b[3] - v.b[1], w.b[3] - w.b[1]));
    const y0 = Math.min(...mine.map(w => w.b[1])), y1 = Math.max(...mine.map(w => w.b[3])), mh = y1 - y0;
    const outside = wordParts(T).some(p => { const it = res.layers[p.li].items[p.ii]; if (!it) return false; const b = bboxOf(it.outer.q), cy = (b[1] + b[3]) / 2; return cy < y0 - 0.25 * mh || cy > y1 + 0.25 * mh; });
    if ((new Set(mine.map(lineOf)).size > 1 || outside) && !memFor(T)) { T.removed = true; T.merged = true; continue; }
    T.ocrText = mine.map(w => w.text).join(" "); T.chars = mine.every(w => w.chars && w.chars.length) ? mine.flatMap(w => w.chars) : null; mine.forEach(w => w.taken = T); } }
  // A line the reader saw as one (a tagline) that the outline grouping split into words becomes one word, so
  // the font is fitted to the whole line with one spacing.
  lines.forEach((l, ln) => {
    const mine = words.filter(w => w.ln === ln && w.taken), Ts = [...new Set(mine.map(w => w.taken))];
    if (Ts.length < 2 || Ts.some(T => T.arc || T.parts || memFor(T)) || new Set(Ts.map(T => T.li)).size > 1) return;
    const hs = Ts.map(T => T.box[3] - T.box[1]); if (Math.max(...hs) > 1.8 * Math.min(...hs)) return;
    const box = Ts.reduce((b, T) => [Math.min(b[0], T.box[0]), Math.min(b[1], T.box[1]), Math.max(b[2], T.box[2]), Math.max(b[3], T.box[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    for (const T of Ts) { T.removed = true; T.merged = true; }
    const ws = words.filter(w => w.ln === ln).sort((a, b) => a.b[0] - b.b[0]);
    const N = { li: Ts[0].li, items: Ts.flatMap(T => T.items), box, id: res.texts.length, text: "", mode: "original", repl: null, src: "read", ocrText: ws.map(w => w.text).join(" "), chars: ws.every(w => w.chars && w.chars.length) ? ws.flatMap(w => w.chars) : null };
    res.texts.push(N); for (const w of ws) w.taken = N;
  });
  // Words with no detected word under them, or spread over detected words in different colors.
  for (const w of words) {
    const bh = w.b[3] - w.b[1], pad = 0.15 * bh, parts = [];
    res.layers.forEach((L, li) => { if (hidden.has(L.hex) || deletedLayers.has(L.hex)) return; L.items.forEach((it, ii) => { if (it.off) return; const b = bboxOf(it.outer.q), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2; if (cx >= w.b[0] - pad && cx <= w.b[2] + pad && cy >= w.b[1] - pad && cy <= w.b[3] + pad && (b[3] - b[1]) >= 0.2 * bh && (b[3] - b[1]) <= 1.8 * bh && (b[2] - b[0]) <= (w.b[2] - w.b[0]) + 2 * pad) parts.push({ li, ii, b }); }); });
    if (!parts.length) continue;
    const layers = new Set(parts.map(p => p.li));
    if (w.taken && layers.size === 1) continue;
    // A lone digit or symbol beside words in another color is artwork the reader took for a character (a
    // lightning bolt read as 4).
    const sibs = words.filter(v => v !== w && v.ln === w.ln && v.taken).map(v => v.taken.li);
    if (/^[\p{N}\p{P}\p{S}]{1,2}$/u.test(w.text) && sibs.length && !sibs.some(li => layers.has(li))) continue;
    // Replace detected words that held only some of these letters.
    const over = res.texts.filter(T => !T.removed && wordParts(T).some(p => parts.some(q => q.li === p.li && q.ii === p.ii)));
    if (over.some(T => T.arc)) continue;   // letters on a circle are read from their own strip
    if (w.taken && over.length === 1 && wordParts(over[0]).length >= parts.length) continue;
    for (const T of over) { if (memFor(T)) continue; T.removed = true; T.merged = true; }
    const count = {}; for (const p of parts) count[p.li] = (count[p.li] || 0) + 1;
    const li = +Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    let box = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of parts) box = [Math.min(box[0], p.b[0]), Math.min(box[1], p.b[1]), Math.max(box[2], p.b[2]), Math.max(box[3], p.b[3])];
    const T = { li, items: parts.filter(p => p.li === li).map(p => p.ii), box, id: res.texts.length, text: "", mode: "original", repl: null, src: "read", ocrText: w.text, chars: w.chars };
    if (layers.size > 1) T.parts = parts.map(p => ({ li: p.li, ii: p.ii }));
    res.texts.push(T);
  }
}

/* ---------- Cleaned letters from the original image ---------- */
// Traces the word's coverage of the letter colors at 2x, with no blur first, so hairlines and serif corners stay.
// Fit tolerances scale with the stroke width but never exceed a third of a source pixel's worth of the thinnest
// stroke, so a 1 px crossbar can't be smoothed away.
async function cleanLetters(T) {
  const C = await wordCoverage(T), sc = Math.max(job.scale, 1), U = 2;
  let A = 0, P = 0; for (let y = 1; y < C.h - 1; y++) for (let x = 1; x < C.w - 1; x++) { const k = y * C.w + x; if (C.f[k] >= 0.5) { A++; if (C.f[k - 1] < 0.5 || C.f[k + 1] < 0.5 || C.f[k - C.w] < 0.5 || C.f[k + C.w] < 0.5) P++; } }
  const sw = Math.max(2, 2 * A / Math.max(1, P)), s = sw * U, thin = Math.max(1.2, sc) * U;
  const fit = { minArea: Math.max(4, (0.7 * sc * U) ** 2), tol: Math.min(0.04 * s, 0.33 * thin), k: Math.max(4, Math.round(Math.min(0.4 * s, 1.2 * thin))), corner: 35, lineTol: Math.min(0.02 * s, 0.2 * thin),
    lineMin: Math.max(16, Math.round(1.0 * s)), snap: 2, snapTol: Math.min(0.08 * s, 0.3 * thin), smooth: Math.min(Math.max(1.6, 0.25 * s), 0.9 * thin), minSeg: Math.min(0.12 * s, 0.4 * thin) };
  const f = upsample(C.f, C.w, C.h, U);
  return traceField(f, C.w * U, C.h * U, U, C.x0, C.y0, fit);
}
async function cleanTextAsync(T) {
  try {
    const res = result, items = await cleanLetters(T);
    if (res !== result || T.mode !== "clean" || !items.length) return;
    T.cleanBase = items; T.repl = applyTidy(T, items); assignGlyphLayers(T, T.repl); T.fillRule = null; render();
  } catch (e) { console.warn("clean", e); }
}
