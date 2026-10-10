"""Compare PDF and EPS output against Cairo's rendering of the same SVG."""
import io, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.vector_export import svg_to_pdf, svg_to_eps, parse_path

HERE = Path(__file__).parent

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

    def test_pdf_matches_svg(self):
        for name in ("fixture_shapes.svg", "fixture_sample.svg"):
            svg = (HERE / name).read_text()
            d = diff(raster_svg(svg, 600), raster_pdf(svg_to_pdf(svg), 600))
            self.assertLess(d, 0.01, f"{name}: {d:.4f} of pixels differ")

    @unittest.skipUnless(shutil.which("gs"), "Ghostscript not installed")
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

if __name__ == "__main__":
    unittest.main()
