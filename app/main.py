"""Vectorize for Mac: opens the interface in a native window.

Run from a checkout with:  python3 -m app.main
"""
from __future__ import annotations

import sys
from pathlib import Path

import webview
from webview.menu import Menu, MenuAction, MenuSeparator

from .bridge import APP_NAME, BUILD, SUPPORT, VERSION, Bridge, make_license_manager


def resource_dir() -> Path:
    # PyInstaller unpacks bundled files under sys._MEIPASS.
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    return base / "ui"


def _dialog(kind: str):
    fd = getattr(webview, "FileDialog", None)
    if fd is not None:
        return {"open": fd.OPEN, "save": fd.SAVE, "folder": fd.FOLDER}[kind]
    return {"open": webview.OPEN_DIALOG, "save": webview.SAVE_DIALOG, "folder": webview.FOLDER_DIALOG}[kind]


class Dialogs:
    def __init__(self):
        self.window = None

    def open_files(self, types, directory=""):
        r = self.window.create_file_dialog(_dialog("open"), directory=directory or "", allow_multiple=True, file_types=types)
        return list(r) if r else []

    def save_file(self, name, directory=""):
        r = self.window.create_file_dialog(_dialog("save"), directory=directory or "", save_filename=name)
        if isinstance(r, (list, tuple)):
            r = r[0] if r else None
        return r

    def choose_folder(self, directory=""):
        r = self.window.create_file_dialog(_dialog("folder"), directory=directory or "")
        if isinstance(r, (list, tuple)):
            r = r[0] if r else None
        return r


# Menu titles that get keyboard shortcuts: title -> (key, also needs Shift)
SHORTCUTS = {
    "Open Image…": ("o", False),
    "Export": ("e", False),
    "Export Selection": ("e", True),
    "Undo": ("z", False),
    "Select All": ("a", False),
    "Zoom In": ("=", False),
    "Zoom Out": ("-", False),
    "Actual Size": ("1", False),
    "Zoom to Fit": ("0", False),
}


def polish_menus():
    """pywebview's menus have no shortcuts and add a second View menu. This
    adds the shortcuts, standard Cut, Copy, and Paste for text fields, and
    folds pywebview's View menu (Enter Full Screen) into ours."""
    try:
        import AppKit
        from PyObjCTools import AppHelper
    except ImportError:
        return

    def apply():
        main = AppKit.NSApp.mainMenu()
        if main is None:
            return
        top = [main.itemAtIndex_(i) for i in range(main.numberOfItems())]
        views = [t for t in top if t.submenu() is not None and t.submenu().title() == "View"]
        if len(views) > 1:
            theirs, ours = views[0], views[-1]
            ours.submenu().addItem_(AppKit.NSMenuItem.separatorItem())
            for item in list(theirs.submenu().itemArray()):
                theirs.submenu().removeItem_(item)
                ours.submenu().addItem_(item)
            main.removeItem_(theirs)
        cmd = AppKit.NSEventModifierFlagCommand
        shift = AppKit.NSEventModifierFlagShift
        for i in range(main.numberOfItems()):
            sub = main.itemAtIndex_(i).submenu()
            if sub is None:
                continue
            for item in sub.itemArray():
                hit = SHORTCUTS.get(item.title())
                if hit:
                    item.setKeyEquivalent_(hit[0])
                    item.setKeyEquivalentModifierMask_(cmd | (shift if hit[1] else 0))
            if sub.title() == "Edit" and sub.indexOfItemWithTitle_("Copy") < 0:
                at = 1
                sub.insertItem_atIndex_(AppKit.NSMenuItem.separatorItem(), at)
                for title, action, key in (("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v")):
                    at += 1
                    sub.insertItemWithTitle_action_keyEquivalent_atIndex_(title, action, key, at)

    AppHelper.callAfter(apply)


