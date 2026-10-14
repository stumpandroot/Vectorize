"use strict";
const $ = s => document.querySelector(s);
const WORK_MAX = 1600, WORK_MIN = 1600;

/* ---------- Settings ---------- */
// Named for the kind of art you start with. Illustrator's names are in the comments for reference.
// Every preset sets every flag, so switching presets never leaves one behind.
const PRESET_BASE = { grow: 0, gray: false, adaptive: false, fillHoles: false };
const PRESETS = {
  onecolor:   { ...PRESET_BASE, cmode: "bw",     k: 2,  bg: "remove", detail: 70, straight: 55, smooth: 50, corners: 60, shapes: "auto", snap: true,  maxAuto: 10 },   // Black and White Logo
  logo:       { ...PRESET_BASE, cmode: "auto",   k: 6,  bg: "remove", detail: 70, straight: 50, smooth: 50, corners: 50, shapes: "auto", snap: true,  maxAuto: 10 },   // 3 and 6 Colors
  detailed:   { ...PRESET_BASE, cmode: "auto",   k: 12, bg: "remove", detail: 85, straight: 40, smooth: 45, corners: 45, shapes: "auto", snap: false, maxAuto: 16 },   // 16 Colors
  silhouette: { ...PRESET_BASE, cmode: "bw",     k: 2,  bg: "remove", detail: 50, straight: 40, smooth: 70, corners: 40, shapes: "off",  snap: false, maxAuto: 10, fillHoles: true },   // Silhouettes
  sketch:     { ...PRESET_BASE, cmode: "bw",     k: 2,  bg: "remove", detail: 40, straight: 30, smooth: 75, corners: 30, shapes: "off",  snap: false, maxAuto: 10, adaptive: true },    // Sketched Art
  gray:       { ...PRESET_BASE, cmode: "number", k: 6,  bg: "keep",   detail: 75, straight: 30, smooth: 45, corners: 40, shapes: "off",  snap: false, maxAuto: 10, gray: true },        // Shades of Gray
  photo:      { ...PRESET_BASE, cmode: "number", k: 12, bg: "keep",   detail: 80, straight: 15, smooth: 30, corners: 30, shapes: "off",  snap: false, maxAuto: 24 },   // High and Low Fidelity Photo
};
const PRESET_HELP = {
  onecolor: "Black-and-white art, stamps, and stencils. Every shape becomes one color.",
  logo: "Flat-color logos and wordmarks, up to 10 colors.",
  detailed: "Detailed logos and illustrations, up to 16 colors, keeping small parts.",
  silhouette: "One solid shape with no holes, for shadows, cut outlines, and stencils.",
  sketch: "Hand drawing on paper. Evens out uneven light and smooths shaky lines.",
  gray: "Shades of gray, 6 to start. Use + and − to change the count.",
  photo: "Pictures with many colors. The result is stylized, not a copy of the photo.",
};
// Earlier versions called Detailed logo "Flat art".
const PRESET_ALIAS = { art: "detailed" };
const S = Object.assign({ preset: "logo", textMode: "auto", layering: "stacked", output: "", exportFormat: "svg" }, PRESETS.logo);
const locked = [];            // brand colors, "#RRGGBB"
let recolor = {};             // "#ORIG" -> "#NEW"
let hidden = new Set();       // "#ORIG" hidden layers
let view = "compare", split = 50;
let job = null;               // {name, meta, origW, origH, workW, workH, imgd, srcURL}
let result = null;            // {palette:[{hex,bg,transparent,count}], layers:[[d,...]], w, h, paths, nodes}
let picking = false;
let renderPaused = false;      // true while batch export traces images off screen

/* ---------- Color math ---------- */
const hex2 = n => n.toString(16).padStart(2, "0");
const toHex = (r, g, b) => ("#" + hex2(r) + hex2(g) + hex2(b)).toUpperCase();
const fromHex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function rgb2lab(r, g, b) {
  r = lin(r); g = lin(g); b = lin(b);
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function lab2rgb(L, a, bb) {
  let y = (L + 16) / 116, x = a / 500 + y, z = y - bb / 200;
  const f = t => t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787;
  x = f(x) * 0.95047; y = f(y); z = f(z) * 1.08883;
  let r = x * 3.2406 + y * -1.5372 + z * -0.4986, g = x * -0.9689 + y * 1.8758 + z * 0.0415, b = x * 0.0557 + y * -0.2040 + z * 1.0570;
  const g2 = c => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));
  return [g2(r), g2(g), g2(b)];
}
const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

const NAMES = [["Black","#111111"],["Navy","#1E2340"],["Charcoal","#3A3A3A"],["Gray","#8A8A8A"],["Silver","#C8C8C8"],["White","#FFFFFF"],["Cream","#F6F0DC"],
  ["Red","#D62828"],["Coral","#FF8A6B"],["Orange","#F28C28"],["Tan","#C69C6D"],["Brown","#7A4E2D"],["Yellow","#FFC24B"],["Gold","#C9A227"],["Lime","#B7E67E"],
  ["Green","#2E9E44"],["Forest","#1F4D2B"],["Teal","#1A8C8C"],["Sky","#6EC1E4"],["Blue","#2563EB"],["Indigo","#3B3B98"],["Purple","#7B3FA0"],["Pink","#F28DB2"],["Magenta","#D0218A"]]
  .map(([n, h]) => [n, rgb2lab(...fromHex(h))]);
function colorName(hex) { const l = rgb2lab(...fromHex(hex)); let best = NAMES[0], bd = Infinity; for (const n of NAMES) { const d = d2(l, n[1]); if (d < bd) { bd = d; best = n; } } return best[0]; }

/* Seeded random so the same image and settings always trace the same way */
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

function kmeans(pts, k, iters, rand) {
  const n = pts.length; if (n === 0) return { centers: [], err: 0, counts: [] };
  k = Math.min(k, n);
  const centers = [pts[Math.floor(rand() * n)].slice()];
  const dist = new Float64Array(n).fill(Infinity);
  while (centers.length < k) {           // k-means++ seeding
    const c = centers[centers.length - 1]; let sum = 0;
    for (let i = 0; i < n; i++) { const d = d2(pts[i], c); if (d < dist[i]) dist[i] = d; sum += dist[i]; }
    if (sum === 0) break;
    let t = rand() * sum, i = 0; for (; i < n - 1; i++) { t -= dist[i]; if (t <= 0) break; }
    centers.push(pts[i].slice());
  }
  const lab = new Int32Array(n); let counts = [];
  for (let it = 0; it < iters; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity; for (let j = 0; j < centers.length; j++) { const d = d2(pts[i], centers[j]); if (d < bd) { bd = d; bi = j; } }
      lab[i] = bi; const a = acc[bi]; a[0] += pts[i][0]; a[1] += pts[i][1]; a[2] += pts[i][2]; a[3]++;
    }
    let moved = 0;
    for (let j = 0; j < centers.length; j++) if (acc[j][3]) { const nc = [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]]; moved += d2(nc, centers[j]); centers[j] = nc; }
    counts = acc.map(a => a[3]);
    if (moved < 0.01) break;
  }
  let err = 0, far = 0;
  for (let i = 0; i < n; i++) { const e = Math.sqrt(d2(pts[i], centers[lab[i]])); err += e; if (e > 12) far++; }
  return { centers, err: err / n, far: far / n, counts };
}

function kmeansW(pts, wts, k, iters, rand) {
  // Weighted k-means++ over histogram bins.
  const n = pts.length; if (n === 0) return { centers: [], counts: [] };
  k = Math.min(k, n);
  let bi0 = 0; for (let i = 1; i < n; i++) if (wts[i] > wts[bi0]) bi0 = i;
  const centers = [pts[bi0].slice()], dist = new Float64Array(n).fill(Infinity);
  while (centers.length < k) {
    const c = centers[centers.length - 1]; let sum = 0;
    for (let i = 0; i < n; i++) { const d = d2(pts[i], c); if (d < dist[i]) dist[i] = d; sum += dist[i] * Math.sqrt(wts[i]); }
    if (sum === 0) break;
    let t = rand() * sum, i = 0; for (; i < n - 1; i++) { t -= dist[i] * Math.sqrt(wts[i]); if (t <= 0) break; }
    centers.push(pts[i].slice());
  }
  let counts = [];
  for (let it = 0; it < iters; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity; for (let j = 0; j < centers.length; j++) { const d = d2(pts[i], centers[j]); if (d < bd) { bd = d; bi = j; } }
      const a = acc[bi], wv = wts[i]; a[0] += pts[i][0] * wv; a[1] += pts[i][1] * wv; a[2] += pts[i][2] * wv; a[3] += wv;
    }
    let moved = 0;
    for (let j = 0; j < centers.length; j++) if (acc[j][3]) { const nc = [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]]; moved += d2(nc, centers[j]); centers[j] = nc; }
    counts = acc.map(a => a[3]);
    if (moved < 0.01) break;
  }
  return { centers, counts };
}

/* ---------- Image in ---------- */
function loadImage(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("load")); im.src = src; }); }

async function makeJob(src, name, meta) {
  let im;
  try { im = await loadImage(src); } catch { return null; }
  const ow = im.naturalWidth, oh = im.naturalHeight, long = Math.max(ow, oh);
  // Trace at about 1,600 px on the long side, capped at 1.4 megapixels for speed.
  let sc = WORK_MAX / long; sc = Math.min(sc, Math.sqrt(1.4e6 / (ow * oh)));
  const ww = Math.max(1, Math.round(ow * sc)), wh = Math.max(1, Math.round(oh * sc));
  const imgd = rasterize(im, ww, wh, sc); let hasAlpha = false; for (let i = 3; i < imgd.data.length; i += 4) if (imgd.data[i] < 128) { hasAlpha = true; break; }
  return { name, meta: meta || `${ow} × ${oh}`, origW: ow, origH: oh, workW: ww, workH: wh, scale: sc, imgd, hasAlpha, srcURL: src, cutImgd: null };
}
function rasterize(im, ww, wh, sc) {
  const c = document.createElement("canvas"); c.width = ww; c.height = wh;
  const x = c.getContext("2d", { willReadFrequently: true }); x.imageSmoothingQuality = "high";
  // A light blur, scaled to the enlargement, smooths JPEG noise and stair-stepped edges before colors are picked.
  const blurPx = Math.max(0.5, Math.min(1.2, sc * 0.35)); if ("filter" in x) x.filter = `blur(${blurPx.toFixed(2)}px)`;
  x.drawImage(im, 0, 0, ww, wh); x.filter = "none";
  return x.getImageData(0, 0, ww, wh);
}
function resetEdits() {
  useShape = {}; recolor = {}; hidden = new Set(); manualSnaps = []; sel = null; textMemory = []; textSel = null;
  if (typeof resetDoc === "function") resetDoc();
}
function showJob(j) {
  job = j; result = j.result || null; resetEdits();
  $("#fileName").textContent = j.name; $("#fileMeta").textContent = j.meta;
  $("#srcImg").src = j.srcURL;
  if (typeof fitView === "function") fitView(); else layoutSheet();
  convert();
}
async function openImage(src, name, meta) {
  const j = await makeJob(src, name, meta);
  if (!j) { toast("Vectorize couldn't read that file. Use a PNG or JPEG."); return; }
  if (typeof leaveBatch === "function") leaveBatch();
  showJob(j);
}
// The pixels to trace: the AI cutout when it's on, otherwise the image itself.
function sourcePixels(j = job) { return S.bg === "ai" && j.cutImgd ? j.cutImgd : j.imgd; }

