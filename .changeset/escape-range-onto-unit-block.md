---
"@input/pen-dom": patch
---

Escape over a text range whose focus is on a block with no text of its own (a divider, an image, a table), and a click on such a block while a text range is selected, now select that block. Before, both collapsed to a text caret on the block, which has no field to hold it, so focus fell to the page body and the next keystroke went nowhere (N2, T5, S2).

Breaking: no
