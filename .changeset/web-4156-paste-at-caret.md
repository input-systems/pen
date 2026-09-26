---
"@input/pen-dom": patch
---

Place pasted content (parsed HTML and Markdown, full blocks from the Pen clipboard, and multi-line plain text) at the caret instead of after the caret's block: the first pasted block joins the text before the caret, the last joins the text after it, and blocks in between split the line. A paste whose caret block no longer exists is dropped with a `paste-target-missing` diagnostic.
