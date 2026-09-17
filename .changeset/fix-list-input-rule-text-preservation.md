---
"@input/pen-dom": patch
---

Fix list input rules eating text when a marker is inserted before existing content on a line. Typing `* ` at the start of a line that already has text (for example `hello`) now converts to a bullet list while preserving the rest of the line.
