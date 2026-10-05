---
"@input/pen-core": patch
---

Report `block-props-changed` for a block whose map a commit replaced whole while the block stays. A peer's undo of a delete, delivered with that delete, stores a new map over the one another peer's prop writes went into (COL4), so a list item's type or indent could change with no props change in the summary, and the block notifier kept its old list group and ordinal. Such a replacement now names `"type"` when the type changed, plus every prop and meta key the arrived map holds, read from that one map.

Breaking: no
