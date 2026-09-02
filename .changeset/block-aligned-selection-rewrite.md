---
"@input/pen-ai": patch
---

Resolve a live selection covering whole paragraphs to a block-scoped markdown rewrite, so an inline rewrite lands as paragraph blocks instead of a text splice that folds the reply into the first block. This covers a single paragraph as well as several, which is the case a reply most often outgrows. Partial selections keep the text splice path, and so does any selection reaching a block that is not a paragraph, whose type the markdown parse behind the block scope would not reproduce.
