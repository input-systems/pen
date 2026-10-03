---
"@input/pen-dom": patch
---

C2: a collaborator edit that lands while an IME composes no longer shifts or swallows text. On contenteditable, the composition diff anchors at the composition start (repeated characters no longer move it) and is rebased over the deferred remote edits with Yjs's placement, so a remote insert at the composition start, at the replaced range's end, or inside it survives and reads before the composed text — the same result two converged `Y.Doc`s give. On EditContext, `textupdate` ranges and a composition committed after a remote edit map onto the document through the deferred edits, and the buffer resyncs with one span `updateText` against the logical text (inline atoms included).

Breaking: no
