---
"@input/pen-core": patch
---

A plain ArrowLeft/ArrowRight on a non-collapsed text selection now collapses it to the range's start or end (T7) instead of trying to step the focus. A select-all followed by ArrowRight previously left the whole document selected because the focus already sat at the document end, so the next keystroke replaced everything.
