# Vectorize versions

The app shows its version and build in the window title and the toolbar. Each GitHub build has a new build number; the version changes when features change.

## 1.12.0

Vectorize now looks like Verbatim's sibling.

- **Sage is Vectorize's color,** the way persimmon is Verbatim's. The selected preset is a solid sage card, the one bold color on the screen, and the done status, the scope bar, and switches use sage. Paper, ink, and the family colors are the same in both apps.
- **A new mark and app icon:** the node ring, a circle with its four anchor points, ink on sage, drawn on the same grid as Verbatim's bars. The mascot is retired.
- **Serif titles.** The app name, the open file's title, and the welcome tour's titles are set in New York, Verbatim's serif. A mono line over the canvas reads "VECTORIZE / SHAPES IN ORDER" with the date, as Verbatim's does.
- **Fine-line icons** for the tools, buttons, presets, destinations, alignment, and layer controls, in Verbatim's drawing style. Each destination now has an icon.
- **The welcome tour opens with "Drop an image. Get a vector."** over three method cards: Trace in sage, Refine in butter, and Export in petal.
- Counts on the Shapes and Text tabs and the status line are quiet mono text, with no colored badges or dots.

## 1.11.0

- **Canvas background.** Three buttons beside Outlines show transparent art over the checkerboard, white, or black, so you can check light and dark artwork. The choice is kept between sessions and never changes what you export. On a Mac, the View menu has the same three choices.

## 1.10.0

Cleaner tracing and lettering, tuned on real logos.

