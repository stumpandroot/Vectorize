"""Font files for the lettering engine: the bundled pack, a local cache, and Google Fonts.

The page asks for a family at one weight (and width). This module answers from, in order:
1. the font pack inside the app (popular families, Latin subset, with their OFL notices),
2. ~/Library/Application Support/Vectorize/fonts (anything fetched before),
3. Google Fonts, which serves a static TTF for one weight when asked without a browser user agent.
Fetched files are kept in the cache, so a font works offline after its first use.
"""
from __future__ import annotations

import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

CSS = "https://fonts.googleapis.com/css2?family="
MAGIC = (b"\x00\x01\x00\x00", b"OTTO", b"true", b"wOFF", b"wOF2")


def _slug(family: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", family.lower()).strip("-")


def _name(family: str, weight: int, wdth: int) -> str:
    return f"{_slug(family)}-{int(weight)}" + (f"-w{int(wdth)}" if wdth else "") + ".ttf"


def pack_dir() -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    for p in (base / "ui" / "fonts", base / "packaging" / "fonts"):
        if p.is_dir():
            return p
    return base / "ui" / "fonts"


def cache_dir() -> Path:
    from .bridge import SUPPORT
    d = SUPPORT / "fonts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _download(family: str, weight: int, wdth: int, timeout: float = 15) -> bytes | None:
    q = urllib.parse.quote_plus(family) + (f":wdth,wght@{wdth},{weight}" if wdth else f":wght@{weight}")
    req = urllib.request.Request(CSS + q, headers={"User-Agent": "Vectorize"})
    try:
        css = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
    except Exception:
        return None
    m = re.search(r"url\((https://[^)]+)\)", css)
    if not m:
        return None
    data = urllib.request.urlopen(urllib.request.Request(m.group(1), headers={"User-Agent": "Vectorize"}), timeout=timeout).read()
    return data if data[:4] in MAGIC else None


def font_bytes(family: str, weight: int, wdth: int = 0) -> bytes | None:
    """The font file for family at weight (and width), or None when Google Fonts doesn't have it."""
    name = _name(family, weight, wdth)
    for d in (pack_dir(), cache_dir()):
        p = d / name
        if p.is_file():
            return p.read_bytes()
    miss = cache_dir() / (name + ".missing")
    if miss.exists():
        return None
    data = _download(family, weight, wdth)
    if data:
        (cache_dir() / name).write_bytes(data)
    else:
        miss.write_text("")
    return data


def installed_font_file(name: str) -> tuple[bytes, str] | None:
    """The file of an installed font family or face (by family or PostScript name), with the face's PostScript
    name so a collection (.ttc) can be opened at the right face."""
    try:
        from AppKit import NSFont, NSFontManager
        import CoreText
    except ImportError:
        return None
    font = NSFont.fontWithName_size_(name, 40)
    if font is None:
        members = NSFontManager.sharedFontManager().availableMembersOfFontFamily_(name) or []
        regular = next((m for m in members if str(m[1]).lower() in ("regular", "roman", "book", "normal")), members[0] if members else None)
        if regular is not None:
            font = NSFont.fontWithName_size_(regular[0], 40)
    if font is None:
        return None
    url = CoreText.CTFontCopyAttribute(font, CoreText.kCTFontURLAttribute)
    if url is None:
        return None
    path = Path(str(url.path()))
    if not path.is_file():
        return None
    return path.read_bytes(), str(font.fontName())
