---
"@input/pen-types": minor
---

`UndoManager.syncExplicitUndoGroup` is replaced by `withCapture(origin, groupId, run)`, and `CRDTUndoManager` gains an optional `setCaptureKey` with the new `CRDTUndoCaptureKey` type. Undo grouping is keyed rather than timed (AIB4): every write of an AI action joins that action's one undo step even when the user types in between, and the user's typing stays its own steps in time order.

Breaking: yes — hosts that implement `UndoManager` replace `syncExplicitUndoGroup` with `withCapture`