- **More detail from small images.** Vectorize traces at about 3,200 px on the long side (up to 6 megapixels), twice the old size, so thin gaps in small type stay open and 1-pixel lines survive. A trace takes a little longer.
- **Edges placed between pixels.** Each edge pixel's blend of the two colors beside it says where the edge really runs, so outlines follow the artwork more closely than the pixel grid allows.
- **Less noise.** A noisy or grainy image (paper texture, a photographed print) is smoothed before tracing, with edges kept. Thin bands of an in-between shade along edges (JPEG ringing, anti-aliasing) join the colors on either side instead of becoming specks.
- **Straighter edges and truer corners.** Short edges between corners stay straight, long stems stay straight where they run into a curve, a curve that meets an edge at a slight angle no longer kinks just before the join, and small round ends (a stroke's cap, a dot) stay round instead of becoming points. Corners that the image's blur rounded off are drawn sharp.
- **More words found.** Words are also read from each color of the trace on its own, so lettering over a busy background or in an extruded style reads. Stray reads of artwork (a lightning bolt read as 4) are dropped, and lettering on a circle is found even when the straight read got some of it.
- **Fonts checked more carefully.** Words in a family the app has already matched in the logo use it too when they nearly pass. Pointed letters (the A's apex) no longer fail the thin-stroke check. Lettering under 14 px tall is never swapped on its own: at that size similar fonts can't be told apart.
- **The window opens smoothly.** The sample logo is traced after the opening animation and the welcome tour appear, so neither stalls.
- **Sticker borders** size the page from the border's curves, not just its end points, so the border is never clipped.

Under the hood: the tracing test set scores better than 1.9.0 on shape, edge, and worst-edge error, and the lettering score passes its baseline.

## 1.9.0

A new lettering engine: Vectorize reads words better, finds their fonts in the whole Google Fonts library, sets them in the font's real outlines, and swaps a font in on its own only when every letter checks out.

- **Real font outlines.** A matched font is placed from its own glyph outlines (Bézier curves straight from the font file), sized, spaced, stretched, slanted, and nudged letter by letter to fit the word. Before, Vectorize traced a picture of the font, which rounded its corners and thinned its hairlines. Font letters export with the nonzero fill rule, so overlapping parts of a glyph stay filled.
- **The whole Google Fonts library.** A built-in index describes the letter shapes of 1,883 families (3,994 styles). Vectorize ranks them all against your word, fits the closest ones for real, tries the weights in between, and recognizes look-alike families (Playfair Display SC is Playfair Display for capitals) so it uses the plain name.
- **A letter check before any swap.** Each letter is compared with the original: overlap, edge distance, counters (the holes in A, O, and R), and thin strokes. A font swaps in on its own only when every letter passes and no other family is just as close. Otherwise it's listed as a suggestion with what to check, such as "Check R, A".
- **Compare with the original.** For a word set in a font, the Text tab draws the font's outline over the original so you can see any difference.
- **More words found.** Vectorize finds one- and two-letter marks, words in several colors, stacked lines, and small taglines under big names. A tagline the reader sees as one line stays one word, so its spacing is fitted once.
- **Lettering on a circle.** Badge and seal lettering, over the top or along the bottom, is found, straightened to be read, and set in its font along the same curve.
- **Cleaned letters keep their hairlines.** Cleaned mode traces each word from the original image at twice the detail, with no blur first, so thin strokes and serif corners survive.
- **Cleanup for hand lettering.** In Cleaned mode, two switches: **Make repeated letters match** gives every copy of a letter the shape of its most typical copy, and **Even out stroke weight** thickens or thins letters drawn heavier or lighter than the rest. Both are off until you turn them on.
- **The web preview reads text too,** with tesseract.js on your device. Nothing is uploaded.
- **On a Mac,** Apple Vision also reports a box for each letter, and words you've typed before are expected the next time.
- **Fonts work offline.** The app carries the 48 most-used families (Latin only, with their licenses in the app), and keeps any other font it downloads, so it works without a network after its first use.

Under the hood: `bench/textset` is a lettering test set (13 hand-picked hard cases plus 300 generated words from Google Fonts with known outlines), `bench/text_score.py` scores it, and GitHub fails a build that finds, reads, or fits words worse, or that swaps a font in when its letters don't match the artwork. PP-OCR (RapidOCR) was measured against tesseract.js on the same images and not shipped: it read 74 percent of words to tesseract.js's 81 percent, about eight times slower (`bench/ocr_bakeoff.py`).

## 1.8.0

The Fine-tune dials do something you can see.

- Each dial's range is much wider. The middle of every slider gives the same trace as before; the ends go much further:
  - **Curves:** Tight keeps about 1.5 times as many points; Smooth smooths edges harder before and during fitting.
  - **Corners:** what counts as a corner runs from 80 degrees (Rounder) to 12 degrees (Sharper).
  - **Straight edges:** lines may stray from 0.2 to 6 pixels and still be drawn straight, and snap up to 9 degrees.
  - **Small details:** 0 drops pieces up to about 580 square pixels; 100 keeps 1-pixel pieces and blurs edges less, so thin lines hold up better.
- While you drag a dial, use its arrow keys, or press Grow or Shrink, the vector shows thin outlines with every anchor point marked in magenta, so you see points appear and disappear. It returns to normal a moment after the new trace lands.
- The footer counts points.

## 1.7.0

Vectorize picks up the design changes from Verbatim's latest build.

- The toolbar and the inspector are flush paper, divided from the canvas by one hairline. No glass, shadow, or inset. Only the zoom controls over the canvas stay glass.
- Switches turn brand sage when on, in light and dark.
- Limit animation: turn it on in Setup › This app (or View › Limit Animation on a Mac) for fades instead of movement. Vectorize also does this when Reduce Motion is on in System Settings.
- Entrances are quieter: things rise 4 px instead of 6.
- A welcome tour shows once: what Vectorize does, a preset to start with, the fine-tune tools, and your export format. Open it again from Help › Welcome Tour or "Show the welcome tour" in Setup.

## 1.6.0

The interaction and motion pass from Verbatim, so Vectorize moves the way the rest of the family does.

- Segmented controls (the view switcher, the inspector tabs, the tools, and every option group) have one ink pill that slides to the segment you pick.
- Inspector tabs open from the side of the tab you picked, with their sections arriving 30 ms apart.
- Menus pop in from where they open, the selection bar rises from the bottom of the canvas, and the Align and batch bars drop in. Everything leaves at once, so nothing lingers in your way.
- The window's first paint rises in, top to bottom.
- The converting overlay waits a moment before it shows, so a quick conversion never flashes it.
- Right-click (or Control-click) for options:
  - **Export:** export now, pick the format, export the selection or color separations, or send to Versa.
  - **Choose image:** choose images, open the sample logo, or close a batch.
  - **A part on the canvas:** it's selected, then Keep only, Hide, Delete, Fine-tune, Edit text, Export selection, Select all, and Deselect.
  - **Empty canvas:** Select all, Zoom to fit, Actual size, and Outlines.
  - **Zoom controls:** Fit, 50%, 100%, 200%, 400%, and Outlines, with a check on the current one.
  - **A batch image:** open it, export all, or close the batch.
- Anything you do from the keyboard or the menu bar happens at once, without motion. Motion comes back with your next click.
- Reduce Motion keeps the fades and drops the movement: segments fill in place, and panes and menus fade without sliding.

## 1.5.0

- New look from the Stump & Root app family design system (version 2.1): warm paper and ink neutrals, a near-black green dark mode, and butter as Vectorize's one accent. See DESIGN.md.
- The toolbar, the inspector, and the zoom controls are glass. The zoom controls float over the canvas, bottom right. The canvas, fields, and sliders are inset wells, and Export is a raised button.
- Selected segments and buttons are ink. A selected preset or destination also shows an outline and a check, so selection never depends on color.
- Preset tiles and batch images respond to the pointer: they tilt slightly toward it, catch a thin edge light, and lift. Clicks press down and spring back without bounce.
- Section headers in the inspector are numbered, with a mono overline.
- Text uses the Mac's system fonts (SF Pro and SF Mono), so the app no longer loads web fonts.
- Export's label changes to "Exporting…" and then "Saved." Your first export ever gets one small ring of celebration.
- On a phone or a narrow window, the preview stays pinned at the top while you scroll through the settings, so you see each change on the image.
- Toasts stay up for 4.5 seconds. Section headers have a dotted rule. Each view has one raised primary button.
- Signal rings replace the mascot while an image converts. The mascot lives on in the new app icon: one ink glyph on butter, with ink and paper variants.
- The app follows Reduce Motion (no tilt or lift), Reduce Transparency (glass turns opaque), and Increase Contrast (stronger edges, secondary text in ink).

## 1.4.0

- New Align view (View > Align, or the Align tab above the canvas) for lining parts up with the original exactly.
- Onion skin shows the original under the vector, with a slider for how strongly the vector shows. Difference shows the original in gray and marks in red where the vector is off by more than about half a pixel.
- Drag parts to move them, or nudge them with the arrow keys: 0.1 px, or 1 px with Shift. A letter in a word set in a font moves with its whole word.
- Align to original moves the selection, or every part, to where it best matches the original, to within about a tenth of a pixel, looking up to about 3 px away. A part whose position the original doesn't show, such as a color hidden under another, stays put.
- Rulers along the top and left edges, in the original image's pixels. Drag from a ruler to add a guide. Drag a guide back onto a ruler, or double-click it, to remove it.
- While you drag, parts snap to guides, to the edges and centers of other parts, and to the middle of the image, and a pink line shows what they snapped to. Hold Option to drag without snapping, or Shift to keep the move level or upright. Shift-click a selected part to deselect it.
- Align buttons line up left edges, centers, right edges, tops, middles, or bottoms across selected parts. Reset positions puts parts back where they were traced.
- Moves stay through retraces, undo, and every export.

## 1.3.0

- New presets under What is it?, named for the art you start with: One color, Logo, Detailed logo, Silhouette, Sketch, and Grayscale. Photo moves under More presets. Flat art is now Detailed logo.
- Silhouette turns everything into one solid shape with no holes. Sketch compares each pixel with the paper around it, so shadows and uneven light don't turn black, while solid black fills stay solid. Grayscale traces shades of gray.
- Made for adds Sticker and Print and brand, and renames Vinyl cut to Vinyl and HTV. Each destination has a final width and checks the result at that size: thin lines, narrow gaps, ink count, overlap, and brand colors. Show marks thin spots in red.
- Sticker draws a closed cut line 2 mm outside the art on a spot color named CutContour, plus a border 2 mm past it. PDF and EPS keep CutContour as a real spot color.
- With a destination chosen, PDF and EPS exports are scaled so the art comes out at the final width you enter.
- Destinations no longer change the dials. Picking a source preset keeps the destination you chose. Click a destination again to turn it off.
- Brand colors can be typed as a code, such as #1E2340.
- Every build scores the tracing on 42 generated test logos and fails if it gets more than 10 percent worse.

## 1.2.0

- Fine-tune one shape or one layer: select shapes and click Fine-tune in the selection bar, or open a layer in the Layers tab and click Fine-tune this layer. The five dials then change only that selection, marked with "changed", and Back to all returns to the whole logo.
- Tuned layers show "fine-tuned" in the Layers tab. Match the rest (or Match the layer, for shapes) removes a selection's own settings. Undo covers every change.
- Jumping to a tab or a word scrolls only the side panel, never the window.

## 1.1.1

- The window no longer scrolls or bounces as a whole: the canvas and the side panel scroll on their own, and the app fills the window edge to edge.
- The side panel's tabs stay pinned while you scroll, and switching tabs opens the new tab at its top.
- The Shapes tab label no longer gets cut off.

## 1.1.0

- Sharper letters: straight edges are drawn straight, and corners sit where the edges meet instead of rounding off.
- Five fine-tune dials replace Detail and Smoothness: Small details, Straight edges, Curves, Corners, and Grow or shrink.
- On the Mac, words are read with Apple's text recognition and set in the closest matching font when the match is strong. Choose Traced in the Text tab to undo.
- Font matching checks every weight a font family offers.
- Dots on i and j, and the holes in letters like B and A, survive on small images.
- Each launch serves its interface on its own port, so a copy left running can't show its old interface in a newer copy's window. The app warns you if the two ever disagree.

## 1.0.0

- First Mac app: AI background cutout, PDF and EPS export, native save dialogs, installed fonts, Send to Versa, layers, selection, undo, zoom, color separations, batch export, and the license check.
