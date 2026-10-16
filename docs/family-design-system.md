# Stump & Root app family: shared design system

Purpose: define one design language that every app in the portfolio follows, so the apps feel like a family on Mac, iPad, and iPhone while each keeps its own character. This doc is the authority for agents. Each app's own brand guide (for example, Verbatim's BRAND_GUIDE.md) adds a brand layer on top and never contradicts this doc without a note here.

Version 2.1, October 2026. 2.1 adds card motion (pointer tilt, edge light, lift, press), the inset glass sidebar, 300 ms motion, and right-click options on capture controls.

Version 2.0, October 2026. Supersedes version 1 ("Shared design and motion system"). What changed: a family structure (spine plus brand layer), a materials ladder that plays up Liquid Glass and tactile detail, a family palette, a shared icon grammar, app icon rules for Icon Composer, a component catalog, and per-app profiles.

## How agents use this doc

1. Read this doc, then the app's brand guide, then the app's `<app>.md`.
2. Use only tokens, materials, and components named here or in the brand guide. Ask before inventing a color, a material, a radius, or a component.
3. Prefer the system control. Build a custom component only when the catalog lists it or the brand guide asks for it.
4. Every screen passes the QA checklist at the end of this doc before you call it done.

## Family architecture

Every app has two layers. The spine is identical across apps; the brand layer is what makes each app itself.

| Layer | Shared across apps | Varies per app |
|---|---|---|
| Spine | Neutral palette (paper, ink, reader white), type roles, spacing, radii, materials ladder, motion tokens, haptics, icon grammar, component behavior, accessibility rules | Nothing |
| Brand layer | The family palette to pick from | Signature accent, display face (optional), illustration style, character (optional), app icon metaphor, tone of voice, how expressive Home is |

The rule of thumb (from Lux, which ships Halide and Kino as a family): share a visual family without identical layouts. A person who uses Verbatim should open Dino Day and feel the same hands made it: the same paper, the same ink, the same way a button presses and a sheet arrives.

### Four sensibilities

Each app leans on one or two. One token system serves all of them through calm and expressive tiers.

| Sensibility | What it means | Apps that lead with it | Reference |
|---|---|---|---|
| Warm and illustrated | Flat vector art, limited palette, paper grain, hand-lettered accents | Dino Day | Pok Pok, Night in the Woods, Tide Guide |
| Calm and editorial | No guilt, no urgency, quiet chrome, typographic hierarchy | Verbatim, Abolitionist Field Notes, Screenplay Reader | Things, Bear, iA Writer, Linear |
| Pro creative tool | Instant response, minimal motion, the work area leads | Vectorized, Versa (logo exporter) | Linear, Pixelmator Pro, Rauno Freiberg's principles |
| Playful micro-interactions | Big feedback for simple inputs, reserved for rare moments | Dino Day; first-export moments in the tools | (Not Boring) Habits, Family, grug |

Rules that follow:

1. Never animate keyboard-initiated or high-frequency actions.
2. Reserve rich delight (particles, sound, character reactions) for rare or milestone moments.
3. Use subtle feedback for frequent actions.
4. Keep transitions spatially consistent ("fly instead of teleport").

## Materials ladder

The family plays up the platform: Liquid Glass on everything the system owns or that floats, and tactile, physical detail where your hand meets a control. Content stays on opaque paper so it is always legible. Pick the lowest level that does the job.

| Level | Material | What goes there | How it looks |
|---|---|---|---|
| 0. Paper | Opaque `paper` or `reader` color, optional grain | Reading surfaces, transcripts, documents, lists, the character scene, illustration | Flat, warm, quiet. Grain only on illustrated surfaces |
| 1. Sheet | Opaque `card` with an ink hairline and `shadow.low` | Cards, rows, in-page control groups, form groups | A sheet of paper lying on the desk: 1 pt hairline, soft contact shadow |
| 2. Glass | System Liquid Glass, Regular variant | Toolbars, tab bars, sidebars, sheets, popovers, menus, floating controls over scrolling content (player docks, pinned tool bars, HUDs, floating action buttons) | Refraction, specular edge, adapts to content behind it |
| 3. Clear glass | System Liquid Glass, Clear variant | Controls floating over bold media only: video, photos, full-bleed illustration | Nearly transparent, needs a dimming layer under it |

