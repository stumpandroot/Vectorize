/* ---------- Lettering on a circle (badges, seals) ---------- */
// Finds letters whose centers lie on a circle, groups them into runs, reads each run from a straightened strip,
// and gives the run an arc (T.arc) so fonts are fitted along the curve. Straight text is left to the other paths.

// A small seeded random generator, so detection gives the same answer every time.
function arcRand(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function circle3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])); if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], c2 = c[0] * c[0] + c[1] * c[1];
  const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}
// Least-squares circle (Kasa) through points.
function circleFit(pts) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const n = pts.length;
  for (const [x, y] of pts) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [A B C]' = [sxz syz sz]'
  const M = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, n, sz]];
  for (let i = 0; i < 3; i++) { let p = i; for (let j = i + 1; j < 3; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j; [M[i], M[p]] = [M[p], M[i]]; if (Math.abs(M[i][i]) < 1e-12) return null; for (let j = 0; j < 3; j++) if (j !== i) { const f = M[j][i] / M[i][i]; for (let k = i; k < 4; k++) M[j][k] -= f * M[i][k]; } }
  const A = M[0][3] / M[0][0], B = M[1][3] / M[1][1], C = M[2][3] / M[2][2], cx = A / 2, cy = B / 2;
  return { cx, cy, r: Math.sqrt(Math.max(0, C + cx * cx + cy * cy)) };
}
// Angle of point (x, y) around (cx, cy), measured clockwise from straight up (the convention glyphMatrix uses).
const arcAngle = (c, x, y) => Math.atan2(x - c.cx, -(y - c.cy));
const wrapPI = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };

const mad = v => { const s = v.slice().sort((a, b) => a - b), m = s[s.length >> 1]; return v.map(x => Math.abs(x - m)).sort((a, b) => a - b)[v.length >> 1]; };
// True when the letters' baselines lie on circle C rather than on a straight line. Each letter's baseline is
// its point nearest the circle's outside for text along the bottom, or the inside for text over the top; for the
// straight comparison, each letter's lowest point against a fitted line.
function baselinesCurve(polys, C, sMed) {
  const cen = polys.map(q => { let x = 0, y = 0; for (const p of q) { x += p[0]; y += p[1]; } return [x / q.length, y / q.length]; });
  const upper = cen.reduce((s, c) => s + (C.cy - c[1]), 0) > 0;
  const rad = polys.map(q => { const r = q.map(p => Math.hypot(p[0] - C.cx, p[1] - C.cy)); return upper ? Math.min(...r) : Math.max(...r); });
  const lows = polys.map(q => q.reduce((b, p) => p[1] > b[1] ? p : b, q[0]));
  let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = lows.length; for (const [x, y] of lows) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const den = n * sxx - sx * sx, m = Math.abs(den) < 1e-9 ? 0 : (n * sxy - sx * sy) / den, b = (sy - m * sx) / n;
  const lineDev = mad(lows.map(([x, y]) => (y - (m * x + b)) / Math.hypot(1, m))), arcDev = mad(rad);
  return lineDev > 0.08 * sMed && arcDev < 0.6 * lineDev;
}
// Runs of letters on circles in result res: [{ li, items, cx, cy, upper, theta, span, rIn, rOut }].
function findArcRuns(res) {
  const W = res.w, H = res.h, sc = Math.max(job.scale, 1), out = [];
  res.layers.forEach((L, li) => {
    if (hidden.has(L.hex) || deletedLayers.has(L.hex)) return;
    const pool = [];
    L.items.forEach((it, ii) => { if (it.off) return; const b = bboxOf(it.outer.q), s = Math.max(b[2] - b[0], b[3] - b[1]); if (s >= 5 * sc && s <= 0.2 * Math.min(W, H)) pool.push({ ii, c: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], s, b }); });
    if (pool.length < 4) return;
    // Each piece's nearest neighbors of a similar size: the letters next to it in a line, straight or curved.
    const near = pool.map(p => pool.filter(q => q !== p && q.s < 1.8 * p.s && p.s < 1.8 * q.s && Math.hypot(q.c[0] - p.c[0], q.c[1] - p.c[1]) < 2.2 * Math.max(p.s, q.s))
      .sort((q1, q2) => Math.hypot(q1.c[0] - p.c[0], q1.c[1] - p.c[1]) - Math.hypot(q2.c[0] - p.c[0], q2.c[1] - p.c[1])).slice(0, 6));
    const rnd = arcRand(li + 7), cands = [];
    // Candidate circles through a piece and two of its neighbors' neighbors, so the three are spread along a line
    // of letters rather than bunched. Each is scored by the longest unbroken run of similar letters on it.
    for (let t = 0; t < 900; t++) {
      const ai = (rnd() * pool.length) | 0, a = pool[ai]; if (near[ai].length < 1) continue;
      const b = near[ai][(rnd() * near[ai].length) | 0], bi = pool.indexOf(b), far = near[bi].filter(q => q !== a && !near[ai].includes(q)); if (!far.length) continue;
      const c = far[(rnd() * far.length) | 0], s0 = (a.s + b.s + c.s) / 3;
      const C = circle3(a.c, b.c, c.c); if (!C || C.r < 1.5 * s0 || C.r > 40 * s0) continue;
      const run = runOn(pool, C, s0, a); if (run.length >= 4) cands.push({ C, run, s0 });
    }
    cands.sort((x, y) => y.run.length - x.run.length);
    const used = new Set();
    for (const cd of cands) {
      if (cd.run.some(p => used.has(p))) continue;
      // Refit the circle to the run's letters and collect the run again on it.
      const C = circleFit(cd.run.map(p => p.c)) || cd.C, run = runOn(pool, C, cd.s0, cd.run[cd.run.length >> 1]).filter(p => !used.has(p));
      if (run.length < 4) continue;
      const A = checkArc(L, run, C, cd.s0); if (!A) continue;
      for (const p of run) used.add(p);
      out.push({ li, items: run.map(p => p.ii), ...A });
    }
  });
  return out;
}
// The unbroken run of similar-size pieces on circle C that contains piece p0 (gaps up to 2.6 letters).
function runOn(pool, C, s0, p0) {
  const on = pool.filter(p => Math.abs(Math.hypot(p.c[0] - C.cx, p.c[1] - C.cy) - C.r) < 0.45 * Math.max(p.s, s0) && p.s < 1.9 * s0 && p.s > 0.45 * s0);
  if (!on.includes(p0)) return [];
  const a0 = arcAngle(C, p0.c[0], p0.c[1]);
  on.forEach(p => { p.d = wrapPI(arcAngle(C, p.c[0], p.c[1]) - a0); }); on.sort((x, y) => x.d - y.d);
  let k = on.indexOf(p0), lo = k, hi = k;
  while (lo > 0 && (on[lo].d - on[lo - 1].d) * C.r <= 2.6 * s0) lo--;
  while (hi < on.length - 1 && (on[hi + 1].d - on[hi].d) * C.r <= 2.6 * s0) hi++;
  return on.slice(lo, hi + 1);
}
// Whether a run of pieces on circle C is a line of letters on a curve; if so, its ring and angles.
function checkArc(L, run, C, sMed) {
  run.forEach(p => { p.a = arcAngle(C, p.c[0], p.c[1]); });
  // Angles relative to the run's own middle, so a run across the bottom (angle ±π) doesn't wrap.
  const phi0 = Math.atan2(run.reduce((s, p) => s + Math.sin(p.a), 0), run.reduce((s, p) => s + Math.cos(p.a), 0));
  run.forEach(p => { p.d = wrapPI(p.a - phi0); }); run.sort((a, b) => a.d - b.d);
  const span = run[run.length - 1].d - run[0].d;
  // Real curvature: the arc bows by at least half a letter (a straight row fits a huge circle too), and the
  // letters' baselines follow the circle better than any straight line (mixed-case straight text can fit a
  // circle through its centers, but its baselines sit on a line).
  if (C.r * (1 - Math.cos(span / 2)) < 0.5 * sMed) return null;
  if (!baselinesCurve(run.map(p => L.items[p.ii].outer.q), C, sMed)) return null;
  const rs = [], ds = [];
  for (const p of run) for (const q of L.items[p.ii].outer.q) { rs.push(Math.hypot(q[0] - C.cx, q[1] - C.cy)); ds.push(wrapPI(arcAngle(C, q[0], q[1]) - phi0)); }
  rs.sort((a, b) => a - b);
  const rIn = rs[Math.floor(0.01 * (rs.length - 1))], rOut = rs[Math.ceil(0.99 * (rs.length - 1))];
  // One line of letters: the ring the run occupies is about one letter deep. Letters from stacked lines can sit
  // on a shared circle by chance, but their ring is two or more letters deep.
  const depth = run.map(p => { const r = L.items[p.ii].outer.q.map(q => Math.hypot(q[0] - C.cx, q[1] - C.cy)); return Math.max(...r) - Math.min(...r); }).sort((a, b) => a - b);
  if (rOut - rIn > 1.45 * depth[depth.length >> 1]) return null;
  const dmin = Math.min(...ds), dmax = Math.max(...ds), mid = phi0 + (dmin + dmax) / 2;
  // Over the top (center below the letters) reads clockwise; along the bottom reads the other way.
  return { cx: C.cx, cy: C.cy, upper: Math.cos(mid) > 0, theta: wrapPI(mid), span: dmax - dmin, rIn, rOut };
}

