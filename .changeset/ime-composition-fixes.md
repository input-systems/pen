---
"@input/pen-dom": patch
---

IME composition no longer loses, duplicates or misplaces text:

- EditContext compositions have one lifecycle from `compositionstart` to `compositionend` (C4). Multi-update compositions (pinyin, Korean, Japanese) no longer delete text after the caret. Typing no longer duplicates edits in the buffer.
- Collaborator, AI, extension and history edits that arrive mid-composition are deferred. The composition is rebased over them with Yjs placement on both backends (C2, COL1).
- A cancelled or empty composition returns the caret to its start and renders deferred decorations (C1).
- A composition over a cross-block selection no longer crashes React in Firefox. It opens the IME window in the expanded host.
- An Android `keyCode` 229 keydown no longer deletes a cross-block range by itself (FE2).

Breaking: no