### Glass rules

- Let the system draw glass. Standard toolbars, tab bars, sidebars, sheets, and menus get Liquid Glass automatically with the current SDK. Don't paint a background behind them.
- Use glass for controls that float above content: `.glassEffect()` with `.regular` (add `.interactive()` for things you press). Group neighbors in a `GlassEffectContainer` so they merge, and morph between states with `.glassEffectID(_:in:)`.
- Use the system glass button styles for floating buttons rather than drawing your own.
- Tint glass with the app's signature accent only for the one primary action in a cluster (`.regular.tint(accent)`). Everything else stays untinted.
- Don't stack glass on glass. Don't mix Regular and Clear in one cluster. Use Clear only over media.
- Never put body text or critical controls directly on Clear glass, or on any blur without a scroll edge effect. Infinum measured contrast as low as 1.5:1 against a 4.5:1 WCAG minimum.
- Keep grain and illustration out from under glass; grain plus refraction hurts legibility.
- Use scroll edge effects to separate floating controls from content that scrolls under them.
- Respect the user's glass intensity setting (iOS 27 adds a slider from "ultra clear" to "fully tinted"). System glass follows it; check custom glass at both ends.
- With Reduce Transparency on, fall back to an opaque `bar` surface. With Increase Contrast on, add a 1 pt `outlineStrong` edge.
- Apps that support earlier OS versions (Verbatim runs on macOS 14) use `.regularMaterial` behind `if #available` checks, with the same placement rules.

```swift
// A floating control cluster (iOS 26+ / macOS 26+), with the fallback
@Environment(\.accessibilityReduceTransparency) var reduceTransparency

var dock: some View {
    HStack { /* play, scrubber, speed, bookmark */ }
        .padding(10)
        .modifier(FloatingGlass(shape: .capsule))
}

struct FloatingGlass<S: Shape>: ViewModifier {
    var shape: S
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(Ink.bar, in: shape).overlay(shape.stroke(Ink.hairline))
        } else if #available(iOS 26, macOS 26, *) {
            content.glassEffect(.regular.interactive(), in: shape)
        } else {
            content.background(.regularMaterial, in: shape).overlay(shape.stroke(Ink.hairline))
        }
    }
}
```

### Tactile detail (modern skeuomorphism)

Skeuomorphism in this family means physical behavior and honest materials, not fake leather. Things should feel like they have weight, press down, and catch light. Use these freely at the levels shown.

| Detail | Where | How |
|---|---|---|
| Press depth | Every custom button and card (levels 1 and 2) | Compress to 0.97–0.99 scale, darken the fill 8–15%, shorten the shadow. Lands in 100 ms on press; springs back over 300 ms on release |
| Card motion | Cards and document rows on Mac and iPad (pointer devices) | See "Card motion" below: tilt toward the pointer, edge light, 2 pt lift, press |
| Physical toggles and switches | Settings, inspectors | System `Toggle` with the switch style; it already behaves physically |
| Wells and inset fields | Search fields, text inputs, meters, scrubber tracks | A 1 pt inner shadow at the top edge (ink at 8%) and a reader-white fill, as if pressed into the paper |
| Raised controls | The one primary control in a view (Record, Export, Done) | A soft top highlight (white at 20–35% in a 1 pt inner stroke) and `shadow.low`, so it reads as a key you can push |
| Paper | Level 0 illustrated surfaces | Static grain overlay (see "Paper texture and grain"); a faint fibre is enough |
| Ink and print | Display type, diagrams, rules | Ink-colored hairlines, dotted rules, registration ticks; type set like a printed page |
| Specular light | Glass, plus the card edge light on hover | Glass gets it from the system material. Cards get a thin pointer-following rim while hovered (see "Card motion"). Don't paint static highlights or gradients on paper surfaces |
| Sound and haptics | Milestones and confirmations | A single tick or tap matched to the visual press (see "Haptics") |

