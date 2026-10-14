"""Compare PDF and EPS output against Cairo's rendering of the same SVG."""
import io, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.vector_export import svg_to_pdf, svg_to_eps, parse_path

HERE = Path(__file__).parent


def _can_render():
    """The visual comparisons need Pillow, NumPy, CairoSVG, and Poppler's pdftoppm."""
    try:
        import cairosvg, numpy, PIL  # noqa: F401
    except (ImportError, OSError):
        return False
    return shutil.which("pdftoppm") is not None


CAN_RENDER = _can_render()

def raster_pdf(pdf: bytes, w: int):
    from PIL import Image
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "a.pdf"; p.write_bytes(pdf)
        subprocess.run(["pdftoppm", "-png", "-r", "72", "-scale-to-x", str(w), "-scale-to-y", "-1", "-singlefile", str(p), str(Path(d) / "o")], check=True)
        return Image.open(Path(d) / "o.png").convert("RGB").copy()

def raster_svg(svg: str, w: int):
    import cairosvg
    from PIL import Image
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=w, background_color="white")
    return Image.open(io.BytesIO(png)).convert("RGB")

def diff(a, b):
    import numpy as np
    b = b.resize(a.size)
    A, B = np.asarray(a, float), np.asarray(b, float)
    return float((np.abs(A - B).max(axis=2) > 60).mean())

class T(unittest.TestCase):
    def test_arc_endpoints(self):
        segs = parse_path("M10 0A10 10 0 1 0 -10 0A10 10 0 1 0 10 0Z")
        self.assertAlmostEqual(segs[-2][-2], 10, places=6)
        self.assertAlmostEqual(segs[-2][-1], 0, places=6)

    @unittest.skipUnless(CAN_RENDER, "Rendering tools not installed")
    def test_pdf_matches_svg(self):
        for name in ("fixture_shapes.svg", "fixture_sample.svg"):
            svg = (HERE / name).read_text()
            d = diff(raster_svg(svg, 600), raster_pdf(svg_to_pdf(svg), 600))
            self.assertLess(d, 0.01, f"{name}: {d:.4f} of pixels differ")

    @unittest.skipUnless(CAN_RENDER and shutil.which("gs"), "Ghostscript or rendering tools not installed")
    def test_eps_matches_svg(self):
        svg = (HERE / "fixture_shapes.svg").read_text()
        with tempfile.TemporaryDirectory() as d:
            e = Path(d) / "a.eps"; e.write_bytes(svg_to_eps(svg)); pdf = Path(d) / "a.pdf"
            subprocess.run(["gs", "-q", "-dNOPAUSE", "-dBATCH", "-dEPSCrop", "-sDEVICE=pdfwrite", f"-sOutputFile={pdf}", str(e)], check=True)
            self.assertLess(diff(raster_svg(svg, 600), raster_pdf(pdf.read_bytes(), 600)), 0.01)

    def test_eps_header(self):
        eps = svg_to_eps((HERE / "fixture_shapes.svg").read_text()).decode()
        self.assertTrue(eps.startswith("%!PS-Adobe-3.0 EPSF-3.0"))
        self.assertIn("%%BoundingBox: 0 0 ", eps)
        self.assertIn("eofill", eps)

    STICKER = ('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100" data-pt-per-unit="1.08">'
               '<g fill="#FFFFFF"><path d="M2 2h76v76h-76z"/></g><g fill="#1E2340"><path d="M10 10h60v60h-60z"/></g>'
               '<g id="CutContour" data-spot="CutContour" fill="none" stroke="#FF00FF" stroke-width="0.92593"><path d="M5 5h70v70h-70z"/></g></svg>')

    def test_page_size_and_spot_color_pdf(self):
        pdf = svg_to_pdf(self.STICKER)
        self.assertIn(b"/MediaBox [0 0 216 108]", pdf)                 # viewBox times points per unit
        self.assertIn(b"/Separation /CutContour /DeviceCMYK", pdf)
        self.assertIn(b"/C1 [0 1 0 0]", pdf)                          # magenta stands in for the spot color
        import zlib, re
        stream = zlib.decompress(re.search(rb"stream\n(.*?)\nendstream", pdf, re.S).group(1)).decode()
        self.assertIn("/CS0 CS 1 SCN", stream)
        self.assertIn("1 w 1 j", stream)                               # 0.92593 units x 1.08 = 1 pt
        self.assertTrue(stream.rstrip().endswith("S"))                 # stroked, not filled

    def test_spot_color_eps(self):
        eps = svg_to_eps(self.STICKER).decode()
        self.assertIn("%%BoundingBox: 0 0 216 108", eps)
        self.assertIn("[/Separation /CutContour /DeviceCMYK", eps)
        self.assertIn("%%DocumentCustomColors: (CutContour)", eps)
        self.assertIn("%%CMYKCustomColor: 0 1 0 0 (CutContour)", eps)
        self.assertIn("1 setlinewidth", eps)
        self.assertIn("stroke", eps)

    @unittest.skipUnless(shutil.which("gs"), "Ghostscript not installed")
    def test_separation_is_real(self):
        """Ghostscript's separation device writes one plate per spot color."""
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.pdf"; p.write_bytes(svg_to_pdf(self.STICKER))
            subprocess.run(["gs", "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=tiffsep", "-r36", f"-sOutputFile={Path(d) / 'sep.tif'}", str(p)], check=True)
            self.assertTrue((Path(d) / "sep(CutContour).tif").exists(), sorted(x.name for x in Path(d).iterdir()))

    def test_units_in_width(self):
        svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="1in" viewBox="0 0 20 10"><path d="M0 0h20v10h-20z"/></svg>'
        self.assertIn(b"/MediaBox [0 0 144 72]", svg_to_pdf(svg))


if __name__ == "__main__":
    unittest.main()
