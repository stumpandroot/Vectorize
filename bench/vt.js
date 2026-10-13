// Runs VTracer 1.0 on one image with one configuration.
// Usage: node vt.js in.png out.svg '{"preset":"poster"}' [upscaleTo]
// Prints the trace time in milliseconds. With upscaleTo, the image is first
// enlarged (bicubic) so its long side is that many pixels, like Vectorize does.
const fs = require("fs");
const path = require("path");
const NM = process.env.VT_NODE_MODULES || "/tmp/claude-0/vtnode/node_modules";
const vtracer = require(path.join(NM, "@visioncortex/vtracer"));
const sharp = require(path.join(NM, "sharp"));
(async () => {
  const [inp, out, optsJson, up] = process.argv.slice(2);
  const opts = JSON.parse(optsJson || "{}");
  let img = sharp(inp).ensureAlpha();
  const meta = await sharp(inp).metadata();
  let w = meta.width, h = meta.height;
  if (up) {
    const k = Number(up) / Math.max(w, h);
    if (k > 1) { w = Math.round(w * k); h = Math.round(h * k); img = img.resize(w, h, { kernel: "cubic" }); }
  }
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const t0 = Date.now();
  let svg = vtracer.convertPixels(new Uint8Array(data), info.width, info.height, opts);
  const ms = Date.now() - t0;
  // Size the drawing like the original image so every renderer compares the same box.
  svg = svg.replace(/<svg([^>]*?)\swidth="[^"]*"\s+height="[^"]*"/, `<svg$1 width="${meta.width}" height="${meta.height}" viewBox="0 0 ${info.width} ${info.height}"`);
  fs.writeFileSync(out, svg);
  console.log(ms);
})().catch(e => { console.error(e.message || e); process.exit(1); });
