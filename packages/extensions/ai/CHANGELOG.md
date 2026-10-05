# @input/pen-ai

## 0.3.0

### Minor Changes

- 56b8dfc: AI tool calls are attributed, classified and undone per call (AIB3, AIB4).

  - `openAIToolCall()` returns the call's own `context`. `executeAITool()` and both transports run handlers with it. Every write path books a write to the call that issued it, and refuses a read-only call's write.
  - The user's typing while a call is open is no call's write.
  - `StreamingTarget.disableActiveWriter()` is replaced by the `activeWriter` getter.
  - `ToolDefinition.destructive` may be a resolver `(input, { staged }) => boolean` (`ToolDestructiveResolver`, `ToolAuthorityContext`).
  - `edit_document` consults `confirm` only for direct calls that remove or replace content: direct replaces, deletes of non-empty blocks, and content-kind changes. `authorizeAIToolCall` and `isDestructiveAITool` take the call's context.
  - New `unconfirmedDestructive: "refuse"` (on `aiExtension`, `AIToolGrant`, `AIToolTurnOptions` and `AgenticLoopOptions`) blocks destructive calls when no resolver is installed. Use it in production if you expose `delete_block` or `write_document`.
  - A host that used `confirm` as an "every AI edit" hook moves to `onBeforeApply` or the commit event.
  - `UndoManager.syncExplicitUndoGroup` is replaced by `withCapture(origin, groupId, run)`. `CRDTUndoManager` gains an optional `setCaptureKey` (`CRDTUndoCaptureKey`).

  Host migration:

  - Tool handlers that compared `ctx.editor === editor` compare `ctx.editor.internals.adapter` (or the document) instead, because `ctx.editor` is now a per-call view.
  - Code that called `StreamingTarget.disableActiveWriter()` reads `activeWriter`.
  - Code that reads `ToolDefinition.destructive` as a boolean must handle a function.
  - Hosts that implement `UndoManager` replace `syncExplicitUndoGroup` with `withCapture`.

  Breaking: yes — tool handlers compare `ctx.editor.internals.adapter` instead of `ctx.editor === editor`, read `activeWriter` instead of `disableActiveWriter()`, handle a function-valued `ToolDefinition.destructive`, and `UndoManager` implementations replace `syncExplicitUndoGroup` with `withCapture`

- c921845: Raise `engines.node` from `>=22` to `^22.22.2 || ^24.15.0 || >=26.0.0` (HOST3). `@input/pen-interop` sanitizes HTML through `isomorphic-dompurify` 4.3, which builds its Node window with jsdom 30, and jsdom 30 declares that range; `@input/pen`, `@input/pen-react`, and `@input/pen-vue` depend on interop, so the workspace-wide floor moves with it. Node 22 releases before 22.22.2, Node 24 releases before 24.15.0, and Node 23 and 25 are no longer supported.

  Breaking: yes — hosts running Node below 22.22.2, 24.0–24.14, or 23/25 must move to a supported Node line (^22.22.2, ^24.15.0 or >=26.0.0)

### Patch Changes

- 56b8dfc: AI write attribution, undo grouping and review preview fixes:

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

