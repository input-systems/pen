---
"@input/pen-dom": patch
---

Double-clicking a word inside an AI suggestion underline now selects the word. When a host opens or closes its suggestion popover during the double click, the underline's class changes. The reconciler now updates that wrapper's attributes in place instead of rebuilding its text nodes. While the pointer gesture is still open, the decoration rebuild no longer writes the first click's caret over the range the browser is selecting (P3). This applies to any mark or decoration wrapper whose attributes alone change.

Breaking: no
