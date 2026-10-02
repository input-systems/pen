---
"@input/pen-core": patch
"@input/pen-types": patch
"@input/pen-ai": patch
"@input/pen-search": patch
"@input/pen-multiplayer": patch
"@input/pen-bench": patch
---

A keystroke no longer reads the whole document when the AI review surface or an active search is installed (SCALE2). AI suggestion decorations come from a scoped source that re-reads suggestion marks and block meta only on the blocks a commit touched, and the controller's suggestion list is kept per block instead of walking every block on each commit. With an active query, search rescans only the affected blocks and rebuilds its match list in document order; its decoration source is scoped to the blocks whose matches or active match changed. An argument-less `editor.requestDecorationUpdate()` now recomputes function-form and static sources only; a scoped source that needs a full recompute asks for `{ source, blockIds: "all" }`, so an unrelated request never makes it re-read the document. Multiplayer's remote selection ranges look up block positions in O(1). The realistic SCALE3 counts are re-recorded: equal at 100, 1,000 and 5,000 blocks.

Breaking: no
