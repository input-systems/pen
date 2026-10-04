---
"@input/pen-dom": patch
---

A scroll, resize, font load, reduced-motion change or block mount ack no longer flushes the scheduler and re-reads the overlay while the layer is empty (OV1). The early return checked for registered contributors, and the built-in selection contributor is always registered, so every root-moving scroll cost a flush and an overlay read even with nothing painted. These inputs now repaint only while the layer holds painted items or unresolved requests; focus, composition and mode changes still repaint whenever a contributor could answer them.

Breaking: no