Don't: stitched leather, wood grain, fake binder rings, page curls, heavy drop shadows, static gradients on opaque surfaces, tilt on anything that isn't a card, glass behind long text, or a texture on every surface.

## Color

### Family neutrals (the spine)

Every app uses these neutrals. They come from the Verbatim brand kit, contrast-checked.

| Token | Light | Dark | Role | Contrast |
|---|---|---|---|---|
| `paper` | `#F5F0E6` | `#18241F` | App background, level 0 | — |
| `reader` | `#FFFDF9` | `#1D2B25` | Long-form reading surface | — |
| `card` | `#FFFDF9` | `#202F28` | Level 1 sheets, rows | — |
| `bar` | `#F1EBDF` | `#1E2C26` | Opaque fallback for glass | — |
| `ink` | `#26352E` | `#F5F0E6` | Primary text, strokes, primary control fill | 11.9:1 on paper |
| `textSecondary` | `#545E56` | `#D4CDC0` | Secondary labels | 5.9:1 |
| `textTertiary` | `#606962` | `#A1A29A` | Timestamps, metadata | 5.0:1 |
| `hairline` | ink at 14% | paper at 12% | Dividers, sheet edges | — |
| `outlineStrong` | ink at 36% | paper at 36% | Hover and focus outlines | — |
| `interactive` / `onInteractive` | ink / reader | `#E9E3D6` / `#18241F` | Primary buttons and selected segments | 11:1 |

Under Increase Contrast, secondary and tertiary text move to ink, and hairlines rise to 30–40%.

### Family palette (the brand layer)

Each app picks one signature accent and at most two supporting hues from this palette. Color proportion in core screens: about 70% neutral, 20% ink and structure, 10% accent. Home and onboarding may run richer.

| Token | Light | Dark | Text-safe variant (light / dark) | Pairs with |
|---|---|---|---|---|
| `persimmon` | `#FA6B47` | `#F27A57` | `#B23F24` / `#FF8A6B` | Capture, record, primary moments |
| `petal` | `#EFB6C8` | `#C98EA2` | `#A34D6B` / `#E3A3B8` | Refine, editing, softness |
| `butter` | `#F4C76B` | `#D4AB55` | `#8A6414` / `#E8C27A` | Highlights, saved items, warmth |
| `sage` | `#AFC398` | `#93A87C` | `#4F6440` / `#B9CDA3` | Understanding, calm, growth |

Rules:

- Text and icons on the paper canvas use ink or a text-safe variant, never the bright fill.
- Ink on the fills: petal 7.5:1, butter 8.1:1, sage 6.8:1, persimmon 4.45:1. On persimmon, use ink for large or semibold text only.
- Every status has an icon or a label, never color alone. Errors use the system red; success uses the system green or a labeled sage.
- Highlights in reading views: playing = sage wash, saved = butter wash, search match = persimmon wash. All three stay distinguishable without color.

### Theme modes

`light`, `dark`, and `night` (warm, low-blue, dim; used by Dino Day). Model each as a token mode. Dark mode is a near-black green, never an inversion or pure black.

## Typography

| Role | Face | Size | Notes |
|---|---|---|---|
| Display | One brand serif per app (Verbatim: Instrument Serif; fallback New York) | 34–52 pt | Headlines and editorial moments only |
| Section and card titles | Display serif or SF Pro semibold | 20–30 pt | Use selectively |
| UI and body | SF Pro with Dynamic Type | 13–17 pt | All controls, transcripts, lists |
| Data | SF Mono (or IBM Plex Mono where licensed) | 10–12 pt | Timestamps, durations, indexes, tabular digits |
| Overline | Mono, uppercase, 1.1 pt tracking | 10–11 pt | "01 / RECENT"; sparse |
| Hand-lettered | Drawn by hand, never generated | — | Dino Day accents; never in body text or dense controls |

