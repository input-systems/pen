---
"@input/pen-dom": patch
---

Paste a plain-text URL as an inline link. A collapsed caret inserts the URL as linked text; a text selection keeps the selected text and wraps it in a `link` mark. URLs rejected by `urlPolicy` (for example `javascript:`) fall through to ordinary paste.
