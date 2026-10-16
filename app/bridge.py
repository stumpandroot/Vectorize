"""What the interface can ask the Mac to do.

The interface runs in a WebKit window and calls these methods through
`window.pywebview.api`. Every method returns plain JSON-friendly values and
never raises: failures come back as {"error": "..."} with a message a person
can act on.
"""
from __future__ import annotations

import base64
import json
import re
import sys
import threading
from pathlib import Path

from . import native
from .vector_export import svg_to_eps, svg_to_pdf

APP_NAME = "Vectorize"


def _bundle_value(key: str, default: str) -> str:
    """A value from the app's Info.plist, or the default when run from source."""
    try:
        from Foundation import NSBundle
        v = NSBundle.mainBundle().objectForInfoDictionaryKey_(key)
        return str(v) if v and getattr(sys, "frozen", False) else default
    except Exception:
        return default


def _source_version() -> str:
    try:
        return (Path(__file__).resolve().parents[1] / "VERSION").read_text().strip()
    except OSError:
        return "dev"


VERSION = _bundle_value("CFBundleShortVersionString", _source_version())
BUILD = _bundle_value("CFBundleVersion", "dev")
SUPPORT = Path.home() / "Library" / "Application Support" / APP_NAME
IMAGE_TYPES = ("Images (*.png;*.jpg;*.jpeg)",)


def _safe_name(name: str, fallback: str = "vectorized") -> str:
    n = re.sub(r"[/\\:*?\"<>|\x00-\x1f]+", "", name or "").strip(" .")
    return n[:120] or fallback


def _decode(data: str, encoding: str) -> bytes:
    if encoding == "base64":
        return base64.b64decode(data.split(",", 1)[1] if data.startswith("data:") else data)
    return data.encode("utf-8")


class Settings:
    def __init__(self, path: Path = SUPPORT / "settings.json"):
        self.path = path
        try:
            self.data = json.loads(path.read_text())
        except (OSError, ValueError):
            self.data = {}

    def get(self, k, d=None):
        return self.data.get(k, d)

    def set(self, k, v):
        self.data[k] = v
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.data, indent=2))
        except OSError:
            pass