/* ---------- Palette ---------- */
function buildPalette(imgd) {
  const { width: w, height: h, data } = imgd;
  let transparent = 0;
  // Every flat (non-edge) pixel goes into a color histogram, so even a tiny accent color is counted.
  const at = (x, y) => (y * w + x) * 4;
  const rr = 2;   // short reach, so small accents keep their flat centers
  const bins = new Map(), binsAll = new Map();
  const put = (m, i) => { const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3); let b = m.get(key); if (!b) m.set(key, b = [0, 0, 0, 0]); b[0] += data[i]; b[1] += data[i + 1]; b[2] += data[i + 2]; b[3]++; };
  for (let y = rr; y < h - rr; y++) for (let x = rr; x < w - rr; x++) {
    const i = at(x, y); if (data[i + 3] < 128) { transparent++; continue; }
    let edge = 0;
    for (const j of [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1), at(x + 1, y + 1), at(x - 1, y - 1), at(x + 1, y - 1), at(x - 1, y + 1), at(x + rr, y), at(x - rr, y), at(x, y + rr), at(x, y - rr)]) { const e = Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]); if (e > edge) edge = e; if (edge >= 40) break; }
    if (edge < 34) put(bins, i); else if ((x + y) % 3 === 0) put(binsAll, i);
  }
  const toPts = m => { const P = [], Wt = []; for (const b of m.values()) { P.push(rgb2lab(b[0] / b[3], b[1] / b[3], b[2] / b[3])); Wt.push(b[3]); } return [P, Wt]; };
  let [sample, wts] = toPts(bins);
  if (wts.reduce((a, b) => a + b, 0) < 200) [sample, wts] = toPts(new Map([...bins, ...binsAll]));
  const totalW = wts.reduce((a, b) => a + b, 0) || 1;
  let centers;
  if (S.cmode === "bw") {
    centers = [rgb2lab(0, 0, 0), rgb2lab(255, 255, 255)];
  } else if (S.cmode === "number") {
    centers = kmeansW(sample, wts, S.k, 16, rng(99)).centers;
  } else {
    let pick = null;
    for (let k = 2; k <= S.maxAuto; k++) {
      const r = kmeansW(sample, wts, k, 14, rng(k * 7919));
      // Ignore clusters too small to be a real color, then measure how much of the image is still far from every color.
      const keep = r.centers.filter((c, j) => r.counts[j] >= Math.max(24, 0.00005 * totalW));
      let far = 0; sample.forEach((p, i) => { let bd = Infinity; for (const c of keep) bd = Math.min(bd, d2(p, c)); if (bd > 144) far += wts[i]; });
      pick = keep;
      if (far < Math.max(24, 0.0002 * totalW)) break;
    }
    centers = pick && pick.length ? pick : [rgb2lab(0, 0, 0)];
  }
  // Merge near-duplicate colors (JPEG noise splits one color into two close ones).
  if (S.cmode !== "bw") {
    centers = centers.map(c => rgb2lab(...lab2rgb(...c)));   // compare displayable colors (out-of-gamut centers clamp together)
    const wsum = centers.map(c => { let t = 0; sample.forEach((p, i) => { let bi = -1, bd = Infinity; centers.forEach((q, j) => { const d = d2(p, q); if (d < bd) { bd = d; bi = j; } }); if (centers[bi] === c) t += wts[i]; }); return t; });
    const lim = S.cmode === "number" ? 4 : 14;
    // Always merge the closest pair first, and repeat until no pair is closer than the limit.
    for (;;) {
      let ba = -1, bb = -1, bd = lim;
      for (let a = 0; a < centers.length; a++) for (let b = a + 1; b < centers.length; b++) {
        if (!centers[a] || !centers[b]) continue; const A = centers[a], B = centers[b];
        let d = Math.sqrt(d2(A, B));
        // JPEG keeps lightness but drops color from small dark details, so two dark colors with the
        // same lightness that differ only in tint are one color (black next to navy differs in lightness and stays).
        if (S.cmode === "auto" && A[0] < 30 && B[0] < 30 && Math.abs(A[0] - B[0]) < 4) d = Math.min(d, Math.hypot(A[0] - B[0], 0.55 * Math.hypot(A[1] - B[1], A[2] - B[2])));
        if (d < bd) { bd = d; ba = a; bb = b; }
      }
      if (ba < 0) break;
      const wa = wsum[ba], wb = wsum[bb], t = wa + wb || 1;
      centers[ba] = [0, 1, 2].map(k => (centers[ba][k] * wa + centers[bb][k] * wb) / t); wsum[ba] = t; centers[bb] = null;
    }
    centers = centers.filter(Boolean);
  }
  // Drop colors that are only a blend between two others (anti-aliased edges), unless the user asked for a count.
  if (S.cmode === "auto" && centers.length > 2) {
    const cnt = new Array(centers.length).fill(0);
    sample.forEach((p, i) => { let bi = 0, bd = Infinity; centers.forEach((c, j) => { const d = d2(p, c); if (d < bd) { bd = d; bi = j; } }); cnt[bi] += wts[i]; });
    const drop = new Set();
    centers.forEach((c, j) => {
      for (let a = 0; a < centers.length; a++) for (let b = a + 1; b < centers.length; b++) {
        if (a === j || b === j || drop.has(a) || drop.has(b)) continue;
        const A = centers[a], B = centers[b], AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = d2(A, B);
        if (L2 < 1) continue;
        const t = ((c[0] - A[0]) * AB[0] + (c[1] - A[1]) * AB[1] + (c[2] - A[2]) * AB[2]) / L2;
        if (t < 0.08 || t > 0.92) continue;
        const P = [A[0] + t * AB[0], A[1] + t * AB[1], A[2] + t * AB[2]];
        if (Math.sqrt(d2(P, c)) < 10 && cnt[j] < Math.min(cnt[a], cnt[b])) drop.add(j);
      }
    });
    centers = centers.filter((_, j) => !drop.has(j));
  }
  // Locked brand colors replace the closest detected color, or join the palette.
  let pal = centers.map(c => fromHexSafe(lab2rgb(...c)));
  for (const lh of locked) {
    const ll = rgb2lab(...fromHex(lh)); let bi = -1, bd = 25 * 25;
    pal.forEach((p, i) => { if (p.lock) return; const d = d2(rgb2lab(...p.rgb), ll); if (d < bd) { bd = d; bi = i; } });
    const entry = { rgb: fromHex(lh), lock: true };
    if (bi >= 0) pal[bi] = entry; else pal.push(entry);
  }
  // Drop duplicates that round to the same hex.
  const seen = new Set(); pal = pal.filter(p => { const hx = toHex(...p.rgb); if (seen.has(hx)) return false; seen.add(hx); return true; });
  return { pal, hasTransparent: transparent > 0 };
}
function fromHexSafe(rgb) { return { rgb, lock: false }; }

function prepareImage(imgd) {
  // Copy, make alpha binary, and apply black-and-white thresholding or grayscale when asked.
  const out = new ImageData(new Uint8ClampedArray(imgd.data), imgd.width, imgd.height), d = out.data;
  let thr = 128, local = null;
  const lum = i => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  if (S.cmode === "bw" && S.adaptive) {
    // Sketch: compare each pixel with the average around it, so shadows and uneven paper don't turn black.
    const w = out.width, h = out.height, R = Math.max(8, Math.round(Math.min(w, h) / 24)), I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; row += d[i + 3] < 128 ? 255 : lum(i); I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    local = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R), x1 = Math.min(w, x + R + 1), y1 = Math.min(h, y + R + 1);
      local[y * w + x] = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)) - 14;
    }
  } else if (S.cmode === "bw") {
    const hist = new Array(256).fill(0); let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) { hist[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++; n++; }
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sB = 0, wB = 0, best = 0;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; thr = t; } }
  }
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = 0; continue; }
    d[i + 3] = 255;
    if (S.cmode === "bw") { const v = lum(i) > (local ? local[i >> 2] : thr) ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
    else if (S.gray) { const v = Math.round(lum(i)); d[i] = d[i + 1] = d[i + 2] = v; }
  }
  return out;
}

function quantize(imgd, pal) {
  // Flat pixels take their nearest palette color. Pixels on a color transition may only
  // take one of the flat colors on either side of them, so blends never become a third color.
  const { width: w, height: h, data: d } = imgd, n = w * h;
  const labs = pal.map(p => rgb2lab(...p.rgb)), lab = new Int16Array(n).fill(-2), cache = new Map();
  const wdist = (L, q) => 2.25 * (L[0] - q[0]) ** 2 + 0.6 * ((L[1] - q[1]) ** 2 + (L[2] - q[2]) ** 2);
  const pixLab = o => { const key = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2]; let L = cache.get(key); if (!L) { L = rgb2lab(d[o], d[o + 1], d[o + 2]); cache.set(key, L); } return L; };
  const nearest = L => { let bd = Infinity, bi = 0; labs.forEach((q, j) => { const dd = wdist(L, q); if (dd < bd) { bd = dd; bi = j; } }); return bi; };
  const grad = (x, y) => {
    const o = (y * w + x) * 4, l = (y * w + Math.max(0, x - 1)) * 4, r = (y * w + Math.min(w - 1, x + 1)) * 4, u = (Math.max(0, y - 1) * w + x) * 4, dn = (Math.min(h - 1, y + 1) * w + x) * 4;
    if (d[l + 3] !== d[r + 3] || d[u + 3] !== d[dn + 3]) return 999;
    return Math.abs(d[r] - d[l]) + Math.abs(d[r + 1] - d[l + 1]) + Math.abs(d[r + 2] - d[l + 2]) + Math.abs(d[dn] - d[u]) + Math.abs(d[dn + 1] - d[u + 1]) + Math.abs(d[dn + 2] - d[u + 2]);
  };
  // 1. Flat pixels.
  const q1 = new Int32Array(n), q2 = new Int16Array(n); let qn = 0;
  const cand = new Int16Array(n * 2).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4;
    if (d[o + 3] === 0) { lab[i] = -1; continue; }
    if (grad(x, y) < 36) { const l = nearest(pixLab(o)); lab[i] = l; cand[i * 2] = l; q1[qn] = i; q2[qn++] = l; }
  }
  // 2. Spread flat colors into the transitions; each pixel remembers the first two colors that reach it.
  let head = 0, steps = 0, maxSteps = Math.max(6, Math.round(Math.max(w, h) / 60));
  let levelEnd = qn;
  while (head < qn && steps <= maxSteps) {
    const i = q1[head], l = q2[head]; head++;
    const x = i % w, y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || lab[j] !== -2) continue;
      const c0 = cand[j * 2], c1 = cand[j * 2 + 1];
      if (c0 === l || c1 === l) continue;
      if (c0 < 0) cand[j * 2] = l; else if (c1 < 0) cand[j * 2 + 1] = l; else continue;
      q1[qn] = j; q2[qn++] = l;
    }
    if (head === levelEnd) { steps++; levelEnd = qn; }
  }
  // 3. Each transition pixel picks the closer of its two neighboring flat colors.
  for (let i = 0; i < n; i++) {
    if (lab[i] !== -2) continue;
    const c0 = cand[i * 2], c1 = cand[i * 2 + 1], L = pixLab(i * 4);
    lab[i] = c0 < 0 ? nearest(L) : c1 < 0 ? c0 : (wdist(L, labs[c0]) <= wdist(L, labs[c1]) ? c0 : c1);
  }
  // 4. One light majority pass smooths single-pixel jitter along edges.
  const R = 1;
  {
    const src = lab.slice(), votes = new Int32Array(pal.length + 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, me = src[i];
      if ((x > 0 && src[i - 1] !== me) || (x < w - 1 && src[i + 1] !== me) || (y > 0 && src[i - w] !== me) || (y < h - 1 && src[i + w] !== me)) {
        votes.fill(0);
        for (let dy = -R; dy <= R; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; votes[src[yy * w + xx] + 1]++; } }
        let best = me + 1; for (let v = 0; v < votes.length; v++) if (votes[v] > votes[best]) best = v;
        lab[i] = best - 1;
      }
    }
  }
  // Merge small islands of color into the color that surrounds them. Detail sets the size, measured in
  // the source image's pixels (the same rule as the speck filter), so dots on i and j and small punctuation
  // survive on enlarged images.
  const scq = Math.max(job.scale, 1), minArea = Math.max(4, Math.round(0.8 * (2 + (1 - S.detail / 100) * 8) ** 2 * 0.5 * scq));
  const comp = new Int32Array(n).fill(-1), stack = new Int32Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (comp[s0] !== -1) continue;
    const me = lab[s0]; let top = 0; stack[top++] = s0; comp[s0] = s0; const members = [], nb = new Map();
    while (top) {
      const i = stack[--top]; members.push(i);
      const x = i % w, y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0) continue;
        if (lab[j] === me) { if (comp[j] === -1) { comp[j] = s0; stack[top++] = j; } }
        else nb.set(lab[j], (nb.get(lab[j]) || 0) + 1);
      }
    }
    if (members.length < minArea && nb.size) { let best = null, bc = -1; for (const [l, c] of nb) if (c > bc) { bc = c; best = l; } for (const i of members) lab[i] = best; }
  }
  // Slivers: thin strips with no solid interior that sit between two other colors are
  // edge fringe (often JPEG color bleed). They join the color they touch most.
  // Thin lines on a single background (strokes, hairlines) are kept.
  const r = Math.max(2, Math.round(0.7 * Math.max(job.scale, 1)));
  const solid = i => { const x = i % w, y = (i - x) / w, l = lab[i]; return x >= r && y >= r && x < w - r && y < h - r && lab[i - r] === l && lab[i + r] === l && lab[i - r * w] === l && lab[i + r * w] === l; };
  const seen2 = new Uint8Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (seen2[s0] || lab[s0] < 0) continue;
    const me = lab[s0]; let top = 0; stack[top++] = s0; seen2[s0] = 1; const members = [], nb = new Map(); let core = 0;
    while (top) {
      const i = stack[--top]; members.push(i); if (!core && solid(i)) core = 1;
      const x = i % w, y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0) continue;
        if (lab[j] === me) { if (!seen2[j]) { seen2[j] = 1; stack[top++] = j; } }
        else nb.set(lab[j], (nb.get(lab[j]) || 0) + 1);
      }
    }
    if (core || nb.size < 2) continue;
    const tot = [...nb.values()].reduce((a, b) => a + b, 0), big = [...nb.entries()].filter(([, c]) => c >= 0.15 * tot);
    if (big.length < 2) continue;
    let best = null, bc = -1; for (const [l, c] of nb) if (l >= 0 && c > bc) { bc = c; best = l; }
    if (best !== null) for (const i of members) lab[i] = best;
  }
  return lab;
}

function borderLabel(lab, w, h) {
  // The color that covers most of the image's outer edge is the background.
  const counts = new Map(); let total = 0;
  const add = i => { const l = lab[i]; if (l < 0) return; counts.set(l, (counts.get(l) || 0) + 1); total++; };
  for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { add(y * w); add(y * w + w - 1); }
  let best = -1, bc = 0; for (const [l, c] of counts) if (c > bc) { bc = c; best = l; }
  return total && bc / total > 0.5 ? best : -1;
}

/* ---------- Dials to tracing numbers ---------- */
// The dials, measured in the source image's pixels so they act the same at any size.
//   Small details: the smallest piece kept.
//   Straight edges: how far an edge may stray from a line and still be drawn straight (0.4 to 2.6 px),
//   and how close to level or upright a line snaps (1 to 5 degrees).
//   Curves: how much edges are smoothed before fitting, and how loosely curves follow them.
//   Corners: how sharp a turn must be to stay a corner (60 degrees, rounder, to 20 degrees, sharper).
//   Grow or shrink: how far every edge moves out or in.
function tuneParams(T, sc) {
  const smooth = (T.smooth ?? 50) / 100, detail = (T.detail ?? 70) / 100, straight = (T.straight ?? 50) / 100, corners = (T.corners ?? 50) / 100;
  return {
    sigma: Math.max(0.8, sc * 0.45 * (0.5 + smooth)),
    speckArea: (2 + (1 - detail) * 8) ** 2 * 0.5 * sc,
    lineSrc: straight <= 0.5 ? 0.4 + 1.6 * straight : 1.2 + 2.8 * (straight - 0.5),
    snapDeg: 1 + 4 * straight, cornerDeg: 60 - 40 * corners, grow: (T.grow || 0) * sc,
    tol: 0.55 * sc * (0.6 + 0.8 * smooth), k: Math.max(4, Math.round(1.2 * sc)),
  };
}
// Two colors count as the same layer across retraces when they're within a small color distance.
function hexNear(a, b) { return a === b || d2(rgb2lab(...fromHex(a)), rgb2lab(...fromHex(b))) < 12 * 12; }
// The layer's own tune (parts tunes are looked up per shape).
function tuneFor(hex) { return (typeof tunes !== "undefined" ? tunes : []).find(t => t.kind === "layer" && hexNear(t.hex, hex)) || null; }