Never set long reading text in the display serif. Map body roles to Dynamic Type styles so accessibility sizes work. Bundle a font only after you review its license (Instrument Serif, Instrument Sans, and IBM Plex Mono use the SIL Open Font License).

## Spacing, radius, and depth

- Spacing: a 4-point scale (`space1` = 4 through `space12` = 48). Content margins 24–32 pt on Mac, 16–20 pt on iPhone.
- Reading width: 680–850 pt.
- Radius: `radius.sm` 9 (buttons, fields), `radius.md` 12–14 (rows, sheets), `radius.lg` 16–18 (feature cards, panels), `radius.xl` 22–24 (marketing panels). Concentric corners inside glass: inner radius = outer radius − padding. Don't round everything the same.
- Depth: `shadow.low` (ink at 6–8%, 2–6 pt blur, 1–2 pt y) for raised controls and sheets; `shadow.high` (ink at 12%, 16 pt blur) for popovers you draw yourself. Glass brings its own depth; don't add shadows to it.

## Iconography

### Interface icons

- Use SF Symbols for platform affordances: share, trash, chevrons, sidebar, close, search fields, settings. They match the system and come with accessibility built in.
- Use family glyphs for the app's own concepts (record, refine, document, library, export, bookmark, play, plus each app's own). Verbatim's starter kit defines the grammar.

Family glyph grammar:

| Rule | Value |
|---|---|
| Canvas | 128 × 128, live area 112 × 112 (8 pt keyline) |
| Stroke | 4.5 units, round caps and joins, no fills except tiny dots |
| Geometry | Circles, straight runs, single curves; one idea per glyph |
| Optical size | 16–20 pt in dense controls, 20–24 pt for actions, larger only on feature panels |
| Color | Ink on light, paper on dark; recolor for selection, never raster-tint |
| Delivery | Export each glyph as a custom SF Symbol (SF Symbols app, template from the 128 grid) so it gets weights, scales, and accessibility. Until then, draw from the SVG path data, as Verbatim does |

### Diagrams

Each app may own up to three process diagrams in the Verbatim style: thin ink strokes (2.7 units on a 600 × 500 canvas) over a flat color field. Verbatim's are Capture (concentric rings), Refine (paths becoming lines), and Understand (overlapping circles). Use them for Home features, onboarding, empty states, and loading, never as wallpaper.

### App icons

The family's icons share a construction so they sit together on a Dock or Home Screen.

