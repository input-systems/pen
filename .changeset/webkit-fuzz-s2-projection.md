---
"@input/pen-dom": patch
---

Fix four WebKit S2 projection failures found by the DOM fuzzer. A code block stays editable inside the expanded host (`getExpandedBlockRole` returns `editable-inline` for a delegated block that owns one text surface), so a range ending in its text is no longer moved to the end of the previous block. A table endpoint is written as the gaps around the table instead of inside its first cell, and a gap between two unit blocks reads back as the later block's start at a range start. An expanded range whose endpoint block is not mounted yet (an undo that restores a block) parks on that block and projects on its mount ack instead of writing a stale point. The pointerup projection clears the caret WebKit's drag leaves under a block selection. The geometric pointer fallback snaps to grapheme boundaries (G4).

Breaking: no
