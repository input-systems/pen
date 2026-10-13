---
"@input/pen-dom": patch
"@input/pen-undo": patch
---

Undo right after an input rule now gives back what was typed. Typing `- ` (or `1. `, `**bold**`, `` `code` ``) and pressing Cmd+Z leaves the literal `- ` as text, so a line such as a `- ben` sign-off can stay a paragraph. Before, `input-rule` writes were not tracked by undo, so Cmd+Z skipped the conversion and undid the text typed before it instead. The undo extension now tracks the `input-rule` origin by default, and the field editor applies each rule as its own undo step after the character that completed it.

Breaking: no
