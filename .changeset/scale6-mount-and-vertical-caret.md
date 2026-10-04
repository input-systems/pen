---
"@input/pen-dom": patch
---

Two whole-document costs removed (SCALE6). The block notifier's document snapshot, read before any subscription attaches, now reuses its root ids until `documentState.generation` moves. React's first render reads every block's snapshot that way, so mounting had re-walked the block order once per block (quadratic). `pen.caretUp` / `pen.caretDown` at a block boundary now find the visually adjacent block in one walk of the root, by top, then left, then DOM order (the same order as before). They used to look up and sort every block by id, which took about 0.6 s per keypress at 10k blocks.

Breaking: no