- 56b8dfc: Document integrity fixes for concurrent, out-of-order and malformed edits:

  - **Encodable ops (OPB1):** `editor.apply` drops an op whose payload the CRDT cannot encode, with `PEN_APPLY_004`. Examples are a `set-meta` without a namespace, cyclic or non-plain prop, meta and app values, and non-finite mark values. Before, such an op could stop the document from syncing or persisting, or leave a partial write.
  - **Missing parents:** a `parentId` that names no live block, and an insert or move into a parent deleted earlier in the same batch, are dropped with `PEN_APPLY_003` (PR5).
  - **Dangling entries (COL4)**
    - Normalization removes `blockOrder` / `children` entries whose block was deleted (`dangling-block-reference`). Entries whose block map has not arrived yet are kept (new optional `CRDTAdapter.isBlockDeleted`).
    - Iteration APIs skip dangling entries instead of throwing `Block not found`.
  - **Structural repairs on the next commit (COL4):** after a remote or undo commit, the next local commit repairs cycles, duplicates and cross-array membership. Orphans are re-homed with `orphan-block-rehomed`.
  - **One nesting route (RI6):** deleting a container deletes its `children` descendants. A conflicting `parentId` is cleared with `nesting-route-conflict`.
  - **Change summaries:** summaries now report the right `block-inserted` / `block-removed` / `block-moved` for concurrent delete-and-move, duplicate entries, replaced `children` arrays and container maps, re-entered containers, and deleted subtrees. Renderers, search and AI indexes no longer keep dead blocks or miss live ones (OB1, COL4). This adds `RawCommitDelta.absentBlockIds` and `arrivedChildArrays`. A block that loses one of two order entries while its map is deleted or not stored is reported `block-removed`, and a block whose map a commit replaced whole reports `block-props-changed` (`"type"` when it changed, plus the arrived map's prop and meta keys). A write a commit listener makes while a remote delivery or undo is being committed now has a summary naming every insert and delete it made; before, a block it moved could be reported removed and some deletes went missing.
  - **Loading (DUR2):** load repair no longer copies nested children into the root order, and no longer removes an entry whose map is in flight.
  - **System-origin writes:** normalization outside an apply runs in one `"system"`-origin transaction, so its repairs leave the undo stack. `setDocumentProfile()` no longer emits `ORIGIN_UNKNOWN`.
  - **Awareness:** `DocumentSession.ensureAwareness(scopeId, factory)` lets the multiplayer extension create its own awareness. The extension now depends on `@input/pen-yjs` and peers on `yjs` and `y-protocols`.

  Breaking: no

- 56b8dfc: Keystrokes, caret moves and structural edits cost in proportion to what they touch, not to document size (SCALE2, SCALE6).

  - **Indexes:**
    - `DocumentState` gains `preorderIndexOf`, `preorderBlockIds`, `rootBlockIds` and `rootBlockIndexOf`.
    - Root and `children` edits advance the position, parent, child and preorder indexes in place instead of rebuilding them.
    - The change-summary index and the normalization pass index advance by each commit's delta.
    - Measured at 50,000 blocks: an insert inside a container drops from about 41 ms to 0.15 ms, and a delete from about 11 ms to 0.3 ms.
  - **Selection reads:** selection validation, anchor resolution, `buildLazyNormalPositionSnapshot` and vertical caret motion no longer read every block.
  - **Scoped decorations:** new `scopedDecorationSource({ interest, decorate })` recomputes only the blocks a commit names. `decorationsChange` passes `(generation, changedBlockIds)`. `requestDecorationUpdate({ source?, blockIds })` targets sources, and with no argument it recomputes only function-form and static sources. AI suggestions and search use scoped sources, so typing with either installed no longer reads the whole document.
  - **Block notifier:** new `fieldEditor.blockNotifier` fans editor events out per block. React (`EditorBlock`, `InlineContent`), Vue (`PenBlock`, `PenInlineContent`) and the vanilla `mountEditor` tree re-render only the blocks whose state changed. Each block acknowledges its own mount. `blocks-merged` carries `sourceParentId` / `sourceIndex`. Its list slices are rebuilt after a commit that moves the document index without a structural change, such as a duplicate-entry repair.
  - **Multiplayer:** remote selection ranges look up positions in O(1).
  - **Normalization:** the structural rules treat the lowest parent id as the container of a block listed in several arrays. Normalized documents are unchanged.

  Breaking: no

- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [c921845]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
  - @input/pen-types@0.3.0
  - @input/pen-tools@0.3.0
  - @input/pen-core@0.3.0
  - @input/pen-ingest@0.3.0

## 0.2.14

### Patch Changes

- @input/pen-core@0.2.14
  - @input/pen-tools@0.2.14
  - @input/pen-ingest@0.2.14
  - @input/pen-types@0.2.14

## 0.2.13

### Patch Changes

- Updated dependencies [8e2654b]
  - @input/pen-core@0.2.13
  - @input/pen-tools@0.2.13
  - @input/pen-ingest@0.2.13
  - @input/pen-types@0.2.13

## 0.2.12

### Patch Changes

- eeb5eb2: Preserve rich formatting and block structure when AI rewrites selections.
- Updated dependencies [eeb5eb2]
  - @input/pen-ingest@0.2.12
  - @input/pen-tools@0.2.12
  - @input/pen-core@0.2.12
  - @input/pen-types@0.2.12

## 0.2.11

### Patch Changes

- @input/pen-core@0.2.11
  - @input/pen-tools@0.2.11
  - @input/pen-ingest@0.2.11
  - @input/pen-types@0.2.11

## 0.2.10

### Patch Changes

- cbe4112: Autocomplete keeps the shape of multi-paragraph completions: a single leading newline after a closed line (`Best,`, a finished sentence) starts a new block instead of splicing onto the punctuation, and the new `paragraphGap: "empty-block"` option lands a blank line between prose paragraphs as an empty block for documents whose paragraphs carry no margin.
- @input/pen-core@0.2.10
  - @input/pen-tools@0.2.10
  - @input/pen-ingest@0.2.10
  - @input/pen-types@0.2.10

## 0.2.9

### Patch Changes

- 8c4116f: Document-scope suggestions no longer churn on every re-analysis: a repeated fix keeps its id and anchor, a late response is anchored against the live document instead of the text it was asked about, and a dismissed fix stays dismissed across edits elsewhere in the body.
- @input/pen-core@0.2.9
  - @input/pen-tools@0.2.9
  - @input/pen-ingest@0.2.9
  - @input/pen-types@0.2.9

## 0.2.8

### Patch Changes

- 9b0dcd2: Add `scopeUnit` to proactive suggestions: `block` analyzes the whole dirty block, `document` analyzes every eligible block in one request and anchors each candidate in its own block, so edits in a second paragraph no longer drop the first paragraph's analysis. `blockPolicy.isBlockAllowed` lets hosts veto blocks beyond their type.
- @input/pen-core@0.2.8
  - @input/pen-tools@0.2.8
  - @input/pen-ingest@0.2.8
  - @input/pen-types@0.2.8

## 0.2.7

### Patch Changes

- d12e779: Proactive suggestions now replace only the suggestions inside the analyzed scope. Earlier sentences in the same block keep their underlines until an edit kills their range, so a paragraph can show more than one fix at a time.
- @input/pen-core@0.2.7
  - @input/pen-tools@0.2.7
  - @input/pen-ingest@0.2.7
  - @input/pen-types@0.2.7

## 0.2.6

### Patch Changes

- dcd1573: Republish the 0.2.4 train. Those tarballs shipped leftover 0.2.3 `dist/` (no rebuild before `pnpm release`), so `contentRole`, `getBlockContentRole`, and `getDocumentPlaceholderTargetBlockId` were in source and the changelog but not in the packages.
- Updated dependencies [dcd1573]
  - @input/pen-core@0.2.6
  - @input/pen-ingest@0.2.6
  - @input/pen-tools@0.2.6
  - @input/pen-types@0.2.6

## 0.2.5

### Patch Changes

- @input/pen-core@0.2.5
  - @input/pen-tools@0.2.5
  - @input/pen-ingest@0.2.5
  - @input/pen-types@0.2.5

## 0.2.4

### Patch Changes

- Updated dependencies [4ea7542]
  - @input/pen-types@0.2.4
  - @input/pen-core@0.2.4
  - @input/pen-tools@0.2.4
  - @input/pen-ingest@0.2.4

## 0.2.3

### Patch Changes

- @input/pen-core@0.2.3
  - @input/pen-tools@0.2.3
  - @input/pen-ingest@0.2.3
  - @input/pen-types@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [b359f9a]
  - @input/pen-core@0.2.2
  - @input/pen-tools@0.2.2
  - @input/pen-ingest@0.2.2
  - @input/pen-types@0.2.2

## 0.2.1

### Patch Changes

- 879773c: Export `acceptSuggestions` and `rejectSuggestions` from the package root. Hosts that stage persistent suggestions headlessly (`applySuggestedAIOperations`) can now resolve a chosen id set as one undo group under their own origin, instead of looping `acceptSuggestion` per id or resolving everything with `acceptAllSuggestions`.
- Updated dependencies [ab64f16]
  - @input/pen-core@0.2.1
  - @input/pen-tools@0.2.1
  - @input/pen-ingest@0.2.1
  - @input/pen-types@0.2.1

## 0.2.0

### Patch Changes

- e9a3129: Resolve a live selection covering whole paragraphs to a block-scoped markdown rewrite, so an inline rewrite lands as paragraph blocks instead of a text splice that folds the reply into the first block. This covers a single paragraph as well as several, which is the case a reply most often outgrows. Partial selections keep the text splice path, and so does any selection reaching a block that is not a paragraph, whose type the markdown parse behind the block scope would not reproduce.
- e9a3129: Re-anchor an inline turn that rewrites blocks on the paragraphs it staged, instead of leaving it on the blocks it replaced. A block-range replacement deletes its own target blocks, so the session, its turn, and the contextual prompt were left pointing at a block that no longer exists once the turn settled, and a host positioning its prompt UI from that anchor fell back to the top of the document.
- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
  - @input/pen-core@0.2.0
  - @input/pen-tools@0.2.0
  - @input/pen-ingest@0.2.0
  - @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- 7fb7864: Add a smooth-stream extension that paces paint of streamed text while the document stays complete.
- Updated dependencies [7fb7864]
- Updated dependencies [7fb7864]
  - @input/pen-core@0.1.9
  - @input/pen-tools@0.1.9
  - @input/pen-ingest@0.1.9
  - @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- cb50239: Export planEditDocument, executeEditDocument, and editDocumentTool so hosts can reuse the edit_document compiler with a custom apply origin. Applied results follow opaque compiled-op owner tokens through direct and suggestion-mode transforms, not string fingerprints.
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
  - @input/pen-core@0.1.8
  - @input/pen-tools@0.1.8
  - @input/pen-types@0.1.8
  - @input/pen-ingest@0.1.8

## 0.1.7

### Patch Changes

- @input/pen-core@0.1.7
  - @input/pen-tools@0.1.7
  - @input/pen-ingest@0.1.7
  - @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- d6a3b79: Widen `BlockSuggestion` to the runtime review-item action set and re-export the remaining class vocabulary from `@input/pen-ai`.

  `split-block` and `format-text` are host-reachable suggestions. The published `BlockSuggestion` now matches `PersistentBlockSuggestion`, so an exhaustive host switch cannot miss them. A host that already wrote an exhaustive `switch` over the old four-member union must handle those two members to keep type-checking. `REVIEW_SURFACE_BLOCK_SUGGESTION_CLASSES` is re-exported from `@input/pen-ai` with the other RS4 tokens. `PEN_REVIEW_STYLESHEET` stays on `@input/pen-dom` (API1).

- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
  - @input/pen-core@0.1.6
  - @input/pen-types@0.1.6
  - @input/pen-tools@0.1.6
  - @input/pen-ingest@0.1.6

## 0.1.5

### Patch Changes

- 67bf230: Re-export `REVIEW_SURFACE_CLASSES` and `REVIEW_SURFACE_CUSTOM_PROPERTIES` from `@input/pen-ai` so hosts following the review APIs do not have to import the contract layer separately. `PEN_REVIEW_STYLESHEET` stays on `@input/pen-dom` because an extension cannot depend on a renderer (API1).
- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
- Updated dependencies [67bf230]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-core@0.1.5
  - @input/pen-tools@0.1.5
  - @input/pen-ingest@0.1.5

## 0.1.4

### Patch Changes

- @input/pen-core@0.1.4
  - @input/pen-tools@0.1.4
  - @input/pen-ingest@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- @input/pen-core@0.1.3
  - @input/pen-tools@0.1.3
  - @input/pen-ingest@0.1.3
  - @input/pen-types@0.1.3

## 0.1.2

### Patch Changes

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [e80fedc]
- Updated dependencies [e80fedc]
- Updated dependencies [3f82c15]
  - @input/pen-core@0.1.2
  - @input/pen-types@0.1.2
  - @input/pen-ingest@0.1.2
  - @input/pen-tools@0.1.2

## 0.1.1

### Patch Changes

- d67b176: Fix AI generations losing their text when a collaborator types in the same block, and make a peer's AI run visible.

  Two separate faults met in the same block. `handleExternalCommit` cancels an active generation when a non-AI commit touches the block being written, which is right for the local user taking the keyboard back, but every update arriving through `applyUpdate` is `origin: "collaborator"` (COL1) and those were cancelling too. A peer typing anywhere in the block killed the run mid-stream and the model's remaining text never landed. The origins that leave a generation running are now a named set, and `collaborator` is in it.

  The `suggestion-splice` streaming sink then wrote each delta at the selection's original end offset plus the length streamed so far. Those offsets describe a document that stopped existing the moment a peer edited ahead of the write head: a two-character insert before the selection made every later delta land two characters early, splicing the arriving text into the middle of the text it was meant to follow. The sink now holds an anchor pair minted once at the start of the rewrite — a write head at the selection end and a delete start outside it — repairs both on content-move commits, and resolves them per delta, so a concurrent edit or a block split moves the head instead of corrupting it (ST2, AN14). Losing the rewritten text to a structural edit, or the block itself to a deletion, now reports a diagnostic instead of quietly appending.

  A peer's AI run is now visible as presence. The streaming preview is a local decoration and never enters the document (RS1), so there is nothing for a collaborator to sync; the run publishes a `streaming: { blockId }` awareness payload instead. That key was already being written but never arrived: the multiplayer validator dropped it as undeclared, and local presence writes replaced the awareness state wholesale, so any selection change unpublished it. `streaming` is now a declared, validated key, presence writes merge rather than replace, and `MultiplayerController.getRemoteStreaming()` plus a `pen-multiplayer-streaming` block decoration expose it to renderers. The run publishes the key once rather than on every flush, since the block id does not change and resending it would spend the peer's whole presence rate budget. COL2 is amended to name the declared key set — it claimed a `pen.*` namespace that no key has ever used.

  `createTwoPeerHarness` accepts `extensionsFor`, building each peer's extensions separately. An extension factory closes over the controller it activates, so two peers handed one instance share it, which made a headless two-peer test of any stateful extension impossible to write.

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-tools@0.1.1
  - @input/pen-ingest@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. First-class AI co-authoring for Pen, with subpaths for suggestions, autocomplete, skills, tools, and streaming.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
  - @input/pen-tools@0.1.0
  - @input/pen-ingest@0.1.0
