---
"@input/pen-vue": patch
"@input/pen-bench": patch
---

`PenEditor` no longer acknowledges every block on mount and on each update; each `PenBlock` acknowledges its own mount (SCALE6). The envelope table's "past the ceiling" note now names full-document mount and structural commits, which stay linear in block count, as what degrades first.

Breaking: no
