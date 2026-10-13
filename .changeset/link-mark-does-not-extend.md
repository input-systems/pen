---
"@input/pen-core": patch
"@input/pen-dom": patch
---

Typing at the end of a link no longer extends the link (D7). The `expand: "none"` policy on `link` and inline `code` was computed but then lost at the insert: pen-dom passed no marks when none applied, core's `pen.insertText` fell back to the marks at the caret without the expand policy, and a Yjs insert without attributes inherits its left neighbour's formatting. Inserts now always carry an explicit marks object (`{}` when unmarked), and core's fallback applies the same expand policy as pen-dom. Expanding marks such as bold still extend.

Breaking: no
