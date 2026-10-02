---
"@input/pen-dom": patch
---

Contenteditable and EditContext input now edits the editor selection instead of re-reading the DOM selection: when a pointer, drag, context-menu or IME window is open the reader catches up first, and with every window closed a caret moved in the DOM without a gesture is projected back rather than typed at (R step 4). Document shortcuts ask the field editor's reader whether the selection is inside the root. A field activated without any caret in the editor selection still takes its first input at the browser's caret. Table cells are unchanged.

Breaking: no
