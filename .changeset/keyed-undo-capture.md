---
"@input/pen-yjs": patch
"@input/pen-undo": patch
"@input/pen-core": patch
"@input/pen-ai": patch
---

Keep one AI action as one undo step when the user types during it (AIB4). Any ungrouped apply used to close an open AI group, so typing elsewhere during a stream split the action into several undo steps; the explicit group was also implemented by raising Yjs's capture timeout, which merged the user's interleaved keystrokes into the AI step. Undo capture is now keyed: writes carrying a group id join that action's step and move it to the top, the user's typing groups by the capture window only with the step directly beneath it, `stopCapturing()` no longer closes an AI group, and undo and redo close every group. User edits made inside a running generation are now their own undo step rather than part of the generation's.

Breaking: no
