"""Write Vectorize's SVG output as PDF and EPS, with no outside libraries.

Vectorize draws filled shapes in solid colors: <g fill> groups holding
<path>, <circle>, <ellipse>, <rect>, and <polygon> elements, with an optional
rotate() transform. A sticker cut line is a stroked path in a group marked
data-spot="CutContour", written as a named spot color. This module turns that
subset into vector PDF and EPS so the app ships without Cairo or Ghostscript.
"""
from __future__ import annotations

import math
import re
import zlib
import xml.etree.ElementTree as ET

SVG_NS = "{http://www.w3.org/2000/svg}"
_NUM = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
_CMD = re.compile(r"([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)")


# --------------------------------------------------------------------------
# Path parsing: everything becomes absolute M, L, C, and Z
# --------------------------------------------------------------------------
def _arc_to_cubics(x1, y1, rx, ry, phi, large, sweep, x2, y2):
    """SVG elliptical arc to cubic Béziers (SVG spec, appendix F.6)."""
    if rx == 0 or ry == 0 or (x1 == x2 and y1 == y2):
        return [("L", x2, y2)]
    rx, ry = abs(rx), abs(ry)
    cp, sp = math.cos(math.radians(phi)), math.sin(math.radians(phi))
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p, y1p = cp * dx + sp * dy, -sp * dx + cp * dy
    lam = (x1p ** 2) / rx ** 2 + (y1p ** 2) / ry ** 2
    if lam > 1:
        s = math.sqrt(lam)
        rx, ry = rx * s, ry * s
    num = rx ** 2 * ry ** 2 - rx ** 2 * y1p ** 2 - ry ** 2 * x1p ** 2
    den = rx ** 2 * y1p ** 2 + ry ** 2 * x1p ** 2
    co = math.sqrt(max(0.0, num / den)) if den else 0.0
    if large == sweep:
        co = -co
    cxp, cyp = co * rx * y1p / ry, -co * ry * x1p / rx
    cx = cp * cxp - sp * cyp + (x1 + x2) / 2
    cy = sp * cxp + cp * cyp + (y1 + y2) / 2

    def ang(ux, uy, vx, vy):
        a = math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        return a

    t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sweep and dt > 0:
        dt -= 2 * math.pi
    elif sweep and dt < 0:
        dt += 2 * math.pi
    n = max(1, int(math.ceil(abs(dt) / (math.pi / 2) - 1e-9)))
    step = dt / n
    k = 4 / 3 * math.tan(step / 4)
    out = []

    def pt(t):
        x, y = rx * math.cos(t), ry * math.sin(t)
        return cp * x - sp * y + cx, sp * x + cp * y + cy

    def deriv(t):
        x, y = -rx * math.sin(t), ry * math.cos(t)
        return cp * x - sp * y, sp * x + cp * y

    t = t1
    for i in range(n):
        p0, p3 = pt(t), pt(t + step)
        d0, d3 = deriv(t), deriv(t + step)
        c1 = (p0[0] + k * d0[0], p0[1] + k * d0[1])
        c2 = (p3[0] - k * d3[0], p3[1] - k * d3[1])
        if i == n - 1:
            p3 = (x2, y2)
        out.append(("C", c1[0], c1[1], c2[0], c2[1], p3[0], p3[1]))
        t += step
    return out


