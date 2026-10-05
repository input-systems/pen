---
"@input/pen-types": patch
"@input/pen-core": patch
"@input/pen-yjs": patch
"@input/pen-undo": patch
"@input/pen-ai": patch
"@input/pen-transport": patch
"@input/pen-react": patch
---

AI write attribution, undo grouping and review preview fixes:

- **Undo grouping (AIB4)**
  - Undo capture is keyed. One AI action stays one undo step even when the user types during it, and the user's typing stays its own steps.
  - `directTransport` and `createSSEHandler` give each request one undo group.
- **Overlapping calls (AIB3)**
  - Overlapping tool calls and generations keep their own write guard and staged-write binding. A call closing out of order no longer drops another call's guard or unstages its writes.
  - `directTransport`, `createSSEHandler` and `processStream` apply the editor's `confirm` / `unconfirmedDestructive` policy and accept their own overrides. They allow destructive calls by default when no `confirm` is set, so a server reachable by clients should pass `"refuse"` or a `confirm`.
- **Review preview (RS6):** the `edit_document` streaming preview matches what accept will do: multi-block and nested replaces and deletes, insert placement, empty replacements, and moves and formatting. `EditDocumentPreviewUpdate` gains `blockIds`, `placement` and `complete`. `AIStreamingReviewPreviewInput` gains `complete`, `deletesBlocks` and `replacesBlocks`.
- **Undo drift anchors:** undo reuses the selection authority's anchors through `editor.internals.selectionAnchors()` and `selectionAnchorRepair()` (AN14). This stops spurious `anchor-target-missing` for ranges that end on dividers or tables, and halves `anchor-budget` churn.
- **Anchor repair (AN2, AN14):** `repairAnchor` reads an anchor's position from before the commit even when something resolved it after the commit landed, so a split no longer moves an anchor to the start of the new block. An anchor that resolved to `null` before a commit stays dead instead of being revived from an older position, and a merge carries an `assoc: -1` anchor at the start of the merged-away block into the target instead of losing it.
- **React AI chrome:** the AI suggestions popover is scoped to its own editor. `Pen.AI.ContextualPromptComposer` no longer throws a hook-order error when a session opens.

Breaking: no
