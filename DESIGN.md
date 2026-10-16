# Vectorize design: brand layer

Vectorize follows the Stump & Root app family design system, version 2.1 (October 2026). Read that doc first (a copy is in `docs/family-design-system.md`); this page adds Vectorize's brand layer on top of it and lists every place Vectorize departs from it, with the reason. Ask before adding a color, material, radius, or component that isn't in either doc.

## Name

The app is **Vectorize**. The family doc calls it "Vectorized"; Tim kept the shipping name (October 2026), so don't rename the app, bundle, DMG, or license product.

## Profile

| Item | Vectorize |
|---|---|
| Platforms | Mac (pywebview, WKWebView) and the web preview |
| Sensibility | Pro creative tool: instant response, minimal motion, the canvas leads |
| Signature accent | Butter, signed off by Tim (October 2026), used sparingly |
| Supporting | Ink |
| Display face | None. SF Pro for UI, SF Mono for data |
| Glass | Toolbar, inspector (inset glass panel), and the floating zoom controls over the canvas |
| Tactile emphasis | Inset canvas well, inset sliders and fields, the raised Export button, card motion on preset tiles and batch rows |
| Character | None in the interface. The mascot lives only in the app icon, drawn as one ink glyph |
| Celebrate moment | The first export: the Export button's label morphs to "Saved," and one ring pulses out from it |

## Where butter goes

Butter is the 10%. Use it for:

- The selected preset tile and the selected destination chip (butter wash, with an ink outline and a check, so selection never relies on color)
- Counts on tabs, the fine-tune scope bar, and the "working" status
- The app icon background

Everything else is neutral. Primary buttons and selected segments use `interactive` (ink), as the family doc specifies.

## Tokens

The tokens live in `ui-src/template.html`, in the `:root` block marked "Family tokens." Legacy variable names (`--sun`, `--coral`, `--lime`, `--mist`) are aliases kept so older rules keep working; they map to butter, persimmon, sage, and the track fill. Don't add new uses of the legacy names.

| Token | Light | Dark |
|---|---|---|
| `--paper` | `#F5F0E6` | `#18241F` |
| `--reader` | `#FFFDF9` | `#1D2B25` |
| `--card` | `#FFFDF9` | `#202F28` |
| `--bar` | `#F1EBDF` | `#1E2C26` |
| `--ink` | `#26352E` | `#F5F0E6` |
| `--text2` | `#545E56` | `#D4CDC0` |
| `--text3` | `#606962` | `#A1A29A` |
| `--interactive` / `--on-interactive` | `#26352E` / `#FFFDF9` | `#E9E3D6` / `#18241F` |
| `--accent` (butter) | `#F4C76B` | `#D4AB55` |
| `--accent-text` | `#8A6414` | `#E8C27A` |
| `--warn-text` (persimmon text-safe) | `#B23F24` | `#FF8A6B` |
| `--ok-text` (sage text-safe) | `#4F6440` | `#B9CDA3` |
| `--danger` (system red, accessible variant) | `#D70015` | `#FF6961` |

Radii: `--r-sm` 9, `--r-md` 13, `--r-lg` 17, `--r-xl` 23. Motion: `--m-press` 100 ms, `--m-touch` 150 ms, `--m-snappy` 200 ms, `--m-calm` and `--m-card` 300 ms. No bounce anywhere.

## Departures from the family doc, and why

| Departure | Why |
|---|---|
| The artwork sheet is pure white (`#FFFFFF`) with a neutral gray checker, not `reader` | A tracing tool has to show the artwork's colors as they are; a warm sheet shifts how colors read |
| Canvas overlays use functional colors: selection and snap lines magenta `#E0218A`, guides cyan `#18A9E0`, the sticker cut line `#FF00FF`, and the Difference view's red `#E2203C` | They must stand out against any logo, and cyan guides and a magenta CutContour are print and design-tool conventions. They never appear in chrome |
| Glass is CSS (`backdrop-filter`) with a paper tint, not system Liquid Glass | The app's interface is a web view. The tint is strong enough (82%+) that text on it stays legible, and it falls back to opaque `bar` under Reduce Transparency |
| No grain | Grain is for illustrated level-0 surfaces; Vectorize has none |
| The Export menu is an opaque popover (`card` with `shadow.high`), not glass | It holds paragraphs of text over the artwork; the family doc keeps glass out from behind text |

## Checks

Before calling a screen done, run the family QA checklist. Vectorize also runs `python3 tests/ui/test_design.py`, which checks the contrast of every text and surface token pair, the reduced-motion and increased-contrast rules, and that no legacy purple or old navy remains in the interface.
