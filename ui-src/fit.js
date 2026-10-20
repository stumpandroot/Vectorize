/* Vectorize curve fitting and shape matching, ported from the Mac engine (fitting.py).
   Points are [x, y] arrays. Outlines are closed: segment i runs from V[i] to V[i+1]. */
const VZ = (() => {
  const hyp = Math.hypot;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, s) => [a[0] * s, a[1] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const unit = v => { const n = hyp(v[0], v[1]); return n > 1e-9 ? [v[0] / n, v[1] / n] : [0, 0]; };
  const DEG = Math.PI / 180;

  /* ---------- Geometry helpers ---------- */
  function resampleClosed(pts, step = 1) {
    const n = pts.length, cum = [0];
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; cum.push(cum[i] + hyp(b[0] - a[0], b[1] - a[1])); }
    const total = cum[n]; if (total < 3 * step) return pts.map(p => p.slice());
    const m = Math.max(8, Math.round(total / step)), out = []; let j = 0;
    for (let k = 0; k < m; k++) {
      const t = total * k / m; while (j < n - 1 && cum[j + 1] < t) j++;
      const a = pts[j], b = pts[(j + 1) % n], L = cum[j + 1] - cum[j], f = L > 0 ? (t - cum[j]) / L : 0;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    return out;
  }
  function area(p) { let s = 0; for (let i = 0, n = p.length; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; s += a[0] * b[1] - a[1] * b[0]; } return s / 2; }
  function lineDist(p, a, b) { const ab = sub(b, a), L = hyp(ab[0], ab[1]); return L < 1e-9 ? hyp(p[0] - a[0], p[1] - a[1]) : Math.abs(cross(ab, sub(p, a))) / L; }
  function maxLineDist(arr, i0, i1, a, b) { let m = 0; for (let i = i0; i <= i1; i++) { const d = lineDist(arr[i], a, b); if (d > m) m = d; } return m; }
  function circleFit(p) {   // Kasa least squares: x² + y² = A x + B y + C
    let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sz = 0, sxz = 0, syz = 0; const n = p.length;
    for (const [x, y] of p) { const z = x * x + y * y; sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; sz += z; sxz += x * z; syz += y * z; }
    const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], v = [sxz, syz, sz];
    const s = solve3(M, v); if (!s) return null;
    const cx = s[0] / 2, cy = s[1] / 2, r = Math.sqrt(Math.max(s[2] + cx * cx + cy * cy, 1e-9));
    return { c: [cx, cy], r };
  }
  function solve3(M, v) {
    const a = M.map((r, i) => [...r, v[i]]);
    for (let i = 0; i < 3; i++) {
      let p = i; for (let k = i + 1; k < 3; k++) if (Math.abs(a[k][i]) > Math.abs(a[p][i])) p = k;
      if (Math.abs(a[p][i]) < 1e-12) return null; [a[i], a[p]] = [a[p], a[i]];
      for (let k = 0; k < 3; k++) if (k !== i) { const f = a[k][i] / a[i][i]; for (let j = i; j < 4; j++) a[k][j] -= f * a[i][j]; }
    }
    return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
  }

  /* ---------- Bézier fitting (Schneider) ---------- */
  function bez(c, t) { const mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, d = 3 * mt * t * t, e = t * t * t; return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]]; }
  function bez1(c, t) { const mt = 1 - t; return [3 * mt * mt * (c[1][0] - c[0][0]) + 6 * mt * t * (c[2][0] - c[1][0]) + 3 * t * t * (c[3][0] - c[2][0]), 3 * mt * mt * (c[1][1] - c[0][1]) + 6 * mt * t * (c[2][1] - c[1][1]) + 3 * t * t * (c[3][1] - c[2][1])]; }
  function bez2(c, t) { return [6 * (1 - t) * (c[2][0] - 2 * c[1][0] + c[0][0]) + 6 * t * (c[3][0] - 2 * c[2][0] + c[1][0]), 6 * (1 - t) * (c[2][1] - 2 * c[1][1] + c[0][1]) + 6 * t * (c[3][1] - 2 * c[2][1] + c[1][1])]; }
  function chordU(d) { const L = [0]; for (let i = 1; i < d.length; i++) L.push(L[i - 1] + hyp(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1])); const T = L[L.length - 1]; return L.map((v, i) => T > 0 ? v / T : i / (d.length - 1)); }
  function generate(d, u, t1, t2) {
    const p0 = d[0], p3 = d[d.length - 1]; let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    for (let i = 0; i < d.length; i++) {
      const t = u[i], mt = 1 - t, A1 = mul(t1, 3 * mt * mt * t), A2 = mul(t2, 3 * mt * t * t);
      c00 += dot(A1, A1); c01 += dot(A1, A2); c11 += dot(A2, A2);
      const base = bez([p0, p0, p3, p3], t), tmp = sub(d[i], base); x0 += dot(A1, tmp); x1 += dot(A2, tmp);
    }
    const det = c00 * c11 - c01 * c01, seg = hyp(p3[0] - p0[0], p3[1] - p0[1]), eps = 1e-6 * seg;
    let a1 = -1, a2 = -1; if (Math.abs(det) > 1e-12) { a1 = (x0 * c11 - c01 * x1) / det; a2 = (c00 * x1 - c01 * x0) / det; }
    if (a1 < eps || a2 < eps || a1 > 2 * seg || a2 > 2 * seg) a1 = a2 = seg / 3;
    return [p0, add(p0, mul(t1, a1)), add(p3, mul(t2, a2)), p3];
  }
  function maxErr(d, c, u) { let e = -1, k = 0; for (let i = 0; i < d.length; i++) { const q = bez(c, u[i]), v = hyp(q[0] - d[i][0], q[1] - d[i][1]); if (v > e) { e = v; k = i; } } return [e, Math.min(Math.max(k, 1), d.length - 2)]; }
  function reparam(d, c, u) {
    return u.map((t, i) => { const q = sub(bez(c, t), d[i]), q1 = bez1(c, t), q2 = bez2(c, t); const den = dot(q1, q1) + dot(q, q2); const nu = Math.abs(den) > 1e-12 ? t - dot(q, q1) / den : t; return Math.min(1, Math.max(0, nu)); });
  }
  function fitCubic(d, t1, t2, err, depth = 0) {
    if (d.length < 3) { const dist = hyp(d[d.length - 1][0] - d[0][0], d[d.length - 1][1] - d[0][1]) / 3; return [[d[0], add(d[0], mul(t1, dist)), add(d[d.length - 1], mul(t2, dist)), d[d.length - 1]]]; }
    let u = chordU(d), c = generate(d, u, t1, t2), [e, split] = maxErr(d, c, u);
    if (e < err) return [c];
    if (e < err * 4) for (let it = 0; it < 12; it++) { u = reparam(d, c, u); c = generate(d, u, t1, t2); [e, split] = maxErr(d, c, u); if (e < err) return [c]; }
    if (depth > 24 || d.length < 6) return [c];
    if (d.length >= 8) split = Math.min(Math.max(split, 3), d.length - 4);
    const w = Math.max(1, Math.min(5, split, d.length - 1 - split));
    let tc = unit(sub(d[split - w], d[split + w])); if (!tc[0] && !tc[1]) tc = unit(sub(d[split - 1], d[split]));
    return fitCubic(d.slice(0, split + 1), t1, tc, err, depth + 1).concat(fitCubic(d.slice(split), mul(tc, -1), t2, err, depth + 1));
  }

  /* ---------- Corners and straight runs ---------- */
  function turning(p, k) { const n = p.length, out = new Float64Array(n); for (let i = 0; i < n; i++) { const a = sub(p[i], p[(i - k + n * 4) % n]), b = sub(p[(i + k) % n], p[i]); out[i] = Math.abs(Math.atan2(cross(a, b), dot(a, b))) / DEG; } return out; }
  function detectCorners(p, k, thresh) {
    const n = p.length; if (n < 4 * k + 4) return [];
    const t1 = turning(p, k), t2 = turning(p, 2 * k), th = turning(p, Math.max(2, Math.round(k / 2))), out = [];
    for (let i = 0; i < n; i++) {
      // A smooth curve turns about twice as much over twice the distance, so a large t2 rules a curve out. Two
      // corners close together (the ends of a thin stem, a small serif) also raise t2, so a sharp turn within
      // the window (more than 65 degrees) is a corner either way. Either way, most of a corner's turn happens
      // within half the window; a small round end (a stroke's cap, a dot) turns evenly along its whole length.
      if (!(t1[i] > thresh && th[i] > 0.6 * t1[i] && (t2[i] < 1.6 * t1[i] + 5 || t1[i] > 65))) continue;
      let mx = -1; for (let j = i - k; j <= i + k; j++) mx = Math.max(mx, t1[(j + n) % n]);
      if (t1[i] >= mx - 1e-9 && (!out.length || i - out[out.length - 1] > k)) out.push(i);
    }
    if (out.length > 1 && out[0] + n - out[out.length - 1] <= k) out.pop();
    return out;
  }
  const VZ_BOW = {};   // test hooks: shallow (degrees), x (false turns off corner intersection)
  // A run is straight when its points stay within tol of the chord. Past a noise floor, the points must
  // also stray to both sides: points on a gentle curve all fall on one side, so the curve stays a curve.
  function isStraight(arr, i0, i1, tol, floor = Infinity) {
    const a = arr[i0], ab = sub(arr[i1], a), L = hyp(ab[0], ab[1]); if (L < 1e-9) return false;
    let mx = 0, sum = 0;
    for (let i = i0; i <= i1; i++) { const d = cross(ab, sub(arr[i], a)) / L; mx = Math.max(mx, Math.abs(d)); sum += d; }
    if (mx > tol) return false;
    return mx <= floor || Math.abs(sum / (i1 - i0 + 1)) <= 0.45 * mx;
  }
  function straightRuns(p, tol, minLen, floor) {
    const n = p.length, runs = []; let i = 0;
    while (i < n - minLen) {
      let j = i + minLen;
      if (!isStraight(p, i, j, tol, floor)) { i++; continue; }
      let step = 8;
      while (j < n - 1) { const j2 = Math.min(n - 1, j + step); if (isStraight(p, i, j2, tol, floor)) j = j2; else { if (step === 1) break; step = Math.max(1, step >> 1); } }
      runs.push([i, j]); i = j;
    }
    return runs;
  }

  /* ---------- Pieces ---------- */
  function endTangent(d, atStart, k) { k = Math.min(k, d.length - 1); return atStart ? unit(sub(d[k], d[0])) : unit(sub(d[d.length - 1 - k], d[d.length - 1])); }
  function tryArc(d, tol, tS, tE) {
    if (d.length < 6) return null;
    const f = circleFit(d); if (!f) return null; const { c, r } = f;
    const chord = hyp(d[d.length - 1][0] - d[0][0], d[d.length - 1][1] - d[0][1]);
    if (r > 30 * Math.max(chord, 1) || r < 1.5) return null;
    for (const p of d) if (Math.abs(hyp(p[0] - c[0], p[1] - c[1]) - r) > tol) return null;
    for (const [t, p] of [[tS, d[0]], [tE, d[d.length - 1]]]) { if (!t) continue; const rad = unit(sub(p, c)), tang = [-rad[1], rad[0]]; if (Math.abs(dot(tang, t)) < Math.cos(4 * DEG)) return null; }
    let total = 0, prev = Math.atan2(d[0][1] - c[1], d[0][0] - c[0]);
    for (let i = 1; i < d.length; i++) { const a = Math.atan2(d[i][1] - c[1], d[i][0] - c[0]); let da = a - prev; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; total += da; prev = a; }
    if (Math.abs(total) > 340 * DEG) return null;
    return ["A", r, Math.abs(total) > Math.PI ? 1 : 0, total > 0 ? 1 : 0];
  }
  function fitPiece(d, tol, tS, tE, k) {
    const arc = tryArc(d, tol * 0.8, tS, tE); if (arc) return [[d[d.length - 1], arc]];
    const t1 = tS || endTangent(d, true, k), t2 = tE ? mul(tE, -1) : endTangent(d, false, k);
    return fitCubic(d, t1, t2, tol).map(c => [c[3], ["C", sub(c[1], c[0]), sub(c[2], c[3])]]);
  }
  function smoothClosed(p, sigma) {
    const r = Math.ceil(3 * sigma), ker = []; let s = 0; for (let i = -r; i <= r; i++) { const v = Math.exp(-0.5 * (i / sigma) ** 2); ker.push(v); s += v; }
    const n = p.length; return p.map((_, i) => { let x = 0, y = 0; for (let j = -r; j <= r; j++) { const q = p[(i + j + n * 8) % n], w = ker[j + r] / s; x += q[0] * w; y += q[1] * w; } return [x, y]; });
  }

  function fitOutline(pts, tol, k, cornerDeg, lineTol, lineMin, smoothSigma = 1.6, straightFloor = Infinity, blurCorner = 0) {
    let p = resampleClosed(pts, 1); const n = p.length;
    if (n < 10) { const V = p.filter((_, i) => i % Math.max(1, n >> 2) === 0); return { V, segs: V.map(() => ["L"]) }; }
    let corners = detectCorners(p, k, cornerDeg);
    if (corners.length) { const c0 = corners[0]; p = p.slice(c0).concat(p.slice(0, c0)); corners = corners.map(c => (c - c0 + n) % n); }
    const pieces = corners.length ? corners.concat([n]) : [0, n];
    smoothSigma = Math.min(smoothSigma, Math.max(1.6, 0.03 * n));      // small loops (counters) barely move
    let ps = smoothClosed(p, smoothSigma);
    if (corners.length) {
      const w = new Float64Array(n).fill(1), R = Math.max(4, Math.round(smoothSigma * 2.5));
      for (const c of corners) for (let dd = -R; dd <= R; dd++) { const i = (c + dd + n) % n; w[i] = Math.min(w[i], Math.abs(dd) / R); }
      ps = p.map((q, i) => [q[0] + (ps[i][0] - q[0]) * w[i], q[1] + (ps[i][1] - q[1]) * w[i]]);
    }
    p = ps; const pc = p.concat([p[0]]);
    const V = [], segs = [], fits = [];
    for (let pi = 0; pi < pieces.length - 1; pi++) {
      const piece = pc.slice(pieces[pi], pieces[pi + 1] + 1);
      let runs;
      // A short edge between two corners (the top of a stem, a serif's face) is straight when it stays within
      // tolerance, even if it bows to one side: blur rounds both of its ends toward the same side.
      // A short piece that bows by a fifth of its length or more is a rounded end (a stroke's cap, a dot), not an edge.
      const chordLen = hyp(piece[piece.length - 1][0] - piece[0][0], piece[piece.length - 1][1] - piece[0][1]);
      const shortEdge = piece.length <= Math.max(1.25 * lineMin, 3 * k) && maxLineDist(piece, 0, piece.length - 1, piece[0], piece[piece.length - 1]) <= Math.max(lineTol, 0.2 * chordLen);
      // Blur rounds both ends of a short edge, so its test skips the first and last half-window of points, and
      // holds the rest to half the usual tolerance (it doesn't need to stray to both sides).
      const m = shortEdge ? Math.min(Math.round(k / 2), Math.floor(piece.length / 4)) : 0;
      if (corners.length && piece.length >= 4 && isStraight(piece, m, piece.length - 1 - m, shortEdge ? 0.5 * lineTol : lineTol, shortEdge ? Infinity : straightFloor)) runs = [[0, piece.length - 1]];
      else runs = straightRuns(piece, lineTol * 0.5, lineMin, straightFloor * 0.5);
      let marks = [], cur = 0;
      for (const [a, b] of runs) { if (a > cur) marks.push([cur, a, "curve"]); marks.push([a, b, "line"]); cur = b; }
      if (cur < piece.length - 1) marks.push([cur, piece.length - 1, "curve"]);
      const merged = []; for (const m of marks) { if (m[2] === "curve" && m[1] - m[0] < 3 && merged.length) merged[merged.length - 1][1] = m[1]; else merged.push(m.slice()); }
      marks = merged;
      // Neighboring straight runs that together are still straight are one edge (noise can split a long stem).
      for (let j = 0; j + 1 < marks.length; ) {
        const a = marks[j], b = marks[j + 1];
        if (a[2] === "line" && b[2] === "line" && isStraight(piece, a[0], b[1], lineTol, straightFloor)) { a[1] = b[1]; marks.splice(j + 1, 1); }
        else if (a[2] === "line" && b[2] === "curve" && j + 2 < marks.length && marks[j + 2][2] === "line" && b[1] - b[0] <= Math.max(4, k) && isStraight(piece, a[0], marks[j + 2][1], lineTol, straightFloor)) { a[1] = marks[j + 2][1]; marks.splice(j + 1, 2); }
        else j++;
      }
      // Straight runs that meet at a shallow bend are facets of one gentle curve, not two edges:
      // real straight edges either continue (almost no bend) or meet at a corner.
      const shallow = VZ_BOW.shallow != null ? VZ_BOW.shallow : 35;
      if (shallow > 0) {
        const dir = m => unit(sub(piece[m[1]], piece[m[0]]));
        const lineIdx = marks.map((m, j) => m[2] === "line" ? j : -1).filter(j => j >= 0);
        const demote = new Set();
        for (let q = 0; q + 1 < lineIdx.length; q++) {
          const a = lineIdx[q], b = lineIdx[q + 1];
          if (b - a > 2 || (b - a === 2 && marks[a + 1][1] - marks[a + 1][0] > lineMin)) continue;
          const ang = Math.acos(Math.max(-1, Math.min(1, dot(dir(marks[a]), dir(marks[b]))))) / DEG;
          // Only short runs are facets of a curve; a long straight run next to a curve (a stem running into a bowl) stays.
          const long = m => m[1] - m[0] >= 2.5 * lineMin;
          if (ang > 4 && ang < shallow) { if (!long(marks[a])) demote.add(a); if (!long(marks[b])) demote.add(b); }
        }
        if (demote.size) {
          const out = [];
          marks.forEach((m, j) => { const kind = demote.has(j) ? "curve" : m[2]; if (out.length && kind === "curve" && out[out.length - 1][2] === "curve") out[out.length - 1][1] = m[1]; else out.push([m[0], m[1], kind]); });
          marks = out;
        }
      }
      // A short straight run with curve on both sides (no corner at either end) is a flat spot on a curve:
      // drawn as a line, it shows as a kink.
      {
        let changed = false;
        for (let j = 1; j + 1 < marks.length; j++) if (marks[j][2] === "line" && marks[j - 1][2] === "curve" && marks[j + 1][2] === "curve" && marks[j][1] - marks[j][0] < 2.5 * lineMin) { marks[j][2] = "curve"; changed = true; }
        if (changed) { const out = []; for (const m of marks) { if (out.length && m[2] === "curve" && out[out.length - 1][2] === "curve") out[out.length - 1][1] = m[1]; else out.push(m.slice()); } marks = out; }
      }
      const smoothLoop = !corners.length;
      marks.forEach(([a, b, kind], j) => {
        const seg = piece.slice(a, b + 1); V.push(seg[0].slice());
        if (kind === "line") { segs.push(["L"]); fits[segs.length - 1] = lineFit(seg); return; }
        let tS = null, tE = null;
        if (j > 0 && marks[j - 1][2] === "line") tS = unit(sub(piece[marks[j - 1][1]], piece[marks[j - 1][0]]));
        if (j + 1 < marks.length && marks[j + 1][2] === "line") tE = unit(sub(piece[marks[j + 1][1]], piece[marks[j + 1][0]]));
        if (smoothLoop && marks.length === 1) { const tc = unit(sub(pc[1], pc[pc.length - 2])); tS = tc; tE = tc; }
        else if (smoothLoop) {
          if (j === 0 && marks[marks.length - 1][2] === "line") tS = unit(sub(piece[marks[marks.length - 1][1]], piece[marks[marks.length - 1][0]]));
          if (j === marks.length - 1 && marks[0][2] === "line") tE = unit(sub(piece[marks[0][1]], piece[marks[0][0]]));
        }
        // A curve that meets a straight edge at a visible angle (a soft corner, below the corner threshold) keeps
        // its own end direction: forced tangent to the edge, it bends back in an S just before the join.
        const agrees = (t, atStart) => { if (!t || seg.length < 2 * k) return t; const e = endTangent(seg, atStart, k), c = atStart ? dot(e, t) : -dot(e, t); return c >= Math.cos(12 * DEG) ? t : null; };
        tS = agrees(tS, true); tE = agrees(tE, false);
        const fitted = fitPiece(seg, tol, tS, tE, k);
        fitted.forEach(([endp, sg], q) => { segs.push(sg); if (q < fitted.length - 1) V.push(endp.slice()); });
      });
    }
    // Where a straight edge runs into a curve, the shared point sits on the edge's fitted line: a raw outline
    // point there can be a pixel off it, which shows as a step where the curve leaves the edge.
    for (let i = 0, nV = V.length; i < nV; i++) {
      const ip = (i - 1 + nV) % nV, A = segs[ip][0] === "L" ? fits[ip] : null, B = segs[i][0] === "L" ? fits[i] : null;
      if (!!A === !!B) continue;
      if (segs[ip][0] === "A" || segs[i][0] === "A") continue;
      const F = A || B, t = dot(sub(V[i], F.c), F.d); V[i] = [F.c[0] + F.d[0] * t, F.c[1] + F.d[1] * t];
      // The curve's handle at the join follows the fitted line too (handles are stored relative to their point).
      const sg = A ? segs[i] : segs[ip], hi = A ? 1 : 2;
      if (sg[0] === "C") { const h = sg[hi], L = hyp(h[0], h[1]), sgn = dot(h, F.d) < 0 ? -1 : 1; if (L > 0 && Math.abs(dot(h, F.d)) > 0.97 * L) sg[hi] = [F.d[0] * sgn * L, F.d[1] * sgn * L]; }
    }
    if (VZ_BOW.x !== false) intersectCorners(V, segs, fits, k);
    if (blurCorner > 0) collapseBlurCorners(V, segs, fits, blurCorner);
    return { V, segs };
  }
  // Total least squares line through the middle of a straight run (its ends are rounded by blur).
  function lineFit(seg) {
    const m = seg.length, a = Math.floor(m * 0.2), b = Math.max(a + 2, Math.ceil(m * 0.8)), pts = seg.slice(a, Math.min(m, b));
    if (pts.length < 3) return null;
    let cx = 0, cy = 0; for (const q of pts) { cx += q[0]; cy += q[1]; } cx /= pts.length; cy /= pts.length;
    let sxx = 0, sxy = 0, syy = 0; for (const q of pts) { const x = q[0] - cx, y = q[1] - cy; sxx += x * x; sxy += x * y; syy += y * y; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { c: [cx, cy], d: [Math.cos(th), Math.sin(th)], len: hyp(seg[m - 1][0] - seg[0][0], seg[m - 1][1] - seg[0][1]) };
  }
  // Where two straight runs meet at a corner, the corner sits where the lines cross, not on the
  // rounded-off curve the blur leaves behind. Moves are capped so a wrong fit can't distort the shape.
  function intersectCorners(V, segs, fits, k) {
    const n = V.length;
    for (let i = 0; i < n; i++) {
      const ip = (i - 1 + n) % n, A = fits[ip], B = fits[i];
      if (!A || !B || segs[ip][0] !== "L" || segs[i][0] !== "L") continue;
      const den = cross(A.d, B.d); if (Math.abs(den) < Math.sin(20 * DEG)) continue;   // nearly parallel: leave it
      const t = cross(sub(B.c, A.c), B.d) / den, X = [A.c[0] + A.d[0] * t, A.c[1] + A.d[1] * t];
      const move = hyp(X[0] - V[i][0], X[1] - V[i][1]);
      if (move <= Math.max(1.5, 1.2 * k) && move <= 0.35 * Math.min(A.len, B.len)) V[i] = X;
    }
  }
  // A tiny curve between two straight edges that meet at an angle is a sharp corner the image's blur rounded off
  // (chord up to maxChord, edges at least twice as long): the curve goes and the edges meet where they cross.
  // Designed rounded corners are larger than the blur, so they stay.
  function collapseBlurCorners(V, segs, fits, maxChord) {
    for (let guard = 0; guard < 400; guard++) {
      const n = V.length; if (n < 4) return; let done = true;
      for (let i = 0; i < n; i++) {
        const ip = (i - 1 + n) % n, inx = (i + 1) % n, A = fits[ip], B = fits[inx];
        if (segs[i][0] === "L" || segs[ip][0] !== "L" || segs[inx][0] !== "L" || !A || !B) continue;
        const a = V[i], b = V[inx], chord = hyp(b[0] - a[0], b[1] - a[1]);
        if (chord > maxChord || A.len < 2 * chord || B.len < 2 * chord) continue;
        const den = cross(A.d, B.d); if (Math.abs(den) < Math.sin(30 * DEG)) continue;
        const t = cross(sub(B.c, A.c), B.d) / den, X = [A.c[0] + A.d[0] * t, A.c[1] + A.d[1] * t];
        if (hyp(X[0] - (a[0] + b[0]) / 2, X[1] - (a[1] + b[1]) / 2) > 1.5 * chord) continue;
        V[i] = X; V.splice(inx, 1); segs.splice(i, 1); fits.splice(i, 1);
        if (inx === 0) V.unshift(V.pop());   // the corner was the last point; segments still line up from it
        done = false; break;
      }
      if (done) return;
    }
  }
  const fmt = v => { const r = Math.round(v * 100) / 100; return Object.is(r, -0) ? "0" : String(r); };
  const P = q => fmt(q[0]) + " " + fmt(q[1]);
  function outlineD(o) {
    const n = o.V.length; let s = "M" + P(o.V[0]);
    o.segs.forEach((sg, i) => {
      const a = o.V[i], b = o.V[(i + 1) % n];
      if (sg[0] === "L") s += "L" + P(b);
      else if (sg[0] === "A") s += `A${fmt(sg[1])} ${fmt(sg[1])} 0 ${sg[2]} ${sg[3]} ${P(b)}`;
      else s += "C" + P(add(a, sg[1])) + " " + P(add(b, sg[2])) + " " + P(b);
    });
    return s + "Z";
  }

  /* ---------- Shapes ---------- */
  function rrectPoints(Q, n = 720) {
    const hw = Q.w / 2, hh = Q.h / 2, r = Q.r || 0, per = Math.max(4, n >> 2), out = [];
    for (const [sx, sy, a0] of [[1, -1, -90], [1, 1, 0], [-1, 1, 90], [-1, -1, 180]]) {
      const cx = sx * (hw - r), cy = sy * (hh - r);
      for (let i = 0; i < per; i++) { const t = (a0 + 90 * i / (per - 1)) * DEG; out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
    }
    const th = Q.angle * DEG, c = Math.cos(th), s = Math.sin(th);
    return out.map(([x, y]) => [Q.cx + x * c - y * s, Q.cy + x * s + y * c]);
  }
  function rectCorners(Q) { const hw = Q.w / 2, hh = Q.h / 2, th = Q.angle * DEG, c = Math.cos(th), s = Math.sin(th); return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [Q.cx + x * c - y * s, Q.cy + x * s + y * c]); }
  function boundary(S, n = 720) {
    if (S.pts) return S.pts;
    const Q = S.params;
    if (S.kind === "circle") return Array.from({ length: n }, (_, i) => { const t = 2 * Math.PI * i / n; return [Q.cx + Q.r * Math.cos(t), Q.cy + Q.r * Math.sin(t)]; });
    if (S.kind === "ellipse") { const th = Q.angle * DEG; return Array.from({ length: n }, (_, i) => { const t = 2 * Math.PI * i / n, x = Q.rx * Math.cos(t), y = Q.ry * Math.sin(t); return [Q.cx + x * Math.cos(th) - y * Math.sin(th), Q.cy + x * Math.sin(th) + y * Math.cos(th)]; }); }
    if (S.kind === "rect" || S.kind === "rounded_rect") return rrectPoints(Q, n);
    return Q.points;
  }
  function rrectDist(p, Q) {
    const th = Q.angle * DEG, c = Math.cos(th), s = Math.sin(th), r = Q.r || 0;
    return p.map(q => { const dx = q[0] - Q.cx, dy = q[1] - Q.cy, x = dx * c + dy * s, y = -dx * s + dy * c; const qx = Math.abs(x) - (Q.w / 2 - r), qy = Math.abs(y) - (Q.h / 2 - r); return Math.abs(hyp(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r); });
  }
  function ellipseDist(p, cx, cy, a, b, ang) {
    const th = ang * DEG, c = Math.cos(th), s = Math.sin(th);
    return p.map(q => { const dx = q[0] - cx, dy = q[1] - cy, x = dx * c + dy * s, y = -dx * s + dy * c; const k0 = hyp(x / a, y / b), k1 = hyp(x / (a * a), y / (b * b)); return Math.abs(k0 * (k0 - 1) / Math.max(k1, 1e-9)); });
  }
  function polyDist(p, poly) {
    const m = poly.length, segs = [];
    for (let i = 0; i < m; i++) { const a = poly[i], b = poly[(i + 1) % m], ab = sub(b, a); segs.push([a, ab, Math.max(dot(ab, ab), 1e-9)]); }
    return p.map(q => { let best = Infinity; for (const [a, ab, L2] of segs) { const t = Math.min(1, Math.max(0, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / L2)); const dx = q[0] - a[0] - t * ab[0], dy = q[1] - a[1] - t * ab[1]; const d = dx * dx + dy * dy; if (d < best) best = d; } return Math.sqrt(best); });
  }
  const maxOf = a => a.reduce((m, v) => v > m ? v : m, 0);
  const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));

  function moments(p) {   // area-weighted centroid and covariance of the filled polygon
    let A = 0, cx = 0, cy = 0, xx = 0, yy = 0, xy = 0; const n = p.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % n], c = x0 * y1 - x1 * y0;
      A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
      xx += (x0 * x0 + x0 * x1 + x1 * x1) * c; yy += (y0 * y0 + y0 * y1 + y1 * y1) * c; xy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c;
    }
    A /= 2; cx /= 6 * A; cy /= 6 * A; xx = xx / (12 * A) - cx * cx; yy = yy / (12 * A) - cy * cy; xy = xy / (24 * A) - cx * cy;
    return { A: Math.abs(A), cx, cy, xx, yy, xy };
  }
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cross(sub(lo[lo.length - 1], lo[lo.length - 2]), sub(q, lo[lo.length - 2])) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(sub(up[up.length - 1], up[up.length - 2]), sub(q, up[up.length - 2])) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function minAreaRect(pts) {
    const h = hull(pts); let best = null;
    for (let i = 0; i < h.length; i++) {
      const e = unit(sub(h[(i + 1) % h.length], h[i])), nrm = [-e[1], e[0]];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const q of h) { const a = dot(q, e), b = dot(q, nrm); a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
      const ar = (a1 - a0) * (b1 - b0);
      if (!best || ar < best.ar) { const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2; best = { ar, cx: e[0] * ca + nrm[0] * cb, cy: e[1] * ca + nrm[1] * cb, w: a1 - a0, h: b1 - b0, angle: Math.atan2(e[1], e[0]) / DEG }; }
    }
    return best;
  }
  function snapAngle(a, step = 90, tol = 2.5) { const r = Math.round(a / step) * step; return Math.abs(a - r) <= tol ? r : a; }
  const mod = (a, m) => ((a % m) + m) % m;

  function approxPoly(p, eps) {   // Douglas–Peucker on a closed outline
    const n = p.length; let i0 = 0, i1 = 0, far = -1;
    for (let i = 0; i < n; i++) { const d = hyp(p[i][0] - p[0][0], p[i][1] - p[0][1]); if (d > far) { far = d; i1 = i; } }
    const rdp = (a, b, out) => { let m = -1, k = -1; for (let i = a + 1; i < b; i++) { const d = lineDist(p[i % n], p[a % n], p[b % n]); if (d > m) { m = d; k = i; } } if (m > eps) { rdp(a, k, out); rdp(k, b, out); } else out.push(p[a % n]); };
    const out = []; rdp(i0, i1, out); rdp(i1, n, out); return out;
  }
  function refineVertices(p, approx, zone) {
    const m = approx.length, lines = [];
    for (let i = 0; i < m; i++) {
      const a = approx[i], b = approx[(i + 1) % m], ab = sub(b, a), L2 = dot(ab, ab); if (L2 < 4) return null;
      let q = p.filter(pt => { const t = dot(sub(pt, a), ab) / L2; return t > 0 && t < 1 && Math.abs(cross(ab, sub(pt, a))) / Math.sqrt(L2) < zone && hyp(pt[0] - a[0], pt[1] - a[1]) > zone && hyp(pt[0] - b[0], pt[1] - b[1]) > zone; });
      if (q.length < 4) q = [a, b];
      const c = [q.reduce((s, v) => s + v[0], 0) / q.length, q.reduce((s, v) => s + v[1], 0) / q.length];
      let sxx = 0, syy = 0, sxy = 0; for (const v of q) { const dx = v[0] - c[0], dy = v[1] - c[1]; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); lines.push([c, [Math.cos(th), Math.sin(th)]]);
    }
    return approx.map((v, i) => { const [c1, d1] = lines[(i - 1 + m) % m], [c2, d2] = lines[i], den = cross(d1, d2); if (Math.abs(den) < 1e-6) return v; const t = cross(sub(c2, c1), d2) / den; return add(c1, mul(d1, t)); });
  }
  function nelderMead(f, x0, iters = 500) {
    const n = x0.length; let pts = [x0.slice()]; for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += Math.abs(x[i]) > 1e-3 ? 0.05 * x[i] : 0.05; pts.push(x); }
    let vals = pts.map(f);
    for (let it = 0; it < iters; it++) {
      const ord = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]); pts = ord.map(i => pts[i]); vals = ord.map(i => vals[i]);
      if (Math.abs(vals[n] - vals[0]) < 1e-7) break;
      const c = new Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
      const xr = c.map((v, j) => v + (v - pts[n][j])), fr = f(xr);
      if (fr < vals[0]) { const xe = c.map((v, j) => v + 2 * (v - pts[n][j])), fe = f(xe); if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; } }
      else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
      else { const xc = c.map((v, j) => v + 0.5 * (pts[n][j] - v)), fc = f(xc); if (fc < vals[n]) { pts[n] = xc; vals[n] = fc; } else { for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j])); vals[i] = f(pts[i]); } } }
    }
    return pts[0];
  }
  function buildRegular(x, nv, star) { const [cx, cy, r1, r2, ph] = x; return Array.from({ length: nv }, (_, i) => { const t = ph + i * 2 * Math.PI / nv, r = star && i % 2 ? r2 : r1; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; }); }
  function optimizeRegular(p, cen, r1, r2, phase, nv, star) {
    const sp = p.filter((_, i) => i % Math.max(1, Math.floor(p.length / 300)) === 0);
    const x = nelderMead(v => { const d = polyDist(sp, buildRegular(v, nv, star)); return d.reduce((s, q) => s + q * q, 0) / d.length; }, [cen[0], cen[1], r1, r2, phase]);
    const step = 2 * Math.PI / (star ? nv / 2 : nv);
    for (const target of [-Math.PI / 2, Math.PI / 2, 0]) { const k = Math.round((x[4] - target) / step); if (Math.abs(x[4] - (target + k * step)) < 2 * DEG) { x[4] = target + k * step; break; } }
    return buildRegular(x, nv, star);
  }
  function polyStar(p, eps, ok) {
    let approx = approxPoly(p, eps); const m = approx.length;
    if (m < 3 || m > 16) return null;
    approx = refineVertices(p, approx, 3 * eps); if (!approx) return null;
    const zone = 3 * eps;
    const okV = (dist, verts) => { const keep = dist.filter((_, i) => { const q = p[i]; return !verts.some(v => hyp(q[0] - v[0], q[1] - v[1]) < zone); }); return keep.length > 8 && ok(keep); };
    const cen = [approx.reduce((s, v) => s + v[0], 0) / m, approx.reduce((s, v) => s + v[1], 0) / m];
    let items = approx.map(v => ({ v, r: hyp(v[0] - cen[0], v[1] - cen[1]), a: Math.atan2(v[1] - cen[1], v[0] - cen[0]) })).sort((a, b) => a.a - b.a);
    const rad = items.map(i => i.r), angs = items.map(i => i.a);
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length, std = a => { const mu = mean(a); return Math.sqrt(mean(a.map(v => (v - mu) ** 2))); };
    if (m <= 8 && std(rad) / mean(rad) < 0.03) {
      const gaps = angs.map((a, i) => (i < m - 1 ? angs[i + 1] : angs[0] + 2 * Math.PI) - a);
      if (Math.max(...gaps.map(g => Math.abs(g - 2 * Math.PI / m))) < 4 * DEG) {
        const poly = optimizeRegular(p, cen, mean(rad), mean(rad), angs[0], m, false), dist = polyDist(p, poly);
        if (okV(dist, poly)) { const names = { 3: "Triangle", 4: "Square", 5: "Pentagon", 6: "Hexagon", 7: "Heptagon", 8: "Octagon" }; return { kind: "polygon", params: { points: poly }, maxDev: maxOf(dist), label: names[m] || m + "-sided polygon" }; }
      }
    }
    if (m % 2 === 0 && m >= 8) {
      let A = rad.filter((_, i) => i % 2 === 0), B = rad.filter((_, i) => i % 2 === 1);
      const firstOuter = rad[0] > rad[1]; if (mean(A) < mean(B)) [A, B] = [B, A];
      if (std(A) / mean(A) < 0.04 && std(B) / mean(B) < 0.05 && mean(B) < 0.85 * mean(A)) {
        const r1 = firstOuter ? mean(A) : mean(B), r2 = firstOuter ? mean(B) : mean(A);
        const poly = optimizeRegular(p, cen, r1, r2, angs[0], m, true), dist = polyDist(p, poly);
        if (okV(dist, poly)) return { kind: "star", params: { points: poly }, maxDev: maxOf(dist), label: (m / 2) + "-point star" };
      }
    }
    return null;
  }

  function matchShape(p, tol) {
    if (p.length < 16 || Math.abs(area(p)) < 30) return null;
    const rmsLim = tol * 0.6, ok = d => maxOf(d) <= tol && rms(d) <= rmsLim;
    const cf = circleFit(p);
    if (cf) { const d = p.map(q => Math.abs(hyp(q[0] - cf.c[0], q[1] - cf.c[1]) - cf.r)); if (ok(d)) return { kind: "circle", params: { cx: cf.c[0], cy: cf.c[1], r: cf.r }, maxDev: maxOf(d), label: "Circle" }; }
    const M = moments(p);
    { const tr = M.xx + M.yy, det = M.xx * M.yy - M.xy * M.xy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det)), l1 = tr / 2 + disc, l2 = tr / 2 - disc;
      if (l2 > 0) {
        let a = 2 * Math.sqrt(l1), b = 2 * Math.sqrt(l2), ang = 0.5 * Math.atan2(2 * M.xy, M.xx - M.yy) / DEG, angS = snapAngle(ang);
        let d = ellipseDist(p, M.cx, M.cy, a, b, angS); if (!ok(d) && angS !== ang) { angS = ang; d = ellipseDist(p, M.cx, M.cy, a, b, ang); }
        if (ok(d) && Math.min(a, b) > 1) { if (mod(angS, 180) === 90) { [a, b] = [b, a]; angS = 0; } return { kind: "ellipse", params: { cx: M.cx, cy: M.cy, rx: a, ry: b, angle: mod(angS, 180) }, maxDev: maxOf(d), label: "Ellipse" }; }
      } }
    const R = minAreaRect(p);
    if (R && Math.min(R.w, R.h) > 2) {
      let { w, h } = R, angS = snapAngle(R.angle); if (mod(angS, 180) === 90) { [w, h] = [h, w]; angS = 0; }
      const base = { cx: R.cx, cy: R.cy, w, h, angle: mod(angS, 90) ? mod(angS, 180) : 0 };
      let d = rrectDist(p, { ...base, r: 0 }); if (ok(d)) return { kind: "rect", params: { ...base, r: 0 }, maxDev: maxOf(d), label: "Rectangle" };
      let best = null; for (let i = 0; i < 40; i++) { const rr = Math.min(w, h) * (0.04 + 0.46 * i / 39), d2 = rrectDist(p, { ...base, r: rr }), sc = d2.reduce((s, v) => s + v, 0) / d2.length; if (!best || sc < best[0]) best = [sc, rr, d2]; }
      if (best && ok(best[2]) && best[1] > 2 * tol) {
        const pill = best[1] >= 0.44 * Math.min(w, h), r = pill ? Math.min(w, h) / 2 : best[1];
        return { kind: "rounded_rect", params: { ...base, r }, maxDev: maxOf(best[2]), label: pill ? "Pill" : "Rounded rectangle" };
      }
    }
    for (const eps of [tol, 1.6 * tol, 2.5 * tol, 4 * tol]) { const f = polyStar(p, eps, ok); if (f) return f; }
    return null;
  }
  function relativeResidual(p, S, zone) {
    let d = polyDist(p, boundary(S, 1440)), verts = S.sharp ? (S.sharp.length ? S.sharp : null) : S.kind === "rect" ? rectCorners(S.params) : (S.kind === "polygon" || S.kind === "star") ? S.params.points : null;
    if (verts) { const keep = d.filter((_, i) => !verts.some(v => hyp(p[i][0] - v[0], p[i][1] - v[1]) < zone)); if (keep.length > 8) d = keep; }
    return rms(d) / Math.max(Math.sqrt(Math.abs(area(p))), 1e-6);
  }
  function overlapPct(a, b) {
    const all = a.concat(b); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of all) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    x0 -= 2; y0 -= 2; x1 += 2; y1 += 2; const sc = 200 / Math.max(1, x1 - x0, y1 - y0), W = Math.ceil((x1 - x0) * sc) + 1, H = Math.ceil((y1 - y0) * sc) + 1;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d", { willReadFrequently: true });
    const draw = (poly, color) => { g.fillStyle = color; g.beginPath(); poly.forEach((q, i) => (i ? g.lineTo : g.moveTo).call(g, (q[0] - x0) * sc, (q[1] - y0) * sc)); g.closePath(); g.fill(); };
    g.globalCompositeOperation = "lighter"; draw(a, "rgb(255,0,0)"); draw(b, "rgb(0,255,0)");
    const px = g.getImageData(0, 0, W, H).data; let inter = 0, uni = 0;
    for (let i = 0; i < px.length; i += 4) { const ra = px[i] > 127, gb = px[i + 1] > 127; if (ra || gb) uni++; if (ra && gb) inter++; }
    return 100 * inter / Math.max(uni, 1);
  }
  function shapeElement(S, id) {
    if (S.el) return S.el(id);
    const Q = S.params;
    if (S.kind === "circle") return `<circle id="${id}" cx="${fmt(Q.cx)}" cy="${fmt(Q.cy)}" r="${fmt(Q.r)}"/>`;
    const tr = a => Math.abs(a) > 0.01 ? ` transform="rotate(${fmt(a)} ${fmt(Q.cx)} ${fmt(Q.cy)})"` : "";
    if (S.kind === "ellipse") return `<ellipse id="${id}" cx="${fmt(Q.cx)}" cy="${fmt(Q.cy)}" rx="${fmt(Q.rx)}" ry="${fmt(Q.ry)}"${tr(Q.angle)}/>`;
    if (S.kind === "rect" || S.kind === "rounded_rect") return `<rect id="${id}" x="${fmt(Q.cx - Q.w / 2)}" y="${fmt(Q.cy - Q.h / 2)}" width="${fmt(Q.w)}" height="${fmt(Q.h)}"${Q.r > 0 ? ` rx="${fmt(Q.r)}"` : ""}${tr(Q.angle)}/>`;
    return `<polygon id="${id}" points="${Q.points.map(q => fmt(q[0]) + "," + fmt(q[1])).join(" ")}"/>`;
  }
  function shapeD(S) {
    if (S.dStr) return S.dStr;
    const Q = S.params;
    if (S.kind === "circle") return `M${fmt(Q.cx + Q.r)} ${fmt(Q.cy)}A${fmt(Q.r)} ${fmt(Q.r)} 0 1 0 ${fmt(Q.cx - Q.r)} ${fmt(Q.cy)}A${fmt(Q.r)} ${fmt(Q.r)} 0 1 0 ${fmt(Q.cx + Q.r)} ${fmt(Q.cy)}Z`;
    if (S.kind === "ellipse") { const th = Q.angle * DEG, ux = Math.cos(th) * Q.rx, uy = Math.sin(th) * Q.rx; return `M${fmt(Q.cx + ux)} ${fmt(Q.cy + uy)}A${fmt(Q.rx)} ${fmt(Q.ry)} ${fmt(Q.angle)} 1 0 ${fmt(Q.cx - ux)} ${fmt(Q.cy - uy)}A${fmt(Q.rx)} ${fmt(Q.ry)} ${fmt(Q.angle)} 1 0 ${fmt(Q.cx + ux)} ${fmt(Q.cy + uy)}Z`; }
    if (S.kind === "rounded_rect") {
      const hw = Q.w / 2, hh = Q.h / 2, r = Q.r, th = Q.angle * DEG, c = Math.cos(th), s = Math.sin(th), T = (x, y) => P([Q.cx + x * c - y * s, Q.cy + x * s + y * c]), A = `A${fmt(r)} ${fmt(r)} 0 0 1 `;
      return `M${T(-hw + r, -hh)}L${T(hw - r, -hh)}${A}${T(hw, -hh + r)}L${T(hw, hh - r)}${A}${T(hw - r, hh)}L${T(-hw + r, hh)}${A}${T(-hw, hh - r)}L${T(-hw, -hh + r)}${A}${T(-hw + r, -hh)}Z`;
    }
    const pts = S.kind === "rect" ? rectCorners(Q) : Q.points; return "M" + pts.map(P).join("L") + "Z";
  }

  /* ---------- Snapping across the image ---------- */
  function cluster(values, tol) {
    const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]), out = new Array(values.length); let grp = [];
    const flush = () => { const m = grp.reduce((s, i) => s + values[i], 0) / grp.length; grp.forEach(i => out[i] = m); };
    for (const i of order) { if (grp.length && values[i] - values[grp[grp.length - 1]] > tol) { flush(); grp = []; } grp.push(i); }
    if (grp.length) flush(); return out;
  }
  function snapOutlines(outlines, snapDeg, tol, minLen = 2) {
    const refs = { x: [], y: [] };
    outlines.forEach((o, oi) => {
      const n = o.V.length; if (n < 2) return;
      for (const [axis, target] of [["y", 0], ["x", 90]]) {
        const parent = o.V.map((_, i) => i), find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
        o.segs.forEach((sg, i) => {
          if (sg[0] !== "L") return; const a = o.V[i], b = o.V[(i + 1) % n], d = sub(b, a); if (hyp(d[0], d[1]) < minLen) return;
          const ang = mod(Math.abs(Math.atan2(d[1], d[0]) / DEG), 180);
          if (Math.abs(ang - target) <= snapDeg || Math.abs(ang - (target ? 180 - target : 180)) <= snapDeg) parent[find(i)] = find((i + 1) % n);
        });
        const groups = {}; o.V.forEach((_, i) => (groups[find(i)] = groups[find(i)] || []).push(i));
        const ax = axis === "y" ? 1 : 0;
        for (const g of Object.values(groups)) if (g.length > 1) refs[axis].push([oi, g, g.reduce((s, i) => s + o.V[i][ax], 0) / g.length]);
      }
    });
    for (const axis of ["x", "y"]) { const ax = axis === "y" ? 1 : 0, snapped = cluster(refs[axis].map(r => r[2]), tol); refs[axis].forEach(([oi, g], idx) => g.forEach(i => outlines[oi].V[i][ax] = snapped[idx])); }
  }
  function snapShapes(shapes, tol) {
    const cs = shapes.filter(s => s.kind === "circle"); if (cs.length < 2) return;
    const rs = cs.map(s => s.params.r).sort((a, b) => a - b), med = rs[rs.length >> 1];
    const sr = cluster(cs.map(s => s.params.r), Math.max(tol * 0.5, 0.01 * med)); cs.forEach((s, i) => s.params.r = sr[i]);
    for (const k of ["cx", "cy"]) { const v = cluster(cs.map(s => s.params[k]), tol); cs.forEach((s, i) => s.params[k] = v[i]); }
  }

  /* ---------- Contours from a float mask (marching squares at 0.5) ---------- */
  function maskContours(f, W, H) {
    // Pad by one cell of zeros so every contour closes.
    const w = W + 2, h = H + 2, v = (x, y) => (x <= 0 || y <= 0 || x > W || y > H) ? 0 : f[(y - 1) * W + (x - 1)];
    const pts = new Map(), adj = new Map();
    const ekey = (x, y, vert) => ((y * (w + 1) + x) << 1) | vert;
    const pt = (x, y, vert) => { const k = ekey(x, y, vert); if (!pts.has(k)) { const a = v(x, y), b = vert ? v(x, y + 1) : v(x + 1, y), t = (0.5 - a) / (b - a); pts.set(k, vert ? [x - 1 + 0.5, y - 1 + t + 0.5] : [x - 1 + t + 0.5, y - 1 + 0.5]); } return k; };
    const link = (a, b) => { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
      const a = v(x, y) > 0.5, b = v(x + 1, y) > 0.5, c = v(x + 1, y + 1) > 0.5, d = v(x, y + 1) > 0.5, idx = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = () => pt(x, y, 0), R = () => pt(x + 1, y, 1), B = () => pt(x, y + 1, 0), L = () => pt(x, y, 1);
      switch (idx) {
        case 1: case 14: link(L(), B()); break;
        case 2: case 13: link(B(), R()); break;
        case 3: case 12: link(L(), R()); break;
        case 4: case 11: link(T(), R()); break;
        case 6: case 9: link(T(), B()); break;
        case 7: case 8: link(L(), T()); break;
        case 5: case 10: {
          const center = (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4 > 0.5;
          if ((idx === 5) === center) { link(L(), T()); link(B(), R()); } else { link(T(), R()); link(L(), B()); }
          break;
        }
      }
    }
    const seen = new Set(), out = [];
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const loop = []; let prev = -1, cur = start;
      while (cur !== undefined && !seen.has(cur)) { seen.add(cur); loop.push(pts.get(cur)); const nb = adj.get(cur); const next = nb[0] !== prev ? nb[0] : nb[1]; prev = cur; cur = next; }
      if (loop.length >= 4) out.push(loop);
    }
    return out;
  }
  function inside(pt, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function nest(contours) {
    const n = contours.length, areas = contours.map(c => Math.abs(area(c)));
    const boxes = contours.map(c => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of c) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return [x0, y0, x1, y1]; });
    const order = areas.map((_, i) => i).sort((a, b) => areas[b] - areas[a]), parent = new Array(n).fill(-1), depth = new Array(n).fill(0);
    order.forEach((i, ii) => {
      const p0 = contours[i][0]; let best = -1;
      for (let jj = 0; jj < ii; jj++) { const j = order[jj], b = boxes[j]; if (p0[0] < b[0] || p0[0] > b[2] || p0[1] < b[1] || p0[1] > b[3]) continue; if (inside(p0, contours[j]) && (best === -1 || areas[j] < areas[best])) best = j; }
      parent[i] = best;
    });
    for (const i of order) depth[i] = parent[i] === -1 ? 0 : depth[parent[i]] + 1;
    const items = new Map(); for (let i = 0; i < n; i++) if (depth[i] % 2 === 0) items.set(i, []);
    for (let i = 0; i < n; i++) if (depth[i] % 2 === 1 && items.has(parent[i])) items.get(parent[i]).push(i);
    return [...items.entries()];
  }

