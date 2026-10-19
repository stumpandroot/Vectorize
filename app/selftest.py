"""Checks that a built Vectorize.app has everything it needs.

Run the built app with --self-test. It prints one line per check and exits
with 1 if any check fails. The GitHub build runs this before and after signing.
"""
from __future__ import annotations

import os
import struct
import sys
import tempfile
import zlib
from pathlib import Path


def _png(w: int, h: int) -> bytes:
    """A pale image with a dark disc in the middle, as PNG bytes."""
    rows = []
    cx, cy, r = w / 2, h / 2, min(w, h) * 0.3
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            inside = (x - cx) ** 2 + (y - cy) ** 2 < r * r
            row += bytes((30, 35, 64) if inside else (246, 240, 220))
        rows.append(bytes(row))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b""))


def run() -> int:
    results = []

    def check(name, fn):
        try:
            info = fn()
            results.append(True)
            print(f"PASS {name}" + (f": {info}" if info else ""))
        except Exception as e:  # report and keep going
            results.append(False)
            print(f"FAIL {name}: {e}")

    from . import main as app_main
    from . import native
    from .bridge import Bridge, Settings, make_license_manager
    from .vector_export import svg_to_eps, svg_to_pdf

    def ui():
        html = (app_main.resource_dir() / "index.html").read_text()
        assert "VZ_MENU" in html and "pywebviewready" in html, "index.html is missing the editor"
        for marker in ('id="tuneGroup"', "AUTO_MARGIN", "LOAD_WEIGHTS", "letterCheck", "indexShortlist", "addArcWords", "applyTidy", "fontkit", 'id="destBox"', "PRESET_HELP", "CutContour", 'id="alignBar"', "bestShift", "data-card", 'class="app-icon"', "seg-pill", "ctxMenu", "pane-enter", "TOUR_VERSION", 'id="limitMotion"', "anchorCount", "dialMul"):
            assert marker in html, f"index.html is an old build: no {marker}"
        from .bridge import BUILD, VERSION
        if BUILD != "dev":
            assert f'UI_BUILD = "{BUILD}"' in html, f"the bundled interface isn't from build {BUILD}"
        return f"{len(html) // 1024} KB, version {VERSION} (build {BUILD})"
    check("interface is bundled", ui)

    def webview_ok():
        import webview  # noqa: F401
        from webview.menu import Menu  # noqa: F401
        import bottle  # noqa: F401  (pywebview's local server)
        return webview.__name__
    check("pywebview loads", webview_ok)

    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">'
           '<g fill="#1E2340"><circle cx="50" cy="50" r="30"/><path d="M10 10h20v20h-20z"/></g></svg>')
    def pdf():
        assert svg_to_pdf(svg, "test")[:5] == b"%PDF-", "not a PDF"
    check("PDF export", pdf)

    def eps():
        assert svg_to_eps(svg, "test")[:10] == b"%!PS-Adobe", "not an EPS file"
    check("EPS export", eps)

    def license_client():
        from . import greenlaunch_license as gl
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: F401
        return "licensing on" if make_license_manager() else "licensing off until the public key is added"
    check("license check loads", license_client)

    def fonts():
        fams = native.installed_font_families()
        assert len(fams) > 20, f"only {len(fams)} font families"
        assert any(f.startswith("Helvetica") for f in fams), "Helvetica not listed"
        return f"{len(fams)} families"
    check("installed fonts", fonts)

    def cutout():
        if not native.can_remove_background():
            return f"skipped: macOS {'.'.join(map(str, native.macos_version())) or '?'} is older than 14"
        import Quartz  # noqa: F401  (a missing framework is always a failure)
        import Vision  # noqa: F401
        try:
            png = native.remove_background(_png(320, 240))
        except RuntimeError as e:
            # Vision ran but found no photographic subject in the test drawing: the plumbing works.
            if "didn't find a main subject" in str(e):
                return "Vision ran (no subject in the test drawing)"
            # Build machines are virtual Macs that may lack the hardware Vision uses.
            if os.environ.get("CI"):
                return f"WARNING, Vision loaded but reported: {e}"
            raise
        assert png[:8] == b"\x89PNG\r\n\x1a\n", "result isn't a PNG"
        return f"{len(png) // 1024} KB PNG"
    check("AI cutout (Apple Vision)", cutout)

    def ocr():
        # Draw a word with AppKit, then read it back.
        from AppKit import (NSBitmapImageRep, NSColor, NSFont, NSFontAttributeName, NSForegroundColorAttributeName,
                            NSImage, NSPNGFileType, NSRectFill, NSString)
        img = NSImage.alloc().initWithSize_((640, 200))
        img.lockFocus()
        NSColor.whiteColor().set()
        NSRectFill(((0, 0), (640, 200)))
        NSString.stringWithString_("VECTORIZE").drawAtPoint_withAttributes_(
            (30, 50), {NSFontAttributeName: NSFont.boldSystemFontOfSize_(80), NSForegroundColorAttributeName: NSColor.blackColor()})
        img.unlockFocus()
        png = bytes(NSBitmapImageRep.imageRepWithData_(img.TIFFRepresentation()).representationUsingType_properties_(NSPNGFileType, {}))
        lines = native.recognize_text(png)
        read = " ".join(l["text"] for l in lines)
        assert "VECTORIZE" in read.upper().replace(" ", ""), f"read {read!r}"
        w = lines[0]["words"][0]["box"]
        assert 0 <= w[0] < 0.2 and 0.1 < w[1] < 0.6, f"word box {w}"
        # Expected words and letter boxes (1.9.0).
        lines2 = native.recognize_text(png, ["VECTORIZE"])
        chars = [c for l in lines2 for wd in l["words"] for c in wd.get("chars", [])]
        return f"read {read!r}, {len(chars)} letter boxes"
    check("text recognition (Apple Vision)", ocr)

    def font_index():
        d = app_main.resource_dir()
        import json
        meta = json.loads((d / "font-index.json").read_text())
        size = (d / "font-index.bin").stat().st_size
        faces = sum(len(f["i"]) for f in meta["families"])
        assert size == faces * meta["record"] * len(meta["chars"]), "font-index.bin doesn't match font-index.json"
        return f"{len(meta['families'])} families, {faces} faces"
    check("font index is bundled", font_index)

    def font_pack():
        from . import fonts
        pack = fonts.pack_dir()
        assert (pack / "NOTICE.txt").exists() and (pack / "licenses").is_dir(), f"no font pack licenses in {pack}"
        data = fonts.font_bytes("Roboto", 700)      # from the pack, no network
        assert data and data[:4] in fonts.MAGIC, "Roboto Bold isn't in the font pack"
        n = len(list(pack.glob("*.ttf")))
        inst = fonts.installed_font_file("Helvetica")
        assert inst and len(inst[0]) > 1000, "couldn't read the Helvetica font file"
        return f"{n} files in the pack; Helvetica read as {inst[1]}"
    check("font files for lettering", font_pack)

    def bridge():
        tmp = Path(tempfile.mkdtemp())
        class D:
            def open_files(self, *a): return []
            def save_file(self, name, directory=""): return str(tmp / name)
            def choose_folder(self, *a): return str(tmp)
        b = Bridge(D(), None, Settings(tmp / "settings.json"))
        info = b.app_info()
        r = b.save_file({"name": "t", "format": "pdf", "svg": svg})
        assert r and (tmp / "t.pdf").exists(), r
        return f"macOS {info['macos']}, cutout {'on' if info['cutout'] else 'off'}"
    check("bridge saves files", bridge)

    ok = all(results)
    print(f"{sum(results)}/{len(results)} checks passed")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(run())
