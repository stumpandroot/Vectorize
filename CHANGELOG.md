# Vectorize versions

The app shows its version and build in the window title and the toolbar. Each GitHub build has a new build number; the version changes when features change.

## 1.4.0

- New Align view (View > Align, or the Align tab above the canvas) for lining parts up with the original exactly.
- Onion skin shows the original under the vector, with a slider for how strongly the vector shows. Difference shows the original in gray and marks in red where the vector is off by more than about half a pixel.
- Drag parts to move them, or nudge them with the arrow keys: 0.1 px, or 1 px with Shift. A letter in a word set in a font moves with its whole word.
- Align to original moves the selection, or every part, to where it best matches the original, within 3 px.
- Rulers along the top and left edges, in the original image's pixels. Drag from a ruler to add a guide. Drag a guide back onto a ruler, or double-click it, to remove it.
- While you drag, parts snap to guides, to the edges and centers of other parts, and to the middle of the image, and a pink line shows what they snapped to. Hold Option to drag without snapping, or Shift to keep the move level or upright.
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
