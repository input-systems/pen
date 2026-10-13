---
"@input/pen-dom": patch
"@input/pen-autoformat": patch
---

Typing a block marker such as `1. `, `- ` or `[] ` no longer deletes it when the schema does not register the block type it would convert to. The field editor's built-in list markers and autoformat's block rules converted anyway: core dropped the conversion (`PEN_APPLY_002`) but kept the marker deletion, so the typed text vanished and the caret moved to the start of the block, and a schema with only paragraphs, such as a chat input, could not hold a line starting `1. `. Both now skip a conversion to an unregistered type, the way autoformat's inline rules already skip an unregistered mark, and the marker stays as typed text.

Breaking: no