/* ---------- Mask tools for tracing ---------- */
// Moves every point of a closed outline d pixels along its normal (positive: out of the outline's inside).
function offsetContour(q, d) {
  const n = q.length; if (n < 3) return q;
  return q.map((p, i) => {
    const a = q[(i - 2 + n) % n], b = q[(i + 2) % n], tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
    return [p[0] + ty / L * d, p[1] - tx / L * d];
  });
}
function blurMask(mask, w, h, sigma) {
  const r = Math.ceil(3 * sigma), k = []; let s = 0; for (let i = -r; i <= r; i++) { const v = Math.exp(-0.5 * (i / sigma) ** 2); k.push(v); s += v; } for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { const row = y * w; for (let x = 0; x < w; x++) { let a = 0; for (let j = -r; j <= r; j++) { const xx = x + j; if (xx >= 0 && xx < w) a += mask[row + xx] * k[j + r]; } tmp[row + x] = a; } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let j = -r; j <= r; j++) { const yy = y + j; if (yy >= 0 && yy < h) a += tmp[yy * w + x] * k[j + r]; } out[y * w + x] = a; }
  return out;
}
function components8(mask, w, h) {
  const cc = new Int32Array(w * h), stack = new Int32Array(w * h); let next = 0;
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!mask[s0] || cc[s0]) continue; next++; let top = 0; stack[top++] = s0; cc[s0] = next;
    while (top) {
      const i = stack[--top], x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx; if (mask[j] && !cc[j]) { cc[j] = next; stack[top++] = j; }
      }
    }
  }
  return cc;
}
// Fills every hole in a mask: anything the outside can't reach becomes solid.
function fillMaskHoles(mask, w, h) {
  const out = new Uint8Array(w * h), stack = new Int32Array(w * h); let top = 0;
  const push = i => { if (!mask[i] && !out[i]) { out[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) { const i = stack[--top], x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w); }
  for (let i = 0; i < w * h; i++) if (!out[i]) mask[i] = 1;
  return mask;
}
function erodeDisc(mask, w, h, r) {
  const offs = []; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) offs.push([dx, dy]);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!mask[i]) continue; let ok = 1;
    for (const [dx, dy] of offs) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) { ok = 0; break; } }
    out[i] = ok;
  }
  return out;
}

/* ---------- Convert ---------- */
let convTimer = 0, convSeq = 0;
let useShape = {};            // shape id -> true (shape) | false (traced outline)
function convert(delay = 0) {
  if (!job) return;
  clearTimeout(convTimer);
  convTimer = setTimeout(runConvert, delay);
}
let convWaiters = [];
function convertDone() { return new Promise(r => convWaiters.push(r)); }
async function runConvert() {
  const seq = ++convSeq;
  setStatus("working", "Converting");
  $("#busy").hidden = false;
  if (S.bg === "ai" && !job.cutImgd) {
    const ok = await makeCutout(job);
    if (seq !== convSeq) return;
    if (!ok) { S.bg = "remove"; syncControls(); toast("Background removal didn't work on this image, so Vectorize removed the edge color instead."); }
  }
  setTimeout(() => {
    try {
      if (seq !== convSeq) return;
      result = traceNow(() => seq !== convSeq);
      if (!result) return;
      setSelection([]); reapplyManual(); setupText(); afterTrace();
      const hexes = new Set(result.palette.map(p => p.hex));
      for (const key of Object.keys(recolor)) if (!hexes.has(key)) delete recolor[key];
      for (const key of [...hidden]) if (!hexes.has(key)) hidden.delete(key);
      render();
      setStatus("done", `Converted in ${result.seconds.toFixed(1)} s`);
    } catch (e) {
      console.error(e); setStatus("error", "Couldn't convert");
      $("#stats").textContent = "Something went wrong while tracing. Try fewer colors or a smaller image.";
    } finally { if (seq === convSeq) { $("#busy").hidden = true; const w = convWaiters; convWaiters = []; w.forEach(f => f(result)); } }
  }, 40);
}
// Traces the current job with the current settings and returns the result.
// Runs synchronously; cancelled() lets a newer conversion stop this one early.
function traceNow(cancelled = () => false) {
  const t0 = performance.now();
  {
    {
      const W = job.workW, H = job.workH, N = W * H;
      job.prepared = prepareImage(sourcePixels());
      const { pal } = buildPalette(job.prepared);
      const lab = quantize(job.prepared, pal);
      if (cancelled()) return null;

      // Background: every pixel of the color that covers the border becomes transparent.
      const bgl = borderLabel(lab, W, H);
      if (bgl >= 0 && S.bg === "remove") for (let i = 0; i < N; i++) if (lab[i] === bgl) lab[i] = -1;
      // Silhouette: everything that isn't background becomes the darkest color.
      if (S.fillHoles) {
        let dark = -1, dl = Infinity; const present = new Set(); for (let i = 0; i < N; i++) if (lab[i] >= 0) present.add(lab[i]);
        for (const l of present) { const L = rgb2lab(...pal[l].rgb)[0]; if (L < dl) { dl = L; dark = l; } }
        if (dark >= 0) for (let i = 0; i < N; i++) if (lab[i] >= 0) lab[i] = dark;
      }

      // True colors: the average of each color's interior pixels (locked and B&W stay exact).
      const src = (S.gray ? job.prepared : sourcePixels()).data, sums = pal.map(() => [0, 0, 0, 0]);   // grayscale keeps its grays
      const rin = Math.max(3, Math.round(2 * Math.max(job.scale, 1)));
      for (let y = rin; y < H - rin; y++) for (let x = rin; x < W - rin; x++) {
        const i = y * W + x, l = lab[i]; if (l < 0 || lab[i - rin] !== l || lab[i + rin] !== l || lab[i - rin * W] !== l || lab[i + rin * W] !== l || lab[i - rin - rin * W] !== l || lab[i + rin + rin * W] !== l) continue;
        const s = sums[l]; s[0] += src[i * 4]; s[1] += src[i * 4 + 1]; s[2] += src[i * 4 + 2]; s[3]++;
      }
      const colors = pal.map((p, l) => (p.lock || S.cmode === "bw" || sums[l][3] < 20) ? toHex(...p.rgb) : toHex(Math.round(sums[l][0] / sums[l][3]), Math.round(sums[l][1] / sums[l][3]), Math.round(sums[l][2] / sums[l][3])));

      // Stack order: largest area at the bottom.
      const areas = new Array(pal.length).fill(0); for (let i = 0; i < N; i++) if (lab[i] >= 0) areas[lab[i]]++;
      const order = areas.map((a, l) => l).filter(l => areas[l] > 0).sort((a, b) => areas[b] - areas[a]);

      const sc = Math.max(job.scale, 1), P0 = tuneParams(S, sc), { snapDeg } = P0;
      const strict = 0.7, matching = S.shapes;
      const layers = [], shapes = [], allOutlines = []; let pieces = 0, budget = 2500, tplBudget = 60;
      order.forEach((c, li) => {
        // A tuned layer traces with its own dials; a tuned shape inside it, with its own on top of those.
        const hex = colors[c], lt = tuneFor(hex, null), LS = lt ? { ...S, ...lt.set } : S, LP = lt ? tuneParams(LS, sc) : P0;
        const { sigma, speckArea } = LP;
        const partTunes = (typeof tunes !== "undefined" ? tunes : []).filter(t => t.kind === "parts" && t.parts.some(pt => hexNear(pt.hex, hex)));
        const paramsFor = q => {
          if (!partTunes.length) return LP;
          const b = bboxOf(q), t = partTunes.find(t => t.parts.some(pt => hexNear(pt.hex, hex) && boxIoU(pt.box, b) > 0.5));
          return t ? tuneParams({ ...LS, ...t.set }, sc) : LP;
        };
        const upper = new Set(order.slice(li)); let mask = new Uint8Array(N);
        // Cut out: each color is only its own pixels, so colors never overlap (for separations, vinyl, and print).
        if (S.layering === "cutout") { for (let i = 0; i < N; i++) mask[i] = lab[i] === c ? 1 : 0; }
        else for (let i = 0; i < N; i++) if (lab[i] >= 0 && upper.has(lab[i])) mask[i] = 1;
        if (S.layering !== "cutout") {
          // Drop regions made only of higher layers, then stop slightly short under
          // the outer edge of higher layers so this color never peeks out around them.
          // A region also needs a real share of its own color: a few stray edge pixels don't earn a hidden copy.
          const cc = components8(mask, W, H), ownN = new Map(), size = new Map();
          for (let i = 0; i < N; i++) if (mask[i]) { size.set(cc[i], (size.get(cc[i]) || 0) + 1); if (lab[i] === c) ownN.set(cc[i], (ownN.get(cc[i]) || 0) + 1); }
          const keep = id => { const o = ownN.get(id) || 0; return o > 0 && (o >= 0.03 * size.get(id) || o >= 4 * speckArea); };
          for (let i = 0; i < N; i++) if (mask[i] && !keep(cc[i])) mask[i] = 0;
          const inner = erodeDisc(mask, W, H, Math.max(1, Math.round(sc)));
          for (let i = 0; i < N; i++) mask[i] = (lab[i] === c || (mask[i] && inner[i])) ? 1 : 0;
        }
        if (S.fillHoles) fillMaskHoles(mask, W, H);
        const f = blurMask(mask, W, H, sigma);
        const minSpeck = Math.min(speckArea, ...partTunes.map(t => tuneParams({ ...LS, ...t.set }, sc).speckArea));
        const contours = VZ.maskContours(f, W, H).filter(q => Math.abs(VZ.area(q)) >= minSpeck).filter(q => Math.abs(VZ.area(q)) >= paramsFor(q).speckArea);
        if (!contours.length) return;
        const nested = VZ.nest(contours), cp = contours.map(paramsFor);
        if (cp.some(P => P.grow)) {
          // Each outline's normal points out of its own inside, so outer edges move out and holes move in.
          const isHole = new Set(); for (const [, hs] of nested) for (const h of hs) isHole.add(h);
          contours.forEach((q, ci) => { const g = cp[ci].grow; if (g) contours[ci] = offsetContour(q, isHole.has(ci) ? -g : g); });
        }
        const recs = contours.map((q, ci) => {
          const { tol, k, cornerDeg, lineSrc } = cp[ci];
          // Up to 0.6 source pixels of stray is pixel noise; past that a run must also be two-sided to be straight.
          const ol = VZ.fitOutline(q, tol, k, cornerDeg, lineSrc * sc, Math.max(16, Math.round(12 * sc)), 1.6, 0.6 * sc);
          allOutlines.push(ol); pieces += ol.segs.length;
          const rec = { outline: ol, shape: null, q };
          if (matching && budget-- > 0) {
            const pr = VZ.resampleClosed(q, 1), size = Math.sqrt(Math.abs(VZ.area(pr)));
            const tolAbs = (0.6 + 1.4 * (1 - strict)) * sc, tolRel = (0.004 + 0.012 * (1 - strict)) * size;
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of pr) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
            const isCanvas = x0 < 2 && y0 < 2 && x1 > W - 2 && y1 > H - 2;
            const mtol = Math.max(tolAbs, Math.min(tolRel, 3 * tolAbs));
            let shp = size >= Math.max(16, 10 * sc) && !isCanvas ? VZ.matchShape(pr, mtol) : null;
            if (shp) {
              shp.match = Math.round(VZ.overlapPct(pr, VZ.boundary(shp)) * 10) / 10;
              const rel = VZ.relativeResidual(pr, shp, 3 * sc * (shp.kind === "star" ? 2.5 : 1));
              // True shapes sit near 0.1 px of average deviation; letterforms and near-misses at 0.2 px and up.
              if (rel * size / sc > 0.08 + 0.33 * (1 - strict) || rel > 0.004 || shp.match < 97) shp = null;
            }
            // Stars, rounded polygons, hearts, arrows, and arcs: fitted templates, graded the same way.
            if (!shp && size >= Math.max(24, 14 * sc) && !isCanvas && tplBudget-- > 0) {
              const t = VZ.matchTemplate(pr, mtol, sc);
              if (t) {
                t.match = Math.round(VZ.overlapPct(pr, VZ.boundary(t)) * 10) / 10;
                const rel = VZ.relativeResidual(pr, t, t.zone);
                // Blur rounds sharp points, which costs overlap but not edge accuracy, so a very close
                // edge fit may pass with a little less overlap.
                const minMatch = rel <= 0.004 && t.sharp && t.sharp.length ? 93.5 : 96.5;
                if (!(rel * size / sc > 0.08 + 0.33 * (1 - strict) + 0.12 || rel > 0.006 || t.match < minMatch)) shp = t;
              }
            }
            if (shp) {
              const sig = s => { const b = VZ.boundary(s, 64); let a = [Infinity, Infinity, -Infinity, -Infinity, 0, 0]; for (const p of b) { a[0] = Math.min(a[0], p[0]); a[1] = Math.min(a[1], p[1]); a[2] = Math.max(a[2], p[0]); a[3] = Math.max(a[3], p[1]); a[4] += p[0] / b.length; a[5] += p[1] / b.length; } return a; };
              const t = sig(shp), twin = shapes.find(o => o.kind === shp.kind && sig(o).every((v, i) => Math.abs(v - t[i]) < sc));
              if (twin) rec.shape = twin; else { shp.id = "shape-" + (shapes.length + 1); shp.color = c; rec.shape = shp; shapes.push(shp); }
            }
          }
          return rec;
        });
        const items = nested.map(([o, holes]) => ({ outer: recs[o], holes: holes.map(hh => recs[hh]) }));
        // A circle with one concentric circular hole is a ring.
        if (matching) for (const it of items) {
          const a = it.outer.shape, b = it.holes.length === 1 && it.holes[0].shape;
          if (a && b && a.kind === "circle" && b.kind === "circle") {
            const ring = VZ.ringShape(VZ.boundary(a), VZ.boundary(b), 1.5 * sc);
            if (ring) {
              ring.id = a.id; ring.color = a.color; ring.match = Math.min(a.match, b.match);
              shapes.splice(shapes.indexOf(a), 1, ring); const bi = shapes.indexOf(b); if (bi >= 0) shapes.splice(bi, 1);
              it.outer.shape = ring; it.holes[0].shape = null;
            }
          }
        }
        layers.push({ label: c, items, mask });
      });
      if (cancelled()) return null;
      if (S.snap) { VZ.snapOutlines(allOutlines, snapDeg, 0.75 * sc); VZ.snapShapes(shapes, 0.75 * sc); }

      const palette = order.map(l => ({ hex: colors[l], lock: !!pal[l].lock, count: 0 }));
      layers.forEach(L => { L.hex = colors[L.label]; const p = palette.find(q => q.hex === L.hex); if (p) p.count += L.items.length; });
      const bgHex = bgl >= 0 && S.bg === "remove" ? colors[bgl] : null;
      if (bgHex && S.bg === "remove" && !palette.some(p => p.hex === bgHex)) palette.push({ hex: bgHex, bg: true, count: 0 });
      palette.forEach(p => { if (p.hex === bgHex) p.bg = true; });

      useShape = {};
      for (const s of shapes) useShape[s.id] = S.shapes === "auto";
      return { palette, layers, shapes, w: W, h: H, pieces, seconds: (performance.now() - t0) / 1000, transparent: S.bg !== "keep" || job.hasAlpha };
    }
  }
}