| Rule | Value |
|---|---|
| Tool | Icon Composer 2, layered vectors (SVG); bitmaps adapt poorly |
| Background layer | One flat family color (the app's signature accent, or ink or paper for alternates). No gradients |
| Foreground | One bold ink glyph from the app's metaphor, sized to about 60% of the canvas |
| Glass | Applied to the foreground group so it catches system light; background stays flat |
| Modes | Check Default, Dark, Clear, and Tinted. Keep the glyph ink or near-white so mono and tinted modes hold |
| Testing | Real devices at 16, 32, and 64 pt, on light and dark wallpapers |
| Variants | Each app ships its accent icon plus ink and paper alternates (as Verbatim's kit does) |

## Components

Build these once per app from the family spec; they behave the same everywhere.

| Component | Material | Behavior |
|---|---|---|
| Primary button | Level 1, raised | `interactive` fill, `onInteractive` label, press depth, 9 pt radius. One per view |
| Secondary button | Level 1 | Card fill, hairline, ink label; hairline strengthens on hover |
| Glass button | Level 2 | System glass button style; for floating controls only |
| Segmented control | Level 1 track | `track` fill; selected segment uses `interactive` with `onInteractive` text. Never color alone |
| Section header | Level 0 | Diamond, mono overline, dotted rule, mono index; optional serif title |
| Feature card | Level 1, flat color | Family fill, ink diagram, index, serif title, one line, mono meta. Card motion at 4° tilt; focus ring; real action |
| Document row | Level 1 | Source glyph on a tinted tile, title, mono metadata, state with icon and label, date. Card motion at 2° (wide rows tilt less), drag, context menu |
| Capture bar segment | Level 1 | Click does the default action; right-click opens that control's options (Record: microphone; Dictate: hold key and on/off; Import: files, copied link, keep video; App audio: app picker and permission). Every option also lives in Settings |
| Floating dock | Level 2 | Glass capsule with interactive glass, merged cluster |
| Inset field | Level 0 well | Reader fill, top inner shadow, focus ring on focus |
| Empty state | Level 0 | Family glyph on a tinted disc, one sentence, one action |
| Signal rings | Level 0 | Concentric rings for recording and processing; static under Reduce Motion |
| Toast | Level 2 (or fixed ink) | Short message, one action, 4.5 s, announced to VoiceOver |
| Sidebar | Level 2, inset glass | A floating pane inset 8 pt from the window edges, 18 pt radius: Liquid Glass (`.regular`, tinted with paper at 25–40%) on macOS 26, the sidebar material earlier, with a thin light rim on the top-left edge and a soft shadow. Navigation text only, at full ink |
| Sidebar row | Inside the sidebar | Reader-white selected sheet, accent marker, ink text; hover tint |

## Motion

Springs keep velocity when retargeted, so they stay interruptible. Bounce guide: 0 for general UI, about 0.15 slightly bouncy, about 0.3 noticeably bouncy, above 0.4 exaggerated. Glass morphs use the system's own animation.

| Token | SwiftUI | Web | Reduced-motion fallback | Use |
|---|---|---|---|---|
| `motion.instant` | No animation | 0 ms | Same | Keyboard and high-frequency actions |
| `motion.calm` | `.smooth(duration: 0.3)` | 300 ms ease-out | Crossfade, same duration | Navigation and state changes |
| `motion.card` | `.smooth(duration: 0.3)` (bounce 0) | 300 ms, `cubic-bezier(.2,.8,.2,1)` | Edge light and shadow only; no tilt, lift, or scale | Card tilt, lift, edge light, and release |
| `motion.press` | 100 ms ease-out | 100 ms ease-out | Same | The press-down half of a click; release uses `motion.card` |
| `motion.snappy` | `.smooth(duration: 0.24)` | About 200 ms | Crossfade | Toggles and selection changes |
| `motion.touch` | 180 ms ease-out | About 150 ms | Same | Hover tints on small, frequent controls (chips, sidebar rows) |
| `motion.playful` | `.spring(duration: 0.5, bounce: 0.3)` | CSS `linear()` spring or a Motion spring | Crossfade, no translation or bounce | Dino Day companion moments only |
| `motion.celebrate` | `KeyframeAnimator` or `PhaseAnimator` + `.success` haptic + optional sound | Same sequence (Motion or GSAP) | Short crossfade; haptic only if haptics are on | Rare milestones, such as all tasks done or a first export |

Calm and pro apps (Verbatim, Field Notes, Vectorized, Versa) use `instant`, `calm`, `card`, `press`, `snappy`, `touch`, and one `celebrate` moment. No bounce in productivity controls. Keyboard actions stay instant.

### Card motion

Cards respond to the pointer as if they were physical tiles. It applies to feature cards, document rows, and other clickable cards on pointer devices (Mac, iPad with a trackpad); touch screens use press depth only.

| Part | Value |
|---|---|
| Tilt | The side under the pointer dips away, up to 4° for feature cards and 2° for rows; wide rows scale the angle down by their aspect ratio. Perspective 0.55. Pressing adds 1° |
| Lift | 2 pt up while hovered (1.5 pt for rows); none while pressed |
| Edge light | A 1.25 pt rim whose brightness follows the pointer (a radial gradient centered on it: white at 95% in light mode, 55% in dark), over a hairline that firms to `outlineStrong` at 45% |
| Sheen | A soft radial glow under the pointer (white at 16% light, 7% dark) |
| Shadow | Grows to 14 pt blur, 8 pt y, ink at 13% (35% dark), shifted up to 6 pt away from the pointer |
| Press | Scale 0.98 in 100 ms; spring back over 300 ms |
| Timing | Every change uses `motion.card`, so the card retargets smoothly as the pointer moves |
| Reduce Motion | Keep the edge light, sheen, and shadow; drop tilt, lift, and scale |

Implementation rule (macOS 26): a 3D-rotated view loses clicks, and so do its children. Rotate only the visuals with hit-testing off, and put a flat, untransformed layer on top to take the pointer. Controls inside a card (a ⋯ menu) sit on that flat layer. Verbatim's `CardMotion` modifier in `Views/Theme.swift` is the reference.

### Right-click options

Every capture or action control that has settings shows them on right-click (Control-click), so changing the microphone never means a trip to Settings. The menu lists the control's main action first, then its options with a checkmark on the current one, then a link to the matching Settings pane. Keep these menus short and keep every option reachable in Settings too, because right-click isn't discoverable.

Web rules: keep UI animations at or under 300 ms, ease-out for enter and response, animate only `transform` and `opacity`, prefer transitions that retarget, use `prefers-reduced-motion: reduce` to swap movement for a fade, and use View Transitions for same-document continuity.

Animation tools: Rive for interactive characters with states; Lottie for linear playback; SwiftUI animations or CSS/Motion for UI; Pow (MIT) for SwiftUI delight effects; `layerEffect` with `TimelineView` for shader backgrounds.

## Haptics and sound

- Use `.sensoryFeedback` (iOS 17+). iPhone types: `success`, `warning`, `error`, `selection`, `impact`, `increase`, `decrease`. macOS adds `alignment` and `levelChange`. iPad has no haptics.
- Pair every haptic with a visual press; match intensity to the motion.
- The same action always produces the same haptic.
- Haptics feel right when occasional and become tiresome when frequent.
- Sound is a discipline (Pok Pok): one short, soft sound per milestone, off by default in calm apps, with a setting to turn sound and haptics off.

## Micro-interactions

Do:

- Direction-aware transitions.
- Shared-element continuity (`matchedGeometryEffect`, `glassEffectID`, View Transitions on web).
- Text morphs for state, such as "Export" → "Exporting" → "Done."
- Progress where the user's attention already is.
- Interruptible motion.
- Gesture thresholds matched to stakes: light actions fire mid-swipe; destructive ones wait for finger lift.
- Celebrations gated to milestones.

Don't:

- Add delay to keyboard shortcuts in the pro tools.
- Bounce on destructive actions.
- Put glass or blur behind text.
- Let a character interrupt focused work. Characters react; they never demand attention.
- Make the user wait for an animation to finish.

## Paper texture and grain

- **Web:** a 110 × 110 SVG `feTurbulence` tile (`fractalNoise`, `baseFrequency` 0.55, `numOctaves` 3, `stitchTiles`) as a repeating overlay with `pointer-events: none`. It is 292 bytes versus 119 kB for a PNG.
- **SwiftUI:** a `layerEffect` Metal shader sampling a noise texture, or a tiled noise image.
- Render grain once as a static overlay. Light surfaces need more grain than dark.
- Disable grain under Increase Contrast and Reduce Transparency. Keep it on level 0 only, never under glass.

## Per-app profiles

Accents marked "proposed" need Tim's sign-off before an app ships with them.

| App | Platforms | Sensibility | Signature accent | Supporting | Display face | Glass use | Tactile emphasis |
|---|---|---|---|---|---|---|---|
| Verbatim | Mac first, iPhone | Calm and editorial | Persimmon | Petal, sage, butter | Instrument Serif (New York fallback) | Inset glass sidebar, toolbar, floating player dock, pinned tools bar, dictation HUD. Home's capture bar and all reading surfaces stay paper | Card motion on Home and Library, raised Record control, inset scrubber well, signal rings |
| Dino Day | iPhone, Mac | Warm and illustrated, playful | Sage (proposed) | Butter, persimmon | Hand-lettered accents + rounded serif | Tab bar, sheets, floating add button. The rug, paper, and Rex's scene stay opaque | Paper grain, chunky press states on task checkboxes, celebration on all done |
| Abolitionist Field Notes | iPhone, iPad, web | Calm and editorial (academic) | Ink with butter highlights (proposed) | Sage | A text serif for headings | Bottom tab bar on phone and tablet, sheets, search | Paper reading surfaces, tactile tap-to-reveal for graphic images |
| Screenplay Reader | Mac, iPad, iPhone, web | Calm and editorial | Petal (proposed) | Persimmon for the playhead | Courier-style mono for script pages | Floating transport dock, toolbar | Inset script page, raised play control |
| Vectorized | Web, Mac | Pro creative tool | Butter (proposed), used sparingly | Ink | None (SF Pro) | Toolbar, inspector, floating zoom controls over the canvas | Inset sliders and canvas well, instant response |
| Versa (logo exporter) | Mac (pywebview build, native later) | Pro creative tool | Persimmon or ink (proposed) | Family palette as swatches | None (SF Pro) | Sidebar, inspector, toolbar | Print-spec styling, one celebrate moment on first export |

The video saver lives on as Verbatim's Keep and Moments features, so it follows Verbatim.

## Accessibility and QA checklist

Check every screen on real hardware (the simulator and the device differ):

- [ ] Light, dark, and night (where offered)
- [ ] Glass intensity at both ends ("ultra clear" and "fully tinted")
- [ ] Reduce Transparency (glass falls back to opaque `bar`)
- [ ] Increase Contrast (secondary text moves to ink, edges appear)
- [ ] Reduce Motion (movement becomes crossfades, characters hold still)
- [ ] Larger accessibility text sizes without clipped controls
- [ ] Keyboard-only use on Mac, with a visible focus ring distinct from hover
- [ ] VoiceOver labels on every icon-only control; recording and processing status announced
- [ ] WCAG AA contrast on every text and surface pairing
- [ ] Smallest window or screen size, a medium size, and fullscreen

## No generic AI look

- [ ] The style is defined by hand first: a few hand-drawn reference pieces.
- [ ] Each app has a DESIGN.md or brand guide with exact tokens, and agents ask before inventing anything not in it.
- [ ] Prompts use explicit constraints, not adjectives.
- [ ] Banned by name: characterless sans-serifs, purple or indigo gradients, a centered hero with one CTA, rows of three identical icon cards, faint shadows everywhere, uniform rounded corners, all-white palettes, and glass on every surface.
- [ ] Layouts are explored as image mockups first; the approved mockup goes to the coding agent.
- [ ] Characters come from one approved, versioned character sheet.
- [ ] AI image output is reference only; final assets are redrawn in a vector tool.
- [ ] Hand-lettering is drawn by hand.
- [ ] Motion has one memorable moment per app, not many.

## Token pipeline

The W3C Design Tokens Community Group (DTCG) format reached its first stable version in October 2025; Figma, Penpot, Sketch, Tokens Studio, Style Dictionary, and Terrazzo support it.

1. Author the spine and family palette as DTCG JSON in one shared repo; each app adds a small brand-layer file.
2. Edit them in Figma variables through Tokens Studio, or natively in Penpot.
3. Run Style Dictionary or Terrazzo to generate a Swift package (`Color`, `Font`, spacing, radius, `Animation`, material helpers) and a CSS variables file plus Tailwind theme.
4. Import the Swift package into each app and the Tailwind theme into each web build.

Until the shared package exists, each app keeps a single token file (Verbatim: `Views/Theme.swift` and `Views/Brand.swift`) that matches this doc. Style Dictionary's 2026 Swift output template is [unverified]; check before setup.

## Reference apps and studios

| Study | For |
|---|---|
| Family ("Family Values," Benji Taylor) | Trays, fluidity, the Delight-Impact Curve |
| (Not Boring) Habits and Camera | Layered tactile feedback; standard controls stay standard |
| Rauno Freiberg, "Invisible Details of Interaction Design" | Interruptibility, thresholds, frequency |
| Linear's 2026 refresh | Calm chrome, warmer neutrals |
| Things, Bear, Day One, Mercury Weather | Platform material in chrome, calm content surfaces, custom palettes with native controls |
| Lux (Halide, Kino) | A family look across apps without identical layouts |
| Pok Pok, Gentler Streak, grug, Moonlitt, Tide Guide | Calm palettes, guilt-free progress, character voice, Liquid Glass integration |
| Verbatim brand starter kit | The family neutrals, palette, glyph grammar, and diagram style |

## Sources

- [Apple: glassEffect(_:in:) documentation](https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:).md) and [Glass](https://developer.apple.com/documentation/swiftui/glass.md)
- [Noqta: Liquid Glass iOS 27 developer adoption guide](https://noqta.tn/en/blog/apple-liquid-glass-ios-27-developer-adoption-guide-2026)
- [Gigazine on WWDC26 and macOS 27](https://gigazine.net/gsc_news/en/20260609-apple-wwdc26-macos-27)
- [MacTrast: Liquid Glass stays in macOS 27 with a facelift](https://www.mactrast.com/2026/05/liquid-glass-wont-go-away-in-macos-27-although-it-will-receive-a-facelift-plus-a-new-safari-feature-will-debut/)
- [TechCrunch on WWDC26 Liquid Glass changes](https://techcrunch.com/2026/06/08/apple-is-tweaking-its-controversial-liquid-glass-design)
- [9to5Mac on the iOS 27 Liquid Glass slider](https://9to5mac.com/2026/06/15/ios-27-adds-new-liquid-glass-slider-on-iphone-heres-what-it-lets-you-do/)
- [AppleInsider on mandatory Liquid Glass in Xcode 27](https://appleinsider.com/articles/26/03/26/stop-holding-out-hope-liquid-glass-will-be-mandatory-in-ios-27)
- [Infinum on Liquid Glass accessibility](https://infinum.com/blog/apples-ios-26-liquid-glass-sleek-shiny-and-questionably-accessible/)
- [Apple WWDC26 Icon Composer session 8012](https://developer.apple.com/cn/videos/play/wwdc2026/8012/)
- [Apple Design Awards 2026 winners](https://www.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/)
- [Benji Taylor, Family Values](https://benji.org/family-values)
- [Rauno Freiberg, Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design)
- [Linear, A calmer interface](https://linear.app/blog/behind-the-latest-design-refresh)
- [Apple HIG: Playing haptics](https://developer-mdn.apple.com/design/human-interface-guidelines/patterns/playing-haptics)
- [Emil Kowalski, Great animations](https://emilkowal.ski/ui/great-animations)
- [Lux: the making of Kino](https://www.lux.camera/kino-a-pro-video-camera-in-four-months/)
- [Jean Tinland on SVG grain](https://www.jeantinland.com/blog/120kb-less/)
- [W3C Design Tokens Community Group](https://www.w3.org/community/design-tokens/2026)
- [superdesign.dev on avoiding generic AI UI](https://www.superdesign.dev/blog/how-to-make-ai-ui-look-less-generic)
- Verbatim Brand Starter Kit, BRAND_GUIDE.md (October 2026)
- ChatGPT independent research (Project doc `research/ChatGPT independent research.md`)