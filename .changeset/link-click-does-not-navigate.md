---
"@input/pen-dom": patch
---

A click on a link in editor content no longer follows it. A link in a block that was not the active field was a plain page link to the browser, so a click there navigated away from the editor. A plain click now edits or selects as it does on other text, and Cmd/Ctrl+click opens the link in a new tab (RI9).

Breaking: no
