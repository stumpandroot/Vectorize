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
| Glass | Only the floating zoom controls over the canvas. The toolbar and inspector are flush paper with one hairline (Verbatim's sidebar change, October 18, 2026: glass panes read grey against the paper) |
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
| `--switch-on` (Verbatim's `switchOn`) | `#4F6440` | `#6E8A58` |
| `--fill-butter` / `--fill-sage` / `--fill-petal` (tour cards, ink text) | `#F4C76B` / `#AFC398` / `#EFB6C8` | `#D4AB55` / `#93A87C` / `#C98EA2` |

The family doc names washes, a track fill, and hover and press states without giving values. Vectorize derives them as follows, and `test_design.py` checks their contrast:

| Derived token | Light | Dark | How |
|---|---|---|---|
| `--accent-wash` | `#FCECCC` | `#484A32` | Butter at 32% (dark: 22%) over `card` |
| `--warn-wash` | `#FDE3D9` | `#463D30` | Persimmon at about 20% (dark: 18%) over `card` |
| `--ok-wash` | `#E9EFE0` | `#394A3A` | Sage at about 22% over `card` |
| `--track` / `--track-strong` | ink at 6.5% / 16% | paper at 7% / 20% | Segmented tracks and switch tracks |
| `--interactive-hover` / `--interactive-press` | `#33463C` / `#1B2621` | `#F5F0E6` / `#D4CDC0` | Ink lightened for hover; darkened about 10% for press |

Radii: `--r-sm` 9 (buttons, fields, chips), `--r-md` 13 (rows, sheets), `--r-lg` 17 (feature cards, the canvas well, panels), `--r-xl` 23. Two more follow from the spec rather than adding new sizes: segments sit in an 11 pt track with 3 pt padding, so they're 8 pt (concentric: 11 − 3), and small inline badges (counts, the status chip, the version tag, canvas labels) use 6 pt.

Motion: `--m-press` 100 ms, `--m-touch` 150 ms, `--m-snappy` 200 ms, `--m-calm` and `--m-card` 300 ms, with `--ease-card` for keyframe animations. No bounce anywhere. Under Reduce Motion or Limit animation, transitions keep their duration but only fade color, opacity, and shadow.

## Interaction and motion

Vectorize uses the same interaction vocabulary as Verbatim (its `0d6b88f` pass and the transitions around it). The code is in `ui-src/motion.js`; `tests/ui/test_motion.py` checks it.

| Moment | Motion | Token |
|---|---|---|
| Picking a segment | One ink pill slides under the segments (Verbatim's `matchedGeometryEffect` selection) | 200 ms, `--ease-card` |
| Opening an inspector tab | The pane comes in 12 px from the side of the chosen tab and fades; its sections follow 30 ms apart, up to 5 steps | `motion.calm`, 300 ms |
| Menus, including right-click menus | Fade in from 97% scale and 4 px up, from the corner they open at | 200 ms |
| Selection bar | Rises 4 px and fades in | 200 ms |
| Align bar and batch bar | Drop 6 px and fade in | 300 ms |
| First paint | Toolbar, canvas, inspector header, and setup sections rise 4 px, 30 ms apart (Verbatim Mac's `staggerIn`) | 300 ms |
| Welcome tour steps | Come in 24 px from the side you're moving toward (Back comes from the left) | 300 ms |
| Dragging a Fine-tune dial | The vector switches to thin ink outlines with every anchor point as a small white square with a magenta edge; the dial's label adds "showing points" | Instant on, clears 1.2 s after the new trace |
| Converting overlay | Fades in after 120 ms, so quick conversions never show it | 200 ms |
| Leaving | Everything leaves at once | `motion.instant` |

Rules:

- Keyboard and menu-bar changes never animate. A keydown or a menu command sets `html.kbd`, which turns arrival motion and the pill's glide off until the next pointer press.
- **Limit animation** (Verbatim's `motion.limited`): `html.limit` is on when the system's Reduce Motion is on or you turn on Limit animation (Setup › This app, or View › Limit Animation on Mac). The CSS and card motion read only that class, so both switches behave the same: the pill is hidden and the selected segment fills in place; panes, menus, bars, and tour steps fade without moving; cards keep their light and shadow but don't tilt, lift, or scale.
- The canvas itself never animates when you switch views or zoom. The work area stays instant.

### Right-click options

Each action control with options shows them on right-click (Control-click): the main action first, then options with a check on the current one. Every item is also reachable without right-click.

| Control | Menu |
|---|---|
| Export | Export now; format (SVG, PDF, EPS, PNG); Export selection; Export color separations; Send to Versa |
| Choose image | Choose images; Open the sample logo; Close the batch (in a batch) |
| A part on the canvas | Selects it (or keeps the selection it's in); Keep only, Hide, Delete, Fine-tune, Edit text, Export selection, Select all, Deselect |
| Empty canvas | Select all, Zoom to fit, Actual size, Outlines |
| Zoom controls | Fit, 50%, 100%, 200%, 400%, Outlines |
| A batch image | Open it, Export all, Close the batch |

Escape or Tab closes a menu and returns focus to the control that opened it.

### Welcome tour

Verbatim's pattern: a paper sheet with a section-header strip (diamond, mono label, dotted rule, `01 / 04`), one idea per step, Back on the left, and one primary button on the right.

1. **Welcome:** "Clean vectors from any logo." Three cards, Trace, Fine-tune, and Export, on butter, sage, and petal with ink text and fine-line glyphs.
2. **What you're tracing:** pick a preset. The choice applies right away.
3. **Fine-tune:** snap to true shapes, match the font, line it up, and right-click for options.
4. **Last step:** pick the export format. PDF and EPS are marked "In the Mac app" in the web preview.

It shows once (until `TOUR_VERSION` goes up), and again from Help › Welcome Tour or "Show the welcome tour" in Setup. Finishing, skipping, or pressing Escape marks it seen. Automated test browsers never see it. Titles use SF Pro at 28 pt, not Verbatim's serif, because Vectorize has no display face.

## Departures from the family doc, and why

| Departure | Why |
|---|---|
| The artwork sheet is pure white (`#FFFFFF`) with a neutral gray checker, not `reader` | A tracing tool has to show the artwork's colors as they are; a warm sheet shifts how colors read |
| Canvas overlays use functional colors: selection, snap lines, and Fine-tune anchor points magenta `#E0218A`, guides cyan `#18A9E0`, the sticker cut line `#FF00FF`, and the Difference view's red `#E2203C` | They must stand out against any logo, and cyan guides and a magenta CutContour are print and design-tool conventions. They never appear in chrome |
| Glass is CSS (`backdrop-filter`) with a paper tint, not system Liquid Glass | The app's interface is a web view. The tint is strong enough (82%+) that text on it stays legible, and it falls back to opaque `bar` under Reduce Transparency |
| No grain | Grain is for illustrated level-0 surfaces; Vectorize has none |
| The Export menu is an opaque popover (`card` with `shadow.high`), not glass | It holds paragraphs of text over the artwork; the family doc keeps glass out from behind text |
| The toolbar and inspector are flush paper, not glass | The family doc (2.1) lists them as glass; Verbatim dropped its glass sidebar on October 18 because it read grey against the paper, and Tim chose to follow it. Only the floating zoom controls stay glass |
| The segment pill animates its width as well as its position | Segments differ in width; the pill is absolutely positioned, so the width change doesn't reflow anything else |
| Right-click menus have no link to a Settings pane | Vectorize keeps every setting in the inspector, beside the controls, so there is no Settings pane to link to |
| Reduce Transparency and Increase Contrast are read when the app opens | WebKit doesn't report Reduce Transparency to web pages, so the app passes both settings in at launch. Changing them while the app is open takes effect the next time it opens |

## Checks

Before calling a screen done, run the family QA checklist. Vectorize also runs `python3 tests/ui/test_design.py`, which checks the contrast of every text and surface token pair, the reduced-motion and increased-contrast rules, and that no legacy purple or old navy remains in the interface.
