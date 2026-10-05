---
"@input/pen-undo": patch
"@input/pen-core": patch
"@input/pen-types": patch
---

Repair undo's drift anchors shared with the selection authority from their pre-commit position (AN14). The authority repairs and then resolves its held anchors before the `commit` event, which overwrites the target a repair reads, so undo compared the caret's after-commit position with a move's pre-commit range: a collaborator commit that deleted a range just before the caret and inserted the same length into another block moved a later redo's caret into that block. Core now exposes the authority's repair through the new `editor.internals.selectionAnchorRepair(anchor, commitId)`, and undo takes it for any anchor the authority held going into the commit, repairing only the others itself. Undo mints no more anchors than before, and reuses the authority's re-mint rather than minting its own.

Breaking: no