def parse_path(d: str) -> list[tuple]:
    out: list[tuple] = []
    x = y = sx = sy = 0.0
    last_c2 = None
    last_q = None
    for cmd, args in _CMD.findall(d):
        nums = [float(v) for v in _NUM.findall(args)]
        rel = cmd.islower()
        c = cmd.upper()
        if c == "Z":
            out.append(("Z",))
            x, y = sx, sy
            last_c2 = last_q = None
            continue
        size = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7}[c]
        if size and len(nums) % size:
            nums = nums[: len(nums) - len(nums) % size]
        for i in range(0, len(nums), size):
            a = nums[i:i + size]
            if c == "M":
                nx, ny = (x + a[0], y + a[1]) if rel else (a[0], a[1])
                if i == 0:
                    out.append(("M", nx, ny))
                    sx, sy = nx, ny
                else:
                    out.append(("L", nx, ny))
                x, y = nx, ny
                last_c2 = last_q = None
            elif c == "L":
                x, y = (x + a[0], y + a[1]) if rel else (a[0], a[1])
                out.append(("L", x, y))
                last_c2 = last_q = None
            elif c == "H":
                x = x + a[0] if rel else a[0]
                out.append(("L", x, y))
                last_c2 = last_q = None
            elif c == "V":
                y = y + a[0] if rel else a[0]
                out.append(("L", x, y))
                last_c2 = last_q = None
            elif c == "C":
                p = [a[j] + (x if j % 2 == 0 else y) if rel else a[j] for j in range(6)]
                out.append(("C", *p))
                last_c2 = (p[2], p[3])
                x, y = p[4], p[5]
                last_q = None
            elif c == "S":
                c1 = (2 * x - last_c2[0], 2 * y - last_c2[1]) if last_c2 else (x, y)
                p = [a[j] + (x if j % 2 == 0 else y) if rel else a[j] for j in range(4)]
                out.append(("C", c1[0], c1[1], *p))
                last_c2 = (p[0], p[1])
                x, y = p[2], p[3]
                last_q = None
            elif c in ("Q", "T"):
                if c == "Q":
                    q = [a[j] + (x if j % 2 == 0 else y) if rel else a[j] for j in range(4)]
                    qc, end = (q[0], q[1]), (q[2], q[3])
                else:
                    qc = (2 * x - last_q[0], 2 * y - last_q[1]) if last_q else (x, y)
                    end = (x + a[0], y + a[1]) if rel else (a[0], a[1])
                c1 = (x + 2 / 3 * (qc[0] - x), y + 2 / 3 * (qc[1] - y))
                c2 = (end[0] + 2 / 3 * (qc[0] - end[0]), end[1] + 2 / 3 * (qc[1] - end[1]))
                out.append(("C", *c1, *c2, *end))
                last_q, last_c2 = qc, None
                x, y = end
            elif c == "A":
                ex, ey = (x + a[5], y + a[6]) if rel else (a[5], a[6])
                out.extend(_arc_to_cubics(x, y, a[0], a[1], a[2], int(a[3]), int(a[4]), ex, ey))
                x, y = ex, ey
                last_c2 = last_q = None
    return out


def _f(el, name, default=0.0):
    v = el.get(name)
    try:
        return float(v) if v is not None else default
    except ValueError:
        return default


def _rotation(el):
    m = re.search(r"rotate\(\s*([-\d.eE+]+)(?:[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+))?\s*\)", el.get("transform") or "")
    if not m:
        return None
    a = float(m.group(1))
    cx = float(m.group(2)) if m.group(2) else 0.0
    cy = float(m.group(3)) if m.group(3) else 0.0
    return a, cx, cy


def _apply_rot(segs, rot):
    if not rot:
        return segs
    a, cx, cy = rot
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a))

    def t(px, py):
        dx, dy = px - cx, py - cy
        return cx + dx * c - dy * s, cy + dx * s + dy * c

    out = []
    for g in segs:
        if g[0] == "Z":
            out.append(g)
            continue
        pts = [t(g[i], g[i + 1]) for i in range(1, len(g), 2)]
        out.append((g[0], *[v for p in pts for v in p]))
    return out


def element_segments(el) -> list[tuple]:
    tag = el.tag.replace(SVG_NS, "")
    if tag == "path":
        segs = parse_path(el.get("d") or "")
    elif tag == "circle":
        cx, cy, r = _f(el, "cx"), _f(el, "cy"), _f(el, "r")
        segs = parse_path(f"M{cx + r} {cy}A{r} {r} 0 1 0 {cx - r} {cy}A{r} {r} 0 1 0 {cx + r} {cy}Z")
    elif tag == "ellipse":
        cx, cy, rx, ry = _f(el, "cx"), _f(el, "cy"), _f(el, "rx"), _f(el, "ry")
        segs = parse_path(f"M{cx + rx} {cy}A{rx} {ry} 0 1 0 {cx - rx} {cy}A{rx} {ry} 0 1 0 {cx + rx} {cy}Z")
    elif tag == "rect":
        x, y, w, h = _f(el, "x"), _f(el, "y"), _f(el, "width"), _f(el, "height")
        r = min(_f(el, "rx", _f(el, "ry")), w / 2, h / 2)
        if r > 0:
            segs = parse_path(
                f"M{x + r} {y}L{x + w - r} {y}A{r} {r} 0 0 1 {x + w} {y + r}L{x + w} {y + h - r}"
                f"A{r} {r} 0 0 1 {x + w - r} {y + h}L{x + r} {y + h}A{r} {r} 0 0 1 {x} {y + h - r}"
                f"L{x} {y + r}A{r} {r} 0 0 1 {x + r} {y}Z")
        else:
            segs = parse_path(f"M{x} {y}L{x + w} {y}L{x + w} {y + h}L{x} {y + h}Z")
    elif tag in ("polygon", "polyline"):
        nums = [float(v) for v in _NUM.findall(el.get("points") or "")]
        pts = list(zip(nums[0::2], nums[1::2]))
        if not pts:
            return []
        segs = [("M", *pts[0])] + [("L", *p) for p in pts[1:]] + ([("Z",)] if tag == "polygon" else [])
    else:
        return []
    return _apply_rot(segs, _rotation(el))