// The run straightened into a strip, letters upright, reading left to right. Returns a canvas and the ink mask.
async function arcStrip(A, hex) {
  const imgd = await rawImageData(), D = imgd.data, IW = imgd.width, IH = imgd.height;
  const h0 = A.rOut - A.rIn, pad = 0.5 * h0, k = Math.max(1, Math.min(4, 64 / Math.max(1, h0)));
  const rMid = (A.rIn + A.rOut) / 2, span = A.span + 2 * h0 / rMid;   // a letter of margin each end: readers skip letters at the edge
  const W = Math.max(8, Math.round(span * rMid * k)), H = Math.max(8, Math.round((h0 + 2 * pad) * k));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), out = g.createImageData(W, H), O = out.data, mask = new Uint8Array(W * H);
  const col = fromHex(hex), samp = (x, y, ch) => { const ix = Math.max(0, Math.min(IW - 2, Math.floor(x))), iy = Math.max(0, Math.min(IH - 2, Math.floor(y))), fx = x - ix, fy = y - iy, i = (iy * IW + ix) * 4;
    return (D[i + ch] * (1 - fx) + D[i + 4 + ch] * fx) * (1 - fy) + (D[i + IW * 4 + ch] * (1 - fx) + D[i + IW * 4 + 4 + ch] * fx) * fy; };
  // Background: the median of the strip's top and bottom rows.
  const pix = [];
  for (let y = 0; y < H; y++) {
    const R = A.upper ? A.rOut + pad - y / k : A.rIn - pad + y / k;
    for (let x = 0; x < W; x++) {
      const th = A.upper ? A.theta - span / 2 + x / k / rMid : A.theta + span / 2 - x / k / rMid;
      const px = A.cx + R * Math.sin(th), py = A.cy - R * Math.cos(th), j = (y * W + x) * 4;
      const a = samp(px, py, 3) / 255;
      for (let ch = 0; ch < 3; ch++) O[j + ch] = Math.round(samp(px, py, ch) * a + 255 * (1 - a));
      O[j + 3] = 255;
      if (y === 0 || y === H - 1) pix.push([O[j], O[j + 1], O[j + 2]]);
    }
  }
  const med = ch => pix.map(p => p[ch]).sort((a, b) => a - b)[pix.length >> 1], bg = [med(0), med(1), med(2)];
  // Only the letters' ring: artwork just inside or outside it (a badge's border) is painted over with the background.
  const inBand = y => { const R = A.upper ? A.rOut + pad - y / k : A.rIn - pad + y / k; return R >= A.rIn - 0.04 * h0 && R <= A.rOut + 0.04 * h0; };
  for (let y = 0; y < H; y++) { const keep = inBand(y); for (let x = 0; x < W; x++) { const i = y * W + x, j = i * 4;
    if (!keep) { O[j] = bg[0]; O[j + 1] = bg[1]; O[j + 2] = bg[2]; continue; }
    const dc = Math.hypot(O[j] - col[0], O[j + 1] - col[1], O[j + 2] - col[2]), db = Math.hypot(O[j] - bg[0], O[j + 1] - bg[1], O[j + 2] - bg[2]); mask[i] = dc < db ? 1 : 0; } }
  g.putImageData(out, 0, 0);
  return { canvas: c, mask, W, H };
}
async function readStrip(canvas) {
  const url = canvas.toDataURL("image/png");
  try {
    if (NATIVE && APP && APP.ocr) { const r = await NATIVE.recognize_text(url, expectedWords()); return r && r.lines ? r.lines : []; }
    if (typeof webReadText === "function") return await webReadText({ srcURL: url }, { line: true });
  } catch (e) { console.warn("arc read", e); }
  return [];
}
// Adds a word for each run of letters on a circle, with its arc and what the reader saw in the straightened strip.
// Words the straight grouping made from the same letters give way to it.
// The straightened ink of each arc word, for the font index (kept off the word so undo copies stay small).
const ARC_STRIPS = new WeakMap();
async function addArcWords(res) {
  if (res.arcsDone) return; res.arcsDone = true;
  let runs = []; try { runs = findArcRuns(res); } catch (e) { console.warn("arcs", e); return; }
  for (const A of runs) {
    const L = res.layers[A.li], strip = await arcStrip(A, L.hex);
    const lines = await readStrip(strip.canvas), text = lines.map(l => l.text).join(" ").replace(/\s+/g, " ").trim();
    // A real arc of letters reads as words once straightened. Letters that only happen to sit on a circle
    // (the ends of two stacked words) read as nothing, or as a few stray characters: leave them alone.
    if (text.replace(/[^\p{L}\p{N}&]/gu, "").length < 0.6 * A.items.length) continue;
    // Letters the reader already read as straight words keep that reading unless the straightened strip reads
    // more of them: a gently curved line reads fine straight, and a false arc must not take a word apart. A tie goes
    // to the strip: the run has passed every curve check, and a reader guesses more on a curved line.
    const letters = s => (s || "").replace(/[^\p{L}\p{N}&]/gu, "").length;
    const over = res.texts.filter(T => !T.removed && !T.arc && wordParts(T).some(p => p.li === A.li && A.items.includes(p.ii)));
    if (over.some(T => memFor(T))) continue;
    if (letters(text) < over.reduce((n, T) => n + letters(T.ocrText), 0)) continue;
    let box = [Infinity, Infinity, -Infinity, -Infinity]; for (const ii of A.items) { const b = bboxOf(L.items[ii].outer.q); box = [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])]; }
    for (const T of over) { T.removed = true; T.merged = true; }
    const T = { li: A.li, items: A.items.slice(), box, id: res.texts.length, text: "", mode: "original", repl: null, src: "arc", ocrText: text || null,
      arc: { cx: A.cx, cy: A.cy, upper: A.upper, theta: A.theta, span: A.span, rIn: A.rIn, rOut: A.rOut, r: (A.rIn + A.rOut) / 2 } };
    ARC_STRIPS.set(T, { tgt: strip.mask, W: strip.W, H: strip.H, S: 1, ox: 0, oy: 0 });
    res.texts.push(T);
  }
}
