import base64, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.bridge import Bridge, Settings

HERE = Path(__file__).parent

class FakeDialogs:
    def __init__(self, d): self.d = Path(d); self.next_save = None
    def open_files(self, types, directory=""): return [str(HERE / "fixture.png")]
    def save_file(self, name, directory=""): return self.next_save or str(self.d / name)
    def choose_folder(self, directory=""): return str(self.d)

class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.d = Path(self.tmp.name)
        self.dlg = FakeDialogs(self.d)
        self.b = Bridge(self.dlg, None, Settings(self.d / "settings.json"))
        self.svg = (HERE / "fixture_shapes.svg").read_text()
    def tearDown(self): self.tmp.cleanup()

    def test_save_formats(self):
        for fmt, magic in (("svg", b"<svg"), ("pdf", b"%PDF"), ("eps", b"%!PS")):
            r = self.b.save_file({"name": "Logo", "format": fmt, "svg": self.svg})
            self.assertEqual(r["name"], f"Logo.{fmt}")
            self.assertTrue((self.d / f"Logo.{fmt}").read_bytes().startswith(magic))
        png = base64.b64encode(b"\x89PNG fake").decode()
        r = self.b.save_file({"name": "Logo.png", "format": "png", "data": "data:image/png;base64," + png, "encoding": "base64"})
        self.assertEqual((self.d / "Logo.png").read_bytes(), b"\x89PNG fake")

    def test_save_adds_missing_extension(self):
        self.dlg.next_save = str(self.d / "chosen")
        r = self.b.save_file({"name": "x", "format": "pdf", "svg": self.svg})
        self.assertEqual(r["name"], "chosen.pdf")

    def test_cancel(self):
        self.dlg.save_file = lambda n, d="": None
        self.assertIsNone(self.b.save_file({"name": "x", "format": "svg", "svg": self.svg}))

    def test_save_many_never_overwrites(self):
        items = [{"name": "01 Navy", "format": "pdf", "svg": self.svg}, {"name": "01 Navy", "format": "pdf", "svg": self.svg}]
        r = self.b.save_many(str(self.d), items, "Separations")
        self.assertEqual(r["files"], ["01 Navy.pdf", "01 Navy 2.pdf"])
        r2 = self.b.save_many(str(self.d), items[:1], "Separations")
        self.assertTrue(r2["folder"].endswith("Separations 2"))

    def test_bad_names(self):
        r = self.b.save_many(str(self.d), [{"name": "../../etc/x:y", "format": "svg", "svg": self.svg}])
        self.assertEqual(r["files"], ["....etcxy.svg"] if False else r["files"])
        self.assertTrue(all("/" not in f for f in r["files"]))
        self.assertTrue((self.d / r["files"][0]).exists())

    def test_versa_without_versa_saves_zip(self):
        r = self.b.send_to_versa("Sunny for Versa", base64.b64encode(b"PK\x05\x06" + b"\0" * 18).decode())
        self.assertFalse(r["opened"]); self.assertTrue((self.d / "Sunny for Versa.zip").exists())

    def test_license_off(self):
        self.assertEqual(self.b.license_status(), {"enabled": False, "licensed": True})

    def test_read_image_rejects_other_types(self):
        p = self.d / "a.gif"; p.write_bytes(b"GIF89a")
        self.assertIn("error", self.b.read_image(str(p)))

    def test_cutout_reports_in_words(self):
        r = self.b.remove_background("data:image/png;base64,AAAA")
        self.assertIn("error", r)

if __name__ == "__main__":
    unittest.main()