def _hex(c: str | None):
    if not c:
        return None
    c = c.strip()
    if re.fullmatch(r"#[0-9a-fA-F]{6}", c):
        return tuple(int(c[i:i + 2], 16) / 255 for i in (1, 3, 5))
    if re.fullmatch(r"#[0-9a-fA-F]{3}", c):
        return tuple(int(c[i] * 2, 16) / 255 for i in (1, 2, 3))
    if c in ("black",):
        return (0.0, 0.0, 0.0)
    if c in ("white",):
        return (1.0, 1.0, 1.0)
    return None


_UNIT_PT = {"pt": 1.0, "in": 72.0, "mm": 72 / 25.4, "cm": 72 / 2.54, "px": 1.0, "": 1.0}


def _length_pt(v: str | None, default: float) -> float:
    """A width or height attribute in points. Plain numbers and px count as points, as before."""
    m = re.fullmatch(r"\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*(pt|in|mm|cm|px)?\s*", v or "")
    return float(m.group(1)) * _UNIT_PT[m.group(2) or ""] if m else default


class Shape(tuple):
    """(rgb, evenodd, segments) for a fill. A stroke also carries .stroke: {"width", "spot"}."""
    stroke = None


def read_svg(svg: str):
    """Returns (width_pt, height_pt, viewbox, shapes) where shapes are
    (rgb, evenodd, segments) in drawing order. Stroked shapes have shape.stroke set.

    The page size comes from the root's width and height. If the root has
    data-pt-per-unit (Vectorize sets it when you choose a final size), the page is
    the viewBox times that many points per unit instead.
    """
    root = ET.fromstring(svg.encode("utf-8") if isinstance(svg, str) else svg)
    vb = [float(v) for v in _NUM.findall(root.get("viewBox") or "")]
    w = _length_pt(root.get("width"), vb[2] if len(vb) == 4 else 0)
    h = _length_pt(root.get("height"), vb[3] if len(vb) == 4 else 0)
    if len(vb) != 4:
        vb = [0, 0, w, h]
    ppu = _f(root, "data-pt-per-unit", 0.0)
    if ppu > 0:
        w, h = vb[2] * ppu, vb[3] * ppu
    shapes = []

    def walk(el, st):
        tag = el.tag.replace(SVG_NS, "")
        st = dict(st)
        for k in ("fill", "fill-rule", "stroke", "stroke-width", "data-spot"):
            if el.get(k) is not None:
                st[k] = el.get(k)
        if tag in ("path", "circle", "ellipse", "rect", "polygon", "polyline"):
            segs = element_segments(el)
            rgb = _hex(st["fill"]) if st["fill"] != "none" else None
            if segs and rgb is not None:
                shapes.append(Shape((rgb, st["fill-rule"] == "evenodd", segs)))
            srgb = _hex(st.get("stroke")) if st.get("stroke") not in (None, "none") else None
            if segs and srgb is not None:
                sh = Shape((srgb, False, segs))
                sh.stroke = {"width": _length_pt(st.get("stroke-width"), 1.0), "spot": st.get("data-spot")}
                shapes.append(sh)
        for ch in el:
            walk(ch, st)

    walk(root, {"fill": "#000000", "fill-rule": "nonzero"})
    return w, h, vb, shapes