/* ---------- SVG out ---------- */
// Bottom to top, without deleted layers. drawOrder (hexes, bottom to top) is set when you reorder layers.
function orderedLayers(withDeleted = false) {
  if (!result) return [];
  let Ls = result.layers.slice();
  if (drawOrder) Ls = drawOrder.map(h => Ls.find(L => L.hex === h)).filter(Boolean).concat(Ls.filter(L => !drawOrder.includes(L.hex)));
  return withDeleted ? Ls : Ls.filter(L => !deletedLayers.has(L.hex));
}
function visibleLayers() { return orderedLayers().filter(L => !hidden.has(L.hex)); }
function itemD(it) {
  const s = it.outer.shape, on = s && useShape[s.id];
  const holes = on && s.consumesHole ? it.holes.slice(1) : it.holes;
  return (on ? VZ.shapeD(s) : VZ.outlineD(it.outer.outline)) + holes.map(r => r.shape && useShape[r.shape.id] ? VZ.shapeD(r.shape) : VZ.outlineD(r.outline)).join("");
}
function activeWords(li) { return (result.texts || []).filter(T => T.li === li && !T.removed && T.mode !== "original" && T.repl); }
// part: "all", "art" (everything except words), or "text" (words only). Bounds of what was drawn go into box.
function layerBody(L, li, keyed, part = "all", box = null, only = null) {
  const pick = ii => !only || only.has(li + ":" + ii);
  const out = [], words = activeWords(li).filter(T => (!only || T.items.some(pick)) && !T.items.every(ii => L.items[ii].off)), grow = b => { if (box) { box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]); box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]); } };
  const skip = new Set(); for (const T of words) for (const ii of T.items) skip.add(ii);
  // Letters of a word left as traced still count as text for the wordmark file.
  const textItems = new Set(); for (const T of (result.texts || [])) if (T.li === li && !T.removed) for (const ii of T.items) textItems.add(ii);
  L.items.forEach((it, ii) => {
    if (skip.has(ii) || it.off || !pick(ii)) return;
    const isText = textItems.has(ii); if ((part === "art" && isText) || (part === "text" && !isText)) return;
    const s = it.outer.shape, on = s && useShape[s.id], k = keyed ? ` data-k="${li}:${ii}"` : "";
    grow(bboxOf(it.outer.q));
    if (on && !it.holes.length) { out.push(VZ.shapeElement(s, s.id).replace(/^<(\w+)/, `<$1${k}`)); return; }
    out.push(`<path${k} d="${itemD(it)}"/>`);
  });
  if (part !== "art") for (const T of words) {
    const font = T.mode === "font" && T.pick ? ` data-font="${esc(T.pick.label || T.pick.fam)} ${T.pick.w}"` : "";
    for (const it of T.repl) grow(bboxOf(it.outer.q));
    out.push(`<g data-text="${esc(T.text || "")}"${font}>` + `<path${keyed ? ` data-t="${T.id}"` : ""} d="${T.repl.map(it => [it.outer, ...it.holes].map(r => VZ.outlineD(r.outline)).join("")).join("")}"/>` + `</g>`);
  }
  return out.map(e => "    " + e + "\n").join("");
}
function buildSVG(keyed = false, opts = {}) {
  const { w, h } = result, part = opts.part || "all", box = [Infinity, Infinity, -Infinity, -Infinity];
  let body = "", used = {}, n = 0;
  for (const L of opts.layers || visibleLayers()) {
    const li = result.layers.indexOf(L), inner = layerBody(L, li, keyed, part, box, opts.only); if (!inner) continue; n++;
    const fill = recolor[L.hex] || L.hex; let name = colorName(fill); used[name] = (used[name] || 0) + 1; if (used[name] > 1) name += " " + used[name];
    body += `  <g id="${name.toLowerCase().replace(/\s+/g, "-")}" data-name="${name}"${keyed ? ` data-l="${li}"` : ""} fill="${fill}" fill-rule="evenodd">\n` + inner + `  </g>\n`;
  }
  // What it's made for can add a sticker border and cut line, and a real-world size for PDF and EPS.
  const deco = n && !opts.noDest && typeof destDecor === "function" ? destDecor(opts, keyed) : null;
  if (deco) { body = deco.before + body + deco.after; if (deco.extent) { const e = deco.extent; box[0] = Math.min(box[0], e[0]); box[1] = Math.min(box[1], e[1]); box[2] = Math.max(box[2], e[2]); box[3] = Math.max(box[3], e[3]); } }
  const ppu = deco && deco.ppu ? ` data-pt-per-unit="${+deco.ppu.toPrecision(6)}"` : "";
  const f = v => Math.round(v * 100) / 100, k = job.origW / w;
  if (opts.crop) {
    if (!n || !isFinite(box[0])) return null;
    // Tight artwork box with a small margin, sized in the original image's pixels.
    const m = 0.02 * Math.max(box[2] - box[0], box[3] - box[1]), x = box[0] - m, y = box[1] - m, bw = box[2] - box[0] + 2 * m, bh = box[3] - box[1] + 2 * m;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(bw * k)}" height="${f(bh * k)}" viewBox="${f(x)} ${f(y)} ${f(bw)} ${f(bh)}"${ppu}>\n` + body + "</svg>\n";
  }
  if (deco && deco.extent) {
    // A sticker border can reach past the image, so the page grows to hold it.
    const e = deco.extent, x0 = Math.min(0, e[0]), y0 = Math.min(0, e[1]), x1 = Math.max(w, e[2]), y1 = Math.max(h, e[3]);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${f((x1 - x0) * k)}" height="${f((y1 - y0) * k)}" viewBox="${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)}"${ppu}>\n` + body + "</svg>\n";
  }
  const over = deco && deco.overflow ? ' overflow="visible"' : "";   // on screen, a sticker border may reach past the image
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${job.origW}" height="${job.origH}" viewBox="0 0 ${w} ${h}"${ppu}${over}>\n` + body + "</svg>\n";
}

function render() {
  if (!result || renderPaused) return;
  const svg = buildSVG(false, { part: partMode });
  $("#vec").innerHTML = buildSVG(true, { part: partMode });
  drawSelection();
  if (typeof afterRender === "function") afterRender();
  $("#sheet").classList.toggle("clear", result.transparent || hidden.size > 0 || deletedLayers.size > 0);
  const kb = new Blob([svg]).size / 1024, nColors = visibleLayers().length;
  const nShapes = visibleLayers().reduce((s, L) => s + L.items.filter(it => !it.off).length, 0), matched = result.shapes.filter(s => useShape[s.id]).length;
  $("#stats").textContent = `${nColors} ${nColors === 1 ? "color" : "colors"} · ${nShapes.toLocaleString()} ${nShapes === 1 ? "shape" : "shapes"}${matched ? ` (${matched} exact)` : ""} · ${kb < 1024 ? kb.toFixed(0) + " KB" : (kb / 1024).toFixed(1) + " MB"}`;
  $("#exportBtn").disabled = nColors === 0; $("#exportMenuBtn").disabled = nColors === 0; $("#versaBtn").disabled = nColors === 0;
  $("#shapeCount").textContent = result.shapes.length; $("#shapeCount").hidden = !result.shapes.length;
  renderPalette(); renderShapes(); renderTexts(); renderParts(); applyView(); renderBatch();
}

/* ---------- Select an outline and snap it to a shape ---------- */
let sel = null, manualN = 0, manualSnaps = [];
const SNAPS = [["circle", "Circle"], ["ellipse", "Ellipse"], ["rect", "Rectangle"], ["rounded_rect", "Rounded"], ["pill", "Pill"], ["polygon", "Polygon"], ["star", "Star"], ["heart", "Heart"], ["arrow", "Arrow"], ["arc", "Arc"], ["ring", "Ring"]];
function bboxOf(pts) { let a = [Infinity, Infinity, -Infinity, -Infinity]; for (const q of pts) { a[0] = Math.min(a[0], q[0]); a[1] = Math.min(a[1], q[1]); a[2] = Math.max(a[2], q[0]); a[3] = Math.max(a[3], q[1]); } return a; }
function selItem() { return sel && result && result.layers[sel.li] && result.layers[sel.li].items[sel.ii]; }
$("#snapChips").addEventListener("click", e => { const b = e.target.closest("[data-snap]"); if (b) snapSelected(b.dataset.snap); });
function fitManual(it, kind) {
  const sc = Math.max(job.scale, 1);
  const S = kind === "ring" ? VZ.ringShape(it.outer.q, it.holes[0].q, Infinity) : VZ.snapTo(it.outer.q, kind, sc);
  if (!S) return null;
  const bnd = VZ.boundary(S); S.match = Math.round(VZ.overlapPct(it.outer.q, bnd) * 10) / 10;
  S.id = "shape-m" + (++manualN); S.manual = true;
  return S;
}
function applyManual(it, S) {
  const old = it.outer.shape; if (old) { const i = result.shapes.indexOf(old); if (i >= 0) result.shapes.splice(i, 1); }
  it.outer.shape = S; result.shapes.push(S); useShape[S.id] = true;
}
function snapSelected(kind) {
  const it = selItem(); if (!it) return;
  pushUndo();
  if (kind === "text") { markAsText(sel.li, sel.ii); return; }
  const box = bboxOf(it.outer.q), same = m => m.box.every((v, i) => Math.abs(v - box[i]) < 0.02 * Math.max(result.w, result.h));
  manualSnaps = manualSnaps.filter(m => !same(m));
  if (kind === "traced") { const s = it.outer.shape; if (s) useShape[s.id] = false; manualSnaps.push({ box, kind }); render(); toast("Back to the traced outline."); return; }
  setStatus("working", "Fitting");
  setTimeout(() => {
    const S = fitManual(it, kind);
    if (!S) { setStatus("error", "Couldn't fit"); toast("That outline can't be fitted as this shape. Try another shape."); return; }
    applyManual(it, S); manualSnaps.push({ box, kind });
    render(); setStatus("done", "Snapped");
    toast(S.match < 90 ? `Loose fit: ${S.label}, ${S.match.toFixed(0)}% match. Choose Traced to undo.` : `Snapped to ${S.label.toLowerCase()}, ${S.match.toFixed(1)}% match.`);
  }, 20);
}
function reapplyManual() {
  // Keep manual snaps when settings change: find the outline in the same place and fit it again.
  const tolBox = 0.02 * Math.max(result.w, result.h);
  for (const m of manualSnaps) for (const L of result.layers) for (const it of L.items) {
    const b = bboxOf(it.outer.q); if (!b.every((v, i) => Math.abs(v - m.box[i]) < tolBox)) continue;
    if (m.kind === "traced") { if (it.outer.shape) useShape[it.outer.shape.id] = false; continue; }
    if (m.kind === "ring" && !it.holes.length) continue;
    const S = fitManual(it, m.kind); if (S) applyManual(it, S);
  }
}

/* ---------- Text: find words, clean up letters, match fonts ---------- */
// Google Fonts to compare against, with the weights each family offers.
let FONTS = [
  ["Roboto", [400, 700, 900]], ["Open Sans", [400, 700, 800]], ["Montserrat", [400, 600, 700, 800, 900]], ["Poppins", [400, 600, 700, 800, 900]],
  ["Lato", [400, 700, 900]], ["Nunito", [400, 700, 900]], ["Raleway", [400, 700, 900]], ["Work Sans", [400, 700, 900]], ["DM Sans", [400, 700]],
  ["Rubik", [400, 700, 900]], ["Inter", [400, 700, 900]], ["Manrope", [400, 800]], ["Outfit", [400, 700, 900]], ["League Spartan", [400, 700, 900]],
  ["Space Grotesk", [400, 700]], ["Barlow", [400, 700, 900]], ["Barlow Condensed", [400, 700]], ["Oswald", [400, 700]], ["Bebas Neue", [400]],
  ["Anton", [400]], ["Archivo Black", [400]], ["Source Sans 3", [400, 700, 900]], ["PT Sans", [400, 700]], ["Josefin Sans", [400, 700]],
  ["Fredoka", [400, 700]], ["Quicksand", [400, 700]], ["Comfortaa", [400, 700]], ["Varela Round", [400]], ["Baloo 2", [400, 800]], ["Righteous", [400]],
  ["Playfair Display", [400, 700, 900]], ["Merriweather", [400, 700, 900]], ["Lora", [400, 700]], ["Roboto Slab", [400, 700, 900]], ["Zilla Slab", [400, 700]],
  ["Arvo", [400, 700]], ["Alfa Slab One", [400]], ["Libre Baskerville", [400, 700]], ["EB Garamond", [400, 700]], ["DM Serif Display", [400]],
  ["Abril Fatface", [400]], ["Pacifico", [400]], ["Lobster", [400]], ["Dancing Script", [400, 700]], ["Permanent Marker", [400]], ["Caveat", [400, 700]],
  ["Roboto Mono", [400, 700]], ["Space Mono", [400, 700]],
];
const WEIGHT_NAME = { 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };
let fontsReady = null;
// Loads every weight each family offers. Each weight is its own small request, so a weight a family
// doesn't have fails alone instead of blocking the family. Weights that draw the same as another
// (the browser substituting a nearby weight) are dropped.
const LOAD_WEIGHTS = [300, 400, 500, 600, 700, 800, 900];
function cssLink(q) {
  return new Promise(r => {
    const l = document.createElement("link"); l.rel = "stylesheet";
    l.href = `https://fonts.googleapis.com/css2?family=${q}&display=block`;
    l.onload = () => r(true); l.onerror = () => { l.remove(); r(false); }; document.head.appendChild(l); setTimeout(() => r(false), 8000);
  });
}
function loadFonts(text) {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    const ok = [];
    await Promise.all(FONTS.map(async ([fam, ws]) => {
      let weights = ws;
      if (!window.__VZ_LOCAL_FONTS) {
        const q = encodeURIComponent(fam).replace(/%20/g, "+");
        const got = await Promise.all(LOAD_WEIGHTS.map(w => cssLink(`${q}:wght@${w}`)));
        weights = LOAD_WEIGHTS.filter((w, i) => got[i]);
        if (!weights.length && await cssLink(q)) weights = [400];
      }
      const loaded = [];
      for (const w of weights) {
        try {
          const faces = await Promise.race([document.fonts.load(`${w} 40px "${fam}"`, text || "Aa"), new Promise(r => setTimeout(() => r([]), 6000))]);
          if (faces && faces.length) loaded.push(w);
        } catch (e) { /* skip faces that fail to load */ }
      }
      const c = document.createElement("canvas").getContext("2d"), seen = new Set();
      for (const w of loaded) {
        c.font = `${w} 60px "${fam}"`; const k = c.measureText("Hamburgefonstiv").width.toFixed(2);
        if (!seen.has(k)) { seen.add(k); ok.push([fam, w]); }
      }
    }));
    return ok;
  })();
  return fontsReady;
}

