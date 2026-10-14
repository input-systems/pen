---
"@input/pen-core": patch
"@input/pen-dom": patch
---

A mark toggled with no text selected (Cmd+B at a caret) now applies only at that caret (D7). It follows the caret while you type or delete, but moving the caret with the arrow keys, a click, or a host `selectText` drops it; before, it stayed pending for the whole block and bolded text typed anywhere else.

Enter on an empty nested list item now outdents it one level instead of turning it straight into a paragraph; an empty top-level item still leaves the list.

Breaking: no
