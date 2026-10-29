---
"@input/pen-core": patch
---

A plain ArrowLeft or ArrowRight on a text range whose edge is on a block with no text of its own (a divider, an image, a table) now selects that block, as stepping onto one does. Before, it collapsed to a text caret on the block, which has no field to show it, so focus fell to the page body (T7, N2).

Breaking: no