/* Find runs of letter-sized outlines that sit on a line: words. */
function detectText(layers) {
  const runs = [];
  layers.forEach((L, li) => {
    const boxes = L.items.map((it, ii) => ({ ii, b: bboxOf(it.outer.q) })).filter(o => o.b[3] - o.b[1] > 3);
    const n = boxes.length, parent = boxes.map((_, i) => i), find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const A = boxes[i].b, B = boxes[j].b, ha = A[3] - A[1], hb = B[3] - B[1];
      if (Math.max(ha, hb) / Math.min(ha, hb) > 2.6) continue;
      const vo = Math.min(A[3], B[3]) - Math.max(A[1], B[1]); if (vo < 0.5 * Math.min(ha, hb)) continue;
      const gap = Math.max(A[0], B[0]) - Math.min(A[2], B[2]); if (gap > 0.9 * Math.max(ha, hb) || gap < -0.5 * Math.min(A[2] - A[0], B[2] - B[0])) continue;
      parent[find(i)] = find(j);
    }
    const groups0 = {}; boxes.forEach((o, i) => (groups0[find(i)] = groups0[find(i)] || []).push(o));
    // Split a run where the gap is far wider than the spacing between its letters (a logo next to a word).
    const groups = [];
    for (const g0 of Object.values(groups0)) {
      const g = g0.slice().sort((a, b) => a.b[0] - b.b[0]); if (g.length < 3) continue;
      const hs = g.map(o => o.b[3] - o.b[1]).sort((a, b) => a - b), medH = hs[hs.length >> 1];
      let right = g[0].b[2]; const gaps = [];
      for (let i = 1; i < g.length; i++) { gaps.push(g[i].b[0] - right); right = Math.max(right, g[i].b[2]); }
      const pos = gaps.map(v => Math.max(0, v)).sort((a, b) => a - b), medGap = pos[pos.length >> 1];
      const limit = Math.max(0.6 * medH, 3.5 * medGap + 0.15 * medH);
      let cur = [g[0]];
      for (let i = 1; i < g.length; i++) { if (gaps[i - 1] > limit) { groups.push(cur); cur = []; } cur.push(g[i]); }
      groups.push(cur);
    }
    for (const g of groups) {
      if (g.length < 3) continue;
      let box = [Infinity, Infinity, -Infinity, -Infinity]; for (const o of g) box = [Math.min(box[0], o.b[0]), Math.min(box[1], o.b[1]), Math.max(box[2], o.b[2]), Math.max(box[3], o.b[3])];
      if ((box[2] - box[0]) / (box[3] - box[1]) < 1.6) continue;
      const set = new Set(g.map(o => o.ii));
      // Dots on i and j, accents, and punctuation: small outlines within the word's span.
      const hgt = box[3] - box[1];
      for (const o of boxes) if (!set.has(o.ii)) { const cx = (o.b[0] + o.b[2]) / 2, cy = (o.b[1] + o.b[3]) / 2; if (cx > box[0] && cx < box[2] && cy > box[1] - 0.6 * hgt && cy < box[3] + 0.3 * hgt && o.b[3] - o.b[1] < 0.5 * hgt && o.b[2] - o.b[0] < 0.5 * hgt) { set.add(o.ii); box = [Math.min(box[0], o.b[0]), Math.min(box[1], o.b[1]), Math.max(box[2], o.b[2]), Math.max(box[3], o.b[3])]; } }
      runs.push({ li, items: [...set].sort((a, b) => a - b), box });
    }
  });
  return runs;
}

/* The region's own pixels from the layer mask, cropped. */
function regionMask(T) {
  const L = result.layers[T.li], W = result.w, H = result.h, sc = Math.max(job.scale, 1), pad = Math.ceil(3 * sc) + 2;
  const x0 = Math.max(0, Math.floor(T.box[0]) - pad), y0 = Math.max(0, Math.floor(T.box[1]) - pad), x1 = Math.min(W, Math.ceil(T.box[2]) + pad), y1 = Math.min(H, Math.ceil(T.box[3]) + pad);
  const w = x1 - x0, h = y1 - y0, m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = L.mask[(y + y0) * W + x + x0];
  // Keep only pieces that belong to this word's outlines.
  const cc = components8(m, w, h), keep = new Set(), boxes = T.items.map(ii => bboxOf(L.items[ii].outer.q));
  const ext = new Map(); for (let i = 0; i < w * h; i++) if (cc[i]) { const x = i % w + x0, y = (i / w | 0) + y0; let e = ext.get(cc[i]); if (!e) ext.set(cc[i], e = [x, y, x, y]); e[0] = Math.min(e[0], x); e[1] = Math.min(e[1], y); e[2] = Math.max(e[2], x); e[3] = Math.max(e[3], y); }
  for (const [id, e] of ext) { const cx = (e[0] + e[2]) / 2, cy = (e[1] + e[3]) / 2; if (boxes.some(b => cx >= b[0] - 1 && cx <= b[2] + 1 && cy >= b[1] - 1 && cy <= b[3] + 1)) keep.add(id); }
  for (let i = 0; i < w * h; i++) m[i] = keep.has(cc[i]) ? 1 : 0;
  return { m, w, h, x0, y0 };
}

/* Trace a float field (0..1) at U times the working resolution into items in working coordinates. */
function scaleOutline(o, s, ox, oy) {
  return { V: o.V.map(p => [p[0] * s + ox, p[1] * s + oy]), segs: o.segs.map(g => g[0] === "C" ? ["C", [g[1][0] * s, g[1][1] * s], [g[2][0] * s, g[2][1] * s]] : g[0] === "A" ? ["A", g[1] * s, g[2], g[3]] : g) };
}
function dropShortSegs(o, minLen) {
  // Merge segments shorter than minLen into their neighbor (tiny ticks where two corners land close together).
  let V = o.V.slice(), segs = o.segs.slice(), changed = true;
  while (changed && V.length > 4) {
    changed = false;
    for (let i = 0; i < V.length; i++) {
      const a = V[i], b = V[(i + 1) % V.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minLen) { const j = (i + 1) % V.length; V.splice(j, 1); segs.splice(i, 1); if (j === 0) { V.unshift(V.pop()); segs.unshift(segs.pop()); } changed = true; break; }
    }
  }
  return { V, segs };
}
function traceField(f, w, h, U, ox, oy, fit) {
  const contours = VZ.maskContours(f, w, h).filter(q => Math.abs(VZ.area(q)) >= fit.minArea);
  const outs = contours.map(q => { const o = VZ.fitOutline(q, fit.tol, fit.k, fit.corner, fit.lineTol, fit.lineMin, fit.smooth || 1.6); return fit.minSeg ? dropShortSegs(o, fit.minSeg) : o; });
  if (fit.snap) VZ.snapOutlines(outs, fit.snap, fit.snapTol);
  const recs = contours.map((q, i) => ({ outline: scaleOutline(outs[i], 1 / U, ox, oy), shape: null, q: q.map(p => [p[0] / U + ox, p[1] / U + oy]) }));
  return VZ.nest(contours).map(([o, holes]) => ({ outer: recs[o], holes: holes.map(hh => recs[hh]) }));
}
function upsample(src, w, h, U) {
  const W2 = w * U, H2 = h * U, out = new Float32Array(W2 * H2);
  for (let y = 0; y < H2; y++) { const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / U - 0.5)), y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < W2; x++) { const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / U - 0.5)), x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      out[y * W2 + x] = (src[y0 * w + x0] * (1 - fx) + src[y0 * w + x1] * fx) * (1 - fy) + (src[y1 * w + x0] * (1 - fx) + src[y1 * w + x1] * fx) * fy; } }
  return out;
}

/* Clean up: smoother curves, straight stems and bars, crisp corners. */
function strokeWidth(m, w, h) {
  // Average stroke width: twice the area over the edge length.
  let A = 0, P = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (m[i]) { A++; if (!m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]) P++; } }
  return 2 * A / Math.max(1, P);
}
function cleanText(T) {
  // Everything scales with the stroke width, so thin and heavy lettering both clean up.
  // Each letter is cleaned on its own, so tightly spaced letters never melt together.
  const U = 4, R = regionMask(T), sw = Math.max(2, strokeWidth(R.m, R.w, R.h)), s = sw * U;
  const sig = Math.max(0.9, 0.12 * sw), pad = Math.ceil(3 * sig) + 2, cc = components8(R.m, R.w, R.h), ext = new Map();
  for (let i = 0; i < R.m.length; i++) if (cc[i]) { const x = i % R.w, y = i / R.w | 0; let e = ext.get(cc[i]); if (!e) ext.set(cc[i], e = [x, y, x, y]); e[0] = Math.min(e[0], x); e[1] = Math.min(e[1], y); e[2] = Math.max(e[2], x); e[3] = Math.max(e[3], y); }
  const fit = { minArea: (s * 0.45) ** 2, tol: 0.04 * s, k: Math.max(4, Math.round(0.4 * s)), corner: 35, lineTol: 0.02 * s, lineMin: Math.max(16, Math.round(1.0 * s)), snap: 2, snapTol: 0.08 * s, smooth: Math.max(1.6, 0.25 * s), minSeg: 0.12 * s };
  const out = [];
  for (const [id, e] of ext) {
    const x0 = Math.max(0, e[0] - pad), y0 = Math.max(0, e[1] - pad), x1 = Math.min(R.w, e[2] + 1 + pad), y1 = Math.min(R.h, e[3] + 1 + pad), w = x1 - x0, h = y1 - y0;
    const m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = cc[(y + y0) * R.w + x + x0] === id ? 1 : 0;
    // Small pieces (dots, accents) need only a light touch.
    const area = m.reduce((a, b) => a + b, 0), f = upsample(blurMask(m, w, h, area < sw * sw * 3 ? Math.max(0.9, 0.12 * sw) : sig), w, h, U);
    out.push(...traceField(f, w * U, h * U, U, R.x0 + x0, R.y0 + y0, area < sw * sw * 3 ? { ...fit, minArea: 4 } : fit));
  }
  return out;
}

