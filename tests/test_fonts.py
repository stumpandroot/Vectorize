"""Font files for the lettering engine: pack, cache, download, and the bridge call (app/fonts.py)."""
import base64
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

from app import fonts
from app.vector_export import svg_to_pdf

TTF = b"\x00\x01\x00\x00" + b"\x00" * 60


class FontFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.pack, self.cache = self.tmp / "pack", self.tmp / "cache"
        self.pack.mkdir(); self.cache.mkdir()
        self.p = [mock.patch.object(fonts, "pack_dir", lambda: self.pack), mock.patch.object(fonts, "cache_dir", lambda: self.cache)]
        for x in self.p: x.start()

    def tearDown(self):
        for x in self.p: x.stop()

    def test_names(self):
        self.assertEqual(fonts._name("Playfair Display SC", 700, 0), "playfair-display-sc-700.ttf")
        self.assertEqual(fonts._name("Roboto Condensed", 400, 75), "roboto-condensed-400-w75.ttf")

    def test_pack_first_no_download(self):
        (self.pack / "roboto-700.ttf").write_bytes(TTF)
        with mock.patch.object(fonts, "_download", side_effect=AssertionError("downloaded")):
            self.assertEqual(fonts.font_bytes("Roboto", 700), TTF)

    def test_download_is_cached(self):
        with mock.patch.object(fonts, "_download", return_value=TTF) as dl:
            self.assertEqual(fonts.font_bytes("Lora", 400), TTF)
            self.assertEqual(fonts.font_bytes("Lora", 400), TTF)
            self.assertEqual(dl.call_count, 1)
        self.assertTrue((self.cache / "lora-400.ttf").exists())

    def test_missing_is_remembered(self):
        with mock.patch.object(fonts, "_download", return_value=None) as dl:
            self.assertIsNone(fonts.font_bytes("No Such Font", 400))
            self.assertIsNone(fonts.font_bytes("No Such Font", 400))
            self.assertEqual(dl.call_count, 1)

    def test_bridge_font_file(self):
        from app.bridge import Bridge, Settings
        (self.pack / "oswald-600.ttf").write_bytes(TTF)
        b = Bridge(None, None, Settings(self.tmp / "s.json"))
        r = b.font_file("Oswald", 600, 0)
        self.assertEqual(base64.b64decode(r["b64"]), TTF)
        with mock.patch.object(fonts, "_download", return_value=None):
            self.assertTrue(b.font_file("Nope", 400, 0).get("missing"))


class FillRule(unittest.TestCase):
    def test_nonzero_keeps_overlapping_glyph_parts(self):
        # Two overlapping squares in one path: nonzero fills the overlap, evenodd leaves a hole.
        d = "M10 10h50v50h-50z M30 30h50v50h-50z"
        for rule in ("nonzero", "evenodd"):
            svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><path fill="#000" fill-rule="{rule}" d="{d}"/></svg>'
            pdf = svg_to_pdf(svg, "t")
            self.assertTrue(pdf.startswith(b"%PDF-"))
            # The PDF fill operator says which rule was used: f* is even-odd, f is nonzero.
            stream = pdf[pdf.index(b"stream\n") + 7:pdf.index(b"\nendstream")]
            ops = zlib.decompress(stream).decode("ascii").split()
            self.assertEqual("f*" in ops, rule == "evenodd", rule)
            self.assertEqual("f" in ops, rule == "nonzero", rule)


if __name__ == "__main__":
    unittest.main()
