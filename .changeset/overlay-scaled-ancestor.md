---
"@input/pen-dom": patch
---

Overlay items now stay on their text under a scaled or zoomed ancestor (OV2). The read phase measured viewport deltas and wrote them as layer pixels, so under `transform: scale(0.5)` a caret at viewport x=108 painted at x=58, and under CSS `zoom` items drifted the other way. Positions and sizes (carets, labels, outlines, ranges, cell ranges) are now divided by the layer's scale, read as its border box over its layout size (the layer now spans its containing block instead of being zero-size, so the one read it already made gives the scale). `OverlayPaintItem` coordinates are documented as layer CSS pixels; an unscaled root reads exactly as before.

Breaking: no
