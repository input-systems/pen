---
"@input/pen-dom": patch
---

Keep focus and the caret in a block the vanilla `mountEditor` tree moves into another AX1 list group (a list merged, split or re-keyed by a local or remote edit). The move used to blur the field, leaving focus on the body and dropping the next keystroke; the tree now acks the move (`FieldEditorImpl.ackBlockMoved`) and the field editor restores focus and projects the selection in the same turn (P4).

Breaking: no
