# PyInstaller recipe for Vectorize.app. Run from the repository root:
#   pyinstaller --noconfirm packaging/Vectorize.spec
import os
from pathlib import Path

ROOT = Path(SPECPATH).parent
VERSION = os.environ.get("VZ_VERSION") or (ROOT / "VERSION").read_text().strip()
BUILD = os.environ.get("VZ_BUILD", "1")

a = Analysis(
    [str(ROOT / "packaging" / "launch.py")],
    pathex=[str(ROOT)],
    datas=[(str(ROOT / "ui" / "index.html"), "ui")],
    hiddenimports=[
        "app.main", "app.bridge", "app.native", "app.selftest", "app.vector_export", "app.greenlaunch_license",
        "webview.platforms.cocoa", "bottle", "proxy_tools",
        "objc", "AppKit", "Foundation", "WebKit", "Quartz", "Vision", "PyObjCTools.AppHelper",
        "cryptography.hazmat.primitives.asymmetric.ed25519",
    ],
    excludes=["tkinter", "PyQt5", "PyQt6", "PySide2", "PySide6", "gi", "numpy"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="Vectorize",
    console=False,
    argv_emulation=False,
    target_arch=None,           # the runner's own architecture
    codesign_identity=None,     # signed afterwards by packaging/sign_and_package.sh
)
coll = COLLECT(exe, a.binaries, a.datas, name="Vectorize")
app = BUNDLE(
    coll,
    name="Vectorize.app",
    icon=str(ROOT / "packaging" / "AppIcon.icns"),
    bundle_identifier="co.greenlaunch.vectorize",
    version=VERSION,
    info_plist={
        "CFBundleName": "Vectorize",
        "CFBundleDisplayName": "Vectorize",
        "CFBundleShortVersionString": VERSION,
        "CFBundleVersion": BUILD,
        "LSMinimumSystemVersion": "12.0",
        "LSApplicationCategoryType": "public.app-category.graphics-design",
        "NSHighResolutionCapable": True,
        "NSRequiresAquaSystemAppearance": False,
        "NSHumanReadableCopyright": "© 2026 GreenLaunch",
    },
)
