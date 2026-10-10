"""Mac-only helpers: Apple Vision background removal, installed fonts, opening Versa.

Each helper fails with a plain-language RuntimeError when the Mac can't do the
job, so the interface can show the message.
"""
from __future__ import annotations

import platform
import subprocess
from pathlib import Path

VERSA_BUNDLE_ID = "co.greenlaunch.versa"


def macos_version() -> tuple[int, ...]:
    v = platform.mac_ver()[0]
    return tuple(int(p) for p in v.split(".") if p.isdigit()) if v else ()


def can_remove_background() -> bool:
    # Subject lifting (VNGenerateForegroundInstanceMaskRequest) arrived in macOS 14 Sonoma.
    return macos_version() >= (14,)


def remove_background(image_bytes: bytes) -> bytes:
    """Returns a PNG of the main subject with a transparent background."""
    if not can_remove_background():
        raise RuntimeError("AI cutout needs macOS 14 Sonoma or later.")
    import Quartz  # CoreImage lives in the Quartz bridge
    import Vision
    from Foundation import NSData

    data = NSData.dataWithBytes_length_(image_bytes, len(image_bytes))
    # Apply the photo's orientation tag the way browsers do, so the cutout lines up with the picture on screen.
    image = Quartz.CIImage.imageWithData_options_(data, {Quartz.kCIImageApplyOrientationProperty: True})
    if image is None:
        raise RuntimeError("The image couldn't be read for AI cutout.")
    handler = Vision.VNImageRequestHandler.alloc().initWithCIImage_options_(image, {})
    request = Vision.VNGenerateForegroundInstanceMaskRequest.alloc().init()
    ok, err = handler.performRequests_error_([request], None)
    if not ok:
        raise RuntimeError(f"AI cutout failed: {err.localizedDescription() if err else 'unknown error'}")
    results = request.results() or []
    if not results:
        raise RuntimeError("AI cutout didn't find a main subject in this image. Use Remove background instead.")
    obs = results[0]
    buf, err = obs.generateMaskedImageOfInstances_fromRequestHandler_croppedToInstancesExtent_error_(
        obs.allInstances(), handler, False, None)
    if buf is None:
        raise RuntimeError(f"AI cutout failed: {err.localizedDescription() if err else 'unknown error'}")
    out = Quartz.CIImage.imageWithCVPixelBuffer_(buf)
    ctx = Quartz.CIContext.contextWithOptions_(None)
    cs = Quartz.CGColorSpaceCreateWithName(Quartz.kCGColorSpaceSRGB)
    png = ctx.PNGRepresentationOfImage_format_colorSpace_options_(out, Quartz.kCIFormatRGBA8, cs, {})
    if png is None:
        raise RuntimeError("AI cutout couldn't save its result.")
    return bytes(png)


def installed_font_families() -> list[str]:
    """Every font family installed on this Mac, sorted."""
    try:
        from AppKit import NSFontManager
        fams = NSFontManager.sharedFontManager().availableFontFamilies()
        return sorted({str(f) for f in fams if not str(f).startswith(".")}, key=str.lower)
    except Exception:
        return []


def versa_installed() -> bool:
    try:
        r = subprocess.run(["/usr/bin/mdfind", f"kMDItemCFBundleIdentifier == '{VERSA_BUNDLE_ID}'"],
                           capture_output=True, text=True, timeout=5)
        return bool(r.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        return False


def open_in_versa(path: Path) -> bool:
    """Opens the package in Versa. Returns False when Versa isn't installed."""
    try:
        r = subprocess.run(["/usr/bin/open", "-b", VERSA_BUNDLE_ID, str(path)], capture_output=True, timeout=10)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def reveal_in_finder(path: Path) -> None:
    try:
        subprocess.run(["/usr/bin/open", "-R", str(path)], timeout=10)
    except (OSError, subprocess.SubprocessError):
        pass


def open_url(url: str) -> None:
    if url.startswith(("https://", "mailto:")):
        try:
            subprocess.run(["/usr/bin/open", url], timeout=10)
        except (OSError, subprocess.SubprocessError):
            pass
