# Tracing benchmark

Compares the Vectorize engine with VTracer 1.0 on a folder of real images and writes a side-by-side report.

1. Install the tools once:

   ```
   pip install cairosvg numpy pillow playwright
   python3 -m playwright install chromium
   mkdir -p /tmp/vtnode && cd /tmp/vtnode && npm install @visioncortex/vtracer@1.0.0-alpha.4 sharp
   ```

2. Build the interface: `python3 ui-src/build.py`
3. Run: `VT_NODE_MODULES=/tmp/vtnode/node_modules python3 bench/run.py path/to/images path/to/output`
4. Open `output/report.html`.

Keep benchmark images out of this repository. They're usually client artwork, and the repository is public.

Edge error rewards copying a blurry source pixel for pixel, so read it next to the close-ups, not on its own.
