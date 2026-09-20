---
"@input/pen-ai": patch
---

Autocomplete keeps the shape of multi-paragraph completions: a single leading newline after a closed line (`Best,`, a finished sentence) starts a new block instead of splicing onto the punctuation, and the new `paragraphGap: "empty-block"` option lands a blank line between prose paragraphs as an empty block for documents whose paragraphs carry no margin.
