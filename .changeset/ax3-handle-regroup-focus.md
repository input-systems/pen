---
"@input/pen-react": patch
---

Return focus to a list item's block handle after a keyboard Move up / Move down that regroups the item. The move re-keyed or replaced the item's AX1 group wrapper, which remounts the block and its handle, so the closing handle's focus return never ran and focus fell to the body; the remounted handle now takes it in the same commit (AX3).

Breaking: no