/* Font matching: draw the typed text in each font, sized and spaced to the word, and compare pixels. */
function layoutText(ctx, text, fam, w, fs, track) {
  ctx.font = `${w} ${fs}px "${fam}"`;
  const xs = []; for (let i = 0; i < text.length; i++) xs.push(ctx.measureText(text.slice(0, i)).width + i * track);
  const m = ctx.measureText(text), n = Math.max(1, text.length - 1);
  return { xs, left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight + n * track, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent };
}
function drawText(ctx, text, fam, w, fs, track, x, y) {
  ctx.font = `${w} ${fs}px "${fam}"`; let i = 0;
  for (const ch of text) { ctx.fillText(ch, x + ctx.measureText(text.slice(0, i)).width + i * track, y); i += ch.length; }
}
function fitPlacement(ctx, text, fam, w, tw, th) {
  // Size from the ink height, then tracking from the ink width.
  let fs = 100, L = layoutText(ctx, text, fam, w, fs, 0); const ink = L.asc + L.desc; if (ink <= 0) return null;
  fs = 100 * th / ink; L = layoutText(ctx, text, fam, w, fs, 0);
  const n = Math.max(1, text.length - 1), track = (tw - (L.left + L.right)) / n;
  L = layoutText(ctx, text, fam, w, fs, track);
  return { fs, track, x: L.left, y: L.asc };
}
function maskIoU(a, b) { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { const p = a[k], q = b[k]; if (p || q) u++; if (p && q) i++; } return u ? i / u : 0; }
function renderMask(text, fam, w, P, cw, ch, ox, oy) {
  const c = renderMask.c || (renderMask.c = document.createElement("canvas")); c.width = cw; c.height = ch;
  const g = c.getContext("2d", { willReadFrequently: true }); g.clearRect(0, 0, cw, ch); g.fillStyle = "#000";
  drawText(g, text, fam, w, P.fs, P.track, ox + P.x + (P.dx || 0), oy + P.y + (P.dy || 0));
  const d = g.getImageData(0, 0, cw, ch).data, m = new Uint8Array(cw * ch); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0; return m;
}
// Fonts the user added: installed fonts found by name, uploaded files. [family, weight, source, label]
let customFaces = [];
async function matchFonts(T, text, only) {
  const faces = only || (await loadFonts(text)).concat(customFaces), R = regionMask(T);
  // Target: the word's pixels scaled to 72 px tall, with a margin.
  const bw = T.box[2] - T.box[0], bh = T.box[3] - T.box[1], s = 72 / bh, M = 8, cw = Math.ceil(bw * s) + 2 * M, chh = Math.ceil(bh * s) + 2 * M;
  const tgt = new Uint8Array(cw * chh);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) { const wx = Math.floor((x - M) / s + T.box[0]) - R.x0, wy = Math.floor((y - M) / s + T.box[1]) - R.y0; if (wx >= 0 && wy >= 0 && wx < R.w && wy < R.h) tgt[y * cw + x] = R.m[wy * R.w + wx]; }
  const ctx = document.createElement("canvas").getContext("2d"), variants = [...new Set([text, text.toUpperCase()])].filter(Boolean), scored = [];
  for (const [fam, w, src, label] of faces) for (const v of variants) {
    const P = fitPlacement(ctx, v, fam, w, bw * s, bh * s); if (!P || !isFinite(P.fs) || P.fs <= 0) continue;
    scored.push({ fam, w, src: src || "google", label: label || fam, text: v, P, iou: maskIoU(tgt, renderMask(v, fam, w, P, cw, chh, M, M)) });
  }
  scored.sort((a, b) => b.iou - a.iou);
  // Refine the best few: nudge size, spacing, and position.
  const top = scored.slice(0, 6);
  for (const c of top) {
    const steps = [["fs", c.P.fs * 0.03], ["track", c.P.fs * 0.02], ["dx", 1.5], ["dy", 1.5]];
    for (let round = 0; round < 3; round++) for (const [k, st] of steps) for (const sgn of [1, -1]) {
      const P2 = { ...c.P, [k]: (c.P[k] || 0) + sgn * st / (round + 1) }, v = maskIoU(tgt, renderMask(c.text, c.fam, c.w, P2, cw, chh, M, M));
      if (v > c.iou) { c.iou = v; c.P = P2; }
    }
  }
  top.sort((a, b) => b.iou - a.iou);
  // Keep one entry per family.
  const seen = new Set(), out = [];
  for (const c of top.concat(scored.slice(6))) { if (seen.has(c.fam)) continue; seen.add(c.fam); out.push({ ...c, s, M }); if (out.length === (only ? 99 : 4)) break; }
  return { faces: faces.length, results: out };
}
/* Replace the word with the chosen font, drawn at 4x and traced. */
function fontText(T, c) {
  const U = 4, k = U / c.s, pad = 6;
  const bw = T.box[2] - T.box[0], bh = T.box[3] - T.box[1], cw = Math.ceil((bw + 2 * pad) * U), chh = Math.ceil((bh + 2 * pad) * U);
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = chh; const g = cv.getContext("2d", { willReadFrequently: true }); g.fillStyle = "#000";
  drawText(g, c.text, c.fam, c.w, c.P.fs * k, c.P.track * k, pad * U + (c.P.x + (c.P.dx || 0)) * k, pad * U + (c.P.y + (c.P.dy || 0)) * k);
  const d = g.getImageData(0, 0, cw, chh).data, f = new Float32Array(cw * chh); for (let i = 0; i < f.length; i++) f[i] = d[i * 4 + 3] / 255;
  return traceField(f, cw, chh, U, T.box[0] - pad, T.box[1] - pad, { minArea: 4, tol: 0.6, k: 4, corner: 30, lineTol: 0.5, lineMin: 30, snap: 1.5, snapTol: 0.6 });
}

/* ---------- Text state ---------- */
let textMemory = [];      // what the user set per word: { box, text, mode, pick }
const boxIoU = (a, b) => { const iw = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), ih = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); if (iw <= 0 || ih <= 0) return 0; const i = iw * ih; return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i); };
function memFor(T) { return textMemory.find(m => boxIoU(m.box, T.box) > 0.6); }
function remember(T) { let m = memFor(T); if (!m) textMemory.push(m = { box: T.box.slice() }); Object.assign(m, { text: T.text, mode: T.mode, pick: T.pick ? { fam: T.pick.fam, w: T.pick.w } : null, removed: T.removed, manual: T.manual, auto: T.auto }); }
function setupText() {
  const runs = S.textMode === "off" ? [] : detectText(result.layers);
  // Words keep their traced letters by default; cleaned letters and fonts are choices in the Text tab.
  result.texts = runs.map((r, i) => ({ ...r, id: i, text: "", mode: "original", repl: null }));
  // Words the user marked by hand.
  for (const m of textMemory) if (m.manual && !result.texts.some(T => boxIoU(T.box, m.box) > 0.6)) {
    const t = manualRun(m.box); if (t) result.texts.push({ ...t, id: result.texts.length, text: "", mode: "original", repl: null, manual: true });
  }
  for (const T of result.texts) {
    const m = memFor(T); if (m) Object.assign(T, { text: m.text || "", mode: m.mode || "original", removed: m.removed, manual: m.manual, auto: m.auto });
    if (!T.removed && T.mode === "clean") T.repl = cleanText(T);
  }
  // Re-apply chosen fonts (fonts load in the background).
  for (const T of result.texts) { const m = memFor(T); if (m && m.mode === "font" && m.pick && m.text) applyFontPick(T, m.pick, true); }
}
function manualRun(box) {
  // Every outline on any layer whose center is inside the box joins; the layer with the most wins.
  let best = null;
  result.layers.forEach((L, li) => {
    const items = []; L.items.forEach((it, ii) => { const b = bboxOf(it.outer.q), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2; if (cx >= box[0] && cx <= box[2] && cy >= box[1] && cy <= box[3]) items.push(ii); });
    if (items.length && (!best || items.length > best.items.length)) best = { li, items };
  });
  if (!best) return null;
  let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const ii of best.items) { const q = bboxOf(result.layers[best.li].items[ii].outer.q); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; }
  return { ...best, box: b };
}
function textOf(li, ii) { return result.texts ? result.texts.find(T => !T.removed && T.li === li && T.mode !== "original" && T.repl && T.items.includes(ii)) : null; }
async function applyFontPick(T, pick, quiet) {
  try {
    const { results } = await matchFonts(T, T.text);
    const c = results.find(r => r.fam === pick.fam && r.w === pick.w) || (await matchOne(T, pick));
    if (!c) return;
    T.pick = c; T.repl = fontText(T, c); T.mode = "font"; remember(T); if (!quiet) toast(`Set in ${c.fam} ${WEIGHT_NAME[c.w] || c.w}.`); render();
  } catch (e) { console.error(e); }
}
async function matchOne(T, pick) { const save = FONTS; FONTS = FONTS.filter(f => f[0] === pick.fam); fontsReady = null; try { const r = await matchFonts(T, T.text); return r.results.find(x => x.w === pick.w) || r.results[0]; } finally { FONTS = save; fontsReady = null; } }

/* ---------- Text panel ---------- */
let textSel = null;
function renderTexts() {
  const list = (result.texts || []).filter(T => !T.removed);
  $("#textCount").textContent = list.length; $("#textCount").hidden = !list.length;
  $("#textList").innerHTML = list.length ? list.map(T => {
    const L = result.layers[T.li], n = T.items.length, picks = T.results || [];
    return `<div class="text-card${textSel === T.id ? " on" : ""}" data-tid="${T.id}">
      <div class="text-top"><b>${esc(colorName(recolor[L.hex] || L.hex))} word</b><small>${n} letters${T.manual ? " · marked by you" : ""}${T.auto && T.mode === "font" ? " · font matched automatically" : ""}</small><button type="button" class="link-btn" data-notext="${T.id}">Not text</button></div>
      <label class="text-field"><span>What does it say?</span><input type="text" id="tx-${T.id}" data-tin="${T.id}" value="${esc(T.text)}" placeholder="Type the word, like SUNNY CO" autocomplete="off" spellcheck="false"></label>
      <div class="seg full" role="group" aria-label="Letters">
        <button data-tmode="original" data-t="${T.id}" aria-pressed="${T.mode === "original"}">Traced</button>
        <button data-tmode="clean" data-t="${T.id}" aria-pressed="${T.mode === "clean"}">Cleaned</button>
        <button data-tmode="font" data-t="${T.id}" aria-pressed="${T.mode === "font"}" ${T.text.trim() ? "" : "disabled"}>Font</button>
      </div>
      ${T.mode === "font" || picks.length ? `<div class="font-list">${T.busy ? `<p class="help">${esc(T.busy)}</p>` : picks.map((c, i) => `<button type="button" class="font-row" data-pick="${T.id}:${i}" aria-pressed="${!!(T.pick && T.pick.fam === c.fam && T.pick.w === c.w && T.mode === "font")}"><span class="fprev" style="font-family:'${esc(c.fam)}';font-weight:${c.w}">${esc(c.text)}</span><span class="fmeta"><b>${esc(c.label || c.fam)}</b>${c.src === "file" ? "" : " " + (WEIGHT_NAME[c.w] || c.w)} · ${Math.round(c.iou * 100)}% match${c.src === "installed" ? " · on this computer" : c.src === "file" ? " · your file" : ""}</span></button>`).join("")}</div>` : ""}
      ${T.text.trim() ? `<details class="own-font"${T.ownOpen ? " open" : ""} data-own="${T.id}"><summary>Use a specific font</summary>
        <div class="own-row"><input type="text" id="fn-${T.id}" data-fname="${T.id}" list="localFonts" value="${esc(T.ownName || "")}" placeholder="Font name, like Futura" autocomplete="off" spellcheck="false"><button type="button" class="btn btn-soft btn-sm" data-ffind="${T.id}"><span class="inner">Use</span></button></div>
        <div class="own-row"><button type="button" class="link-btn" data-fupload="${T.id}">Upload a font file</button>${NATIVE || "queryLocalFonts" in window ? `<button type="button" class="link-btn" data-fbrowse="${T.id}">Browse installed fonts</button>` : ""}</div>
        <p class="help">Checks fonts installed on this computer first, then Google Fonts. Upload a .ttf, .otf, or .woff2 file for fonts from Adobe Fonts or other foundries.</p>
      </details>` : ""}
    </div>`;
  }).join("") : `<p class="help">${S.textMode === "off" ? "Text detection is off. Turn it on in Setup." : "No words found. Select letters in the vector and choose Text to mark them."}</p>`;
}
$("#textList").addEventListener("input", e => { const i = e.target.closest("[data-tin]"); if (!i) return; const T = result.texts[+i.dataset.tin]; pushUndo("text:" + T.id); T.text = i.value; remember(T); const fb = $(`[data-tmode="font"][data-t="${T.id}"]`); if (fb) fb.disabled = !T.text.trim(); });
$("#textList").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.closest("[data-tin]")) { const T = result.texts[+e.target.dataset.tin]; if (T.text.trim()) { pushUndo(); findFonts(T); } } });
$("#textList").addEventListener("click", e => {
  if (e.target.closest("[data-notext],[data-tmode],[data-pick]")) pushUndo();
  const nt = e.target.closest("[data-notext]"); if (nt) { const T = result.texts[+nt.dataset.notext]; T.removed = true; T.manual = false; remember(T); render(); toast("Marked as not text."); return; }
  const mb = e.target.closest("[data-tmode]"); if (mb) { const T = result.texts[+mb.dataset.t], m = mb.dataset.tmode; if (m === "font") { findFonts(T); return; } T.mode = m; T.repl = m === "clean" ? cleanText(T) : null; T.pick = null; remember(T); render(); return; }
  const pk = e.target.closest("[data-pick]"); if (pk) { const [tid, i] = pk.dataset.pick.split(":").map(Number), T = result.texts[tid], c = T.results[i]; T.pick = c; T.mode = "font"; T.repl = fontText(T, c); remember(T); render(); toast(`Set in ${c.fam} ${WEIGHT_NAME[c.w] || c.w}.`); return; }
});
$("#textList").addEventListener("toggle", e => { const d = e.target.closest && e.target.closest("[data-own]"); if (d) result.texts[+d.dataset.own].ownOpen = d.open; }, true);
$("#textList").addEventListener("click", e => {
  const f = e.target.closest("[data-ffind]"); if (f) { pushUndo(); const T = result.texts[+f.dataset.ffind], v = $(`#fn-${T.id}`).value.trim(); if (v) useNamedFont(T, v); else toast("Type a font name first."); return; }
  const u = e.target.closest("[data-fupload]"); if (u) { pushUndo(); fontFileFor = result.texts[+u.dataset.fupload]; $("#fontFile").click(); return; }
  const b = e.target.closest("[data-fbrowse]"); if (b) { browseLocalFonts(result.texts[+b.dataset.fbrowse]); return; }
});
$("#textList").addEventListener("keydown", e => { const i = e.target.closest("[data-fname]"); if (i && e.key === "Enter") { e.preventDefault(); pushUndo(); const v = i.value.trim(); if (v) useNamedFont(result.texts[+i.dataset.fname], v); } });
$("#textList").addEventListener("mouseover", e => { const c = e.target.closest(".text-card"); highlightText(c ? +c.dataset.tid : null); });
$("#textList").addEventListener("mouseleave", () => highlightText(null));
function highlightText(id) {
  const svg = $("#vec svg"); if (!svg) return; const old = svg.querySelector(".thl"); if (old) old.remove();
  const T = id == null ? null : result.texts[id]; if (!T) return;
  const r = document.createElementNS("http://www.w3.org/2000/svg", "rect"), p = 4;
  r.setAttribute("class", "thl"); r.setAttribute("x", T.box[0] - p); r.setAttribute("y", T.box[1] - p); r.setAttribute("width", T.box[2] - T.box[0] + 2 * p); r.setAttribute("height", T.box[3] - T.box[1] + 2 * p);
  r.setAttribute("rx", 6); r.setAttribute("fill", "none"); r.setAttribute("stroke", "#E0218A"); r.setAttribute("stroke-width", "2.5"); r.setAttribute("stroke-dasharray", "6 4"); r.setAttribute("vector-effect", "non-scaling-stroke"); r.setAttribute("pointer-events", "none");
  svg.appendChild(r);
}
/* ---------- The user's own fonts ---------- */
const fontLabel = c => c.src === "file" ? (c.label || c.fam) : `${c.label || c.fam} ${WEIGHT_NAME[c.w] || c.w}`;
const TRY_WEIGHTS = [300, 400, 500, 600, 700, 800, 900];
function isInstalled(name) {
  // A font is installed when text set in it measures differently from every fallback.
  const c = isInstalled.c || (isInstalled.c = document.createElement("canvas").getContext("2d")), probe = "mmmmmmmmlli WQ@#0123456789";
  for (const base of ["monospace", "serif", "sans-serif"]) {
    c.font = `72px ${base}`; const a = c.measureText(probe).width;
    c.font = `72px "${name}", ${base}`; if (Math.abs(c.measureText(probe).width - a) > 0.5) return true;
  }
  return false;
}
function distinctWeights(fam) {
  // Weights that actually render differently (a missing weight falls back to the nearest one).
  const c = document.createElement("canvas").getContext("2d"), seen = new Map(), out = [];
  for (const w of TRY_WEIGHTS) { c.font = `${w} 60px "${fam}"`; const k = c.measureText("Hamburgefonstiv").width.toFixed(2); if (!seen.has(k)) { seen.set(k, w); out.push(w); } }
  return out;
}
async function googleFont(name) {
  // Try the variable range first, then common static weights, then the regular style alone.
  const fam = encodeURIComponent(name).replace(/%20/g, "+");
  for (const q of [`${fam}:wght@100..900`, `${fam}:wght@400;700`, fam]) {
    const ok = await new Promise(r => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = `https://fonts.googleapis.com/css2?family=${q}&display=block`; l.onload = () => r(true); l.onerror = () => { l.remove(); r(false); }; document.head.appendChild(l); setTimeout(() => r(false), 6000); });
    if (!ok) continue;
    const ws = [];
    for (const w of TRY_WEIGHTS) { try { const f = await document.fonts.load(`${w} 40px "${name}"`); if (f && f.length) ws.push(w); } catch (e) {} }
    if (ws.length) return [...new Set(ws)];
  }
  return [];
}
async function scoreOwn(T, faces, label) {
  T.busy = `Fitting ${label}…`; T.mode = "font"; renderTexts();
  const { results } = await matchFonts(T, T.text.trim(), faces);
  T.busy = null;
  if (!results.length) { renderTexts(); toast(`${label} couldn't be drawn here.`); return; }
  const c = results[0];
  T.results = [c, ...(T.results || []).filter(r => r.fam !== c.fam)].slice(0, 6);
  T.pick = c; T.repl = fontText(T, c); remember(T); render();
  toast(`Set in ${fontLabel(c)}, ${Math.round(c.iou * 100)}% match.`);
}
async function useNamedFont(T, name) {
  name = name.replace(/["';{}<>\\]/g, "").trim(); if (!name) return; T.ownName = name;
  T.busy = `Looking for ${name}…`; T.mode = "font"; renderTexts();
  let faces;
  if (isInstalled(name)) faces = distinctWeights(name).map(w => [name, w, "installed", name]);
  else { const ws = await googleFont(name); faces = ws.map(w => [name, w, "google", name]); }
  if (!faces.length) { T.busy = null; renderTexts(); toast(`Couldn't find ${name} on this computer or in Google Fonts. Check the spelling, or upload the font file.`); return; }
  for (const f of faces) if (!customFaces.some(c => c[0] === f[0] && c[1] === f[1])) customFaces.push(f);
  await scoreOwn(T, faces, name);
}
let fontFileFor = null, fontFileN = 0;
async function useFontFile(file) {
  const T = fontFileFor; if (!T || !file) return;
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) { toast("Use a .ttf, .otf, .woff, or .woff2 font file."); return; }
  const label = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), fam = `VZ Upload ${++fontFileN}`;
  try {
    const face = new FontFace(fam, await file.arrayBuffer()); await face.load(); document.fonts.add(face);
    const f = [fam, 400, "file", label]; customFaces.push(f);
    await scoreOwn(T, [f], label);
  } catch (e) { console.error(e); toast("That font file couldn't be read. Try a different format."); }
}
$("#fontFile").onchange = e => { useFontFile(e.target.files[0]); e.target.value = ""; };
async function browseLocalFonts(T) {
  try {
    const fams = NATIVE ? (await NATIVE.font_families()) || [] : [...new Set((await window.queryLocalFonts()).map(f => f.family))].sort((a, b) => a.localeCompare(b));
    if (!fams.length) { toast("No installed fonts were shared with this page."); return; }
    $("#localFonts").innerHTML = fams.map(f => `<option value="${esc(f)}"></option>`).join("");
    T.ownOpen = true; renderTexts(); const i = $(`#fn-${T.id}`); if (i) { i.focus(); i.placeholder = `Search ${fams.length} installed fonts`; }
    toast(`${fams.length.toLocaleString()} installed fonts. Start typing a name to pick one.`);
  } catch (e) { toast("This view can't list installed fonts. Type the font name instead; installed fonts still work by name."); }
}

