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


def accessibility_display() -> dict:
    """The Mac's display accessibility settings the interface follows: Reduce Transparency and
    Increase Contrast. WebKit doesn't report Reduce Transparency to web pages, so the app passes it in."""
    try:
        from AppKit import NSWorkspace
        ws = NSWorkspace.sharedWorkspace()
        return {"reduce_transparency": bool(ws.accessibilityDisplayShouldReduceTransparency()),
                "increase_contrast": bool(ws.accessibilityDisplayShouldIncreaseContrast())}
    except Exception:
        return {"reduce_transparency": False, "increase_contrast": False}


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

    step = "reading the image"
    try:
        data = NSData.dataWithBytes_length_(image_bytes, len(image_bytes))
        image = Quartz.CIImage.imageWithData_(data)
        if image is None:
            raise RuntimeError("The image couldn't be read for AI cutout.")
        # Turn the photo upright the way browsers do, so the cutout lines up with the picture on screen.
        step = "reading the photo's orientation"
        props = image.properties() or {}
        orientation = props.get("Orientation")
        if orientation and int(orientation) != 1:
            image = image.imageByApplyingCGOrientation_(int(orientation))

        step = "finding the subject"
        handler = Vision.VNImageRequestHandler.alloc().initWithCIImage_options_(image, {})
        request = Vision.VNGenerateForegroundInstanceMaskRequest.alloc().init()
        ok, err = handler.performRequests_error_([request], None)
        if not ok:
            raise RuntimeError(f"AI cutout failed: {err.localizedDescription() if err else 'unknown error'}")
        results = request.results() or []
        if not results:
            raise RuntimeError("AI cutout didn't find a main subject in this image. Use Remove background instead.")

        step = "cutting out the subject"
        obs = results[0]
        buf, err = obs.generateMaskedImageOfInstances_fromRequestHandler_croppedToInstancesExtent_error_(
            obs.allInstances(), handler, False, None)
        if buf is None:
            raise RuntimeError(f"AI cutout failed: {err.localizedDescription() if err else 'unknown error'}")

        step = "saving the cutout"
        out = Quartz.CIImage.imageWithCVPixelBuffer_(buf)
        ctx = Quartz.CIContext.contextWithOptions_(None)
        cs = Quartz.CGColorSpaceCreateWithName(Quartz.kCGColorSpaceSRGB)
        png = ctx.PNGRepresentationOfImage_format_colorSpace_options_(out, Quartz.kCIFormatRGBA8, cs, {})
        if png is None:
            raise RuntimeError("AI cutout couldn't save its result.")
        return bytes(png)
    except RuntimeError:
        raise
    except Exception as e:  # an Objective-C exception: say which step it came from
        raise RuntimeError(f"AI cutout failed while {step}: {e}") from e


def recognize_text(image_bytes: bytes, custom_words: list[str] | None = None) -> list[dict]:
    """Reads the text in an image with Apple Vision, on this Mac.

    Returns one entry per line: {text, confidence, box, words: [{text, box, chars: [{text, box}]}]}.
    Boxes are [x, y, width, height] as fractions of the image, measured from the top left.

    The first pass reads literally (no language correction), because brand names aren't dictionary words.
    When the page knows words to expect (custom_words: names the user typed or confirmed before), a second
    pass with language correction and those words reads lines the literal pass got wrong; a line from it
    replaces the literal one only when it contains one of the expected words.
    Letter boxes come from Vision's text-rectangle detector, which reports each character; a word gets them
    only when the count matches its letters.
    """
    import re
    import Vision
    from Foundation import NSData, NSMakeRange

    def box(r):
        o, s = r.origin, r.size
        return [float(o.x), float(1 - o.y - s.height), float(s.width), float(s.height)]

    def read(correct: bool):
        handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(data, {})
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        request.setUsesLanguageCorrection_(correct)
        request.setMinimumTextHeight_(0.01)
        if correct and custom_words:
            request.setCustomWords_(list(custom_words))
        ok, err = handler.performRequests_error_([request], None)
        if not ok:
            raise RuntimeError(f"Text recognition failed: {err.localizedDescription() if err else 'unknown error'}")
        lines = []
        for obs in request.results() or []:
            cands = obs.topCandidates_(1)
            if not cands:
                continue
            cand = cands[0]
            text = str(cand.string())
            words = []
            for m in re.finditer(r"\S+", text):
                wb, _ = cand.boundingBoxForRange_error_(NSMakeRange(m.start(), m.end() - m.start()), None)
                if wb is not None:
                    words.append({"text": m.group(0), "box": box(wb.boundingBox())})
            lines.append({"text": text, "confidence": float(cand.confidence()), "box": box(obs.boundingBox()), "words": words})
        return lines

    def char_boxes():
        handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(data, {})
        request = Vision.VNDetectTextRectanglesRequest.alloc().init()
        request.setReportCharacterBoxes_(True)
        ok, _ = handler.performRequests_error_([request], None)
        out = []
        if ok:
            for obs in request.results() or []:
                for c in obs.characterBoxes() or []:
                    out.append(box(c.boundingBox()))
        return out

    data = NSData.dataWithBytes_length_(image_bytes, len(image_bytes))
    lines = read(False)
    if custom_words:
        want = [w.lower() for w in custom_words if w.strip()]
        for alt in read(True):
            if not any(w in alt["text"].lower() for w in want):
                continue
            cx, cy = alt["box"][0] + alt["box"][2] / 2, alt["box"][1] + alt["box"][3] / 2
            hit = next((i for i, l in enumerate(lines) if l["box"][0] <= cx <= l["box"][0] + l["box"][2] and l["box"][1] <= cy <= l["box"][1] + l["box"][3]), None)
            if hit is None:
                lines.append(alt)
            elif lines[hit]["text"] != alt["text"]:
                lines[hit] = alt
    try:
        chars = char_boxes()
    except Exception:
        chars = []
    for l in lines:
        for w in l["words"]:
            b = w["box"]
            mine = sorted((c for c in chars if b[0] - 0.01 <= c[0] + c[2] / 2 <= b[0] + b[2] + 0.01 and b[1] - 0.01 <= c[1] + c[3] / 2 <= b[1] + b[3] + 0.01), key=lambda c: c[0])
            letters = [ch for ch in w["text"] if not ch.isspace()]
            if mine and len(mine) == len(letters):
                w["chars"] = [{"text": ch, "box": c} for ch, c in zip(letters, mine)]
    return lines


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