/* ---------- Template shapes: rounded polygons and stars, hearts, arrows, arcs, rings ---------- */
  const POLY_NAMES = { 3: "Triangle", 4: "Square", 5: "Pentagon", 6: "Hexagon", 7: "Heptagon", 8: "Octagon" };
  const rot = (x, y, c, s) => [x * c - y * s, x * s + y * c];

  // Corner fillets: each corner gets an arc of radius rc tangent to both edges (clamped to fit).
  function roundCorners(V, rc) {
    const m = V.length;
    return V.map((C, i) => {
      const P = V[(i - 1 + m) % m], N = V[(i + 1) % m], u1 = unit(sub(P, C)), u2 = unit(sub(N, C));
      const half = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2)))) / 2;
      if (rc <= 1e-6 || half < 1e-3 || half > Math.PI / 2 - 1e-3) return { C, T1: C, T2: C, r: 0 };
      let t = rc / Math.tan(half); const maxT = 0.5 * Math.min(hyp(P[0] - C[0], P[1] - C[1]), hyp(N[0] - C[0], N[1] - C[1]));
      if (t > maxT) t = maxT;
      const r = t * Math.tan(half), bis = unit(add(u1, u2));
      return { C, T1: add(C, mul(u1, t)), T2: add(C, mul(u2, t)), r, sweep: cross(sub(C, P), sub(N, C)) > 0 ? 1 : 0, ctr: add(C, mul(bis, r / Math.sin(half))) };
    });
  }
  function roundedPolyline(V, rc, arcN = 6) {
    const out = [];
    for (const c of roundCorners(V, rc)) {
      if (!c.r) { out.push(c.C); continue; }
      const a1 = Math.atan2(c.T1[1] - c.ctr[1], c.T1[0] - c.ctr[0]); let d = Math.atan2(c.T2[1] - c.ctr[1], c.T2[0] - c.ctr[0]) - a1;
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      for (let k = 0; k <= arcN; k++) { const a = a1 + d * k / arcN; out.push([c.ctr[0] + c.r * Math.cos(a), c.ctr[1] + c.r * Math.sin(a)]); }
    }
    return out;
  }
  function roundedPolyD(V, rc) {
    const cs = roundCorners(V, rc), m = cs.length;
    if (cs.every(c => !c.r)) return "M" + V.map(P).join("L") + "Z";
    let d = "M" + P(cs[0].T2);
    for (let i = 1; i <= m; i++) { const c = cs[i % m]; d += "L" + P(c.T1); if (c.r) d += `A${fmt(c.r)} ${fmt(c.r)} 0 0 ${c.sweep} ${P(c.T2)}`; }
    return d + "Z";
  }
  function resampleN(poly, n) {
    const m = poly.length, cum = [0];
    for (let i = 0; i < m; i++) { const a = poly[i], b = poly[(i + 1) % m]; cum.push(cum[i] + hyp(b[0] - a[0], b[1] - a[1])); }
    const T = cum[m], out = []; let j = 0;
    for (let k = 0; k < n; k++) { const t = T * k / n; while (j < m - 1 && cum[j + 1] < t) j++; const a = poly[j], b = poly[(j + 1) % m], L = cum[j + 1] - cum[j], f = L > 0 ? (t - cum[j]) / L : 0; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
    return out;
  }
  // Two-way fit cost: outline to shape, and shape back to outline, so a shape can't shrink onto part of the outline.
  function chamfer(pSub, poly) {
    const a = polyDist(pSub, poly), b = polyDist(resampleN(poly, 60), pSub);
    let s = 0; for (const v of a) s += v * v; let t = 0; for (const v of b) t += v * v;
    return s / a.length + t / b.length;
  }

  const HEART = (() => {
    const pts = []; for (let i = 0; i < 240; i++) { const t = 2 * Math.PI * i / 240; pts.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]); }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return pts.map(([x, y]) => [(x - (x0 + x1) / 2) / (x1 - x0), (y - (y0 + y1) / 2) / (y1 - y0)]);
  })();

  // Each family turns a parameter vector into a shape: a dense boundary for fitting, the sharp
  // points (ignored when grading, because blur always rounds them), and SVG output.
  const FAMILY = {
    polygon: {
      build(x, o) {
        const [cx, cy, R, th] = x, rc = Math.abs(x[4] || 0), N = o.N;
        const V = Array.from({ length: N }, (_, i) => { const a = th + 2 * Math.PI * i / N; return [cx + Math.abs(R) * Math.cos(a), cy + Math.abs(R) * Math.sin(a)]; });
        return { V, rc, label: POLY_NAMES[N] || N + "-sided polygon", params: { cx, cy, r: Math.abs(R), sides: N } };
      },
    },
    star: {
      build(x, o) {
        const [cx, cy, R, ratio0, th] = x, rc = Math.abs(x[5] || 0), N = o.N, ratio = Math.min(0.92, Math.max(0.08, ratio0));
        const V = Array.from({ length: 2 * N }, (_, i) => { const a = th + Math.PI * i / N, r = Math.abs(R) * (i % 2 ? ratio : 1); return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
        return { V, rc, label: N + "-point star", params: { cx, cy, r: Math.abs(R), ratio, points: N } };
      },
    },
    arrow: {
      build(x) {
        const [cx, cy, L0, th, W0, w0, Lh0] = x, rc = Math.abs(x[7] || 0), L = Math.abs(L0), W = Math.abs(W0), w = Math.min(Math.abs(w0), W * 0.95), Lh = Math.min(Math.abs(Lh0), L * 0.9);
        const c = Math.cos(th), s = Math.sin(th);
        const loc = [[-L / 2, -w], [L / 2 - Lh, -w], [L / 2 - Lh, -W], [L / 2, 0], [L / 2 - Lh, W], [L / 2 - Lh, w], [-L / 2, w]];
        return { V: loc.map(([u, v]) => add([cx, cy], rot(u, v, c, s))), rc, label: "Arrow", params: { cx, cy, L, W } };
      },
    },
    heart: {
      build(x) {
        const [cx, cy, sx, sy, th] = x, c = Math.cos(th), s = Math.sin(th);
        const pts = HEART.map(([u, v]) => add([cx, cy], rot(u * Math.abs(sx), v * Math.abs(sy), c, s)));
        return { poly: pts, sharp: [pts[0], pts[120]], label: "Heart", params: { cx, cy, w: Math.abs(sx), h: Math.abs(sy) } };
      },
    },
    arc: {
      build(x) {
        const [cx, cy, ra, rb, a0, span0] = x, r1 = Math.max(Math.abs(ra), Math.abs(rb)), r2 = Math.min(Math.abs(ra), Math.abs(rb)), span = Math.min(2 * Math.PI - 0.05, Math.max(0.2, span0));
        const outer = [], inner = [], n = 48;
        for (let i = 0; i <= n; i++) { const a = a0 + span * i / n; outer.push([cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)]); inner.push([cx + r2 * Math.cos(a), cy + r2 * Math.sin(a)]); }
        const poly = outer.concat(inner.reverse()), lg = span > Math.PI ? 1 : 0;
        const d = `M${P(outer[0])}A${fmt(r1)} ${fmt(r1)} 0 ${lg} 1 ${P(outer[n])}L${P(inner[0])}A${fmt(r2)} ${fmt(r2)} 0 ${lg} 0 ${P(inner[n])}Z`;
        return { poly, sharp: [outer[0], outer[n], inner[0], inner[n]], d, label: "Arc", params: { cx, cy, r1, r2, a0, span } };
      },
    },
  };

  // Turn a fitted parameter vector into a finished shape. Corner rounding smaller than the
  // image's blur becomes a sharp corner; larger rounding is kept as a real rounded corner.
  function finish(kind, x, o) {
    const g = FAMILY[kind].build(x, o);
    let S;
    if (g.V) {
      // How far the rounding cuts into each corner. Blur cuts in about the same distance at every
      // corner whatever its angle, so a shallow cut means sharp corners softened by the image.
      const cs = roundCorners(g.V, g.rc); let depth = 0, cnt = 0;
      for (const c of cs) if (c.r) { depth += hyp(c.ctr[0] - c.C[0], c.ctr[1] - c.C[1]) - c.r; cnt++; }
      depth = cnt ? depth / cnt : 0;
      // Sharp when either the radius or the cut depth is at blur scale (thin tips have a small radius, wide corners a shallow cut).
      const rc = (depth < o.rcSharp || g.rc < o.rcSharp * 1.4) ? 0 : g.rc, pts = rc ? roundedPolyline(g.V, rc, 10) : g.V;
      const dStr = roundedPolyD(g.V, rc);
      S = { kind, params: { ...g.params, rc }, pts, sharp: rc ? [] : g.V, dStr, label: g.label + (rc ? ", rounded" : "") };
      S.el = rc ? id => `<path id="${id}" d="${dStr}"/>` : id => `<polygon id="${id}" points="${g.V.map(q => fmt(q[0]) + "," + fmt(q[1])).join(" ")}"/>`;
    } else {
      let dStr = g.d;
      if (!dStr) { const ol = fitOutline(resampleClosed(g.poly, 1), 0.2, 3, 35, 0.15, 40); dStr = outlineD(ol); }
      S = { kind, params: g.params, pts: g.poly, sharp: g.sharp, dStr, label: g.label };
      S.el = id => `<path id="${id}" d="${dStr}"/>`;
    }
    return S;
  }
  function costOf(kind, x, o, pSub) { const g = FAMILY[kind].build(x, o); return chamfer(pSub, g.V ? roundedPolyline(g.V, g.rc, 5) : g.poly); }
  function fitFamily(kind, pr, inits, o) {
    const pSub = pr.filter((_, i) => i % Math.max(1, Math.floor(pr.length / 90)) === 0);
    let best = null;
    for (const x0 of inits) {
      // In auto mode, a short first run shows whether this template can fit at all.
      let x = nelderMead(v => costOf(kind, v, o, pSub), x0, o.reject ? 70 : 220), c = costOf(kind, x, o, pSub);
      // Single-start templates (arrows, arcs) start close enough to finish; multi-start ones drop bad starts early.
      if (o.reject && c > o.reject * (inits.length > 1 || kind === "star" || kind === "polygon" ? 8 : 40)) continue;
      if (o.reject) x = nelderMead(v => costOf(kind, v, o, pSub), x, 150);
      x = nelderMead(v => costOf(kind, v, o, pSub), x, 180);     // restart once to escape a collapsed simplex
      c = costOf(kind, x, o, pSub);
      if (!best || c < best.c) best = { x, c };
    }
    return best ? { S: finish(kind, best.x, o), cost: best.c } : null;
  }

  /* Rotational harmonics of the outline around its centroid: the strongest one gives the
     number of points or sides; its phase gives the rotation. */
  function harmonic(pr, cen, lo = 3, hi = 12) {
    const rs = pr.map(q => hyp(q[0] - cen[0], q[1] - cen[1])), as = pr.map(q => Math.atan2(q[1] - cen[1], q[0] - cen[0]));
    const n = pr.length; let c0 = 0, wsum = 0; const da = [];
    for (let i = 0; i < n; i++) { let d = as[(i + 1) % n] - as[(i - 1 + n) % n]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; da.push(Math.abs(d) / 2); c0 += rs[i] * da[i]; wsum += da[i]; }
    c0 /= wsum; let best = null;
    for (let N = lo; N <= hi; N++) {
      let re = 0, im = 0; for (let i = 0; i < n; i++) { re += rs[i] * Math.cos(N * as[i]) * da[i]; im -= rs[i] * Math.sin(N * as[i]) * da[i]; }
      const mag = hyp(re, im) / wsum, strength = mag / c0;
      if (!best || strength > best.strength * 1.15) best = { N, strength, phase: -Math.atan2(im, re) / N };
    }
    let rmin = Infinity, rmax = 0; for (const r of rs) { rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
    return { ...best, rmin, rmax, c0 };
  }
  function solidity(pr) { return Math.abs(area(pr)) / Math.max(1e-9, Math.abs(area(hull(pr)))); }

  function initsFor(kind, pr, o, N) {
    const M = moments(pr), cen = [M.cx, M.cy], R = minAreaRect(pr);
    if (kind === "polygon" || kind === "star") {
      const h = harmonic(pr, cen, N || 3, N || 12);
      const n = N || h.N, ph = h.phase + (kind === "star" ? 0 : 0);
      const rr = kind === "star" ? [cen[0], cen[1], h.rmax * 1.03, Math.max(0.15, h.rmin / h.rmax), ph, 0.05 * h.rmax] : [cen[0], cen[1], h.rmax * 1.03, ph, 0.05 * h.rmax];
      return { N: n, inits: [rr] };
    }
    if (kind === "heart") {
      const h = Math.hypot(R.w, R.h) > 0 ? R : null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of pr) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, hh = y1 - y0;
      return { inits: o.manual ? [[cx, cy, w, hh, 0], [cx, cy, hh, w, Math.PI / 2], [cx, cy, w, hh, Math.PI], [cx, cy, hh, w, -Math.PI / 2]] : [[cx, cy, w, hh, 0], [cx, cy, w, hh, Math.PI]] };
    }
    if (kind === "arrow") {
      // The principal axis through the centroid is the shaft; the width profile along it finds the head.
      const th = snapAngle(0.5 * Math.atan2(2 * M.xy, M.xx - M.yy) / DEG, 90, 3) * DEG, u = [Math.cos(th), Math.sin(th)], v = [-u[1], u[0]];
      let t0 = Infinity, t1 = -Infinity; for (const q of pr) { const t = dot(sub(q, cen), u); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
      const L = t1 - t0, mid = add(cen, mul(u, (t0 + t1) / 2)), R = { cx: mid[0], cy: mid[1] };
      const nb = 24, wid = new Array(nb).fill(0);
      for (const q of pr) { const d = sub(q, [R.cx, R.cy]), t = dot(d, u), s = Math.abs(dot(sub(q, cen), v)), b = Math.min(nb - 1, Math.max(0, Math.floor((t / L + 0.5) * nb))); wid[b] = Math.max(wid[b], s); }
      const half = nb / 2, maxA = Math.max(...wid.slice(0, half)), maxB = Math.max(...wid.slice(half)), headAtEnd = maxB >= maxA;
      const prof = headAtEnd ? wid : wid.slice().reverse(), W = Math.max(maxA, maxB), tail = prof.slice(1, half).filter(x => x > 0).sort((a, b) => a - b);
      const w = tail.length ? tail[tail.length >> 1] : W * 0.4, peak = prof.lastIndexOf(W) >= 0 ? prof.lastIndexOf(W) : prof.indexOf(W);
      const Lh = Math.max(L * 0.15, L * (nb - 1 - peak) / nb), dir = headAtEnd ? th : th + Math.PI;
      return { inits: [[R.cx, R.cy, L, dir, W, Math.min(w, W * 0.8), Lh, 0]] };
    }
    if (kind === "arc") {
      // The outer edge alone gives a good center: fit all points, keep the far half, fit again.
      let cf = circleFit(pr) || { c: cen, r: 10 };
      const ds = pr.map(q => hyp(q[0] - cf.c[0], q[1] - cf.c[1])), med = ds.slice().sort((a, b) => a - b)[ds.length >> 1];
      const outerPts = pr.filter((_, i) => ds[i] >= med); cf = (outerPts.length > 8 && circleFit(outerPts)) || cf;
      let r1 = 0, r2 = 0, n1 = 0, n2 = 0; const angs = [];
      const d2s = pr.map(q => hyp(q[0] - cf.c[0], q[1] - cf.c[1])), mid = (Math.max(...d2s) + Math.min(...d2s)) / 2;
      pr.forEach((q, i) => { if (d2s[i] >= mid) { r1 += d2s[i]; n1++; } else { r2 += d2s[i]; n2++; } angs.push(Math.atan2(q[1] - cf.c[1], q[0] - cf.c[0])); });
      r1 = n1 ? r1 / n1 : cf.r; r2 = n2 ? r2 / n2 : cf.r * 0.6;
      angs.sort((a, b) => a - b); let gap = 0, gi = 0;
      for (let i = 0; i < angs.length; i++) { const g = (i < angs.length - 1 ? angs[i + 1] : angs[0] + 2 * Math.PI) - angs[i]; if (g > gap) { gap = g; gi = i; } }
      const a0 = angs[(gi + 1) % angs.length], span = 2 * Math.PI - gap;
      return { inits: [[cf.c[0], cf.c[1], r1, r2, a0, span]] };
    }
    return { inits: [] };
  }

  // Grade a fitted shape like the Mac engine: points near sharp corners are ignored,
  // the rest must sit within tolerance of the shape.
  function grade(pr, S, tol, zone) {
    let d = polyDist(pr, S.pts);
    if (S.sharp && S.sharp.length) { const keep = d.filter((_, i) => !S.sharp.some(v => hyp(pr[i][0] - v[0], pr[i][1] - v[1]) < zone)); if (keep.length < 12) return false; d = keep; }
    return maxOf(d) <= tol && rms(d) <= tol * 0.6;
  }

  /* Automatic matching beyond circles and rectangles. Cheap gates decide which templates are
     worth fitting; every candidate must still pass the grade and the engine's strictness checks. */
  function matchTemplate(pr, tol, sc) {
    if (pr.length < 24) return null;
    const o = { rcSharp: 1.8 * sc, reject: (tol * 0.6) ** 2 }, M = moments(pr), sol = solidity(pr), R = minAreaRect(pr), aspect = Math.max(R.w, R.h) / Math.max(1e-6, Math.min(R.w, R.h));
    // Cheap gates first, so letters and other free-form outlines skip the fitting entirely.
    let turn = 0; for (let i = 0, n = pr.length; i < n; i++) { const a = Math.atan2(pr[i][1] - M.cy, pr[i][0] - M.cx), b = Math.atan2(pr[(i + 1) % n][1] - M.cy, pr[(i + 1) % n][0] - M.cx); let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turn += Math.abs(d); }
    const starShaped = turn < 2 * Math.PI * 1.04;          // every ray from the center crosses the edge once
    const h = starShaped ? harmonic(pr, [M.cx, M.cy]) : null, cands = [];
    if (h && h.strength > 0.025 && aspect < 1.35) cands.push(h.rmin / h.rmax < Math.cos(Math.PI / h.N) - 0.1 ? ["star", h.N] : ["polygon", h.N]);
    if (starShaped && sol > 0.8 && sol < 0.97 && aspect < 1.45) cands.push(["heart"]);
    if (sol > 0.45 && sol < 0.88 && aspect > 1.25) { const nv = approxPoly(pr, tol * 1.5).length; if (nv >= 6 && nv <= 9) cands.push(["arrow"]); }
    if (sol < 0.85) {
      const ini = initsFor("arc", pr, o).inits[0], [ax, ay, r1, r2] = ini, band = Math.abs(r1 - r2);
      // Points sit on the outer radius, the inner radius, or the two straight ends.
      const [, , , , a0, span] = ini, endW = band / Math.max(1, Math.min(r1, r2)) + 0.05, angDist = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
      let near = 0; for (const q of pr) { const d = hyp(q[0] - ax, q[1] - ay), a = Math.atan2(q[1] - ay, q[0] - ax); if (Math.abs(d - r1) < 0.15 * band + tol || Math.abs(d - r2) < 0.15 * band + tol || angDist(a, a0) < endW || angDist(a, a0 + span) < endW) near++; }
      if (near / pr.length > 0.93 && band > 2 * tol) cands.push(["arc"]);
    }
    for (const [kind, N] of cands) {
      const ini = initsFor(kind, pr, o, N), oo = { ...o, N: ini.N || N };
      const fit = fitFamily(kind, pr, ini.inits, oo); if (!fit) continue;
      const zone = 3 * sc * (kind === "polygon" ? 1.5 : 2.5), Q = fit.S.params;
      // A star with shallow points, or a polygon rounded nearly into a circle, is something else (often a letter).
      if (kind === "star" && Q.ratio > 0.72) continue;
      if ((kind === "polygon" || kind === "star") && Q.rc > 0.3 * Q.r) continue;
      if (grade(pr, fit.S, tol, zone)) return Object.assign(fit.S, { zone });
    }
    return null;
  }

  /* Manual snapping: fit the chosen shape as well as it can, whatever the tolerance. */
  function snapTo(pr, kind, sc) {
    const o = { rcSharp: 1.8 * sc, manual: true }, M = moments(pr);
    if (kind === "circle") { const cf = circleFit(pr); return cf && { kind, params: { cx: cf.c[0], cy: cf.c[1], r: cf.r }, label: "Circle" }; }
    if (kind === "ellipse") {
      const tr = M.xx + M.yy, det = M.xx * M.yy - M.xy * M.xy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      return { kind, params: { cx: M.cx, cy: M.cy, rx: 2 * Math.sqrt(tr / 2 + disc), ry: 2 * Math.sqrt(Math.max(1e-9, tr / 2 - disc)), angle: snapAngle(0.5 * Math.atan2(2 * M.xy, M.xx - M.yy) / DEG) }, label: "Ellipse" };
    }
    if (kind === "rect" || kind === "rounded_rect" || kind === "pill") {
      const R = minAreaRect(pr); let { w, h } = R, a = snapAngle(R.angle); if (mod(a, 180) === 90) { [w, h] = [h, w]; a = 0; }
      const base = { cx: R.cx, cy: R.cy, w, h, angle: mod(a, 90) ? mod(a, 180) : 0 };
      if (kind === "rect") return { kind, params: { ...base, r: 0 }, label: "Rectangle" };
      if (kind === "pill") return { kind: "rounded_rect", params: { ...base, r: Math.min(w, h) / 2 }, label: "Pill" };
      let best = null; for (let i = 0; i < 40; i++) { const rr = Math.min(w, h) * (0.02 + 0.48 * i / 39), d = rrectDist(pr, { ...base, r: rr }), s = d.reduce((t, v) => t + v, 0); if (!best || s < best[0]) best = [s, rr]; }
      return { kind, params: { ...base, r: best[1] }, label: "Rounded rectangle" };
    }
    if (kind === "polygon" || kind === "star") {
      const h = harmonic(pr, [M.cx, M.cy], kind === "star" ? 4 : 3, 12);
      let best = null;
      for (const N of [h.N - 1, h.N, h.N + 1]) {
        if (N < (kind === "star" ? 4 : 3) || N > 12) continue;
        const ini = initsFor(kind, pr, o, N), f = fitFamily(kind, pr, ini.inits, { ...o, N });
        if (f && (!best || f.cost < best.cost * 0.9)) best = f;
      }
      return best && best.S;
    }
    const ini = initsFor(kind, pr, o);
    const f = fitFamily(kind, pr, ini.inits, o);
    return f && f.S;
  }

  /* Ring: an outer circle and a concentric circular hole, as one shape. */
  function ringShape(outerPts, holePts, tol) {
    const a = circleFit(outerPts), b = circleFit(holePts); if (!a || !b) return null;
    if (hyp(a.c[0] - b.c[0], a.c[1] - b.c[1]) > Math.max(tol, 0.01 * a.r) || b.r >= a.r) return null;
    const cx = (a.c[0] + b.c[0]) / 2, cy = (a.c[1] + b.c[1]) / 2, r1 = a.r, r2 = b.r;
    const circ = r => `M${fmt(cx + r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)}Z`;
    const pts = Array.from({ length: 360 }, (_, i) => [cx + r1 * Math.cos(i * DEG), cy + r1 * Math.sin(i * DEG)]);
    const dStr = circ(r1) + circ(r2);
    return { kind: "ring", params: { cx, cy, r1, r2 }, pts, holePts: Array.from({ length: 360 }, (_, i) => [cx + r2 * Math.cos(i * DEG), cy + r2 * Math.sin(i * DEG)]), dStr, el: id => `<path id="${id}" d="${dStr}"/>`, label: "Ring", consumesHole: true };
  }

  return { BOW: VZ_BOW, resampleClosed, matchTemplate, snapTo, ringShape, harmonic, area, fitOutline, outlineD, matchShape, relativeResidual, overlapPct, boundary, shapeElement, shapeD, snapOutlines, snapShapes, maskContours, nest };
})();