async function findFonts(T) {
  if (!T.text.trim()) { toast("Type what the word says first."); return; }
  const prev = T.mode === "font" ? "original" : T.mode;
  T.busy = "Comparing fonts…"; T.mode = "font"; renderTexts();
  try {
    const { faces, results } = await matchFonts(T, T.text.trim());
    T.busy = null;
    if (!faces || !results.length) { T.mode = prev; T.repl = prev === "clean" ? cleanText(T) : null; render(); toast("Fonts couldn't load in this view, so font matching isn't available."); return; }
    T.results = results; const c = results[0]; T.pick = c; T.repl = fontText(T, c); remember(T); render();
    toast(`Closest font: ${c.fam} ${WEIGHT_NAME[c.w] || c.w}, ${Math.round(c.iou * 100)}% match. Pick another below.`);
  } catch (e) { console.error(e); T.busy = null; T.mode = "original"; T.repl = null; render(); toast("Font matching failed. The word is back to its traced letters."); }
}
function markAsText(li, ii) {
  // Mark the selected outline and the letters on its line as a word.
  const L = result.layers[li], b0 = bboxOf(L.items[ii].outer.q), h = b0[3] - b0[1];
  const box = [b0[0] - 6 * h, b0[1] - 0.2 * h, b0[2] + 6 * h, b0[3] + 0.2 * h];
  const items = []; L.items.forEach((it, j) => { const b = bboxOf(it.outer.q), cy = (b[1] + b[3]) / 2; if (cy > box[1] && cy < box[3] && b[0] > box[0] && b[2] < box[2] && (b[3] - b[1]) < 2.6 * h) items.push(j); });
  let bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const j of items) { const q = bboxOf(L.items[j].outer.q); bb = [Math.min(bb[0], q[0]), Math.min(bb[1], q[1]), Math.max(bb[2], q[2]), Math.max(bb[3], q[3])]; }
  let T = result.texts.find(t => t.li === li && t.items.includes(ii));
  if (T) { T.removed = false; } else { T = { li, items, box: bb, id: result.texts.length, text: "", mode: "original", repl: null, manual: true }; result.texts.push(T); }
  remember(T);
  setSelection([]); textSel = T.id; openTab("text"); render();
  setTimeout(() => { const i = $(`#tx-${T.id}`); if (i) i.focus(); }, 50);
}

/* ---------- Shapes panel ---------- */
const GLYPH = {
  circle: '<circle cx="12" cy="12" r="8"/>', ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6"/>', rect: '<rect x="4" y="6" width="16" height="12"/>',
  rounded_rect: '<rect x="4" y="6" width="16" height="12" rx="4"/>', pill: '<rect x="3" y="8" width="18" height="8" rx="4"/>',
  polygon: '<path d="M12 3l9 7-3.5 10h-11L3 10z"/>', star: '<path d="M12 2.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 8.8l6.1-.7z"/>',
  heart: '<path d="M12 20.5 4.6 13.4A4.6 4.6 0 0 1 12 7.2a4.6 4.6 0 0 1 7.4 6.2z"/>', arrow: '<path d="M3 10h10V6l8 6-8 6v-4H3z"/>',
  arc: '<path d="M4 16a8 8 0 0 1 16 0h-4a4 4 0 0 0-8 0z"/>', text: '<path d="M5 5h14v3.5h-2.2V7.4h-3.6v10.4h1.9V20H8.9v-2.2h1.9V7.4H7.2v1.1H5z"/>', ring: '<path fill-rule="evenodd" d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>',
};
const glyphFor = s => GLYPH[s.label === "Pill" ? "pill" : s.kind] || GLYPH.polygon;
function renderShapes() {
  const list = result.shapes;
  $("#shapeList").innerHTML = list.length ? list.map((s, i) => {
    const on = useShape[s.id];
    return `<div class="shape-row" data-sid="${s.id}"><span class="glyph"><svg viewBox="0 0 24 24" aria-hidden="true">${glyphFor(s)}</svg></span>
      <span class="shape-txt"><b>${esc(s.label)}</b><small>${s.manual ? "Snapped by you · " : ""}${s.match.toFixed(1)}% match</small></span>
      <button type="button" class="tog" data-toggle="${s.id}" aria-pressed="${on}">${on ? "Shape" : "Traced"}</button></div>`;
  }).join("") : `<p class="help">${S.shapes === "off" ? "Shape matching is off. Turn it on in Setup, or click any outline in the vector to snap it to a shape." : "No outlines matched a shape on their own. Click any outline in the vector to snap it to a shape."}</p>`;
}
$("#shapeList").addEventListener("click", e => {
  const b = e.target.closest("[data-toggle]");
  if (b) { pushUndo(); useShape[b.dataset.toggle] = !useShape[b.dataset.toggle]; render(); return; }
  const r = e.target.closest(".shape-row"); if (!r) return;
  result.layers.forEach((L, li) => L.items.forEach((it, ii) => { if (it.outer.shape && it.outer.shape.id === r.dataset.sid) setSelection([{ li, ii }]); }));
  if (view === "original") setView("vector"); drawSelection();
});
$("#shapeList").addEventListener("mouseover", e => { const r = e.target.closest(".shape-row"); highlightShape(r ? r.dataset.sid : null); });
$("#shapeList").addEventListener("mouseleave", () => highlightShape(null));
function highlightShape(id) {
  const old = $("#vec svg .hl"); if (old) old.remove(); if (!id || !result) return;
  const s = result.shapes.find(q => q.id === id); if (!s) return;
  const svg = $("#vec svg"); if (!svg) return;
  const g = document.createElementNS("http://www.w3.org/2000/svg", "path");
  g.setAttribute("class", "hl"); g.setAttribute("d", VZ.shapeD(s)); g.setAttribute("fill", "none"); g.setAttribute("stroke", "#E0218A"); g.setAttribute("stroke-width", "3"); g.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(g);
}
$("#useAll").onclick = () => { pushUndo(); result.shapes.forEach(s => useShape[s.id] = true); render(); };
$("#traceAll").onclick = () => { pushUndo(); result.shapes.forEach(s => useShape[s.id] = false); render(); };

/* ---------- Colors panel ---------- */
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c5 0 8.6 4.2 9.7 6.2a1.6 1.6 0 0 1 0 1.6C20.6 14.8 17 19 12 19s-8.6-4.2-9.7-6.2a1.6 1.6 0 0 1 0-1.6C3.4 9.2 7 5 12 5zm0 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.3 3.3a1 1 0 0 1 1.4 0l16 16a1 1 0 0 1-1.4 1.4l-2.6-2.6A10 10 0 0 1 12 19c-5 0-8.6-4.2-9.7-6.2a1.6 1.6 0 0 1 0-1.6 15 15 0 0 1 3.4-4L3.3 4.7a1 1 0 0 1 0-1.4zM12 5c5 0 8.6 4.2 9.7 6.2.3.5.3 1.1 0 1.6a15 15 0 0 1-2.4 3.1L8.2 5.6C9.4 5.2 10.7 5 12 5z"/></svg>';
const DROPPER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 3.4a2.6 2.6 0 0 1 3.7 3.7l-2 2 .9.9a1.2 1.2 0 0 1-1.7 1.7l-.6-.6-7.6 7.6a2 2 0 0 1-1 .5l-2.6.6a1 1 0 0 1-1.2-1.2l.6-2.6a2 2 0 0 1 .5-1l7.6-7.6-.6-.6a1.2 1.2 0 0 1 1.7-1.7l.9.9z"/></svg>';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const normHex = v => { v = String(v).trim().replace(/^#/, ""); if (/^[0-9a-f]{3}$/i.test(v)) v = v.split("").map(c => c + c).join(""); return /^[0-9a-f]{6}$/i.test(v) ? "#" + v.toUpperCase() : null; };
function setRecolor(orig, hex) { pushUndo("color:" + orig); if (!hex || hex === orig) delete recolor[orig]; else recolor[orig] = hex; render(); }

$("#palette").addEventListener("input", e => {
  if (e.target.type === "color") {
    const hex = e.target.value.toUpperCase(), o = e.target.dataset.c;
    pushUndo("color:" + o); e.target.parentElement.style.background = hex; recolor[o] = hex;
    $("#vec").innerHTML = buildSVG(true, { part: partMode }); drawSelection();
  }
});
$("#palette").addEventListener("change", e => {
  if (e.target.type === "color") setRecolor(e.target.dataset.c, e.target.value.toUpperCase());
  if (e.target.classList.contains("pal-hex")) { const h = normHex(e.target.value); if (h) setRecolor(e.target.dataset.c, h); else { toast("Use six hex digits, like #1E2340."); render(); } }
});
$("#palette").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("pal-hex")) e.target.blur(); });
$("#palette").addEventListener("click", e => {
  const r = e.target.closest("[data-reset]"); if (r) { setRecolor(r.dataset.reset, null); return; }
  const eye = e.target.closest("[data-eye]"); if (eye) { pushUndo(); const c = eye.dataset.eye; hidden.has(c) ? hidden.delete(c) : hidden.add(c); render(); return; }
  const pk = e.target.closest("[data-pickfor]"); if (pk) startPick(hex => { setRecolor(pk.dataset.pickfor, hex); toast(`Recolored to ${hex}.`); });
});
$("#palette").addEventListener("mouseover", e => { const r = e.target.closest(".pal-row"); isolate(r ? r.dataset.c : null); });
$("#palette").addEventListener("mouseleave", () => isolate(null));
function isolate(orig) {
  if (!result) return;
  $("#vec").querySelectorAll("g[data-l]").forEach(g => { g.style.opacity = !orig || result.layers[+g.dataset.l].hex === orig ? "" : "0.12"; });
}
$("#resetColors").onclick = () => { pushUndo(); recolor = {}; hidden = new Set(); render(); toast("Colors reset."); };
$("#lockList").addEventListener("click", e => { const b = e.target.closest("[data-unlock]"); if (!b) return; pushUndo(); locked.splice(locked.indexOf(b.dataset.unlock), 1); convert(); });
function addBrandHex() {
  let v = $("#brandHex").value.trim().toUpperCase(); if (/^[0-9A-F]{6}$/.test(v)) v = "#" + v;
  if (!/^#[0-9A-F]{6}$/.test(v)) { toast("Type a color code like #1E2340."); return; }
  if (!locked.includes(v)) { pushUndo(); locked.push(v); convert(); }
  $("#brandHex").value = ""; toast(`Locked ${v}.`);
}
$("#addBrandHex").onclick = addBrandHex;
$("#brandHex").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addBrandHex(); } });
$("#pickLock").onclick = () => startPick(hex => { pushUndo(); if (!locked.includes(hex)) locked.push(hex); toast(`Locked ${hex}.`); convert(); });