class Bridge:
    """`dialogs` provides open_files(types), save_file(name, types), and choose_folder()."""

    def __init__(self, dialogs, licensing=None, settings: Settings | None = None):
        self._dialogs = dialogs
        self._license = licensing
        self._settings = settings or Settings()
        self._lock = threading.Lock()

    # --- App -----------------------------------------------------------------
    def app_info(self):
        return {
            "version": VERSION,
            "build": BUILD,
            "native": True,
            "macos": ".".join(str(p) for p in native.macos_version()),
            "cutout": native.can_remove_background(),
            "ocr": bool(native.macos_version()),
            "licensing": self._license is not None,
            "settings": {k: self._settings.get(k) for k in ("lastPreset", "exportFormat", "celebrated")},
            "display": native.accessibility_display(),
        }

    def remember(self, key: str, value):
        if key in ("lastPreset", "exportFormat", "celebrated"):
            self._settings.set(key, value)
        return True

    # --- Files in ------------------------------------------------------------
    def open_images(self):
        paths = self._dialogs.open_files(IMAGE_TYPES, self._settings.get("lastOpenDir", ""))
        if not paths:
            return []
        self._settings.set("lastOpenDir", str(Path(paths[0]).parent))
        out = []
        for p in paths:
            out.append(self.read_image(p))
        return [o for o in out if o]

    def read_image(self, path: str):
        p = Path(path)
        if p.suffix.lower() not in (".png", ".jpg", ".jpeg"):
            return {"error": f"{p.name} isn't a PNG or JPEG."}
        try:
            data = p.read_bytes()
        except OSError as e:
            return {"error": f"Couldn't open {p.name}: {e.strerror or e}"}
        mime = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
        return {"name": p.name, "path": str(p), "dataUrl": f"data:{mime};base64," + base64.b64encode(data).decode()}

    # --- Files out -----------------------------------------------------------
    def _bytes_for(self, item: dict) -> bytes:
        fmt = (item.get("format") or "").lower()
        if "svg" in item and fmt in ("pdf", "eps"):
            title = item.get("title") or item.get("name") or APP_NAME
            return svg_to_pdf(item["svg"], title) if fmt == "pdf" else svg_to_eps(item["svg"], title)
        if "svg" in item:
            return item["svg"].encode("utf-8")
        return _decode(item.get("data", ""), item.get("encoding", "text"))

    def save_file(self, item: dict):
        """item: {name, format, svg | data+encoding}. Asks where to save."""
        try:
            name = _safe_name(item.get("name", ""))
            fmt = (item.get("format") or Path(name).suffix.lstrip(".") or "svg").lower()
            if not name.lower().endswith("." + fmt):
                name = f"{name}.{fmt}"
            item = dict(item, format=fmt)
            data = self._bytes_for(item)
            path = self._dialogs.save_file(name, self._settings.get("lastSaveDir", ""))
            if not path:
                return None
            path = Path(path)
            if path.suffix.lower() != "." + fmt:
                path = path.with_suffix(path.suffix + "." + fmt) if path.suffix else path.with_suffix("." + fmt)
            path.write_bytes(data)
            self._settings.set("lastSaveDir", str(path.parent))
            return {"path": str(path), "name": path.name}
        except Exception as e:  # report every failure in words
            return {"error": f"Couldn't save the file: {e}"}

    def choose_folder(self):
        p = self._dialogs.choose_folder(self._settings.get("lastSaveDir", ""))
        if p:
            self._settings.set("lastSaveDir", str(p))
        return str(p) if p else None

    def save_many(self, folder: str, items: list, subfolder: str = ""):
        """Writes several files into folder (optionally a new subfolder). Never overwrites."""
        try:
            base = Path(folder)
            if subfolder:
                base = base / _safe_name(subfolder, "Vectorize export")
                n, root = 2, base
                while base.exists():
                    base = root.with_name(f"{root.name} {n}"); n += 1
            base.mkdir(parents=True, exist_ok=True)
            written = []
            for it in items:
                fmt = (it.get("format") or "svg").lower()
                stem = _safe_name(it.get("name", ""), "file")
                if stem.lower().endswith("." + fmt):
                    stem = stem[: -len(fmt) - 1]
                path, n = base / f"{stem}.{fmt}", 2
                while path.exists():
                    path = base / f"{stem} {n}.{fmt}"; n += 1
                path.write_bytes(self._bytes_for(dict(it, format=fmt)))
                written.append(path.name)
            return {"folder": str(base), "count": len(written), "files": written}
        except Exception as e:
            return {"error": f"Couldn't save the files: {e}"}

    def reveal(self, path: str):
        native.reveal_in_finder(Path(path))
        return True

    def open_url(self, url: str):
        native.open_url(url)
        return True

    # --- AI cutout -----------------------------------------------------------
    def remove_background(self, data_url: str):
        try:
            png = native.remove_background(_decode(data_url, "base64"))
            return {"dataUrl": "data:image/png;base64," + base64.b64encode(png).decode()}
        except Exception as e:
            return {"error": str(e)}

    # --- Text recognition ----------------------------------------------------
    def recognize_text(self, data_url: str):
        try:
            return {"lines": native.recognize_text(_decode(data_url, "base64"))}
        except Exception as e:
            return {"error": str(e)}

    # --- Fonts ---------------------------------------------------------------
    def font_families(self):
        return native.installed_font_families()

    # --- Versa ---------------------------------------------------------------
    def send_to_versa(self, name: str, zip_b64: str):
        """Saves the package to Application Support and opens it in Versa.
        When Versa isn't installed, asks where to save the zip instead."""
        try:
            data = _decode(zip_b64, "base64")
            fname = _safe_name(name, "Logo for Versa")
            if not fname.lower().endswith(".zip"):
                fname += ".zip"
            if native.versa_installed():
                out = SUPPORT / "Versa handoff" / fname
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(data)
                if native.open_in_versa(out):
                    return {"opened": True, "path": str(out)}
            saved = self.save_file({"name": fname, "format": "zip", "data": zip_b64, "encoding": "base64"})
            if saved and not saved.get("error"):
                saved["opened"] = False
            return saved
        except Exception as e:
            return {"error": f"Couldn't send to Versa: {e}"}

    # --- License -------------------------------------------------------------
    def license_status(self):
        if self._license is None:
            return {"enabled": False, "licensed": True}
        try:
            info = self._license.current_license()
            if info:
                threading.Thread(target=self._license.refresh_if_due, daemon=True).start()
            return {"enabled": True, "licensed": bool(info), "email": (info or {}).get("email")}
        except Exception:
            return {"enabled": True, "licensed": False}

    def activate(self, key: str):
        if self._license is None:
            return {"ok": True, "message": "This build doesn't need a license."}
        r = self._license.activate(key or "")
        return {"ok": r.ok, "message": r.message}

    def deactivate(self):
        if self._license is None:
            return {"ok": True, "message": "This build doesn't use licenses."}
        r = self._license.deactivate()
        return {"ok": r.ok, "message": r.message}


def make_license_manager():
    """Licensing turns on once the GreenLaunch public key is pasted in."""
    try:
        from . import greenlaunch_license as gl
        if "REPLACE" in gl.PUBLIC_KEY_B64:
            return None
        return gl.LicenseManager(app="vectorize")
    except Exception as e:  # missing cryptography in a dev checkout
        print(f"Licensing off: {e}", file=sys.stderr)
        return None
