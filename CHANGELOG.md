# Vectorize versions

The app shows its version and build in the window title and the toolbar. Each GitHub build has a new build number; the version changes when features change.

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
