---
"@input/pen-ai": patch
---

A prose completion that starts with a single newline now starts a new block whenever the caret ends a non-empty line, not only after closing punctuation. Before, `3` + `\n4\n5` glued the first line onto the caret line as `34`. The newline is still dropped with text after the caret, in an empty block, and outside prose.

Breaking: no
