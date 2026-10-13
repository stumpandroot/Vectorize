"""Builds the Vectorize interface from these sources.

Outputs:
  ../ui/index.html              the Mac app's window (bundled into the app)
  <web dir>/vectorize-web.html  the web preview artifact (only with --web DIR)
  <web dir>/test.html, testfonts.html  test pages for the headless checks

Run:  python3 ui-src/build.py [--web DIR]
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def svg_inline(path):
    s = (HERE / "assets" / path).read_text()
    s = re.sub(r' width="[^"]*" height="[^"]*"', "", s, count=1)
    return s.replace("<svg ", '<svg aria-hidden="true" ', 1)


def build():
    t = (HERE / "template.html").read_text()
    js = (HERE / "app.js").read_text() + "\n" + (HERE / "editor.js").read_text()
    fit = (HERE / "fit.js").read_text()
    for name, src in (("app.js + editor.js", js), ("fit.js", fit)):
        assert "</script" not in src, f"{name} contains </script"
    for key in ("%%FIT%%", "%%MARK%%", "%%PIX%%", "%%JS%%"):
        assert t.count(key) == 1, key
    # Replace the JS last so nothing inside it is mistaken for a placeholder.
    return (t.replace("%%MARK%%", svg_inline("vectorize-mark.svg"))
             .replace("%%PIX%%", svg_inline("pix_working.svg"))
             .replace("%%FIT%%", fit)
             .replace("%%JS%%", js))


def page(body, head=""):
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            + head + "</head><body>" + body + "</body></html>\n")


def main():
    out = build()
    ui = ROOT / "ui"
    ui.mkdir(exist_ok=True)
    (ui / "index.html").write_text(page(out))
    print("wrote", ui / "index.html")
    if "--web" in sys.argv:
        W = Path(sys.argv[sys.argv.index("--web") + 1])
        W.mkdir(parents=True, exist_ok=True)
        (W / "vectorize-web.html").write_text(out)
        (W / "test.html").write_text(page(out))
        # Test build: local fonts stand in for Google Fonts (the sandbox blocks fonts.googleapis.com).
        N = "/tmp/claude-0/fontdl/nun/package/files/"
        ff = "".join(f"@font-face{{font-family:'Nunito';src:url('file://{N}nunito-latin-{w}-normal.woff2');font-weight:{w}}}" for w in (400, 700, 800, 900))
        for fam, f, w in (("DejaVu Sans", "dejavu/DejaVuSans.ttf", 400), ("DejaVu Sans", "dejavu/DejaVuSans-Bold.ttf", 700),
                          ("DejaVu Serif", "dejavu/DejaVuSerif.ttf", 400), ("Liberation Serif", "liberation/LiberationSerif-Regular.ttf", 400),
                          ("FreeSans", "freefont/FreeSansBold.ttf", 700), ("DejaVu Sans Condensed", "dejavu/DejaVuSansCondensed-Bold.ttf", 700)):
            ff += f"@font-face{{font-family:'{fam}';src:url('file:///usr/share/fonts/truetype/{f}');font-weight:{w}}}"
        for w, f in ((700, "Inter-Bold.otf"), (900, "Inter-Black.otf")):
            ff += f"@font-face{{font-family:'Inter';src:url('file:///usr/share/fonts/opentype/inter/{f}');font-weight:{w}}}"
        inject = "<style>" + ff + "</style><script>window.__VZ_LOCAL_FONTS=true;</script>"
        local = ("let FONTS = window.__VZ_LOCAL_FONTS ? [['Nunito',[400,700,800,900]],['DejaVu Sans',[400,700]],['DejaVu Serif',[400]],"
                 "['DejaVu Sans Condensed',[700]],['Liberation Serif',[400]],['Inter',[700,900]],['FreeSans',[700]]] : [")
        assert out.count("let FONTS = [") == 1
        (W / "testfonts.html").write_text(page(out.replace("let FONTS = [", local, 1), inject))
        print("wrote web pages to", W)


if __name__ == "__main__":
    main()