# --------------------------------------------------------------------------
# Writers
# --------------------------------------------------------------------------
def _num(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _spots(shapes) -> list[str]:
    """Spot color names in the order they first appear."""
    out = []
    for sh in shapes:
        sp = sh.stroke and sh.stroke.get("spot")
        if sp and sp not in out:
            out.append(sp)
    return out


def _cmyk(rgb):
    r, g, b = rgb
    k = 1 - max(r, g, b)
    if k >= 1:
        return 0.0, 0.0, 0.0, 1.0
    return (1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k


def _ops(shapes, tx, flip: bool, h_pt: float, ps: bool, scale: float = 1.0):
    """Path operators for PDF (m l c h) or PostScript (moveto ...).
    scale: points per SVG unit, for stroke widths given in SVG units."""
    out = []
    spots = _spots(shapes)
    for sh in shapes:
        rgb, evenodd, segs = sh
        r, g, b = rgb
        stroke = sh.stroke
        if stroke and stroke.get("spot"):
            i = spots.index(stroke["spot"])
            if ps:
                c, m, y, k = _cmyk(rgb)
                name = re.sub(r"[^A-Za-z0-9_.-]", "", stroke["spot"]) or "Spot"
                out.append(f"[/Separation /{name} /DeviceCMYK {{dup {_num(c)} mul exch dup {_num(m)} mul exch dup {_num(y)} mul exch {_num(k)} mul}}] setcolorspace 1 setcolor")
            else:
                out.append(f"/CS{i} CS 1 SCN")
        elif stroke:
            out.append(f"{_num(r)} {_num(g)} {_num(b)} {'setrgbcolor' if ps else 'RG'}")
        else:
            out.append(f"{_num(r)} {_num(g)} {_num(b)} {'setrgbcolor' if ps else 'rg'}")
        if stroke:
            out.append(f"{_num(stroke['width'])} {'setlinewidth 1 setlinejoin' if ps else 'w 1 j'}")
        if ps:
            out.append("newpath")
        for sg in segs:
            if sg[0] == "Z":
                out.append("closepath" if ps else "h")
                continue
            pts = [tx(sg[i], sg[i + 1]) for i in range(1, len(sg), 2)]
            flat = " ".join(_num(v) for p in pts for v in p)
            if sg[0] == "M":
                out.append(f"{flat} {'moveto' if ps else 'm'}")
            elif sg[0] == "L":
                out.append(f"{flat} {'lineto' if ps else 'l'}")
            else:
                out.append(f"{flat} {'curveto' if ps else 'c'}")
        if stroke:
            out.append("stroke" if ps else "S")
        else:
            out.append(("eofill" if evenodd else "fill") if ps else ("f*" if evenodd else "f"))
    return "\n".join(out)


def _transform(w, h, vb):
    sx = w / vb[2] if vb[2] else 1.0
    sy = h / vb[3] if vb[3] else 1.0

    def tx(x, y):
        return (x - vb[0]) * sx, h - (y - vb[1]) * sy

    return tx


def _scale_strokes(shapes, w, vb):
    """Stroke widths are read in SVG units; the writers need points."""
    k = w / vb[2] if vb[2] else 1.0
    for sh in shapes:
        if sh.stroke:
            sh.stroke = {**sh.stroke, "width": sh.stroke["width"] * k}
    return shapes


def svg_to_pdf(svg: str, title: str = "Vectorize") -> bytes:
    w, h, vb, shapes = read_svg(svg)
    shapes = _scale_strokes(shapes, w, vb)
    content = zlib.compress(_ops(shapes, _transform(w, h, vb), True, h, False).encode("ascii"))
    spots = _spots(shapes)
    color_spaces = ""
    extra = []
    for i, name in enumerate(spots):
        rgb = next(sh[0] for sh in shapes if sh.stroke and sh.stroke.get("spot") == name)
        c, m, y, k = _cmyk(rgb)
        pdf_name = re.sub(r"[^A-Za-z0-9_.-]", lambda mm: "#%02X" % ord(mm.group()), name)
        extra.append(f"[/Separation /{pdf_name} /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] "
                     f"/C1 [{_num(c)} {_num(m)} {_num(y)} {_num(k)}] /N 1 >>]".encode())
        color_spaces += f" /CS{i} {6 + i} 0 R"
    resources = f"<< /ColorSpace <<{color_spaces} >> >>" if spots else "<< >>"
    safe_title = re.sub(r"[()\\]", "", title)[:120]
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {_num(w)} {_num(h)}] /Contents 4 0 R /Resources {resources} >>".encode(),
        b"<< /Length " + str(len(content)).encode() + b" /Filter /FlateDecode >>\nstream\n" + content + b"\nendstream",
        f"<< /Title ({safe_title}) /Producer (Vectorize) >>".encode(),
    ] + extra
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def svg_to_eps(svg: str, title: str = "Vectorize") -> bytes:
    w, h, vb, shapes = read_svg(svg)
    shapes = _scale_strokes(shapes, w, vb)
    safe_title = re.sub(r"[\r\n]", " ", title)[:120]
    head = (
        "%!PS-Adobe-3.0 EPSF-3.0\n"
        f"%%BoundingBox: 0 0 {math.ceil(w)} {math.ceil(h)}\n"
        f"%%HiResBoundingBox: 0 0 {_num(w)} {_num(h)}\n"
        f"%%Title: {safe_title}\n%%Creator: Vectorize\n%%LanguageLevel: 2\n%%Pages: 1\n%%EndComments\n"
        "%%BeginProlog\n%%EndProlog\n%%Page: 1 1\ngsave\n"
    )
    body = _ops(shapes, _transform(w, h, vb), True, h, True)
    return (head + body + "\ngrestore\nshowpage\n%%EOF\n").encode("ascii")
