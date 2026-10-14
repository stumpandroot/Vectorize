# Vectorize versions

The app shows its version and build in the window title and the toolbar. Each GitHub build has a new build number; the version changes when features change.

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
