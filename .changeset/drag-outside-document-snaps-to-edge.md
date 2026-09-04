---
"@input/pen-dom": patch
---

`pointToEditorSelectionPoint` snaps a coordinate above the first block to that block's start and one below the last block to that block's end (G4), instead of resolving the x-nearest offset in the outer block. During a pointer drag that leaves the editor root this is the same range the browser's native drag clamps to, so Pen and the DOM no longer overwrite each other on every `mousemove` and the selection stops flickering.