def build_menu(window):
    def run(cmd):
        return lambda: window.evaluate_js(f"window.VZ_MENU && window.VZ_MENU({cmd!r})")

    return [
        Menu("File", [
            MenuAction("Open Image…", run("open")),
            MenuSeparator(),
            MenuAction("Export", run("export")),
            MenuAction("Export Selection", run("exportSelection")),
            MenuAction("Export Color Separations…", run("separations")),
            MenuAction("Export All Open Images…", run("exportAll")),
            MenuSeparator(),
            MenuAction("Send to Versa", run("versa")),
        ]),
        Menu("Edit", [
            MenuAction("Undo", run("undo")),
            MenuSeparator(),
            MenuAction("Select All", run("selectAll")),
            MenuAction("Deselect", run("deselect")),
            MenuAction("Hide Selection", run("hide")),
            MenuAction("Delete Selection", run("delete")),
        ]),
        Menu("View", [
            MenuAction("Compare", run("view:compare")),
            MenuAction("Original", run("view:original")),
            MenuAction("Vector", run("view:vector")),
            MenuAction("Outlines", run("outlines")),
            MenuSeparator(),
            MenuAction("Zoom In", run("zoomIn")),
            MenuAction("Zoom Out", run("zoomOut")),
            MenuAction("Actual Size", run("actual")),
            MenuAction("Zoom to Fit", run("fit")),
        ]),
        Menu("License", [
            MenuAction("Enter License Key…", run("license")),
            MenuAction("Deactivate This Mac", run("deactivate")),
        ]),
    ]


def smoke_test(window, result):
    """Opens the real window, waits for the sample logo to convert, and closes.
    Used by the GitHub build to prove the bundled app runs end to end."""
    import time
    ok, note = False, ""
    try:
        window.events.loaded.wait(60)
        start = time.time()
        while time.time() - start < 120:
            status = window.evaluate_js("document.querySelector('#status') ? document.querySelector('#status').dataset.s : ''")
            native = window.evaluate_js("typeof NATIVE !== 'undefined' && NATIVE !== null && document.querySelector('#stale').hidden")
            if status == "done" and native:
                ok = True
                break
            if status == "error":
                note = "the sample didn't convert"
                break
            time.sleep(1)
        else:
            note = "timed out"
        stats = window.evaluate_js("document.querySelector('#stats').textContent")
        print(f"{'PASS' if ok else 'FAIL'} window opens and converts the sample: {stats} {note}".rstrip(), flush=True)
    except Exception as e:  # report every failure
        print(f"FAIL window smoke test: {e}", flush=True)
    finally:
        result.append(0 if ok else 1)
        window.destroy()


def free_port() -> int:
    """A free local port, different on every launch. A fixed port let a copy of the app that was
    still running answer for a newer copy, so the window showed the old interface."""
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main(smoke: bool = False):
    dialogs = Dialogs()
    bridge = Bridge(dialogs, make_license_manager())
    index = resource_dir() / "index.html"
    window = webview.create_window(
        f"{APP_NAME} {VERSION} (build {BUILD})", url=str(index), js_api=bridge,
        width=1320, height=860, min_size=(960, 640),
        background_color="#FAF8F2", text_select=False,
    )
    dialogs.window = window
    window.events.shown += polish_menus
    SUPPORT.mkdir(parents=True, exist_ok=True)
    result: list[int] = []
    webview.start(
        smoke_test if smoke else polish_menus, (window, result) if smoke else None,
        menu=build_menu(window), http_server=True, http_port=free_port(),
        private_mode=False, storage_path=str(SUPPORT / "WebKit"),
    )
    if smoke:
        sys.exit(result[0] if result else 1)


def cli():
    """Entry point for the app bundle.
    --self-test checks the bundled parts; --smoke-test opens the window and converts the sample."""
    if "--self-test" in sys.argv:
        from .selftest import run
        sys.exit(run())
    main(smoke="--smoke-test" in sys.argv)


if __name__ == "__main__":
    cli()
