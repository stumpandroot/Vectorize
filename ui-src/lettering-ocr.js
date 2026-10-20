/* ---------- Web reader: Tesseract (tesseract.js, Apache-2.0) for pages without the Mac app's Vision reader ---------- */
// Files live in ocr/ next to the page: tesseract.min.js, worker.min.js, the two LSTM cores, and eng.traineddata.gz.
// Everything runs on this device; nothing is uploaded. The worker starts on first use and stays for later images.

const OCR = { state: "idle", worker: null, starting: null };
function ocrBase() { return new URL("ocr/", location.href).href; }
// True when the reader can run here: the page is served over http(s) (workers can't start from file://) and
// the browser has WebAssembly. Loading the script itself waits for the first read.
function webOCRReady() {
  return OCR.state !== "failed" && /^https?:$/.test(location.protocol) && typeof WebAssembly === "object" && typeof Worker === "function";
}
function loadScript(src) {
  return new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => bad(new Error("couldn't load " + src)); document.head.appendChild(s); });
}
async function ocrWorker() {
  if (OCR.worker) return OCR.worker;
  if (OCR.starting) return OCR.starting;
  OCR.starting = (async () => {
    try {
      const base = ocrBase();
      if (typeof Tesseract === "undefined") await loadScript(base + "tesseract.min.js");
      // OEM 1 is the LSTM engine only, which matches the cores and language data shipped in ocr/.
      const w = await Tesseract.createWorker("eng", 1, { workerPath: base + "worker.min.js", corePath: base, langPath: base, gzip: true, workerBlobURL: false, cacheMethod: "none" });
      // Sparse text: logos scatter words anywhere, at any size, with no paragraphs.
      await w.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1" });
      OCR.worker = w; OCR.state = "ready";
      return w;
    } catch (e) {
      console.warn("web reader", e); OCR.state = "failed"; OCR.starting = null;
      return null;
    }
  })();
  return OCR.starting;
}
// The image the reader sees: the original on white, scaled so letters are a size Tesseract reads well.
async function ocrCanvas(j) {
  const im = await loadImage(j.srcURL), w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
  const k = Math.max(1, Math.min(3, 1600 / Math.max(w, h)));
  const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = "high"; g.drawImage(im, 0, 0, c.width, c.height);
  return c;
}
// Same shape as the Mac app's reader: [{ text, box: [x, y, w, h], words: [{ text, box, chars: [{ text, box }] }] }],
// boxes as fractions of the image. Words under 45% confidence, or with no letter or digit, are left out.
// opts.line: the image is one line of text (a straightened arc), read as such.
// One read at a time: reads change the worker's page-segmentation mode, so two at once could mix them up.
let ocrQueue = Promise.resolve();
function webReadText(j, opts = {}) {
  const run = ocrQueue.then(() => webReadTextNow(j, opts));
  ocrQueue = run.catch(() => {});
  return run;
}
async function webReadTextNow(j, opts = {}) {
  const w = await ocrWorker(); if (!w) return [];
  const c = await ocrCanvas(j);
  let out;
  if (opts.line) { await w.setParameters({ tessedit_pageseg_mode: "7" }); try { out = await ocrPass(w, c); } finally { await w.setParameters({ tessedit_pageseg_mode: "11" }); } return out; }
  out = await ocrPass(w, c);
  // Sparse mode passes over a lone letter or monogram; read the image as one word before giving up.
  if (!out.length) { await w.setParameters({ tessedit_pageseg_mode: "8" }); try { out = await ocrPass(w, c); } finally { await w.setParameters({ tessedit_pageseg_mode: "11" }); } }
  return out;
}
async function ocrPass(w, c) {
  const W = c.width, H = c.height;
  const { data } = await w.recognize(c, {}, { blocks: true, text: false });
  const fr = b => [b.x0 / W, b.y0 / H, (b.x1 - b.x0) / W, (b.y1 - b.y0) / H], out = [];
  for (const bl of data.blocks || []) for (const p of bl.paragraphs || []) for (const ln of p.lines || []) {
    const words = (ln.words || []).filter(x => x.confidence >= 45 && /[\p{L}\p{N}]/u.test(x.text)).map(x => ({
      text: x.text.trim(), box: fr(x.bbox), conf: x.confidence / 100,
      chars: (x.symbols || []).map(s => ({ text: s.text, box: fr(s.bbox) })),
    }));
    if (!words.length) continue;
    const xs = words.map(x => x.box), x0 = Math.min(...xs.map(b => b[0])), y0 = Math.min(...xs.map(b => b[1])), x1 = Math.max(...xs.map(b => b[0] + b[2])), y1 = Math.max(...xs.map(b => b[1] + b[3]));
    out.push({ text: words.map(x => x.text).join(" "), box: [x0, y0, x1 - x0, y1 - y0], words });
  }
  return out;
}