/* ---------- Dropper ---------- */
let pickCb = null, prevView = null;
function startPick(cb) {
  if (!job) return;
  pickCb = cb; picking = true; prevView = view; setView("original");
  $("#stage").classList.add("picking"); $("#pickHint").hidden = false;
}
function endPick() { picking = false; pickCb = null; $("#stage").classList.remove("picking"); $("#pickHint").hidden = true; $("#loupe").hidden = true; if (prevView) setView(prevView); prevView = null; }
$("#pickCancel").onclick = endPick;
function sampleAt(ev) {
  const r = $("#sheet").getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) / r.width * job.workW), y = Math.floor((ev.clientY - r.top) / r.height * job.workH);
  if (x < 0 || y < 0 || x >= job.workW || y >= job.workH) return null;
  const d = job.imgd.data; let R = [], G = [], B = [];   // median of 3×3 so JPEG noise doesn't skew the pick
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = Math.min(job.workW - 1, Math.max(0, x + dx)), yy = Math.min(job.workH - 1, Math.max(0, y + dy)), i = (yy * job.workW + xx) * 4;
    R.push(d[i]); G.push(d[i + 1]); B.push(d[i + 2]);
  }
  const med = a => a.sort((p, q) => p - q)[4];
  return toHex(med(R), med(G), med(B));
}
$("#sheet").addEventListener("pointermove", ev => {
  if (!picking) return; const hex = sampleAt(ev); const L = $("#loupe");
  if (!hex) { L.hidden = true; return; }
  const sr = $("#stage").getBoundingClientRect();
  L.hidden = false; L.style.left = (ev.clientX - sr.left - 42) + "px"; L.style.top = (ev.clientY - sr.top - 110) + "px"; L.style.background = hex; $("#loupeHex").textContent = hex;
});
$("#sheet").addEventListener("click", ev => { if (!picking) return; const hex = sampleAt(ev); if (!hex) return; const cb = pickCb; endPick(); cb && cb(hex); });

/* ---------- View and compare ---------- */
function layoutSheet() {
  if (!job) return;
  const box = $(".art").getBoundingClientRect(); if (!box.width) return;
  fitScale = Math.min(box.width / job.origW, box.height / job.origH);
  applyZoom();
}
window.addEventListener("resize", layoutSheet);
function setView(v) { view = v; document.querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === v))); applyView(); }
function applyView() {
  const vec = $("#vec"), img = $("#srcImg"), sp = $("#split");
  img.hidden = view === "vector"; vec.hidden = view === "original"; sp.hidden = view !== "compare";
  vec.style.clipPath = view === "compare" ? `inset(0 0 0 ${split}%)` : "";
  sp.style.left = split + "%"; sp.setAttribute("aria-valuenow", String(Math.round(split)));
  $("#tagL").hidden = view === "vector"; $("#tagR").hidden = view === "original";
  $("#tagL").textContent = "Original"; $("#tagR").textContent = "Vector";
}
document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => { if (picking) endPick(); setView(b.dataset.view); }));
(() => {
  const sp = $("#split"); let drag = false;
  const move = ev => { const r = $("#sheet").getBoundingClientRect(); split = Math.min(100, Math.max(0, (ev.clientX - r.left) / r.width * 100)); applyView(); };
  sp.addEventListener("pointerdown", ev => { drag = true; sp.setPointerCapture(ev.pointerId); move(ev); });
  sp.addEventListener("pointermove", ev => drag && move(ev));
  sp.addEventListener("pointerup", () => drag = false);
  sp.addEventListener("keydown", ev => { if (ev.key === "ArrowLeft") split = Math.max(0, split - 5); else if (ev.key === "ArrowRight") split = Math.min(100, split + 5); else return; ev.preventDefault(); applyView(); });
})();

/* ---------- Inspector controls ---------- */
function openTab(t) {
  document.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-selected", String(x.dataset.tab === t)));
  const was = document.querySelector('[id^="pane-"]:not([hidden])');
  for (const k of ["setup", "shapes", "text", "layers"]) $("#pane-" + k).hidden = k !== t;
  if (was !== $("#pane-" + t)) $(".inspector").scrollTop = 0;   // a new tab opens at its top
}
document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
  openTab(b.dataset.tab);
}));
function syncControls() {
  if (PRESET_ALIAS[S.preset]) S.preset = PRESET_ALIAS[S.preset];
  document.querySelectorAll("[data-preset]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.preset === S.preset)));
  $("#presetHelp").textContent = PRESET_HELP[S.preset] || "";
  if (S.preset === "photo") showMorePresets(true);
  document.querySelectorAll("[data-cmode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.cmode === S.cmode)));
  document.querySelectorAll("[data-bg]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.bg === S.bg)));
  $("#stepper").hidden = S.cmode !== "number"; $("#kVal").textContent = S.k; $("#kUnit").textContent = S.gray ? "shades of gray" : "colors";
  syncDials();
  $("#snap").checked = S.snap;
  document.querySelectorAll("[data-smode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.smode === S.shapes)));
  document.querySelectorAll("[data-xmode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.xmode === S.textMode)));
  $("#bgHelp").textContent = S.bg === "remove" ? "Vectorize finds the color around the edges and leaves it out." : S.bg === "ai" ? "Apple's on-device AI finds the subject and removes everything else. Your image never leaves this Mac." : "The background color stays in the file as its own shape.";
  syncEditorControls();
}
document.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", () => { pushUndo(); Object.assign(S, PRESETS[b.dataset.preset], { preset: b.dataset.preset }); syncControls(); convert(); }));
document.querySelectorAll("[data-cmode]").forEach(b => b.addEventListener("click", () => { pushUndo(); S.cmode = b.dataset.cmode; if (S.cmode !== "number") S.gray = false; syncControls(); convert(); }));
function showMorePresets(open) { $("#morePresets").hidden = !open; $("#morePresetsBtn").setAttribute("aria-expanded", String(open)); $("#morePresetsBtn").textContent = open ? "Fewer presets" : "More presets"; }
$("#morePresetsBtn").onclick = () => showMorePresets($("#morePresets").hidden);
document.querySelectorAll("[data-bg]").forEach(b => b.addEventListener("click", () => { if (S.bg === b.dataset.bg) return; pushUndo(); S.bg = b.dataset.bg; syncControls(); convert(); }));
$("#kMinus").onclick = () => { pushUndo("k"); S.k = Math.max(2, S.k - 1); syncControls(); convert(150); };
$("#kPlus").onclick = () => { pushUndo("k"); S.k = Math.min(32, S.k + 1); syncControls(); convert(150); };
for (const id of ["detail", "straight", "smooth", "corners"]) $("#" + id).addEventListener("input", e => { pushUndo(id); setDial(id, +e.target.value); convert(300); });
const stepGrow = d => { pushUndo("grow"); const g = dialValues().grow || 0; setDial("grow", Math.max(-3, Math.min(3, Math.round((g + d) * 4) / 4))); convert(250); };
$("#growMinus").onclick = () => stepGrow(-0.25);
$("#growPlus").onclick = () => stepGrow(0.25);
$("#tuneReset").onclick = () => {
  if (tuneScope) { resetScopeTune(); return; }
  pushUndo(); const P = PRESETS[PRESET_ALIAS[S.preset] || S.preset] || PRESETS.logo;
  for (const k of ["detail", "straight", "smooth", "corners", "grow", "snap"]) S[k] = P[k];
  syncControls(); convert(); toast("Fine-tune settings reset.");
};
$("#snap").onchange = e => { pushUndo(); S.snap = e.target.checked; convert(); };
document.querySelectorAll("[data-smode]").forEach(b => b.addEventListener("click", () => { pushUndo(); S.shapes = b.dataset.smode; syncControls(); convert(); }));
document.querySelectorAll("[data-xmode]").forEach(b => b.addEventListener("click", () => { pushUndo(); S.textMode = b.dataset.xmode; syncControls(); setupText(); render(); }));

/* ---------- Send to Versa ---------- */
// A small zip writer (stored, no compression): enough for a few SVG and JSON files.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: "application/zip" });
}
function brandName() {
  const words = (result.texts || []).filter(T => !T.removed && T.text.trim()).sort((a, b) => (b.box[3] - b.box[1]) - (a.box[3] - a.box[1]));
  if (words.length) return words[0].text.trim();
  return job.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/[^\w &'.]+/g, "").trim() || "Logo";
}
function versaPackage() {
  const name = brandName(), master = buildSVG(false, { crop: true, noDest: true }), icon = buildSVG(false, { part: "art", crop: true, noDest: true }), word = buildSVG(false, { part: "text", crop: true, noDest: true });
  const hasWords = (result.texts || []).some(T => !T.removed), files = [{ name: "master.svg", data: master }];
  if (hasWords && icon) files.push({ name: "icon.svg", data: icon });
  if (hasWords && word) files.push({ name: "wordmark.svg", data: word });
  // Colors, largest area first; the brand color is the largest one that isn't near white, black, or gray.
  const area = L => L.items.reduce((a, it) => { const b = bboxOf(it.outer.q); return a + (b[2] - b[0]) * (b[3] - b[1]); }, 0);
  const layers = visibleLayers().map(L => ({ L, hex: recolor[L.hex] || L.hex, a: area(L) })).sort((a, b) => b.a - a.a);
  const chroma = hex => { const [L, a, b] = rgb2lab(...fromHex(hex)); return { L, C: Math.hypot(a, b) }; };
  const brand = layers.find(x => { const c = chroma(x.hex); return c.C > 15 && c.L > 15 && c.L < 92; }) || layers[0];
  const colors = layers.map(x => { const [r, g, b] = fromHex(x.hex); return { hex: x.hex, rgb: [r, g, b], name: colorName(x.hex), locked: locked.includes(x.hex) }; });
  const text = (result.texts || []).filter(T => !T.removed).map(T => ({ text: T.text.trim() || null, letters: T.items.length, color: recolor[result.layers[T.li].hex] || result.layers[T.li].hex,
    font: T.mode === "font" && T.pick ? { family: T.pick.label || T.pick.fam, weight: T.pick.w, style: T.pick.src === "file" ? null : WEIGHT_NAME[T.pick.w] || String(T.pick.w), source: T.pick.src === "installed" ? "installed" : T.pick.src === "file" ? "file" : "google-fonts", match: Math.round(T.pick.iou * 100) / 100 } : null,
    letters_style: T.mode }));
  const manifest = {
    format: "versa-handoff", version: 1, from: { app: NATIVE ? "Vectorize" : "Vectorize Web", source: job.name, created: new Date().toISOString() },
    name, files: { master: "master.svg", icon: files.some(f => f.name === "icon.svg") ? "icon.svg" : null, wordmark: files.some(f => f.name === "wordmark.svg") ? "wordmark.svg" : null },
    colors, brandColor: brand ? brand.hex : null, text,
    notes: ["All text is converted to outlines.", "Colors are listed largest area first."],
  };
  files.push({ name: "versa.json", data: JSON.stringify(manifest, null, 2) + "\n" });
  files.push({ name: "README.txt", data:
`${name}, ready for Versa

Open this folder or zip in Versa to make the full logo kit.

master.svg     The whole logo, cropped to the artwork.
${manifest.files.icon ? "icon.svg       The logo without its words (Versa's icon-only slot).\n" : ""}${manifest.files.wordmark ? "wordmark.svg   The words only (Versa's wordmark slot).\n" : ""}versa.json     Colors, the brand color, and the fonts matched to each word.

Colors: ${colors.map(c => `${c.name} ${c.hex}`).join(", ")}
${text.some(t => t.font) ? "Fonts: " + text.filter(t => t.font).map(t => `${t.text}: ${t.font.family}${t.font.style ? " " + t.font.style : ""}`).join("; ") + "\n" : ""}
Made with Vectorize.
` });
  return { name, files };
}
/* ---------- Status, toast, press spring ---------- */
function setStatus(s, t) { const el = $("#status"); el.dataset.s = s; el.textContent = t; }
let toastT = 0;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }
document.addEventListener("pointerdown", e => { const b = e.target.closest("[data-press]"); if (!b || b.disabled) return; b.classList.remove("vb-release"); b.classList.add("is-pressed"); });
document.addEventListener("pointerup", () => document.querySelectorAll(".is-pressed").forEach(b => { b.classList.remove("is-pressed"); void b.offsetWidth; b.classList.add("vb-release"); }));

/* ---------- Sample: a small, slightly blurry JPEG logo, drawn here so the page opens working ---------- */
async function makeSample() {
  try { await document.fonts.load('800 64px Nunito'); } catch {}
  const S0 = 360, c = document.createElement("canvas"); c.width = c.height = S0 * 2; const x = c.getContext("2d"); x.scale(2, 2);
  x.fillStyle = "#FBF6EA"; x.fillRect(0, 0, S0, S0);
  x.fillStyle = "#1E2340"; x.beginPath(); x.arc(180, 150, 104, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#FFC24B"; x.beginPath(); x.arc(180, 150, 86, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#FF8A6B"; x.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 26 : 58; x.lineTo(180 + r * Math.cos(a), 150 + r * Math.sin(a)); }
  x.closePath(); x.fill();
  x.fillStyle = "#1E2340"; x.font = '800 44px Nunito, "Avenir Next", sans-serif'; x.textAlign = "center"; x.fillText("SUNNY CO", 180, 310);
  x.fillStyle = "#2E7D5B"; x.fillRect(110, 326, 140, 10);
  // Downsample to 360 px and save as a medium-quality JPEG, like a logo pulled off a website.
  const o = document.createElement("canvas"); o.width = o.height = S0; const ox = o.getContext("2d"); ox.imageSmoothingQuality = "high"; ox.drawImage(c, 0, 0, S0, S0);
  return o.toDataURL("image/jpeg", 0.6);
}
