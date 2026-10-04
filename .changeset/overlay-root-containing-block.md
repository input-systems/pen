---
"@input/pen-dom": minor
---

The editor root is now the overlay layer's containing block (OV2). `PEN_EDITOR_CHROME_STYLESHEET` positions it with `:where([data-pen-editor-root]) { position: relative }` (zero specificity, so any host rule wins), and a root whose computed `position` is still `static` when a field editor attaches it (`chrome={false}`) gets inline `position: relative` until it detaches; a host's own non-static position is kept. Before, an unpositioned root left the layer positioned against some outer ancestor, so remote carets and outlines stayed behind when content above the editor grew (a banner, an image loading) with no selection change, and items in an `overflow: auto` root, or a scroller around it, painted over app chrome when scrolled out of view instead of being clipped.

Breaking: yes — absolutely positioned host elements inside a static editor root now position against the root; give the root its own non-static `position` to keep another containing block
